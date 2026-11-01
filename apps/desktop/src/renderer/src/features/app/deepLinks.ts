import { create } from 'zustand'
import type { DeepLink } from '../../../../shared/bridge'
import { errorText } from '@/lib/errors'
import { verifyEmail } from '@/store/actions'
import { useSession } from '@/store/session'
import { toast } from '@/ui'
import { t } from './strings'

/**
 * algameet:// links waiting for the right screen: the reset token for the reset form (signed out) and the invite
 * code for the join preview (after sign-in). Tokens/codes are bearer secrets: kept in memory only, never logged.
 */
export const useDeepLink = create<{ resetToken: string | null; inviteCode: string | null }>()(() => ({ resetToken: null, inviteCode: null }))

async function handle(link: DeepLink): Promise<void> {
  if (link.kind === 'invite') return useDeepLink.setState({ inviteCode: link.code })
  if (link.kind === 'password-reset') {
    useDeepLink.setState({ resetToken: link.token })
    // The reset form lives on the sign-in screen; confirming it ends every session anyway (this one included).
    if (useSession.getState().phase === 'signed_in')
      toast.info(t.deepLinks.resetSignedIn, { action: { label: t.deepLinks.resetSignOut, run: () => void useSession.getState().logout() } })
    return
  }
  try {
    await verifyEmail(link.token)
    toast.success(useSession.getState().phase === 'signed_in' ? t.deepLinks.verified : t.deepLinks.verifiedSignedOut)
  } catch (e) {
    toast.error(errorText(e, t.deepLinks.verifyFailed))
  }
}

/** Subscribe first, then take the link the app was started with (bridge contract). No-op on an older preload. */
export function startDeepLinks(): () => void {
  const dl = window.alga?.deepLinks
  if (!dl) return () => {}
  const off = dl.onLink((l) => void handle(l))
  void dl.takePending().then((l) => l && handle(l))
  return off
}
