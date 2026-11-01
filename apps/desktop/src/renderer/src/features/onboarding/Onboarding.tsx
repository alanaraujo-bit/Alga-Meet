import { ArrowRight, Link2, Plus, UserPlus, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { Icon } from '@/ui'
import { EASE_OUT_QUART } from '@/ui/motion'
import s from './onboarding.module.css'

const t = {
  title: (name: string) => `Boas-vindas, ${name}`,
  subtitle: 'Escolha por onde começar. Leva menos de um minuto.',
  create: { title: 'Criar um espaço', body: 'Um lugar para o seu grupo conversar por voz, texto e tela.' },
  join: { title: 'Entrar com convite', body: 'Recebeu um link ou código? Cole e entre direto.' },
  friend: { title: 'Adicionar um amigo', body: 'Encontre alguém pelo nome de usuário e comece uma conversa.' },
  skip: 'Pular por agora',
}

/** First run: nothing yet (no spaces, friends or DMs) and not dismissed on this device. */
export function useNeedsOnboarding(): boolean {
  const meId = useData((st) => st.me?.id)
  const done = useUi((st) => (meId ? !!st.onboarded[meId] : true))
  const empty = useData(
    (st) => st.spaceOrder.length === 0 && Object.keys(st.relationships).length === 0 && !Object.values(st.channels).some((c) => c.type === 'dm' || c.type === 'group_dm'),
  )
  return !!meId && !done && empty
}

export function finishOnboarding(): void {
  const me = useData.getState().me
  if (!me) return
  const ui = useUi.getState()
  ui.setPref('onboarded', { ...ui.onboarded, [me.id]: true })
}

/** Step 1 of 2: pick a path. Step 2 is the form itself (modal or the add-friend tab). */
export function Onboarding() {
  const me = useData((st) => st.me)
  const ui = useUi.getState()
  const choices: Array<{ key: string; icon: LucideIcon; title: string; body: string; run: () => void; primary?: boolean }> = [
    { key: 'create', icon: Plus, ...t.create, primary: true, run: () => ui.openModal({ kind: 'createSpace' }) },
    { key: 'join', icon: Link2, ...t.join, run: () => ui.openModal({ kind: 'joinSpace' }) },
    {
      key: 'friend',
      icon: UserPlus,
      ...t.friend,
      run: () => {
        finishOnboarding()
        ui.setFriendsTab('add')
      },
    },
  ]
  return (
    <div className={s.wrap}>
      <motion.div
        className={s.inner}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT_QUART } }}
      >
        <p className={s.step}>Passo 1 de 2</p>
        <h1 className={s.title}>{t.title(me?.displayName ?? '')}</h1>
        <p className={s.subtitle}>{t.subtitle}</p>
        <div className={s.choices}>
          {choices.map((c) => (
            <button key={c.key} type="button" className={`${s.choice} ${c.primary ? s.primary : ''}`} onClick={c.run}>
              <span className={s.choiceIcon}>
                <Icon icon={c.icon} size={20} />
              </span>
              <span className={s.choiceTitle}>
                {c.title}
                <Icon icon={ArrowRight} size={16} className={s.arrow} />
              </span>
              <span className={s.choiceBody}>{c.body}</span>
            </button>
          ))}
        </div>
        <button type="button" className={s.skip} onClick={finishOnboarding}>
          {t.skip}
        </button>
      </motion.div>
    </div>
  )
}
