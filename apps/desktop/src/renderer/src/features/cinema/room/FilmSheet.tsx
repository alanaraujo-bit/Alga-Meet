// The host's film sheet (mockup 02), between the probe and "Abrir sessão": title, what goes out as is and what is
// converted, the tracks, what this PC plays, the upload it costs, and "Continuar de …" when the file was stopped before.
import type { Channel } from '@alga/shared'
import { useEffect, useState, type ReactNode } from 'react'
import { useData } from '@/store/data'
import { voiceMembers } from '@/store/selectors'
import { Button, Icon, Modal } from '@/ui'
import { AlertTriangle, Check, Lock, Pencil, ProjectorScreen } from '@/ui/icons'
import * as act from '../actions'
import { useCinema } from '../store'
import { clock, length, t } from '../strings'
import { audioRoute, audioRow, codecName, defaultAudio, subtitleRow, videoLabel } from './film'
import c from './call.module.css'

/** The host sends ~1.5× the film when the seats swap pieces among themselves (spec §6.4). */
const HOST_SHARE = 1.5

export function FilmSheet({ channel }: { channel: Channel }) {
  const draft = useCinema((s) => s.draft)
  const busy = useCinema((s) => s.busy)
  const inCall = useData((st) => voiceMembers(st, channel.id).length)
  const [title, setTitle] = useState('')
  const [resumeS, setResumeS] = useState<number | null>(null)
  useEffect(() => {
    setTitle(draft?.film.title ?? '')
    setResumeS(null)
    if (!draft) return
    let dead = false
    window.alga.cinema.resumeAt(draft.fileId).then((r) => !dead && setResumeS(r), () => undefined)
    return () => {
      dead = true
    }
  }, [draft])
  const f = draft?.film
  const a = f && defaultAudio(f)
  const converted = f?.audio.find((x) => x.out !== 'copy')
  const mbps = f ? f.bitrateKbps / 1000 : 0
  const ok = !!title.trim()
  return (
    <Modal
      open={!!draft}
      onClose={act.cancelDraft}
      title={t.filmSheet.title}
      description={t.filmSheet.sub(channel.name, inCall)}
      width={860}
      footer={
        <>
          <span className={c.privacy}>
            <Icon icon={Lock} size={14} />
            {t.filmSheet.privacy}
          </span>
          <Button variant="secondary" onClick={act.cancelDraft}>{t.filmSheet.cancel}</Button>
          {resumeS !== null && <Button variant="secondary" disabled={!ok} onClick={() => act.openSession(title, 0)}>{t.filmSheet.fromStart}</Button>}
          <Button variant="primary" size="lg" icon={ProjectorScreen} loading={busy} disabled={!ok} onClick={() => act.openSession(title, resumeS ?? 0)}>
            {resumeS !== null ? t.filmSheet.resume(clock(resumeS)) : t.filmSheet.open}
          </Button>
        </>
      }
    >
      {f && draft && (
        <div className={c.sheet}>
          <div>
            <div className={c.sheetCover}>
              <div className={c.placeholder} aria-hidden />
            </div>
            <p className={c.small}>{t.filmSheet.cover}</p>
            <div className={c.fileBlock}>
              <div className={c.fileName}>{draft.name}</div>
              <div className={c.small}>{[length(f.durationS), ...(f.chapters.length ? [t.film.chapters(f.chapters.length)] : [])].join(' · ')}</div>
            </div>
            <div className={c.upload}>
              <div className={c.uploadHead}>
                <span className={c.label}>{t.filmSheet.upload}</span>
                <span className={c.uploadValue}>{t.filmSheet.uploadValue(t.film.mbps(mbps * HOST_SHARE))}</span>
              </div>
              <div className={c.small}>{t.filmSheet.uploadBody(t.film.mbps(mbps), Math.max(0, inCall - 1))}</div>
            </div>
          </div>
          <div>
            <label className={c.label} htmlFor="cinema-film-title">{t.filmSheet.name}</label>
            <div className={c.titleField}>
              <input id="cinema-film-title" value={title} maxLength={120} dir="auto" spellCheck={false} onChange={(e) => setTitle(e.target.value)} />
              <Icon icon={Pencil} size={16} />
            </div>
            <div className={c.chips}>
              <span className={c.chip}>
                <span className={c.accent}><Icon icon={Check} size={12} /></span>
                <b>{t.filmSheet.native}</b> · {videoLabel(f, true)}
              </span>
              {a && (
                <span className={c.chip}>
                  <b>{t.film.audio(t.film.channels(a.channels))}</b> · {audioRoute(a)}
                </span>
              )}
            </div>
            <p className={c.small}>{converted ? t.filmSheet.explainConverted(codecName(converted.sourceCodec)) : t.filmSheet.explainCopy}</p>

            <Section title={t.filmSheet.audioTracks(f.audio.length)}>
              {f.audio.length ? f.audio.map((x) => {
                const r = audioRow(x)
                return <Track key={x.id} code={r.code} name={r.name} kind={r.kind} right={r.route} />
              }) : <span className={c.small}>{t.filmSheet.noTracks}</span>}
            </Section>
            {f.subtitles.length > 0 && (
              <Section title={t.filmSheet.subtitleTracks(f.subtitles.length)}>
                {f.subtitles.map((x) => {
                  const r = subtitleRow(x)
                  return <Track key={x.id} code={r.code} name={r.name} kind="" right={r.kind} />
                })}
              </Section>
            )}
            <Section title={t.filmSheet.thisPc}>
              {draft.decodes && (
                <div className={c.okRow}>
                  <span className={c.accent}><Icon icon={Check} size={14} /></span>
                  {t.filmSheet.plays(videoLabel(f))}
                </div>
              )}
              {!draft.decodes && <Warning title={t.filmSheet.noDecodeTitle} body={t.filmSheet.noDecodeBody} />}
              {draft.warnings.map((w) => <Warning key={w} title={t.warnings[w] ?? w} />)}
            </Section>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={c.section}>
      <div className={c.label}>{title}</div>
      <div className={c.sectionBody}>{children}</div>
    </section>
  )
}

function Track({ code, name, kind, right }: { code: string; name: string; kind: string; right: string }) {
  return (
    <div className={c.track}>
      <span className={c.code}>{code}</span>
      <span className={c.trackName} dir="auto">{name}</span>
      {kind && <span className={c.trackKind} dir="auto">{kind}</span>}
      <span className={c.trackRight}>{right}</span>
    </div>
  )
}

function Warning({ title, body }: { title: string; body?: string }) {
  return (
    <div className={c.warning} role="note">
      <span className={c.warningIcon}><Icon icon={AlertTriangle} size={18} filled /></span>
      <div>
        <div className={c.warningTitle}>{title}</div>
        {body && <div className={c.warningBody}>{body}</div>}
      </div>
    </div>
  )
}
