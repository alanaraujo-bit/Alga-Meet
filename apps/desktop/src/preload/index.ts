import { contextBridge, ipcRenderer } from 'electron'
import type { AlgaBridge, AppConfig } from '../shared/bridge'

const config = ipcRenderer.sendSync('alga:config') as AppConfig

// Skeleton: only config is wired; the desktop-native work fills in the rest of AlgaBridge.
const bridge: Partial<AlgaBridge> = { config }

contextBridge.exposeInMainWorld('alga', bridge)
