import { useEffect, useMemo, useState } from 'react'
import { ago } from '@/lib/format'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { Button, Switch, toast } from '@/ui'
import { Group, Row } from '../settings/Frame'
import { ActivityCard, ActivityIcon } from './Activity'
import { pauseSharing, useMyActivity } from './store'
import { t } from './strings'
import s from './activity.module.css'

type DetectedApp = Awaited<ReturnType<Window['alga']['activity']['apps']>>[number]

/** Settings → Atividade: one switch, who can see it, a live preview, and every app this PC has seen with its own switch. */
export function ActivitySettings() {
  const bridge = window.alga?.activity
  const me = useData((st) => st.me)
  const detected = useMyActivity((st) => st.detected)
  const paused = useMyActivity((st) => st.pausedUntil > 0)
  const [share, setShare] = useState<boolean | null>(null)
  const [apps, setApps] = useState<DetectedApp[]>([])
  const audience = useAudienceSize()

  useEffect(() => {
    if (!bridge) return
    void bridge.getShare().then(setShare)
    void bridge.apps().then(setApps)
  }, [bridge, detected])
  // New apps join the list as they come to the foreground (hidden ones change nothing else): keep it fresh while open.
  useEffect(() => {
    if (!bridge || !share) return
    const id = setInterval(() => void bridge.apps().then(setApps), 3000)
    return () => clearInterval(id)
  }, [bridge, share])

  if (!bridge || !me) return <Group description={t.settings.unavailable}>{null}</Group>

  const toggleShare = (v: boolean) =>
    void bridge.setShare(v).then(
      () => {
        setShare(v)
        void bridge.apps().then(setApps)
      },
      (e: unknown) => toast.error(errorText(e)),
    )
  const toggleApp = (key: string, shown: boolean) => {
    setApps((list) => list.map((a) => (a.key === key ? { ...a, shown } : a)))
    void bridge.setAppShown(key, shown).catch((e: unknown) => {
      toast.error(errorText(e))
      void bridge.apps().then(setApps)
    })
  }

  return (
    <>
      <Group description={t.settings.intro}>
        <Row label={t.settings.share} hint={me.statusPreference === 'invisible' ? t.settings.invisible : share ? t.settings.audience(audience) : t.settings.shareHint}>
          <Switch checked={!!share} disabled={share === null} label={t.settings.share} onChange={toggleShare} />
        </Row>
      </Group>

      {share && (
        <Group title={t.settings.preview}>
          <div className={s.preview}>
            {paused ? (
              <div className={s.paused}>
                <span>{t.settings.paused}</span>
                <Button size="sm" variant="ghost" onClick={() => pauseSharing(null)}>
                  {t.own.resume}
                </Button>
              </div>
            ) : detected ? (
              <ActivityCard userId={me.id} />
            ) : (
              <p className={s.previewNone}>{t.settings.previewNone}</p>
            )}
          </div>
        </Group>
      )}

      {share && (
        <Group title={t.settings.apps} description={t.settings.appsHint}>
          {apps.length === 0 ? (
            <p className={s.previewNone}>{t.settings.appsEmpty}</p>
          ) : (
            <ul className={s.apps}>
              {apps.map((a) => (
                <li key={a.key} className={s.app} data-off={!a.shown || undefined}>
                  <ActivityIcon activity={{ kind: a.kind ?? 'app', name: a.name, startedAt: 0, icon: a.icon }} size={32} />
                  <span className={s.text}>
                    <span className={s.appName}>{a.name}</span>
                    <span className={s.appMeta}>
                      {a.kind ? t.settings.kinds[a.kind] : t.settings.unknown} · {t.settings.lastSeen(ago(new Date(a.lastSeen).toISOString()))}
                    </span>
                  </span>
                  <Switch checked={a.shown} label={t.settings.show(a.name)} onChange={(v) => toggleApp(a.key, v)} />
                </li>
              ))}
            </ul>
          )}
        </Group>
      )}
    </>
  )
}

/** Friends + everyone in your spaces, once each: the people who see your activity. */
function useAudienceSize(): number {
  const me = useData((st) => st.me?.id)
  const relationships = useData((st) => st.relationships)
  const members = useData((st) => st.members)
  return useMemo(() => {
    const ids = new Set<string>()
    for (const r of Object.values(relationships)) if (r.type === 'friend') ids.add(r.user.id)
    for (const space of Object.values(members)) for (const id of Object.keys(space)) ids.add(id)
    if (me) ids.delete(me)
    return ids.size
  }, [me, relationships, members])
}
