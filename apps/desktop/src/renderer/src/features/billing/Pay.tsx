import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { errorText } from '@/lib/errors'
import { copyText } from '@/lib/clipboard'
import { Button, Icon, Modal, SegmentedControl, Spinner, TextField } from '@/ui'
import { Check, CircleCheck, Copy, Lock } from '@/ui/icons'
import { money } from './look'
import { closePay, loadBilling, pay, payOnProviderPage, useBilling } from './store'
import { t } from './strings'
import s from './pay.module.css'

type Method = 'card' | 'pix'
type Phase = 'form' | 'done'
type Pix = { qrCode: string; qrCodeBase64: string }

/** What the card frame (server src/billing/card-frame.ts) posts back. */
type FrameMsg =
  | { source: 'alga-card'; type: 'ready' | 'error' | 'invalid'; message?: string }
  | { source: 'alga-card'; type: 'height'; value: number }
  | { source: 'alga-card'; type: 'brand'; value: string | null }
  | { source: 'alga-card'; type: 'token'; token: string; paymentMethodId: string; issuerId?: string; document: string; deviceId?: string }

const apiOrigin = () => new URL(window.alga.config.apiUrl).origin
const accentHex = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().replace('#', '')
  return /^[0-9a-f]{6}$/i.test(v) ? v : '8b8ef7'
}

/**
 * The in-app checkout over a waiting checkout (store.ts `payOpen`): card (Mercado Pago's secure fields, framed from
 * our API) or Pix (QR + copy and paste). Nothing here grants anything: the server applies what the provider answers
 * and the waiting checkout settles through loadBilling, which turns this into the success moment.
 */
export function PayDialog() {
  const open = useBilling((x) => x.payOpen)
  const live = useBilling((x) => x.waiting)
  const arrived = useBilling((x) => x.arrived)
  const [w, setW] = useState(live)
  const [phase, setPhase] = useState<Phase>('form')

  useEffect(() => {
    if (live) {
      setW(live)
      setPhase('form')
    } else if (w && arrived) {
      setPhase('done')
      const id = window.setTimeout(closePay, 1900)
      return () => window.clearTimeout(id)
    } else if (w) {
      closePay()
    }
  }, [live, arrived]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!w) return null
  const sub = w.kind === 'subscription'
  const price = money(w.amountCents ?? w.product.priceBrlCents)
  const cadence = sub ? `${price} ${w.product.interval === 'year' ? t.pay.perYear : t.pay.perMonth}` : price
  const note = sub ? t.pay.subscription : w.recipient ? t.pay.giftTo(w.recipient.displayName) : t.pay.once
  return (
    <Modal open={open} onClose={closePay} width={420} title={w.giftId ? `Presente: ${w.product.name}` : w.product.name} description={<><span className={s.price}>{cadence}</span> · {note}</>}>
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'done' ? (
          <Done key="done" kind={w.spaceId ? 'casa' : w.giftId ? 'gift' : w.product.kind === 'plan' ? 'plan' : 'item'} />
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            <Form reference={w.reference} sub={sub} pixOnly={!!w.pixOnly} cta={sub ? t.pay.subscribe(cadence) : t.pay.payCard(price)} />
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  )
}

function Form({ reference, sub, pixOnly, cta }: { reference: string; sub: boolean; pixOnly: boolean; cta: string }) {
  const methods: Method[] = sub ? ['card'] : pixOnly ? ['pix'] : ['pix', 'card']
  const [method, setMethod] = useState<Method>(methods[0]!)
  return (
    <div className={s.form}>
      {methods.length > 1 && (
        <SegmentedControl label={t.pay.method} value={method} onChange={setMethod} items={methods.map((m) => ({ value: m, label: t.pay[m] }))} />
      )}
      {pixOnly && <p className={s.hint}>{t.pay.pixOnly}</p>}
      {method === 'card' ? <Card reference={reference} cta={cta} /> : <PixPane reference={reference} />}
      <button type="button" className={s.alt} onClick={payOnProviderPage}>
        {t.pay.providerPage}
      </button>
    </div>
  )
}

/** CPF mask while typing: 000.000.000-00. */
const maskCpf = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

export function cpfValid(v: string): boolean {
  const d = v.replace(/\D/g, '')
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  for (let t = 9; t < 11; t++) {
    let sum = 0
    for (let i = 0; i < t; i++) sum += Number(d[i]) * (t + 1 - i)
    if (((sum * 10) % 11) % 10 !== Number(d[t])) return false
  }
  return true
}

function Card({ reference, cta }: { reference: string; cta: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => `${window.alga.config.apiUrl}/api/v1/billing/card-frame?accent=${accentHex()}`)
  const [ready, setReady] = useState(false)
  const [height, setHeight] = useState(128)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [cpf, setCpf] = useState('')
  const [fieldErr, setFieldErr] = useState<{ name?: string; cpf?: string }>({})
  const timer = useRef(0)

  useEffect(() => {
    const origin = apiOrigin()
    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow) return
      const m = e.data as FrameMsg
      if (!m || m.source !== 'alga-card') return
      if (m.type === 'ready') setReady(true)
      else if (m.type === 'height') setHeight(Math.min(Math.max(m.value + 6, 96), 320))
      else if (m.type === 'error') {
        setReady(true)
        setError(t.pay.frameError)
      } else if (m.type === 'invalid') {
        window.clearTimeout(timer.current)
        setBusy(false)
        setError(m.message || null)
      } else if (m.type === 'token') {
        window.clearTimeout(timer.current)
        try {
          const res = await pay({
            method: 'card', reference, token: m.token, paymentMethodId: m.paymentMethodId, document: m.document,
            ...(m.issuerId ? { issuerId: m.issuerId } : {}), ...(m.deviceId ? { deviceId: m.deviceId } : {}),
          })
          if (res.status === 'rejected') setError(res.message ?? null)
        } catch (err) {
          setError(errorText(err, t.pay.frameError))
        } finally {
          setBusy(false)
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer.current)
    }
  }, [reference])

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy || !ready) return
    const holder = name.trim().replace(/\s+/g, ' ')
    const errs = {
      ...(holder.split(' ').length < 2 ? { name: t.pay.nameError } : {}),
      ...(!cpfValid(cpf) ? { cpf: t.pay.cpfError } : {}),
    }
    setFieldErr(errs)
    setError(null)
    // The card fields validate themselves inside the frame on submit, so they run even when ours are wrong.
    if (Object.keys(errs).length) return
    setBusy(true)
    frame.current?.contentWindow?.postMessage({ target: 'alga-card', type: 'submit', cardholderName: holder, document: cpf.replace(/\D/g, '') }, apiOrigin())
    timer.current = window.setTimeout(() => {
      setBusy(false)
      setError(t.pay.timeout)
    }, 25_000)
  }

  return (
    <form className={s.card} onSubmit={submit} noValidate>
      <div className={s.frameWrap} style={{ height }}>
        {!ready && (
          <div className={s.frameLoading}>
            <Spinner size={16} />
            <span>{t.pay.loadingFields}</span>
          </div>
        )}
        <iframe
          ref={frame}
          src={src}
          title={t.pay.card}
          className={s.frame}
          data-ready={ready || undefined}
          style={{ height }}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="strict-origin"
        />
      </div>
      <TextField
        label={t.pay.name}
        placeholder={t.pay.namePlaceholder}
        autoComplete="cc-name"
        spellCheck={false}
        maxLength={60}
        value={name}
        error={fieldErr.name}
        onChange={(e) => {
          setName(e.target.value)
          if (fieldErr.name) setFieldErr((f) => ({ ...f, name: undefined }))
        }}
      />
      <TextField
        label={t.pay.cpf}
        placeholder="000.000.000-00"
        inputMode="numeric"
        autoComplete="off"
        value={cpf}
        error={fieldErr.cpf}
        onChange={(e) => {
          setCpf(maskCpf(e.target.value))
          if (fieldErr.cpf) setFieldErr((f) => ({ ...f, cpf: undefined }))
        }}
      />
      <p className={s.error} role="alert" aria-live="assertive">{error}</p>
      <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!ready}>
        {busy ? t.pay.processing : cta}
      </Button>
      <p className={s.secure}>
        <Icon icon={Lock} size={12} />
        {t.pay.secure}
      </p>
    </form>
  )
}

function PixPane({ reference }: { reference: string }) {
  const [pix, setPix] = useState<Pix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    pay({ method: 'pix', reference })
      .then((res) => alive && res.pix && setPix(res.pix))
      .catch((err) => alive && setError(errorText(err, t.pay.frameError)))
    return () => {
      alive = false
    }
  }, [reference])

  // Pix settles by webhook → gateway; a light poll covers a missed event while the QR is on screen.
  useEffect(() => {
    if (!pix) return
    const id = window.setInterval(() => void loadBilling(), 5000)
    return () => window.clearInterval(id)
  }, [pix])

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2200)
    return () => window.clearTimeout(id)
  }, [copied])

  if (error) return <p className={s.error} role="alert">{error}</p>
  if (!pix) {
    return (
      <div className={s.pixLoading}>
        <Spinner size={20} />
        <span>{t.pay.pixMaking}</span>
      </div>
    )
  }
  return (
    <motion.div className={s.pix} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
      <div className={s.qr}>
        <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Code do Pix" draggable={false} />
      </div>
      <p className={s.hint}>{t.pay.pixScan}</p>
      <Button
        variant={copied ? 'secondary' : 'primary'}
        size="lg"
        full
        icon={copied ? Check : Copy}
        onClick={() => void copyText(pix.qrCode).then(() => setCopied(true))}
      >
        {copied ? t.pay.pixCopied : t.pay.pixCopy}
      </Button>
      <p className={s.status} role="status">
        <span className={s.pulse} aria-hidden />
        {t.pay.pixWaiting}
      </p>
    </motion.div>
  )
}

function Done({ kind }: { kind: 'plan' | 'item' | 'gift' | 'casa' }) {
  const line = { plan: t.pay.donePlan, item: t.pay.doneItem, gift: t.pay.doneGift, casa: t.pay.doneCasa }[kind]
  return (
    <motion.div className={s.done} role="status" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } }}>
      <motion.span className={s.doneIcon} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1, transition: { delay: 0.06, type: 'spring', stiffness: 420, damping: 22 } }}>
        <Icon icon={CircleCheck} size={24} filled className={s.doneGlyph} />
      </motion.span>
      <strong className={s.doneTitle}>{t.pay.doneTitle}</strong>
      <span className={s.doneLine}>{line}</span>
    </motion.div>
  )
}
