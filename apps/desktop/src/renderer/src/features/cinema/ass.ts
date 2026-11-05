import JASSUB from 'jassub'
import workerUrl from 'jassub/dist/worker/worker.js?url'
import wasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?url'
import modernWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?url'
import wasmWorkerUrl from 'jassub/dist/wasm/jassub-worker.js?url'
import modernWasmWorkerUrl from 'jassub/dist/wasm/jassub-worker-modern.js?url'
import defaultFontUrl from 'jassub/dist/default.woff2?url'
import { assTimeOffset, type SubtitleManifest } from './subtitles'

/** Styled ASS/SSA on top of the <video> via JASSUB (libass in a worker, OffscreenCanvas, capped at 1080p). */
export function createAss(video: HTMLVideoElement, manifest: SubtitleManifest, fontBytes: Uint8Array[], offsetS = 0): JASSUB {
  return new JASSUB({
    video,
    subContent: manifest.text,
    fonts: fontBytes,
    maxRenderHeight: 1080,
    timeOffset: assTimeOffset(offsetS), // sign flip: see assTimeOffset
    workerUrl,
    wasmUrl,
    modernWasmUrl,
    wasmWorkerUrl,
    modernWasmWorkerUrl,
    availableFonts: { 'liberation sans': defaultFontUrl },
  })
}

/** Per-person delay without recreating the renderer (positive = later, like the text overlay). */
export function setAssOffset(ass: JASSUB, offsetS: number): void {
  ass.timeOffset = assTimeOffset(offsetS)
}

export function destroyAss(ass: JASSUB): void {
  void ass.destroy()
}
