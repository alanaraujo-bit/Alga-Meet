/** Pure data for chromium-flags.ts (kept free of 'electron' so it can be unit-tested in Node). */
// Cinema: 60 s ahead + 30 s behind at 40 Mbps ≈ 450 MB, above Chromium's ~150 MB default MSE video buffer limit.
export const CHROMIUM_SWITCHES: ReadonlyArray<readonly [string, string]> = [
  ['mse-video-buffer-size-limit-mb', '500'],
  ['mse-audio-buffer-size-limit-mb', '64'],
]
