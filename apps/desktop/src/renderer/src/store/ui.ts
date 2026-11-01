import { create } from 'zustand'

/** Where the main area points. Voice channels render the call stage (wave 2) in the same slot. */
export type View =
  | { kind: 'home' }
  | { kind: 'dm'; channelId: string }
  | { kind: 'space'; spaceId: string; channelId: string | null }

export type FriendsTab = 'online' | 'all' | 'pending' | 'blocked' | 'add'

export type ModalState =
  | { kind: 'createSpace' }
  | { kind: 'joinSpace'; code?: string }
  | { kind: 'createChannel'; spaceId: string; type: 'text' | 'voice' }
  | { kind: 'invite'; spaceId: string }
  | { kind: 'leaveSpace'; spaceId: string }
  | null

export type Density = 'comfortable' | 'compact'

interface Prefs {
  reducedMotion: boolean
  /** Compact = the "classic" dense layout migrants ask for (smaller rows, no message gaps). */
  density: Density
  /** Desktop notifications for DMs and @mentions while the window is not focused. */
  notifyMessages: boolean
  /** Native notification for an incoming call while the window is not focused. */
  notifyCalls: boolean
  /** Taskbar badge with the mention count. */
  taskbarBadge: boolean
  memberList: boolean
  lastChannelBySpace: Record<string, string>
  /** Users who skipped/finished onboarding on this device. */
  onboarded: Record<string, true>
}

interface UiState extends Prefs {
  view: View
  friendsTab: FriendsTab
  modal: ModalState
  switcherOpen: boolean
  /** Reply target per channel (composer). */
  replyTo: Record<string, string | undefined>
  /** Message being edited inline per channel. */
  editing: Record<string, string | undefined>
  go(v: View): void
  setFriendsTab(t: FriendsTab): void
  openModal(m: ModalState): void
  setSwitcher(open: boolean): void
  setReplyTo(channelId: string, messageId: string | undefined): void
  setEditing(channelId: string, messageId: string | undefined): void
  setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void
}

const KEY = `alga.ui.v1`
function loadPrefs(): Prefs {
  const d: Prefs = { reducedMotion: false, density: 'comfortable', notifyMessages: true, notifyCalls: true, taskbarBadge: true, memberList: true, lastChannelBySpace: {}, onboarded: {} }
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return d
  }
}
const savePrefs = (s: Prefs) => {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        reducedMotion: s.reducedMotion,
        density: s.density,
        notifyMessages: s.notifyMessages,
        notifyCalls: s.notifyCalls,
        taskbarBadge: s.taskbarBadge,
        memberList: s.memberList,
        lastChannelBySpace: s.lastChannelBySpace,
        onboarded: s.onboarded,
      }),
    )
  } catch {
    /* storage full or unavailable: prefs are a convenience */
  }
}

export const useUi = create<UiState>()((set, get) => ({
  ...loadPrefs(),
  view: { kind: 'home' },
  friendsTab: 'online',
  modal: null,
  switcherOpen: false,
  replyTo: {},
  editing: {},

  go: (view) => {
    if (view.kind === 'space' && view.channelId) {
      const lastChannelBySpace = { ...get().lastChannelBySpace, [view.spaceId]: view.channelId }
      set({ view, lastChannelBySpace })
      savePrefs(get())
    } else set({ view })
  },
  setFriendsTab: (friendsTab) => set({ friendsTab }),
  openModal: (modal) => set({ modal }),
  setSwitcher: (switcherOpen) => set({ switcherOpen }),
  setReplyTo: (channelId, messageId) => set((s) => ({ replyTo: { ...s.replyTo, [channelId]: messageId } })),
  setEditing: (channelId, messageId) => set((s) => ({ editing: { ...s.editing, [channelId]: messageId } })),
  setPref: (k, v) => {
    set({ [k]: v } as Partial<UiState>)
    savePrefs(get())
  },
}))

// Manual reduced-motion and density: one class each on <html>, read by CSS tokens (and MotionConfig).
const applyHtml = (s: Prefs) => {
  document.documentElement.classList.toggle('reduce-motion', s.reducedMotion)
  document.documentElement.classList.toggle('density-compact', s.density === 'compact')
}
useUi.subscribe(applyHtml)
applyHtml(useUi.getState())
