import type { Channel } from '@alga/shared'
import { Lock, LockOpen, ShieldAlert } from '@/ui/icons'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Avatar, Button, Icon, Modal, Spinner, Tooltip } from '@/ui'
import { t } from './strings'
import { leaveVoice, useVoice } from './voice'
import s from './e2ee.module.css'

/*
 * E2EE UI, phase 1b (docs/decisions/0004-e2ee.md §3.8–3.9; media/README.md §E2EE). The engine does the cryptography
 * and fails closed on its own; this file only says what is true: a lock while the call is end-to-end encrypted, the
 * verification codes to read out loud, the red band when someone in the room is not in the encrypted group, and the
 * refusal of a DM call the server offered without E2EE (voice.ts).
 */

const NONE: string[] = []

/** The E2EE state of `channelId` when it is the call you are in (null otherwise). */
function useCallE2ee(channelId: string) {
  return useMedia(
    useShallow((m) => {
      const here = m.connection.channelId === channelId && (m.connection.state === 'connecting' || m.connection.state === 'connected' || m.connection.state === 'reconnecting')
      return here ? { state: m.e2ee.state, mismatch: m.e2ee.mismatch.length > 0 } : null
    }),
  )
}

/**
 * The call's lock, in the stage header (space voice channel) or at the top of a DM stage. Active: lock + "Criptografia
 * de ponta a ponta", which opens the codes. Off: a quiet line, only where it matters (`showOff`: a space voice room).
 */
export function E2eeChip({ channelId, showOff }: { channelId: string; showOff?: boolean }) {
  const e = useCallE2ee(channelId)
  if (!e) return null
  if (e.state === 'active')
    return (
      <Tooltip content={t.e2ee.activeHint} side="bottom">
        <button type="button" className={`${s.chip} ${e.mismatch ? s.chipDanger : ''}`} onClick={() => useVoice.setState({ verify: true })} aria-haspopup="dialog">
          <Icon icon={e.mismatch ? ShieldAlert : Lock} size={14} />
          <span>{t.e2ee.active}</span>
        </button>
      </Tooltip>
    )
  if (e.state === 'establishing')
    return (
      <span className={s.quiet} role="status">
        <Spinner size={12} />
        {t.e2ee.establishing}
      </span>
    )
  if (e.state === 'off' && showOff)
    return (
      <Tooltip content={t.e2ee.offHint} side="bottom">
        <span className={s.quiet} tabIndex={0}>
          <Icon icon={LockOpen} size={14} />
          {t.e2ee.off}
        </span>
      </Tooltip>
    )
  return null
}

/** The lock next to "Voz conectada" in the voice panel: present, never loud (red only when someone is unverified). */
export function E2eePanelMark() {
  const e = useMedia(useShallow((m) => ({ state: m.e2ee.state, mismatch: m.e2ee.mismatch.length > 0 })))
  if (e.state !== 'active') return null
  const label = e.mismatch ? t.e2ee.mismatchShort : t.e2ee.active
  return (
    <Tooltip content={label}>
      <span className={e.mismatch ? s.markDanger : s.mark} role="img" aria-label={label}>
        <Icon icon={e.mismatch ? ShieldAlert : Lock} size={12} />
      </span>
    </Tooltip>
  )
}

/**
 * Someone in the SFU room is not in the MLS group (or a leaf has no participant): the red band of 0004 §3.8, at the
 * top of the stage, with the way out. The engine never plays what they send, but you should know they are there.
 */
export function MismatchBanner({ channel }: { channel: Channel }) {
  const ids = useMedia(useShallow((m) => (m.connection.channelId === channel.id && m.e2ee.state === 'active' ? m.e2ee.mismatch : NONE)))
  const names = useData(useShallow((st) => ids.map((id) => (st.users[id] ? displayName(st, id, channel.spaceId) : t.e2ee.mismatchGhost))))
  if (!ids.length) return null
  return (
    <div className={s.banner} role="alert">
      <Icon icon={ShieldAlert} size={16} />
      <div className={s.bannerText}>
        <strong>{t.e2ee.mismatch(new Intl.ListFormat('pt-BR').format(names))}</strong>
        <span>{t.e2ee.mismatchBody}</span>
      </div>
      <Button size="sm" variant="ghost" onClick={() => useVoice.setState({ verify: true })}>
        {t.e2ee.details}
      </Button>
      <Button size="sm" variant="danger" onClick={leaveVoice}>
        {t.e2ee.leave}
      </Button>
    </div>
  )
}

const groups = (code: string) => code.replace(/\D/g, '').match(/.{1,5}/g) ?? []

/** Fetches a verification code from main; refetches when `key` changes (the call code changes with every epoch). */
function useCode(channelId: string | null, userId: string | undefined, key: number | null, on: boolean): string | null | undefined {
  const [code, setCode] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!channelId || !on) return
    let live = true
    setCode(undefined)
    const api = window.alga?.e2ee
    if (!api) return setCode(null)
    void api.verificationCode(channelId, userId).then(
      (c) => live && setCode(c),
      () => live && setCode(null),
    )
    return () => {
      live = false
    }
  }, [channelId, userId, key, on])
  return code
}

function Code({ code, small }: { code: string | null | undefined; small?: boolean }) {
  if (code === undefined)
    return (
      <span className={s.codeWait}>
        <Spinner size={12} />
        {t.e2ee.loading}
      </span>
    )
  if (!code) return <span className={s.codeWait}>{t.e2ee.unavailable}</span>
  return (
    <span className={`${s.code} ${small ? s.codeSmall : ''} tnum`} aria-label={groups(code).join(' ')}>
      {groups(code).map((g, i) => (
        <span key={i}>{g}</span>
      ))}
    </span>
  )
}

/** "Verificar a criptografia": the call code (30 digits, 6 × 5) and, per person, the pairwise code (45 digits, 9 × 5). */
export function VerifySheet() {
  const open = useVoice((v) => v.verify)
  const call = useMedia(useShallow((m) => ({ channelId: m.e2ee.state === 'active' ? m.connection.channelId : null, epoch: m.e2ee.epoch })))
  const members = useMedia((m) => m.e2ee.members)
  const others = useMemo(() => [...new Set(members.filter((x) => !x.self).map((x) => x.userId))], [members])
  const [ephemeral, setEphemeral] = useState(false)
  const show = open && !!call.channelId
  useEffect(() => {
    if (!show) return
    void window.alga?.e2ee?.status().then((st) => setEphemeral(st.persistent === false), () => undefined)
  }, [show])
  // The call ended (or E2EE did) while the sheet was open: it closes with it.
  useEffect(() => {
    if (open && !call.channelId) useVoice.setState({ verify: false })
  }, [open, call.channelId])
  const code = useCode(call.channelId, undefined, call.epoch, show)
  const close = () => useVoice.setState({ verify: false })
  return (
    <Modal open={show} onClose={close} title={t.e2ee.sheetTitle} description={t.e2ee.sheetLead} width={480}>
      <section className={s.block} aria-label={t.e2ee.callCode}>
        <div className={s.blockHead}>
          <span className={s.blockTitle}>
            <Icon icon={Lock} size={14} />
            {t.e2ee.callCode}
          </span>
          {call.epoch !== null && <span className={`${s.epoch} tnum`}>{t.e2ee.epoch(call.epoch)}</span>}
        </div>
        <Code code={code} />
        <p className={s.note}>{t.e2ee.callCodeHint}</p>
      </section>
      {others.length > 0 && (
        <section className={s.block} aria-label={t.e2ee.people}>
          <div className={s.blockHead}>
            <span className={s.blockTitle}>{t.e2ee.people}</span>
          </div>
          <p className={s.note}>{t.e2ee.peopleHint}</p>
          <ul className={s.people}>
            {others.map((id) => (
              <PairRow key={id} userId={id} channelId={call.channelId!} />
            ))}
          </ul>
        </section>
      )}
      {ephemeral && <p className={s.warn}>{t.e2ee.ephemeral}</p>}
      <p className={s.covers}>{t.e2ee.covers}</p>
    </Modal>
  )
}

function PairRow({ userId, channelId }: { userId: string; channelId: string }) {
  const user = useData((st) => st.users[userId])
  const spaceId = useData((st) => st.channels[channelId]?.spaceId ?? null)
  const name = useData((st) => displayName(st, userId, spaceId))
  const [open, setOpen] = useState(false)
  // The pairwise code is stable across epochs (same two devices): fetched once per opening.
  const code = useCode(channelId, userId, null, open)
  return (
    <li className={s.person}>
      <div className={s.personRow}>
        {user && <Avatar user={user} size={24} decorative />}
        <span className={s.personName}>{name}</span>
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t.e2ee.hideCode : t.e2ee.showCode}
        </Button>
      </div>
      {open && (
        <div aria-label={t.e2ee.pairCode(name)}>
          <Code code={code} small />
        </div>
      )}
    </li>
  )
}

/** A DM call the server offered without E2EE was refused (voice.ts): say so, plainly, once. */
export function UnsafeCallDialog() {
  const unsafe = useVoice((v) => v.unsafe)
  const close = () => useVoice.setState({ unsafe: null })
  return (
    <Modal
      open={!!unsafe}
      onClose={close}
      title={
        <span className={s.unsafeTitle}>
          <Icon icon={ShieldAlert} size={18} />
          {t.e2ee.unsafeTitle}
        </span>
      }
      width={420}
      footer={
        <Button variant="primary" onClick={close}>
          {t.e2ee.unsafeOk}
        </Button>
      }
    >
      <p className={s.unsafeBody}>{t.e2ee.unsafeBody}</p>
      <p className={s.note} style={{ marginTop: 8 }}>
        {t.e2ee.unsafeHint}
      </p>
    </Modal>
  )
}
