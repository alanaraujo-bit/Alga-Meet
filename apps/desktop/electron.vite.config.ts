import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * Opus RED under E2EE (docs/decisions/0004-e2ee.md §4.3). livekit-client 2.23 sends `disableRed` for every audio track
 * of an E2EE room, even when the app asks for `red: true`; this rewrites that one expression at build time and FAILS
 * the build when the snippet is gone, so an SDK upgrade cannot drop RED silently. Issue to file upstream
 * (livekit/client-sdk-js):
 *
 *   Title: Allow Opus RED with E2EE when `red: true` is passed explicitly
 *   Since #858, `LocalParticipant` sends `disableRed: this.isE2EEEnabled || !(opts.red ?? true)`: with E2EE, RED is
 *   off even when the app passes `red: true`. RED is built before the encoded transform (the sender transform gets
 *   PT 63 frames: 0x6F primary-only, 0xEF… redundant block + primary), so the cryptor encrypts the whole RED payload
 *   as one opaque frame and it decrypts fine end to end, as long as the SFU forwards RED as is, i.e. every subscriber
 *   negotiates RED (the SFU cannot convert encrypted RED to plain Opus). Measured with livekit-server 1.13.11: decrypted
 *   tone, +12 kbps (the 30-byte trailer), concealment at 5/10 % loss back to the non-E2EE numbers. Proposal: keep the
 *   default but honor an explicit `red: true` (`disableRed: (isE2EEEnabled && opts.red !== true) || opts.red === false`),
 *   and document that subscribers without RED cannot play such a track.
 */
const LK_RED_FROM = 'disableRed: this.isE2EEEnabled || !((_b = opts.red) !== null && _b !== void 0 ? _b : true),'
const LK_RED_TO = 'disableRed: this.isE2EEEnabled && opts.red !== true || !((_b = opts.red) !== null && _b !== void 0 ? _b : true),'
const LK_ESM = /livekit-client[\\/]dist[\\/]livekit-client\.esm\.mjs$/

function livekitRedUnderE2ee(): Plugin {
  let patched = false
  let building = false
  return {
    name: 'alga:livekit-red-under-e2ee',
    enforce: 'pre',
    configResolved: (c) => void (building = c.command === 'build'),
    transform(code, id) {
      if (!LK_ESM.test(id.split('?')[0]!)) return null
      if (!code.includes(LK_RED_FROM)) this.error('livekit-client changed: the disableRed snippet patched for RED under E2EE is gone (electron.vite.config.ts). Re-check RED with E2EE, then update or drop the patch.')
      patched = true
      return { code: code.replace(LK_RED_FROM, LK_RED_TO), map: null }
    },
    buildEnd(err) {
      if (building && !err && !patched) this.error('livekit-client.esm.mjs was not transformed: RED under E2EE would be off (electron.vite.config.ts)')
    },
  }
}

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        // mls-worker: the utilityProcess hosting the MLS WASM (src/main/mls), forked from out/main by mls/host.ts.
        input: { index: resolve(__dirname, 'src/main/index.ts'), 'mls-worker': resolve(__dirname, 'src/main/mls/worker.ts') },
      },
    },
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [livekitRedUnderE2ee(), react()],
    // Dev serves livekit-client through the plugin above instead of the pre-bundled copy (it has no imports of its own).
    optimizeDeps: { exclude: ['livekit-client'] },
    // electron-vite leaves the renderer unminified by default: ~2.5x more JS to parse on every cold start.
    build: { minify: true },
  },
})
