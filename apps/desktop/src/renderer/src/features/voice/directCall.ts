/**
 * Direct calls (DMs, group DMs) are end-to-end encrypted on this client whatever the server says (0004 §3.8.3):
 * a plain offer is refused before connecting (also on the engine's re-entries), and a direct call that ends up
 * connected without E2EE is left at once. Space rooms follow Space.e2ee.
 * Checked only on the way INTO 'connected': leaving drops E2EE to 'off' while the connection is still 'connected'
 * (engine leave()), which is not a plain call.
 */
export const refuseOffer = (direct: boolean, offerE2ee: boolean | undefined): boolean => direct && offerE2ee !== true

export const mustLeave = (direct: boolean, prev: string, connection: string, e2ee: string): boolean =>
  direct && connection === 'connected' && prev !== 'connected' && e2ee === 'off'
