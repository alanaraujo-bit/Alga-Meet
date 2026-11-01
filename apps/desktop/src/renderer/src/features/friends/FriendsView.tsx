import type { Relationship } from '@alga/shared'
import { Ban, Check, Copy, MessageCircle, MoreHorizontal, Search, UserMinus, UserPlus, Users, X, type LucideIcon } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiRequestError } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { errorText } from '@/lib/errors'
import { fold } from '@/lib/fuzzy'
import { openDm, removeRelationship, sendFriendRequest, setRelationship } from '@/store/actions'
import { useData } from '@/store/data'
import { presenceOf } from '@/store/selectors'
import { useUi, type FriendsTab } from '@/store/ui'
import { Avatar, Button, contextMenuHandler, EmptyState, Icon, IconButton, MenuButton, PRESENCE_LABEL, ScrollArea, Tabs, TextField, toast, type MenuEntry } from '@/ui'
import { finishOnboarding } from '../onboarding/Onboarding'
import sh from '../shell/shell.module.css'
import { t } from './strings'
import s from './friends.module.css'

export function FriendsView() {
  const tab = useUi((st) => st.friendsTab)
  const relationships = useData((st) => st.relationships)
  const pending = useMemo(() => Object.values(relationships).filter((r) => r.type === 'incoming').length, [relationships])
  return (
    <div className={sh.mainCol}>
      <header className={sh.header}>
        <h1 className={sh.headerTitle}>
          <Icon icon={Users} size={18} />
          {t.title}
        </h1>
        <span className={sh.headerSep} />
        <Tabs<FriendsTab>
          label={t.title}
          value={tab}
          onChange={(v) => useUi.getState().setFriendsTab(v)}
          items={[
            { value: 'online', label: t.tabs.online },
            { value: 'all', label: t.tabs.all },
            { value: 'pending', label: t.tabs.pending, badge: pending },
            { value: 'blocked', label: t.tabs.blocked },
            { value: 'add', label: t.tabs.add, accent: true },
          ]}
        />
      </header>
      {tab === 'add' ? <AddFriend /> : <FriendList key={tab} tab={tab} />}
    </div>
  )
}

function FriendList({ tab }: { tab: Exclude<FriendsTab, 'add'> }) {
  const relationships = useData((st) => st.relationships)
  const presences = useData((st) => st.presences)
  const me = useData((st) => st.me)
  const [q, setQ] = useState('')
  const all = useMemo(() => {
    const list = Object.values(relationships).filter((r) =>
      tab === 'online' ? r.type === 'friend' && presenceOf({ presences, me }, r.user.id) !== 'offline'
      : tab === 'all' ? r.type === 'friend'
      : tab === 'pending' ? r.type === 'incoming' || r.type === 'outgoing'
      : r.type === 'blocked',
    )
    // Incoming requests first (they need you), then by name.
    return list.sort((a, b) => (a.type === 'incoming' ? -1 : 0) - (b.type === 'incoming' ? -1 : 0) || a.user.displayName.localeCompare(b.user.displayName, 'pt-BR'))
  }, [relationships, presences, me, tab])
  const shown = q ? all.filter((r) => fold(`${r.user.displayName} ${r.user.username}`).includes(fold(q))) : all

  if (all.length === 0) {
    const e = t.empty[tab]
    return (
      <EmptyState
        icon={tab === 'blocked' ? Ban : Users}
        title={e.title}
        actions={
          tab !== 'blocked' && (
            <Button variant="primary" icon={UserPlus} onClick={() => useUi.getState().setFriendsTab('add')}>
              {t.tabs.add}
            </Button>
          )
        }
      >
        {e.body}
      </EmptyState>
    )
  }
  return (
    <div className={s.body}>
      <div className={s.searchRow}>
        <TextField size="sm" ariaLabel={t.search} placeholder={t.search} leadingIcon={Search} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className={s.countLabel}>{t.count[tab](shown.length)}</div>
      <ScrollArea className={s.list} role="list">
        {shown.length === 0 ? <p className={s.noMatch}>{t.empty.search}</p> : shown.map((r) => <FriendRow key={r.user.id} rel={r} />)}
      </ScrollArea>
    </div>
  )
}

async function run(p: Promise<unknown>, done?: string) {
  try {
    await p
    if (done) toast.success(done)
  } catch (e) {
    toast.error(errorText(e, t.error))
  }
}

async function message(userId: string) {
  try {
    const ch = await openDm([userId])
    useUi.getState().go({ kind: 'dm', channelId: ch.id })
  } catch (e) {
    toast.error(errorText(e, t.error))
  }
}

function friendMenu(rel: Relationship): MenuEntry[] {
  const u = rel.user
  const copy: MenuEntry = { label: t.actions.copyUsername, icon: Copy, onSelect: () => void copyText(u.username) }
  switch (rel.type) {
    case 'friend':
      return [
        { label: t.actions.message, icon: MessageCircle, onSelect: () => void message(u.id) },
        copy,
        { kind: 'separator' },
        { label: t.actions.remove, icon: UserMinus, danger: true, onSelect: () => void run(removeRelationship(u.id), t.done.removed(u.displayName)) },
        { label: t.actions.block, icon: Ban, danger: true, onSelect: () => void run(setRelationship(u.id, 'blocked'), t.done.blocked(u.displayName)) },
      ]
    case 'incoming':
      return [
        { label: t.actions.accept, icon: Check, onSelect: () => void run(setRelationship(u.id, 'friend'), t.done.accepted(u.displayName)) },
        { label: t.actions.decline, icon: X, onSelect: () => void run(removeRelationship(u.id)) },
        copy,
        { kind: 'separator' },
        { label: t.actions.block, icon: Ban, danger: true, onSelect: () => void run(setRelationship(u.id, 'blocked'), t.done.blocked(u.displayName)) },
      ]
    case 'outgoing':
      return [{ label: t.actions.cancel, icon: X, onSelect: () => void run(removeRelationship(u.id)) }, copy]
    case 'blocked':
      return [{ label: t.actions.unblock, icon: Ban, onSelect: () => void run(removeRelationship(u.id), t.done.unblocked(u.displayName)) }]
  }
}

function FriendRow({ rel }: { rel: Relationship }) {
  const presence = useData((st) => presenceOf(st, rel.user.id))
  const u = rel.user
  const sub =
    rel.type === 'incoming' ? t.incoming
    : rel.type === 'outgoing' ? t.outgoing
    : rel.type === 'blocked' ? t.blockedLabel
    : PRESENCE_LABEL[presence]
  const quick: Array<{ icon: LucideIcon; label: string; run: () => void; danger?: boolean }> =
    rel.type === 'friend' ? [{ icon: MessageCircle, label: t.actions.message, run: () => void message(u.id) }]
    : rel.type === 'incoming'
      ? [
          { icon: Check, label: t.actions.accept, run: () => void run(setRelationship(u.id, 'friend'), t.done.accepted(u.displayName)) },
          { icon: X, label: t.actions.decline, run: () => void run(removeRelationship(u.id)), danger: true },
        ]
    : rel.type === 'outgoing' ? [{ icon: X, label: t.actions.cancel, run: () => void run(removeRelationship(u.id)), danger: true }]
    : [{ icon: Ban, label: t.actions.unblock, run: () => void run(removeRelationship(u.id), t.done.unblocked(u.displayName)) }]

  return (
    <div
      role="listitem"
      className={s.row}
      tabIndex={0}
      onContextMenu={contextMenuHandler(() => friendMenu(rel), u.displayName)}
      onDoubleClick={() => rel.type === 'friend' && void message(u.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && rel.type === 'friend' && e.target === e.currentTarget) void message(u.id)
      }}
    >
      <Avatar user={u} size={32} presence={rel.type === 'friend' ? presence : undefined} decorative />
      <div className={s.who}>
        <span className={s.name}>
          {u.displayName}
          <span className={s.username}>@{u.username}</span>
        </span>
        <span className={`${s.sub} ${rel.type === 'incoming' ? s.subAccent : ''}`}>{sub}</span>
      </div>
      <div className={s.actions}>
        {quick.map((a) => (
          <IconButton key={a.label} icon={a.icon} label={a.label} size="lg" className={`${s.action} ${a.danger ? s.actionDanger : ''}`} onClick={a.run} />
        ))}
        <MenuButton items={() => friendMenu(rel)} align="end" label={u.displayName}>
          <IconButton icon={MoreHorizontal} label={t.actions.more} size="lg" className={s.action} />
        </MenuButton>
      </div>
    </div>
  )
}

function AddFriend() {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const me = useData((st) => st.me)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const username = value.trim().replace(/^@/, '').toLowerCase()
    if (!username) return
    if (!/^[a-z0-9_.]{2,32}$/.test(username)) return setResult({ ok: false, text: t.add.invalid })
    if (username === me?.username) return setResult({ ok: false, text: t.add.self })
    setBusy(true)
    setResult(null)
    try {
      const rel = await sendFriendRequest(username)
      setResult({ ok: true, text: rel.type === 'friend' ? t.add.accepted(username) : t.add.sent(username) })
      setValue('')
      finishOnboarding()
    } catch (err) {
      // Format is checked above, so a validation error here is the server's own pt-BR reason ("não encontrado").
      const code = err instanceof ApiRequestError ? err.code : null
      const field = err instanceof ApiRequestError ? err.fields?.username : undefined
      setResult({
        ok: false,
        text: code === 'not_found' ? t.add.notFound : code === 'conflict' ? t.add.already : field ? (/encontrad/i.test(field) ? t.add.notFound : field) : errorText(err, t.error),
      })
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  return (
    <div className={s.body}>
      <section className={s.add}>
        <h2 className={s.addTitle}>{t.add.title}</h2>
        <p className={s.addBody}>{t.add.body}</p>
        <form onSubmit={submit} className={s.addForm}>
          <TextField
            ref={input}
            ariaLabel={t.add.title}
            placeholder={t.add.placeholder}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            maxLength={33}
            value={value}
            error={result && !result.ok ? result.text : null}
            hint={result?.ok ? <span className={s.success}>{result.text}</span> : undefined}
            onChange={(e) => {
              setValue(e.target.value)
              if (result && !result.ok) setResult(null)
            }}
            trailing={
              <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!value.trim()}>
                {t.add.submit}
              </Button>
            }
          />
        </form>
        <p className={s.tip}>{t.add.tip}</p>
      </section>
    </div>
  )
}
