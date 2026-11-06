import { D as ASTRO_GENERATOR, _ as createRenderInstruction, g as addAttribute, h as renderHead, m as maybeRenderHead, p as renderTemplate, u as renderSlot, w as unescapeHTML } from "./server_BBQtozpp.mjs";
import { G as UnavailableAstroGlobal, Y as AstroError, v as InvalidComponentArgs } from "./errors-data_HNc_BBfZ.mjs";
// \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
// ../Alga Meet/node_modules/astro/dist/runtime/server/astro-component.js
function validateArgs(args) {
	if (args.length !== 3) return false;
	if (!args[0] || typeof args[0] !== "object") return false;
	return true;
}
function baseCreateComponent(cb, moduleId, propagation) {
	const name = moduleId?.split("/").pop()?.replace(".astro", "") ?? "";
	const fn = (...args) => {
		if (!validateArgs(args)) throw new AstroError({
			...InvalidComponentArgs,
			message: InvalidComponentArgs.message(name)
		});
		return cb(...args);
	};
	Object.defineProperty(fn, "name", {
		value: name,
		writable: false
	});
	fn.isAstroComponentFactory = true;
	fn.moduleId = moduleId;
	fn.propagation = propagation;
	return fn;
}
function createComponentWithOptions(opts) {
	return baseCreateComponent(opts.factory, opts.moduleId, opts.propagation);
}
function createComponent(arg1, moduleId, propagation) {
	if (typeof arg1 === "function") return baseCreateComponent(arg1, moduleId, propagation);
	else return createComponentWithOptions(arg1);
}
// ../Alga Meet/node_modules/astro/dist/runtime/server/astro-global.js
function createError(name) {
	return new AstroError({
		...UnavailableAstroGlobal,
		message: UnavailableAstroGlobal.message(name)
	});
}
function createAstro(site) {
	return {
		get site() {
			console.warn(`Astro.site inside getStaticPaths is deprecated and will be removed in a future major version of Astro. Use import.meta.env.SITE instead`);
			return site ? new URL(site) : void 0;
		},
		get generator() {
			console.warn(`Astro.generator inside getStaticPaths is deprecated and will be removed in a future major version of Astro.`);
			return ASTRO_GENERATOR;
		},
		get callAction() {
			throw createError("callAction");
		},
		get clientAddress() {
			throw createError("clientAddress");
		},
		get cookies() {
			throw createError("cookies");
		},
		get csp() {
			throw createError("csp");
		},
		get currentLocale() {
			throw createError("currentLocale");
		},
		get getActionResult() {
			throw createError("getActionResult");
		},
		get isPrerendered() {
			throw createError("isPrerendered");
		},
		get locals() {
			throw createError("locals");
		},
		get originPathname() {
			throw createError("originPathname");
		},
		get params() {
			throw createError("params");
		},
		get preferredLocale() {
			throw createError("preferredLocale");
		},
		get preferredLocaleList() {
			throw createError("preferredLocaleList");
		},
		get props() {
			throw createError("props");
		},
		get redirect() {
			throw createError("redirect");
		},
		get request() {
			throw createError("request");
		},
		get response() {
			throw createError("response");
		},
		get rewrite() {
			throw createError("rewrite");
		},
		get routePattern() {
			throw createError("routePattern");
		},
		get self() {
			throw createError("self");
		},
		get slots() {
			throw createError("slots");
		},
		get url() {
			throw createError("url");
		},
		get session() {
			throw createError("session");
		},
		get cache() {
			throw createError("cache");
		},
		get logger() {
			throw createError("logger");
		}
	};
}
// ../Alga Meet/node_modules/astro/dist/runtime/server/render/script.js
/**
* Relies on the `renderScript: true` compiler option
* @experimental
*/
async function renderScript(result, id) {
	const inlined = result.inlinedScripts.get(id);
	let content = "";
	if (inlined != null) {
		if (inlined) content = `<script type="module">${inlined}<\/script>`;
	} else {
		const resolved = await result.resolve(id);
		content = `<script type="module" src="${result.userAssetsBase ? (result.base === "/" ? "" : result.base) + result.userAssetsBase : ""}${resolved}"><\/script>`;
	}
	return createRenderInstruction({
		type: "script",
		id,
		content
	});
}
// ../Alga Meet/node_modules/@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url
var inter_latin_opsz_normal_default = "/_astro/inter-latin-opsz-normal.BwkfbSeq.woff2";
var $$Base = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Base;
	const { title, description } = Astro.props;
	const canonical = new URL(Astro.url.pathname, Astro.site);
	return renderTemplate`<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${title}</title><meta name="description"${addAttribute(description, "content")}><link rel="canonical"${addAttribute(canonical, "href")}><meta name="theme-color" content="#0b0b0c"><meta property="og:type" content="website"><meta property="og:locale" content="pt_BR"><meta property="og:title"${addAttribute(title, "content")}><meta property="og:description"${addAttribute(description, "content")}><meta property="og:url"${addAttribute(canonical, "content")}><meta property="og:image"${addAttribute(new URL("/og.jpg", Astro.site), "content")}><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="preload"${addAttribute(inter_latin_opsz_normal_default, "href")} as="font" type="font/woff2" crossorigin><!-- Fallback com as métricas da Inter (valores do next/font): a troca de fonte não mexe no layout. --><style>${unescapeHTML(`@font-face{font-family:'Inter Fallback';src:local('Arial');ascent-override:90.44%;descent-override:22.52%;line-gap-override:0%;size-adjust:107.12%}@font-face{font-family:'Inter Variable';font-style:normal;font-display:swap;font-weight:100 900;src:url(${inter_latin_opsz_normal_default}) format('woff2-variations');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`)}</style><!-- Nível de desempenho antes da primeira pintura: A (completo), B (só CSS), C (estático). ?tier=a|b|c força. --><script>
      (() => {
        const d = document.documentElement, n = navigator, c = n.connection || {};
        const q = new URLSearchParams(location.search).get('tier');
        const et = c.effectiveType || '', mem = n.deviceMemory, cpu = n.hardwareConcurrency || 8;
        let t = 'a';
        if (matchMedia('(prefers-reduced-motion: reduce)').matches || c.saveData || /2g/.test(et)) t = 'c';
        else if ((mem && mem <= 2) || (mem && mem <= 4 && cpu <= 4) || et === '3g') t = 'b';
        if (/^[abc]$/.test(q || '')) t = q;
        d.classList.add('js', 'tier-' + t);
        d.dataset.tier = t;
      })();
    <\/script>${renderHead($$result)}</head><body><a class="skip" href="#conteudo">Pular para o conteúdo</a>${renderSlot($$result, $$slots["default"])}</body></html>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/layouts/Base.astro", void 0);
// apps/site/src/assets/brand/lockup.svg?url
var lockup_default = "/_astro/lockup.CT0RHbQb.svg";
var $$Logo = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Logo;
	const { height = 26, class: cls } = Astro.props;
	const width = Math.round(height * (735 / 160));
	return renderTemplate`${maybeRenderHead($$result)}<img${addAttribute(["logo", cls], "class:list")}${addAttribute(lockup_default, "src")}${addAttribute(width, "width")}${addAttribute(height, "height")}${addAttribute(`width:${width}px;height:${height}px`, "style")} alt="Alga Meet" decoding="async" data-astro-cid-f7espo7c>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Logo.astro", void 0);
// apps/site/src/data/links.ts
var releasesUrl = "https://github.com/alanaraujo-bit/Alga-Meet/releases";
var downloadUrl = `${releasesUrl}/latest/download/AlgaMeet-Setup.exe`;
var downloadNote = "Windows 10/11 · beta fechado · ainda sem assinatura digital (o Windows pode avisar 'editor desconhecido')";
export { $$Base as a, createComponent as c, $$Logo as i, __exportAll as l, downloadUrl as n, renderScript as o, releasesUrl as r, createAstro as s, downloadNote as t };
