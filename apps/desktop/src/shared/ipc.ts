/**
 * IPC channel names shared by main and preload only (the renderer never sees them; it uses window.alga).
 * invoke = request/response, send = fire-and-forget, event = main -> renderer push.
 */
export const IPC = {
  config: 'alga:config', // sendSync

  authGetToken: 'alga:auth:get-token', // invoke
  authSetToken: 'alga:auth:set-token', // invoke

  winMinimize: 'alga:win:minimize', // send
  winToggleMaximize: 'alga:win:toggle-maximize', // send
  winClose: 'alga:win:close', // send
  winIsMaximized: 'alga:win:is-maximized', // invoke
  winMaximizedChanged: 'alga:win:maximized-changed', // event
  winFocusChanged: 'alga:win:focus-changed', // event
  winSetBadge: 'alga:win:set-badge', // send
  winFlashFrame: 'alga:win:flash-frame', // send

  screenGetSources: 'alga:screen:get-sources', // invoke
  screenSelect: 'alga:screen:select', // invoke

  hotkeysSet: 'alga:hotkeys:set', // invoke
  hotkeysRecord: 'alga:hotkeys:record', // invoke
  hotkeysLabel: 'alga:hotkeys:label', // invoke
  hotkeysEvent: 'alga:hotkeys:event', // event

  notify: 'alga:notify', // send
  notificationClick: 'alga:notification-click', // event

  traySetVoiceState: 'alga:tray:set-voice-state', // send
  trayAction: 'alga:tray:action', // event

  powerSuspend: 'alga:power:suspend', // event
  powerResume: 'alga:power:resume', // event

  updatesCheck: 'alga:updates:check', // invoke
  updatesStatus: 'alga:updates:status', // event
  updatesInstall: 'alga:updates:install', // send

  deepLink: 'alga:deep-link', // event
  deepLinksTakePending: 'alga:deep-links:take-pending', // invoke

  appGetStartAtLogin: 'alga:app:get-start-at-login', // invoke
  appSetStartAtLogin: 'alga:app:set-start-at-login', // invoke
  appGetCloseToTray: 'alga:app:get-close-to-tray', // invoke
  appSetCloseToTray: 'alga:app:set-close-to-tray', // invoke
  appOpenExternal: 'alga:app:open-external', // invoke
  appOpenLogs: 'alga:app:open-logs', // invoke
  appQuit: 'alga:app:quit', // send

  e2eeStatus: 'alga:e2ee:status', // invoke
  e2eeJoin: 'alga:e2ee:join', // invoke
  e2eeLeave: 'alga:e2ee:leave', // invoke
  e2eeCode: 'alga:e2ee:code', // invoke
  e2eeDispatch: 'alga:e2ee:dispatch', // send
  e2eeSend: 'alga:e2ee:send', // event
  e2eeKey: 'alga:e2ee:key', // event
  e2eeEpoch: 'alga:e2ee:epoch', // event
} as const
