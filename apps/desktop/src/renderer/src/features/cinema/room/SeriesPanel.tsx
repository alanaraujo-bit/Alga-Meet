// The show on the film sheet: seasons, every episode (watched ones dimmed), "Continuar a série", and what plays after.
// Choosing an episode re-probes it in main and it becomes the draft; the rest of the queue follows it on its own.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CinemaSeries } from '../../../../../shared/bridge'
import { Icon, ScrollArea, Spinner } from '@/ui'
import { Check, Play, ProjectorScreen } from '@/ui/icons'
import * as act from '../actions'
import { t } from '../strings'
import { episodeCode } from './next'
import { continueFrom, seasonsOf } from './series'
import s from './series.module.css'

const pad = (n: number) => String(n).padStart(2, '0')

export function SeriesPanel({ series, selectedId, choosing, upNext }: { series: CinemaSeries; selectedId: string; choosing: string | null; upNext: number }) {
  const eps = series.episodes
  const at = eps.findIndex((e) => e.fileId === selectedId)
  const selected = eps[at]
  const seasons = seasonsOf(eps)
  const [season, setSeason] = useState(selected?.season ?? seasons[0] ?? 1)
  // a new draft (another episode chosen) shows its own season
  useEffect(() => {
    if (selected) setSeason(selected.season)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, season])

  const shown = eps.filter((e) => e.season === season)
  const resume = continueFrom(eps, selectedId)
  const following = upNext > 0 ? eps[at + 1] : undefined
  const watched = eps.filter((e) => e.watched).length

  return (
    <div className={s.panel} aria-busy={!!choosing}>
      <div className={s.head}>
        <div className={s.label}>{t.series.label}</div>
        <div className={s.show} dir="auto" title={series.show}>{series.show}</div>
        <div className={s.meta}>{t.series.count(eps.length, seasons.length, watched)}</div>
      </div>

      {resume && (
        <button type="button" className={s.resume} disabled={!!choosing} onClick={() => void act.chooseEpisode(resume.fileId)}>
          <span className={s.resumeIcon}>{choosing === resume.fileId ? <Spinner size={12} /> : <Icon icon={Play} size={14} filled />}</span>
          <span className={s.resumeText}>
            <b>{t.series.continueTitle}</b>
            <span dir="auto">{t.series.continueBody(episodeCode({ episode: resume }) ?? '', resume.title)}</span>
          </span>
        </button>
      )}

      {seasons.length > 1 && (
        <div className={s.seasons} role="tablist" aria-label={t.series.seasons}>
          {seasons.map((n) => {
            const all = eps.filter((e) => e.season === n)
            return (
              <button
                key={n}
                type="button"
                role="tab"
                aria-selected={n === season}
                aria-label={t.series.seasonName(n)}
                className={s.season}
                onClick={() => setSeason(n)}
              >
                {t.series.season(n)}
                {all.every((e) => e.watched) && <Icon icon={Check} size={12} />}
              </button>
            )
          })}
        </div>
      )}

      <ScrollArea
        fade
        ref={list}
        className={s.list}
        key={season}
        role="list"
        aria-label={t.series.seasonName(season)}
        style={{ '--rows': Math.max(...seasons.map((n) => eps.filter((e) => e.season === n).length)) } as CSSProperties}
      >
        {shown.map((e, i) => {
          const isSel = e.fileId === selectedId
          const isNext = e === following
          const busy = choosing === e.fileId
          const sub = isSel ? t.series.selected : isNext ? t.series.upNext : e.watched ? t.series.watched : null
          return (
            <div role="listitem" key={e.fileId} className={s.item} style={{ '--i': Math.min(i, 12) } as CSSProperties}>
              <button
                type="button"
                className={s.ep}
                data-selected={isSel || undefined}
                data-watched={e.watched || undefined}
                aria-current={isSel ? 'true' : undefined}
                disabled={!!choosing && !busy}
                title={e.name}
                onClick={() => void act.chooseEpisode(e.fileId)}
              >
                <span className={s.num}>{pad(e.episode)}</span>
                <span className={s.epText}>
                  <span className={s.epTitle} dir="auto">{e.title || t.series.episode(e.episode)}</span>
                  {sub && <span className={s.epSub}>{sub}</span>}
                </span>
                <span className={s.epState} aria-hidden>
                  {busy ? <Spinner size={12} /> : isSel ? <Icon icon={ProjectorScreen} size={16} /> : e.watched ? <Icon icon={Check} size={14} /> : null}
                </span>
              </button>
            </div>
          )
        })}
      </ScrollArea>

      <p className={s.foot}>{t.series.autoplay(upNext)}</p>
    </div>
  )
}
