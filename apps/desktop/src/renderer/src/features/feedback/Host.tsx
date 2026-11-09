import { AnimatePresence } from 'motion/react'
import { lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useFeedback } from './store'

// Rarely opened: the card (and its CSS) loads on the first open.
const Card = lazy(() => import('./Card'))

/** Mounted once in the shell. The card is not modal: it floats over the app, which stays usable. */
export function FeedbackHost() {
  const open = useFeedback((st) => st.open)
  return createPortal(
    <AnimatePresence>
      {open && (
        <Suspense key="card" fallback={null}>
          <Card />
        </Suspense>
      )}
    </AnimatePresence>,
    document.body,
  )
}
