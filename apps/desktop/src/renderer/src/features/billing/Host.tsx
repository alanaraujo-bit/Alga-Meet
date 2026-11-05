import { lazy, Suspense } from 'react'
import { useBilling } from './store'

// Off the first paint: the dialogs load the first time something opens one.
const GiftDialog = lazy(() => import('./Gift').then((m) => ({ default: m.GiftDialog })))
const GiftReveal = lazy(() => import('./Gift').then((m) => ({ default: m.GiftReveal })))
const PassDialog = lazy(() => import('./Gift').then((m) => ({ default: m.PassDialog })))
const CasaDialog = lazy(() => import('../spaces/upgrade/Casa').then((m) => ({ default: m.CasaDialog })))

/** The store's app-wide dialogs (mounted once by the shell): gift flow, gift reveal, Plus pass, Casa. */
export function BillingHost() {
  const gift = useBilling((x) => !!x.giftDialog)
  const reveal = useBilling((x) => !!x.revealing)
  const pass = useBilling((x) => x.passDialog)
  const casa = useBilling((x) => x.casaDialog)
  return (
    <Suspense>
      {gift && <GiftDialog />}
      {reveal && <GiftReveal />}
      {pass && <PassDialog />}
      {casa && <CasaDialog spaceId={casa} />}
    </Suspense>
  )
}
