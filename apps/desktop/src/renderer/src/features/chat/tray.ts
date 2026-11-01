import { create } from 'zustand'
import { checkFiles, localKind, type FileProblem } from '@/lib/files'
import type { OutgoingFile } from '@/store/actions'

/** A file waiting in the composer tray. Files with a `problem` are shown with the reason and never sent. */
export interface TrayItem extends OutgoingFile {
  id: string
  problem?: FileProblem
}

/** Pending attachments per channel (survive channel switches, like drafts). */
export const useTray = create<{ byChannel: Record<string, TrayItem[]> }>()(() => ({ byChannel: {} }))

let seq = 0
const set = (channelId: string, items: TrayItem[]) => useTray.setState((s) => ({ byChannel: { ...s.byChannel, [channelId]: items } }))
const get = (channelId: string) => useTray.getState().byChannel[channelId] ?? []

/** Adds picked, dropped or pasted files; checks size and count before anything is uploaded. */
export function addFiles(channelId: string, files: File[]): void {
  if (!files.length) return
  const cur = get(channelId)
  const checked = checkFiles(cur.filter((x) => !x.problem).length, files)
  const added: TrayItem[] = checked.map(({ file, problem }) => ({ id: `f${++seq}`, file, url: URL.createObjectURL(file), problem }))
  set(channelId, [...cur, ...added])
  // Image size up front: the optimistic message reserves the right box (no layout shift when it lands).
  for (const it of added) {
    if (it.problem || localKind(it.file.type) !== 'image') continue
    createImageBitmap(it.file).then(
      (bmp) => {
        set(channelId, get(channelId).map((x) => (x.id === it.id ? { ...x, width: bmp.width, height: bmp.height } : x)))
        bmp.close()
      },
      () => undefined,
    )
  }
}

export function removeFile(channelId: string, id: string): void {
  const cur = get(channelId)
  const it = cur.find((x) => x.id === id)
  if (it) URL.revokeObjectURL(it.url)
  set(channelId, cur.filter((x) => x.id !== id))
}

/** Empties the tray and hands the sendable files (and their preview URLs) to the caller. */
export function takeFiles(channelId: string): OutgoingFile[] {
  const cur = get(channelId)
  for (const x of cur) if (x.problem) URL.revokeObjectURL(x.url)
  set(channelId, [])
  return cur.filter((x) => !x.problem).map(({ file, url, width, height }) => ({ file, url, width, height }))
}

/** Clipboard images arrive as "image.png": give them a name that says what they are. */
export function namePasted(file: File, base: string): File {
  if (file.name && file.name !== 'image.png') return file
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  return new File([file], `${base}-${stamp}.${ext}`, { type: file.type })
}
