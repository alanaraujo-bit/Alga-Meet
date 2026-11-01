import { passwordStrength } from '@/lib/files'
import { t } from './strings'
import s from './password.module.css'

/** Hint text for the password field: what the bars below mean, plus a tip while it is weak. */
export function strengthHint(pw: string, personal: readonly string[] = []): string {
  const score = passwordStrength(pw, personal)
  return score < 3 ? `${t.strength[score]} ${t.strengthTip}` : t.strength[score]
}

/** Four bars under a new-password field. Decorative: the same information is in the field hint. */
export function StrengthMeter({ password, personal = [] }: { password: string; personal?: readonly string[] }) {
  if (!password) return null
  return (
    <div className={s.meter} data-score={passwordStrength(password, personal)} aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}
