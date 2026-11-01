// Probe: does system-audio loopback in this Electron build exclude our own app's audio?
// Evidence for docs/decisions/0002-screen-audio-capture.md. Re-run after every Electron upgrade:
//   npx electron scripts/loopback-probe.mjs [--audio=loopback|loopbackWithMute] [--enable-features=RestrictOwnAudio]
// The page plays a quiet 1000 Hz tone (our "voice chat"), another process (PowerShell [console]::beep)
// plays 1500 Hz (a "game"), then getDisplayMedia captures system audio and we read both bins.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, session } from 'electron'

const audioMode = process.argv.find((a) => a.startsWith('--audio='))?.split('=')[1] ?? 'loopback'

const page = `<!doctype html><meta charset="utf-8"><script>
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function measure(constraints, ownGain) {
  const out = new AudioContext()
  const osc = out.createOscillator(); osc.frequency.value = 1000
  const gain = out.createGain(); gain.gain.value = ownGain
  osc.connect(gain).connect(out.destination); osc.start()
  await sleep(400)
  const stream = await navigator.mediaDevices.getDisplayMedia(constraints)
  const track = stream.getAudioTracks()[0]
  if (!track) return { error: 'no audio track' }
  const ctx = new AudioContext()
  const an = ctx.createAnalyser(); an.fftSize = 8192
  ctx.createMediaStreamSource(new MediaStream([track])).connect(an)
  const bins = new Float32Array(an.frequencyBinCount)
  const bin = (hz) => Math.round(hz / (ctx.sampleRate / an.fftSize))
  let own = -Infinity, other = -Infinity, floor = []
  for (let i = 0; i < 12; i++) {
    await sleep(150)
    an.getFloatFrequencyData(bins)
    own = Math.max(own, bins[bin(1000)]); other = Math.max(other, bins[bin(1500)])
    floor.push(bins[bin(3100)])
  }
  const settings = track.getSettings()
  stream.getTracks().forEach((t) => t.stop()); osc.stop(); out.close(); ctx.close()
  return { label: track.label, deviceId: settings.deviceId, restrictOwnAudio: settings.restrictOwnAudio,
    ownToneDb: Math.round(own), otherToneDb: Math.round(other), floorDb: Math.round(Math.max(...floor)) }
}
</script>`

app.whenReady().then(async () => {
  const file = join(tmpdir(), 'alga-loopback-probe.html')
  writeFileSync(file, page)
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'] })
    cb({ video: screen, audio: audioMode })
  })
  const win = new BrowserWindow({ show: false })
  await win.loadFile(file)
  const supported = await win.webContents.executeJavaScript('navigator.mediaDevices.getSupportedConstraints().restrictOwnAudio === true')
  const results = { electron: process.versions.electron, chrome: process.versions.chrome, audioMode, switches: process.argv.filter((a) => a.startsWith('--enable-features')), restrictOwnAudioSupported: supported, runs: {} }
  // control: no own tone at all, i.e. what the 1000 Hz bin reads when our audio is truly absent.
  for (const [name, constraints, ownGain] of [
    ['plain', { video: true, audio: true }, 0.03],
    ['restrictOwnAudio', { video: true, audio: { restrictOwnAudio: true } }, 0.03],
    ['control_noOwnTone', { video: true, audio: true }, 0],
  ]) {
    const beep = spawn('powershell', ['-NoProfile', '-Command', '[console]::beep(1500,2600)'], { stdio: 'ignore' })
    try {
      results.runs[name] = await win.webContents.executeJavaScript(`measure(${JSON.stringify(constraints)}, ${ownGain})`)
    } catch (err) {
      results.runs[name] = { error: String(err) }
    }
    await new Promise((r) => beep.on('exit', r))
  }
  console.log(JSON.stringify(results, null, 2))
  app.quit()
})
