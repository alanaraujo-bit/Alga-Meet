// Chromium switches that affect WebRTC/media quality and performance. Must run before app 'ready'.
// Imported first by main/index.ts. Each switch needs a one-line justification + measurement in docs/benchmarks.
//
// None are set today: everything we need is on by default in Electron 45 / Chromium 156 (measured,
// docs/benchmarks/media-baseline.md):
// - HEVC hardware encode (NVIDIA HEVC Encoder MFT via MediaFoundationVideoEncodeAccelerator): on by default.
// - HW decode (D3D11VideoDecoder) for H.264/HEVC/VP9/AV1: on by default.
// - PlatformH264CbpEncoding: evaluated, rejected — WebRTC H.264 (42e01f) still used OpenH264 with it on.
// Harness-only switches (occlusion/backgrounding) live in apps/desktop/scripts/media-lab.mjs, not here.
export {}
