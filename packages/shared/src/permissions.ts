/** Space permission bitfield. Kept under 31 bits so JS bitwise ops stay safe. */
export const Permission = {
  ADMINISTRATOR: 1 << 0,
  VIEW_CHANNELS: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_SPACE: 1 << 3,
  MANAGE_ROLES: 1 << 4,
  CREATE_INVITES: 1 << 5,
  KICK_MEMBERS: 1 << 6,
  BAN_MEMBERS: 1 << 7,
  SEND_MESSAGES: 1 << 8,
  MANAGE_MESSAGES: 1 << 9,
  ADD_REACTIONS: 1 << 10,
  ATTACH_FILES: 1 << 11,
  CONNECT: 1 << 12,
  SPEAK: 1 << 13,
  STREAM: 1 << 14,
  MUTE_MEMBERS: 1 << 15,
  DEAFEN_MEMBERS: 1 << 16,
  MOVE_MEMBERS: 1 << 17,
  /** Change your own nickname in the space. */
  CHANGE_NICKNAME: 1 << 18,
  /** Change other members' nicknames (below you in the role hierarchy). */
  MANAGE_NICKNAMES: 1 << 19,
  /** Create space events (events.ts); editing/deleting one takes being its creator or MANAGE_SPACE. */
  CREATE_EVENTS: 1 << 20,
  /** Play space and built-in sounds in a voice channel of the space. */
  USE_SOUNDBOARD: 1 << 21,
  /** Upload, rename and delete the space's sounds. */
  MANAGE_SOUNDBOARD: 1 << 22,
} as const
export type PermissionName = keyof typeof Permission

export const ALL_PERMISSIONS = Object.values(Permission).reduce((a, b) => a | b, 0)

/** Default for the implicit @everyone role (role id == space id): the "Grupo de amigos" model, where anyone creates events. */
export const DEFAULT_EVERYONE_PERMISSIONS =
  Permission.VIEW_CHANNELS |
  Permission.CREATE_INVITES |
  Permission.SEND_MESSAGES |
  Permission.ADD_REACTIONS |
  Permission.ATTACH_FILES |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.STREAM |
  Permission.CHANGE_NICKNAME |
  Permission.CREATE_EVENTS |
  Permission.USE_SOUNDBOARD

export function hasPermission(granted: number, needed: number): boolean {
  if (granted & Permission.ADMINISTRATOR) return true
  return (granted & needed) === needed
}

/** Effective permissions = OR of all member roles (+ @everyone); owner gets everything. */
export function computePermissions(opts: {
  isOwner: boolean
  everyone: number
  roles: number[]
}): number {
  if (opts.isOwner) return ALL_PERMISSIONS
  const p = opts.roles.reduce((a, b) => a | b, opts.everyone)
  return p & Permission.ADMINISTRATOR ? ALL_PERMISSIONS : p
}
