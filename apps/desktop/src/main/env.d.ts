/// <reference types="electron-vite/node" />
interface ImportMetaEnv {
  /** Production API base baked at build time (e.g. https://api.algameet.com). */
  readonly MAIN_VITE_API_URL?: string
}
