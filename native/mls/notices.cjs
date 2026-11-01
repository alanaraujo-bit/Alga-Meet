// Writes pkg/THIRD-PARTY-NOTICES.txt: every crate compiled into alga_mls_bg.wasm (normal dependencies for
// wasm32-unknown-unknown, proc-macros excluded), its license and source, then the license texts. Run by build.sh;
// the file ships next to the .wasm (electron-builder extraResources → resources/mls). Needs the crates in the local
// cargo registry (true right after a build).
const { execFileSync } = require('node:child_process')
const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const meta = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--filter-platform', 'wasm32-unknown-unknown'], { cwd: __dirname, maxBuffer: 64 << 20 }))
const byId = new Map(meta.packages.map((p) => [p.id, p]))
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
const crates = []
const seen = new Set()
const walk = (id) => {
  if (seen.has(id)) return
  seen.add(id)
  const p = byId.get(id)
  if (p.targets.some((t) => t.kind.includes('proc-macro'))) return // runs at build time only
  if (id !== meta.resolve.root) crates.push(p)
  for (const d of nodes.get(id).deps) if (d.dep_kinds.some((k) => k.kind === null)) walk(d.pkg)
}
walk(meta.resolve.root)
crates.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

const lf = (s) => s.replace(/\r\n/g, '\n').trimEnd()
const canonical = {
  'Apache-2.0': lf(readFileSync(join(__dirname, 'licenses', 'Apache-2.0.txt'), 'utf8')),
  'MPL-2.0': lf(readFileSync(join(__dirname, 'licenses', 'MPL-2.0.txt'), 'utf8')),
}
const mit = (who) => `MIT License\n\nCopyright (c) ${who}\n\n${lf(MIT_BODY)}`
const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

// Texts shared by several crates are printed once; each crate points at the ones that apply to it.
const texts = new Map()
const textId = (body) => {
  if (!texts.has(body)) texts.set(body, `[${texts.size + 1}]`)
  return texts.get(body)
}
const source = (p) => `https://crates.io/api/v1/crates/${p.name}/${p.version}/download`
const lines = []
for (const p of crates) {
  const dir = dirname(p.manifest_path)
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice|copyright)/i.test(f)).sort()
  const refs = files.map((f) => textId(lf(readFileSync(join(dir, f), 'utf8'))))
  // Crates published without their license file: the SPDX license with the authors named in Cargo.toml.
  if (!refs.length) {
    for (const id of p.license.split(/\s+(?:OR|AND)\s+|[()/]/).filter(Boolean)) {
      if (id === 'MIT') refs.push(textId(mit(p.authors.join(', ') || `the ${p.name} authors`)))
      else if (canonical[id]) refs.push(textId(canonical[id]))
    }
  }
  lines.push(`${p.name} ${p.version} — ${p.license} — ${p.repository ?? 'no repository'} — texts ${refs.join(' ')}`)
  if (p.license.includes('MPL-2.0')) {
    lines.push(`    MPL-2.0: unmodified; Source Code Form: ${source(p)} (also ${p.repository})`)
  }
}

const out = [
  'Alga Meet — E2EE module (alga_mls_bg.wasm, alga_mls.js): third-party notices',
  '',
  'The MLS module is built from native/mls (OpenMLS 0.9.2) and links the crates below. The MPL-2.0 files (hpke-rs*)',
  'are used unmodified; their Source Code Form is available at the crates.io links given for each of them.',
  '',
  `Crates (${crates.length}):`,
  ...lines,
  '',
  ...[...texts].flatMap(([body, id]) => ['='.repeat(100), id, '', body, '']),
].join('\n')
writeFileSync(join(__dirname, 'pkg', 'THIRD-PARTY-NOTICES.txt'), out)
console.log(`THIRD-PARTY-NOTICES.txt: ${crates.length} crates, ${texts.size} license texts, ${out.length} bytes`)
