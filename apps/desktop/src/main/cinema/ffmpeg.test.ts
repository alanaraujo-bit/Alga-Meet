// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))

import { TOOL_TAIL_MAX, checkFfmpeg, runTool, setFfmpegBinsForTest } from './ffmpeg'

const dir = mkdtempSync(join(tmpdir(), 'alga-ffmpeg-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Fake ffmpeg: node.exe running a script (checkFfmpeg's args are a test seam). .cmd files cannot be spawned without a shell.
const fake = (js: string) => {
  setFfmpegBinsForTest({ ffmpeg: process.execPath, ffprobe: 'x' })
  return ['-e', js]
}

describe('checkFfmpeg', () => {
  it('missing binary', async () => {
    setFfmpegBinsForTest({ ffmpeg: join(dir, 'nope.exe'), ffprobe: 'x' })
    expect(await checkFfmpeg()).toMatchObject({ ok: false, reason: 'missing' })
  })
  it('blocked when spawn is denied (EPERM/EACCES)', async () => {
    // A file that is not a valid executable: spawn fails with UNKNOWN/EPERM/EACCES, like an antivirus block.
    const bad = join(dir, 'bad.exe')
    writeFileSync(bad, 'not an exe')
    setFfmpegBinsForTest({ ffmpeg: bad, ffprobe: 'x' })
    expect(await checkFfmpeg()).toMatchObject({ ok: false, reason: 'blocked' })
  })
  it('crashed on non-zero exit', async () => {
    const args = fake('process.stderr.write("boom");process.exit(3)')
    expect(await checkFfmpeg(args)).toMatchObject({ ok: false, reason: 'crashed' })
  })
  it('ok with the version', async () => {
    const args = fake('process.stdout.write("ffmpeg version n7.1-2 Copyright (c) 2000\\n", () => process.exit(0))')
    expect(await checkFfmpeg(args)).toEqual({ ok: true, version: 'n7.1-2' })
  })
})

describe('runTool', () => {
  const node = process.execPath
  it('times out and kills', async () => {
    await expect(runTool(node, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 300 })).rejects.toThrow('timeout')
  })
  it('aborts on signal', async () => {
    const ac = new AbortController()
    const p = runTool(node, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 10_000, signal: ac.signal })
    setTimeout(() => ac.abort(), 200)
    await expect(p).rejects.toThrow('aborted')
  })
  it('passes spaces, quotes and & intact (no shell)', async () => {
    const args = ['a b', 'say "hi"', 'x&y', '100%']
    const r = await runTool(node, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...args], { timeoutMs: 5000 })
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual(args)
  })
  it('streams stdout lines', async () => {
    const lines: string[] = []
    await runTool(node, ['-e', 'console.log("a");console.log("b")'], { timeoutMs: 5000, onStdoutLine: (l) => lines.push(l) })
    expect(lines).toEqual(['a', 'b'])
  })
  it('keeps only a bounded tail of stderr', async () => {
    const r = await runTool(node, ['-e', 'for(let i=0;i<50000;i++)process.stderr.write("line "+i+" "+"x".repeat(90)+String.fromCharCode(10))'], { timeoutMs: 20_000 })
    expect(r.stderr.length).toBeLessThanOrEqual(TOOL_TAIL_MAX)
    expect(r.stderr.trimEnd().endsWith('line 49999 ' + 'x'.repeat(90))).toBe(true)
  })
  it('does not accumulate stdout when onStdoutLine is given', async () => {
    const r = await runTool(node, ['-e', 'console.log("a")'], { timeoutMs: 5000, onStdoutLine: () => {} })
    expect(r.stdout).toBe('')
  })
  it('rejects only after the child is gone', async () => {
    let pid = 0
    const ac = new AbortController()
    const p = runTool(node, ['-e', 'console.log(process.pid);setInterval(()=>{},1000)'], { timeoutMs: 10_000, signal: ac.signal, onStdoutLine: (l) => (pid = Number(l)) })
    await vi.waitFor(() => expect(pid).toBeGreaterThan(0))
    ac.abort()
    await expect(p).rejects.toThrow('aborted')
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it('decodes UTF-8 split across chunks', async () => {
    const r = await runTool(node, ['-e', 'const b=Buffer.from("á");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),100)'], { timeoutMs: 5000 })
    expect(r.stdout).toBe('á')
  })
})
