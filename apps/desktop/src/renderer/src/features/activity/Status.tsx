import { CUSTOM_STATUS_MAX, type CustomStatus } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Button, Icon, Modal, SegmentedControl, TextField } from '@/ui'
import { Plus, Smile, X } from '@/ui/icons'
import { EmojiPicker } from '../chat/EmojiPicker'
import { ActivityLine } from './Activity'
import { setOwnStatus, useCustomStatus, useOwnStatus } from './custom'
import s from './activity.module.css'

const t = {
  placeholder: 'No que você está pensando?',
  setTitle: 'Definir status',
  edit: 'Editar status',
  emoji: 'Escolher emoji',
  clearAfter: 'Limpar depois de',
  save: 'Salvar',
  clear: 'Limpar status',
  remove: 'Remover status',
  until: (when: string) => `até ${when}`,
  durations: { '30m': '30 min', '1h': '1 h', '4h': '4 h', today: 'Hoje', never: 'Nunca' },
}

const PRESETS: Array<{ emoji: string; text: string; dur: Duration }> = [
  { emoji: '🎮', text: 'Bora jogar?', dur: '4h' },
  { emoji: '📚', text: 'Estudando', dur: '4h' },
  { emoji: '💻', text: 'Trabalhando', dur: 'today' },
  { emoji: '🎧', text: 'Ouvindo música', dur: '1h' },
  { emoji: '🍕', text: 'Comendo', dur: '30m' },
  { emoji: '💤', text: 'Dormindo', dur: 'today' },
]

type Duration = keyof typeof t.durations

function expiresAt(d: Duration, now = new Date()): number | undefined {
  if (d === 'never') return undefined
  if (d === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  return now.getTime() + { '30m': 30, '1h': 60, '4h': 240 }[d] * 60_000
}

const clock = (ms: number) => {
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString('pt-BR', sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

/** The status editor is one app-wide modal (opened from the profile bubble or the status menu). */
export const useStatusEditor = create<{ open: boolean }>()(() => ({ open: false }))
export const openStatusEditor = () => useStatusEditor.setState({ open: true })

/**
 * The thought bubble beside the avatar in a profile card (a child of ProfileCard: positioned against its body). On
 * your own card with nothing set it is an invitation ("No que você está pensando?") that opens the editor.
 */
export function StatusBubble({ userId, editable }: { userId: string; editable?: boolean }) {
  const status = useCustomStatus(userId)
  if (!status && !editable) return null
  const content = status ? (
    <>
      {status.emoji && <span className={s.bubbleEmoji}>{status.emoji}</span>}
      {status.text && <span className={s.bubbleText}>{status.text}</span>}
    </>
  ) : (
    <>
      <Icon icon={Plus} size={12} />
      <span className={`${s.bubbleText} ${s.bubbleHint}`}>{t.placeholder}</span>
    </>
  )
  return (
    <div className={s.bubbleSlot}>
      <motion.div
        key={status ? `${status.emoji}|${status.text}` : 'empty'}
        className={s.bubbleMotion}
        initial={{ opacity: 0, scale: 0.6, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 26, delay: 0.1 }}
      >
        {editable ? (
          <button type="button" className={`${s.bubble} ${s.bubbleButton}`} aria-label={status ? t.edit : t.setTitle} onClick={openStatusEditor}>
            {content}
          </button>
        ) : (
          <div className={s.bubble} title={status?.text}>
            {content}
          </div>
        )}
      </motion.div>
    </div>
  )
}

/** A person's line in lists: their custom status if they set one, else what they are doing, else `fallback`. */
export function PersonLine({ userId, fallback }: { userId: string; fallback?: ReactNode }) {
  const status = useCustomStatus(userId)
  if (!status) return <ActivityLine userId={userId} fallback={fallback} />
  return (
    <span className={s.line} title={status.text}>
      {status.emoji && <span className={s.lineEmoji}>{status.emoji}</span>}
      <span className={s.lineText}>{status.text}</span>
    </span>
  )
}

/** Mounted once (UserPanel). */
export function StatusEditorHost() {
  const open = useStatusEditor((st) => st.open)
  return open ? <StatusEditor onClose={() => useStatusEditor.setState({ open: false })} /> : null
}

function StatusEditor({ onClose }: { onClose: () => void }) {
  const current = useOwnStatus((st) => st.status)
  const [emoji, setEmoji] = useState<string | undefined>(current?.emoji)
  const [text, setText] = useState(current?.text ?? '')
  const [dur, setDur] = useState<Duration>('today')
  const [picker, setPicker] = useState<HTMLElement | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const empty = !text.trim() && !emoji

  const save = () => {
    if (empty) return
    const next: CustomStatus = { text: text.trim(), ...(emoji && { emoji }) }
    const exp = expiresAt(dur)
    setOwnStatus(exp ? { ...next, expiresAt: exp } : next)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t.setTitle}
      width={460}
      initialFocus={input}
      footer={
        <>
          {current && (
            <Button
              variant="ghost"
              onClick={() => {
                setOwnStatus(null)
                onClose()
              }}
            >
              {t.clear}
            </Button>
          )}
          <Button variant="primary" disabled={empty} onClick={save}>
            {t.save}
          </Button>
        </>
      }
    >
      <form
        className={s.editor}
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className={s.editorRow}>
          <button type="button" className={s.emojiButton} aria-label={t.emoji} aria-haspopup="dialog" onClick={(e) => setPicker(picker ? null : e.currentTarget)}>
            {emoji ? <span className={s.emojiBig}>{emoji}</span> : <Icon icon={Smile} size={20} />}
          </button>
          <div className={s.editorField}>
            <TextField
              ref={input}
              ariaLabel={t.placeholder}
              placeholder={t.placeholder}
              value={text}
              maxLength={CUSTOM_STATUS_MAX}
              onChange={(e) => setText(e.target.value)}
              trailing={
                text || emoji ? (
                  <button
                    type="button"
                    className={s.fieldClear}
                    aria-label={t.remove}
                    onClick={() => {
                      setText('')
                      setEmoji(undefined)
                      input.current?.focus()
                    }}
                  >
                    <Icon icon={X} size={14} />
                  </button>
                ) : undefined
              }
            />
          </div>
        </div>
        <span className={s.counter} aria-hidden>
          {CUSTOM_STATUS_MAX - text.length}
        </span>

        <div className={s.presets}>
          {PRESETS.map((p) => (
            <button
              key={p.text}
              type="button"
              className={s.preset}
              aria-pressed={emoji === p.emoji && text === p.text}
              onClick={() => {
                setEmoji(p.emoji)
                setText(p.text)
                setDur(p.dur)
              }}
            >
              <span>{p.emoji}</span>
              {p.text}
            </button>
          ))}
        </div>

        <div className={s.clearAfter}>
          <span className={s.clearAfterLabel}>{t.clearAfter}</span>
          <SegmentedControl<Duration>
            label={t.clearAfter}
            value={dur}
            onChange={setDur}
            items={(Object.keys(t.durations) as Duration[]).map((d) => ({ value: d, label: t.durations[d] }))}
          />
        </div>
        <AnimatePresence initial={false}>
          {dur !== 'never' && (
            <motion.p className={s.untilHint} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              {t.until(clock(expiresAt(dur)!))}
            </motion.p>
          )}
        </AnimatePresence>
      </form>
      <EmojiPicker
        anchor={picker}
        side="bottom"
        align="start"
        onClose={() => setPicker(null)}
        onPick={(e) => {
          setEmoji(e)
          setPicker(null)
          input.current?.focus()
        }}
      />
    </Modal>
  )
}
