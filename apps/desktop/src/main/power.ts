import { powerMonitor } from 'electron'
import { IPC } from '../shared/ipc'
import { releaseAllHotkeys } from './hotkeys'
import { emit } from './ipc'
import { log } from './log'

export function initPower(): void {
  powerMonitor.on('suspend', () => {
    log.info('system suspend')
    releaseAllHotkeys() // key-ups during sleep are never seen by the hook
    emit(IPC.powerSuspend)
  })
  powerMonitor.on('resume', () => {
    log.info('system resume')
    emit(IPC.powerResume)
  })
  // The secure desktop (Win+L, Ctrl+Alt+Del) swallows key-ups too.
  powerMonitor.on('lock-screen', releaseAllHotkeys)
}
