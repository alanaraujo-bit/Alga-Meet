// Text subtitles: SRT / WebVTT parsing, active-cue lookup and a safe inline-tag parser (no HTML is ever injected).
export interface Cue {
  startS: number
  endS: number
  text: string
}

// hh:mm:ss,mmm | mm:ss.mmm (hours optional in VTT); comma or dot decimals.
const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})`
const ARROW = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}`)

function secs(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

function parseBlocks(text: string): Cue[] {
  const cues: Cue[] = []
  for (const block of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n')
    const at = lines.findIndex((l) => ARROW.test(l))
    if (at < 0) continue
    const m = ARROW.exec(lines[at]!)!
    const body = lines.slice(at + 1).join('\n').trim()
    if (body) cues.push({ startS: secs(m[1], m[2]!, m[3]!, m[4]!), endS: secs(m[5], m[6]!, m[7]!, m[8]!), text: body })
  }
  return cues
}

export function parseSrt(text: string): Cue[] {
  return parseBlocks(text)
}

/** WebVTT: NOTE/STYLE/REGION blocks and the header never contain a timing line, so they drop out naturally. */
export function parseVtt(text: string): Cue[] {
  return parseBlocks(text)
}

/** Cues showing at playback time `t`; a positive `offsetS` delays the subtitles. End is exclusive. */
export function activeCues(cues: Cue[], t: number, offsetS: number): Cue[] {
  const x = t - offsetS
  return cues.filter((c) => x >= c.startS && x < c.endS)
}

export interface Run {
  text: string
  i?: true
  b?: true
  u?: true
}

/** Splits cue text into styled runs: keeps <i>/<b>/<u> (nested, unclosed tolerated), drops every other tag. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = []
  const on = { i: 0, b: 0, u: 0 }
  for (const part of text.split(/(<\/?[a-zA-Z][^>]*>)/)) {
    const tag = /^<(\/?)([a-zA-Z]+)[^>]*>$/.exec(part)
    if (tag) {
      const k = tag[2]!.toLowerCase()
      if (k === 'i' || k === 'b' || k === 'u') on[k] = Math.max(0, on[k] + (tag[1] ? -1 : 1))
    } else if (part) {
      const r: Run = { text: part }
      if (on.i) r.i = true
      if (on.b) r.b = true
      if (on.u) r.u = true
      runs.push(r)
    }
  }
  return runs
}
