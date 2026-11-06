import { a as $$Base, c as createComponent, i as $$Logo, l as __exportAll, n as downloadUrl, o as renderScript, t as downloadNote } from "./links_BveOkCAn.mjs";
import { g as addAttribute, m as maybeRenderHead, p as renderTemplate, s as renderComponent } from "./server_BBQtozpp.mjs";
// apps/site/src/pages/i/index.astro
var i_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => "/i"
});
var $$Index = createComponent(($$result, $$props, $$slots) => {
	const api = "http://localhost:4599".replace(/\/+$/, "");
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Você foi chamado · Alga Meet",
		"description": "Um amigo te chamou para o Alga Meet: voz que soa de perto, tela em 1080p e chat para o seu grupo.",
		"data-astro-cid-bgarrque": true
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<main class="inv"${addAttribute(api, "data-api")} data-astro-cid-bgarrque><a href="/" class="mark" aria-label="Alga Meet, página inicial" data-astro-cid-bgarrque>${renderComponent($$result, "Logo", $$Logo, {
		"height": 22,
		"data-astro-cid-bgarrque": true
	})}</a><section class="card" aria-live="polite" data-astro-cid-bgarrque><div class="faces" aria-hidden="true" data-astro-cid-bgarrque><!-- Eco, the Alga Meet mascot (apps/desktop/src/renderer/src/ui/eco/Eco.tsx, avatar framing), in the inviter's color. --><span class="face" data-face hidden data-astro-cid-bgarrque><svg viewBox="2 2 96 96" width="48" height="48" focusable="false" data-astro-cid-bgarrque><path d="M33 88 L67 88 L69 95 C73 96 77 100 77 105 C77 109 74 110 72 107 L69 103 L69 114 C69 119 66 122 62 122 C58.5 122 57 120 56 117.5 L44 117.5 C43 120 41.5 122 38 122 C34 122 31 119 31 114 L31 103 L28 107 C26 110 23 109 23 105 C23 100 27 96 31 95 Z" fill="#1c1c23" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round" data-astro-cid-bgarrque></path><path d="M50 30 C66 30 82 46 84 64 C85 75 82 84 76 90 C71 93 66 93 60 92.5 L40 92.5 C34 93 29 93 24 90 C18 84 15 75 16 64 C18 46 34 30 50 30 Z" fill="#25252e" data-astro-cid-bgarrque></path><path d="M24 90 C18 84 15 75 16 64 C18 46 34 30 50 30 C66 30 82 46 84 64 C85 75 82 84 76 90" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-bgarrque></path><path d="M24 90 C29 93 34 93.5 39.5 92.5 M76 90 C71 93 66 93.5 60.5 92.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" data-astro-cid-bgarrque></path><rect x="28" y="55" width="44" height="22" rx="11" fill="#0c0c10" data-astro-cid-bgarrque></rect><path d="M45 44 C42 34 36 20 24 6 C38 15 45 28 48.5 40 Z M55 44 C58 34 64 20 76 6 C62 15 55 28 51.5 40 Z" fill="currentColor" data-astro-cid-bgarrque></path><g fill="var(--eye)" data-astro-cid-bgarrque><rect x="35" y="63.5" width="10" height="5" rx="2.5" data-astro-cid-bgarrque></rect><rect x="55" y="63.5" width="10" height="5" rx="2.5" data-astro-cid-bgarrque></rect></g></svg></span><span class="tile" data-tile data-astro-cid-bgarrque>A</span></div><p class="lead" data-lead data-astro-cid-bgarrque>Você foi chamado para o Alga Meet</p><h1 data-space data-astro-cid-bgarrque>Um grupo te espera</h1><p class="meta" data-meta data-astro-cid-bgarrque></p><div class="actions" data-astro-cid-bgarrque><a class="btn btn-primary btn-lg" data-open href="/" data-astro-cid-bgarrque>Abrir no Alga Meet</a><a class="btn btn-ghost btn-lg"${addAttribute(downloadUrl, "href")} data-astro-cid-bgarrque>Baixar para Windows</a></div><ol class="steps" data-astro-cid-bgarrque><li data-astro-cid-bgarrque>Ainda não tem o app? Baixe e instale (Windows 10 ou 11, leva um minuto).</li><li data-astro-cid-bgarrque>Volte aqui e toque em <strong data-astro-cid-bgarrque>Abrir no Alga Meet</strong>: você cria a conta e já cai no grupo.</li></ol><p class="code" data-code-row hidden data-astro-cid-bgarrque>Ou, no app, use <strong data-astro-cid-bgarrque>Entrar com convite</strong> e cole o código <code data-code data-astro-cid-bgarrque></code></p></section><p class="note" data-astro-cid-bgarrque>${downloadNote}</p></main>` })}${renderScript($$result, "D:/PROJETOS/alga-presence/apps/site/src/pages/i/index.astro?astro&type=script&index=0&lang.ts")}`;
}, "D:/PROJETOS/alga-presence/apps/site/src/pages/i/index.astro", void 0);
var $$file = "D:/PROJETOS/alga-presence/apps/site/src/pages/i/index.astro";
// \0virtual:astro:page:src/pages/i/index@_@astro
var page = () => i_exports;
export { page };
