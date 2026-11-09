import { AnimatePresence } from 'motion/react'
import { lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { CrashOffer } from './CrashOffer'
import { useFeedback } from './store'

// Rarely opened: the card loads on the first open.
const Card = lazy(() => import('./Card'))

/** Mounted once in the shell. The card is not modal: it floats over the app, which stays usable. */
export function FeedbackHost() {
  const open = useFeedback((st) => st.open)
  const offer = useFeedback((st) => st.offer !== null)
  return createPortal(
    <AnimatePresence>
      {open && (
        <Suspense key="card" fallback={null}>
          <Card />
        </Suspense>
      )}
      {offer && !open && <CrashOffer key="offer" />}
    </AnimatePresence>,
    document.body,
  )
}
