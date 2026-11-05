// Embeds the app icon (resource 1: taskbar and the window) and version info into alga-setup-ui.exe.
fn main() {
    println!("cargo:rerun-if-changed=web/index.html");
    println!("cargo:rerun-if-changed=../../build/icon.ico");
    let mut res = winresource::WindowsResource::new();
    res.set_icon("../../build/icon.ico")
        .set("ProductName", "Alga Meet")
        .set("FileDescription", "Alga Meet Setup")
        .set("CompanyName", "Alga")
        .set("LegalCopyright", "Copyright © 2026 Alga");
    res.compile().expect("embed icon (needs the Windows SDK's rc.exe)");
}
