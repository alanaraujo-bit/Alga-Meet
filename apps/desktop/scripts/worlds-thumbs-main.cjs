// Electron main of scripts/worlds-thumbs.mjs: one hidden, offscreen window on the URL it is given. Offscreen so the page
// keeps drawing without ever showing a window; nothing of the app's own main process is loaded.
const { app, BrowserWindow } = require('electron')

const url = process.argv.find((a) => a.startsWith('http://localhost:'))
app.on('window-all-closed', () => app.quit())
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 640, height: 480, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } })
  void win.loadURL(url)
})
