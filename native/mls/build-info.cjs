// native/mls/pkg is committed (the repo has no CI to build it): pkg/BUILD-INFO.json records the toolchain, a hash of
// the sources that shape the .wasm and a hash of each shipped output.
//   node native/mls/build-info.cjs write    build.sh, right after wasm-bindgen
//   node native/mls/build-info.cjs verify   `npm run verify:mls`; also electron-builder's beforePack hook (dist fails)
// verify refuses a missing pkg, sources edited without a rebuild, outputs that do not match, or another wasm-bindgen.
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = __dirname
const INFO = join(dir, 'pkg', 'BUILD-INFO.json')
const OUTPUTS = ['alga_mls.js', 'alga_mls_bg.wasm', 'THIRD-PARTY-NOTICES.txt']
// tests.rs is cfg(test): it never reaches the .wasm, so editing it needs no rebuild.
const sources = () => ['Cargo.toml', 'Cargo.lock', 'build.sh', 'notices.cjs',
  ...readdirSync(join(dir, 'src')).filter((f) => f.endsWith('.rs') && f !== 'tests.rs').map((f) => `src/${f}`)].sort()
// Text is hashed with LF line ends so a Windows checkout (core.autocrlf) hashes like any other.
const bytes = (file) => {
  const b = readFileSync(join(dir, file))
  return file.endsWith('.wasm') ? b : Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'))
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
function sourceHash() {
  const h = createHash('sha256')
  for (const f of sources()) h.update(`${f}\0`).update(bytes(f)).update('\0')
  return h.digest('hex')
}
const pinnedBindgen = () => /wasm-bindgen\s*=\s*"=([\d.]+)"/.exec(readFileSync(join(dir, 'Cargo.toml'), 'utf8'))[1]
const tool = (cmd) => execFileSync(cmd, ['--version'], { encoding: 'utf8' }).trim()

function write() {
  const info = {
    rustc: tool('rustc'),
    wasmBindgen: tool('wasm-bindgen'),
    target: 'wasm32-unknown-unknown',
    sources: sources(),
    sourceHash: sourceHash(),
    outputs: Object.fromEntries(OUTPUTS.map((f) => [f, sha256(bytes(`pkg/${f}`))])),
  }
  if (!info.wasmBindgen.endsWith(pinnedBindgen())) throw new Error(`${info.wasmBindgen} != pinned wasm-bindgen ${pinnedBindgen()}`)
  writeFileSync(INFO, `${JSON.stringify(info, null, 2)}\n`)
  console.log(`pkg/BUILD-INFO.json: sources ${info.sourceHash.slice(0, 12)}…`)
}

/** Throws (with what to do) unless pkg/ matches the sources. Returns the BUILD-INFO. */
function verify() {
  const rebuild = 'run `sh native/mls/build.sh` (Rust + wasm32-unknown-unknown + wasm-bindgen-cli 0.2.130) and commit native/mls/pkg'
  if (!existsSync(INFO)) throw new Error(`native/mls/pkg/BUILD-INFO.json missing: ${rebuild}`)
  const info = JSON.parse(readFileSync(INFO, 'utf8'))
  for (const f of OUTPUTS) {
    if (!existsSync(join(dir, 'pkg', f))) throw new Error(`native/mls/pkg/${f} missing: ${rebuild}`)
    if (sha256(bytes(`pkg/${f}`)) !== info.outputs?.[f]) throw new Error(`native/mls/pkg/${f} does not match BUILD-INFO.json: ${rebuild}`)
  }
  if (info.sourceHash !== sourceHash()) throw new Error(`native/mls sources changed since pkg/ was built: ${rebuild}`)
  if (!String(info.wasmBindgen).endsWith(pinnedBindgen())) throw new Error(`pkg/ built with ${info.wasmBindgen}, Cargo.toml pins ${pinnedBindgen()}: ${rebuild}`)
  return info
}

// electron-builder `beforePack` hook (apps/desktop/electron-builder.yml): a stale or missing MLS build fails `dist`.
module.exports = async function beforePack() {
  const info = verify()
  console.log(`  • native/mls/pkg verified (${info.rustc}, ${info.wasmBindgen})`)
}
module.exports.verify = verify

if (require.main === module) {
  const mode = process.argv[2]
  try {
    if (mode === 'write') write()
    else if (mode === 'verify') console.log(`native/mls/pkg OK (${verify().sourceHash.slice(0, 12)}…)`)
    else throw new Error('usage: node native/mls/build-info.cjs write|verify')
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
