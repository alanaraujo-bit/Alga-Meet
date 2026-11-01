import { defineConfig } from 'astro/config';

// Site estático: HTML pronto no build, JS só onde há interação (ilhas/scripts).
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://algameet.com.br',
  server: { port: 3100 },
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'always' },
  image: { responsiveStyles: false },
});
