/** Clipboard write with a fallback for contexts where the async API is unavailable. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

/** Open http(s) links in the OS browser (bridge when available, window.open is routed by the main process). */
export function openExternal(url: string): void {
  if (window.alga?.app?.openExternal) void window.alga.app.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}
