// My saved playlists, in the music card's second tab: covers made of their first songs, one click to play one in the
// call (or shuffled, or after what plays), and a page per playlist to rename it, remove songs, add the one playing.
import { youtubeListId, type MusicTrack, type SavedPlaylist } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { Icon, IconButton } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { BRAND_ECO } from '@/ui/eco/ecoRules'
import { ArrowLeft, ListPlus, Pencil, Play, Plus, Shuffle, Trash2, X } from '@/ui/icons'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { apiErrorText, createPlaylist, deletePlaylist, loadPlaylists, readYoutubeList, shuffled, updatePlaylist, usePlaylists } from './playlists'
import { addMany } from './store'
import { t } from './strings'
import s from './music.module.css'

const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`

/** A playlist's cover: its first four songs in a 2 × 2 (or the one, alone). Shimmers while it is being read. */
export function Mosaic({ ids, size, loading = false }: { ids: string[]; size: number; loading?: boolean }) {
  const four = ids.slice(0, 4)
  return (
    <span className={`${s.mosaic} ${loading ? s.shimmer : ''}`} style={{ width: size, height: size }} aria-hidden>
      {four.length >= 4
        ? four.map((id) => <img key={id} src={thumb(id)} alt="" loading="lazy" />)
        : four[0] && <img className={s.mosaicOne} src={thumb(four[0])} alt="" loading="lazy" />}
    </span>
  )
}

const play = (p: SavedPlaylist, mode: 'play' | 'shuffle' | 'queue') => {
  const ids = p.items.map((i) => i.videoId)
  addMany(mode === 'shuffle' ? shuffled(ids) : ids, mode !== 'queue', p.name)
}

export function Library({ now }: { now: MusicTrack | null }) {
  const list = usePlaylists((st) => st.list)
  const error = usePlaylists((st) => st.error)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    void loadPlaylists()
  }, [])
  const current = open ? list?.find((p) => p.id === open) ?? null : null
  return (
    <div className={`${s.library} ${s.panes}`}>
      <AnimatePresence mode="wait" initial={false}>
        {current ? (
          <motion.div key="detail" {...slide(1)}>
            <Detail p={current} now={now} back={() => setOpen(null)} />
          </motion.div>
        ) : (
          <motion.div key="list" {...slide(-1)}>
            <NewFromLink />
            {list === null ? (
              <div className={s.libSkeleton} aria-busy="true">
                {[0, 1, 2].map((i) => <span key={i} className={s.shimmer} />)}
              </div>
            ) : list.length === 0 ? (
              <div className={s.empty}>
                <span className="eco-alive" aria-hidden><Eco size={56} spec={{ ...BRAND_ECO, accessory: 'headset' }} state="listening" /></span>
                <p>{t.emptyLibrary}</p>
              </div>
            ) : (
              <ul className={s.playlists}>
                <AnimatePresence initial={false}>
                  {list.map((p, i) => (
                    <motion.li
                      key={p.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT_QUART, delay: Math.min(i, 10) * 0.03 } }}
                      exit={{ opacity: 0, x: -16, height: 0, transition: { duration: 0.18 } }}
                    >
                      <button type="button" className={s.plRow} onClick={() => setOpen(p.id)}>
                        <Mosaic ids={p.items.map((x) => x.videoId)} size={44} />
                        <span className={s.plText}>
                          <b>{p.name}</b>
                          <span>{t.songs(p.items.length)}</span>
                        </span>
                      </button>
                      <motion.button
                        type="button" className={s.plPlay} aria-label={`${t.play} ${p.name}`}
                        whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}
                        onClick={() => play(p, 'play')}
                      >
                        <Icon icon={Play} size={14} filled />
                      </motion.button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
            {error && <p className={s.error} role="alert">{error}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const slide = (dir: number) => ({
  initial: { opacity: 0, x: 22 * dir },
  animate: { opacity: 1, x: 0, transition: { duration: 0.26, ease: EASE_OUT_QUART } },
  exit: { opacity: 0, x: -14 * dir, transition: { duration: 0.14, ease: EASE_IN } },
})

/** Paste a YouTube playlist link here to keep it. */
function NewFromLink() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const go = async (value: string) => {
    const listId = youtubeListId(value)
    if (!listId) return setNote({ text: 'Esse link não é de uma playlist do YouTube.', bad: true })
    setBusy(true)
    setNote({ text: t.reading, bad: false })
    try {
      const ids = await readYoutubeList(listId)
      const p = await createPlaylist({ videoIds: ids, listId })
      setText('')
      setNote({ text: t.saved(p.name), bad: false })
      setTimeout(() => setNote(null), 2400)
    } catch (e) {
      setNote({ text: e instanceof Error && !('status' in e) ? e.message : apiErrorText(e), bad: true })
    } finally {
      setBusy(false)
    }
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void go(text)
  }
  return (
    <div className={s.field}>
      <div className={s.inputWrap}>
        <Icon icon={Plus} size={14} />
        <input
          className={s.input} value={text} disabled={busy} maxLength={2048} placeholder={t.newFromLink} aria-label={t.newFromLink}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          onPaste={(e) => {
            const v = e.clipboardData.getData('text')
            if (!text && youtubeListId(v)) {
              e.preventDefault()
              setText(v)
              void go(v)
            }
          }}
        />
      </div>
      {note && <p className={note.bad ? s.error : s.note} role={note.bad ? 'alert' : 'status'}>{note.text}</p>}
    </div>
  )
}

function Detail({ p, now, back }: { p: SavedPlaylist; now: MusicTrack | null; back: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(p.name)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = p.items.map((i) => i.videoId)
  const save = async (patch: { name?: string; videoIds?: string[] }) => {
    setError(null)
    try {
      await updatePlaylist(p.id, patch)
    } catch (e) {
      setError(apiErrorText(e))
    }
  }
  const rename = () => {
    setRenaming(false)
    if (name.trim() && name.trim() !== p.name) void save({ name: name.trim() })
    else setName(p.name)
  }
  const hasNow = !!now && ids.includes(now.videoId)
  return (
    <div className={s.detail}>
      <div className={s.detailHead}>
        <IconButton icon={ArrowLeft} label={t.back} size="sm" onClick={back} />
        <Mosaic ids={ids} size={72} />
        <div className={s.detailText}>
          {renaming ? (
            <input
              className={s.inlineInput} autoFocus value={name} maxLength={80} aria-label={t.rename}
              onChange={(e) => setName(e.target.value)} onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename()
                if (e.key === 'Escape') (setName(p.name), setRenaming(false))
              }}
            />
          ) : (
            <button type="button" className={s.detailName} onClick={() => setRenaming(true)} title={t.rename}>
              {p.name} <Icon icon={Pencil} size={12} />
            </button>
          )}
          <span>{t.songs(p.items.length)}</span>
        </div>
      </div>
      <div className={s.detailActions}>
        <motion.button type="button" className={s.pill} whileTap={{ scale: 0.95 }} onClick={() => play(p, 'play')}><Icon icon={Play} size={14} filled /> {t.play}</motion.button>
        <motion.button type="button" className={s.ghost} whileTap={{ scale: 0.95 }} onClick={() => play(p, 'shuffle')}><Icon icon={Shuffle} size={14} /> {t.shuffle}</motion.button>
        <motion.button type="button" className={s.ghost} whileTap={{ scale: 0.95 }} onClick={() => play(p, 'queue')}><Icon icon={ListPlus} size={14} /> {t.addToQueue}</motion.button>
        <span className={s.grow} />
        {confirm ? (
          <span className={s.confirm}>
            <button type="button" className={s.danger} onClick={() => (void deletePlaylist(p.id), back())}>{t.delete}</button>
            <IconButton icon={X} label={t.cancel} size="sm" onClick={() => setConfirm(false)} />
          </span>
        ) : (
          <IconButton icon={Trash2} label={t.deleteConfirm(p.name)} size="sm" onClick={() => setConfirm(true)} />
        )}
      </div>
      {now && !hasNow && (
        <button type="button" className={s.addNow} onClick={() => void save({ videoIds: [...ids, now.videoId] })}>
          <Icon icon={Plus} size={14} /> {t.addCurrent}: <b>{now.title}</b>
        </button>
      )}
      <ol className={s.songs}>
        <AnimatePresence initial={false}>
          {p.items.map((it, i) => (
            <motion.li key={it.videoId} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}>
              <span className={s.num}>{i + 1}</span>
              <img className={s.thumb} src={`https://i.ytimg.com/vi/${it.videoId}/default.jpg`} alt="" loading="lazy" />
              <span className={s.songText}>
                <span className={s.qtitle} title={it.title}>{it.title}</span>
                {it.author && <span className={s.songAuthor}>{it.author}</span>}
              </span>
              {p.items.length > 1 && (
                <IconButton icon={X} label={t.removeSong(it.title)} size="sm" onClick={() => void save({ videoIds: ids.filter((v) => v !== it.videoId) })} />
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {error && <p className={s.error} role="alert">{error}</p>}
    </div>
  )
}
