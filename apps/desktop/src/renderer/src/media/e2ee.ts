// End-to-end encryption of a call's media (docs/decisions/0004-e2ee.md, phase 1b). MLS runs in main (window.alga.e2ee);
// here: the per-sender key provider of LiveKit's frame cryptor and the MLS × SFU member check (§3.8). The engine wires
// both (engine.ts); what is pure here is unit-tested.
import { BaseKeyProvider, createKeyMaterialFromBuffer } from 'livekit-client'
import type { E2eeMember } from '../../../shared/bridge'

/** LiveKit keyring slots per participant; main sends keyIndex = epoch % 16. */
export const KEYRING_SIZE = 16
/** An MLS leaf without SFU participant (or the reverse) is reported only after this long: joins and leaves settle first. */
export const MISMATCH_GRACE_MS = 2000

/**
 * One key per sender per epoch (MLS exporter, from main). sharedKey false: LiveKit keeps a keyring per participant
 * identity (= userId). ratchetWindowSize 0 and failureTolerance -1: keys only change with MLS epochs, never by the SDK's
 * ratchet-on-failure, and a frame that does not decrypt is dropped without marking the key invalid.
 * shortcut: old epochs' keys stay in the worker's 16-slot ring until overwritten (LiveKit has no delete); the engine
 * only replays the newest key per sender to a new Room.
 */
export class AlgaKeyProvider extends BaseKeyProvider {
  constructor() {
    super({ sharedKey: false, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: KEYRING_SIZE })
  }

  /** For our own identity this also makes `keyIndex` the slot we encrypt with from now on. */
  async setKey(identity: string, keyIndex: number, raw: Uint8Array): Promise<void> {
    this.onSetEncryptionKey(await createKeyMaterialFromBuffer(raw.slice().buffer), identity, keyIndex)
  }
}

/**
 * How this call's media goes. The server decides per call (VoiceJoinResponse.e2ee: DMs always, space voice channels per
 * Space.e2ee); a server without the flag (older) = whenever this client can. `unsupported`: the call is E2EE and this
 * client can't do it, so the join fails closed (never plain media instead).
 */
export function callMode(server: boolean | undefined, capable: boolean): 'e2ee' | 'plain' | 'unsupported' {
  if (!(server ?? capable)) return 'plain'
  return capable ? 'e2ee' : 'unsupported'
}

/**
 * Who we cannot vouch for (0004 §3.8): an MLS leaf with no SFU participant (a ghost the DS added), an SFU participant
 * with no leaf (someone who got a LiveKit token but no keys), a user on two leaves, or someone publishing unencrypted.
 * Our own leaf is skipped; another leaf with our userId is not.
 */
export function mismatchOf(members: readonly E2eeMember[], sfu: Iterable<string>, plaintext: Iterable<string> = []): string[] {
  const leaves = new Map<string, number>()
  for (const m of members) if (!m.self) leaves.set(m.userId, (leaves.get(m.userId) ?? 0) + 1)
  const room = new Set(sfu)
  const out = new Set(plaintext)
  for (const [id, n] of leaves) if (n > 1 || !room.has(id)) out.add(id)
  for (const id of room) if (!leaves.has(id)) out.add(id)
  return [...out].sort()
}

/** The mismatches that lasted `grace` ms. `since` (identity → first seen) is updated in place. */
export function settled(since: Map<string, number>, current: readonly string[], now: number, grace = MISMATCH_GRACE_MS): string[] {
  for (const id of [...since.keys()]) if (!current.includes(id)) since.delete(id)
  for (const id of current) if (!since.has(id)) since.set(id, now)
  return current.filter((id) => now - since.get(id)! >= grace)
}
