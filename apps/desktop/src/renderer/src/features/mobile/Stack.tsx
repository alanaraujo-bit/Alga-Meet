import { AnimatePresence, motion, useDragControls } from 'motion/react'
import type { ReactNode } from 'react'
import { Icon } from '@/ui'
import { ChevronLeft } from '@/ui/icons'
import { goBack } from './store'
import { t } from './strings'
import m from './mobile.module.css'

// iOS-like push: the new screen slides in from the right, the one below drifts left and dims.
const SPRING = { type: 'spring', stiffness: 420, damping: 40, mass: 0.9 } as const

/** A tab's screens, bottom first. Lower screens stay mounted (their scroll and drafts survive a push and a pop). */
export function Stack({ layers }: { layers: ReactNode[] }) {
  return (
    <div className={m.stack}>
      <AnimatePresence initial={false}>
        {layers.map((node, i) => (
          <Layer key={i} depth={i} covered={i < layers.length - 1}>
            {node}
          </Layer>
        ))}
      </AnimatePresence>
    </div>
  )
}

function Layer({ depth, covered, children }: { depth: number; covered: boolean; children: ReactNode }) {
  const drag = useDragControls()
  const pushed = depth > 0
  return (
    <motion.section
      className={m.layer}
      data-back={pushed || undefined}
      data-covered={covered || undefined}
      aria-hidden={covered || undefined}
      initial={pushed ? { x: '100%' } : false}
      animate={{ x: covered ? '-28%' : 0 }}
      exit={{ x: '100%', transition: { ...SPRING, stiffness: 520 } }}
      transition={SPRING}
      drag={pushed && !covered ? 'x' : false}
      dragControls={drag}
      dragListener={false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 1 }}
      onDragEnd={(_, info) => {
        if (info.offset.x > window.innerWidth * 0.33 || info.velocity.x > 600) goBack()
      }}
    >
      {pushed && (
        <>
          {/* Swipe from the left edge to go back (the system gesture in an installed app does nothing on its own). */}
          <div className={m.edge} onPointerDown={(e) => drag.start(e)} />
          <button type="button" className={m.back} onClick={goBack} aria-label={t.back}>
            <Icon icon={ChevronLeft} size={24} />
          </button>
        </>
      )}
      {children}
    </motion.section>
  )
}
