//! Alga Meet's own setup window: the install, update and uninstall screens (apps/desktop/src/setup, built into
//! web/index.html and embedded below) in a borderless WebView2 window, driven by the NSIS installer
//! (apps/desktop/build/installer.nsh). NSIS still does the real work (files, registry, shortcuts, auto-update);
//! this only shows it.
//!
//!   --mode install   --dir <INSTDIR> --work <PLUGINSDIR> --kb <unpacked KB> --parent <installer pid>
//!                    --exe <app exe file name> --data <userData dir> --installer <setup exe> --version <x.y.z>
//!   --mode update    (same): a small card while the silent update runs; the installer starts the app itself.
//!   --mode uninstall --dir <INSTDIR>: asks, then runs the real NSIS uninstaller silently and shows it leaving.
//!   ... /S ...       : no window. The registered UninstallString points here, and electron-builder runs it with
//!                      `/S ... _?=<dir>` while updating: forward to the real uninstaller and return its exit code.
#![windows_subsystem = "windows"]

use std::env;
use std::fs;
use std::io::Write as _;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitCode};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tao::dpi::{LogicalPosition, LogicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::platform::windows::{IconExtWindows, WindowBuilderExtWindows};
use tao::window::{Icon, Window, WindowBuilder};
use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows_sys::Win32::System::Environment::GetCommandLineW;
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};
use wry::{WebContext, WebViewBuilder};

const PAGE: &str = include_str!("../web/index.html");
const POLL: Duration = Duration::from_millis(120);

#[derive(Clone, Copy, PartialEq, Debug)]
enum Mode {
    Install,
    Update,
    Uninstall,
}

#[derive(Clone)]
struct Opts {
    mode: Mode,
    dir: PathBuf,
    work: Option<PathBuf>,
    total: u64,
    parent: Option<u32>,
    exe: String,
    data: Option<PathBuf>,
    installer: Option<PathBuf>,
    version: String,
}

enum UserEvent {
    Page(String),
    Progress(f64, &'static str),
    Done(bool),
    ShowAnyway,
}

fn main() -> ExitCode {
    sweep();
    let args: Vec<String> = env::args().collect();
    let tail = command_line_tail();
    if args.iter().skip(1).any(|a| a.eq_ignore_ascii_case("/S")) {
        // Started from inside the folder being removed (QuietUninstallString, winget): like NSIS's own uninstaller,
        // hand over to a temp copy and return, so nothing there stays locked. Updates (--updated) need the real
        // exit code and replace the folder anyway: those wait in place.
        let updating = args.iter().any(|a| a == "--updated");
        if let (Some(dir), Ok(me)) = (target_dir(&tail, &args), env::current_exe()) {
            if me.starts_with(&dir) && !updating && !args.iter().any(|a| a == "--relocated") {
                let copy = scratch().join(format!("alga-setup-ui-{}.exe", std::process::id()));
                if fs::copy(&me, &copy).is_ok() {
                    let mut cmd = Command::new(&copy);
                    cmd.raw_arg("--relocated").raw_arg(format!("--after {}", std::process::id())).raw_arg(&tail);
                    if cmd.spawn().is_ok() {
                        return ExitCode::SUCCESS;
                    }
                }
            }
        }
        if let Some(pid) = value(&args, "--after").and_then(|v| v.parse().ok()) {
            wait_process(pid);
        }
        let code = pass_through(&tail, &args);
        log(&format!("pass-through exit {code}"));
        return ExitCode::from(code.clamp(0, 255) as u8);
    }
    let mode = match value(&args, "--mode").as_deref() {
        Some("install") => Mode::Install,
        Some("update") => Mode::Update,
        Some("uninstall") => Mode::Uninstall,
        _ => return ExitCode::from(2),
    };
    let Some(dir) = value(&args, "--dir").map(PathBuf::from) else { return ExitCode::from(2) };
    let opts = Opts {
        mode,
        work: value(&args, "--work").map(PathBuf::from),
        total: value(&args, "--kb").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0) * 1024,
        parent: value(&args, "--parent").and_then(|v| v.parse().ok()),
        exe: value(&args, "--exe").unwrap_or_else(|| "Alga Meet.exe".into()),
        data: value(&args, "--data").map(PathBuf::from),
        installer: value(&args, "--installer").map(PathBuf::from),
        version: value(&args, "--version").unwrap_or_default(),
        dir,
    };
    log(&format!("start {:?} dir={}", opts.mode, opts.dir.display()));
    // The uninstaller removes everything under INSTDIR (and kills processes running from there): leave it first.
    if mode == Mode::Uninstall && !args.iter().any(|a| a == "--relocated") {
        if let Ok(me) = env::current_exe() {
            if me.starts_with(&opts.dir) {
                let copy = scratch().join(format!("alga-setup-ui-{}.exe", std::process::id()));
                if fs::copy(&me, &copy).is_ok() && Command::new(&copy).args(&args[1..]).arg("--relocated").spawn().is_ok() {
                    return ExitCode::SUCCESS;
                }
            }
        }
    }
    run(opts)
}

/* ── Window ──────────────────────────────────────────────────────────────────────────────────────────────── */

fn run(opts: Opts) -> ExitCode {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    // Card size + 24 px each side for its shadow (setup.css .card.*).
    let (w, h, title) = match opts.mode {
        Mode::Install => (488.0, 616.0, "Instalando o Alga Meet"),
        Mode::Update => (440.0, 200.0, "Atualizando o Alga Meet"),
        Mode::Uninstall => (488.0, 572.0, "Desinstalar o Alga Meet"),
    };
    let window = match WindowBuilder::new()
        .with_title(title)
        .with_decorations(false)
        .with_transparent(true)
        .with_resizable(false)
        .with_undecorated_shadow(false)
        .with_inner_size(LogicalSize::new(w, h))
        .with_visible(false)
        .with_window_icon(Icon::from_resource(1, None).ok())
        .build(&event_loop)
    {
        Ok(w) => w,
        Err(e) => return fallback(&opts, &format!("window: {e}")),
    };
    if let Some(m) = window.primary_monitor() {
        let s = m.scale_factor();
        let (mw, mh) = (m.size().width as f64 / s, m.size().height as f64 / s);
        let (mx, my) = (m.position().x as f64 / s, m.position().y as f64 / s);
        window.set_outer_position(LogicalPosition::new(mx + (mw - w) / 2.0, my + (mh - h) / 2.0 - 20.0));
    }

    let mode_name = match opts.mode {
        Mode::Install => "install",
        Mode::Update => "update",
        Mode::Uninstall => "uninstall",
    };
    let boot = format!(
        "window.__SETUP__ = {{ mode: {}, version: {} }};",
        serde_json::to_string(mode_name).unwrap(),
        serde_json::to_string(&opts.version).unwrap()
    );
    let mut context = WebContext::new(Some(scratch().join("webview")));
    let page_proxy = proxy.clone();
    let webview = match WebViewBuilder::new_with_web_context(&mut context)
        .with_html(PAGE)
        .with_transparent(true)
        .with_background_color((0, 0, 0, 0))
        .with_initialization_script(boot)
        .with_devtools(cfg!(debug_assertions))
        .with_ipc_handler(move |req| {
            let _ = page_proxy.send_event(UserEvent::Page(req.body().clone()));
        })
        .build(&window)
    {
        Ok(v) => v,
        Err(e) => return fallback(&opts, &format!("webview: {e}")),
    };

    // Never leave the person without a window if the page fails to say it is ready.
    {
        let p = proxy.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(2500));
            let _ = p.send_event(UserEvent::ShowAnyway);
        });
    }
    if opts.mode != Mode::Uninstall {
        watch_install(opts.clone(), proxy.clone());
    }

    let mut eco: Option<String> = None;
    let mut done: Option<bool> = None;
    let mut hidden = false; // closed while still installing: finish quietly
    let mut shown = false;
    let mut uninstalling = false;
    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        let emit = |js: String| {
            let _ = webview.evaluate_script(&format!("window.__setupEmit && window.__setupEmit({js})"));
        };
        match event {
            Event::UserEvent(UserEvent::Progress(p, phase)) => {
                emit(format!(r#"{{"type":"progress","p":{p:.4},"phase":"{phase}"}}"#));
            }
            Event::UserEvent(UserEvent::Done(ok)) => {
                log(&format!("done ok={ok}"));
                done = Some(ok);
                emit(format!(r#"{{"type":"done","ok":{ok}}}"#));
                if hidden {
                    if ok && opts.mode == Mode::Install {
                        open_app(&opts, eco.as_deref());
                    }
                    *flow = ControlFlow::Exit;
                }
            }
            Event::UserEvent(UserEvent::ShowAnyway) => {
                if !shown && !hidden {
                    shown = true;
                    window.set_visible(true);
                }
            }
            Event::UserEvent(UserEvent::Page(body)) => {
                let msg: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
                match msg["type"].as_str().unwrap_or("") {
                    "ready" => {
                        if !shown {
                            shown = true;
                            window.set_visible(true);
                            window.set_focus();
                        }
                    }
                    "drag" => {
                        let _ = window.drag_window();
                    }
                    "minimize" => window.set_minimized(true),
                    "eco" => eco = (!msg["eco"].is_null()).then(|| msg["eco"].to_string()),
                    "open" => {
                        open_app(&opts, eco.as_deref());
                        *flow = ControlFlow::Exit;
                    }
                    "retry" => {
                        if let Some(setup) = &opts.installer {
                            let _ = Command::new(setup).spawn();
                        }
                        *flow = ControlFlow::Exit;
                    }
                    "uninstall" => {
                        if !uninstalling {
                            uninstalling = true;
                            uninstall(opts.clone(), msg["deleteData"].as_bool().unwrap_or(false), proxy.clone());
                        }
                    }
                    "close" => close(&window, &opts, done, &mut hidden, flow),
                    _ => {}
                }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => close(&window, &opts, done, &mut hidden, flow),
            _ => {}
        }
    })
}

/// Closing while files are still landing hides the window; the install finishes and the app opens by itself.
fn close(window: &Window, opts: &Opts, done: Option<bool>, hidden: &mut bool, flow: &mut ControlFlow) {
    if opts.mode == Mode::Install && done.is_none() {
        *hidden = true;
        window.set_visible(false);
    } else {
        *flow = ControlFlow::Exit;
    }
}

/// No WebView2 (or no window): behave like the plain installer would.
fn fallback(opts: &Opts, why: &str) -> ExitCode {
    log(&format!("fallback: {why}"));
    match opts.mode {
        Mode::Install => {
            if let Some(ok) = opts.parent.map(wait_process) {
                if ok == Some(0) && opts.dir.join(&opts.exe).exists() {
                    open_app(opts, None);
                }
            }
        }
        Mode::Update => {}
        Mode::Uninstall => {
            // The classic NSIS uninstaller with its own questions.
            if let Some(real) = find_uninstaller(&opts.dir) {
                let tmp = scratch().join(format!("alga-uninstall-{}.exe", std::process::id()));
                if fs::copy(&real, &tmp).is_ok() {
                    let mut cmd = Command::new(&tmp);
                    cmd.raw_arg("/currentuser").raw_arg(format!("_?={}", opts.dir.display()));
                    let _ = cmd.status();
                    let _ = fs::remove_file(&tmp);
                    let _ = fs::remove_dir(&opts.dir);
                }
            }
        }
    }
    ExitCode::SUCCESS
}

/* ── Install / update ────────────────────────────────────────────────────────────────────────────────────── */

/// Real progress without hooks into NSIS: bytes in $PLUGINSDIR\7z-out (the extraction, most of the time) and then
/// in INSTDIR (the copy). Done is the installer process exiting; success is exit code 0 and the app on disk.
fn watch_install(opts: Opts, proxy: EventLoopProxy<UserEvent>) {
    thread::spawn(move || {
        let total = opts.total.max(1) as f64;
        let mut last = -1.0;
        loop {
            let extracted = opts.work.as_ref().map(|w| dir_size(&w.join("7z-out"))).unwrap_or(0) as f64;
            let copied = if extracted > 0.0 { dir_size(&opts.dir) as f64 } else { 0.0 };
            let (pe, pc) = ((extracted / total).min(1.0), (copied / total).min(1.0));
            let p = (0.04 + 0.78 * pe + 0.16 * pc).min(0.98);
            let phase = if extracted == 0.0 {
                "preparing"
            } else if pc > 0.97 {
                "finishing"
            } else {
                "files"
            };
            let p = if extracted == 0.0 { 0.0 } else { p };
            if p != last {
                last = p;
                let _ = proxy.send_event(UserEvent::Progress(p, phase));
            }
            if let Some(pid) = opts.parent {
                if let Some(code) = exited(pid) {
                    let ok = code == 0 && opts.dir.join(&opts.exe).exists();
                    if ok {
                        let _ = proxy.send_event(UserEvent::Progress(1.0, "finishing"));
                    }
                    let _ = proxy.send_event(UserEvent::Done(ok));
                    return;
                }
            }
            thread::sleep(POLL);
        }
    });
}

/// Starts the installed app (detached) and leaves the Eco picked during the install where the app looks for it.
fn open_app(opts: &Opts, eco: Option<&str>) {
    if let (Some(eco), Some(data)) = (eco, &opts.data) {
        let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        if fs::create_dir_all(data).is_ok() {
            let _ = fs::write(data.join("setup-eco.json"), format!(r#"{{"eco":{eco},"at":{at}}}"#));
        }
    }
    let exe = opts.dir.join(&opts.exe);
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    let r = Command::new(&exe).current_dir(&opts.dir).creation_flags(DETACHED_PROCESS).spawn();
    log(&format!("open {} -> {}", exe.display(), r.is_ok()));
}

/* ── Uninstall ───────────────────────────────────────────────────────────────────────────────────────────── */

fn uninstall(opts: Opts, delete_data: bool, proxy: EventLoopProxy<UserEvent>) {
    thread::spawn(move || {
        let Some(real) = find_uninstaller(&opts.dir) else {
            let _ = proxy.send_event(UserEvent::Done(false));
            return;
        };
        let tmp = scratch().join(format!("alga-uninstall-{}.exe", std::process::id()));
        if fs::copy(&real, &tmp).is_err() {
            let _ = proxy.send_event(UserEvent::Done(false));
            return;
        }
        let start = dir_size(&opts.dir).max(1) as f64;
        let mut cmd = Command::new(&tmp);
        cmd.raw_arg("/S").raw_arg("/currentuser");
        if delete_data {
            cmd.raw_arg("--delete-app-data");
        }
        // NSIS: `_?=` must be last and unquoted, even with spaces.
        cmd.raw_arg(format!("_?={}", opts.dir.display()));
        let mut child: Child = match cmd.spawn() {
            Ok(c) => c,
            Err(_) => {
                let _ = proxy.send_event(UserEvent::Done(false));
                return;
            }
        };
        let code = loop {
            if let Ok(Some(status)) = child.try_wait() {
                break status.code().unwrap_or(2);
            }
            let left = dir_size(&opts.dir) as f64;
            let _ = proxy.send_event(UserEvent::Progress((1.0 - left / start).clamp(0.02, 0.98), "files"));
            thread::sleep(POLL);
        };
        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_dir(&opts.dir); // empty once the uninstaller ran from outside it
        log(&format!("uninstaller exit {code}"));
        let _ = proxy.send_event(UserEvent::Done(code == 0));
    });
}

/// Silent path (`/S`): run the real NSIS uninstaller with the same command line, wait, return its exit code.
fn pass_through(tail: &str, args: &[String]) -> i32 {
    let Some(dir) = target_dir(tail, args) else { return 2 };
    let Some(real) = find_uninstaller(&dir) else { return 0 }; // nothing left to remove
    let tmp = scratch().join(format!("alga-uninstall-{}.exe", std::process::id()));
    if fs::copy(&real, &tmp).is_err() {
        return 2;
    }
    let mut cmd = Command::new(&tmp);
    cmd.raw_arg(tail);
    if !tail.contains("_?=") {
        cmd.raw_arg(format!("_?={}", dir.display()));
    }
    let code = cmd.status().ok().and_then(|s| s.code()).unwrap_or(2);
    let _ = fs::remove_file(&tmp);
    code
}

/// The install folder: NSIS's `_?=` (last, unquoted) or our `--dir`.
fn target_dir(tail: &str, args: &[String]) -> Option<PathBuf> {
    match tail.find("_?=") {
        Some(i) => Some(PathBuf::from(tail[i + 3..].trim())),
        None => value(args, "--dir").map(PathBuf::from),
    }
}

fn find_uninstaller(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        name.starts_with("Uninstall ") && name.to_ascii_lowercase().ends_with(".exe")
    })
}

/* ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────── */

fn value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

/// The raw command line after the program name (NSIS's `_?=` is unquoted and may contain spaces).
fn command_line_tail() -> String {
    let raw = unsafe {
        let p = GetCommandLineW();
        let mut n = 0;
        while *p.add(n) != 0 {
            n += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
    };
    let s = raw.trim_start();
    let rest = if let Some(stripped) = s.strip_prefix('"') {
        stripped.find('"').map(|i| &stripped[i + 1..]).unwrap_or("")
    } else {
        s.find(char::is_whitespace).map(|i| &s[i..]).unwrap_or("")
    };
    rest.trim().to_string()
}

/// `Some(exit code)` once the process is gone (or cannot be opened any more).
fn exited(pid: u32) -> Option<u32> {
    unsafe {
        let h = OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return Some(0);
        }
        let gone = WaitForSingleObject(h, 0) == WAIT_OBJECT_0;
        let mut code = 0u32;
        if gone {
            GetExitCodeProcess(h, &mut code);
        }
        CloseHandle(h);
        gone.then_some(code)
    }
}

fn wait_process(pid: u32) -> Option<u32> {
    loop {
        if let Some(code) = exited(pid) {
            return Some(code);
        }
        thread::sleep(POLL);
    }
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

/// Copies left in %TEMP%\AlgaMeetSetup by earlier runs (each run copies itself or the uninstaller there).
/// The ones still running are locked and stay until a later run.
fn sweep() {
    let me = env::current_exe().ok();
    let Ok(entries) = fs::read_dir(scratch()) else { return };
    for p in entries.flatten().map(|e| e.path()) {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let ours = (name.starts_with("alga-setup-ui-") || name.starts_with("alga-uninstall-")) && name.ends_with(".exe");
        if ours && Some(&p) != me.as_ref() {
            let _ = fs::remove_file(&p);
        }
    }
}

fn scratch() -> PathBuf {
    let d = env::temp_dir().join("AlgaMeetSetup");
    let _ = fs::create_dir_all(&d);
    d
}

fn log(line: &str) {
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(scratch().join("setup-ui.log")) {
        let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{at} [{}] {line}", std::process::id());
    }
}
