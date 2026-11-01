type Listed = Pick<MediaDeviceInfo, 'deviceId' | 'groupId' | 'kind' | 'label'>

/**
 * The device Windows uses right now for "system default". Chromium lists it twice: as the `default` alias, labelled
 * "Default - Microfone (Realtek…)", and under its own id (same group). Null when labels are not readable yet.
 */
export function defaultDeviceName(list: readonly Listed[], kind: 'audioinput' | 'audiooutput'): string | null {
  const alias = list.find((d) => d.kind === kind && d.deviceId === 'default')
  if (!alias?.label) return null
  const stripped = alias.label.replace(/^(default|padrão)\s+-\s+/i, '')
  if (stripped !== alias.label) return stripped
  const twin = list.find((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.groupId === alias.groupId && d.label)
  return twin?.label ?? alias.label
}
