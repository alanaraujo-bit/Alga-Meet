import { Permission, SPACE_TONES, type Product, type SpaceTone, type SpaceUpgrade, type SpaceUpgradePerk } from '@alga/shared'
import { CircleCheck } from '@/ui/icons'
import { useEffect, useState } from 'react'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { can, spacePermissions } from '@/store/selectors'
import { Avatar, Button, Icon, Modal, Spinner, TextField, toast } from '@/ui'
import { needsVerification, openVerifyEmail } from '../../auth/VerifyEmail'
import { Fine } from '../../billing/Fine'
import { House } from '../../billing/icons'
import { daysUntil, money } from '../../billing/look'
import { Waiting } from '../../billing/Plan'
import { closeCasa, day, loadSpaceUpgrade, patchSpaceUpgrade, startContribution, useBilling } from '../../billing/store'
import { t } from '../../billing/strings'
import { TeenPurchaseNotice, useIsTeen } from '../../trust/Privacy'
import s from './casa.module.css'

/*
 * Casa (growth-plan §2.3): the group's purchase. Any member 18+ adds days (R$ 5 = +7 …); no renewal, no tiers, no
 * "faltam 3". The Mural lists who chose to appear, alphabetically, without amounts. The end is told from endsAt
 * (5 days before, and after), never a countdown. Cinema shows as "em breve" while the server keeps it off.
 */

/** The tones' paint (growth-plan §3.2 palette), never the "you are here" indigo. */
export const TONE: Record<SpaceTone, string> = {
  deep: '#24255a',
  lilac: '#b9b2f9',
  porcelain: '#f7f8f8',
  silver: '#c9ccd6',
  graphite: '#2a2b30',
  ember: '#e8a898',
}
const PERKS: SpaceUpgradePerk[] = ['animated_banner', 'animated_icon', 'tone', 'vanity_invite', 'event_cover', 'monthly_recap', 'badge', 'cinema']
const NOTICE_DAYS = 5

export function CasaDialog({ spaceId }: { spaceId: string }) {
  const space = useData((x) => x.spaces[spaceId])
  const catalog = useBilling((x) => x.catalog)
  const [data, setData] = useState<SpaceUpgrade | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Reload when the Casa changes (a payment, a refund, the end): SPACE_UPGRADE_UPDATE patches Space.upgrade.
  const upgrade = space?.upgrade
  useEffect(() => {
    let live = true
    loadSpaceUpgrade(spaceId).then((d) => live && setData(d), (e) => live && setError(errorText(e, t.casa.loadError)))
    return () => void (live = false)
  }, [spaceId, upgrade?.endsAt, upgrade?.active, upgrade?.tone, upgrade?.inviteCode])
  if (!space) return null
  return (
    <Modal open onClose={closeCasa} title={`${t.casa.title} · ${space.name}`} width={640}>
      {!data || !catalog ? (
        error ? <p className={s.error}>{error}</p> : <Spinner size={16} label="Carregando" />
      ) : (
        <Casa spaceId={spaceId} name={space.name} iconUrl={space.iconUrl} data={data} products={catalog.products.filter((p) => p.kind === 'space_upgrade' && p.purchasable)} perks={catalog.spaceUpgrade?.perks ?? data.perks} sandbox={!!catalog.provider?.sandbox} enabled={!!catalog.provider} onSaved={setData} />
      )}
    </Modal>
  )
}

function Casa({ spaceId, name, iconUrl, data, products, perks, sandbox, enabled, onSaved }: { spaceId: string; name: string; iconUrl: string | null; data: SpaceUpgrade; products: Product[]; perks: SpaceUpgradePerk[]; sandbox: boolean; enabled: boolean; onSaved: (d: SpaceUpgrade) => void }) {
  const up = data.upgrade
  const lit = !!up?.active
  const left = up ? daysUntil(up.endsAt) : 0
  const manage = useData((x) => can(spacePermissions(x, spaceId), Permission.MANAGE_SPACE))
  return (
    <div className={s.casa}>
      <div className={s.banner} data-lit={lit || undefined} style={up?.tone ? { ['--tone' as string]: TONE[up.tone] } : undefined}>
        <span className={s.windows} aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} style={{ ['--i' as string]: i }} />
          ))}
        </span>
        <span className={s.bannerSpace}>
          {iconUrl ? <img src={iconUrl} alt="" className={s.spaceIcon} /> : <span className={s.spaceIcon}>{name.slice(0, 1).toUpperCase()}</span>}
          <span className={s.bannerText}>
            <span className={s.spaceName}>
              {name}
              {lit && (
                <span className={s.casaBadge}>
                  <Icon icon={House} size={12} filled />
                  Casa
                </span>
              )}
            </span>
            <span className={s.state}>{lit ? t.casa.lit(day(up!.endsAt)) : up ? t.casa.off : t.casa.never}</span>
          </span>
        </span>
      </div>
      {lit && left <= NOTICE_DAYS && <p className={s.notice}>{t.casa.notice(day(up!.endsAt))}</p>}
      {up && !lit && <p className={s.notice}>{t.casa.ended(day(up.endsAt))}</p>}
      <p className={s.what}>{t.casa.what}</p>

      <section aria-label={t.casa.perks}>
        <h4 className={s.label}>{t.casa.perks}</h4>
        <ul className={s.perks}>
          {PERKS.map((k) => {
            const on = perks.includes(k)
            const [title, line] = t.casa.perk[k] ?? [k, '']
            // Cinema lists only when the server turns it on (CASA_CINEMA); until then it is honest about it.
            return (
              <li key={k} className={s.perk} data-soon={!on || undefined}>
                <span className={s.perkTitle}>
                  {title}
                  {!on && <span className={s.soon}>{t.casa.soon}</span>}
                </span>
                <span className={s.perkLine}>{line}</span>
              </li>
            )
          })}
        </ul>
        <p className={s.never}>{t.casa.never2}</p>
      </section>

      <Contribute spaceId={spaceId} products={products} sandbox={sandbox} enabled={enabled} />

      <section aria-label={t.casa.mural}>
        <h4 className={s.label}>{t.casa.mural}</h4>
        {data.contributors.length ? (
          <ul className={s.mural}>
            {data.contributors.map((u) => (
              <li key={u.id} className={s.muralItem}>
                <Avatar user={u} size={24} decorative />
                {u.displayName}
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.muted}>{t.casa.muralEmpty}</p>
        )}
      </section>

      {manage && lit && <Manage spaceId={spaceId} data={data} onSaved={onSaved} />}
    </div>
  )
}

function Contribute({ spaceId, products, sandbox, enabled }: { spaceId: string; products: Product[]; sandbox: boolean; enabled: boolean }) {
  const teen = useIsTeen()
  const waiting = useBilling((x) => x.waiting)
  const arrived = useBilling((x) => x.arrived === `casa:${spaceId}`)
  const sorted = [...products].sort((a, b) => a.priceBrlCents - b.priceBrlCents)
  const [pick, setPick] = useState(sorted[0]?.id ?? null)
  // Unchecked by default: appearing on the mural is a choice, never a pre-ticked box.
  const [wall, setWall] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; gated: boolean } | null>(null)
  const product = sorted.find((p) => p.id === pick) ?? null
  if (!sorted.length) return null
  const pay = async () => {
    if (!product) return
    setBusy(true)
    setError(null)
    try {
      await startContribution(spaceId, product, wall)
    } catch (e) {
      setError({ text: errorText(e), gated: needsVerification(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={t.casa.contribute} className={s.contribute}>
      <h4 className={s.label}>{t.casa.contribute}</h4>
      {teen ? (
        <TeenPurchaseNotice />
      ) : arrived ? (
        <p className={s.paid} role="status">
          <Icon icon={CircleCheck} size={16} />
          {t.casa.paid}
        </p>
      ) : waiting?.spaceId === spaceId ? (
        <Waiting />
      ) : (
        <>
          <div className={s.amounts} role="radiogroup" aria-label={t.casa.contribute}>
            {sorted.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={pick === p.id} className={s.amount} onClick={() => setPick(p.id)}>
                <span className={`${s.amountPrice} tnum`}>{money(p.priceBrlCents)}</span>
                <span className={s.amountDays}>{t.casa.days(p.days ?? 0)}</span>
              </button>
            ))}
          </div>
          <label className={s.wall}>
            <input type="checkbox" checked={wall} onChange={(e) => setWall(e.target.checked)} />
            <span>
              {t.casa.wall}
              <span className={s.muted}>{t.casa.wallHint}</span>
            </span>
          </label>
          {product && (
            <>
              {error?.gated ? (
                <Button variant="primary" size="lg" onClick={openVerifyEmail}>
                  {t.casa.pay(money(product.priceBrlCents))}
                </Button>
              ) : (
                <Button variant="primary" size="lg" loading={busy} disabled={!enabled || !!waiting} onClick={() => void pay()} icon={House}>
                  {t.casa.pay(money(product.priceBrlCents))}
                </Button>
              )}
              {error && !error.gated && (
                <p className={s.error} role="alert">
                  {error.text}
                </p>
              )}
              <Fine sandbox={sandbox}>{t.casa.fine}</Fine>
            </>
          )}
        </>
      )}
    </section>
  )
}

function Manage({ spaceId, data, onSaved }: { spaceId: string; data: SpaceUpgrade; onSaved: (d: SpaceUpgrade) => void }) {
  const [tone, setTone] = useState<SpaceTone | null>(data.upgrade?.tone ?? null)
  const [code, setCode] = useState(data.upgrade?.inviteCode ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      onSaved(await patchSpaceUpgrade(spaceId, { tone, inviteCode: code.trim() ? code.trim().toLowerCase() : null }))
      toast.success(t.casa.saved)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={t.casa.manage} className={s.manage}>
      <h4 className={s.label}>{t.casa.manage}</h4>
      <div className={s.tones} role="radiogroup" aria-label={t.casa.tone}>
        <button type="button" role="radio" aria-checked={tone === null} className={s.tone} onClick={() => setTone(null)} title={t.casa.toneNone}>
          <span className={s.toneNone} />
        </button>
        {SPACE_TONES.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={tone === k} className={s.tone} onClick={() => setTone(k)} title={t.casa.tones[k]} aria-label={t.casa.tones[k]}>
            <span style={{ background: TONE[k] }} />
          </button>
        ))}
      </div>
      <TextField label={t.casa.invite} hint={`${t.casa.invitePrefix}${code || '…'} · ${t.casa.inviteHint}`} value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32))} />
      <Button onClick={() => void save()} loading={busy}>
        {t.casa.save}
      </Button>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
