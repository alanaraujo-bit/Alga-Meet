import { create } from 'zustand'

export type SettingsSection = 'account' | 'plan' | 'shop' | 'voice' | 'hotkeys' | 'notifications' | 'appearance' | 'startup' | 'advanced'

/** Full-window settings overlay: null = closed. */
export const useSettings = create<{ section: SettingsSection | null }>()(() => ({ section: null }))
export const openSettings = (section: SettingsSection = 'account') => useSettings.setState({ section })
export const closeSettings = () => useSettings.setState({ section: null })
