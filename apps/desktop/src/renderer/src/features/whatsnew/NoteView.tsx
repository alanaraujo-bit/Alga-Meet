import { RELEASE_CATEGORIES, releaseText, type ReleaseCategory, type ReleaseLocale, type ReleaseNote } from '@alga/shared'
import { motion } from 'motion/react'
import { useState } from 'react'
import { SegmentedControl } from '@/ui'
import { EASE_OUT_QUART } from '@/ui/motion'
import { CategoryGlyph, CategoryTag, longDate, MediaFrame, Reactions } from './parts'
import { t } from './strings'
import s from './whatsnew.module.css'

type Filter = 'all' | ReleaseCategory

/** One version, complete: headline, highlights as big cards, then everything by category. Shared with the studio's preview. */
export function NoteView({ note, locale, preview, installed }: { note: ReleaseNote; locale: ReleaseLocale; preview?: boolean; installed?: boolean }) {
  const text = releaseText(note.content, locale)
  const [filter, setFilter] = useState<Filter>('all')
  const present = RELEASE_CATEGORIES.filter((c) => note.content.items.some((i) => i.category === c))
  const shown = note.content.items.filter((i) => filter === 'all' || i.category === filter)
  const highlights = shown.filter((i) => i.highlight)
  const rest = shown.filter((i) => !i.highlight)

  return (
    <motion.article
      key={note.version}
      className={s.note}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT_QUART } }}
      aria-labelledby={`note-${note.version}`}
    >
      <header className={s.noteHead}>
        <div className={s.noteMeta}>
          <span className={s.versionChip}>{t.welcome.version(note.version)}</span>
          {installed && <span className={s.hereTag}>{t.center.installed}</span>}
          <span>{t.center.published(longDate(note.publishedAt))}</span>
        </div>
        <h2 id={`note-${note.version}`} className={s.noteTitle}>
          {text.title}
        </h2>
        {text.summary && <p className={s.noteSummary}>{text.summary}</p>}
      </header>

      {present.length > 1 && (
        <div className={s.filter}>
          <SegmentedControl
            label={t.center.title}
            value={filter}
            onChange={setFilter}
            items={[{ value: 'all' as Filter, label: t.center.all }, ...present.map((c) => ({ value: c as Filter, label: t.category[c] }))]}
          />
        </div>
      )}

      {highlights.length > 0 && (
        <div className={s.cards} data-single={highlights.length === 1 || undefined}>
          {highlights.map((it) => {
            const x = text.items[it.id]!
            return (
              <section key={it.id} className={s.card} aria-labelledby={`item-${note.version}-${it.id}`}>
                <MediaFrame media={it.media} alt={x.alt} category={it.category} ratio={it.media ? '16 / 9' : highlights.length === 1 ? '16 / 5' : '16 / 7'} />
                <div className={s.cardBody}>
                  <CategoryTag category={it.category} />
                  <h3 id={`item-${note.version}-${it.id}`} className={s.cardTitle}>{x.title}</h3>
                  {x.body && <p className={s.cardText}>{x.body}</p>}
                  <Reactions version={note.version} itemId={it.id} disabled={preview} />
                </div>
              </section>
            )
          })}
        </div>
      )}

      {RELEASE_CATEGORIES.map((cat) => {
        const items = rest.filter((i) => i.category === cat)
        if (!items.length) return null
        return (
          <section key={cat} className={s.group} aria-labelledby={`cat-${note.version}-${cat}`}>
            <h3 id={`cat-${note.version}-${cat}`} className={s.groupTitle}>
              {t.category[cat]}
            </h3>
            <ul className={s.items}>
              {items.map((it) => {
                const x = text.items[it.id]!
                return (
                  <li key={it.id} className={s.item}>
                    <CategoryGlyph category={it.category} size={28} />
                    <div className={s.itemText}>
                      <span className={s.itemTitle}>{x.title}</span>
                      {x.body && <span className={s.itemBody}>{x.body}</span>}
                      {it.media && <MediaFrame media={it.media} alt={x.alt} category={it.category} className={s.itemMedia} />}
                    </div>
                    <Reactions version={note.version} itemId={it.id} compact disabled={preview} />
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {shown.length === 0 && <p className={s.muted}>{t.center.nothingIn}</p>}
    </motion.article>
  )
}
