// One command to run the whole local stack: LiveKit SFU + API server + desktop app.
// Extra desktop profiles for multi-user testing: `npm run dev -- --profiles=bob,carol`.
import { spawn } from 'node:child_process'

const extra = (process.argv.find((a) => a.startsWith('--profiles='))?.split('=')[1] ?? '').split(',').filter(Boolean)
const procs = []
const run = (name, cmd, args, env = {}) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, env: { ...process.env, ...env } })
  const tag = `[${name}]`.padEnd(10)
  const pipe = (s) => s.on('data', (b) => b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(tag, l)))
  pipe(p.stdout)
  pipe(p.stderr)
  p.on('exit', (code) => console.log(tag, `exited with ${code}`))
  procs.push(p)
}

run('livekit', 'node', ['scripts/livekit.mjs'])
run('server', 'npm', ['run', 'dev', '-w', 'apps/server'])
run('desktop', 'npm', ['run', 'dev', '-w', 'apps/desktop'])
// Additional profiles attach to the same Vite dev server once it is up.
for (const profile of extra) {
  setTimeout(() => run(profile, 'npx', ['electron', 'apps/desktop', `--profile=${profile}`], {
    ELECTRON_RENDERER_URL: 'http://localhost:5173',
  }), 8000)
}
const stop = () => { for (const p of procs) p.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
