/**
 * Feedback at the point of action: an engine notice about your own stream belongs on your tile while that call's
 * stage is on screen; anywhere else it stays a toast.
 * shortcut: recognizes the engine's stream copy by text; switch to a notice kind once the engine tags notices.
 */
export function streamNoticeOnTile(text: string, at: { sharing: boolean; stage: string | null; call: string | null }): boolean {
  return /^(A transmissão|Seu plano não inclui)/.test(text) && at.sharing && at.stage !== null && at.stage === at.call
}
