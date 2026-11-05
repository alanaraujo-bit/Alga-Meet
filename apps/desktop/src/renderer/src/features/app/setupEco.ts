import { EcoSpecSchema, type Me } from '@alga/shared'
import { patchMe } from '@/store/actions'
import { useData } from '@/store/data'
import { toast } from '@/ui'
import { t } from './strings'

/**
 * The installer lets people dress their Eco while files land (native/setup-ui). On the first signed-in start the
 * app wears it, unless an Eco was already picked on the account. Read once: the file is gone either way.
 */
export function startSetupEco(): () => void {
  let taken = false
  const take = (me: Me | null) => {
    if (taken || !me) return
    taken = true
    void wear(me)
  }
  take(useData.getState().me)
  return useData.subscribe((st) => take(st.me))
}

async function wear(me: Me): Promise<void> {
  const raw = await window.alga?.app.takeSetupEco?.().catch(() => null)
  const eco = EcoSpecSchema.safeParse(raw)
  if (!eco.success || me.eco) return
  try {
    await patchMe({ eco: eco.data })
    toast.success(t.setupEco)
  } catch {
    // Not worth an error: the Eco can be picked again in Configurações › Minha conta.
  }
}
