import { ECO_ACCENTS, ECO_ACCESSORIES, ECO_EYES, ECO_HAIR, type EcoSpec } from '@alga/shared'
import { Shuffle } from '@/ui/icons'
import { useState, type ReactNode } from 'react'
import { errorText } from '@/lib/errors'
import { patchMe } from '@/store/actions'
import { useData } from '@/store/data'
import { Button, toast } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { ecoBackdrop, ecoFor } from '@/ui/eco/ecoRules'
import { Group } from './Frame'
import { t } from './strings'
import s from './ecoEditor.module.css'

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!

/**
 * "Seu Eco": the mascot people wear when they have no photo. Every option is shown on the Eco itself (you pick by
 * looking, not by reading), the big one blinks, and the small ones show how it reads in lists. Saved on the account
 * (PATCH /users/@me { eco }), so friends see it everywhere; "Automático" goes back to the one born from the id.
 */
export function EcoEditor() {
  const me = useData((st) => st.me)
  const [draft, setDraft] = useState<EcoSpec | null>(null)
  const [busy, setBusy] = useState(false)
  if (!me) return null
  const saved = me.eco ?? null
  const current: EcoSpec = draft ?? saved ?? ecoFor(me.id)
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved)
  const set = (p: Partial<EcoSpec>) => setDraft({ ...current, ...p })

  const save = async (eco: EcoSpec | null) => {
    setBusy(true)
    try {
      await patchMe({ eco })
      setDraft(null)
      toast.success(eco ? t.eco.saved : t.eco.resetDone)
    } catch (e) {
      toast.error(errorText(e, t.eco.saveError))
    } finally {
      setBusy(false)
    }
  }

  const option = (key: string, label: string, spec: EcoSpec, selected: boolean, onPick: () => void) => (
    <button key={key} type="button" role="radio" aria-checked={selected} aria-label={label} title={label} className={s.option} onClick={onPick}>
      <span className={s.optionFace} style={{ background: ecoBackdrop(spec.accent) }}>
        <Eco spec={spec} framing="avatar" size={44} />
      </span>
    </button>
  )

  return (
    <Group title={t.eco.title} description={me.avatarUrl ? t.eco.withPhoto : t.eco.description}>
      <div className={s.editor}>
        <div className={s.stage}>
          <div className={`${s.hero} eco-alive`} style={{ ['--accent' as string]: current.accent }}>
            <Eco spec={current} framing="full" size={176} />
          </div>
          <div className={s.sizes} aria-hidden>
            {[56, 32, 20].map((n) => (
              <span key={n} className={s.mini} style={{ width: n, height: n, background: ecoBackdrop(current.accent) }}>
                <Eco spec={current} framing="avatar" size={n} />
              </span>
            ))}
          </div>
        </div>
        <div className={s.pickers}>
          <Picker label={t.eco.color} grid>
            {ECO_ACCENTS.map((c, i) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={current.accent === c}
                aria-label={t.eco.colors[i]}
                title={t.eco.colors[i]}
                className={s.swatch}
                style={{ background: c }}
                onClick={() => set({ accent: c })}
              />
            ))}
          </Picker>
          <Picker label={t.eco.eyes}>{ECO_EYES.map((v) => option(v, t.eco.eyesNames[v], { ...current, eyes: v }, current.eyes === v, () => set({ eyes: v })))}</Picker>
          <Picker label={t.eco.hair}>{ECO_HAIR.map((v) => option(v, t.eco.hairNames[v], { ...current, hair: v }, current.hair === v, () => set({ hair: v })))}</Picker>
          <Picker label={t.eco.accessory}>
            {ECO_ACCESSORIES.map((v) => option(v, t.eco.accessoryNames[v], { ...current, accessory: v }, current.accessory === v, () => set({ accessory: v })))}
          </Picker>
        </div>
      </div>
      <div className={s.actions}>
        <Button variant="ghost" icon={Shuffle} onClick={() => setDraft({ accent: pick(ECO_ACCENTS), eyes: pick(ECO_EYES), hair: pick(ECO_HAIR), accessory: pick(ECO_ACCESSORIES) })}>
          {t.eco.shuffle}
        </Button>
        {saved && (
          <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
            {t.eco.auto}
          </Button>
        )}
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            {t.eco.undo}
          </Button>
        )}
        <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void save(current)}>
          {t.eco.save}
        </Button>
      </div>
    </Group>
  )
}

function Picker({ label, children, grid }: { label: string; children: ReactNode; grid?: boolean }) {
  return (
    <div className={s.picker}>
      <span className={s.pickerLabel}>{label}</span>
      <div className={grid ? s.colors : s.options} role="radiogroup" aria-label={label}>
        {children}
      </div>
    </div>
  )
}
