interface ImportMetaEnv {
  /** Link do instalador (.exe). Sem ele, o botão abre o aviso de beta fechado. */
  readonly PUBLIC_DOWNLOAD_URL?: string;
  /** Opcional: onde pedir convite (formulário, e-mail, WhatsApp). */
  readonly PUBLIC_INVITE_URL?: string;
  /** URL pública do site (canonical/OG). Padrão: https://algameet.com */
  readonly PUBLIC_SITE_URL?: string;
  /** O PWA (abrir convites no navegador/celular). Padrão: https://app.algameet.com */
  readonly PUBLIC_WEB_APP_URL?: string;
  /** API da prévia do convite. Padrão: a mesma origem (o servidor do site repassa /api). */
  readonly PUBLIC_API_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
