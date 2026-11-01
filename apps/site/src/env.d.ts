interface ImportMetaEnv {
  /** Link do instalador (.exe). Sem ele, o botão abre o aviso de beta fechado. */
  readonly PUBLIC_DOWNLOAD_URL?: string;
  /** Opcional: onde pedir convite (formulário, e-mail, WhatsApp). */
  readonly PUBLIC_INVITE_URL?: string;
  /** URL pública do site (canonical/OG). Padrão: https://algameet.com.br */
  readonly PUBLIC_SITE_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
