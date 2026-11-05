/*
 * The setup window's page (src/setup): install, update and uninstall screens shown by native/setup-ui, the small
 * WebView2 host the NSIS installer runs. Built as ONE self-contained index.html (scripts, styles and the font
 * inlined) that the host embeds with include_str!, so nothing sits next to the exe.
 *   build:   npx vite build --config vite.setup.config.ts      (scripts/build-setup-ui.mjs runs it)
 *   preview: npx vite --config vite.setup.config.ts            (then /?mode=install|update|uninstall, &fail=1)
 */
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function singleFile(): Plugin {
  return {
    name: 'alga:setup-single-file',
    enforce: 'post',
    generateBundle(_, bundle) {
      const page = bundle['index.html']
      if (!page || page.type !== 'asset') return
      let html = String(page.source)
      for (const [name, out] of Object.entries(bundle)) {
        if (out.type === 'chunk' && out.isEntry) {
          html = html.replace(new RegExp(`<script[^>]*src="[^"]*${escape(name)}"[^>]*></script>`), () => `<script type="module">${out.code.replace(/<\/script/gi, '<\\/script')}</script>`)
          delete bundle[name]
        } else if (out.type === 'asset' && name.endsWith('.css')) {
          html = html.replace(new RegExp(`<link[^>]*href="[^"]*${escape(name)}"[^>]*>`), () => `<style>${String(out.source)}</style>`)
          delete bundle[name]
        }
      }
      if (/<script[^>]+src=|<link[^>]+stylesheet/.test(html)) this.error('setup page: an asset was not inlined')
      page.source = html
    },
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/setup'),
  base: './',
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [react(), singleFile()],
  server: { port: 5199, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'native/setup-ui/web'),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    target: 'chrome120',
  },
})
