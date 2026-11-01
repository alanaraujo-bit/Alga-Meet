// Números que o site cita. Só entra o que foi medido; a fonte fica ao lado para quem revisar.
// Mudou a medição em docs/STATE.md ou docs/benchmarks? Atualize aqui.
export const facts = {
  // docs/STATE.md › Servidor de voz em casa (staging + SFU, LAN, 10 min): mediana 46,7 ms, p95 50,3
  voiceLatencyMs: 46,
  packetsLost: 0,
  packetsSent: 20834,
  // docs/STATE.md › Qualidade: entrar no canal 132 ms (p95 137), localhost
  joinMs: 132,
  // docs/STATE.md › Qualidade: 53 ms padrão → 62 ms com RNNoise
  noiseSuppressionCostMs: 9,
  // docs/STATE.md › Interface (ocioso 10 min: 229–233 MB) e discord-benchmark.md §3 (808,1 MB, 6 processos)
  idleRamMb: 230,
  discordIdleRamMb: 808,
  discordProcesses: 6,
  // docs/STATE.md › Qualidade: em chamada de voz 1,7 % CPU; 1080p60 HEVC NVENC 3,4 % CPU total
  voiceCpuPct: '1,7',
  streamCpuPct: '3,4',
  // docs/benchmarks/ui-performance.md via STATE: abrir o app → shell ~575 ms
  openMs: 575,
  // docs/STATE.md › Desktop nativo: instalador NSIS 109 MiB
  installerMb: 109,
  // ARCHITECTURE.md D11/D12 e STATE (gating por plano)
  freeStream: ['720p60', '1080p30'],
  plusStream: ['1080p60', '1440p60', '4K30'],
  discordFreeStream: '720p30',
  voiceKbps: 64,
  // docs/business/monetization.md + growth-plan.md §2.2 (preço em validação com o dono)
  plusMonthly: 'R$ 14,90',
  plusYearly: 'R$ 149',
  attachFreeMb: 25,
  attachPlusMb: 100,
} as const;
