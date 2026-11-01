import { join } from 'node:path'
import { app } from 'electron'

/** Runtime images (tray, notification icon): build/runtime in dev, resources/assets when packaged (real files, not asar). */
export const assetPath = (name: string): string =>
  app.isPackaged ? join(process.resourcesPath, 'assets', name) : join(app.getAppPath(), 'build', 'runtime', name)
