import { A as REROUTABLE_STATUS_CODES, C as markHTMLString, D as ASTRO_GENERATOR, E as ASTRO_ERROR_HEADER, F as responseSentSymbol$1, I as decodeKey, L as decryptString, M as clientAddressSymbol, N as fetchStateSymbol, O as DEFAULT_404_COMPONENT, P as originPathnameSymbol, R as generateCspDigest, S as isAstroComponentFactory, T as renderEndpoint, a as isRoute500, b as pushDirective, c as chunkToString, d as renderSlotToString, f as isRenderTemplateResult, i as isRoute404, j as STATUS_CODE_PAGES, k as REDIRECT_STATUS_CODES, l as createSlotValueFromString, n as renderPage, o as renderJSX, p as renderTemplate, r as isRoute3xx, s as renderComponent, v as isRenderInstruction, y as normalizeCspResourceEntry } from "./chunks/server_BBQtozpp.mjs";
import { i as getAssetsPrefix, n as AstroIntegrationLogger, r as astroToRuntimeLogger, t as createConsoleLogger } from "./chunks/console_wNEiZfXK.mjs";
import { _ as slash, a as collapseDuplicateSlashes, c as hasFileExtension, d as joinPaths, f as prependForwardSlash, g as removeTrailingForwardSlash, i as collapseDuplicateLeadingSlashes, l as isInternalPath, m as removeLeadingForwardSlash, n as matchPattern, o as collapseDuplicateTrailingSlashes, r as appendForwardSlash, s as fileExtension, v as stripRequestBase, y as trimSlashes } from "./chunks/remote_I2AsRZT5.mjs";
import { C as LocalsNotAnObject, E as MiddlewareNotAResponse, F as NoMatchingStaticPathFound, H as ResponseSentError, J as i18nNoLocaleFoundInPath, L as PageNumberParamNotFound, M as NoManifestAvailable, R as PrerenderClientAddressNotAvailable, T as MiddlewareNoDataOrNextCalled, U as RewriteWithBodyUsed, V as ReservedSlotName, W as StaticClientAddressNotAvailable, X as isAstroError, Y as AstroError, a as ClientAddressNotAvailable, b as InvalidGetStaticPathsReturn, f as ForbiddenRewrite, h as GetStaticPathsRequired, i as CacheNotEnabled, m as GetStaticPathsInvalidRouteParam, n as ActionsReturnedInvalidDataError, p as GetStaticPathsExpectedParams, r as AstroResponseHeadersReassigned, t as ActionNotFoundError, w as LocalsReassigned, y as InvalidGetStaticPathsEntry, z as PrerenderDynamicEndpointPathCollide } from "./chunks/errors-data_HNc_BBfZ.mjs";
import colors from "piccolore";
import { escape } from "html-escaper";
import { parseCookie, stringifySetCookie } from "cookie";
import { parse, stringify } from "devalue";
// ../Alga Meet/node_modules/astro/dist/core/middleware/noop-middleware.js
var NOOP_MIDDLEWARE_FN = async (_ctx, next) => {
	return await next();
};
// ../Alga Meet/node_modules/astro/dist/core/app/manifest.js
function deserializeManifest(serializedManifest, routesList) {
	const routes = [];
	if (serializedManifest.routes) for (const serializedRoute of serializedManifest.routes) routes.push({
		...serializedRoute,
		routeData: deserializeRouteData(serializedRoute.routeData)
	});
	if (routesList) for (const route of routesList?.routes) routes.push({
		file: "",
		links: [],
		scripts: [],
		styles: [],
		routeData: route
	});
	const assets = new Set(serializedManifest.assets);
	const componentMetadata = new Map(serializedManifest.componentMetadata);
	const inlinedScripts = new Map(serializedManifest.inlinedScripts);
	const clientDirectives = new Map(serializedManifest.clientDirectives);
	const key = decodeKey(serializedManifest.key);
	return {
		middleware() {
			return { onRequest: NOOP_MIDDLEWARE_FN };
		},
		...serializedManifest,
		rootDir: new URL(serializedManifest.rootDir),
		srcDir: new URL(serializedManifest.srcDir),
		publicDir: new URL(serializedManifest.publicDir),
		outDir: new URL(serializedManifest.outDir),
		cacheDir: new URL(serializedManifest.cacheDir),
		buildClientDir: new URL(serializedManifest.buildClientDir),
		buildServerDir: new URL(serializedManifest.buildServerDir),
		assets,
		componentMetadata,
		inlinedScripts,
		clientDirectives,
		routes,
		key
	};
}
function deserializeRouteData(rawRouteData) {
	return {
		route: rawRouteData.route,
		type: rawRouteData.type,
		pattern: new RegExp(rawRouteData.pattern),
		params: rawRouteData.params,
		component: rawRouteData.component,
		pathname: rawRouteData.pathname || void 0,
		segments: rawRouteData.segments,
		prerender: rawRouteData.prerender,
		redirect: rawRouteData.redirect,
		redirectRoute: rawRouteData.redirectRoute ? deserializeRouteData(rawRouteData.redirectRoute) : void 0,
		fallbackRoutes: rawRouteData.fallbackRoutes.map((fallback) => {
			return deserializeRouteData(fallback);
		}),
		isIndex: rawRouteData.isIndex,
		origin: rawRouteData.origin,
		distURL: rawRouteData.distURL
	};
}
function deserializeRouteInfo(rawRouteInfo) {
	return {
		styles: rawRouteInfo.styles,
		file: rawRouteInfo.file,
		links: rawRouteInfo.links,
		scripts: rawRouteInfo.scripts,
		routeData: deserializeRouteData(rawRouteInfo.routeData)
	};
}
// \0virtual:astro:renderers
var renderers = [];
[{
	"file": "",
	"links": [],
	"scripts": [],
	"styles": [],
	"routeData": {
		"route": "/i",
		"isIndex": true,
		"type": "page",
		"pattern": "^\\/i\\/?$",
		"segments": [[{
			"content": "i",
			"dynamic": false,
			"spread": false
		}]],
		"params": [],
		"component": "src/pages/i/index.astro",
		"pathname": "/i",
		"prerender": true,
		"fallbackRoutes": [],
		"distURL": [],
		"origin": "project",
		"_meta": { "trailingSlash": "ignore" }
	}
}, {
	"file": "",
	"links": [],
	"scripts": [],
	"styles": [],
	"routeData": {
		"route": "/",
		"isIndex": true,
		"type": "page",
		"pattern": "^\\/$",
		"segments": [],
		"params": [],
		"component": "src/pages/index.astro",
		"pathname": "/",
		"prerender": true,
		"fallbackRoutes": [],
		"distURL": [],
		"origin": "project",
		"_meta": { "trailingSlash": "ignore" }
	}
}].map(deserializeRouteInfo);
// \0virtual:astro:pages
var _page0 = () => import("./chunks/index_BDVehoVQ.mjs");
var _page1 = () => import("./chunks/index_Dek1OqBd.mjs").then((n) => n.t);
var pageMap = /* @__PURE__ */ new Map([["src/pages/i/index.astro", _page0], ["src/pages/index.astro", _page1]]);
// \0virtual:astro:manifest
var _manifest = deserializeManifest({"rootDir":"file:///D:/PROJETOS/alga-presence/apps/site/","cacheDir":"file:///D:/PROJETOS/alga-presence/apps/site/node_modules/.astro/","outDir":"file:///C:/Users/ALANAR%7E1/AppData/Local/Temp/claude/164322ada44fc7b3/f58ccb05-b634-4afe-bc33-b347a29c7484/scratchpad/site-stub/","srcDir":"file:///D:/PROJETOS/alga-presence/apps/site/src/","publicDir":"file:///D:/PROJETOS/alga-presence/apps/site/public/","buildClientDir":"file:///C:/Users/ALANAR%7E1/AppData/Local/Temp/claude/164322ada44fc7b3/f58ccb05-b634-4afe-bc33-b347a29c7484/scratchpad/site-stub/","buildServerDir":"file:///D:/PROJETOS/alga-presence/.astro/","adapterName":"","assetsDir":"_astro","routes":[{"file":"","links":[],"scripts":[],"styles":[{"type":"inline","content":":root{color-scheme:dark;--bg-0:#08080a;--bg-1:#0b0b0c;--bg-2:#0f1011;--bg-3:#161718;--bg-4:#1b1b1d;--text-1:#f7f8f8;--text-2:#d0d6e0;--text-3:#8a8f98;--text-4:#62666d;--line-1:#ffffff0d;--line-2:#ffffff14;--line-3:#ffffff1f;--accent:#8b8ef7;--accent-hover:#a2a8fc;--accent-fill:#6163d0;--accent-fill-hover:#6466d4;--accent-tint:#8b8ef71a;--online:#61c28e;--live:#e86885;--live-fill:#be395e;--sheen:linear-gradient(180deg, #ffffff1a, #fff0 55%);--top-light:inset 0 1px 0 #ffffff0d;--elev:0 0 0 1px #00000073, 0 4px 12px #00000038, 0 16px 40px #00000061;--ease-out:cubic-bezier(.165, .84, .44, 1);--ease-sheet:cubic-bezier(.32, .72, 0, 1);--gutter:clamp(16px, 4vw, 40px);--maxw:1200px;--font:\"Inter Variable\", \"Inter Fallback\", system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif}*,:before,:after{box-sizing:border-box}html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-padding-top:72px}html.lenis,html.lenis body{height:auto}.lenis.lenis-smooth{scroll-behavior:auto!important}body{background:var(--bg-1);color:var(--text-2);font-family:var(--font);font-feature-settings:\"calt\", \"cv01\", \"ss03\";-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;margin:0;font-size:16px;line-height:1.6;overflow-x:clip}img,svg,video{max-width:100%;height:auto;display:block}a{color:inherit}button{font:inherit;color:inherit}::selection{color:#fff;background:#6e72e861}:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}h1,h2,h3{color:var(--text-1);font-variation-settings:\"opsz\" 32;text-wrap:balance;margin:0;font-weight:620}h1{letter-spacing:-.035em;font-size:clamp(40px,7.4vw,88px);line-height:1.02}h2{letter-spacing:-.03em;font-size:clamp(32px,5vw,60px);line-height:1.05}h3{letter-spacing:-.016em;font-size:clamp(18px,1.6vw,21px);font-weight:590;line-height:1.3}p{text-wrap:pretty;margin:0}.tnum{font-variant-numeric:tabular-nums}.wrap{width:100%;max-width:var(--maxw);padding-inline:var(--gutter);margin-inline:auto}.eyebrow{letter-spacing:0;color:var(--accent);align-items:center;gap:8px;font-size:13px;font-weight:510;display:inline-flex}.lede{color:var(--text-3);max-width:38em;font-size:clamp(17px,1.5vw,20px);line-height:1.55}.lede strong{color:var(--text-2);font-weight:510}.sr-only{clip:rect(0 0 0 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.skip{z-index:1000;background:var(--bg-4);color:var(--text-1);border-radius:8px;padding:10px 14px;text-decoration:none;position:absolute;top:-60px;left:12px}.skip:focus{top:12px}.btn{--h:44px;height:var(--h);letter-spacing:-.008em;white-space:nowrap;cursor:pointer;transition:background-color .12s var(--ease-out), box-shadow .12s var(--ease-out), transform .16s var(--ease-out);border:0;border-radius:10px;justify-content:center;align-items:center;gap:10px;padding:0 18px;font-size:15px;font-weight:560;text-decoration:none;display:inline-flex}.btn:active{transform:scale(.97)}.btn-primary{color:#fff;background:var(--sheen), var(--accent-fill);box-shadow:inset 0 1px #ffffff29,0 0 0 1px #0006,0 6px 20px #6163d047}.btn-primary:hover{background:var(--sheen), var(--accent-fill-hover);box-shadow:inset 0 1px #fff3,0 0 0 1px #0006,0 8px 28px #6163d066}.btn-ghost{color:var(--text-2);box-shadow:inset 0 0 0 1px var(--line-2), var(--top-light);background:#ffffff0a}.btn-ghost:hover{color:var(--text-1);background:#ffffff12}.btn-lg{--h:52px;border-radius:12px;padding:0 24px;font-size:16px}.btn svg{flex:none}canvas.world{z-index:0;pointer-events:none;opacity:0;transition:opacity 1.4s var(--ease-out);position:fixed;top:0;left:0}html.gl-on canvas.world{opacity:1}main,.final,.foot{z-index:1;position:relative}.btn{position:relative}.btn .ring{left:var(--rx);top:var(--ry);pointer-events:none;width:10px;height:10px;animation:btn-ring .8s var(--ease-out) forwards;border-radius:50%;margin:-5px;position:absolute;box-shadow:0 0 0 2px #d2d4fff2,0 0 24px #8b8ef7e6}@keyframes btn-ring{to{opacity:0;transform:scale(22)}}html.js.tier-a [data-reveal],html.js.tier-b [data-reveal]{opacity:0;transform:translateY(16px)}html.js.tier-b [data-reveal]{transition:opacity .7s var(--ease-out), transform .7s var(--ease-out);transition-delay:var(--d,0s)}html.js.tier-b [data-reveal].in{opacity:1;transform:none}@media (prefers-reduced-motion:reduce){*,:before,:after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}html.tier-c *,html.tier-c :before,html.tier-c :after{transition:none!important;animation:none!important}.logo[data-astro-cid-f7espo7c]{flex:none;max-width:none;display:block}\n.inv[data-astro-cid-bgarrque]{background:radial-gradient(900px 520px at 50% -10%, #8b8ef724, transparent 70%), var(--bg-0);align-content:center;place-items:center;gap:24px;min-height:100svh;padding:48px 16px;display:grid}.mark[data-astro-cid-bgarrque]{opacity:.9}.card[data-astro-cid-bgarrque]{width:min(460px,100%);box-shadow:0 0 0 1px #00000080, inset 0 0 0 1px var(--line-2), inset 0 1px 0 #ffffff0d, 0 40px 100px #00000080;animation:rise .42s var(--ease-out) both;background:#121214;border-radius:20px;gap:10px;padding:32px;display:grid}@keyframes rise{0%{opacity:0;transform:translateY(10px)}}.faces[data-astro-cid-bgarrque]{align-items:center;margin-bottom:8px;display:flex}.face[data-astro-cid-bgarrque],.tile[data-astro-cid-bgarrque]{color:var(--text-1);place-items:center;font-weight:600;display:grid;overflow:hidden}.face[data-astro-cid-bgarrque]{z-index:1;background:#24252a;border-radius:999px;width:48px;height:48px;position:relative;box-shadow:0 0 0 4px #121214}.tile[data-astro-cid-bgarrque]{background:oklch(.32 .06 var(--h,279));width:52px;height:52px;color:oklch(.92 .05 var(--h,279));border-radius:14px;font-size:17px;box-shadow:inset 0 0 0 1px #ffffff14}.face[data-astro-cid-bgarrque]:not([hidden])+.tile[data-astro-cid-bgarrque]{margin-left:-12px}.face[data-astro-cid-bgarrque] img,.tile[data-astro-cid-bgarrque] img{object-fit:cover;width:100%;height:100%}.lead[data-astro-cid-bgarrque]{color:var(--text-3);font-size:15px}h1[data-astro-cid-bgarrque]{color:var(--text-1);letter-spacing:-.025em;text-wrap:balance;font-size:30px;line-height:1.15}.meta[data-astro-cid-bgarrque]{color:var(--text-3);min-height:1.4em;font-size:14px}.actions[data-astro-cid-bgarrque]{flex-wrap:wrap;gap:8px;margin-top:14px;display:flex}.actions[data-astro-cid-bgarrque] .btn[data-astro-cid-bgarrque]{flex:180px;justify-content:center}[data-astro-cid-bgarrque][aria-disabled=true]{opacity:.45;pointer-events:none}.steps[data-astro-cid-bgarrque]{color:var(--text-3);gap:6px;margin:14px 0 0;padding-left:20px;font-size:14px;display:grid}.steps[data-astro-cid-bgarrque] strong[data-astro-cid-bgarrque],.code[data-astro-cid-bgarrque] strong[data-astro-cid-bgarrque]{color:var(--text-2);font-weight:600}.code[data-astro-cid-bgarrque]{color:var(--text-3);margin-top:6px;font-size:13px}.code[data-astro-cid-bgarrque] code[data-astro-cid-bgarrque]{color:var(--text-1);letter-spacing:.04em;background:#ffffff0f;border-radius:6px;padding:2px 6px;font-family:ui-monospace,Cascadia Code,monospace}.note[data-astro-cid-bgarrque]{color:var(--text-4);text-align:center;max-width:460px;font-size:12px}@media (prefers-reduced-motion:reduce){.card[data-astro-cid-bgarrque]{animation:none}}\n"}],"routeData":{"route":"/i","isIndex":true,"type":"page","pattern":"^\\/i\\/?$","segments":[[{"content":"i","dynamic":false,"spread":false}]],"params":[],"component":"src/pages/i/index.astro","pathname":"/i","prerender":true,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}},{"file":"","links":[],"scripts":[],"styles":[{"type":"inline","content":":root{color-scheme:dark;--bg-0:#08080a;--bg-1:#0b0b0c;--bg-2:#0f1011;--bg-3:#161718;--bg-4:#1b1b1d;--text-1:#f7f8f8;--text-2:#d0d6e0;--text-3:#8a8f98;--text-4:#62666d;--line-1:#ffffff0d;--line-2:#ffffff14;--line-3:#ffffff1f;--accent:#8b8ef7;--accent-hover:#a2a8fc;--accent-fill:#6163d0;--accent-fill-hover:#6466d4;--accent-tint:#8b8ef71a;--online:#61c28e;--live:#e86885;--live-fill:#be395e;--sheen:linear-gradient(180deg, #ffffff1a, #fff0 55%);--top-light:inset 0 1px 0 #ffffff0d;--elev:0 0 0 1px #00000073, 0 4px 12px #00000038, 0 16px 40px #00000061;--ease-out:cubic-bezier(.165, .84, .44, 1);--ease-sheet:cubic-bezier(.32, .72, 0, 1);--gutter:clamp(16px, 4vw, 40px);--maxw:1200px;--font:\"Inter Variable\", \"Inter Fallback\", system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif}*,:before,:after{box-sizing:border-box}html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-padding-top:72px}html.lenis,html.lenis body{height:auto}.lenis.lenis-smooth{scroll-behavior:auto!important}body{background:var(--bg-1);color:var(--text-2);font-family:var(--font);font-feature-settings:\"calt\", \"cv01\", \"ss03\";-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;margin:0;font-size:16px;line-height:1.6;overflow-x:clip}img,svg,video{max-width:100%;height:auto;display:block}a{color:inherit}button{font:inherit;color:inherit}::selection{color:#fff;background:#6e72e861}:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}h1,h2,h3{color:var(--text-1);font-variation-settings:\"opsz\" 32;text-wrap:balance;margin:0;font-weight:620}h1{letter-spacing:-.035em;font-size:clamp(40px,7.4vw,88px);line-height:1.02}h2{letter-spacing:-.03em;font-size:clamp(32px,5vw,60px);line-height:1.05}h3{letter-spacing:-.016em;font-size:clamp(18px,1.6vw,21px);font-weight:590;line-height:1.3}p{text-wrap:pretty;margin:0}.tnum{font-variant-numeric:tabular-nums}.wrap{width:100%;max-width:var(--maxw);padding-inline:var(--gutter);margin-inline:auto}.eyebrow{letter-spacing:0;color:var(--accent);align-items:center;gap:8px;font-size:13px;font-weight:510;display:inline-flex}.lede{color:var(--text-3);max-width:38em;font-size:clamp(17px,1.5vw,20px);line-height:1.55}.lede strong{color:var(--text-2);font-weight:510}.sr-only{clip:rect(0 0 0 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.skip{z-index:1000;background:var(--bg-4);color:var(--text-1);border-radius:8px;padding:10px 14px;text-decoration:none;position:absolute;top:-60px;left:12px}.skip:focus{top:12px}.btn{--h:44px;height:var(--h);letter-spacing:-.008em;white-space:nowrap;cursor:pointer;transition:background-color .12s var(--ease-out), box-shadow .12s var(--ease-out), transform .16s var(--ease-out);border:0;border-radius:10px;justify-content:center;align-items:center;gap:10px;padding:0 18px;font-size:15px;font-weight:560;text-decoration:none;display:inline-flex}.btn:active{transform:scale(.97)}.btn-primary{color:#fff;background:var(--sheen), var(--accent-fill);box-shadow:inset 0 1px #ffffff29,0 0 0 1px #0006,0 6px 20px #6163d047}.btn-primary:hover{background:var(--sheen), var(--accent-fill-hover);box-shadow:inset 0 1px #fff3,0 0 0 1px #0006,0 8px 28px #6163d066}.btn-ghost{color:var(--text-2);box-shadow:inset 0 0 0 1px var(--line-2), var(--top-light);background:#ffffff0a}.btn-ghost:hover{color:var(--text-1);background:#ffffff12}.btn-lg{--h:52px;border-radius:12px;padding:0 24px;font-size:16px}.btn svg{flex:none}canvas.world{z-index:0;pointer-events:none;opacity:0;transition:opacity 1.4s var(--ease-out);position:fixed;top:0;left:0}html.gl-on canvas.world{opacity:1}main,.final,.foot{z-index:1;position:relative}.btn{position:relative}.btn .ring{left:var(--rx);top:var(--ry);pointer-events:none;width:10px;height:10px;animation:btn-ring .8s var(--ease-out) forwards;border-radius:50%;margin:-5px;position:absolute;box-shadow:0 0 0 2px #d2d4fff2,0 0 24px #8b8ef7e6}@keyframes btn-ring{to{opacity:0;transform:scale(22)}}html.js.tier-a [data-reveal],html.js.tier-b [data-reveal]{opacity:0;transform:translateY(16px)}html.js.tier-b [data-reveal]{transition:opacity .7s var(--ease-out), transform .7s var(--ease-out);transition-delay:var(--d,0s)}html.js.tier-b [data-reveal].in{opacity:1;transform:none}@media (prefers-reduced-motion:reduce){*,:before,:after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}html.tier-c *,html.tier-c :before,html.tier-c :after{transition:none!important;animation:none!important}.logo[data-astro-cid-f7espo7c]{flex:none;max-width:none;display:block}\n.nav[data-astro-cid-wpvy4v7s]{z-index:100;pointer-events:none;justify-content:center;padding-inline:12px;display:flex;position:fixed;inset:12px 0 auto}.bar[data-astro-cid-wpvy4v7s]{pointer-events:auto;width:min(100%,980px);height:56px;box-shadow:none;transition:background-color .3s var(--ease-out), box-shadow .3s var(--ease-out), backdrop-filter .3s var(--ease-out);background:0 0;border-radius:16px;align-items:center;gap:8px;padding:0 8px 0 18px;display:flex}.nav[data-astro-cid-wpvy4v7s].scrolled .bar[data-astro-cid-wpvy4v7s]{backdrop-filter:blur(20px)saturate(1.6);box-shadow:inset 0 0 0 1px var(--line-2), inset 0 1px 0 #ffffff0f, 0 12px 40px #0006;background:#121215b8}html.tier-c .nav[data-astro-cid-wpvy4v7s].scrolled .bar[data-astro-cid-wpvy4v7s],html.tier-b .nav[data-astro-cid-wpvy4v7s].scrolled .bar[data-astro-cid-wpvy4v7s]{backdrop-filter:none;background:#101012f5}.home[data-astro-cid-wpvy4v7s]{border-radius:8px;align-items:center;height:40px;text-decoration:none;display:inline-flex}nav[data-astro-cid-wpvy4v7s]{flex:1;justify-content:center;display:flex}ul[data-astro-cid-wpvy4v7s]{gap:2px;margin:0;padding:0;list-style:none;display:flex}ul[data-astro-cid-wpvy4v7s] a[data-astro-cid-wpvy4v7s]{height:34px;color:var(--text-3);transition:color .12s var(--ease-out), background-color .12s var(--ease-out);border-radius:8px;align-items:center;padding:0 12px;font-size:14px;font-weight:510;text-decoration:none;display:inline-flex}ul[data-astro-cid-wpvy4v7s] a[data-astro-cid-wpvy4v7s]:hover{color:var(--text-1);background:#ffffff0d;transition-duration:0s}ul[data-astro-cid-wpvy4v7s] a[data-astro-cid-wpvy4v7s][aria-current]{color:var(--text-1);background:#ffffff0f}.bar[data-astro-cid-wpvy4v7s] .nav-cta{--h:40px;padding:0 16px;font-size:14px}@media (width<=860px){nav[data-astro-cid-wpvy4v7s]{visibility:hidden}.bar[data-astro-cid-wpvy4v7s]{padding-left:14px}}.hero[data-astro-cid-ge2uvauf]{isolation:isolate;position:relative}.stage[data-astro-cid-ge2uvauf]{position:relative}.backdrop[data-astro-cid-ge2uvauf]{z-index:-1;pointer-events:none;background:radial-gradient(70% 55% at 62% 0,#5c60d657,#5c60d600 70%),radial-gradient(50% 40% at 30% 10%,#8b8ef71f,#8b8ef700 70%),linear-gradient(#10112a 0%,#0b0b10 70%);height:120vh;position:absolute;inset:0 0 auto}html.gl-on .backdrop[data-astro-cid-ge2uvauf]{opacity:0;transition:opacity 1.6s var(--ease-out)}.copy[data-astro-cid-ge2uvauf]{z-index:2;justify-items:start;gap:24px;padding-top:clamp(120px,20vh,200px);display:grid;position:relative}.pill[data-astro-cid-ge2uvauf]{height:30px;color:var(--text-2);box-shadow:inset 0 0 0 1px var(--line-2), var(--top-light);backdrop-filter:blur(10px);background:#ffffff0d;border-radius:999px;align-items:center;gap:8px;padding:0 12px 0 10px;font-size:13px;font-weight:510;display:inline-flex}.live-dot[data-astro-cid-ge2uvauf]{background:var(--online);border-radius:50%;width:6px;height:6px;box-shadow:0 0 0 3px #61c28e29}.title[data-astro-cid-ge2uvauf]{letter-spacing:-.055em;text-wrap:initial;font-size:clamp(56px,10.4vw,156px);font-weight:640;line-height:.92}.title[data-astro-cid-ge2uvauf] .line[data-astro-cid-ge2uvauf]{display:block}.title[data-astro-cid-ge2uvauf] .line[data-astro-cid-ge2uvauf]+.line[data-astro-cid-ge2uvauf]{color:#a9acff}.word[data-astro-cid-ge2uvauf]{white-space:nowrap;margin-right:.22em;display:inline-block}.ch[data-astro-cid-ge2uvauf]{display:inline-block}.lede[data-astro-cid-ge2uvauf]{max-width:30em;color:var(--text-3)}.ctas[data-astro-cid-ge2uvauf]{flex-wrap:wrap;gap:12px;margin-top:4px;display:flex}.dl-note[data-astro-cid-ge2uvauf]{color:var(--text-3);max-width:46ch;margin-top:-10px;font-size:12.5px}html.tier-a .ch[data-astro-cid-ge2uvauf]{animation:from-light 1.1s var(--ease-out) both}html.tier-b .ch[data-astro-cid-ge2uvauf]{animation:rise .9s var(--ease-out) both}html.tier-a .rise[data-astro-cid-ge2uvauf],html.tier-b .rise[data-astro-cid-ge2uvauf]{animation:rise 1s var(--ease-out) both;animation-delay:var(--d)}@keyframes from-light{0%{opacity:.001;filter:blur(16px);text-shadow:0 0 28px #8b8ef7e6;transform:translateY(.18em)scale(1.25)}60%{text-shadow:0 0 18px #a2a8fc99}to{opacity:1;filter:blur();text-shadow:0 0 #8b8ef700;transform:none}}@keyframes rise{0%{opacity:.001;transform:translateY(18px)}}.cue[data-astro-cid-ge2uvauf]{display:none}.hero-media[data-astro-cid-ge2uvauf]{z-index:0;pointer-events:none;width:min(46vw,600px);height:min(100vh,900px);position:absolute;top:0;right:max(0px,50vw - 720px);-webkit-mask-image:radial-gradient(70% 60% at 50% 55%,#000 55%,#0000 100%);mask-image:radial-gradient(70% 60% at 50% 55%,#000 55%,#0000 100%)}.hero-media[data-astro-cid-ge2uvauf] picture,.hero-media[data-astro-cid-ge2uvauf] img,.hero-media[data-astro-cid-ge2uvauf] video{object-fit:cover;width:100%;height:100%;position:absolute;inset:0}html.tier-a .hero-media[data-astro-cid-ge2uvauf]{display:none}.scene[data-astro-cid-ge2uvauf]{z-index:1;width:min(1120px, calc(100vw - 2 * var(--gutter)));perspective:2000px;margin:clamp(56px,9vh,96px) auto 0;padding-bottom:clamp(72px,12vh,140px);position:relative}.tilt[data-astro-cid-ge2uvauf]{transform-style:preserve-3d}.win[data-astro-cid-ge2uvauf]{aspect-ratio:16/9;transform-style:preserve-3d;border-radius:14px;position:relative}.slab[data-astro-cid-ge2uvauf]{box-shadow:0 0 0 1px #ffffff17, inset 0 0 0 1px rgba(160, 165, 255, calc(var(--ex,0) * .5)), 0 30px 80px #0009, 0 0 140px #6163d038;background:linear-gradient(160deg,#282a508c,#0a0a10d9);border-radius:14px;position:absolute;inset:0}.layer[data-astro-cid-ge2uvauf]{left:var(--x);top:var(--y);width:var(--w);height:var(--h);transform-style:preserve-3d;backface-visibility:hidden;position:absolute;overflow:hidden}.layer[data-astro-cid-ge2uvauf] img[data-astro-cid-ge2uvauf]{max-width:none;width:var(--iw);height:auto;left:var(--ix);top:var(--iy);aspect-ratio:16/9;position:absolute}.l-bar[data-astro-cid-ge2uvauf]{border-radius:14px 14px 0 0}.l-rail[data-astro-cid-ge2uvauf]{border-bottom-left-radius:14px}.l-side2[data-astro-cid-ge2uvauf]{border-bottom-right-radius:14px}.pop[data-astro-cid-ge2uvauf]{opacity:0;border-radius:10px}.tag[data-astro-cid-ge2uvauf]{display:none}.sheen[data-astro-cid-ge2uvauf],.flash[data-astro-cid-ge2uvauf]{pointer-events:none;border-radius:14px;position:absolute;inset:0}.sheen[data-astro-cid-ge2uvauf]{opacity:0;background:linear-gradient(115deg,#fff0 30%,#c8ccff29 46%,#ffffff0a 52%,#fff0 64%) 0 0/260% 100%;background-position:var(--sx,100%) 0;transform:translateZ(1px)}.flash[data-astro-cid-ge2uvauf]{opacity:0;transform:translateZ(2px);box-shadow:inset 0 0 0 1.5px #c8ccffe6,0 0 60px #8b8ef799}.cap[data-astro-cid-ge2uvauf]{display:none}html.tier-a .hero[data-astro-cid-ge2uvauf]{height:560vh}html.tier-a .stage[data-astro-cid-ge2uvauf]{height:100lvh;position:sticky;top:0;overflow:hidden}html.tier-a .copy[data-astro-cid-ge2uvauf]{margin-inline:auto;position:absolute;inset:0 0 auto}html.tier-a .scene[data-astro-cid-ge2uvauf]{transform:translate(-50%, -50%) scale(var(--bump,1));opacity:0;width:min(1120px,86vw);margin:0;padding:0;position:absolute;top:52%;left:50%}html.tier-a .tilt[data-astro-cid-ge2uvauf]{transform:rotateX(64deg)}html.tier-a .win[data-astro-cid-ge2uvauf]{--zk:1;transform:translateY(75vh)scale(.86)}html.tier-a .layer[data-astro-cid-ge2uvauf]{transform:translateZ(calc(var(--z) * var(--zk) * (var(--ex,0) + var(--lift,0) * .2)));box-shadow:0 0 0 1px rgba(170, 175, 255, calc(var(--ex,0) * .85)), 0 0 24px rgba(139, 142, 247, calc(var(--ex,0) * .35)), 0 30px 60px rgba(0, 0, 0, calc(var(--ex,0) * .6))}html.tier-a .pop[data-astro-cid-ge2uvauf]{opacity:var(--ex,0);transform:translateZ(calc(var(--z) * var(--zk) * var(--ex,0)))}html.tier-a .tag[data-astro-cid-ge2uvauf]{left:var(--ax);top:var(--ay);z-index:2;opacity:0;width:max-content;max-width:24ch;color:var(--text-1);transform-origin:50% 100%;transform:translate(-50%, -100%) translateZ(calc(var(--z) * var(--zk))) rotateZ(var(--rz,0deg)) rotateX(var(--rx,0deg)) translateY(-60px);pointer-events:none;background:#101122db;border-radius:10px;padding:8px 12px;font-size:14px;font-weight:560;line-height:1.3;display:block;position:absolute;box-shadow:inset 0 0 0 1px #a0a5ff66,0 12px 32px #00000080}html.tier-a .tag[data-astro-cid-ge2uvauf]:after{content:\"\";background:linear-gradient(#a0a5ffcc,#a0a5ff00);width:1px;height:60px;position:absolute;top:100%;left:50%}html.tier-a .tag[data-astro-cid-ge2uvauf]:before{content:\"\";background:#a9acff;border-radius:50%;width:7px;height:7px;position:absolute;top:calc(100% + 57px);left:calc(50% - 3px);box-shadow:0 0 12px #8b8ef7}html.tier-a .cue[data-astro-cid-ge2uvauf]{letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);animation:rise 1s var(--ease-out) 1.4s both;flex-direction:column;align-items:center;gap:10px;font-size:12px;font-weight:560;display:flex;position:absolute;bottom:28px;left:50%;transform:translate(-50%)}html.tier-a .cue[data-astro-cid-ge2uvauf] span[data-astro-cid-ge2uvauf]{width:1px;height:36px;animation:drip 2.2s var(--ease-out) infinite;transform-origin:50% 0;background:linear-gradient(#8b8ef700,#8b8ef7)}@keyframes drip{0%{opacity:1;transform:scaleY(0)}60%{opacity:1;transform:scaleY(1)}to{opacity:0;transform:scaleY(1)}}html.tier-a .cap[data-astro-cid-ge2uvauf]{text-align:center;z-index:3;opacity:0;letter-spacing:-.035em;color:var(--text-1);font-variation-settings:\"opsz\" 32;text-shadow:0 2px 30px #0009;font-size:clamp(26px,3.4vw,46px);font-weight:620;line-height:1.08;display:block;position:absolute;bottom:clamp(28px,7vh,72px);left:0;right:0}html.tier-a .cap[data-astro-cid-ge2uvauf] span[data-astro-cid-ge2uvauf]{color:var(--accent)}html.tier-a .c2[data-astro-cid-ge2uvauf]{text-align:left;left:max(var(--gutter), calc(50vw - 600px));bottom:clamp(28px,8vh,80px);right:auto}@media (width<=760px){.copy[data-astro-cid-ge2uvauf]{text-align:center;justify-items:center;padding-top:112px}.title[data-astro-cid-ge2uvauf]{font-size:clamp(52px,15vw,72px)}.word[data-astro-cid-ge2uvauf]{margin-right:.18em}.ctas[data-astro-cid-ge2uvauf]{justify-content:center}.hero-media[data-astro-cid-ge2uvauf]{width:100%;height:52vh;position:absolute;inset:auto 0 -40px}html.tier-a .scene[data-astro-cid-ge2uvauf]{width:92vw;top:50%}html.tier-a .tag[data-astro-cid-ge2uvauf],html.tier-a .cue[data-astro-cid-ge2uvauf]{display:none}html.tier-a .win[data-astro-cid-ge2uvauf]{--zk:.5}html.tier-a .copy[data-astro-cid-ge2uvauf]{padding-top:104px}}.voice[data-astro-cid-d6druz62]{padding-bottom:clamp(64px,10vh,120px);position:relative}.room-ch[data-astro-cid-d6druz62]{position:relative}.anchor[data-astro-cid-d6druz62]{position:absolute;top:0;left:0}.room-stage[data-astro-cid-d6druz62]{padding-block:clamp(96px,14vh,160px) 24px;position:relative}.room-gl[data-astro-cid-d6druz62],.names[data-astro-cid-d6druz62],.caption[data-astro-cid-d6druz62],.latency[data-astro-cid-d6druz62],.listen[data-astro-cid-d6druz62]{display:none}.room-head[data-astro-cid-d6druz62]{z-index:2;position:relative}.room-media[data-astro-cid-d6druz62]{margin-top:clamp(28px,4vh,48px)}.room-media[data-astro-cid-d6druz62] img,.room-media[data-astro-cid-d6druz62] video{aspect-ratio:16/9;object-fit:cover;background:#010102;border-radius:16px;width:100%;height:auto;display:block}.room-media[data-astro-cid-d6druz62] video{position:absolute;inset:0}.room-media[data-astro-cid-d6druz62]{position:relative}.room-media[data-astro-cid-d6druz62] video{left:var(--gutter);right:var(--gutter);width:calc(100% - 2 * var(--gutter))}html.tier-a .room-media[data-astro-cid-d6druz62]{display:none}.chapter-t[data-astro-cid-d6druz62] em[data-astro-cid-d6druz62]{color:#a9acff;font-style:normal}.room-lede[data-astro-cid-d6druz62]{color:var(--text-3);margin-top:12px;font-size:clamp(16px,1.4vw,19px)}.transcript[data-astro-cid-d6druz62]{padding:0 var(--gutter);max-width:var(--maxw);gap:10px;margin:clamp(32px,5vh,56px) auto 0;list-style:none;display:grid}.transcript[data-astro-cid-d6druz62] li[data-astro-cid-d6druz62]{letter-spacing:-.02em;color:var(--text-2);align-items:baseline;gap:10px;font-size:clamp(18px,2.2vw,28px);line-height:1.3;display:flex}.transcript[data-astro-cid-d6druz62] b[data-astro-cid-d6druz62]{color:var(--text-1);flex:none;font-weight:600}.transcript[data-astro-cid-d6druz62] .dots[data-astro-cid-d6druz62]{flex:none;display:inline-flex;transform:translateY(2px)}.transcript[data-astro-cid-d6druz62] .dots[data-astro-cid-d6druz62] i[data-astro-cid-d6druz62]{width:18px;height:18px;box-shadow:0 0 0 2px var(--bg-1);border-radius:50%;margin-right:-5px}.transcript[data-astro-cid-d6druz62] .laugh[data-astro-cid-d6druz62] span[data-astro-cid-d6druz62]{color:#a9acff}html.tier-a .room-ch[data-astro-cid-d6druz62]{height:460vh}html.tier-a .room-ch[data-astro-cid-d6druz62]:before{content:\"\";pointer-events:none;background:linear-gradient(#01010200,#010102);height:50vh;position:absolute;top:-50vh;left:0;right:0}html.tier-a .room-ch[data-astro-cid-d6druz62]:after{content:\"\";pointer-events:none;background:linear-gradient(#010102,#01010200);height:40vh;position:absolute;bottom:-40vh;left:0;right:0}html.tier-a .anchor[data-astro-cid-d6druz62]{top:57.6vh}html.tier-a .room-stage[data-astro-cid-d6druz62]{background:#010102;height:100lvh;padding:0;position:sticky;top:0;overflow:hidden}html.tier-a .room-gl[data-astro-cid-d6druz62]{display:block;position:absolute;inset:0}html.tier-a .room-gl[data-astro-cid-d6druz62] canvas{width:100%;height:100%;display:block}html.tier-a .room-head[data-astro-cid-d6druz62]{pointer-events:none;position:absolute;top:clamp(88px,13vh,132px);left:0;right:0}html.tier-a .transcript[data-astro-cid-d6druz62]{clip:rect(0 0 0 0);width:1px;height:1px;margin:0;padding:0;position:absolute;overflow:hidden}html.tier-a .names[data-astro-cid-d6druz62]{pointer-events:none;display:block;position:absolute;inset:0}.name[data-astro-cid-d6druz62]{color:var(--text-3);white-space:nowrap;opacity:0;transition:color .16s var(--ease-out), box-shadow .16s var(--ease-out);background:#0a0a1099;border-radius:999px;padding:3px 9px;font-size:13px;font-weight:560;position:absolute;top:0;left:0}.name[data-astro-cid-d6druz62].on{color:var(--text-1);box-shadow:inset 0 0 0 1px #a0a5ff80}html.tier-a .caption[data-astro-cid-d6druz62]{text-align:center;letter-spacing:-.025em;width:min(92vw,860px);color:var(--text-1);text-wrap:balance;text-shadow:0 2px 24px #000c;min-height:2.4em;font-size:clamp(22px,2.8vw,38px);font-weight:580;line-height:1.2;display:block;position:absolute;bottom:clamp(76px,9vh,104px);left:50%;transform:translate(-50%)}.caption[data-astro-cid-d6druz62] b[data-astro-cid-d6druz62]{letter-spacing:.06em;text-transform:uppercase;color:#a9acff;margin-bottom:6px;font-size:13px;font-weight:600;display:block}html.tier-a .listen[data-astro-cid-d6druz62]{right:max(var(--gutter), calc(50vw - 600px));z-index:3;cursor:pointer;height:44px;color:var(--text-1);backdrop-filter:blur(12px);background:#ffffff0f;border:0;border-radius:999px;align-items:center;gap:10px;padding:0 18px 0 14px;font-size:14px;font-weight:560;display:inline-flex;position:absolute;bottom:clamp(24px,4vh,40px);box-shadow:inset 0 0 0 1px #a0a5ff59}.listen[data-astro-cid-d6druz62]:hover{background:#8b8ef729}.eq[data-astro-cid-d6druz62]{align-items:center;gap:2px;height:16px;display:inline-flex}.eq[data-astro-cid-d6druz62] i[data-astro-cid-d6druz62]{background:#a9acff;border-radius:1px;width:2px;height:100%;transform:scaleY(.3)}.listen[data-astro-cid-d6druz62][aria-pressed=true] .eq[data-astro-cid-d6druz62] i[data-astro-cid-d6druz62]{animation:.7s ease-in-out infinite alternate eq}.eq[data-astro-cid-d6druz62] i[data-astro-cid-d6druz62]:nth-child(2){animation-delay:-200ms}.eq[data-astro-cid-d6druz62] i[data-astro-cid-d6druz62]:nth-child(3){animation-delay:-450ms}.eq[data-astro-cid-d6druz62] i[data-astro-cid-d6druz62]:nth-child(4){animation-delay:-100ms}@keyframes eq{0%{transform:scaleY(.25)}to{transform:scaleY(1)}}.l-on[data-astro-cid-d6druz62],.listen[data-astro-cid-d6druz62][aria-pressed=true] .l-off[data-astro-cid-d6druz62]{display:none}.listen[data-astro-cid-d6druz62][aria-pressed=true] .l-on[data-astro-cid-d6druz62]{display:inline}html.tier-a .latency[data-astro-cid-d6druz62]{text-align:center;opacity:0;pointer-events:none;color:var(--text-2);letter-spacing:-.01em;font-size:clamp(18px,2vw,26px);font-weight:520;display:block;position:absolute;top:50%;left:0;right:0;transform:translateY(-50%)}html.tier-a .latency[data-astro-cid-d6druz62]:before{content:\"\";z-index:-1;background:radial-gradient(closest-side,#010102d9,#01010200);position:absolute;inset:-30vh -10vw}.latency[data-astro-cid-d6druz62] span[data-astro-cid-d6druz62]{letter-spacing:-.06em;color:var(--text-1);font-variation-settings:\"opsz\" 32;text-shadow:0 0 60px #8b8ef780;font-size:clamp(96px,17vw,240px);font-weight:640;line-height:.9;display:block}.voice[data-astro-cid-d6druz62]:before{content:\"\";z-index:-1;pointer-events:none;background:radial-gradient(50% 40% at 15% 30%,#6163d01f,#0000 70%);position:absolute;inset:0}h2[data-astro-cid-d6druz62]{margin-top:14px}.lit[data-astro-cid-d6druz62]{letter-spacing:-.025em;font-variation-settings:\"opsz\" 32;max-width:22em;color:var(--text-1);margin-top:clamp(64px,10vh,120px);font-size:clamp(26px,3.6vw,46px);font-weight:560;line-height:1.18}.lit[data-astro-cid-d6druz62] span[data-astro-cid-d6druz62]{color:var(--text-3)}.grid[data-astro-cid-d6druz62]{grid-template-columns:repeat(3,1fr);gap:12px;margin-top:clamp(48px,8vh,88px);display:grid}.stat[data-astro-cid-d6druz62],.noise[data-astro-cid-d6druz62]{box-shadow:inset 0 0 0 1px var(--line-1), var(--top-light);background:linear-gradient(#ffffff09,#ffffff04);border-radius:16px;padding:24px;position:relative}.num[data-astro-cid-d6druz62]{letter-spacing:-.04em;color:var(--text-1);font-variation-settings:\"opsz\" 32;font-size:clamp(44px,5.4vw,68px);font-weight:600;line-height:1}.num[data-astro-cid-d6druz62] small[data-astro-cid-d6druz62]{letter-spacing:-.01em;color:var(--text-3);font-size:.4em;font-weight:510}.big[data-astro-cid-d6druz62] .num[data-astro-cid-d6druz62]{color:var(--accent)}.stat[data-astro-cid-d6druz62] h3[data-astro-cid-d6druz62]{margin-top:14px;font-size:16px}.note[data-astro-cid-d6druz62]{color:var(--text-3);margin-top:8px;font-size:14px;line-height:1.5}.noise[data-astro-cid-d6druz62]{grid-column:span 2;grid-template-columns:1fr 1.2fr;align-items:center;gap:24px;display:grid;overflow:hidden}.noise[data-astro-cid-d6druz62] h3[data-astro-cid-d6druz62]{font-size:clamp(20px,2vw,24px)}.noise[data-astro-cid-d6druz62] p[data-astro-cid-d6druz62]{color:var(--text-3);margin-top:10px;font-size:15px}.toggle[data-astro-cid-d6druz62]{cursor:pointer;height:40px;box-shadow:inset 0 0 0 1px var(--line-2);color:var(--text-2);background:#ffffff0d;border:0;border-radius:999px;align-items:center;gap:12px;margin-top:20px;padding:0 14px 0 6px;font-size:14px;font-weight:510;display:inline-flex}.knob[data-astro-cid-d6druz62]{width:44px;height:26px;transition:background-color .16s var(--ease-out);background:#ffffff1f;border-radius:999px;position:relative}.knob[data-astro-cid-d6druz62]:after{content:\"\";width:20px;height:20px;transition:transform .22s var(--ease-out);background:#fff;border-radius:50%;position:absolute;top:3px;left:3px;box-shadow:0 1px 2px #0000004d}.toggle[data-astro-cid-d6druz62][aria-pressed=true] .knob[data-astro-cid-d6druz62]{background:var(--sheen), var(--accent-fill)}.toggle[data-astro-cid-d6druz62][aria-pressed=true] .knob[data-astro-cid-d6druz62]:after{transform:translate(18px)}.t-on[data-astro-cid-d6druz62],.toggle[data-astro-cid-d6druz62][aria-pressed=true] .t-off[data-astro-cid-d6druz62]{display:none}.toggle[data-astro-cid-d6druz62][aria-pressed=true] .t-on[data-astro-cid-d6druz62]{display:inline}.wave[data-astro-cid-d6druz62]{width:100%;height:160px}.wave[data-astro-cid-d6druz62] path[data-astro-cid-d6druz62]{fill:none;stroke:url(#wg);stroke-width:2px;stroke-linejoin:round;vector-effect:non-scaling-stroke}.hiss[data-astro-cid-d6druz62]{opacity:.55;transition:opacity .4s var(--ease-out)}.speech[data-astro-cid-d6druz62]{opacity:.35;transition:opacity .4s var(--ease-out)}.noise[data-astro-cid-d6druz62].clean .hiss[data-astro-cid-d6druz62]{opacity:0}.noise[data-astro-cid-d6druz62].clean .speech[data-astro-cid-d6druz62]{opacity:1}html.tier-a .hiss[data-astro-cid-d6druz62]{animation:.18s steps(3,end) infinite jitter}@keyframes jitter{50%{transform:translateY(1.5px)}}.equal[data-astro-cid-d6druz62] .num[data-astro-cid-d6druz62]{font-size:clamp(40px,4.6vw,56px)}.source[data-astro-cid-d6druz62]{color:var(--text-3);max-width:60em;margin-top:20px;font-size:13px}@media (width<=960px){.grid[data-astro-cid-d6druz62]{grid-template-columns:1fr 1fr}.big[data-astro-cid-d6druz62]{grid-column:span 2}.noise[data-astro-cid-d6druz62]{grid-template-columns:1fr}}@media (width<=600px){.grid[data-astro-cid-d6druz62]{grid-template-columns:1fr}.big[data-astro-cid-d6druz62],.noise[data-astro-cid-d6druz62]{grid-column:auto}.stat[data-astro-cid-d6druz62],.noise[data-astro-cid-d6druz62]{padding:20px}}.stream[data-astro-cid-ru23ufmz]{padding-block:clamp(96px,16vh,180px);position:relative}.head[data-astro-cid-ru23ufmz]{gap:16px;max-width:820px;display:grid}h2[data-astro-cid-ru23ufmz] em[data-astro-cid-ru23ufmz]{color:#a9acff;font-style:normal}.screen[data-astro-cid-ru23ufmz]{max-width:calc(1200px + 2 * var(--gutter));margin-top:clamp(40px,7vh,72px)}.frame[data-astro-cid-ru23ufmz]{aspect-ratio:16/9;cursor:none;touch-action:pan-y;background:#070812;border-radius:16px;position:relative;overflow:hidden;box-shadow:0 0 0 1px #ffffff1a,0 40px 120px #0009,0 0 160px #6163d040}.still[data-astro-cid-ru23ufmz],.still[data-astro-cid-ru23ufmz] picture,.still[data-astro-cid-ru23ufmz] img,.game[data-astro-cid-ru23ufmz],.game[data-astro-cid-ru23ufmz] canvas{width:100%;height:100%;position:absolute;inset:0}.still[data-astro-cid-ru23ufmz] img{object-fit:cover}.hi[data-astro-cid-ru23ufmz]{clip-path:circle(var(--lr) at var(--lx) var(--ly))}.hi[data-astro-cid-ru23ufmz]:after{content:\"\";pointer-events:none;position:absolute;inset:0}.frame[data-astro-cid-ru23ufmz]:after{content:\"\";left:var(--lx);top:var(--ly);width:calc(var(--lr) * 2);height:calc(var(--lr) * 2);margin:calc(var(--lr) * -1) 0 0 calc(var(--lr) * -1);pointer-events:none;border-radius:50%;position:absolute;box-shadow:inset 0 0 0 1.5px #dcdeffd9,0 0 0 999px #0000001f,0 12px 40px #00000073}.frame[data-astro-cid-ru23ufmz].gl:after,.frame[data-astro-cid-ru23ufmz].gl .still[data-astro-cid-ru23ufmz],.game[data-astro-cid-ru23ufmz]{display:none}.frame[data-astro-cid-ru23ufmz].gl .game[data-astro-cid-ru23ufmz]{display:block}.live[data-astro-cid-ru23ufmz],.out[data-astro-cid-ru23ufmz],.lens-tag[data-astro-cid-ru23ufmz]{z-index:2;height:28px;color:var(--text-2);box-shadow:inset 0 0 0 1px var(--line-2);pointer-events:none;white-space:nowrap;background:#080912c7;border-radius:8px;align-items:center;gap:8px;padding:0 10px;font-size:12px;font-weight:560;display:inline-flex;position:absolute}.live[data-astro-cid-ru23ufmz]{color:var(--text-1);bottom:14px;left:14px}.live[data-astro-cid-ru23ufmz] i[data-astro-cid-ru23ufmz]{background:var(--live-fill);color:#fff;border-radius:5px;padding:2px 6px;font-size:11px;font-style:normal;font-weight:650}.out[data-astro-cid-ru23ufmz]{bottom:14px;right:14px}.out[data-astro-cid-ru23ufmz] b[data-astro-cid-ru23ufmz],.lens-tag[data-astro-cid-ru23ufmz] b[data-astro-cid-ru23ufmz]{color:var(--text-1);font-weight:650}.lens-tag[data-astro-cid-ru23ufmz]{color:var(--text-1);transform:translate(var(--lx), var(--ly));background:#4648aad9;top:0;left:0;box-shadow:inset 0 0 0 1px #c8ccff66}.lens-tag[data-astro-cid-ru23ufmz] b[data-astro-cid-ru23ufmz]{color:#fff}figcaption[data-astro-cid-ru23ufmz]{color:var(--text-3);max-width:70em;margin:12px 0 0;font-size:13px;line-height:1.5}.tiers[data-astro-cid-ru23ufmz]{grid-template-columns:1fr 1fr 1fr;gap:12px;max-width:1200px;margin:28px auto 0;display:grid}.tier[data-astro-cid-ru23ufmz]{box-shadow:inset 0 0 0 1px var(--line-1), var(--top-light);background:linear-gradient(#ffffff09,#ffffff04);border-radius:16px;padding:22px}.who[data-astro-cid-ru23ufmz]{color:var(--text-3);font-size:13px;font-weight:590}.plus[data-astro-cid-ru23ufmz] .who[data-astro-cid-ru23ufmz]{color:var(--accent)}.tier[data-astro-cid-ru23ufmz] ul[data-astro-cid-ru23ufmz]{flex-wrap:wrap;gap:6px;margin:14px 0 0;padding:0;list-style:none;display:flex}.chip[data-astro-cid-ru23ufmz]{height:30px;color:var(--text-1);box-shadow:inset 0 0 0 1px var(--line-2);font-variant-numeric:tabular-nums;background:#ffffff0f;border-radius:8px;align-items:center;padding:0 10px;font-size:14px;font-weight:590;display:inline-flex}.plus[data-astro-cid-ru23ufmz] .chip[data-astro-cid-ru23ufmz]{background:var(--accent-tint);box-shadow:inset 0 0 0 1px #8b8ef747}.note[data-astro-cid-ru23ufmz]{color:var(--text-3);margin-top:12px;font-size:14px;line-height:1.5}.num[data-astro-cid-ru23ufmz]{letter-spacing:-.04em;color:var(--text-1);font-variation-settings:\"opsz\" 32;font-size:clamp(40px,4.6vw,56px);font-weight:600;line-height:1}.num[data-astro-cid-ru23ufmz] small[data-astro-cid-ru23ufmz]{letter-spacing:-.01em;color:var(--text-3);margin-left:4px;font-size:.36em;font-weight:510}@media (width<=860px){.tiers[data-astro-cid-ru23ufmz]{grid-template-columns:1fr 1fr}.cpu[data-astro-cid-ru23ufmz]{grid-column:span 2}}@media (width<=560px){.tiers[data-astro-cid-ru23ufmz]{grid-template-columns:1fr}.cpu[data-astro-cid-ru23ufmz]{grid-column:auto}.screen[data-astro-cid-ru23ufmz]{padding-inline:0}.frame[data-astro-cid-ru23ufmz]{border-radius:0}.out[data-astro-cid-ru23ufmz]{display:none}.live[data-astro-cid-ru23ufmz],.lens-tag[data-astro-cid-ru23ufmz]{height:24px;font-size:11px}}.light[data-astro-cid-bmokxcqa]{padding-block:clamp(80px,14vh,160px);position:relative}h2[data-astro-cid-bmokxcqa] em[data-astro-cid-bmokxcqa]{color:#a9acff;font-style:normal}.area-note[data-astro-cid-bmokxcqa],.obj[data-astro-cid-bmokxcqa]{display:none}.leve-media[data-astro-cid-bmokxcqa]{width:min(560px, calc(100% - 2 * var(--gutter)));aspect-ratio:1;border-radius:50%;margin:clamp(32px,6vh,64px) auto 0;position:relative;overflow:hidden;-webkit-mask-image:radial-gradient(closest-side,#000 70%,#0000);mask-image:radial-gradient(closest-side,#000 70%,#0000)}.leve-media[data-astro-cid-bmokxcqa] picture,.leve-media[data-astro-cid-bmokxcqa] img,.leve-media[data-astro-cid-bmokxcqa] video{object-fit:cover;width:100%;height:100%;position:absolute;inset:0}html.tier-a .leve-media[data-astro-cid-bmokxcqa]{display:none}html.gl-on .light[data-astro-cid-bmokxcqa]{padding:0}html.gl-on .float-ch[data-astro-cid-bmokxcqa]{height:340vh}html.gl-on .float-stage[data-astro-cid-bmokxcqa]{align-items:center;height:100lvh;display:flex;position:sticky;top:0;overflow:hidden}html.gl-on .two[data-astro-cid-bmokxcqa]{grid-template-columns:minmax(0,520px)}html.gl-on .card[data-astro-cid-bmokxcqa]{clip:rect(0 0 0 0);width:1px;height:1px;margin:0;padding:0;position:absolute;overflow:hidden}html.gl-on .area-note[data-astro-cid-bmokxcqa]{color:var(--text-3);margin-top:8px;font-size:13px;display:block}html.gl-on .obj[data-astro-cid-bmokxcqa]{text-align:center;opacity:0;pointer-events:none;color:var(--text-3);white-space:nowrap;font-size:13px;font-weight:520;display:grid;position:absolute;top:0;left:0;transform:translate(-50%,-50%)}.obj[data-astro-cid-bmokxcqa] b[data-astro-cid-bmokxcqa]{letter-spacing:-.03em;color:var(--text-1);font-size:clamp(20px,2.2vw,30px);font-weight:640}.light-o[data-astro-cid-bmokxcqa] b[data-astro-cid-bmokxcqa]{color:#c9cbff}.two[data-astro-cid-bmokxcqa]{grid-template-columns:1fr 1.1fr;align-items:center;gap:clamp(32px,6vw,80px);display:grid}.copy[data-astro-cid-bmokxcqa]{gap:16px;display:grid}.minis[data-astro-cid-bmokxcqa]{gap:14px;margin:16px 0 0;padding:0;list-style:none;display:grid}.minis[data-astro-cid-bmokxcqa] li[data-astro-cid-bmokxcqa]{border-top:1px solid var(--line-1);align-items:baseline;gap:12px;padding-top:14px;display:flex}.minis[data-astro-cid-bmokxcqa] b[data-astro-cid-bmokxcqa]{letter-spacing:-.02em;min-width:104px;color:var(--text-1);font-size:22px;font-weight:600}.minis[data-astro-cid-bmokxcqa] span[data-astro-cid-bmokxcqa]{color:var(--text-3);font-size:15px}.card[data-astro-cid-bmokxcqa]{box-shadow:inset 0 0 0 1px var(--line-1), var(--top-light), 0 30px 80px #00000059;background:linear-gradient(#ffffff0a,#ffffff04);border-radius:18px;margin:0;padding:clamp(20px,3vw,32px)}.cap[data-astro-cid-bmokxcqa]{color:var(--text-3);font-size:13px;font-weight:510}.row[data-astro-cid-bmokxcqa]{margin-top:24px}.label[data-astro-cid-bmokxcqa]{color:var(--text-2);justify-content:space-between;align-items:baseline;gap:12px;font-size:15px;font-weight:510;display:flex}.label[data-astro-cid-bmokxcqa] small[data-astro-cid-bmokxcqa]{color:var(--text-3);margin-left:6px;font-size:12px;font-weight:400}.label[data-astro-cid-bmokxcqa] b[data-astro-cid-bmokxcqa]{letter-spacing:-.03em;color:var(--text-1);font-size:clamp(22px,2.6vw,30px);font-weight:600}.track[data-astro-cid-bmokxcqa]{height:14px;box-shadow:inset 0 0 0 1px var(--line-1);background:#ffffff0a;border-radius:999px;margin-top:10px;overflow:hidden}.fill[data-astro-cid-bmokxcqa]{height:100%;width:calc(var(--v) * 100%);border-radius:inherit;transform-origin:0}.us[data-astro-cid-bmokxcqa]{background:linear-gradient(90deg,#6163d0,#a2a8fc);box-shadow:0 0 24px #8b8ef780}.them[data-astro-cid-bmokxcqa]{background:linear-gradient(90deg,#3a3b40,#55575e)}html.tier-a .fill[data-astro-cid-bmokxcqa],html.tier-b .fill[data-astro-cid-bmokxcqa]{transform:scaleX(0)}html.tier-b .fill[data-astro-cid-bmokxcqa]{transition:transform 1.2s var(--ease-out)}html.tier-b .card[data-astro-cid-bmokxcqa].in .fill[data-astro-cid-bmokxcqa]{transform:none}figcaption[data-astro-cid-bmokxcqa]{color:var(--text-3);margin-top:24px;font-size:13px;line-height:1.5}@media (width<=900px){.two[data-astro-cid-bmokxcqa]{grid-template-columns:1fr}html.gl-on .float-stage[data-astro-cid-bmokxcqa]{align-items:flex-start;padding-top:96px}html.gl-on .minis[data-astro-cid-bmokxcqa]{display:none}}.group[data-astro-cid-svhkl75q]{padding-block:clamp(80px,14vh,160px);position:relative}.head[data-astro-cid-svhkl75q]{gap:16px;max-width:760px;display:grid}.bento[data-astro-cid-svhkl75q]{grid-template-columns:repeat(6,1fr);gap:12px;margin-top:clamp(40px,7vh,72px);display:grid}.cell[data-astro-cid-svhkl75q]{min-height:260px;box-shadow:inset 0 0 0 1px var(--line-1), var(--top-light);background:linear-gradient(#ffffff09,#ffffff03);border-radius:18px;flex-direction:column;justify-content:flex-end;gap:8px;padding:24px;display:flex;position:relative;overflow:hidden}.cell[data-astro-cid-svhkl75q] h3[data-astro-cid-svhkl75q]{font-size:19px}.cell[data-astro-cid-svhkl75q] p[data-astro-cid-svhkl75q]{color:var(--text-3);font-size:15px;line-height:1.5}.agora[data-astro-cid-svhkl75q],.spaces[data-astro-cid-svhkl75q]{grid-column:span 3}.chat[data-astro-cid-svhkl75q]{grid-column:span 2}.stage[data-astro-cid-svhkl75q]{grid-area:span 2/span 4;justify-content:flex-start}.casa[data-astro-cid-svhkl75q]{background:radial-gradient(120% 90% at 100% 0,#6163d038,#0000 60%),linear-gradient(#ffffff09,#ffffff03);grid-column:span 2}.mock[data-astro-cid-svhkl75q]{background:var(--bg-1);box-shadow:inset 0 0 0 1px var(--line-2);border-radius:12px;margin-bottom:auto;padding:12px}.m-label[data-astro-cid-svhkl75q]{color:var(--accent);align-items:center;gap:6px;padding:0 4px 8px;font-size:12px;font-weight:590;display:flex}.m-row[data-astro-cid-svhkl75q]{border-radius:8px;align-items:center;gap:12px;padding:8px 6px;display:flex}.m-row[data-astro-cid-svhkl75q]+.m-row[data-astro-cid-svhkl75q]{margin-top:2px}.m-row[data-astro-cid-svhkl75q]:first-of-type{background:#9698ff14}.m-row[data-astro-cid-svhkl75q].dim b[data-astro-cid-svhkl75q]{color:var(--text-2)}.stack[data-astro-cid-svhkl75q]{display:flex}.stack[data-astro-cid-svhkl75q] .av[data-astro-cid-svhkl75q]+.av[data-astro-cid-svhkl75q]{margin-left:-8px}.av[data-astro-cid-svhkl75q]{width:26px;height:26px;box-shadow:0 0 0 2px var(--bg-1);border-radius:50%;place-items:center;font-size:10px;font-style:normal;font-weight:590;display:grid}.av-sun[data-astro-cid-svhkl75q]{background:linear-gradient(135deg,#f7c46c,#e86885)}.av-sky[data-astro-cid-svhkl75q]{background:linear-gradient(135deg,#7cc0f5,#2f5ea8)}.av-ink[data-astro-cid-svhkl75q]{color:oklch(86% .03 30);background:oklch(29% .02 30)}.av-plum[data-astro-cid-svhkl75q]{color:oklch(86% .03 295);background:oklch(29% .02 295)}.m-txt[data-astro-cid-svhkl75q]{line-height:1.3;display:grid}.m-txt[data-astro-cid-svhkl75q] b[data-astro-cid-svhkl75q]{color:var(--text-1);font-size:14px;font-weight:590}.m-txt[data-astro-cid-svhkl75q] small[data-astro-cid-svhkl75q]{color:var(--text-3);font-size:12px}.m-join[data-astro-cid-svhkl75q]{color:#fff;background:var(--sheen), var(--accent-fill);border-radius:6px;align-items:center;height:28px;margin-left:auto;padding:0 12px;font-size:13px;font-weight:510;display:inline-flex}html.tier-a .m-row[data-astro-cid-svhkl75q]:first-of-type .stack[data-astro-cid-svhkl75q],html.tier-b .m-row[data-astro-cid-svhkl75q]:first-of-type .stack[data-astro-cid-svhkl75q]{animation:2.4s ease-in-out infinite breathe}@keyframes breathe{50%{filter:brightness(1.12);transform:translateY(-1px)}}.chan[data-astro-cid-svhkl75q]{background:var(--bg-1);box-shadow:inset 0 0 0 1px var(--line-2);border-radius:12px;gap:2px;margin-bottom:auto;padding:12px;display:grid;position:relative}.chan[data-astro-cid-svhkl75q] p[data-astro-cid-svhkl75q]{font-size:13px!important;line-height:1.2!important}.c-head[data-astro-cid-svhkl75q]{padding:2px 6px 8px;font-weight:590;color:var(--text-1)!important}.c-sec[data-astro-cid-svhkl75q]{color:var(--text-3);padding:8px 6px 4px;font-size:11px!important}.c-row[data-astro-cid-svhkl75q]{border-radius:6px;align-items:center;gap:8px;height:26px;padding:0 6px;display:flex;color:var(--text-3)!important}.c-row[data-astro-cid-svhkl75q].on{background:#9698ff21;color:var(--text-1)!important}.h[data-astro-cid-svhkl75q]{width:14px;color:var(--text-3);place-items:center;display:grid}.on[data-astro-cid-svhkl75q] .h[data-astro-cid-svhkl75q],.h[data-astro-cid-svhkl75q].v{color:var(--accent)}.c-n[data-astro-cid-svhkl75q]{color:var(--text-3);margin-left:auto;font-size:11px}.role[data-astro-cid-svhkl75q]{color:#cbc1e1;background:#cbc1e11a;border-radius:999px;align-items:center;height:22px;padding:0 8px;font-size:11px;display:inline-flex;position:absolute;top:12px;right:12px;box-shadow:inset 0 0 0 1px #cbc1e140}.bubbles[data-astro-cid-svhkl75q]{gap:6px;margin-bottom:auto;display:grid}.b[data-astro-cid-svhkl75q]{background:#ffffff0d;border-radius:12px;justify-self:start;padding:8px 12px;color:var(--text-2)!important;font-size:14px!important}.b[data-astro-cid-svhkl75q] b[data-astro-cid-svhkl75q]{color:#a9c8f0;font-size:12px;font-weight:590;display:block}.b[data-astro-cid-svhkl75q].me b[data-astro-cid-svhkl75q]{color:#f0b6a0}.react[data-astro-cid-svhkl75q]{gap:6px;display:flex}.react[data-astro-cid-svhkl75q] span[data-astro-cid-svhkl75q]{color:var(--text-2);background:#8b8ef71f;border-radius:999px;padding:2px 8px;font-size:12px;box-shadow:inset 0 0 0 1px #8b8ef74d}.shot[data-astro-cid-svhkl75q]{border-radius:12px;margin:-4px -4px 16px;overflow:hidden;box-shadow:0 0 0 1px #ffffff14,0 20px 60px #00000073}.shot[data-astro-cid-svhkl75q] img{aspect-ratio:151/76;object-fit:cover;width:100%}.stage[data-astro-cid-svhkl75q] h3[data-astro-cid-svhkl75q]{margin-top:auto}.soon[data-astro-cid-svhkl75q]{height:24px;color:var(--accent);background:var(--accent-tint);border-radius:999px;align-self:flex-start;align-items:center;margin-bottom:auto;padding:0 10px;font-size:12px;font-weight:590;display:inline-flex;box-shadow:inset 0 0 0 1px #8b8ef74d}@media (width<=1000px){.bento[data-astro-cid-svhkl75q]{grid-template-columns:repeat(2,1fr)}.agora[data-astro-cid-svhkl75q],.stage[data-astro-cid-svhkl75q]{grid-area:auto/span 2}.spaces[data-astro-cid-svhkl75q],.chat[data-astro-cid-svhkl75q],.casa[data-astro-cid-svhkl75q]{grid-column:span 1}.casa[data-astro-cid-svhkl75q]{grid-column:span 2}}@media (width<=600px){.bento[data-astro-cid-svhkl75q]{grid-template-columns:1fr}.agora[data-astro-cid-svhkl75q],.spaces[data-astro-cid-svhkl75q],.chat[data-astro-cid-svhkl75q],.stage[data-astro-cid-svhkl75q],.casa[data-astro-cid-svhkl75q]{grid-column:auto}.cell[data-astro-cid-svhkl75q]{min-height:0;padding:20px}}.trust[data-astro-cid-wtzqjce7]{padding-block:clamp(80px,14vh,160px);position:relative}.trust[data-astro-cid-wtzqjce7]:before{content:\"\";z-index:-1;pointer-events:none;background:radial-gradient(45% 35% at 50% 0,#6163d01a,#0000 70%);position:absolute;inset:0}.head[data-astro-cid-wtzqjce7]{gap:16px;max-width:760px;display:grid}.list[data-astro-cid-wtzqjce7]{background:var(--line-1);box-shadow:inset 0 0 0 1px var(--line-1);border-radius:18px;grid-template-columns:repeat(3,1fr);gap:1px;margin:clamp(40px,7vh,72px) 0 0;padding:0;list-style:none;display:grid;overflow:hidden}.list[data-astro-cid-wtzqjce7] li[data-astro-cid-wtzqjce7]{background:var(--bg-1);align-content:start;gap:10px;padding:28px 24px;display:grid}.ic[data-astro-cid-wtzqjce7]{color:var(--accent);margin-bottom:6px}.list[data-astro-cid-wtzqjce7] h3[data-astro-cid-wtzqjce7]{font-size:17px}.list[data-astro-cid-wtzqjce7] p[data-astro-cid-wtzqjce7]{color:var(--text-3);font-size:15px;line-height:1.55}.honest[data-astro-cid-wtzqjce7]{background:#e6b4630d;border-radius:16px;margin-top:12px;padding:22px 24px;box-shadow:inset 0 0 0 1px #e6b46333}.honest[data-astro-cid-wtzqjce7] h3[data-astro-cid-wtzqjce7]{color:#e6b463;font-size:15px}.honest[data-astro-cid-wtzqjce7] p[data-astro-cid-wtzqjce7]{color:var(--text-2);margin-top:6px;font-size:15px}@media (width<=900px){.list[data-astro-cid-wtzqjce7]{grid-template-columns:1fr 1fr}}@media (width<=600px){.list[data-astro-cid-wtzqjce7]{grid-template-columns:1fr}.list[data-astro-cid-wtzqjce7] li[data-astro-cid-wtzqjce7]{padding:22px 20px}}.plus[data-astro-cid-skg4pmoi]{padding-block:clamp(80px,14vh,160px);position:relative}.head[data-astro-cid-skg4pmoi]{gap:16px;max-width:760px;display:grid}.plans[data-astro-cid-skg4pmoi]{grid-template-columns:1fr 1fr;gap:12px;margin-top:clamp(40px,7vh,72px);display:grid}.plan[data-astro-cid-skg4pmoi]{box-shadow:inset 0 0 0 1px var(--line-1), var(--top-light);background:linear-gradient(#ffffff09,#ffffff03);border-radius:18px;padding:clamp(24px,3vw,36px)}.pro[data-astro-cid-skg4pmoi]{background:radial-gradient(90% 70% at 50% 0,#6163d042,#0000 70%),linear-gradient(#ffffff0a,#ffffff04);box-shadow:inset 0 0 0 1px #8b8ef738,inset 0 1px #ffffff14,0 30px 80px #24266e40}.plan[data-astro-cid-skg4pmoi] h3[data-astro-cid-skg4pmoi]{color:var(--text-2);font-size:16px}.pro[data-astro-cid-skg4pmoi] h3[data-astro-cid-skg4pmoi]{color:var(--accent)}.price[data-astro-cid-skg4pmoi]{flex-wrap:wrap;align-items:baseline;gap:4px 6px;margin-top:12px;display:flex}.price[data-astro-cid-skg4pmoi] b[data-astro-cid-skg4pmoi]{letter-spacing:-.035em;color:var(--text-1);font-variation-settings:\"opsz\" 32;font-size:clamp(36px,4vw,48px);font-weight:600}.price[data-astro-cid-skg4pmoi] span[data-astro-cid-skg4pmoi]{color:var(--text-3);font-size:16px}.price[data-astro-cid-skg4pmoi] small[data-astro-cid-skg4pmoi]{color:var(--text-3);flex-basis:100%;font-size:14px}.plan[data-astro-cid-skg4pmoi] ul[data-astro-cid-skg4pmoi]{gap:12px;margin:24px 0 0;padding:0;list-style:none;display:grid}.plan[data-astro-cid-skg4pmoi] li[data-astro-cid-skg4pmoi]{color:var(--text-2);padding-left:26px;font-size:15px;position:relative}.plan[data-astro-cid-skg4pmoi] li[data-astro-cid-skg4pmoi]:before{content:\"\";border-left:1.6px solid var(--accent);border-bottom:1.6px solid var(--accent);width:12px;height:7px;position:absolute;top:6px;left:2px;transform:rotate(-45deg)}.fine[data-astro-cid-skg4pmoi]{color:var(--text-3);margin-top:24px;font-size:13px}.hora[data-astro-cid-skg4pmoi]{isolation:isolate;border-radius:20px;align-items:start;min-height:460px;margin-top:12px;display:grid;position:relative;overflow:hidden;box-shadow:inset 0 0 0 1px #8b8ef733}.sky[data-astro-cid-skg4pmoi]{z-index:-1;background:linear-gradient(#0e0f26 0%,#1c1e5a 40%,#3d41a3 66%,#8d84d2 84%,#e7b9b4 100%);position:absolute;inset:0}.sun[data-astro-cid-skg4pmoi]{background:radial-gradient(closest-side,#ffd6c48c,#ffd6c400);border-radius:50%;width:260px;height:260px;position:absolute;bottom:-60px;left:62%}.city[data-astro-cid-skg4pmoi]{height:34%;position:absolute;bottom:0;left:0;right:0}.city[data-astro-cid-skg4pmoi] i[data-astro-cid-skg4pmoi]{bottom:0;left:var(--l);width:var(--w);height:var(--h);background:#0d0e22;position:absolute;box-shadow:0 0 0 1px #ffffff05}.city[data-astro-cid-skg4pmoi] i[data-astro-cid-skg4pmoi]:after{content:\"\";opacity:.55;background-image:radial-gradient(circle,#ffd296d9 0 1px,#0000 1.6px);background-size:7px 9px;position:absolute;inset:14% 22%}.hora[data-astro-cid-skg4pmoi]:after{content:\"\";z-index:-1;background:linear-gradient(#0808148c 0%,#08081400 55%);position:absolute;inset:0}.hora-copy[data-astro-cid-skg4pmoi]{gap:10px;max-width:520px;padding:clamp(24px,4vw,44px);display:grid}.hora-copy[data-astro-cid-skg4pmoi] .eyebrow[data-astro-cid-skg4pmoi]{color:#c6c8ff}.hora-copy[data-astro-cid-skg4pmoi] h3[data-astro-cid-skg4pmoi]{letter-spacing:-.03em;font-size:clamp(32px,4vw,48px)}.hora-copy[data-astro-cid-skg4pmoi] p[data-astro-cid-skg4pmoi]{color:#f0f0ffd1;font-size:16px}.hora-copy[data-astro-cid-skg4pmoi] .rules[data-astro-cid-skg4pmoi]{color:#e6e6ffb3;font-size:14px}html.tier-a .city[data-astro-cid-skg4pmoi] i[data-astro-cid-skg4pmoi]:after,html.tier-b .city[data-astro-cid-skg4pmoi] i[data-astro-cid-skg4pmoi]:after{animation:6s ease-in-out infinite alternate windows;animation-delay:calc(var(--i) * -.7s)}@keyframes windows{0%{opacity:.3}to{opacity:.75}}@media (width<=760px){.plans[data-astro-cid-skg4pmoi]{grid-template-columns:1fr}.hora[data-astro-cid-skg4pmoi]{min-height:520px}.city[data-astro-cid-skg4pmoi]{height:26%}}.faq[data-astro-cid-hemr5th4]{padding-block:clamp(80px,14vh,160px)}.two[data-astro-cid-hemr5th4]{grid-template-columns:.8fr 1.2fr;align-items:start;gap:clamp(32px,6vw,80px);display:grid}.head[data-astro-cid-hemr5th4]{gap:16px;display:grid;position:sticky;top:112px}details[data-astro-cid-hemr5th4]{border-bottom:1px solid var(--line-2)}details[data-astro-cid-hemr5th4]:first-child{border-top:1px solid var(--line-2)}summary[data-astro-cid-hemr5th4]{cursor:pointer;letter-spacing:-.012em;min-height:64px;color:var(--text-1);justify-content:space-between;align-items:center;gap:16px;padding:16px 0;font-size:17px;font-weight:560;list-style:none;display:flex}summary[data-astro-cid-hemr5th4]::-webkit-details-marker{display:none}summary[data-astro-cid-hemr5th4]:hover{color:#fff}.pm[data-astro-cid-hemr5th4]{flex:none;width:14px;height:14px;position:relative}.pm[data-astro-cid-hemr5th4]:before,.pm[data-astro-cid-hemr5th4]:after{content:\"\";background:var(--text-3);width:14px;height:1.6px;transition:transform .22s var(--ease-out);border-radius:1px;position:absolute;top:6px;left:0}.pm[data-astro-cid-hemr5th4]:after{transform:rotate(90deg)}details[data-astro-cid-hemr5th4][open] .pm[data-astro-cid-hemr5th4]:after{transform:rotate(0)}details[data-astro-cid-hemr5th4] p[data-astro-cid-hemr5th4]{max-width:40em;color:var(--text-3);padding:0 0 22px;font-size:16px}details[data-astro-cid-hemr5th4][open] p[data-astro-cid-hemr5th4]{animation:open .32s var(--ease-out)}@keyframes open{0%{opacity:0;transform:translateY(-4px)}}@media (width<=860px){.two[data-astro-cid-hemr5th4]{grid-template-columns:1fr}.head[data-astro-cid-hemr5th4]{position:static}}.final[data-astro-cid-ufsn2at3]{text-align:center;isolation:isolate;position:relative;overflow:clip}.final-stage[data-astro-cid-ufsn2at3]{padding-block:clamp(120px,20vh,220px) clamp(120px,18vh,200px);position:relative}h2[data-astro-cid-ufsn2at3] em[data-astro-cid-ufsn2at3]{color:#a9acff;font-style:normal}.mark-space[data-astro-cid-ufsn2at3]{display:none}.final-media[data-astro-cid-ufsn2at3]{z-index:-1;pointer-events:none;position:absolute;inset:0}.final-media[data-astro-cid-ufsn2at3] picture,.final-media[data-astro-cid-ufsn2at3] img,.final-media[data-astro-cid-ufsn2at3] video{object-fit:cover;object-position:50% 30%;width:100%;height:100%;position:absolute;inset:0}.final-media[data-astro-cid-ufsn2at3]:after{content:\"\";background:linear-gradient(180deg, #0b0b0c33, #0b0b0c1a 40%, #0b0b0cbf 75%, var(--bg-1));position:absolute;inset:0}html:not(.tier-a) .final[data-astro-cid-ufsn2at3] .horizon[data-astro-cid-ufsn2at3],html:not(.tier-a) .final[data-astro-cid-ufsn2at3]:before,html.tier-a .final-media[data-astro-cid-ufsn2at3],html:not(.tier-a) .final[data-astro-cid-ufsn2at3] .mark[data-astro-cid-ufsn2at3]{display:none}html:not(.tier-a) .final-stage[data-astro-cid-ufsn2at3]{padding-top:clamp(280px,46vh,460px)}html.gl-on .final[data-astro-cid-ufsn2at3]{height:260vh;overflow:visible}html.gl-on .final-stage[data-astro-cid-ufsn2at3]{place-items:center;height:100lvh;padding:0;display:grid;position:sticky;top:0}html.gl-on .final[data-astro-cid-ufsn2at3] .horizon[data-astro-cid-ufsn2at3],html.gl-on .final[data-astro-cid-ufsn2at3]:before,html.gl-on .mark[data-astro-cid-ufsn2at3]{display:none}html.gl-on .mark-space[data-astro-cid-ufsn2at3]{height:clamp(150px,24vh,240px);display:block}html.gl-on .final[data-astro-cid-ufsn2at3] h2[data-astro-cid-ufsn2at3]{text-shadow:0 4px 40px #06081e99}html.gl-on .final[data-astro-cid-ufsn2at3] .lede[data-astro-cid-ufsn2at3]{color:var(--text-2);text-shadow:0 2px 20px #06081ecc}html.gl-on .final[data-astro-cid-ufsn2at3] .specs[data-astro-cid-ufsn2at3]{color:#b8bcd6}.horizon[data-astro-cid-ufsn2at3]{aspect-ratio:1;z-index:-1;background:radial-gradient(closest-side,#09090b 98.6%,#09090b00 100%);border-radius:50%;width:max(1400px,170vw);margin-left:calc(max(1400px,170vw)/-2);position:absolute;top:74%;left:50%;box-shadow:0 -1px #d6daff8c,0 -24px 80px #8b8ef761,0 -80px 220px #6163d06b}.final[data-astro-cid-ufsn2at3]:before{content:\"\";z-index:-2;background:radial-gradient(60% 50% at 50% 92%,#6163d047,#0000 70%);position:absolute;inset:0}.inner[data-astro-cid-ufsn2at3]{justify-items:center;gap:22px;display:grid}.mark[data-astro-cid-ufsn2at3]{filter:drop-shadow(0 8px 30px #8b8ef773);width:72px;height:72px}h2[data-astro-cid-ufsn2at3]{letter-spacing:-.04em;font-size:clamp(44px,8vw,104px)}.lede[data-astro-cid-ufsn2at3]{text-align:center}.specs[data-astro-cid-ufsn2at3]{color:var(--text-3);font-size:13px}.foot[data-astro-cid-ufsn2at3]{border-top:1px solid var(--line-1);padding-block:28px calc(28px + env(safe-area-inset-bottom))}.row[data-astro-cid-ufsn2at3]{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 24px;display:flex}.row[data-astro-cid-ufsn2at3] p[data-astro-cid-ufsn2at3]{color:var(--text-3);font-size:13px}.invite[data-astro-cid-j27ekuku]{width:min(440px,100vw - 32px);color:var(--text-2);box-shadow:0 0 0 1px #00000080, inset 0 0 0 1px var(--line-2), inset 0 1px 0 #ffffff0f, 0 32px 80px #00000080;background:#171719;border:0;border-radius:16px;padding:0}.invite[data-astro-cid-j27ekuku]::backdrop{background:#0000008f}.invite[data-astro-cid-j27ekuku][open]{animation:pop .3s var(--ease-sheet)}@keyframes pop{0%{opacity:0;transform:translateY(8px)scale(.98)}}form[data-astro-cid-j27ekuku]{gap:12px;padding:28px;display:grid}h2[data-astro-cid-j27ekuku]{letter-spacing:-.02em;font-size:24px;line-height:1.25}form[data-astro-cid-j27ekuku]>p[data-astro-cid-j27ekuku]:not(.eyebrow){color:var(--text-3);font-size:15px}.actions[data-astro-cid-j27ekuku]{flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:12px;display:flex}\n"}],"routeData":{"route":"/","isIndex":true,"type":"page","pattern":"^\\/$","segments":[],"params":[],"component":"src/pages/index.astro","pathname":"/","prerender":true,"fallbackRoutes":[],"distURL":[],"origin":"project","_meta":{"trailingSlash":"ignore"}}}],"serverLike":false,"middlewareMode":"classic","site":"http://localhost:4599","base":"/","trailingSlash":"ignore","compressHTML":"jsx","componentMetadata":[["D:/PROJETOS/alga-presence/apps/site/src/pages/i/index.astro",{"propagation":"none","containsHead":true}],["D:/PROJETOS/alga-presence/apps/site/src/pages/index.astro",{"propagation":"none","containsHead":true}]],"renderers":[],"clientDirectives":[["idle","(function(){let e=(e,t)=>{let n=async()=>{await(await e())()},r=typeof t.value==`object`?t.value:void 0,i={timeout:r==null?void 0:r.timeout};`requestIdleCallback`in window?window.requestIdleCallback(n,i):setTimeout(n,i.timeout||200)};(self.Astro||(self.Astro={})).idle=e,window.dispatchEvent(new Event(`astro:idle`))})();"],["load","(function(){let e=async e=>{await(await e())()};(self.Astro||(self.Astro={})).load=e,window.dispatchEvent(new Event(`astro:load`))})();"],["media","(function(){let e=(e,t)=>{let n=async()=>{await(await e())()};if(t.value){let e=matchMedia(t.value);e.matches?n():e.addEventListener(`change`,n,{once:!0})}};(self.Astro||(self.Astro={})).media=e,window.dispatchEvent(new Event(`astro:media`))})();"],["only","(function(){let e=async e=>{await(await e())()};(self.Astro||(self.Astro={})).only=e,window.dispatchEvent(new Event(`astro:only`))})();"],["visible","(function(){let e=(e,t,n)=>{let r=async()=>{await(await e())()},i=typeof t.value==`object`?t.value:void 0,a={rootMargin:i==null?void 0:i.rootMargin},o=new IntersectionObserver(e=>{for(let t of e)if(t.isIntersecting){o.disconnect(),r();break}},a);for(let e of n.children)o.observe(e)};(self.Astro||(self.Astro={})).visible=e,window.dispatchEvent(new Event(`astro:visible`))})();"]],"entryModules":{"astro/entrypoints/prerender":"prerender-entry.Bsl0bhfV.mjs","\u0000noop-middleware":"chunks/_noop-middleware_D5dhqGDj.mjs","\u0000virtual:astro:server-island-manifest":"chunks/_virtual_astro_server-island-manifest_BhTW5IeR.mjs","\u0000virtual:astro:session-driver":"chunks/_virtual_astro_session-driver_BWWe3pKI.mjs","\u0000virtual:astro:page:src/pages/i/index@_@astro":"chunks/index_BDVehoVQ.mjs","\u0000virtual:astro:page:src/pages/index@_@astro":"chunks/index_Dek1OqBd.mjs","\u0000virtual:astro:actions/noop-entrypoint":"chunks/noop-entrypoint_CxXy0p4B.mjs","D:/PROJETOS/Alga Meet/node_modules/astro/dist/assets/services/sharp.js":"chunks/sharp_Cmsh9GJB.mjs","D:/PROJETOS/alga-presence/apps/site/src/pages/index.astro?astro&type=script&index=0&lang.ts":"_astro/index.astro_astro_type_script_index_0_lang.B1OMquxS.js","D:/PROJETOS/alga-presence/apps/site/src/pages/i/index.astro?astro&type=script&index=0&lang.ts":"_astro/index.astro_astro_type_script_index_0_lang.Dj1rKR6e.js","D:/PROJETOS/alga-presence/apps/site/src/scripts/room/audio.ts":"_astro/audio.DPSAo_b9.js","D:/PROJETOS/alga-presence/apps/site/src/scripts/lens/chapter.ts":"_astro/chapter.CcyUokBa.js","D:/PROJETOS/alga-presence/apps/site/src/scripts/lens/game.ts":"_astro/game.iMJ-RCMj.js","D:/PROJETOS/alga-presence/apps/site/src/scripts/motion-a.ts":"_astro/motion-a.BQlElZpB.js","astro:scripts/before-hydration.js":""},"inlinedScripts":[["D:/PROJETOS/alga-presence/apps/site/src/pages/i/index.astro?astro&type=script&index=0&lang.ts","var e=document.querySelector(`[data-api]`),t=t=>e.querySelector(t),n=((location.pathname.split(`/`).filter(Boolean)[1]??``)||new URLSearchParams(location.search).get(`c`)||``).trim(),r=/^[0-9A-Za-z]{1,32}$/.test(n),i=e=>e.trim().split(/\\s+/).slice(0,2).map(e=>[...e][0]??``).join(``).toUpperCase()||`A`,a=e=>[...e].reduce((e,t)=>(e*31+t.charCodeAt(0))%360,7),o=[`#8b8ef7`,`#e5484d`,`#3dd6e0`,`#a77bf3`,`#f5a524`,`#4ade4a`,`#e6edf5`,`#2fb5a5`,`#e5459a`,`#d6b14a`,`#f2711c`,`#5b8bd6`],s=(e,t)=>{let n=t>>>0;for(let t=0;t<e.length;t++)n=Math.imul(n^e.charCodeAt(t),1540483477)>>>0;return n^=n>>>13,Math.imul(n,1540483477)>>>0},c=(e,n)=>t(e).textContent=n;r?(t(`[data-open]`).setAttribute(`href`,`algameet://invite/${n}`),c(`[data-code]`,n),t(`[data-code-row]`).hidden=!1,fetch(`${e.dataset.api}/api/v1/invites/${n}`,{headers:{accept:`application/json`}}).then(e=>e.ok?e.json():Promise.reject(e.status)).then(n=>{document.title=`${n.space.name} · Alga Meet`,c(`[data-lead]`,n.inviter?`${n.inviter.displayName} te chamou para`:`Você foi chamado para`),c(`[data-space]`,n.space.name),c(`[data-meta]`,n.memberCount===1?`1 pessoa já está lá`:`${n.memberCount} pessoas já estão lá`);let r=t(`[data-tile]`);if(r.style.setProperty(`--h`,String(a(n.space.id))),n.space.iconUrl){let e=new Image;e.alt=``,e.src=n.space.iconUrl,e.onerror=()=>r.textContent=i(n.space.name),r.replaceChildren(e)}else r.textContent=i(n.space.name);if(n.inviter){let e=t(`[data-face]`),r=n.inviter.eco?.accent??o[s(n.inviter.id,1)%o.length];if(e.style.color=r,e.style.background=`color-mix(in srgb, ${r} 9%, #121216)`,e.style.setProperty(`--eye`,r===o[0]?`#f7f8f8`:r),e.hidden=!1,n.inviter.avatarUrl){let t=new Image;t.alt=``,t.src=n.inviter.avatarUrl,t.onload=()=>e.replaceChildren(t)}}e.classList.add(`ready`)}).catch(e=>{e===404&&(c(`[data-lead]`,`Este convite não vale mais.`),c(`[data-space]`,`Peça um link novo para quem te chamou.`),t(`[data-open]`).setAttribute(`aria-disabled`,`true`))})):(c(`[data-lead]`,`Este link de convite está incompleto.`),c(`[data-space]`,`Peça o link de novo para quem te chamou.`),t(`[data-open]`).setAttribute(`aria-disabled`,`true`));"]],"assets":["/_astro/Triangle.CmPavA97.js","/_astro/audio.DPSAo_b9.js","/_astro/chapter.CcyUokBa.js","/_astro/chat.CmV_6Zts.png","/_astro/conversation.B2Uz6ZUn.js","/_astro/final.CmcDf_Ss.png","/_astro/frame-1080.ClC7WUYs.png","/_astro/frame-720.Brkjn5Y_.png","/_astro/game.iMJ-RCMj.js","/_astro/hero.CyuFpPqT.png","/_astro/index.astro_astro_type_script_index_0_lang.B1OMquxS.js","/_astro/inter-latin-opsz-normal.BwkfbSeq.woff2","/_astro/leve.3LxAYExQ.png","/_astro/lockup.CT0RHbQb.svg","/_astro/motion-a.BQlElZpB.js","/_astro/preload-helper.DHhhL8Zf.js","/_astro/room.C-8p_8s3.png","/_astro/stage-crop.B6ikCyaK.png","/favicon.svg","/i/index.html","/index.html","/media/final.mp4","/media/hero.mp4","/media/leve.mp4","/media/room.mp4","/og.jpg"],"buildFormat":"directory","checkOrigin":false,"actionBodySizeLimit":1048576,"serverIslandBodySizeLimit":1048576,"allowedDomains":[],"key":"VDyommrCwt2TeWCd6kQY09kCDZpBDJkLcEDy2fpYMOc=","image":{},"devToolbar":{"enabled":false,"debugInfoOutput":""},"logLevel":"info","shouldInjectCspMetaTags":false});
var manifestRoutes = _manifest.routes;
var manifest = Object.assign(_manifest, {
	renderers,
	actions: () => import("./chunks/noop-entrypoint_CxXy0p4B.mjs"),
	middleware: () => import("./chunks/_noop-middleware_D5dhqGDj.mjs"),
	sessionDriver: () => import("./chunks/_virtual_astro_session-driver_BWWe3pKI.mjs"),
	serverIslandMappings: () => import("./chunks/_virtual_astro_server-island-manifest_BhTW5IeR.mjs"),
	routes: manifestRoutes,
	pageMap
});
// ../Alga Meet/node_modules/astro/dist/vite-plugin-scripts/index.js
var SCRIPT_ID_PREFIX = `astro:scripts/`;
`${SCRIPT_ID_PREFIX}`;
var PAGE_SCRIPT_ID = `${SCRIPT_ID_PREFIX}page.js`;
// ../Alga Meet/node_modules/astro/dist/core/redirects/component.js
var RedirectComponentInstance = { default() {
	return new Response(null, { status: 301 });
} };
var RedirectSinglePageBuiltModule = {
	page: () => Promise.resolve(RedirectComponentInstance),
	onRequest: (_, next) => next()
};
// ../Alga Meet/node_modules/astro/dist/core/render/ssr-element.js
var URL_PARSE_BASE = "https://astro.build";
function splitAssetPath(path) {
	const parsed = new URL(path, URL_PARSE_BASE);
	return {
		pathname: !URL.canParse(path) && !path.startsWith("/") ? parsed.pathname.slice(1) : parsed.pathname,
		suffix: `${parsed.search}${parsed.hash}`
	};
}
function appendQueryParams(path, queryParams) {
	const queryString = queryParams.toString();
	if (!queryString) return path;
	const hashIndex = path.indexOf("#");
	const basePath = hashIndex === -1 ? path : path.slice(0, hashIndex);
	const hash = hashIndex === -1 ? "" : path.slice(hashIndex);
	return `${basePath}${basePath.includes("?") ? "&" : "?"}${queryString}${hash}`;
}
function createAssetLink(href, base, assetsPrefix, queryParams) {
	const { pathname, suffix } = splitAssetPath(href);
	let url = "";
	if (assetsPrefix) {
		const pf = getAssetsPrefix(fileExtension(pathname), assetsPrefix);
		url = joinPaths(pf, slash(pathname)) + suffix;
	} else if (base) url = prependForwardSlash(joinPaths(base, slash(pathname))) + suffix;
	else url = href;
	if (queryParams) url = appendQueryParams(url, queryParams);
	return url;
}
function createStylesheetElement(stylesheet, base, assetsPrefix, queryParams) {
	if (stylesheet.type === "inline") return {
		props: {},
		children: stylesheet.content
	};
	else return {
		props: {
			rel: "stylesheet",
			href: createAssetLink(stylesheet.src, base, assetsPrefix, queryParams)
		},
		children: ""
	};
}
function createStylesheetElementSet(stylesheets, base, assetsPrefix, queryParams) {
	return new Set(stylesheets.map((s) => createStylesheetElement(s, base, assetsPrefix, queryParams)));
}
function createModuleScriptElement(script, base, assetsPrefix, queryParams) {
	if (script.type === "external") return createModuleScriptElementWithSrc(script.value, base, assetsPrefix, queryParams);
	else return {
		props: { type: "module" },
		children: script.value
	};
}
function createModuleScriptElementWithSrc(src, base, assetsPrefix, queryParams) {
	return {
		props: {
			type: "module",
			src: createAssetLink(src, base, assetsPrefix, queryParams)
		},
		children: ""
	};
}
// ../Alga Meet/node_modules/astro/dist/core/manifest/memo.js
function createManifestMemo(derive) {
	const cache = /* @__PURE__ */ new WeakMap();
	return {
		get(manifest) {
			if (cache.has(manifest)) return cache.get(manifest);
			const value = derive(manifest);
			cache.set(manifest, value);
			return value;
		},
		has(manifest) {
			return cache.has(manifest);
		},
		set(manifest, value) {
			cache.set(manifest, value);
		},
		invalidate(manifest) {
			cache.delete(manifest);
		}
	};
}
/**
* Caches the PROMISE (single-flight: concurrent callers share one derivation).
* On rejection the entry is DELETED so the next call retries a failed lazy
* resolve instead of caching the failure forever.
*/
function createAsyncManifestMemo(derive) {
	const cache = /* @__PURE__ */ new WeakMap();
	return {
		get(manifest) {
			let promise = cache.get(manifest);
			if (!promise) {
				promise = derive(manifest);
				cache.set(manifest, promise);
				promise.catch(() => {
					if (cache.get(manifest) === promise) cache.delete(manifest);
				});
			}
			return promise;
		},
		invalidate(manifest) {
			cache.delete(manifest);
		}
	};
}
// ../Alga Meet/node_modules/astro/dist/core/request-body.js
/**
* Shared utility for reading request bodies with a size limit.
* Used by both Actions and Server Islands to enforce `security.actionBodySizeLimit`
* and `security.serverIslandBodySizeLimit` respectively.
*/
/**
* Read the request body as a `Uint8Array`, enforcing a maximum size limit.
* Checks the `Content-Length` header for early rejection, then streams the body
* and tracks bytes received.
*
* @throws {BodySizeLimitError} if the body exceeds the configured limit
*/
async function readBodyWithLimit(request, limit) {
	const contentLengthHeader = request.headers.get("content-length");
	if (contentLengthHeader) {
		const contentLength = Number.parseInt(contentLengthHeader, 10);
		if (Number.isFinite(contentLength) && contentLength > limit) throw new BodySizeLimitError(limit);
	}
	if (!request.body) return /* @__PURE__ */ new Uint8Array();
	const reader = request.body.getReader();
	const chunks = [];
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			received += value.byteLength;
			if (received > limit) throw new BodySizeLimitError(limit);
			chunks.push(value);
		}
	}
	const buffer = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return buffer;
}
var BodySizeLimitError = class extends Error {
	limit;
	constructor(limit) {
		super(`Request body exceeds the configured limit of ${limit} bytes`);
		this.name = "BodySizeLimitError";
		this.limit = limit;
	}
};
// ../Alga Meet/node_modules/astro/dist/core/routing/pattern.js
function getPattern(segments, base, addTrailingSlash) {
	const pathname = segments.map((segment) => {
		if (segment.length === 1 && segment[0].spread) return "(?:\\/(.*?))?";
		else return "\\/" + segment.map((part) => {
			if (part.spread) return "(.*?)";
			else if (part.dynamic) return "([^/]+?)";
			else return part.content.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23").replace(/%5B/g, "[").replace(/%5D/g, "]").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}).join("");
	}).join("");
	const trailing = addTrailingSlash && segments.length ? getTrailingSlashPattern(addTrailingSlash) : "$";
	let initial = "\\/";
	if (addTrailingSlash === "never" && base !== "/" && pathname !== "") initial = "";
	return new RegExp(`^${pathname || initial}${trailing}`);
}
function getTrailingSlashPattern(addTrailingSlash) {
	if (addTrailingSlash === "always") return "\\/$";
	if (addTrailingSlash === "never") return "$";
	return "\\/?$";
}
// ../Alga Meet/node_modules/astro/dist/core/server-islands/endpoint.js
var SERVER_ISLAND_ROUTE = "/_server-islands/[name]";
var SERVER_ISLAND_COMPONENT = "_server-islands.astro";
function badRequest(reason) {
	return new Response(null, {
		status: 400,
		statusText: "Bad request: " + reason
	});
}
var DEFAULT_BODY_SIZE_LIMIT = 1048576;
async function getRequestData(request, bodySizeLimit = DEFAULT_BODY_SIZE_LIMIT) {
	switch (request.method) {
		case "GET": {
			const params = new URL(request.url).searchParams;
			if (!params.has("s") || !params.has("e") || !params.has("p")) return badRequest("Missing required query parameters.");
			const encryptedSlots = params.get("s");
			return {
				encryptedComponentExport: params.get("e"),
				encryptedProps: params.get("p"),
				encryptedSlots
			};
		}
		case "POST": try {
			const body = await readBodyWithLimit(request, bodySizeLimit);
			const raw = new TextDecoder().decode(body);
			const data = JSON.parse(raw);
			if (Object.hasOwn(data, "slots") && typeof data.slots === "object") return badRequest("Plaintext slots are not allowed. Slots must be encrypted.");
			if (Object.hasOwn(data, "componentExport") && typeof data.componentExport === "string") return badRequest("Plaintext componentExport is not allowed. componentExport must be encrypted.");
			return data;
		} catch (e) {
			if (e instanceof BodySizeLimitError) return new Response(null, {
				status: 413,
				statusText: e.message
			});
			if (e instanceof SyntaxError) return badRequest("Request format is invalid.");
			throw e;
		}
		default: return new Response(null, { status: 405 });
	}
}
function createEndpoint(manifest) {
	const page = async (result) => {
		const params = result.params;
		if (!params.name) return new Response(null, {
			status: 400,
			statusText: "Bad request"
		});
		const componentId = params.name;
		const data = await getRequestData(result.request, manifest.serverIslandBodySizeLimit);
		if (data instanceof Response) return data;
		let imp = (await (await manifest.serverIslandMappings?.())?.serverIslandMap)?.get(componentId);
		if (!imp) return new Response(null, {
			status: 404,
			statusText: "Not found"
		});
		const key = await manifest.key;
		let componentExport;
		try {
			componentExport = await decryptString(key, data.encryptedComponentExport, `export:${componentId}`);
		} catch (_e) {
			return badRequest("Encrypted componentExport value is invalid.");
		}
		const encryptedProps = data.encryptedProps;
		let props = {};
		if (encryptedProps !== "") try {
			const propString = await decryptString(key, encryptedProps, `props:${componentId}`);
			props = JSON.parse(propString);
		} catch (_e) {
			return badRequest("Encrypted props value is invalid.");
		}
		let decryptedSlots = {};
		const encryptedSlots = data.encryptedSlots;
		if (encryptedSlots !== "") try {
			const slotsString = await decryptString(key, encryptedSlots, `slots:${componentId}`);
			decryptedSlots = JSON.parse(slotsString);
		} catch (_e) {
			return badRequest("Encrypted slots value is invalid.");
		}
		let Component = (await imp())[componentExport];
		const slots = {};
		for (const prop in decryptedSlots) slots[prop] = createSlotValueFromString(decryptedSlots[prop]);
		result.response.headers.set("X-Robots-Tag", "noindex");
		if (isAstroComponentFactory(Component)) {
			const ServerIsland = Component;
			Component = function(...args) {
				return ServerIsland.apply(this, args);
			};
			Object.assign(Component, ServerIsland);
			Component.propagation = "self";
		}
		result._metadata.routeHasPropagation = true;
		const renderPropagatedHead = () => markHTMLString(result._metadata.extraHead.join(""));
		return renderTemplate`${renderPropagatedHead}${renderComponent(result, "Component", Component, props, slots)}`;
	};
	page.isAstroComponentFactory = true;
	return {
		default: page,
		partial: true
	};
}
// ../Alga Meet/node_modules/astro/dist/template/4xx.js
/** Display all errors */
function template({ title, pathname, statusCode = 404, tabTitle, body }) {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<title>${tabTitle}</title>
		<style>
			:root {
				--gray-10: hsl(258, 7%, 10%);
				--gray-20: hsl(258, 7%, 20%);
				--gray-30: hsl(258, 7%, 30%);
				--gray-40: hsl(258, 7%, 40%);
				--gray-50: hsl(258, 7%, 50%);
				--gray-60: hsl(258, 7%, 60%);
				--gray-70: hsl(258, 7%, 70%);
				--gray-80: hsl(258, 7%, 80%);
				--gray-90: hsl(258, 7%, 90%);
				--black: #13151A;
				--accent-light: #E0CCFA;
			}

			* {
				box-sizing: border-box;
			}

			html {
				background: var(--black);
				color-scheme: dark;
				accent-color: var(--accent-light);
			}

			body {
				background-color: var(--gray-10);
				color: var(--gray-80);
				font-family: ui-monospace, Menlo, Monaco, "Cascadia Mono", "Segoe UI Mono", "Roboto Mono", "Oxygen Mono", "Ubuntu Monospace", "Source Code Pro", "Fira Mono", "Droid Sans Mono", "Courier New", monospace;
				line-height: 1.5;
				margin: 0;
			}

			a {
				color: var(--accent-light);
			}

			.center {
				display: flex;
				flex-direction: column;
				justify-content: center;
				align-items: center;
				height: 100vh;
				width: 100vw;
			}

			h1 {
				margin-bottom: 8px;
				color: white;
				font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
				font-weight: 700;
				margin-top: 1rem;
				margin-bottom: 0;
			}

			.statusCode {
				color: var(--accent-light);
			}

			.astro-icon {
				height: 124px;
				width: 124px;
			}

			pre, code {
				padding: 2px 8px;
				background: rgba(0,0,0, 0.25);
				border: 1px solid rgba(255,255,255, 0.25);
				border-radius: 4px;
				font-size: 1.2em;
				margin-top: 0;
				max-width: 60em;
			}
		</style>
	</head>
	<body>
		<main class="center">
			<svg class="astro-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="80" viewBox="0 0 64 80" fill="none"> <path d="M20.5253 67.6322C16.9291 64.3531 15.8793 57.4632 17.3776 52.4717C19.9755 55.6188 23.575 56.6157 27.3035 57.1784C33.0594 58.0468 38.7122 57.722 44.0592 55.0977C44.6709 54.7972 45.2362 54.3978 45.9045 53.9931C46.4062 55.4451 46.5368 56.9109 46.3616 58.4028C45.9355 62.0362 44.1228 64.8429 41.2397 66.9705C40.0868 67.8215 38.8669 68.5822 37.6762 69.3846C34.0181 71.8508 33.0285 74.7426 34.403 78.9491C34.4357 79.0516 34.4649 79.1541 34.5388 79.4042C32.6711 78.5705 31.3069 77.3565 30.2674 75.7604C29.1694 74.0757 28.6471 72.2121 28.6196 70.1957C28.6059 69.2144 28.6059 68.2244 28.4736 67.257C28.1506 64.8985 27.0406 63.8425 24.9496 63.7817C22.8036 63.7192 21.106 65.0426 20.6559 67.1268C20.6215 67.2865 20.5717 67.4446 20.5218 67.6304L20.5253 67.6322Z" fill="white"/> <path d="M20.5253 67.6322C16.9291 64.3531 15.8793 57.4632 17.3776 52.4717C19.9755 55.6188 23.575 56.6157 27.3035 57.1784C33.0594 58.0468 38.7122 57.722 44.0592 55.0977C44.6709 54.7972 45.2362 54.3978 45.9045 53.9931C46.4062 55.4451 46.5368 56.9109 46.3616 58.4028C45.9355 62.0362 44.1228 64.8429 41.2397 66.9705C40.0868 67.8215 38.8669 68.5822 37.6762 69.3846C34.0181 71.8508 33.0285 74.7426 34.403 78.9491C34.4357 79.0516 34.4649 79.1541 34.5388 79.4042C32.6711 78.5705 31.3069 77.3565 30.2674 75.7604C29.1694 74.0757 28.6471 72.2121 28.6196 70.1957C28.6059 69.2144 28.6059 68.2244 28.4736 67.257C28.1506 64.8985 27.0406 63.8425 24.9496 63.7817C22.8036 63.7192 21.106 65.0426 20.6559 67.1268C20.6215 67.2865 20.5717 67.4446 20.5218 67.6304L20.5253 67.6322Z" fill="url(#paint0_linear_738_686)"/> <path d="M0 51.6401C0 51.6401 10.6488 46.4654 21.3274 46.4654L29.3786 21.6102C29.6801 20.4082 30.5602 19.5913 31.5538 19.5913C32.5474 19.5913 33.4275 20.4082 33.7289 21.6102L41.7802 46.4654C54.4274 46.4654 63.1076 51.6401 63.1076 51.6401C63.1076 51.6401 45.0197 2.48776 44.9843 2.38914C44.4652 0.935933 43.5888 0 42.4073 0H20.7022C19.5206 0 18.6796 0.935933 18.1251 2.38914C18.086 2.4859 0 51.6401 0 51.6401Z" fill="white"/> <defs> <linearGradient id="paint0_linear_738_686" x1="31.554" y1="75.4423" x2="39.7462" y2="48.376" gradientUnits="userSpaceOnUse"> <stop stop-color="#D83333"/> <stop offset="1" stop-color="#F041FF"/> </linearGradient> </defs> </svg>
			<h1>${statusCode ? `<span class="statusCode">${statusCode}: </span> ` : ""}<span class="statusMessage">${title}</span></h1>
			${body || `
				<pre>Path: ${escape(pathname)}</pre>
			`}
			</main>
	</body>
</html>`;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/internal/astro-designed-error-pages.js
var DEFAULT_404_ROUTE = {
	component: DEFAULT_404_COMPONENT,
	params: [],
	pattern: /^\/404\/?$/,
	prerender: false,
	pathname: "/404",
	segments: [[{
		content: "404",
		dynamic: false,
		spread: false
	}]],
	type: "page",
	route: "/404",
	fallbackRoutes: [],
	isIndex: false,
	origin: "internal",
	distURL: []
};
async function default404Page({ pathname }) {
	return new Response(template({
		statusCode: 404,
		title: "Not found",
		tabTitle: "404: Not Found",
		pathname
	}), {
		status: 404,
		headers: { "Content-Type": "text/html" }
	});
}
default404Page.isAstroComponentFactory = true;
var default404Instance = { default: default404Page };
// ../Alga Meet/node_modules/astro/dist/core/routing/default.js
function createDefaultRoutes(manifest) {
	const root = new URL(manifest.rootDir);
	return [{
		instance: default404Instance,
		matchesComponent: (filePath) => filePath.href === new URL(DEFAULT_404_COMPONENT, root).href,
		route: DEFAULT_404_ROUTE.route,
		component: DEFAULT_404_COMPONENT
	}, {
		instance: createEndpoint(manifest),
		matchesComponent: (filePath) => filePath.href === new URL(SERVER_ISLAND_COMPONENT, root).href,
		route: SERVER_ISLAND_ROUTE,
		component: SERVER_ISLAND_COMPONENT
	}];
}
var defaultRoutesMemo = createManifestMemo(createDefaultRoutes);
/** The built-in internal routes for a manifest, derived once per manifest. */
function getDefaultRoutes(manifest) {
	return defaultRoutesMemo.get(manifest);
}
// ../Alga Meet/node_modules/astro/dist/i18n/path.js
function pathHasLocale(path, locales) {
	const segments = path.split("/").map(normalizeThePath);
	for (const segment of segments) for (const locale of locales) if (typeof locale === "string") {
		if (normalizeTheLocale(segment) === normalizeTheLocale(locale)) return true;
	} else if (segment === locale.path) return true;
	return false;
}
/**
*
* Given a locale, this function:
* - replaces the `_` with a `-`;
* - transforms all letters to be lowercase;
*/
function normalizeTheLocale(locale) {
	return locale.replaceAll("_", "-").toLowerCase();
}
/**
*
* Given a path or path segment, this function:
* - removes the `.html` extension if it exists
*/
function normalizeThePath(path) {
	return path.endsWith(".html") ? path.slice(0, -5) : path;
}
// ../Alga Meet/node_modules/astro/dist/i18n/error-routes.js
function isLocalizedErrorRoute(route, status, locales) {
	if (!locales) return false;
	const suffix = `/${status}`;
	if (!route.endsWith(suffix)) return false;
	const localeSegment = route.slice(0, -suffix.length);
	if (!localeSegment || localeSegment.includes("/", 1)) return false;
	return pathHasLocale(localeSegment, locales);
}
function getErrorRoutePath(pathname, status, routes, locales, appendTrailingSlash = false) {
	const suffix = appendTrailingSlash ? "/" : "";
	if (locales) {
		const firstSegment = pathname.split("/").find(Boolean);
		if (firstSegment && pathHasLocale(`/${firstSegment}`, locales)) {
			const localized = `/${firstSegment}/${status}`;
			if (routes.some((route) => route.route === localized)) return `${localized}${suffix}`;
		}
	}
	return `/${status}${suffix}`;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/helpers.js
/**
* Function guard that checks if a route is redirect. If so, `RouteData.redirectRoute` and
* `RouteData.redirect` aren't `undefined` anymore
* @param route
*/
function routeIsRedirect(route) {
	return route?.type === "redirect";
}
/**
* True if the route represents a fallback entry.
*/
function routeIsFallback(route) {
	return route?.type === "fallback";
}
/**
* Give a route, it returns its fallback routes from a `list` of `RouteInfo[]`.
*
* It throws an error if no fallback routes were found. This means there's an error
* when we construct the list of routes
* @param route
* @param routeList
*/
function getFallbackRoute(route, routeList) {
	const fallbackRoute = routeList.find((r) => {
		if (route.route === "/" && r.routeData.route === "/") return true;
		return r.routeData.fallbackRoutes.find((f) => {
			return f.route === route.route;
		});
	});
	if (!fallbackRoute) throw new Error(`No fallback route found for route ${route.route}`);
	return fallbackRoute.routeData;
}
/**
* Return a user-provided 404 route if one exists.
*/
function getCustom404Route(manifestData) {
	return manifestData.routes.find((r) => isRoute404(r.route));
}
/**
* Return a user-provided 500 route if one exists.
*/
function getCustom500Route(manifestData) {
	return manifestData.routes.find((r) => isRoute500(r.route));
}
/**
* Computes the default HTTP status code a route renders with:
* `302` for i18n fallback matches, `404`/`500` for (possibly localized)
* error routes, `200` otherwise.
*/
function getDefaultStatusCode(manifest, routeData, pathname) {
	if (!routeData.pattern.test(pathname)) {
		for (const fallbackRoute of routeData.fallbackRoutes) if (fallbackRoute.pattern.test(pathname)) return 302;
	}
	const route = removeTrailingForwardSlash(routeData.route);
	const locales = manifest.i18n?.locales;
	if (isRoute404(route) || isLocalizedErrorRoute(route, 404, locales)) return 404;
	if (isRoute500(route) || isLocalizedErrorRoute(route, 500, locales)) return 500;
	return 200;
}
/**
* Returns true if the route definition contains `.html` as a static segment part,
* as is the case for routes like `[slug].html.astro`. Used to avoid stripping the
* `.html` suffix from pathnames that intentionally include it.
*/
function routeHasHtmlExtension(route) {
	return route.segments.some((segment) => segment.some((part) => !part.dynamic && part.content.includes(".html")));
}
// ../Alga Meet/node_modules/astro/dist/core/logger/manifest-logger.js
var loggers = /* @__PURE__ */ new WeakMap();
/**
* One identity-stable logger per manifest. Created on first access as a
* console logger at `manifest.logLevel`.
*
* The instance is never replaced: `getResolvedLogger` swaps the
* destination in place via `AstroLogger.setDestination`, so every holder
* (state-captured logger, adapterLogger's retained options) writes to the
* new destination immediately.
*/
function getLogger(manifest) {
	let logger = loggers.get(manifest);
	if (!logger) {
		logger = createConsoleLogger({ level: manifest.logLevel });
		loggers.set(manifest, logger);
	}
	return logger;
}
var resolvedLogger = createAsyncManifestMemo(async (manifest) => {
	const logger = getLogger(manifest);
	try {
		const destination = (await manifest.logger?.())?.default;
		if (destination) logger.setDestination(destination);
	} catch (error) {
		logger.error("config", "Failed to load the configured logger destination; continuing with the console logger.\n" + (error instanceof Error ? error.stack ?? error.message : String(error)));
	}
	return logger;
});
/**
* The manifest's logger with the user-configured destination (the
* `manifest.logger` thunk) resolved and applied via `setDestination` on the
* identity-stable logger. Memoized single-flight; awaited at request entry.
*
* Never rejects: a destination that fails to load is reported through the
* unswapped (console) logger, which stays in place — a broken custom
* destination cannot fail a request. Because the derivation always resolves,
* the memo's delete-on-rejection retry path never triggers: the thunk runs
* at most once per manifest.
*/
function getResolvedLogger(manifest) {
	return resolvedLogger.get(manifest);
}
// ../Alga Meet/node_modules/astro/dist/core/build/util.js
/**
* Given the Astro configuration, it tells if a slash should be appended or not
*/
function shouldAppendForwardSlash(trailingSlash, buildFormat) {
	switch (trailingSlash) {
		case "always": return true;
		case "never": return false;
		case "ignore": switch (buildFormat) {
			case "directory": return true;
			case "preserve":
			case "file": return false;
		}
	}
}
// ../Alga Meet/node_modules/astro/dist/core/request.js
/**
* Used by astro internals to create a web standard request object.
*
* The user of this function may provide the data in a runtime-agnostic way.
*
* This is used by the static build to create fake requests for prerendering, and by the dev server to convert node requests into the standard request object.
*/
function createRequest({ url, headers, method = "GET", body = void 0, logger, isPrerendered = false, routePattern, init }) {
	const headersObj = isPrerendered ? void 0 : headers instanceof Headers ? headers : new Headers(Object.entries(headers).filter(([name]) => !name.startsWith(":")));
	if (typeof url === "string") url = new URL(url);
	if (isPrerendered) url.search = "";
	const request = new Request(url, {
		method,
		headers: headersObj,
		body: isPrerendered ? null : body,
		...init
	});
	if (isPrerendered) {
		let _headers = request.headers;
		const { value, writable, ...headersDesc } = Object.getOwnPropertyDescriptor(request, "headers") || {};
		Object.defineProperty(request, "headers", {
			...headersDesc,
			get() {
				logger.warn(null, `\`Astro.request.headers\` was used when rendering the route \`${routePattern}'\`. \`Astro.request.headers\` is not available on prerendered pages. If you need access to request headers, make sure that the page is server-rendered using \`export const prerender = false;\` or by setting \`output\` to \`"server"\` in your Astro config to make all your pages server-rendered by default.`);
				return _headers;
			},
			set(newHeaders) {
				_headers = newHeaders;
			}
		});
	}
	return request;
}
// ../Alga Meet/node_modules/astro/dist/core/util/pathname.js
/**
* Thrown when a URL path is encoded so many times that we give up decoding it
* (see {@link validateAndDecodePathname}). When this happens we reject the
* request with a `400` instead of guessing the path. If we let a half-decoded
* path through, your middleware might check one path while Astro routes to a
* different one.
*/
var MultiLevelEncodingError = class extends Error {
	constructor() {
		super("URL encoding depth exceeded the maximum number of decode iterations");
		this.name = "MultiLevelEncodingError";
	}
};
/**
* How many times {@link validateAndDecodePathname} will decode a path before
* giving up. A normal URL is encoded once, or at most twice — for example a
* `[` (`%5B`) can arrive as `%255B` when a link is built from a value that was
* already encoded. A path that is still encoded after this many tries is
* almost certainly an attack, so we reject it instead of decoding again.
*/
var MAX_DECODE_ITERATIONS = 10;
/**
* Decodes a URL path over and over until it stops changing, so a path that was
* encoded several times ends up as a single, final path. This stops someone
* from sneaking a path like `/admin` past middleware by encoding it multiple
* times — middleware always sees the real, decoded path.
*
* @param pathname - The path to decode
* @returns The final, fully decoded path
* @throws Error if the path has broken encoding that can't be decoded at all
*   (for example a lone `%` that isn't followed by two hex digits)
* @throws MultiLevelEncodingError if the path is still changing after
*   {@link MAX_DECODE_ITERATIONS} tries (it was encoded too many times).
*   Handing back a half-decoded path here would bring back the security hole
*   this function exists to close.
*/
function validateAndDecodePathname(pathname) {
	let decoded;
	try {
		decoded = decodeURI(pathname);
	} catch (_e) {
		throw new Error("Invalid URL encoding");
	}
	let iterations = 0;
	while (decoded !== pathname) {
		if (iterations >= MAX_DECODE_ITERATIONS) throw new MultiLevelEncodingError();
		pathname = decoded;
		try {
			decoded = decodeURI(pathname);
		} catch {
			break;
		}
		iterations++;
	}
	return decoded;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/rewrite.js
/**
* Shared logic to retrieve the rewritten route. It returns a tuple that represents:
* 1. The new `Request` object. It contains `base`
* 2.
*/
async function findRouteToRewrite({ payload, routes, request, trailingSlash, buildFormat, base, outDir, validate }) {
	let newUrl = void 0;
	if (payload instanceof URL) newUrl = payload;
	else if (payload instanceof Request) newUrl = new URL(payload.url);
	else newUrl = new URL(collapseDuplicateSlashes(payload), new URL(request.url).origin);
	const { pathname, resolvedUrlPathname } = normalizeRewritePathname(newUrl.pathname, base, trailingSlash, buildFormat);
	newUrl.pathname = resolvedUrlPathname;
	const decodedPathname = validateAndDecodePathname(pathname);
	if (isRoute404(decodedPathname)) {
		const errorRoute = routes.find((route) => isRoute404(route.route));
		if (errorRoute) return {
			routeData: errorRoute,
			newUrl,
			pathname: decodedPathname
		};
	}
	if (isRoute500(decodedPathname)) {
		const errorRoute = routes.find((route) => isRoute500(route.route));
		if (errorRoute) return {
			routeData: errorRoute,
			newUrl,
			pathname: decodedPathname
		};
	}
	let foundRoute;
	let firstValidationError = null;
	for (const route of routes) if (route.pattern.test(decodedPathname)) {
		if (route.params && route.params.length !== 0) {
			if (route.distURL && route.distURL.length !== 0) {
				if (!route.distURL.find((url) => url.href.replace(outDir.toString(), "").replace(/(?:\/index\.html|\.html)$/, "") === trimSlashes(pathname))) continue;
			} else {
				let ownsPathname;
				try {
					ownsPathname = await validate(route, decodedPathname);
				} catch (error) {
					firstValidationError ??= error;
					continue;
				}
				if (!ownsPathname) continue;
			}
		}
		foundRoute = route;
		break;
	}
	if (foundRoute) return {
		routeData: foundRoute,
		newUrl,
		pathname: decodedPathname
	};
	else if (firstValidationError) throw firstValidationError;
	else {
		const custom404 = routes.find((route) => isRoute404(route.route));
		if (custom404) return {
			routeData: custom404,
			newUrl,
			pathname
		};
		else return {
			routeData: DEFAULT_404_ROUTE,
			newUrl,
			pathname
		};
	}
}
/**
* Utility function that creates a new `Request` with a new URL from an old `Request`.
*
* @param newUrl The new `URL`
* @param oldRequest The old `Request`
* @param isPrerendered It needs to be the flag of the previous routeData, before the rewrite
* @param logger
* @param routePattern
*/
function copyRequest(newUrl, oldRequest, isPrerendered, logger, routePattern) {
	const canHaveBody = oldRequest.method !== "GET" && oldRequest.method !== "HEAD";
	if (canHaveBody && oldRequest.bodyUsed) throw new AstroError(RewriteWithBodyUsed);
	return createRequest({
		url: newUrl,
		method: oldRequest.method,
		body: canHaveBody ? oldRequest.body : void 0,
		isPrerendered,
		logger,
		headers: isPrerendered ? {} : oldRequest.headers,
		routePattern,
		init: {
			referrer: oldRequest.referrer,
			referrerPolicy: oldRequest.referrerPolicy,
			mode: oldRequest.mode,
			credentials: oldRequest.credentials,
			cache: oldRequest.cache,
			redirect: oldRequest.redirect,
			integrity: oldRequest.integrity,
			signal: oldRequest.signal,
			keepalive: oldRequest.keepalive,
			duplex: "half"
		}
	});
}
function setOriginPathname(request, pathname, trailingSlash, buildFormat) {
	if (!pathname) pathname = "/";
	const shouldAppendSlash = shouldAppendForwardSlash(trailingSlash, buildFormat);
	let finalPathname;
	if (pathname === "/") finalPathname = "/";
	else if (shouldAppendSlash) finalPathname = appendForwardSlash(pathname);
	else finalPathname = removeTrailingForwardSlash(pathname);
	Reflect.set(request, originPathnameSymbol, encodeURIComponent(finalPathname));
}
function getOriginPathname(request) {
	const origin = Reflect.get(request, originPathnameSymbol);
	if (origin) return decodeURIComponent(origin);
	return new URL(request.url).pathname;
}
/**
* Pure function that normalizes a rewrite target pathname by stripping the base,
* handling trailing slashes, removing `.html` suffixes, and computing the final
* full URL pathname (with base re-prepended).
*/
function normalizeRewritePathname(urlPathname, base, trailingSlash, buildFormat) {
	let pathname = collapseDuplicateSlashes(urlPathname);
	const shouldAppendSlash = shouldAppendForwardSlash(trailingSlash, buildFormat);
	if (base !== "/") {
		if (urlPathname === base || urlPathname === removeTrailingForwardSlash(base)) pathname = "/";
		else if (urlPathname.startsWith(base)) {
			pathname = shouldAppendSlash ? appendForwardSlash(urlPathname) : removeTrailingForwardSlash(urlPathname);
			pathname = pathname.slice(base.length);
		}
	}
	if (!pathname.startsWith("/") && shouldAppendSlash && urlPathname.endsWith("/")) pathname = prependForwardSlash(pathname);
	if (buildFormat === "file") pathname = pathname.replace(/\.html$/, "");
	let resolvedUrlPathname;
	if (base !== "/" && (pathname === "" || pathname === "/") && !shouldAppendSlash) resolvedUrlPathname = removeTrailingForwardSlash(base);
	else resolvedUrlPathname = joinPaths(...[base, pathname].filter(Boolean));
	return {
		pathname,
		resolvedUrlPathname
	};
}
// ../Alga Meet/node_modules/astro/dist/core/environment/production.js
async function getModuleForRoute$1(manifest, route) {
	for (const defaultRoute of getDefaultRoutes(manifest)) if (route.component === defaultRoute.component) return { page: () => Promise.resolve(defaultRoute.instance) };
	let routeToProcess = route;
	if (routeIsRedirect(route)) {
		if (route.redirectRoute) routeToProcess = route.redirectRoute;
		else return RedirectSinglePageBuiltModule;
	} else if (routeIsFallback(route)) routeToProcess = getFallbackRoute(route, manifest.routes);
	if (manifest.pageMap) {
		const importComponentInstance = manifest.pageMap.get(routeToProcess.component);
		if (!importComponentInstance) throw new Error(`Unexpectedly unable to find a component instance for route ${route.route}`);
		return await importComponentInstance();
	} else if (manifest.pageModule) return manifest.pageModule;
	throw new Error("Astro couldn't find the correct page to render, probably because it wasn't correctly mapped for SSR usage. This is an internal error, please file an issue.");
}
async function getComponentByRoute$1(manifest, routeData) {
	return (await getModuleForRoute$1(manifest, routeData)).page();
}
/**
* The production / bundled environment — the default when nothing is
* registered. A stateless module constant derived from the manifest alone.
*/
var productionEnvironment = {
	name: "production",
	runtimeMode: "production",
	defaultStreaming: () => true,
	async resolve(manifest, specifier) {
		if (!(specifier in manifest.entryModules)) throw new Error(`Unable to resolve [${specifier}]`);
		const bundlePath = manifest.entryModules[specifier];
		if (bundlePath.startsWith("data:") || bundlePath.length === 0) return bundlePath;
		else return createAssetLink(bundlePath, manifest.base, manifest.assetsPrefix);
	},
	async headElements(manifest, routeData) {
		const { assetsPrefix, base } = manifest;
		const routeInfo = manifest.routes.find((route) => route.routeData.route === routeData.route);
		const links = /* @__PURE__ */ new Set();
		const scripts = /* @__PURE__ */ new Set();
		const styles = createStylesheetElementSet(routeInfo?.styles ?? [], base, assetsPrefix);
		for (const script of routeInfo?.scripts ?? []) if ("stage" in script) {
			if (script.stage === "head-inline") scripts.add({
				props: {},
				children: script.children
			});
		} else scripts.add(createModuleScriptElement(script, base, assetsPrefix));
		return {
			links,
			styles,
			scripts
		};
	},
	componentMetadata() {},
	getComponentByRoute: getComponentByRoute$1,
	getModuleForRoute: getModuleForRoute$1,
	async tryRewrite(manifest, payload, request) {
		const { newUrl, pathname, routeData } = await findRouteToRewrite({
			payload,
			request,
			routes: manifest.routes.map((r) => r.routeData),
			trailingSlash: manifest.trailingSlash,
			buildFormat: manifest.buildFormat,
			base: manifest.base,
			outDir: manifest.serverLike ? manifest.buildClientDir : manifest.outDir,
			validate: createRewriteRouteValidator(manifest, getComponentByRoute$1)
		});
		return {
			newUrl,
			pathname,
			componentInstance: await getComponentByRoute$1(manifest, routeData),
			routeData
		};
	},
	getRenderers(manifest) {
		return manifest.renderers;
	},
	errorStrategy: "default",
	rendersRedirectPage: () => false,
	injectCspMetaTagsOnErrorPages: false,
	logRequest() {}
};
// ../Alga Meet/node_modules/astro/dist/core/environment/index.js
var environments = /* @__PURE__ */ new WeakMap();
/**
* Registers the environment for a manifest. Idempotent; last registration wins
* (build may re-register after internals/options injection if it prefers).
*/
function setEnvironment(manifest, env) {
	environments.set(manifest, env);
}
/**
* The environment for a manifest. Defaults to the production (bundled)
* implementation, which is derivable from the manifest alone — so a bare
* `new FetchState(request)` in a bundled worker needs no registration.
*/
function getEnvironment(manifest) {
	return environments.get(manifest) ?? productionEnvironment;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/generator.js
/**
* Sanitizes the parameters object by normalizing string values and replacing certain characters with their URL-encoded equivalents.
* @param {Record<string, string | number>} params - The parameters object to be sanitized.
* @returns {Record<string, string | number>} The sanitized parameters object.
*/
function sanitizeParams(params) {
	return Object.fromEntries(Object.entries(params).map(([key, value]) => {
		if (typeof value === "string") return [key, value.normalize().replace(/#/g, "%23").replace(/\?/g, "%3F")];
		return [key, value];
	}));
}
function getParameter(part, params) {
	if (part.spread) return params[part.content.slice(3)] ?? "";
	if (part.dynamic) {
		if (params[part.content] === void 0) throw new TypeError(`Missing parameter: ${part.content}`);
		return params[part.content];
	}
	return part.content.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23").replace(/%5B/g, "[").replace(/%5D/g, "]");
}
function getSegment(segment, params) {
	const segmentPath = segment.map((part) => getParameter(part, params)).join("");
	return segmentPath ? collapseDuplicateLeadingSlashes("/" + segmentPath) : "";
}
function getRouteGenerator(segments, addTrailingSlash) {
	return (params) => {
		const sanitizedParams = sanitizeParams(params);
		let trailing = "";
		if (addTrailingSlash === "always" && segments.length) trailing = "/";
		return segments.map((segment) => getSegment(segment, sanitizedParams)).join("") + trailing || "/";
	};
}
// ../Alga Meet/node_modules/astro/dist/core/routing/internal/validation.js
var VALID_PARAM_TYPES = ["string", "undefined"];
/** Throws error for invalid parameter in getStaticPaths() response */
function validateGetStaticPathsParameter([key, value], route) {
	if (!VALID_PARAM_TYPES.includes(typeof value)) throw new AstroError({
		...GetStaticPathsInvalidRouteParam,
		message: GetStaticPathsInvalidRouteParam.message(key, value, typeof value),
		location: { file: route }
	});
}
// ../Alga Meet/node_modules/astro/dist/core/routing/params.js
/**
* given a route's Params object, validate parameter
* values and create a stringified key for the route
* that can be used to match request routes
*/
function stringifyParams(params, route, trailingSlash) {
	if (route.type === "endpoint" && hasFileExtension(route.route)) trailingSlash = "never";
	const validatedParams = {};
	for (const [key, value] of Object.entries(params)) {
		validateGetStaticPathsParameter([key, value], route.component);
		if (value !== void 0) validatedParams[key] = trimSlashes(value);
	}
	return getRouteGenerator(route.segments, trailingSlash)(validatedParams);
}
// ../Alga Meet/node_modules/astro/dist/core/routing/validation.js
/** Error for deprecated or malformed route components */
function validateDynamicRouteModule(mod, { ssr, route }) {
	if ((!ssr || route.prerender) && route.origin !== "internal" && !mod.getStaticPaths) throw new AstroError({
		...GetStaticPathsRequired,
		location: { file: route.component }
	});
}
/** Throw error and log warnings for malformed getStaticPaths() response */
function validateGetStaticPathsResult(result, route) {
	if (!Array.isArray(result)) throw new AstroError({
		...InvalidGetStaticPathsReturn,
		message: InvalidGetStaticPathsReturn.message(typeof result),
		location: { file: route.component }
	});
	result.forEach((pathObject) => {
		if (typeof pathObject === "object" && Array.isArray(pathObject) || pathObject === null) throw new AstroError({
			...InvalidGetStaticPathsEntry,
			message: InvalidGetStaticPathsEntry.message(Array.isArray(pathObject) ? "array" : typeof pathObject)
		});
		if (pathObject.params === void 0 || pathObject.params === null || pathObject.params && Object.keys(pathObject.params).length === 0) throw new AstroError({
			...GetStaticPathsExpectedParams,
			location: { file: route.component }
		});
	});
}
// ../Alga Meet/node_modules/astro/dist/core/render/paginate.js
function generatePaginateFunction(routeMatch, base, trailingSlash) {
	return function paginateUtility(data, args = {}) {
		const generate = getRouteGenerator(routeMatch.segments, trailingSlash);
		let { pageSize: _pageSize, params: _params, props: _props, format: _format } = args;
		const pageSize = _pageSize || 10;
		const paramName = "page";
		const additionalParams = _params || {};
		const additionalProps = _props || {};
		const formatUrl = _format || ((url) => url);
		let includesFirstPageNumber;
		if (routeMatch.params.includes(`...${paramName}`)) includesFirstPageNumber = false;
		else if (routeMatch.params.includes(`${paramName}`)) includesFirstPageNumber = true;
		else throw new AstroError({
			...PageNumberParamNotFound,
			message: PageNumberParamNotFound.message(paramName)
		});
		const lastPage = Math.max(1, Math.ceil(data.length / pageSize));
		return [...Array(lastPage).keys()].map((num) => {
			const pageNum = num + 1;
			const start = pageSize === Number.POSITIVE_INFINITY ? 0 : (pageNum - 1) * pageSize;
			const end = Math.min(start + pageSize, data.length);
			const params = {
				...additionalParams,
				[paramName]: includesFirstPageNumber || pageNum > 1 ? String(pageNum) : void 0
			};
			const current = formatUrl(addRouteBase(generate({ ...params }), base));
			const next = pageNum === lastPage ? void 0 : formatUrl(addRouteBase(generate({
				...params,
				page: String(pageNum + 1)
			}), base));
			const prev = pageNum === 1 ? void 0 : formatUrl(addRouteBase(generate({
				...params,
				page: !includesFirstPageNumber && pageNum - 1 === 1 ? void 0 : String(pageNum - 1)
			}), base));
			const first = pageNum === 1 ? void 0 : formatUrl(addRouteBase(generate({
				...params,
				page: includesFirstPageNumber ? "1" : void 0
			}), base));
			const last = pageNum === lastPage ? void 0 : formatUrl(addRouteBase(generate({
				...params,
				page: String(lastPage)
			}), base));
			return {
				params,
				props: {
					...additionalProps,
					page: {
						data: data.slice(start, end),
						start,
						end: end - 1,
						size: pageSize,
						total: data.length,
						currentPage: pageNum,
						lastPage,
						url: {
							current,
							next,
							prev,
							first,
							last
						}
					}
				}
			};
		});
	};
}
function addRouteBase(route, base) {
	let routeWithBase = joinPaths(base, route);
	if (routeWithBase === "") routeWithBase = "/";
	return routeWithBase;
}
// ../Alga Meet/node_modules/astro/dist/core/render/route-cache.js
async function callGetStaticPaths({ mod, route, routeCache, ssr, base, trailingSlash }) {
	const cached = routeCache.get(route);
	if (!mod) throw new Error("This is an error caused by Astro and not your code. Please file an issue.");
	if (cached?.staticPaths && cached.mod === mod) return cached.staticPaths;
	validateDynamicRouteModule(mod, {
		ssr,
		route
	});
	if (ssr && !route.prerender || route.origin === "internal") {
		const entry = Object.assign([], { keyed: /* @__PURE__ */ new Map() });
		routeCache.set(route, {
			...cached,
			mod,
			staticPaths: entry
		});
		return entry;
	}
	const keyedStaticPaths = await computeStaticPaths(mod, route, base, trailingSlash);
	routeCache.set(route, {
		mod,
		staticPaths: keyedStaticPaths
	});
	return keyedStaticPaths;
}
/** Replaces a partial entry with the full result, sharing one `getStaticPaths()` call between concurrent misses. */
function completeStaticPaths({ route, routeCache, base, trailingSlash }) {
	const cached = routeCache.get(route);
	if (!cached?.partial) return void 0;
	cached.complete ??= computeStaticPaths(cached.mod, route, base, trailingSlash).then((staticPaths) => {
		routeCache.set(route, {
			mod: cached.mod,
			staticPaths
		});
		return staticPaths;
	});
	return cached.complete;
}
async function computeStaticPaths(mod, route, base, trailingSlash) {
	let staticPaths = [];
	if (!mod.getStaticPaths) throw new Error("Unexpected Error.");
	staticPaths = await mod.getStaticPaths({
		paginate: generatePaginateFunction(route, base, trailingSlash),
		routePattern: route.route
	});
	validateGetStaticPathsResult(staticPaths, route);
	const keyedStaticPaths = staticPaths;
	keyedStaticPaths.keyed = /* @__PURE__ */ new Map();
	for (const sp of keyedStaticPaths) {
		const paramsKey = stringifyParams(sp.params, route, trailingSlash);
		keyedStaticPaths.keyed.set(paramsKey, sp);
	}
	return keyedStaticPaths;
}
/**
* Manage the route cache, responsible for caching data related to each route,
* including the result of calling getStaticPaths(). This gives route matching,
* params/props resolution, and prerender generation a shared static-path table.
*
* In dev, this cache intentionally survives requests. It is invalidated by route
* module identity changes after HMR or by explicit cache clears from content data
* changes, not by each request. Dev route matching can call getStaticPaths()
* before rendering, and render-time props resolution may ask for it again.
*/
var RouteCache = class {
	logger;
	cache = {};
	runtimeMode;
	constructor(logger, runtimeMode = "production") {
		this.logger = logger;
		this.runtimeMode = runtimeMode;
	}
	/** Clear the cache. */
	clearAll() {
		this.cache = {};
	}
	set(route, entry) {
		const key = this.key(route);
		const existing = this.cache[key];
		if (this.runtimeMode === "production" && existing?.staticPaths && !existing.partial) this.logger.warn(null, `Internal Warning: route cache overwritten. (${key})`);
		this.cache[key] = entry;
	}
	get(route) {
		return this.cache[this.key(route)];
	}
	key(route) {
		return `${route.route}_${route.component}`;
	}
};
var routeCaches = createManifestMemo((manifest) => new RouteCache(getLogger(manifest), getEnvironment(manifest).runtimeMode));
/**
* The `RouteCache` for a manifest. Cleared via
* `getRouteCache(manifest).clearAll()` on dev `astro:content-changed`.
*/
function getRouteCache(manifest) {
	return routeCaches.get(manifest);
}
function findPathItemByKey(staticPaths, params, route, logger, trailingSlash) {
	const paramsKey = stringifyParams(params, route, trailingSlash);
	const matchedStaticPath = staticPaths.keyed.get(paramsKey);
	if (matchedStaticPath) return matchedStaticPath;
	logger.debug("router", `findPathItemByKey() - Unexpected cache miss looking for ${paramsKey}`);
}
// ../Alga Meet/node_modules/astro/dist/core/render/params-and-props.js
async function getProps(opts) {
	const { logger, mod, routeData: route, routeCache, pathname, serverLike, base, trailingSlash } = opts;
	if (!route || route.pathname) return {};
	if (routeIsRedirect(route) || routeIsFallback(route) || route.component === "astro-default-404.astro") return {};
	const getStaticPathsOptions = {
		mod,
		route,
		routeCache,
		ssr: serverLike,
		base,
		trailingSlash
	};
	const staticPaths = await callGetStaticPaths(getStaticPathsOptions);
	const params = getParams(route, pathname);
	let matchedStaticPath = findPathItemByKey(staticPaths, params, route, logger, trailingSlash);
	if (!matchedStaticPath) {
		const allStaticPaths = await completeStaticPaths(getStaticPathsOptions);
		if (allStaticPaths) matchedStaticPath = findPathItemByKey(allStaticPaths, params, route, logger, trailingSlash);
	}
	if (!matchedStaticPath && route.origin !== "internal" && (serverLike ? route.prerender : true)) throw new AstroError({
		...NoMatchingStaticPathFound,
		message: NoMatchingStaticPathFound.message(pathname),
		hint: NoMatchingStaticPathFound.hint([route.component])
	});
	if (mod) validatePrerenderEndpointCollision(route, mod, params);
	return matchedStaticPath?.props ? { ...matchedStaticPath.props } : {};
}
/**
* When given a route with the pattern `/[x]/[y]/[z]/svelte`, and a pathname `/a/b/c/svelte`,
* returns the params object: { x: "a", y: "b", z: "c" }.
*/
function getParams(route, pathname) {
	if (!route.params.length) return {};
	const hasHtmlSuffix = pathname.endsWith(".html") && !routeHasHtmlExtension(route);
	const path = hasHtmlSuffix && route.type === "page" ? pathname.slice(0, -5) : pathname;
	const allPatterns = [route, ...route.fallbackRoutes].map((r) => r.pattern);
	let paramsMatch = allPatterns.map((pattern) => pattern.exec(path)).find((x) => x);
	if (!paramsMatch && hasHtmlSuffix && route.type !== "page") {
		const strippedPath = pathname.endsWith("/index.html") ? pathname.slice(0, -11) || "/" : pathname.slice(0, -5);
		paramsMatch = allPatterns.map((pattern) => pattern.exec(strippedPath)).find((x) => x);
	}
	if (!paramsMatch) return {};
	const params = {};
	route.params.forEach((key, i) => {
		if (key.startsWith("...")) params[key.slice(3)] = paramsMatch[i + 1] ? paramsMatch[i + 1] : void 0;
		else params[key] = paramsMatch[i + 1];
	});
	return params;
}
/**
* If we have an endpoint at `src/pages/api/[slug].ts` that's prerendered, and the `slug`
* is `undefined`, throw an error as we can't generate the `/api` file and `/api` directory
* at the same time. Using something like `[slug].json.ts` instead will work.
*/
function validatePrerenderEndpointCollision(route, mod, params) {
	if (route.type === "endpoint" && mod.getStaticPaths) {
		const lastSegment = route.segments[route.segments.length - 1];
		const paramValues = Object.values(params);
		const lastParam = paramValues[paramValues.length - 1];
		if (lastSegment.length === 1 && lastSegment[0].dynamic && lastParam === void 0) throw new AstroError({
			...PrerenderDynamicEndpointPathCollide,
			message: PrerenderDynamicEndpointPathCollide.message(route.route),
			hint: PrerenderDynamicEndpointPathCollide.hint(route.component),
			location: { file: route.component }
		});
	}
}
// ../Alga Meet/node_modules/astro/dist/core/routing/rewrite-validate.js
/**
* Creates the check `findRouteToRewrite` runs on a dynamic route whose
* `distURL` is empty. Returns `true` when `getStaticPaths()` produces the
* pathname, `false` when it throws `NoMatchingStaticPathFound`, and rethrows
* any other error so a broken `getStaticPaths()` is not hidden as a 404.
*/
function createRewriteRouteValidator(manifest, getComponentByRoute) {
	return async (route, pathname) => {
		try {
			await getProps({
				mod: await getComponentByRoute(manifest, route),
				routeData: route,
				routeCache: getRouteCache(manifest),
				pathname,
				logger: getLogger(manifest),
				serverLike: manifest.serverLike,
				base: manifest.base,
				trailingSlash: manifest.trailingSlash
			});
			return true;
		} catch (e) {
			if (isAstroError(e) && e.title === NoMatchingStaticPathFound.title) return false;
			throw e;
		}
	};
}
// ../Alga Meet/node_modules/astro/dist/core/build/plugins/util.js
var ASTRO_PAGE_KEY_SEPARATOR = "&";
/**
* Generate a unique key to identify each page in the build process.
* @param route Usually pageData.route.route
* @param componentPath Usually pageData.component
*/
function makePageDataKey(route, componentPath) {
	return route + ASTRO_PAGE_KEY_SEPARATOR + componentPath;
}
// ../Alga Meet/node_modules/astro/dist/core/build/runtime.js
/**
* From its route and component, get the page data from the build internals.
* @param internals Build Internals with all the pages
* @param route The route of the page, used to identify the page
* @param component The component of the page, used to identify the page
*/
function getPageData(internals, route, component) {
	let pageData = internals.pagesByKeys.get(makePageDataKey(route, component));
	if (pageData) return pageData;
}
/**
* Sort a page's CSS by depth. A higher depth means that the CSS comes from shared subcomponents.
* A lower depth means it comes directly from the top-level page.
* Can be used to sort stylesheets so that shared rules come first
* and page-specific rules come after.
*/
function cssOrder(a, b) {
	let depthA = a.depth, depthB = b.depth, orderA = a.order, orderB = b.order;
	if (orderA === -1 && orderB >= 0) return 1;
	else if (orderB === -1 && orderA >= 0) return -1;
	else if (orderA > orderB) return 1;
	else if (orderA < orderB) return -1;
	else if (depthA === -1) return -1;
	else if (depthB === -1) return 1;
	else return depthA > depthB ? -1 : 1;
}
/**
* Merges inline CSS into as few stylesheets as possible,
* preserving ordering when there are non-inlined in between.
*
* CSS chunks containing `@import` are never merged with other chunks.
* Per CSS spec, `@import` rules must appear at the top of a stylesheet
* or browsers silently ignore them. Keeping these chunks as separate
* `<style>` tags ensures the `@import` stays at the top of its own stylesheet.
*/
function mergeInlineCss(acc, current) {
	const lastAdded = acc.at(acc.length - 1);
	const lastWasInline = lastAdded?.type === "inline";
	const currentIsInline = current?.type === "inline";
	if (lastWasInline && currentIsInline) {
		const currentHasImport = current.content.includes("@import");
		const lastHasImport = lastAdded.content.includes("@import");
		if (!currentHasImport && !lastHasImport) {
			const merged = {
				type: "inline",
				content: lastAdded.content + current.content
			};
			acc[acc.length - 1] = merged;
			return acc;
		}
	}
	acc.push(current);
	return acc;
}
// ../Alga Meet/node_modules/astro/dist/core/build/environment.js
async function getModuleForRoute(manifest, route) {
	for (const defaultRoute of getDefaultRoutes(manifest)) if (route.component === defaultRoute.component) return { page: () => Promise.resolve(defaultRoute.instance) };
	let routeToProcess = route;
	if (routeIsRedirect(route)) {
		if (route.redirectRoute) routeToProcess = route.redirectRoute;
		else return RedirectSinglePageBuiltModule;
	} else if (routeIsFallback(route)) routeToProcess = getFallbackRoute(route, manifest.routes);
	if (manifest.pageMap) {
		const importComponentInstance = manifest.pageMap.get(routeToProcess.component);
		if (!importComponentInstance) throw new Error(`Unexpectedly unable to find a component instance for route ${route.route}`);
		return await importComponentInstance();
	} else if (manifest.pageModule) return manifest.pageModule;
	throw new Error("Astro couldn't find the correct page to render, probably because it wasn't correctly mapped for SSR usage. This is an internal error, please file an issue.");
}
async function getComponentByRoute(manifest, routeData) {
	return (await getModuleForRoute(manifest, routeData)).page();
}
function createBuildEnvironment() {
	let internals;
	let options;
	function getInternals() {
		if (!internals) throw new Error("No internals defined");
		return internals;
	}
	function getOptions() {
		if (!options) throw new Error("No options defined");
		return options;
	}
	function getSettings() {
		return getOptions().settings;
	}
	const resolveCache = /* @__PURE__ */ new Map();
	return {
		env: {
			name: "build",
			runtimeMode: "production",
			defaultStreaming: (manifest) => manifest.serverLike,
			async resolve(manifest, specifier) {
				if (resolveCache.has(specifier)) return resolveCache.get(specifier);
				const hashedFilePath = manifest.entryModules[specifier];
				if (typeof hashedFilePath !== "string" || hashedFilePath === "") {
					if (specifier === "astro:scripts/before-hydration.js") {
						resolveCache.set(specifier, "");
						return "";
					}
					throw new Error(`Cannot find the built path for ${specifier}`);
				}
				const assetLink = createAssetLink(hashedFilePath, manifest.base, manifest.assetsPrefix);
				resolveCache.set(specifier, assetLink);
				return assetLink;
			},
			headElements(manifest, routeData) {
				const { assetsPrefix, base } = manifest;
				const settings = getSettings();
				const buildInternals = getInternals();
				const links = /* @__PURE__ */ new Set();
				const pageBuildData = getPageData(buildInternals, routeData.route, routeData.component);
				const scripts = /* @__PURE__ */ new Set();
				const sortedCssAssets = pageBuildData?.styles.sort(cssOrder).map(({ sheet }) => sheet).reduce(mergeInlineCss, []);
				const styles = createStylesheetElementSet(sortedCssAssets ?? [], base, assetsPrefix);
				if (settings.scripts.some((script) => script.stage === "page")) {
					const hashedFilePath = buildInternals.entrySpecifierToBundleMap.get(PAGE_SCRIPT_ID);
					if (typeof hashedFilePath !== "string") throw new Error(`Cannot find the built path for ${PAGE_SCRIPT_ID}`);
					const src = createAssetLink(hashedFilePath, base, assetsPrefix);
					scripts.add({
						props: {
							type: "module",
							src
						},
						children: ""
					});
				}
				for (const script of settings.scripts) if (script.stage === "head-inline") scripts.add({
					props: {},
					children: script.content
				});
				return {
					scripts,
					styles,
					links
				};
			},
			componentMetadata() {},
			getComponentByRoute,
			getModuleForRoute,
			async tryRewrite(manifest, payload, request) {
				const { routeData, pathname, newUrl } = await findRouteToRewrite({
					payload,
					request,
					routes: manifest.routes.map((r) => r.routeData),
					trailingSlash: manifest.trailingSlash,
					buildFormat: manifest.buildFormat,
					base: manifest.base,
					outDir: manifest.serverLike ? manifest.buildClientDir : manifest.outDir,
					validate: createRewriteRouteValidator(manifest, getComponentByRoute)
				});
				return {
					routeData,
					componentInstance: await getComponentByRoute(manifest, routeData),
					newUrl,
					pathname
				};
			},
			getRenderers(manifest) {
				return manifest.renderers;
			},
			errorStrategy: "build",
			rendersRedirectPage() {
				return getSettings().redirectPage;
			},
			injectCspMetaTagsOnErrorPages: false,
			logRequest() {}
		},
		setInternals(value) {
			internals = value;
		},
		setOptions(value) {
			options = value;
		},
		getInternals,
		getOptions,
		getSettings
	};
}
// ../Alga Meet/node_modules/astro/dist/core/app/validate-headers.js
/**
* Parses a potentially comma-separated multi-value header (as produced by
* proxy chains) and returns the first value, trimmed of whitespace.
* Returns `undefined` when the header is absent or empty.
*/
function getFirstForwardedValue(multiValueHeader) {
	return multiValueHeader?.toString().split(",").map((e) => e.trim())[0];
}
/**
* Sanitize a hostname by rejecting any with path separators.
* Prevents path injection attacks. Invalid hostnames return undefined.
*/
function sanitizeHost(hostname) {
	if (!hostname) return void 0;
	if (/[/\\]/.test(hostname)) return void 0;
	return hostname;
}
/**
* Parse a host string into hostname and port components. Returns `undefined`
* for a host that carries more than a single `hostname:port` pair (e.g.
* `example.com:8080:8080`), which is not a valid host and would otherwise be
* accepted by inspecting only the first two segments.
*/
function parseHost(host) {
	const parts = host.split(":");
	if (parts.length > 2) return void 0;
	return {
		hostname: parts[0],
		port: parts[1]
	};
}
/**
* Check if a host matches any of the allowed domain patterns.
* Assumes hostname and port are already sanitized/parsed.
*/
function matchesAllowedDomains(hostname, protocol, port, allowedDomains) {
	const urlString = `${protocol}://${port ? `${hostname}:${port}` : hostname}`;
	if (!URL.canParse(urlString)) return false;
	const testUrl = new URL(urlString);
	return allowedDomains.some((pattern) => matchPattern(testUrl, pattern));
}
/**
* Validate a host against allowedDomains.
* Returns the host only if it matches an allowed pattern; otherwise, undefined.
* This prevents SSRF attacks by ensuring the Host header is trusted.
*/
function validateHost(host, protocol, allowedDomains) {
	if (!host || host.length === 0) return void 0;
	if (!allowedDomains || allowedDomains.length === 0) return void 0;
	const sanitized = sanitizeHost(host);
	if (!sanitized) return void 0;
	const parsed = parseHost(sanitized);
	if (!parsed) return void 0;
	const { hostname, port } = parsed;
	if (matchesAllowedDomains(hostname, protocol, port, allowedDomains)) return sanitized;
}
/**
* Validate forwarded headers (proto, host, port) against allowedDomains.
* Returns validated values or undefined for rejected headers.
* Uses strict defaults: http/https only for proto, rejects port if not in allowedDomains.
*/
function validateForwardedHeaders(forwardedProtocol, forwardedHost, forwardedPort, allowedDomains) {
	const result = {};
	if (forwardedProtocol) {
		if (allowedDomains && allowedDomains.length > 0) {
			if (allowedDomains.some((pattern) => pattern.protocol !== void 0)) try {
				const testUrl = new URL(`${forwardedProtocol}://example.com`);
				if (allowedDomains.some((pattern) => matchPattern(testUrl, { protocol: pattern.protocol }))) result.protocol = forwardedProtocol;
			} catch {}
			else if (/^https?$/.test(forwardedProtocol)) result.protocol = forwardedProtocol;
		}
	}
	if (forwardedPort && allowedDomains && allowedDomains.length > 0) {
		if (allowedDomains.some((pattern) => pattern.port !== void 0)) {
			if (allowedDomains.some((pattern) => pattern.port === forwardedPort)) result.port = forwardedPort;
		}
	}
	if (forwardedHost && forwardedHost.length > 0 && allowedDomains && allowedDomains.length > 0) {
		const protoForValidation = result.protocol || "https";
		const sanitized = sanitizeHost(forwardedHost);
		const parsed = sanitized ? parseHost(sanitized) : void 0;
		if (sanitized && parsed) {
			const { hostname, port: portFromHost } = parsed;
			if (matchesAllowedDomains(hostname, protoForValidation, result.port || portFromHost, allowedDomains)) result.host = sanitized;
		}
	}
	return result;
}
// ../Alga Meet/node_modules/astro/dist/core/i18n/domain.js
/**
* For domain-based i18n routing strategies, derives the locale-prefixed
* pathname from the request's `Host` header rather than its URL. For example,
* a request for `/foo` served from `https://example.fr` resolves to `/fr/foo`.
*
* Returns `undefined` when the strategy isn't domain-based or the host isn't
* mapped to a locale — in which case normal pathname routing applies.
*
*/
function computePathnameFromDomain(request, url, i18n, base, trailingSlash, allowedDomains, logger, pathnameFromRequest) {
	let pathname = void 0;
	if (i18n && (i18n.strategy === "domains-prefix-always" || i18n.strategy === "domains-prefix-other-locales" || i18n.strategy === "domains-prefix-always-no-redirect")) {
		const validated = validateForwardedHeaders(getFirstForwardedValue(request.headers.get("X-Forwarded-Proto") ?? void 0), getFirstForwardedValue(request.headers.get("X-Forwarded-Host") ?? void 0), getFirstForwardedValue(request.headers.get("X-Forwarded-Port") ?? void 0), allowedDomains);
		const protocol = validated.protocol ? `${validated.protocol}:` : url.protocol;
		const requestHost = request.headers.get("Host") ?? void 0;
		const validatedRequestHost = allowedDomains?.length ? validateHost(requestHost, protocol.slice(0, -1), allowedDomains) : requestHost;
		let host = validated.host ?? validatedRequestHost;
		if (host && protocol) {
			host = host.split(":")[0];
			try {
				let locale;
				const hostAsUrl = new URL(`${protocol}//${host}`);
				for (const [domainKey, localeValue] of Object.entries(i18n.domainLookupTable)) {
					const domainKeyAsUrl = new URL(domainKey);
					if (hostAsUrl.host === domainKeyAsUrl.host && hostAsUrl.protocol === domainKeyAsUrl.protocol) {
						locale = localeValue;
						break;
					}
				}
				if (locale) {
					const requestPathname = pathnameFromRequest ?? stripRequestBase(url.pathname, base);
					pathname = prependForwardSlash(joinPaths(normalizeTheLocale(locale), requestPathname));
					if (trailingSlash === "always") pathname = appendForwardSlash(pathname);
					else if (trailingSlash === "never") pathname = removeTrailingForwardSlash(pathname);
					else if (url.pathname.endsWith("/")) pathname = appendForwardSlash(pathname);
				}
			} catch (e) {
				logger.error("router", `Astro tried to parse ${protocol}//${host} as an URL, but it threw a parsing error. Check the X-Forwarded-Host and X-Forwarded-Proto headers.`);
				logger.error("router", `Error: ${e}`);
			}
		}
	}
	return pathname;
}
// ../Alga Meet/node_modules/astro/dist/core/cookies/cookies.js
var DELETED_EXPIRATION = /* @__PURE__ */ new Date(0);
var DELETED_VALUE = "deleted";
var responseSentSymbol = Symbol.for("astro.responseSent");
var identity = (value) => value;
var AstroCookie = class {
	value;
	constructor(value) {
		this.value = value;
	}
	json() {
		if (this.value === void 0) throw new Error(`Cannot convert undefined to an object.`);
		return JSON.parse(this.value);
	}
	number() {
		return Number(this.value);
	}
	boolean() {
		if (this.value === "false") return false;
		if (this.value === "0") return false;
		return Boolean(this.value);
	}
};
var AstroCookies = class {
	#request;
	#requestValues;
	#outgoing;
	#consumed;
	#logger;
	constructor(request, logger) {
		this.#request = request;
		this.#requestValues = null;
		this.#outgoing = null;
		this.#consumed = false;
		this.#logger = logger;
	}
	/**
	* Astro.cookies.delete(key) is used to delete a cookie. Using this method will result
	* in a Set-Cookie header added to the response.
	* @param key The cookie to delete
	* @param options Options related to this deletion, such as the path of the cookie.
	*/
	delete(key, options) {
		this.#ensureOutgoingMap().set(key, [
			DELETED_VALUE,
			stringifySetCookie({
				...options,
				name: key,
				value: DELETED_VALUE,
				expires: DELETED_EXPIRATION,
				maxAge: void 0
			}),
			false
		]);
	}
	/**
	* Astro.cookies.get(key) is used to get a cookie value. The cookie value is read from the
	* request. If you have set a cookie via Astro.cookies.set(key, value), the value will be taken
	* from that set call, overriding any values already part of the request.
	* @param key The cookie to get.
	* @returns An object containing the cookie value as well as convenience methods for converting its value.
	*/
	get(key, options = void 0) {
		if (this.#outgoing?.has(key)) {
			let [serializedValue, , isSetValue] = this.#outgoing.get(key);
			if (isSetValue) return new AstroCookie(serializedValue);
			else return;
		}
		const decode = options?.decode ?? decodeURIComponent;
		const values = this.#ensureParsed();
		if (key in values) {
			const value = values[key];
			if (value !== void 0) {
				let decodedValue;
				try {
					decodedValue = decode(value);
				} catch (_error) {
					decodedValue = value;
				}
				return new AstroCookie(decodedValue);
			}
		}
	}
	/**
	* Astro.cookies.has(key) returns a boolean indicating whether this cookie is either
	* part of the initial request or set via Astro.cookies.set(key)
	* @param key The cookie to check for.
	* @param _options This parameter is no longer used.
	* @returns
	*/
	has(key, _options) {
		if (this.#outgoing?.has(key)) {
			let [, , isSetValue] = this.#outgoing.get(key);
			return isSetValue;
		}
		return this.#ensureParsed()[key] !== void 0;
	}
	/**
	* Astro.cookies.set(key, value) is used to set a cookie's value. If provided
	* an object it will be stringified via JSON.stringify(value). Additionally you
	* can provide options customizing how this cookie will be set, such as setting httpOnly
	* in order to prevent the cookie from being read in client-side JavaScript.
	* @param key The name of the cookie to set.
	* @param value A value, either a string or other primitive or an object.
	* @param options Options for the cookie, such as the path and security settings.
	*/
	set(key, value, options) {
		if (this.#consumed) this.#logger.warn("SKIP_FORMAT", "Astro.cookies.set() was called after the cookies had already been sent to the browser.\nThis may have happened if this method was called in an imported component.\nPlease make sure that Astro.cookies.set() is only called in the frontmatter of the main page.");
		let serializedValue;
		if (typeof value === "string") serializedValue = value;
		else {
			let toStringValue = value.toString();
			if (toStringValue === Object.prototype.toString.call(value)) serializedValue = JSON.stringify(value);
			else serializedValue = toStringValue;
		}
		const { encode, ...attributes } = options ?? {};
		this.#ensureOutgoingMap().set(key, [
			serializedValue,
			stringifySetCookie({
				...attributes,
				name: key,
				value: serializedValue
			}, { encode }),
			true
		]);
		if (this.#request[responseSentSymbol]) throw new AstroError({ ...ResponseSentError });
	}
	/**
	* Merges a new AstroCookies instance into the current instance. Any new cookies
	* will be added to the current instance, overwriting any existing cookies with the same name.
	*/
	merge(cookies) {
		const outgoing = cookies.#outgoing;
		if (outgoing) for (const [key, value] of outgoing) this.#ensureOutgoingMap().set(key, value);
	}
	/**
	* Astro.cookies.header() returns an iterator for the cookies that have previously
	* been set by either Astro.cookies.set() or Astro.cookies.delete().
	* This method is primarily used by adapters to set the header on outgoing responses.
	* @returns
	*/
	*headers() {
		if (this.#outgoing == null) return;
		for (const [, value] of this.#outgoing) yield value[1];
	}
	/**
	* Marks the cookies as consumed and returns the header values.
	* After consumption, any subsequent `set()` calls will warn.
	*/
	consume() {
		this.#consumed = true;
		return this.headers();
	}
	/**
	* @deprecated Use the instance method `cookies.consume()` instead.
	* Kept for backward compatibility with adapters.
	*/
	static consume(cookies) {
		return cookies.consume();
	}
	#ensureParsed() {
		if (!this.#requestValues) this.#parse();
		if (!this.#requestValues) this.#requestValues = Object.create(null);
		return this.#requestValues;
	}
	#ensureOutgoingMap() {
		if (!this.#outgoing) this.#outgoing = /* @__PURE__ */ new Map();
		return this.#outgoing;
	}
	#parse() {
		const raw = this.#request.headers.get("cookie");
		if (!raw) return;
		this.#requestValues = parseCookie(raw, { decode: identity });
	}
};
// ../Alga Meet/node_modules/astro/dist/core/cookies/response.js
var astroCookiesSymbol = Symbol.for("astro.cookies");
function attachCookiesToResponse(response, cookies) {
	Reflect.set(response, astroCookiesSymbol, cookies);
}
function getCookiesFromResponse(response) {
	let cookies = Reflect.get(response, astroCookiesSymbol);
	if (cookies != null) return cookies;
	else return;
}
function* getSetCookiesFromResponse(response) {
	const cookies = getCookiesFromResponse(response);
	if (!cookies) return [];
	for (const headerValue of cookies.consume()) yield headerValue;
	return [];
}
/**
* The ambient manifest: the explicitly registered one, else the virtual
* module's. Throws lazily when neither is available, so merely importing a
* module that uses this never fails — only actually handling a request does.
*/
function getAmbientManifest() {
	const manifest$1 = manifest;
	if (!manifest$1) throw new AstroError(NoManifestAvailable);
	return manifest$1;
}
// ../Alga Meet/node_modules/astro/dist/core/app/render-options.js
/**
* Symbol used to attach `ResolvedRenderOptions` to a `Request` object so
* that they can flow through the `FetchHandler` signature (which only takes
* a request) into the request handler chain. This is an internal implementation
* detail between `BaseApp` and the default handler pipeline.
*/
var renderOptionsSymbol = Symbol.for("astro.renderOptions");
/**
* Reads `ResolvedRenderOptions` that were attached to a request via
* `renderOptionsSymbol`. Returns `undefined` if no options are attached.
*/
function getRenderOptions(request) {
	return Reflect.get(request, renderOptionsSymbol);
}
/**
* Attaches `ResolvedRenderOptions` to a request via `renderOptionsSymbol` so
* that downstream handlers can read them.
*/
function setRenderOptions(request, options) {
	Reflect.set(request, renderOptionsSymbol, options);
}
// ../Alga Meet/node_modules/astro/dist/core/middleware/defineMiddleware.js
function defineMiddleware(fn) {
	return fn;
}
// ../Alga Meet/node_modules/astro/dist/core/app/origin-check.js
/**
* Content types that can be passed when sending a request via a form
*
* https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/enctype
* @private
*/
var FORM_CONTENT_TYPES = [
	"application/x-www-form-urlencoded",
	"multipart/form-data",
	"text/plain"
];
var SAFE_METHODS = [
	"GET",
	"HEAD",
	"OPTIONS"
];
/**
* Determines whether a request should be rejected because it is a cross-site
* submission for a route rendered on demand.
*
* This encapsulates the shared logic used by both the origin-check middleware
* and the Astro Actions dispatch, so the check is applied consistently
* regardless of where the request is handled.
*
* @private
*/
function isForbiddenCrossOriginRequest(request, url, isPrerendered) {
	if (isPrerendered) return false;
	if (SAFE_METHODS.includes(request.method)) return false;
	const contentType = request.headers.get("content-type");
	if (contentType && !hasFormLikeHeader(contentType)) return false;
	switch (request.headers.get("sec-fetch-site")) {
		case "":
		case null: break;
		case "same-origin":
		case "none": return false;
		default: return true;
	}
	const origin = request.headers.get("origin");
	if (!origin) return false;
	return origin !== url.origin;
}
/**
* Builds the 403 response returned when a cross-site submission is rejected.
*
* @private
*/
function createCrossOriginForbiddenResponse(request) {
	return new Response(`Cross-site ${request.method} form submissions are forbidden`, { status: 403 });
}
/**
* Returns middleware that rejects cross-origin form submissions.
*
* @private
*/
function createOriginCheckMiddleware() {
	return defineMiddleware((context, next) => {
		const { request, url, isPrerendered } = context;
		if (isForbiddenCrossOriginRequest(request, url, isPrerendered)) return createCrossOriginForbiddenResponse(request);
		return next();
	});
}
function hasFormLikeHeader(contentType) {
	if (contentType) {
		for (const FORM_CONTENT_TYPE of FORM_CONTENT_TYPES) if (contentType.toLowerCase().includes(FORM_CONTENT_TYPE)) return true;
	}
	return false;
}
// ../Alga Meet/node_modules/astro/dist/core/fetch/features.js
/**
* Bit flags for features that handler functions register as "used" when a
* custom `src/fetch.ts` fetch handler is in play. After the first request
* (dev) or at runtime (prod SSR), we compare against the manifest to warn
* about features the user configured but forgot to include in their custom
* fetch handler.
*/
var FetchFeatures = {
	redirects: 1,
	sessions: 2,
	actions: 4,
	middleware: 8,
	i18n: 16,
	cache: 32
};
/** All feature bits ORed together. Keep next to `FetchFeatures` so
*  new flags are hard to forget. */
var ALL_FETCH_FEATURES = FetchFeatures.redirects | FetchFeatures.sessions | FetchFeatures.actions | FetchFeatures.middleware | FetchFeatures.i18n | FetchFeatures.cache;
var usedFeatures = /* @__PURE__ */ new WeakMap();
/** ORs a feature bit into the manifest's used-features bitmask. */
function markFeatureUsed(manifest, feature) {
	const entry = usedFeatures.get(manifest);
	if (entry) entry.bits |= feature;
	else usedFeatures.set(manifest, { bits: feature });
}
/** The used-features bitmask for a manifest; `0` when nothing was marked. */
function getUsedFeatures(manifest) {
	return usedFeatures.get(manifest)?.bits ?? 0;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/invalid-encoding.js
/**
* Returns an empty `400 Bad Request` response when the request path was
* encoded too many times to fully decode (`state.invalidEncoding`), or
* `undefined` otherwise.
*
* Every entry point that routes the request or runs middleware calls this
* first, so composable pipelines reject the request the same way
* `handleRequest` does regardless of which handlers they include.
*/
function rejectInvalidEncoding(state) {
	if (state.invalidEncoding) return new Response(null, {
		status: 400,
		statusText: "Bad Request"
	});
}
// ../Alga Meet/node_modules/astro/dist/actions/consts.js
var ACTION_QUERY_PARAMS = {
	actionName: "_action",
	actionPayload: "_astroActionPayload"
};
// ../Alga Meet/node_modules/astro/dist/actions/runtime/client.js
var codeToStatusMap = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	PAYMENT_REQUIRED: 402,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	METHOD_NOT_ALLOWED: 405,
	NOT_ACCEPTABLE: 406,
	PROXY_AUTHENTICATION_REQUIRED: 407,
	REQUEST_TIMEOUT: 408,
	CONFLICT: 409,
	GONE: 410,
	LENGTH_REQUIRED: 411,
	PRECONDITION_FAILED: 412,
	CONTENT_TOO_LARGE: 413,
	URI_TOO_LONG: 414,
	UNSUPPORTED_MEDIA_TYPE: 415,
	RANGE_NOT_SATISFIABLE: 416,
	EXPECTATION_FAILED: 417,
	MISDIRECTED_REQUEST: 421,
	UNPROCESSABLE_CONTENT: 422,
	LOCKED: 423,
	FAILED_DEPENDENCY: 424,
	TOO_EARLY: 425,
	UPGRADE_REQUIRED: 426,
	PRECONDITION_REQUIRED: 428,
	TOO_MANY_REQUESTS: 429,
	REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
	UNAVAILABLE_FOR_LEGAL_REASONS: 451,
	INTERNAL_SERVER_ERROR: 500,
	NOT_IMPLEMENTED: 501,
	BAD_GATEWAY: 502,
	SERVICE_UNAVAILABLE: 503,
	GATEWAY_TIMEOUT: 504,
	HTTP_VERSION_NOT_SUPPORTED: 505,
	VARIANT_ALSO_NEGOTIATES: 506,
	INSUFFICIENT_STORAGE: 507,
	LOOP_DETECTED: 508,
	NETWORK_AUTHENTICATION_REQUIRED: 511
};
var statusToCodeMap = Object.fromEntries(Object.entries(codeToStatusMap).map(([key, value]) => [value, key]));
var ActionError = class ActionError extends Error {
	type = "AstroActionError";
	code = "INTERNAL_SERVER_ERROR";
	status = 500;
	constructor(params) {
		super(params.message);
		this.code = params.code;
		this.status = ActionError.codeToStatus(params.code);
		if (params.stack) this.stack = params.stack;
	}
	static codeToStatus(code) {
		return codeToStatusMap[code];
	}
	static statusToCode(status) {
		return statusToCodeMap[status] ?? "INTERNAL_SERVER_ERROR";
	}
	static fromJson(body) {
		if (isInputError(body)) return new ActionInputError(body.issues);
		if (isActionError(body)) return new ActionError(body);
		return new ActionError({ code: "INTERNAL_SERVER_ERROR" });
	}
};
function isActionError(error) {
	return typeof error === "object" && error != null && "type" in error && error.type === "AstroActionError";
}
function isInputError(error) {
	return typeof error === "object" && error != null && "type" in error && error.type === "AstroActionInputError" && "issues" in error && Array.isArray(error.issues);
}
var ActionInputError = class extends ActionError {
	type = "AstroActionInputError";
	issues;
	fields;
	constructor(issues) {
		super({
			message: `Failed to validate: ${JSON.stringify(issues, null, 2)}`,
			code: "BAD_REQUEST"
		});
		this.issues = issues;
		this.fields = {};
		for (const issue of issues) if (issue.path.length > 0) {
			const key = issue.path[0].toString();
			this.fields[key] ??= [];
			this.fields[key]?.push(issue.message);
		}
	}
};
function deserializeActionResult(res) {
	if (res.type === "error") {
		let json;
		try {
			json = JSON.parse(res.body);
		} catch {
			return {
				data: void 0,
				error: new ActionError({
					message: res.body,
					code: "INTERNAL_SERVER_ERROR"
				})
			};
		}
		if (Object.assign({
			"ASSETS_PREFIX": void 0,
			"BASE_URL": "/",
			"DEV": false,
			"MODE": "production",
			"PROD": true,
			"PUBLIC_API_URL": "http://localhost:4599",
			"PUBLIC_SITE_URL": "http://localhost:4599",
			"SITE": "http://localhost:4599",
			"SSR": true
		}, {
			OS: "Windows_NT",
			_: "C:/Program Files/nodejs/node.exe"
		})?.PROD) return {
			error: ActionError.fromJson(json),
			data: void 0
		};
		else {
			const error = ActionError.fromJson(json);
			error.stack = actionResultErrorStack.get();
			return {
				error,
				data: void 0
			};
		}
	}
	if (res.type === "empty") return {
		data: void 0,
		error: void 0
	};
	return {
		data: parse(res.body, { URL: (href) => new URL(href) }),
		error: void 0
	};
}
var actionResultErrorStack = (function actionResultErrorStackFn() {
	let errorStack;
	return {
		set(stack) {
			errorStack = stack;
		},
		get() {
			return errorStack;
		}
	};
})();
function getActionQueryString(name) {
	return `?${new URLSearchParams({ [ACTION_QUERY_PARAMS.actionName]: name }).toString()}`;
}
// ../Alga Meet/node_modules/astro/dist/actions/utils.js
function hasActionPayload(locals) {
	return "_actionPayload" in locals;
}
function createGetActionResult(locals) {
	return (actionFn) => {
		if (!hasActionPayload(locals) || actionFn.toString() !== getActionQueryString(locals._actionPayload.actionName)) return;
		return deserializeActionResult(locals._actionPayload.actionResult);
	};
}
function createCallAction(context) {
	return (baseAction, input) => {
		Reflect.set(context, ACTION_API_CONTEXT_SYMBOL, true);
		return baseAction.bind(context)(input);
	};
}
// ../Alga Meet/node_modules/astro/dist/core/render/slots.js
function getFunctionExpression(slot) {
	if (!slot) return;
	const expressions = slot?.expressions?.filter((e) => isRenderInstruction(e) === false || isRenderTemplateResult(e));
	if (expressions?.length !== 1) return;
	const expression = expressions[0];
	if (isRenderTemplateResult(expression)) return getFunctionExpression(expression);
	return expression;
}
var Slots = class {
	#result;
	#slots;
	#logger;
	constructor(result, slots, logger) {
		this.#result = result;
		this.#slots = slots;
		this.#logger = logger;
		if (slots) for (const key of Object.keys(slots)) {
			if (this[key] !== void 0) throw new AstroError({
				...ReservedSlotName,
				message: ReservedSlotName.message(key)
			});
			Object.defineProperty(this, key, {
				get() {
					return true;
				},
				enumerable: true
			});
		}
	}
	has(name) {
		if (!this.#slots) return false;
		return Boolean(this.#slots[name]);
	}
	async render(name, args = []) {
		if (!this.#slots || !this.has(name)) return;
		const result = this.#result;
		if (!Array.isArray(args)) this.#logger.warn(null, `Expected second parameter to be an array, received a ${typeof args}. If you're trying to pass an array as a single argument and getting unexpected results, make sure you're passing your array as an item of an array. Ex: Astro.slots.render('default', [["Hello", "World"]])`);
		else if (args.length > 0) {
			const slotValue = this.#slots[name];
			const component = typeof slotValue === "function" ? await slotValue(result) : await slotValue;
			const expression = getFunctionExpression(component);
			if (expression) {
				const slot = async () => typeof expression === "function" ? expression(...args) : expression;
				return await renderSlotToString(result, slot).then((res) => {
					return res;
				});
			}
			if (typeof component === "function") return await renderJSX(result, component(...args)).then((res) => res != null ? String(res) : res);
		}
		const content = await renderSlotToString(result, this.#slots[name]);
		return chunkToString(result, content);
	}
};
// ../Alga Meet/node_modules/astro/dist/i18n/fallback.js
/**
* Compute fallback route for failed responses.
* Pure function - no APIContext, no Response objects, no URL objects.
*
* This function determines whether a failed request should be redirected or rewritten
* to a fallback locale based on the i18n configuration.
*/
function computeFallbackRoute(options) {
	const { pathname, responseStatus, fallback, fallbackType, locales, defaultLocale, strategy } = options;
	if (responseStatus !== 404) return { type: "none" };
	if (!fallback || Object.keys(fallback).length === 0) return { type: "none" };
	const segments = pathname.split("/");
	const urlLocale = segments.find((segment) => {
		for (const locale of locales) if (typeof locale === "string") {
			if (locale === segment) return true;
		} else if (locale.path === segment) return true;
		return false;
	});
	if (!urlLocale) return { type: "none" };
	if (!Object.keys(fallback).includes(urlLocale)) return { type: "none" };
	const fallbackLocale = fallback[urlLocale];
	const pathFallbackLocale = getPathByLocale(fallbackLocale, locales);
	const localeIndex = segments.indexOf(urlLocale);
	let newPathname;
	if (pathFallbackLocale === defaultLocale && strategy === "pathname-prefix-other-locales") {
		segments.splice(localeIndex, 1);
		newPathname = segments.join("/") || "/";
	} else {
		segments[localeIndex] = pathFallbackLocale;
		newPathname = segments.join("/");
	}
	return {
		type: fallbackType,
		pathname: newPathname
	};
}
// ../Alga Meet/node_modules/astro/dist/i18n/router.js
/**
* Router for i18n routing strategy decisions.
* Determines whether to continue, redirect, or return 404 based on pathname and locale.
*
* This is a pure class that returns decision objects (not HTTP Responses).
* The middleware layer is responsible for converting decisions to HTTP responses.
*/
var I18nRouter = class {
	#strategy;
	#defaultLocale;
	#locales;
	#base;
	#domains;
	constructor(options) {
		this.#strategy = options.strategy;
		this.#defaultLocale = options.defaultLocale;
		this.#locales = options.locales;
		this.#base = options.base === "/" ? "/" : removeTrailingForwardSlash(options.base || "");
		this.#domains = options.domains;
	}
	/**
	* Evaluate routing strategy for a pathname.
	* Returns decision object (not HTTP Response).
	*/
	match(pathname, context) {
		if (this.shouldSkipProcessing(pathname, context)) return { type: "continue" };
		switch (this.#strategy) {
			case "manual": return { type: "continue" };
			case "pathname-prefix-always": return this.matchPrefixAlways(pathname, context);
			case "domains-prefix-always":
				if (this.localeHasntDomain(context.currentLocale, context.currentDomain)) return { type: "continue" };
				return this.matchPrefixAlways(pathname, context);
			case "pathname-prefix-other-locales": return this.matchPrefixOtherLocales(pathname, context);
			case "domains-prefix-other-locales":
				if (this.localeHasntDomain(context.currentLocale, context.currentDomain)) return { type: "continue" };
				return this.matchPrefixOtherLocales(pathname, context);
			case "pathname-prefix-always-no-redirect": return this.matchPrefixAlwaysNoRedirect(pathname, context);
			case "domains-prefix-always-no-redirect":
				if (this.localeHasntDomain(context.currentLocale, context.currentDomain)) return { type: "continue" };
				return this.matchPrefixAlwaysNoRedirect(pathname, context);
			default: return { type: "continue" };
		}
	}
	/**
	* Check if i18n processing should be skipped for this request
	*/
	shouldSkipProcessing(pathname, context) {
		for (const page of STATUS_CODE_PAGES) if (pathname.includes(page)) return true;
		if (pathname.includes("/_server-islands/")) return true;
		if (context.isReroute) return true;
		if (context.routeType && context.routeType !== "page" && context.routeType !== "fallback") return true;
		return false;
	}
	/**
	* Strategy: pathname-prefix-always
	* All locales must have a prefix, including the default locale.
	*/
	matchPrefixAlways(pathname, context) {
		if (pathname === this.#base + "/" || pathname === this.#base) return {
			type: "redirect",
			location: `${this.#base === "/" ? "" : this.#base}/${this.#defaultLocale}`
		};
		if (!context.allowUnprefixedPath && !pathHasLocale(pathname, this.#locales)) return { type: "notFound" };
		return { type: "continue" };
	}
	/**
	* Strategy: pathname-prefix-other-locales
	* Default locale has no prefix, other locales must have a prefix.
	*/
	matchPrefixOtherLocales(pathname, _context) {
		let pathnameContainsDefaultLocale = false;
		for (const segment of pathname.split("/")) if (normalizeTheLocale(segment) === normalizeTheLocale(this.#defaultLocale)) {
			pathnameContainsDefaultLocale = true;
			break;
		}
		if (pathnameContainsDefaultLocale) return {
			type: "notFound",
			location: pathname.replace(`/${this.#defaultLocale}`, "")
		};
		return { type: "continue" };
	}
	/**
	* Strategy: pathname-prefix-always-no-redirect
	* Like prefix-always but allows root to serve instead of redirecting
	*/
	matchPrefixAlwaysNoRedirect(pathname, context) {
		if (pathname === this.#base + "/" || pathname === this.#base) return { type: "continue" };
		if (!context.allowUnprefixedPath && !pathHasLocale(pathname, this.#locales)) return { type: "notFound" };
		return { type: "continue" };
	}
	/**
	* Check if the current locale doesn't belong to the configured domain.
	* Used for domain-based routing strategies.
	*/
	localeHasntDomain(currentLocale, currentDomain) {
		if (!this.#domains || !currentDomain) return false;
		if (!currentLocale) return false;
		const localesForDomain = this.#domains[currentDomain];
		if (!localesForDomain) return true;
		return !localesForDomain.includes(currentLocale);
	}
};
// ../Alga Meet/node_modules/astro/dist/core/i18n/handler.js
/**
* Pure compile from explicit values — used by `astro:i18n`'s manual-mode
* middleware wrapper (`src/i18n/middleware.ts`), which receives the values as
* arguments rather than reading a manifest.
*/
function compileI18n(i18n, base, trailingSlash, format) {
	return {
		config: i18n,
		base,
		trailingSlash,
		format,
		router: new I18nRouter({
			strategy: i18n.strategy,
			defaultLocale: i18n.defaultLocale,
			locales: i18n.locales,
			base,
			domains: i18n.domainLookupTable ? Object.keys(i18n.domainLookupTable).reduce((acc, domain) => {
				const locale = i18n.domainLookupTable[domain];
				if (!acc[domain]) acc[domain] = [];
				acc[domain].push(locale);
				return acc;
			}, {}) : void 0
		})
	};
}
var i18nMemo = createManifestMemo((manifest) => {
	const config = manifest.i18n;
	return config && config.strategy !== "manual" ? compileI18n(config, manifest.base, manifest.trailingSlash, manifest.buildFormat) : null;
});
/**
* The compiled i18n post-processor for a manifest, or `null` when i18n is
* unset or the routing strategy is `manual`.
*/
function getI18n(manifest) {
	return i18nMemo.get(manifest);
}
/**
* Post-processes a rendered `Response` against the compiled i18n
* configuration, as an explicit step in `handleRequest` after the middleware
* chain returns. The manual-strategy public API (`astro:i18n.middleware(...)`)
* wraps this in a middleware-shaped closure.
*/
async function finalizeI18n(compiled, state, response) {
	markFeatureUsed(state.manifest, FetchFeatures.i18n);
	const i18n = compiled.config;
	if (state.skipErrorReroute && typeof i18n.fallback === "undefined") return response;
	if (state.responseRouteType !== "page" && state.responseRouteType !== "fallback") return response;
	const url = state.url;
	const currentLocale = state.computeCurrentLocale();
	const routeData = state.routeData;
	const isPrerendered = routeData.prerender;
	const routerContext = {
		currentLocale,
		currentDomain: url.hostname,
		routeType: state.responseRouteType,
		isReroute: false,
		allowUnprefixedPath: routeData.origin === "external" && !routeData.segments?.[0]?.some((part) => part.dynamic)
	};
	const routeDecision = compiled.router.match(url.pathname, routerContext);
	switch (routeDecision.type) {
		case "redirect": {
			let location = routeDecision.location;
			if (shouldAppendForwardSlash(compiled.trailingSlash, compiled.format)) location = appendForwardSlash(location);
			return new Response(null, {
				status: routeDecision.status ?? 302,
				headers: { Location: location }
			});
		}
		case "notFound": {
			if (isPrerendered) {
				const prerenderedRes = new Response(response.body, {
					status: 404,
					headers: response.headers
				});
				state.skipErrorReroute = true;
				if (routeDecision.location) prerenderedRes.headers.set("Location", routeDecision.location);
				return prerenderedRes;
			}
			const headers = new Headers();
			if (routeDecision.location) headers.set("Location", routeDecision.location);
			return new Response(null, {
				status: 404,
				headers
			});
		}
	}
	if (i18n.fallback && i18n.fallbackType) {
		const effectiveStatus = state.responseRouteType === "fallback" ? 404 : response.status;
		const fallbackDecision = computeFallbackRoute({
			pathname: url.pathname,
			responseStatus: effectiveStatus,
			currentLocale,
			fallback: i18n.fallback,
			fallbackType: i18n.fallbackType,
			locales: i18n.locales,
			defaultLocale: i18n.defaultLocale,
			strategy: i18n.strategy,
			base: compiled.base
		});
		switch (fallbackDecision.type) {
			case "redirect": return new Response(null, {
				status: 302,
				headers: { Location: fallbackDecision.pathname + url.search }
			});
			case "rewrite": try {
				return await state.rewrite(fallbackDecision.pathname + url.search);
			} catch {
				break;
			}
		}
	}
	return response;
}
// ../Alga Meet/node_modules/astro/dist/i18n/index.js
/**
* Given a locale (code), it returns its corresponding path
* @param locale
* @param locales
*/
function getPathByLocale(locale, locales) {
	for (const loopLocale of locales) if (typeof loopLocale === "string") {
		if (loopLocale === locale) return loopLocale;
	} else for (const code of loopLocale.codes) if (code === locale) return loopLocale.path;
	throw new AstroError(i18nNoLocaleFoundInPath);
}
/**
* Returns an array of only locales, by picking the `code`
* @param locales
*/
function getAllCodes(locales) {
	const result = [];
	for (const loopLocale of locales) if (typeof loopLocale === "string") result.push(loopLocale);
	else result.push(...loopLocale.codes);
	return result;
}
// ../Alga Meet/node_modules/astro/dist/i18n/utils.js
/**
* Parses the value of the `Accept-Language` header:
*
* More info: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept-Language
*
* Complex example: `fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5`
*
*/
function parseLocale(header) {
	if (header === "*") return [{
		locale: header,
		qualityValue: void 0
	}];
	const result = [];
	const localeValues = header.split(",").map((str) => str.trim());
	for (const localeValue of localeValues) {
		const split = localeValue.split(";").map((str) => str.trim());
		const localeName = split[0];
		const qualityValue = split[1];
		if (!split) continue;
		if (qualityValue && qualityValue.startsWith("q=")) {
			const qualityValueAsFloat = Number.parseFloat(qualityValue.slice(2));
			if (Number.isNaN(qualityValueAsFloat) || qualityValueAsFloat > 1) result.push({
				locale: localeName,
				qualityValue: void 0
			});
			else result.push({
				locale: localeName,
				qualityValue: qualityValueAsFloat
			});
		} else result.push({
			locale: localeName,
			qualityValue: void 0
		});
	}
	return result;
}
function sortAndFilterLocales(browserLocaleList, locales) {
	const normalizedLocales = getAllCodes(locales).map(normalizeTheLocale);
	return browserLocaleList.filter((browserLocale) => {
		if (browserLocale.locale !== "*") return normalizedLocales.includes(normalizeTheLocale(browserLocale.locale));
		return true;
	}).sort((a, b) => {
		const qa = a.locale === "*" ? a.qualityValue ?? 0 : a.qualityValue ?? 1;
		return (b.locale === "*" ? b.qualityValue ?? 0 : b.qualityValue ?? 1) - qa;
	});
}
/**
* Set the current locale by parsing the value passed from the `Accept-Header`.
*
* If multiple locales are present in the header, they are sorted by their quality value and the highest is selected as current locale.
*
*/
function computePreferredLocale(request, locales) {
	const acceptHeader = request.headers.get("Accept-Language");
	let result = void 0;
	if (acceptHeader) {
		const firstResult = sortAndFilterLocales(parseLocale(acceptHeader), locales).at(0);
		if (firstResult && firstResult.locale !== "*") {
			outer: for (const currentLocale of locales) if (typeof currentLocale === "string") {
				if (normalizeTheLocale(currentLocale) === normalizeTheLocale(firstResult.locale)) {
					result = currentLocale;
					break;
				}
			} else for (const currentCode of currentLocale.codes) if (normalizeTheLocale(currentCode) === normalizeTheLocale(firstResult.locale)) {
				result = currentCode;
				break outer;
			}
		}
	}
	return result;
}
function computePreferredLocaleList(request, locales) {
	const acceptHeader = request.headers.get("Accept-Language");
	let result = [];
	if (acceptHeader) {
		const browserLocaleList = sortAndFilterLocales(parseLocale(acceptHeader), locales);
		if (browserLocaleList.length === 1 && browserLocaleList.at(0).locale === "*") return getAllCodes(locales);
		else if (browserLocaleList.length > 0) {
			for (const browserLocale of browserLocaleList) for (const loopLocale of locales) if (typeof loopLocale === "string") {
				if (normalizeTheLocale(loopLocale) === normalizeTheLocale(browserLocale.locale)) result.push(loopLocale);
			} else for (const code of loopLocale.codes) if (normalizeTheLocale(code) === normalizeTheLocale(browserLocale.locale)) result.push(code);
		}
	}
	return result;
}
function computeCurrentLocale(pathname, locales, defaultLocale) {
	for (const segment of pathname.split("/").map(normalizeThePath)) for (const locale of locales) if (typeof locale === "string") {
		if (!segment.includes(locale)) continue;
		if (normalizeTheLocale(locale) === normalizeTheLocale(segment)) return locale;
	} else if (locale.path === segment) return locale.codes.at(0);
	else for (const code of locale.codes) if (normalizeTheLocale(code) === normalizeTheLocale(segment)) return code;
	for (const locale of locales) if (typeof locale === "string") {
		if (locale === defaultLocale) return locale;
	} else if (locale.path === defaultLocale) return locale.codes.at(0);
}
/**
* Check if any of the route's resolved param values match a configured locale.
* This handles dynamic routes like `[locale]` or `[...path]` where the locale
* isn't in a static segment of the route pathname.
*/
function computeCurrentLocaleFromParams(params, locales) {
	const byNormalizedCode = /* @__PURE__ */ new Map();
	const byPath = /* @__PURE__ */ new Map();
	for (const locale of locales) if (typeof locale === "string") byNormalizedCode.set(normalizeTheLocale(locale), locale);
	else {
		byPath.set(locale.path, locale.codes[0]);
		for (const code of locale.codes) byNormalizedCode.set(normalizeTheLocale(code), code);
	}
	for (const value of Object.values(params)) {
		if (!value) continue;
		const pathMatch = byPath.get(value);
		if (pathMatch) return pathMatch;
		const codeMatch = byNormalizedCode.get(normalizeTheLocale(value));
		if (codeMatch) return codeMatch;
	}
}
// ../Alga Meet/node_modules/astro/dist/core/app/prepare-response.js
/**
* Appends cookies written via `Astro.cookie.set()` to the `Set-Cookie` header
* and marks the response as sent.
*
* This is a pure function with no dependencies on the app; it is shared by
* `handleRequest` and the various error handlers.
*/
function prepareResponse(response, { addCookieHeader }) {
	if (addCookieHeader) for (const setCookieHeaderValue of getSetCookiesFromResponse(response)) response.headers.append("set-cookie", setCookieHeaderValue);
	Reflect.set(response, responseSentSymbol$1, true);
}
// ../Alga Meet/node_modules/astro/dist/core/pages/handler.js
var EMPTY_SLOTS = Object.freeze({});
/**
* Handles dispatch of a matched route (endpoint / redirect / page / fallback)
* at the bottom of the middleware chain. This is a pure dispatch layer — it
* renders whatever route the `FetchState` currently points to without any
* rewrite logic. Rewrites are handled upstream: `executeRewrite()` for
* `Astro.rewrite()` and `handleMiddleware` for `next(payload)`.
*
* `handlePages` is the `next` callback that `handleMiddleware` invokes at
* the end of the middleware chain. Error handlers and the container also
* use it directly for the same dispatch behavior.
*/
async function handlePages(state, ctx) {
	const { logger, streaming } = state;
	state.resetResponseMetadata();
	let response;
	const componentInstance = await state.loadComponentInstance();
	switch (state.routeData.type) {
		case "endpoint":
			response = await renderEndpoint(componentInstance, ctx, state.routeData.prerender, logger, state);
			break;
		case "page": {
			const props = await state.getProps();
			const actionApiContext = state.getActionAPIContext();
			const result = await state.createResult(componentInstance, actionApiContext);
			try {
				response = await renderPage(result, componentInstance?.default, props, state.slots ?? EMPTY_SLOTS, streaming, state.routeData);
			} catch (e) {
				result.cancelled = true;
				throw e;
			}
			state.responseRouteType = "page";
			if (isRoute404(state.routeData.route) || isRoute500(state.routeData.route)) state.skipErrorReroute = true;
			break;
		}
		case "redirect": return new Response(null, {
			status: 404,
			headers: { [ASTRO_ERROR_HEADER]: "true" }
		});
		case "fallback":
			state.responseRouteType = "fallback";
			return new Response(null, { status: 500 });
	}
	const responseCookies = getCookiesFromResponse(response);
	if (responseCookies) state.cookies.merge(responseCookies);
	state.response = response;
	return response;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/match.js
/** Find matching route from pathname */
function matchRoute$1(pathname, manifest) {
	if (isRoute404(pathname)) {
		const errorRoute = manifest.routes.find((route) => isRoute404(route.route));
		if (errorRoute) return errorRoute;
	}
	if (isRoute500(pathname)) {
		const errorRoute = manifest.routes.find((route) => isRoute500(route.route));
		if (errorRoute) return errorRoute;
	}
	return manifest.routes.find((route) => {
		return route.pattern.test(pathname) || route.fallbackRoutes.some((fallbackRoute) => fallbackRoute.pattern.test(pathname));
	});
}
/**
* Determines if the given route matches a 404 or 500 error page.
*
* @param {RouteData} route - The route data to check.
* @returns {boolean} `true` if the route matches a 404 or 500 error page; otherwise, `false`.
*/
function isRoute404or500(route) {
	return isRoute404(route.route) || isRoute500(route.route);
}
/**
* Determines if a given route is associated with the server island component.
*
* @param {RouteData} route - The route data object to evaluate.
* @return {boolean} Returns true if the route's component is the server island component; otherwise, false.
*/
function isRouteServerIsland(route) {
	return route.component === SERVER_ISLAND_COMPONENT;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/astro-designed-error-pages.js
function ensure404Route(manifest) {
	if (!manifest.routes.some((route) => isRoute404(route.route))) manifest.routes.push(DEFAULT_404_ROUTE);
	return manifest;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/priority.js
/**
* Comparator for sorting routes in resolution order.
*
* The routes are sorted in by the following rules in order, following the first rule that
* applies:
* - More specific routes are sorted before less specific routes. Here, "specific" means
*   the number of segments in the route, so a parent route is always sorted after its children.
*   For example, `/foo/bar` is sorted before `/foo`.
*   Index routes, originating from a file named `index.astro`, are considered to have one more
*   segment than the URL they represent.
* - Static routes are sorted before dynamic routes.
*   For example, `/foo/bar` is sorted before `/foo/[bar]`.
* - Dynamic routes with single parameters are sorted before dynamic routes with rest parameters.
*   For example, `/foo/[bar]` is sorted before `/foo/[...bar]`.
* - Prerendered routes are sorted before non-prerendered routes.
* - Endpoints are sorted before pages.
*   For example, a file `/foo.ts` is sorted before `/bar.astro`.
* - If both routes are equal regarding all previous conditions, they are sorted alphabetically.
*   For example, `/bar` is sorted before `/foo`.
*   The definition of "alphabetically" is dependent on the default locale of the running system.
*/
function routeComparator(a, b) {
	const commonLength = Math.min(a.segments.length, b.segments.length);
	for (let index = 0; index < commonLength; index++) {
		const aSegment = a.segments[index];
		const bSegment = b.segments[index];
		const aIsStatic = aSegment.every((part) => !part.dynamic && !part.spread);
		const bIsStatic = bSegment.every((part) => !part.dynamic && !part.spread);
		if (aIsStatic && bIsStatic) {
			const aContent = aSegment.map((part) => part.content).join("");
			const bContent = bSegment.map((part) => part.content).join("");
			if (aContent !== bContent) return aContent.localeCompare(bContent);
		}
		if (aIsStatic !== bIsStatic) return aIsStatic ? -1 : 1;
		const aAllDynamic = aSegment.every((part) => part.dynamic);
		if (aAllDynamic !== bSegment.every((part) => part.dynamic)) return aAllDynamic ? 1 : -1;
		const aHasSpread = aSegment.some((part) => part.spread);
		if (aHasSpread !== bSegment.some((part) => part.spread)) return aHasSpread ? 1 : -1;
	}
	const aLength = a.segments.length;
	const bLength = b.segments.length;
	if (aLength !== bLength) {
		const aEndsInRest = a.segments.at(-1)?.some((part) => part.spread);
		const bEndsInRest = b.segments.at(-1)?.some((part) => part.spread);
		if (aEndsInRest !== bEndsInRest && Math.abs(aLength - bLength) === 1) {
			if (aLength > bLength && aEndsInRest) return 1;
			if (bLength > aLength && bEndsInRest) return -1;
		}
		return aLength > bLength ? -1 : 1;
	}
	if (a.type === "endpoint" !== (b.type === "endpoint")) return a.type === "endpoint" ? -1 : 1;
	return a.route.localeCompare(b.route);
}
// ../Alga Meet/node_modules/astro/dist/core/routing/router.js
/**
* Matches request pathnames against a route list with base and trailing slash rules.
*/
var Router = class {
	#routes;
	#base;
	#baseWithoutTrailingSlash;
	#buildFormat;
	#trailingSlash;
	constructor(routes, options) {
		this.#routes = [...routes].sort(routeComparator);
		this.#base = normalizeBase(options.base);
		this.#baseWithoutTrailingSlash = removeTrailingForwardSlash(this.#base);
		this.#buildFormat = options.buildFormat;
		this.#trailingSlash = options.trailingSlash;
	}
	/**
	* Match an input pathname against the route list.
	* If allowWithoutBase is true, a non-base-prefixed path is still considered.
	*/
	match(inputPathname, { allowWithoutBase = false } = {}) {
		const normalized = getRedirectForPathname(inputPathname);
		if (normalized.redirect) return {
			type: "redirect",
			location: normalized.redirect,
			status: 301
		};
		if (this.#base !== "/") {
			const baseWithSlash = `${this.#baseWithoutTrailingSlash}/`;
			if (this.#trailingSlash === "always" && (normalized.pathname === this.#baseWithoutTrailingSlash || normalized.pathname === this.#base)) return {
				type: "redirect",
				location: baseWithSlash,
				status: 301
			};
			if (this.#trailingSlash === "never" && normalized.pathname === baseWithSlash) return {
				type: "redirect",
				location: this.#baseWithoutTrailingSlash,
				status: 301
			};
		}
		const baseResult = stripBase(normalized.pathname, this.#base, this.#baseWithoutTrailingSlash, this.#trailingSlash);
		if (!baseResult) {
			if (!allowWithoutBase) return {
				type: "none",
				reason: "outside-base"
			};
		}
		let pathname = baseResult ?? normalized.pathname;
		if (this.#buildFormat === "file") pathname = normalizeFileFormatPathname(pathname);
		const route = this.#routes.find((candidate) => {
			if (candidate.pattern.test(pathname)) return true;
			return candidate.fallbackRoutes.some((fallbackRoute) => fallbackRoute.pattern.test(pathname));
		});
		if (!route) return {
			type: "none",
			reason: "no-match"
		};
		return {
			type: "match",
			route,
			params: getParams(route, pathname),
			pathname
		};
	}
	/**
	* Returns all routes that match the given pathname, in priority order.
	* Used when the first match (e.g. a prerendered route) cannot serve
	* the request and subsequent matches need to be tried.
	*/
	matchAll(inputPathname, { allowWithoutBase = false } = {}) {
		const normalized = getRedirectForPathname(inputPathname);
		if (normalized.redirect) return [];
		const baseResult = stripBase(normalized.pathname, this.#base, this.#baseWithoutTrailingSlash, this.#trailingSlash);
		if (!baseResult && !allowWithoutBase) return [];
		let pathname = baseResult ?? normalized.pathname;
		if (this.#buildFormat === "file") pathname = normalizeFileFormatPathname(pathname);
		return this.#routes.filter((candidate) => {
			if (candidate.pattern.test(pathname)) return true;
			return candidate.fallbackRoutes.some((fallbackRoute) => fallbackRoute.pattern.test(pathname));
		});
	}
};
/**
* Normalize a base path to a leading-slash form.
*/
function normalizeBase(base) {
	if (!base) return "/";
	if (base === "/") return base;
	return prependForwardSlash(base);
}
/**
* Provide a redirect target for pathnames that need correction.
* - Ensures a leading slash.
* - Collapses multiple leading slashes into a single slash redirect.
*/
function getRedirectForPathname(pathname) {
	let value = prependForwardSlash(pathname);
	if (value.startsWith("//")) return {
		pathname: value,
		redirect: `/${value.replace(/^\/+/, "")}`
	};
	return { pathname: value };
}
/**
* Strip the configured base from the pathname and account for trailing slash policies.
* Returns null if the pathname is outside the base or should be redirected elsewhere.
*/
function stripBase(pathname, base, baseWithoutTrailingSlash, trailingSlash) {
	if (base === "/") return pathname;
	const baseWithSlash = `${baseWithoutTrailingSlash}/`;
	if (pathname === baseWithoutTrailingSlash || pathname === base) return trailingSlash === "always" ? null : "/";
	if (pathname === baseWithSlash) return trailingSlash === "never" ? null : "/";
	if (pathname.startsWith(baseWithSlash)) return pathname.slice(baseWithoutTrailingSlash.length);
	return null;
}
/**
* Normalize file-format pathnames by removing .html and /index.html suffixes.
*/
function normalizeFileFormatPathname(pathname) {
	if (pathname.endsWith("/index.html")) {
		const trimmed = pathname.slice(0, -11);
		return trimmed === "" ? "/" : trimmed;
	}
	if (pathname.endsWith(".html")) {
		const trimmed = pathname.slice(0, -5);
		return trimmed === "" ? "/" : trimmed;
	}
	return pathname;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/route-table.js
function compileRouteTable(manifest, routes) {
	const routesList = ensure404Route({ routes });
	const router = new Router(routesList.routes, {
		base: manifest.base,
		trailingSlash: manifest.trailingSlash,
		buildFormat: manifest.buildFormat
	});
	return {
		routes: routesList.routes,
		router
	};
}
var routeTables = createManifestMemo((manifest) => compileRouteTable(manifest, (manifest.routes ?? []).map((route) => route.routeData)));
/**
* The route table for a manifest: the derived route list (with the default
* 404 ensured) and the compiled router. All route reads — matching, rewrites,
* custom-404 fallbacks, `manifestData` accessors — go through this single
* entry so dev HMR updates are visible to every consumer at once.
*/
function getRouteTable(manifest) {
	return routeTables.get(manifest);
}
/**
* Atomically replaces the route table for a manifest (dev `astro:routes-updated`).
* Runs `ensure404Route` on the new list, compiles a fresh `Router`, and swaps
* the memo entry in one step, so no consumer can observe a half-updated table.
*/
function updateRouteTable(manifest, routes) {
	routeTables.set(manifest, compileRouteTable(manifest, [...routes]));
}
/**
* Low-level route matching against the manifest routes. Returns the matched
* `RouteData` or `undefined`. Does not filter prerendered routes or check
* public assets — use the app-level match for that.
*/
function matchRoute(manifest, pathname) {
	const match = getRouteTable(manifest).router.match(pathname, { allowWithoutBase: true });
	if (match.type !== "match") return void 0;
	return match.route;
}
/**
* Returns all routes matching the given pathname, in priority order. Used when
* the first match cannot serve the request (e.g. a prerendered dynamic route
* that doesn't cover this specific path) and the caller needs to try
* subsequent matches.
*/
function matchAllRoutes(manifest, pathname) {
	return getRouteTable(manifest).router.matchAll(pathname, { allowWithoutBase: true });
}
// ../Alga Meet/node_modules/astro/dist/core/cache/provider.js
var cacheProviderMemo = createAsyncManifestMemo(async (manifest) => {
	if (manifest.cacheProvider) {
		const factory = (await manifest.cacheProvider())?.default || null;
		return factory ? factory(manifest.cacheConfig?.options) : null;
	}
	return null;
});
/** Resolves the cache provider from the manifest, `null` when none. */
function getCacheProvider(manifest) {
	return cacheProviderMemo.get(manifest);
}
// ../Alga Meet/node_modules/astro/dist/core/cache/runtime/utils.js
/**
* Generate default cache response headers from CacheOptions.
* Used when the provider doesn't supply its own `setHeaders()`.
*/
function defaultSetHeaders(options) {
	const headers = new Headers();
	const directives = [];
	if (options.maxAge !== void 0) directives.push(`max-age=${options.maxAge}`);
	if (options.swr !== void 0) directives.push(`stale-while-revalidate=${options.swr}`);
	if (directives.length > 0) headers.set("CDN-Cache-Control", directives.join(", "));
	if (options.tags && options.tags.length > 0) headers.set("Cache-Tag", options.tags.join(", "));
	if (options.lastModified) headers.set("Last-Modified", options.lastModified.toUTCString());
	if (options.etag) headers.set("ETag", options.etag);
	return headers;
}
function isLiveDataEntry(value) {
	return value != null && typeof value === "object" && "id" in value && "data" in value && "cacheHint" in value;
}
// ../Alga Meet/node_modules/astro/dist/core/cache/runtime/cache.js
var APPLY_HEADERS = Symbol.for("astro:cache:apply");
var IS_ACTIVE = Symbol.for("astro:cache:active");
var AstroCache = class {
	#options = {};
	#tags = /* @__PURE__ */ new Set();
	#disabled = false;
	#provider;
	enabled = true;
	constructor(provider) {
		this.#provider = provider;
	}
	set(input) {
		if (input === false) {
			this.#disabled = true;
			this.#tags.clear();
			this.#options = {};
			return;
		}
		this.#disabled = false;
		let options;
		if (isLiveDataEntry(input)) {
			if (!input.cacheHint) return;
			options = input.cacheHint;
		} else options = input;
		if ("maxAge" in options && options.maxAge !== void 0) this.#options.maxAge = options.maxAge;
		if ("swr" in options && options.swr !== void 0) this.#options.swr = options.swr;
		if ("etag" in options && options.etag !== void 0) this.#options.etag = options.etag;
		if (options.lastModified !== void 0) {
			if (!this.#options.lastModified || options.lastModified > this.#options.lastModified) this.#options.lastModified = options.lastModified;
		}
		if (options.tags) for (const tag of options.tags) this.#tags.add(tag);
	}
	get tags() {
		return [...this.#tags];
	}
	/**
	* Get the current cache options (read-only snapshot).
	* Includes all accumulated options: maxAge, swr, tags, etag, lastModified.
	*/
	get options() {
		return {
			...this.#options,
			tags: this.tags
		};
	}
	async invalidate(input) {
		if (!this.#provider) throw new AstroError(CacheNotEnabled);
		let options;
		if (isLiveDataEntry(input)) options = { tags: input.cacheHint?.tags ?? [] };
		else options = input;
		return this.#provider.invalidate(options);
	}
	/** @internal */
	[APPLY_HEADERS](response, request) {
		if (this.#disabled) return;
		const finalOptions = {
			...this.#options,
			tags: this.tags
		};
		if (finalOptions.maxAge === void 0 && !finalOptions.tags?.length) return;
		const headers = this.#provider?.setHeaders?.(finalOptions, request) ?? defaultSetHeaders(finalOptions);
		for (const [key, value] of headers) response.headers.set(key, value);
		if (!response.headers.has("Cache-Control") && !response.headers.has("Expires") && (response.headers.has("Last-Modified") || response.headers.has("ETag"))) response.headers.set("Cache-Control", "no-cache");
	}
	/** @internal */
	get [IS_ACTIVE]() {
		return !this.#disabled && (this.#options.maxAge !== void 0 || this.#tags.size > 0);
	}
};
/**
* Apply cache headers to a response.
*/
function applyCacheHeaders(cache, response, request) {
	if (APPLY_HEADERS in cache) cache[APPLY_HEADERS](response, request);
}
// ../Alga Meet/node_modules/astro/dist/core/cache/runtime/noop.js
/**
* A no-op cache implementation used in dev mode when cache is configured.
* The API is available so user code doesn't need conditional checks,
* but nothing is actually cached.
*/
var EMPTY_OPTIONS = Object.freeze({ tags: [] });
var NoopAstroCache = class {
	enabled = false;
	set() {}
	get tags() {
		return [];
	}
	get options() {
		return EMPTY_OPTIONS;
	}
	async invalidate() {}
};
var hasWarned = false;
/**
* A no-op cache used when cache is not configured.
* Logs a warning on first use instead of throwing, so libraries
* can call cache methods without needing try/catch.
* `invalidate()` still throws since it implies the caller
* expects purging to actually work.
*/
var DisabledAstroCache = class {
	enabled = false;
	#logger;
	constructor(logger) {
		this.#logger = logger;
	}
	#warn() {
		if (!hasWarned) {
			hasWarned = true;
			this.#logger?.warn("cache", "`cache.set()` was called but caching is not enabled. Configure a cache provider in your Astro config under `cache` to enable caching.");
		}
	}
	set() {
		this.#warn();
	}
	get tags() {
		return [];
	}
	get options() {
		return EMPTY_OPTIONS;
	}
	async invalidate() {
		throw new AstroError(CacheNotEnabled);
	}
};
// ../Alga Meet/node_modules/astro/dist/core/routing/parts.js
var ROUTE_DYNAMIC_SPLIT = /\[(.+?\(.+?\)|.+?)\]/;
var ROUTE_SPREAD = /^\.{3}.+$/;
function getParts(part, file) {
	const result = [];
	part.split(ROUTE_DYNAMIC_SPLIT).map((str, i) => {
		if (!str) return;
		const dynamic = i % 2 === 1;
		const [, content] = dynamic ? /([^(]+)$/.exec(str) || [null, null] : [null, str];
		if (!content || dynamic && !/^(?:\.\.\.)?[\w$]+$/.test(content)) throw new Error(`Invalid route ${file} — parameter name must match /^[a-zA-Z0-9_$]+$/`);
		result.push({
			content,
			dynamic,
			spread: dynamic && ROUTE_SPREAD.test(content)
		});
	});
	return result;
}
// ../Alga Meet/node_modules/astro/dist/core/cache/runtime/route-matching.js
/**
* Compile config-level cache route patterns into RegExps.
* The result is memoized on the pipeline — this function is only called once,
* on the first request that needs route matching.
* Returns compiled patterns sorted by Astro's standard route priority (most specific first).
*/
function compileCacheRoutes(routes, base, trailingSlash) {
	const compiled = Object.entries(routes).map(([path, options]) => {
		const segments = removeLeadingForwardSlash(path).split("/").filter(Boolean).map((s) => getParts(s, path));
		return {
			pattern: getPattern(segments, base, trailingSlash),
			options,
			segments,
			route: path
		};
	});
	compiled.sort((a, b) => routeComparator({
		segments: a.segments,
		route: a.route,
		type: "page"
	}, {
		segments: b.segments,
		route: b.route,
		type: "page"
	}));
	return compiled;
}
/**
* Called per-request to find the first matching cache rule for a given pathname.
*/
function matchCacheRoute(pathname, compiledRoutes) {
	for (const route of compiledRoutes) if (route.pattern.test(pathname)) return route.options;
	return null;
}
// ../Alga Meet/node_modules/astro/dist/core/cache/handler.js
var CACHE_KEY = "cache";
/**
* Registers a cache provider on the given `FetchState`. When
* `state.resolve('cache')` is first called, the appropriate cache
* implementation is created (disabled, noop for dev, or real).
*
* Returns synchronously when cache is not configured or in dev mode.
*/
function provideCache(state) {
	const manifest = state.manifest;
	if (!manifest.cacheConfig) {
		state.provide(CACHE_KEY, { create: () => new DisabledAstroCache(state.logger) });
		return;
	}
	if (getEnvironment(manifest).runtimeMode === "development") {
		state.provide(CACHE_KEY, { create: () => new NoopAstroCache() });
		return;
	}
	return provideCacheAsync(state, manifest);
}
async function provideCacheAsync(state, manifest) {
	const cacheProvider = await getCacheProvider(manifest);
	state.provide(CACHE_KEY, { create() {
		const cache = new AstroCache(cacheProvider);
		if (manifest.cacheConfig?.routes) {
			const matched = matchCacheRoute(state.pathname, getCompiledCacheRoutes(manifest));
			if (matched) cache.set(matched);
		}
		return cache;
	} });
}
/**
* Wraps a render callback with cache provider logic. Handles both
* runtime caching (onRequest) and CDN-based providers (headers only).
*
* - When a cache provider with `onRequest` is configured, the callback
*   is wrapped so the provider can serve from cache or fall through.
* - When only CDN headers are needed, the callback runs directly and
*   cache headers are applied to the response.
* - When no cache provider is configured, the callback runs as-is.
*
* Cache headers (`CDN-Cache-Control`, `Cache-Tag`) are stripped from
* the final response after the runtime provider has read them.
*/
async function handleCache(state, next) {
	markFeatureUsed(state.manifest, FetchFeatures.cache);
	if (!state.manifest.cacheProvider) return next();
	const cache = state.resolve(CACHE_KEY);
	const cacheProvider = await getCacheProvider(state.manifest);
	if (cacheProvider?.onRequest) {
		const response = await cacheProvider.onRequest({
			request: state.request,
			url: new URL(state.request.url),
			waitUntil: state.renderOptions.waitUntil,
			logger: {
				info(msg) {
					state.logger.info("cache", msg);
				},
				warn(msg) {
					state.logger.warn("cache", msg);
				},
				error(msg) {
					state.logger.error("cache", msg);
				}
			}
		}, async () => {
			const res = await next();
			applyCacheHeaders(cache, res, state.request);
			return res;
		});
		response.headers.delete("CDN-Cache-Control");
		response.headers.delete("Cache-Tag");
		return response;
	}
	const response = await next();
	applyCacheHeaders(cache, response, state.request);
	return response;
}
var compiledCacheRoutesMemo = createManifestMemo((manifest) => manifest.cacheConfig?.routes ? compileCacheRoutes(manifest.cacheConfig.routes, manifest.base, manifest.trailingSlash) : []);
/**
* Config-level cache routes compiled from `manifest.cacheConfig`, derived
* lazily on the first cache-seeded request.
*/
function getCompiledCacheRoutes(manifest) {
	return compiledCacheRoutesMemo.get(manifest);
}
// ../Alga Meet/node_modules/astro/dist/core/session/provider-disabled.js
function provideSession(state) {
	markFeatureUsed(state.manifest, FetchFeatures.sessions);
}
// ../Alga Meet/node_modules/astro/dist/core/output-filename.js
function getOutputFilename(buildFormat, name, routeData) {
	if (routeData.type === "endpoint") return name;
	if (name === "/" || name === "") return name === "" ? "index.html" : "/index.html";
	if (buildFormat === "file" || STATUS_CODE_PAGES.has(name)) return `${removeTrailingForwardSlash(name || "index")}.html`;
	if (buildFormat === "preserve" && !routeData.isIndex) return `${removeTrailingForwardSlash(name || "index")}.html`;
	return `${removeTrailingForwardSlash(name)}/index.html`;
}
// ../Alga Meet/node_modules/astro/dist/core/errors/default-handler.js
/**
* The default error strategy used in production SSR. Attempts to render the
* matching error route (404.astro / 500.astro), falling back to a plain
* response with the given status. Handles prerendered error pages via
* `prerenderedErrorPageFetch`.
*/
async function renderDefaultError(manifest, request, { status, response: originalResponse, skipMiddleware = false, error, pathname, ...resolvedRenderOptions }) {
	const resolvedPathname = pathname ?? new FetchState(manifest, request).pathname;
	const routeTable = getRouteTable(manifest);
	const errorRouteData = matchRoute$1(getErrorRoutePath(resolvedPathname, status, routeTable.routes, manifest.i18n?.locales, manifest.trailingSlash === "always"), routeTable);
	const url = new URL(request.url);
	if (errorRouteData) {
		if (errorRouteData.prerender) {
			const allowedDomains = manifest.allowedDomains;
			const safeOrigin = validateHost(url.host, url.protocol.replace(":", ""), allowedDomains) ? url.origin : `${url.protocol}//localhost`;
			const statusURL = new URL(`${removeTrailingForwardSlash(manifest.base)}${getOutputFilename(manifest.buildFormat, errorRouteData.route, errorRouteData)}`, safeOrigin);
			if (statusURL.toString() !== request.url && resolvedRenderOptions.prerenderedErrorPageFetch) try {
				const newResponse = mergeResponses(await resolvedRenderOptions.prerenderedErrorPageFetch(statusURL.toString()), originalResponse, {
					status,
					removeContentEncodingHeaders: true
				});
				prepareResponse(newResponse, resolvedRenderOptions);
				return newResponse;
			} catch {
				const response = mergeResponses(new Response(null, { status }), originalResponse);
				prepareResponse(response, resolvedRenderOptions);
				return response;
			}
		}
		const mod = await getEnvironment(manifest).getComponentByRoute(manifest, errorRouteData);
		const errorState = new FetchState(manifest, request);
		errorState.skipMiddleware = skipMiddleware;
		errorState.clientAddress = resolvedRenderOptions.clientAddress;
		errorState.routeData = errorRouteData;
		errorState.pathname = resolvedPathname;
		errorState.status = status;
		errorState.componentInstance = mod;
		errorState.locals = resolvedRenderOptions.locals ?? {};
		errorState.initialProps = { error };
		try {
			await provideSession(errorState);
			await provideCache(errorState);
			const response = await handleMiddleware(errorState, handlePages);
			if (rewroteToEmptyErrorResponse(skipMiddleware, errorRouteData, errorState.routeData, response)) return renderDefaultError(manifest, request, {
				...resolvedRenderOptions,
				status,
				error,
				response: originalResponse,
				skipMiddleware: true,
				pathname: resolvedPathname
			});
			const newResponse = mergeResponses(response, originalResponse);
			prepareResponse(newResponse, resolvedRenderOptions);
			return newResponse;
		} catch {
			if (skipMiddleware === false) return renderDefaultError(manifest, request, {
				...resolvedRenderOptions,
				status,
				error,
				response: originalResponse,
				skipMiddleware: true,
				pathname: resolvedPathname
			});
		} finally {
			await errorState.finalizeAll();
		}
	}
	const response = mergeResponses(new Response(null, { status }), originalResponse);
	prepareResponse(response, resolvedRenderOptions);
	return response;
}
function mergeResponses(newResponse, originalResponse, override) {
	let newResponseHeaders = newResponse.headers;
	if (override?.removeContentEncodingHeaders) {
		newResponseHeaders = new Headers(newResponseHeaders);
		newResponseHeaders.delete("Content-Encoding");
		newResponseHeaders.delete("Content-Length");
	}
	if (!originalResponse) {
		if (override !== void 0) return new Response(newResponse.body, {
			status: override.status,
			statusText: newResponse.statusText,
			headers: newResponseHeaders
		});
		return newResponse;
	}
	const status = override?.status ? override.status : originalResponse.status === 200 ? newResponse.status : originalResponse.status;
	try {
		originalResponse.headers.delete("Content-type");
		originalResponse.headers.delete("Content-Length");
		originalResponse.headers.delete("Transfer-Encoding");
	} catch {}
	const newHeaders = new Headers();
	const seen = /* @__PURE__ */ new Set();
	for (const [name, value] of originalResponse.headers) {
		newHeaders.append(name, value);
		seen.add(name.toLowerCase());
	}
	for (const [name, value] of newResponseHeaders) {
		const lower = name.toLowerCase();
		if (!seen.has(lower) || lower === "set-cookie") newHeaders.append(name, value);
	}
	const mergedResponse = new Response(newResponse.body, {
		status,
		statusText: status === 200 ? newResponse.statusText : originalResponse.statusText,
		headers: newHeaders
	});
	const originalCookies = getCookiesFromResponse(originalResponse);
	const newCookies = getCookiesFromResponse(newResponse);
	if (originalCookies) {
		if (newCookies) originalCookies.merge(newCookies);
		attachCookiesToResponse(mergedResponse, originalCookies);
	} else if (newCookies) attachCookiesToResponse(mergedResponse, newCookies);
	return mergedResponse;
}
// ../Alga Meet/node_modules/astro/dist/core/errors/build-handler.js
/**
* The error strategy used during static build / prerendering.
*
* - For 500 errors, returns the original response if present, otherwise
*   throws so the build surfaces the underlying error to the developer.
* - For other errors (e.g. 404), delegates to `renderDefaultError` with
*   `prerenderedErrorPageFetch` cleared (the build pipeline can't fetch
*   prerendered pages the way production SSR can).
*/
async function renderBuildError(manifest, request, options) {
	if (options.status === 500) {
		if (options.response) return options.response;
		throw options.error;
	}
	return renderDefaultError(manifest, request, {
		...options,
		prerenderedErrorPageFetch: void 0
	});
}
// ../Alga Meet/node_modules/astro/dist/core/errors/dev-handler.js
/**
* The dev-server error strategy. Renders custom 404/500 routes if the user
* has them, otherwise throws so Vite's dev overlay is shown. Shared between
* the Vite dev server and the non-runnable dev pipeline; only
* `shouldInjectCspMetaTags` differs between them (carried by the
* environment record's `injectCspMetaTagsOnErrorPages` static).
*/
async function renderDevError(manifest, request, { skipMiddleware = false, error, status, response: _response, pathname, ...resolvedRenderOptions }, { shouldInjectCspMetaTags }) {
	if (isAstroError(error) && [MiddlewareNoDataOrNextCalled.name, MiddlewareNotAResponse.name].includes(error.name)) throw error;
	const resolvedPathname = pathname ?? new FetchState(manifest, request).pathname;
	const renderRoute = async (routeData) => {
		try {
			const preloadedComponent = await getEnvironment(manifest).getComponentByRoute(manifest, routeData);
			const errorState = new FetchState(manifest, request);
			errorState.skipMiddleware = skipMiddleware;
			errorState.clientAddress = resolvedRenderOptions.clientAddress;
			errorState.shouldInjectCspMetaTags = shouldInjectCspMetaTags ? !!manifest.csp : false;
			errorState.routeData = routeData;
			errorState.pathname = resolvedPathname;
			errorState.status = status;
			errorState.componentInstance = preloadedComponent;
			errorState.locals = resolvedRenderOptions.locals ?? {};
			errorState.initialProps = { error };
			await provideCache(errorState);
			const response = await handleMiddleware(errorState, handlePages);
			if (rewroteToEmptyErrorResponse(skipMiddleware, routeData, errorState.routeData, response)) return renderDevError(manifest, request, {
				...resolvedRenderOptions,
				status,
				error,
				skipMiddleware: true,
				pathname: resolvedPathname
			}, { shouldInjectCspMetaTags });
			if (error) getLogger(manifest).error("router", error.stack || error.message);
			return response;
		} catch (_err) {
			if (skipMiddleware === false) return renderDevError(manifest, request, {
				...resolvedRenderOptions,
				status: 500,
				skipMiddleware: true,
				error: _err,
				pathname: resolvedPathname
			}, { shouldInjectCspMetaTags });
			throw _err;
		}
	};
	if (status === 404) {
		const custom404 = getCustom404Route(getRouteTable(manifest));
		if (custom404) return renderRoute(custom404);
	}
	const custom500 = getCustom500Route(getRouteTable(manifest));
	if (!custom500) throw error;
	else return renderRoute(custom500);
}
// ../Alga Meet/node_modules/astro/dist/core/errors/handler.js
/**
* Renders the error page (404.astro / 500.astro or a plain response) for a
* request, dispatching to the strategy the manifest's environment selects:
* production/container default, dev (overlay + custom error routes, with or
* without CSP meta-tag injection), or build (500s throw so the build fails).
*/
function renderErrorPage(manifest, request, options) {
	const env = getEnvironment(manifest);
	switch (env.errorStrategy) {
		case "dev": return renderDevError(manifest, request, options, { shouldInjectCspMetaTags: env.injectCspMetaTagsOnErrorPages });
		case "build": return renderBuildError(manifest, request, options);
		case "default": return renderDefaultError(manifest, request, options);
	}
}
/**
* Dispatches an internal error render for a request flowing through the
* handler chain: through the facade's late-bound `renderError` hook when the
* state was built by `BaseApp.render`'s fast path (preserving instance
* overrides/reassignments, e.g. cloudflare's prerender-error propagation),
* else through the environment's strategy via {@link renderErrorPage}.
*/
function renderErrorFromState(state, request, options) {
	if (state.renderError) return state.renderError(request, options);
	return renderErrorPage(state.manifest, request, options);
}
/**
* Whether a middleware rewrite (`ctx.rewrite()` / `next(payload)`) issued while
* rendering the error page dead-ended in another empty reroutable (404/500)
* response. The rewrite swaps the state's routeData away from the error route,
* so returning that render as-is would produce a blank page; the error handler
* should instead retry rendering the error page without middleware.
*
* @param skipMiddleware Whether middleware was already skipped for this render.
* @param errorRouteData The error route matched before middleware ran.
* @param renderedRouteData The route data on the state after middleware ran.
* @param response The response produced by the middleware-driven render.
*/
function rewroteToEmptyErrorResponse(skipMiddleware, errorRouteData, renderedRouteData, response) {
	return skipMiddleware === false && renderedRouteData !== errorRouteData && response.body === null && REROUTABLE_STATUS_CODES.includes(response.status);
}
// ../Alga Meet/node_modules/astro/dist/core/middleware/callMiddleware.js
/**
* Utility function that is in charge of calling the middleware.
*
* It accepts a `R` generic, which usually is the `Response` returned.
* It is a generic because endpoints can return a different payload.
*
* When calling a middleware, we provide a `next` function, this function might or
* might not be called.
*
* A middleware, to behave correctly, can:
* - return a `Response`;
* - call `next`;
*
* Failing doing so will result an error. A middleware can call `next` and do not return a
* response. A middleware cannot call `next` and return a new `Response` from scratch (maybe with a redirect).
*
* ```js
* const onRequest = async (context, next) => {
*   const response = await next(context);
*   return response;
* }
* ```
*
* ```js
* const onRequest = async (context, next) => {
*   context.locals = "foo";
*   next();
* }
* ```
*
* @param onRequest The function called which accepts a `context` and a `resolve` function
* @param apiContext The API context
* @param responseFunction A callback function that should return a promise with the response
*/
async function callMiddleware(onRequest, apiContext, responseFunction) {
	let nextCalled = false;
	let responseFunctionPromise = void 0;
	const next = async (payload) => {
		nextCalled = true;
		responseFunctionPromise = responseFunction(apiContext, payload);
		return responseFunctionPromise;
	};
	const middlewarePromise = onRequest(apiContext, next);
	return await Promise.resolve(middlewarePromise).then(async (value) => {
		if (nextCalled) {
			/**
			* Then we check if a value is returned. If so, we need to return the value returned by the
			* middleware.
			* e.g.
			* ```js
			* 	const response = await next();
			* 	const new Response(null, { status: 500, headers: response.headers });
			* ```
			*/
			if (typeof value !== "undefined") {
				if (value instanceof Response === false) throw new AstroError(MiddlewareNotAResponse);
				return value;
			} else if (responseFunctionPromise) return responseFunctionPromise;
			else throw new AstroError(MiddlewareNotAResponse);
		} else if (typeof value === "undefined")
 /**
		* There might be cases where `next` isn't called and the middleware **must** return
		* something.
		*
		* If not thing is returned, then we raise an Astro error.
		*/
		throw new AstroError(MiddlewareNoDataOrNextCalled);
		else if (value instanceof Response === false) throw new AstroError(MiddlewareNotAResponse);
		else return value;
	});
}
// ../Alga Meet/node_modules/astro/dist/core/middleware/sequence.js
/**
*
* It accepts one or more middleware handlers and makes sure that they are run in sequence.
*/
function sequence(...handlers) {
	const filtered = handlers.filter((h) => !!h);
	const length = filtered.length;
	if (!length) return defineMiddleware((_context, next) => {
		return next();
	});
	return defineMiddleware((context, next) => {
		/**
		* This variable is used to carry the rerouting payload across middleware functions.
		*/
		let carriedPayload = void 0;
		return applyHandle(0, context);
		function applyHandle(i, handleContext) {
			const handle = filtered[i];
			return handle(handleContext, async (payload) => {
				if (i < length - 1) {
					if (payload) {
						const oldPathname = handleContext.url.pathname;
						const state = Reflect.get(handleContext, fetchStateSymbol);
						if (!state) throw new Error("FetchState not found on APIContext. `next(payload)` rewrites require a context created through Astro's request pipeline.");
						const manifest = state.manifest;
						const { routeData, pathname } = await getEnvironment(manifest).tryRewrite(manifest, payload, handleContext.request);
						let newRequest;
						if (payload instanceof Request) newRequest = payload;
						else {
							const request = handleContext.request.method === "GET" || handleContext.request.method === "HEAD" ? handleContext.request : handleContext.request.clone();
							newRequest = copyRequest(payload instanceof URL ? payload : new URL(payload, handleContext.url.origin), request, false, state.logger, routeData.route);
						}
						if (manifest.serverLike === true && handleContext.isPrerendered === false && routeData.prerender === true) throw new AstroError({
							...ForbiddenRewrite,
							message: ForbiddenRewrite.message(handleContext.url.pathname, pathname, routeData.component),
							hint: ForbiddenRewrite.hint(routeData.component)
						});
						carriedPayload = payload;
						handleContext.request = newRequest;
						handleContext.url = new URL(newRequest.url);
						handleContext.params = getParams(routeData, pathname);
						handleContext.routePattern = routeData.route;
						setOriginPathname(handleContext.request, oldPathname, manifest.trailingSlash, manifest.buildFormat);
					}
					return applyHandle(i + 1, handleContext);
				} else return next(payload ?? carriedPayload);
			});
		}
	});
}
// ../Alga Meet/node_modules/astro/dist/core/middleware/load.js
var resolvedMiddleware = /* @__PURE__ */ new WeakMap();
var middlewareMemo = createAsyncManifestMemo(async (manifest) => {
	let handler;
	if (manifest.middleware) {
		const internalMiddlewares = [(await manifest.middleware()).onRequest ?? NOOP_MIDDLEWARE_FN];
		if (manifest.checkOrigin) internalMiddlewares.unshift(createOriginCheckMiddleware());
		handler = sequence(...internalMiddlewares);
	} else handler = NOOP_MIDDLEWARE_FN;
	resolvedMiddleware.set(manifest, handler);
	return handler;
});
/**
* Resolves the middleware from the manifest and returns the `onRequest`
* function (prefixed with the origin-check middleware when configured). If
* `onRequest` isn't there, it returns a no-op function.
*/
function getMiddleware(manifest) {
	return middlewareMemo.get(manifest);
}
// ../Alga Meet/node_modules/astro/dist/core/middleware/astro-middleware.js
/**
* Runs Astro's middleware chain (origin check + user `onRequest`) for a
* single render, reading the composed middleware from the manifest and
* per-request data (componentInstance, slots, props, API contexts) off the
* supplied `FetchState`. The actual route dispatch (endpoint / redirect /
* page / fallback) is supplied by the caller as `renderRouteCallback` —
* typically `handlePages`.
*/
async function handleMiddleware(state, renderRouteCallback) {
	markFeatureUsed(state.manifest, FetchFeatures.middleware);
	await state.getProps();
	const apiContext = state.getAPIContext();
	state.counter++;
	if (state.counter === 4) return new Response("Loop Detected", {
		status: 508,
		statusText: "Astro detected a loop where you tried to call the rewriting logic more than four times."
	});
	const next = async (ctx, payload) => {
		if (payload) {
			state.logger.debug("router", "Called rewriting to:", payload);
			applyRewriteToState(state, payload, await getEnvironment(state.manifest).tryRewrite(state.manifest, payload, state.request));
		}
		return renderRouteCallback(state, ctx);
	};
	let response;
	if (state.skipMiddleware) response = await next(apiContext);
	else response = await callMiddleware(sequence(await getMiddleware(state.manifest)), apiContext, next);
	attachCookiesToResponse(response, state.cookies);
	state.response = response;
	return response;
}
// ../Alga Meet/node_modules/astro/dist/core/util/normalized-url.js
/**
* Creates a normalized URL from a request URL string.
* Decodes and validates the pathname, collapses duplicate slashes.
*/
function createNormalizedUrl(requestUrl) {
	return normalizeUrl(new URL(requestUrl));
}
/**
* Assigns `url.pathname` only when the value differs.
* The setter re-parses the whole URL, so a no-op write is still expensive.
*/
function setPathname(url, pathname) {
	if (url.pathname !== pathname) url.pathname = pathname;
}
/**
* Normalizes an already-parsed URL in place: decodes and validates the
* pathname, collapses duplicate slashes. Returns the same URL object.
*
* Collapse runs after the decode is written back: the pathname setter
* rewrites `\` to `/`, so a decoded backslash only becomes `//` once assigned.
*/
function normalizeUrl(url) {
	try {
		setPathname(url, validateAndDecodePathname(url.pathname));
	} catch {
		try {
			setPathname(url, decodeURI(url.pathname));
		} catch {}
	}
	setPathname(url, collapseDuplicateSlashes(url.pathname));
	return url;
}
// ../Alga Meet/node_modules/astro/dist/core/rewrites/handler.js
/**
* Validates and applies a rewrite target to the given `FetchState`.
*
* - Validates that SSR→prerender rewrites are not attempted (except
*   for i18n fallback routes).
* - Mutates `state` to reflect the new route: request, URL, cookies,
*   params, pathname, component instance, etc.
* - Invalidates cached API contexts so they're re-derived from the
*   new route.
*
* Called by both `executeRewrite()` (user-triggered `Astro.rewrite`)
* and `handleMiddleware` (middleware `next(payload)`).
*/
function applyRewriteToState(state, payload, { routeData, componentInstance, newUrl, pathname }, { mergeCookies = false } = {}) {
	const oldPathname = state.pathname;
	const isI18nFallback = routeData.fallbackRoutes && routeData.fallbackRoutes.length > 0;
	if (state.manifest.serverLike && !state.routeData.prerender && routeData.prerender && !isI18nFallback) throw new AstroError({
		...ForbiddenRewrite,
		message: ForbiddenRewrite.message(state.pathname, pathname, routeData.component),
		hint: ForbiddenRewrite.hint(routeData.component)
	});
	state.routeData = routeData;
	state.componentInstance = componentInstance;
	if (payload instanceof Request) state.request = payload;
	else state.request = copyRequest(newUrl, state.request, routeData.prerender, state.logger, state.routeData.route);
	state.url = createNormalizedUrl(state.request.url);
	if (mergeCookies) {
		const newCookies = new AstroCookies(state.request, state.logger);
		if (state.cookies) newCookies.merge(state.cookies);
		state.cookies = newCookies;
	}
	state.params = getParams(routeData, pathname);
	state.pathname = pathname;
	state.isRewriting = true;
	state.status = 200;
	setOriginPathname(state.request, oldPathname, state.manifest.trailingSlash, state.manifest.buildFormat);
	state.invalidateContexts();
}
/**
* Executes a user-triggered rewrite (`Astro.rewrite(...)` /
* `ctx.rewrite(...)`) against a `FetchState`. Resolves the rewrite
* target via the environment's `tryRewrite`, validates it, mutates the
* `FetchState` to reflect the new route, and re-runs the middleware
* and page dispatch to produce the new response.
*/
async function executeRewrite(state, payload) {
	state.logger.debug("router", "Calling rewrite: ", payload);
	applyRewriteToState(state, payload, await getEnvironment(state.manifest).tryRewrite(state.manifest, payload, state.request), { mergeCookies: true });
	return handleMiddleware(state, handlePages);
}
// ../Alga Meet/node_modules/astro/dist/core/manifest/derived.js
var sites = createManifestMemo((manifest) => manifest.site ? new URL(manifest.site) : void 0);
/** The manifest's `site` as a `URL` (used for `Astro.site`). */
function getSite(manifest) {
	return sites.get(manifest);
}
// ../Alga Meet/node_modules/astro/dist/core/server-islands/mappings.js
/**
* The server-island mappings for a manifest. Deliberately NOT memoized: the
* manifest thunk is a module import, which is cheap.
*/
async function getServerIslands(manifest) {
	if (manifest.serverIslandMappings) return manifest.serverIslandMappings();
	return {
		serverIslandMap: /* @__PURE__ */ new Map(),
		serverIslandNameMap: /* @__PURE__ */ new Map()
	};
}
// ../Alga Meet/node_modules/astro/dist/core/fetch/fetch-state.js
var slotValuesSymbol = Symbol("astro.slotValues");
/**
* Retrieves the `FetchState` stashed on an `APIContext` by
* `FetchState.getAPIContext()`. Throws if not found — this indicates
* the context was not created through Astro's request pipeline.
*/
function getFetchStateFromAPIContext(context) {
	const state = context[fetchStateSymbol];
	if (!state) throw new Error("FetchState not found on APIContext. This is an internal error — the context was not created through Astro's request pipeline.");
	return state;
}
/**
* External `<link href>` / `<script src>` entries are stored with empty
* `children`. Hashing that empty string puts the SHA of `''` in CSP and
* disables `'unsafe-inline'` for that directive.
*/
function isInlineCspHeadContent(element) {
	if (!element.children) return false;
	const props = element.props ?? {};
	return props.href == null && props.src == null;
}
/**
* Holds per-request state as it flows through the handler pipeline.
*
* **This class is user-facing** via `astro/fetch` and `astro/hono`.
* The {@link AstroFetchState} interface defines the stable public
* surface. Members not on that interface are internal and
* may change without notice.
*
* Performance note: fields on this class are plain properties — ES
* private fields (`#foo`) have a non-zero per-access cost in V8
* which is measurable on the hot render path, so `#` is used only
* for rarely-accessed memoized caches and Maps.
*/
var FetchState = class {
	/** The manifest — the single ambient source of static, build-time data. */
	manifest;
	/** The manifest's identity-stable logger, captured once at construction. */
	logger;
	/**
	* Whether page renders stream. From the facade hooks on the fast path,
	* else the environment's default.
	*/
	streaming;
	/**
	* Internal facade hook: late-bound `app.renderError` dispatch. Undefined on
	* bare and custom-handler paths — those fall through to the environment's
	* error strategy (`renderErrorPage`).
	*/
	renderError;
	/**
	* Internal facade hook: late-bound `app.logThisRequest` dispatch. Undefined
	* on bare and custom-handler paths — those fall through to the
	* environment's `logRequest` behavior.
	*/
	logRequest;
	/**
	* The request to render. Mutated during rewrites so subsequent renders
	* see the rewritten URL.
	*/
	request;
	routeData;
	/**
	* The pathname to use for routing and rendering. Starts out as the raw,
	* base-stripped, decoded pathname from the request. May be further
	* normalized by `handleRequest` after routeData is known (in dev, when
	* the matched route has no `.html` extension, `.html` / `/index.html`
	* suffixes are stripped).
	*/
	pathname;
	/** Resolved render options (addCookieHeader, clientAddress, locals, etc.). */
	renderOptions;
	/** When the request started, used to log duration. */
	timeStart;
	/**
	* The route's loaded component module. Set before middleware runs; may
	* be swapped during in-flight rewrites from inside the middleware chain.
	*/
	componentInstance;
	/**
	* Slot overrides supplied by the container API. `undefined` for HTTP
	* requests — `PagesHandler` coalesces to `{}` on read so we don't
	* allocate an empty object per request.
	*/
	slots;
	/**
	* The `Response` produced by handlers, if any. Set after page
	* rendering or middleware completes.
	*/
	response;
	/** Explicitly assigned status; `undefined` until a caller sets one. */
	#status;
	/**
	* Default HTTP status for the rendered response. Callers override
	* before rendering runs (e.g. `handleRequest` sets this from
	* `BaseApp.getDefaultStatusCode`; error handlers set `404` / `500`).
	* Reads `200` until assigned.
	*/
	get status() {
		return this.#status ?? 200;
	}
	set status(value) {
		this.#status = value;
	}
	/**
	* Sets `status` from the matched route (see `getDefaultStatusCode`)
	* unless a caller already assigned one.
	*/
	applyDefaultStatus() {
		if (this.#status === void 0 && this.routeData) this.#status = getDefaultStatusCode(this.manifest, this.routeData, this.pathname);
	}
	/** Whether user middleware should be skipped for this request. */
	skipMiddleware = false;
	/**
	* Set to `true` when the request path was encoded too many times to fully
	* decode (see {@link validateAndDecodePathname}). These requests are
	* rejected with a `400` before middleware or routing run.
	*/
	invalidEncoding = false;
	/** A flag that tells the render content if the rewriting was triggered. */
	isRewriting = false;
	/** A safety net in case of loops (rewrite counter). */
	counter = 0;
	/** Cookies for this request. Created lazily on first access. */
	cookies;
	/** Route params derived from routeData + pathname. Computed lazily. */
	#params;
	get params() {
		if (!this.#params && this.routeData) this.#params = getParams(this.routeData, this.pathname);
		return this.#params;
	}
	set params(value) {
		this.#params = value;
	}
	/** Normalized URL for this request. */
	url;
	/** Client address for this request. */
	clientAddress;
	/** Whether this is a partial render (container API). */
	partial;
	/** Internal metadata about the current response route type. */
	responseRouteType;
	/** Internal flag to prevent rerouting this response to an error page. */
	skipErrorReroute = false;
	/** Whether to inject CSP meta tags. */
	shouldInjectCspMetaTags;
	/** Request-scoped locals object, shared with user middleware. */
	locals = {};
	/**
	* Memoized `props` (see `getProps`). `null` means "not yet computed"
	* — using `null` (rather than `undefined`) keeps the hidden class
	* stable and distinct from a valid-but-empty result.
	*/
	props = null;
	/** Memoized `ActionAPIContext` (see `getActionAPIContext`). */
	actionApiContext = null;
	/** Memoized `APIContext` (see `getAPIContext`). */
	apiContext = null;
	/** Registered context providers keyed by name. Lazy-initialized on first provide(). */
	#providers;
	/** Cached values from resolved providers. Lazy-initialized on first resolve(). */
	#providersResolvedValues;
	/** Cached promise for lazy component instance loading. */
	#componentInstancePromise;
	/** SSR result for the current page render. */
	result;
	/** Initial props (from container/error handler). */
	initialProps = {};
	/** Memoized Astro page partial. */
	#astroPagePartial;
	/**
	* Locale-prefixed pathname derived from the Host header for domain-based
	* i18n routing (e.g. `/en/boats/1/foo`), or `undefined` when the request
	* isn't served from a locale-mapped domain. When set, `this.pathname` is
	* derived from it so locale/param resolution match the route pattern.
	*/
	#domainPathname;
	/** Memoized current locale. */
	#currentLocale;
	/** Memoized preferred locale. */
	#preferredLocale;
	/** Memoized preferred locale list. */
	#preferredLocaleList;
	constructor(manifest, request, options, hooks) {
		this.manifest = manifest;
		this.logger = getLogger(manifest);
		this.streaming = hooks?.streaming ?? getEnvironment(manifest).defaultStreaming(manifest);
		this.renderError = hooks?.renderError;
		this.logRequest = hooks?.logRequest;
		this.request = request;
		options ??= getRenderOptions(request);
		this.routeData = options?.routeData;
		const self = this;
		this.renderOptions = {
			...options ?? {
				addCookieHeader: false,
				clientAddress: void 0,
				prerenderedErrorPageFetch: fetch,
				routeData: void 0,
				waitUntil: void 0
			},
			get locals() {
				return self.locals;
			}
		};
		this.componentInstance = void 0;
		this.slots = void 0;
		const url = new URL(request.url);
		const publicPathname = this.#normalizePathname(url.pathname);
		const pathname = this.#computePathname(publicPathname);
		setPathname(url, publicPathname);
		setPathname(url, collapseDuplicateSlashes(url.pathname));
		const domainPathname = computePathnameFromDomain(request, url, manifest.i18n, manifest.base, manifest.trailingSlash, manifest.allowedDomains, this.logger, pathname);
		if (domainPathname) {
			this.#domainPathname = domainPathname;
			this.pathname = domainPathname;
		} else this.pathname = pathname;
		this.timeStart = performance.now();
		this.clientAddress = options?.clientAddress;
		this.locals = options?.locals ?? {};
		this.url = url;
		this.cookies = new AstroCookies(request, this.logger);
		if (manifest.allowedDomains && manifest.allowedDomains.length > 0 && !this.routeData?.prerender) this.#applyForwardedHeaders();
		if (!Reflect.get(this.request, originPathnameSymbol)) setOriginPathname(this.request, this.pathname, manifest.trailingSlash, manifest.buildFormat);
		this.#resolveRouteData();
	}
	/**
	* Triggers a rewrite. Delegates to the rewrites handler module.
	*/
	rewrite(payload) {
		return executeRewrite(this, payload);
	}
	/**
	* Creates the SSR result for the current page render.
	*/
	async createResult(mod, ctx) {
		const manifest = this.manifest;
		const env = getEnvironment(manifest);
		const { clientDirectives, inlinedScripts, compressHTML } = manifest;
		const renderers = env.getRenderers(manifest);
		const resolve = (specifier) => env.resolve(manifest, specifier);
		const routeData = this.routeData;
		const { links, scripts, styles } = await env.headElements(manifest, routeData);
		const extraStyleHashes = [];
		const extraScriptHashes = [];
		const shouldInjectCspMetaTags = this.shouldInjectCspMetaTags ?? manifest.shouldInjectCspMetaTags;
		const cspAlgorithm = manifest.csp?.algorithm ?? "SHA-256";
		if (shouldInjectCspMetaTags) {
			for (const style of styles) {
				if (!isInlineCspHeadContent(style)) continue;
				extraStyleHashes.push(await generateCspDigest(style.children, cspAlgorithm));
			}
			for (const script of scripts) {
				if (!isInlineCspHeadContent(script)) continue;
				extraScriptHashes.push(await generateCspDigest(script.children, cspAlgorithm));
			}
		}
		const componentMetadata = await env.componentMetadata(manifest, routeData) ?? manifest.componentMetadata;
		const headers = new Headers({ "Content-Type": "text/html" });
		const partial = typeof this.partial === "boolean" ? this.partial : Boolean(mod.partial);
		const actionResult = hasActionPayload(this.locals) ? deserializeActionResult(this.locals._actionPayload.actionResult) : void 0;
		const status = this.status;
		const response = {
			status: actionResult?.error ? actionResult?.error.status : status,
			statusText: actionResult?.error ? actionResult?.error.type : "OK",
			get headers() {
				return headers;
			},
			set headers(_) {
				throw new AstroError(AstroResponseHeadersReassigned);
			}
		};
		const state = this;
		const result = {
			base: manifest.base,
			userAssetsBase: manifest.userAssetsBase,
			cancelled: false,
			clientDirectives,
			inlinedScripts,
			componentMetadata,
			compressHTML,
			cookies: this.cookies,
			createAstro: (props, slots) => state.createAstro(result, props, slots, ctx),
			links,
			params: this.params,
			partial,
			pathname: this.pathname,
			renderers,
			resolve,
			response,
			request: this.request,
			scripts,
			styles,
			actionResult,
			async getServerIslandNameMap() {
				return (await getServerIslands(manifest)).serverIslandNameMap ?? /* @__PURE__ */ new Map();
			},
			key: manifest.key,
			trailingSlash: manifest.trailingSlash,
			_metadata: {
				hasHydrationScript: false,
				rendererSpecificHydrationScripts: /* @__PURE__ */ new Set(),
				hasRenderedHead: false,
				renderedScripts: /* @__PURE__ */ new Set(),
				hasDirectives: /* @__PURE__ */ new Set(),
				hasRenderedServerIslandRuntime: false,
				headInTree: false,
				extraHead: [],
				extraStyleHashes,
				extraScriptHashes,
				propagators: /* @__PURE__ */ new Set(),
				routeHasPropagation: false,
				pendingSlotEvaluations: [],
				templateDepth: 0
			},
			cspDestination: manifest.csp?.cspDestination ?? (routeData.prerender ? "meta" : "header"),
			shouldInjectCspMetaTags,
			cspAlgorithm,
			directives: manifest.csp?.directives ? [...manifest.csp.directives] : [],
			scriptHashes: manifest.csp?.scriptHashes ? [...manifest.csp.scriptHashes] : [],
			scriptResources: manifest.csp?.scriptResources ? [...manifest.csp.scriptResources] : [],
			styleHashes: manifest.csp?.styleHashes ? [...manifest.csp.styleHashes] : [],
			styleResources: manifest.csp?.styleResources ? [...manifest.csp.styleResources] : [],
			isStrictDynamic: manifest.csp?.isStrictDynamic ?? false,
			scriptDirective: {
				resources: manifest.csp?.scriptDirective ? [...manifest.csp.scriptDirective.resources] : [],
				hashes: manifest.csp?.scriptDirective ? [...manifest.csp.scriptDirective.hashes] : [],
				strictDynamic: manifest.csp?.scriptDirective?.strictDynamic ?? false
			},
			styleDirective: {
				resources: manifest.csp?.styleDirective ? [...manifest.csp.styleDirective.resources] : [],
				hashes: manifest.csp?.styleDirective ? [...manifest.csp.styleDirective.hashes] : []
			},
			speculationRulesContent: manifest.csp?.speculationRulesContent,
			internalFetchHeaders: manifest.internalFetchHeaders
		};
		this.result = result;
		return result;
	}
	/**
	* Creates the Astro global object for a component render.
	*/
	createAstro(result, props, slotValues, apiContext) {
		let astroPagePartial;
		if (this.isRewriting) this.#astroPagePartial = this.createAstroPagePartial(result, apiContext);
		this.#astroPagePartial ??= this.createAstroPagePartial(result, apiContext);
		astroPagePartial = this.#astroPagePartial;
		const Astro = Object.assign(Object.create(astroPagePartial), {
			props,
			self: null
		});
		Object.defineProperty(Astro, slotValuesSymbol, {
			value: slotValues,
			writable: true,
			configurable: true,
			enumerable: false
		});
		return Astro;
	}
	/**
	* Creates the Astro page-level partial (prototype for Astro global).
	*/
	createAstroPagePartial(result, apiContext) {
		const state = this;
		const { cookies, locals, params, logger, url } = this;
		const { response } = result;
		const redirect = (path, status = 302) => {
			if (state.request[responseSentSymbol$1]) throw new AstroError({ ...ResponseSentError });
			return new Response(null, {
				status,
				headers: { Location: path }
			});
		};
		const rewrite = async (reroutePayload) => {
			return await state.rewrite(reroutePayload);
		};
		const callAction = createCallAction(apiContext);
		const partial = {
			generator: ASTRO_GENERATOR,
			routePattern: this.routeData.route,
			isPrerendered: this.routeData.prerender,
			cookies,
			get slots() {
				const slotsByAstro = result._metadata.slotsByAstro ??= /* @__PURE__ */ new WeakMap();
				let slots = slotsByAstro.get(this);
				if (slots === void 0) {
					slots = new Slots(result, this[slotValuesSymbol] ?? null, logger);
					slotsByAstro.set(this, slots);
				}
				return slots;
			},
			get clientAddress() {
				return state.getClientAddress();
			},
			get currentLocale() {
				return state.computeCurrentLocale();
			},
			params,
			get preferredLocale() {
				return state.computePreferredLocale();
			},
			get preferredLocaleList() {
				return state.computePreferredLocaleList();
			},
			locals,
			redirect,
			rewrite,
			request: this.request,
			response,
			site: getSite(this.manifest),
			getActionResult: createGetActionResult(locals),
			get callAction() {
				return callAction;
			},
			url,
			get originPathname() {
				return getOriginPathname(state.request);
			},
			get csp() {
				return state.getCsp();
			},
			get logger() {
				return astroToRuntimeLogger(logger);
			}
		};
		this.defineProviderGetters(partial);
		return partial;
	}
	getClientAddress() {
		const { clientAddress } = this;
		const routeData = this.routeData;
		if (routeData.prerender) throw new AstroError({
			...PrerenderClientAddressNotAvailable,
			message: PrerenderClientAddressNotAvailable.message(routeData.component)
		});
		if (clientAddress) return clientAddress;
		if (this.manifest.adapterName) throw new AstroError({
			...ClientAddressNotAvailable,
			message: ClientAddressNotAvailable.message(this.manifest.adapterName)
		});
		throw new AstroError(StaticClientAddressNotAvailable);
	}
	getCookies() {
		return this.cookies;
	}
	getCsp() {
		const state = this;
		if (!this.manifest.csp) {
			if (getEnvironment(this.manifest).runtimeMode === "production") this.logger.warn("csp", `context.csp was used when rendering the route ${colors.green(state.routeData.route)}, but CSP was not configured. For more information, see https://docs.astro.build/en/reference/configuration-reference/#securitycsp`);
			return;
		}
		const warnedFallback = /* @__PURE__ */ new Set();
		const warnFallback = (family, kind) => {
			if (kind === "default" || !state.result) return;
			const defaultResources = (family === "script" ? state.result.scriptDirective : state.result.styleDirective).resources.map(normalizeCspResourceEntry).filter((entry) => entry.kind === "default").map((entry) => entry.resource);
			if (defaultResources.length === 0) return;
			const key = `${family}:${kind}`;
			if (warnedFallback.has(key)) return;
			warnedFallback.add(key);
			const general = `${family}-src`;
			const specific = `${general}-${kind === "element" ? "elem" : "attr"}`;
			state.logger.warn("csp", `A resource was added to \`${specific}\`, but \`${general}\` also defines custom resources (${defaultResources.join(" ")}). Because \`${specific}\` overrides \`${general}\` for its scope (browsers do not fall back), those resources will not apply there. Add them to \`${specific}\` as well if needed.`);
		};
		return {
			insertDirective(payload) {
				if (state.result) state.result.directives = pushDirective(state.result.directives, payload);
			},
			insertScriptResource(payload) {
				if (!state.result) return;
				warnFallback("script", normalizeCspResourceEntry(payload).kind);
				state.result.scriptDirective.resources.push(payload);
			},
			insertStyleResource(payload) {
				if (!state.result) return;
				warnFallback("style", normalizeCspResourceEntry(payload).kind);
				state.result.styleDirective.resources.push(payload);
			},
			insertStyleHash(payload) {
				state.result?.styleDirective.hashes.push(payload);
			},
			insertScriptHash(payload) {
				state.result?.scriptDirective.hashes.push(payload);
			}
		};
	}
	computeCurrentLocale() {
		const { url, manifest: { i18n }, routeData } = this;
		if (!i18n || !routeData) return;
		const { defaultLocale, locales, strategy } = i18n;
		const fallbackTo = strategy === "pathname-prefix-other-locales" || strategy === "domains-prefix-other-locales" ? defaultLocale : void 0;
		if (this.#currentLocale) return this.#currentLocale;
		let computedLocale;
		if (isRouteServerIsland(routeData)) {
			let referer = this.request.headers.get("referer");
			if (referer) {
				if (URL.canParse(referer)) referer = new URL(referer).pathname;
				computedLocale = computeCurrentLocale(referer, locales, defaultLocale);
			}
		} else {
			let pathname = routeData.pathname;
			if (this.#domainPathname) pathname = this.pathname;
			else if (url && !routeData.pattern.test(url.pathname)) {
				for (const fallbackRoute of routeData.fallbackRoutes) if (fallbackRoute.pattern.test(url.pathname)) {
					pathname = fallbackRoute.pathname;
					break;
				}
			}
			pathname = pathname && !isRoute404or500(routeData) ? pathname : url.pathname ?? this.pathname;
			computedLocale = computeCurrentLocale(pathname, locales, defaultLocale);
			if (routeData.params.length > 0) {
				const localeFromParams = computeCurrentLocaleFromParams(this.params, locales);
				if (localeFromParams) computedLocale = localeFromParams;
			}
		}
		this.#currentLocale = computedLocale ?? fallbackTo;
		return this.#currentLocale;
	}
	computePreferredLocale() {
		const { manifest: { i18n }, request } = this;
		if (!i18n) return;
		return this.#preferredLocale ??= computePreferredLocale(request, i18n.locales);
	}
	computePreferredLocaleList() {
		const { manifest: { i18n }, request } = this;
		if (!i18n) return;
		return this.#preferredLocaleList ??= computePreferredLocaleList(request, i18n.locales);
	}
	/**
	* Lazily loads the route's component module. Returns the cached
	* instance if already loaded. The promise is cached so concurrent
	* callers share the same load.
	*/
	async loadComponentInstance() {
		if (this.componentInstance) return this.componentInstance;
		if (this.#componentInstancePromise) return this.#componentInstancePromise;
		this.#componentInstancePromise = getEnvironment(this.manifest).getComponentByRoute(this.manifest, this.routeData).then((mod) => {
			this.componentInstance = mod;
			return mod;
		});
		return this.#componentInstancePromise;
	}
	/**
	* Registers a context provider under the given key. Handlers call
	* this to contribute values to the request context (e.g. sessions).
	* The `create` factory is called lazily on the first `resolve(key)`.
	*/
	provide(key, provider) {
		(this.#providers ??= /* @__PURE__ */ new Map()).set(key, provider);
	}
	/**
	* Lazily resolves a provider registered under `key`. Calls
	* `provider.create()` on first access and caches the result.
	* Returns `undefined` if no provider was registered for the key.
	*/
	resolve(key) {
		if (this.#providersResolvedValues?.has(key)) return this.#providersResolvedValues.get(key);
		const provider = this.#providers?.get(key);
		if (!provider) return void 0;
		const value = provider.create();
		(this.#providersResolvedValues ??= /* @__PURE__ */ new Map()).set(key, value);
		return value;
	}
	/**
	* Runs all registered `finalize` callbacks. Should be called after
	* the response is produced, typically in a `finally` block.
	*
	* Returns synchronously (no promise allocation) when nothing needs
	* finalizing — important for the hot path where sessions are not used.
	*/
	finalizeAll() {
		if (!this.#providersResolvedValues || this.#providersResolvedValues.size === 0) return;
		let chain;
		for (const [key, provider] of this.#providers) if (provider.finalize && this.#providersResolvedValues.has(key)) {
			const result = provider.finalize(this.#providersResolvedValues.get(key));
			if (result) chain = chain ? chain.then(() => result) : result;
		}
		return chain;
	}
	/**
	* Adds lazy getters to `target` for each registered provider key.
	* Used by context creation (APIContext, Astro global) so that
	* provider values like `session` and `cache` appear as properties
	* without hard-coding the keys.
	*
	* Always defines a `session` getter (returning `undefined` when no
	* provider is registered) so `ctx.session` / `Astro.session` is a
	* present property regardless of whether the sessions handler was
	* included in the pipeline.
	*/
	defineProviderGetters(target) {
		const state = this;
		if (this.#providers) for (const key of this.#providers.keys()) Object.defineProperty(target, key, {
			get: () => state.resolve(key),
			enumerable: true,
			configurable: true
		});
		if (!this.#providers?.has("session")) {
			let warned = false;
			Object.defineProperty(target, "session", {
				get() {
					if (!warned) {
						warned = true;
						state.logger.warn("session", "`Astro.session` was accessed but no session storage is configured. Either configure the storage manually or use an adapter that provides session storage. For more information, see https://docs.astro.build/en/guides/sessions/");
					}
				},
				enumerable: true,
				configurable: true
			});
		}
	}
	/**
	* Resolves the route to use for this request and stores it on
	* `this.routeData`. If the adapter (or the dev server) provided a
	* `routeData` via render options it's already set and this is a
	* no-op. Otherwise we use the app's synchronous route matcher and
	* fall back to a `404.astro` route so middleware can still run.
	*
	* Called eagerly from the constructor so individual handlers
	* (actions, pages, middleware, etc.) always see a resolved route
	* without the caller needing an extra setup step.
	*
	* Once routeData is known, finalizes `this.pathname`: in dev, if the
	* matched route has no `.html` extension, strip `.html` / `/index.html`
	* suffixes so the rendering pipeline sees the canonical pathname.
	*/
	/**
	* Strip `.html` / `/index.html` suffixes from the pathname so the
	* rendering pipeline sees the canonical route path. Only applies to
	* page routes where `.html` is framework-injected. Endpoint routes
	* preserve `.html` because any such suffix is user-provided (e.g.
	* from `getStaticPaths` params). Skipped when the matched route
	* itself has an `.html` extension in its definition.
	*/
	#stripHtmlExtension() {
		if (this.routeData && this.routeData.type === "page" && !routeHasHtmlExtension(this.routeData)) {
			const original = this.pathname;
			this.pathname = this.pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
			if (this.manifest.trailingSlash === "always" && this.pathname !== "" && !this.pathname.endsWith("/")) this.pathname += "/";
			if (this.pathname !== original && this.routeData.pattern.test(original) && !this.routeData.pattern.test(this.pathname)) this.pathname = original;
		}
	}
	#resolveRouteData() {
		if (this.routeData) {
			this.#stripHtmlExtension();
			return;
		}
		const matched = matchRoute(this.manifest, this.pathname);
		if (matched && matched.prerender && this.manifest.serverLike) {
			if (matched.params.length > 0) {
				const allMatches = matchAllRoutes(this.manifest, this.pathname);
				this.routeData = allMatches.find((r) => !r.prerender);
			} else this.routeData = void 0;
		} else this.routeData = matched;
		this.logger.debug("router", "Astro matched the following route for " + this.request.url);
		this.logger.debug("router", "RouteData:\n" + this.routeData);
		if (!this.routeData) {
			const custom404 = getCustom404Route(getRouteTable(this.manifest));
			if (custom404 && !custom404.prerender) this.routeData = custom404;
		}
		if (!this.routeData) {
			this.logger.debug("router", "Astro hasn't found routes that match " + this.request.url);
			this.logger.debug("router", "Here's the available routes:\n", getRouteTable(this.manifest));
			return;
		}
		this.#stripHtmlExtension();
	}
	/**
	* Strips the manifest's base from a normalized request pathname and prepends
	* a forward slash.
	*
	* Mirrors `BaseApp.removeBase`: the router matches against this stripped path
	* while middleware reads the un-stripped `context.url.pathname`, so both must
	* strip the base identically.
	*/
	#computePathname(normalizedPathname) {
		return prependForwardSlash(stripRequestBase(normalizedPathname, this.manifest.base));
	}
	/**
	* Decodes and normalizes the public request pathname before deriving the
	* separate pathname used for route matching.
	*/
	#normalizePathname(pathname) {
		try {
			pathname = validateAndDecodePathname(pathname);
		} catch (e) {
			if (e instanceof MultiLevelEncodingError) this.invalidEncoding = true;
			else this.logger.error(null, e.toString());
		}
		return collapseDuplicateSlashes(pathname);
	}
	/**
	* Reads X-Forwarded-Proto, X-Forwarded-Host, and X-Forwarded-Port
	* from the request headers, validates them against the manifest's
	* `allowedDomains`, and updates `this.url` accordingly. Also resolves
	* `clientAddress` from X-Forwarded-For when the host is trusted.
	*
	* Only called when `allowedDomains` is configured — without it,
	* forwarded headers are never trusted.
	*/
	#applyForwardedHeaders() {
		const headers = this.request.headers;
		const allowedDomains = this.manifest.allowedDomains;
		const validated = validateForwardedHeaders(getFirstForwardedValue(headers.get("x-forwarded-proto") ?? void 0), getFirstForwardedValue(headers.get("x-forwarded-host") ?? void 0), getFirstForwardedValue(headers.get("x-forwarded-port") ?? void 0), allowedDomains);
		if (!validated.protocol && !validated.host && !validated.port) return;
		if (validated.protocol) this.url.protocol = validated.protocol + ":";
		if (validated.host) {
			const colonIdx = validated.host.indexOf(":");
			if (colonIdx !== -1) {
				this.url.hostname = validated.host.slice(0, colonIdx);
				this.url.port = validated.host.slice(colonIdx + 1);
			} else {
				this.url.hostname = validated.host;
				this.url.port = "";
			}
		}
		if (validated.port) this.url.port = validated.port;
		if (validated.host !== void 0 && !this.clientAddress) {
			const forwardedFor = getFirstForwardedValue(this.request.headers.get("x-forwarded-for") ?? void 0);
			if (forwardedFor) this.clientAddress = forwardedFor;
		}
		this.request = new Request(this.url, this.request);
	}
	/**
	* Returns the resolved `props` for this render, computing them lazily
	* from the route + component module on first access. If the
	* `initialProps` already carries user-supplied props (e.g. the
	* container API) those are used verbatim.
	*/
	async getProps() {
		if (this.props !== null) return this.props;
		if (Object.keys(this.initialProps).length > 0) {
			this.props = this.initialProps;
			return this.props;
		}
		const mod = await this.loadComponentInstance();
		this.props = await getProps({
			mod,
			routeData: this.routeData,
			routeCache: getRouteCache(this.manifest),
			pathname: this.pathname,
			logger: this.logger,
			serverLike: this.manifest.serverLike,
			base: this.manifest.base,
			trailingSlash: this.manifest.trailingSlash
		});
		return this.props;
	}
	/**
	* Returns the `ActionAPIContext` for this render, creating it lazily.
	* Used by middleware, actions, and page dispatch.
	*/
	getActionAPIContext() {
		if (this.actionApiContext !== null) return this.actionApiContext;
		const state = this;
		const ctx = {
			get cookies() {
				return state.cookies;
			},
			routePattern: this.routeData.route,
			isPrerendered: this.routeData.prerender,
			get clientAddress() {
				return state.getClientAddress();
			},
			get currentLocale() {
				return state.computeCurrentLocale();
			},
			generator: ASTRO_GENERATOR,
			get locals() {
				return state.locals;
			},
			set locals(_) {
				throw new AstroError(LocalsReassigned);
			},
			params: this.params,
			get preferredLocale() {
				return state.computePreferredLocale();
			},
			get preferredLocaleList() {
				return state.computePreferredLocaleList();
			},
			request: this.request,
			site: getSite(this.manifest),
			url: this.url,
			get originPathname() {
				return getOriginPathname(state.request);
			},
			get csp() {
				return state.getCsp();
			},
			get logger() {
				return astroToRuntimeLogger(state.logger);
			}
		};
		this.defineProviderGetters(ctx);
		this.actionApiContext = ctx;
		return this.actionApiContext;
	}
	/**
	* Returns the `APIContext` for this render, creating it lazily from
	* the memoized props + action context.
	*
	* Called before `getProps()` has resolved, the context carries
	* `props: null` and is not memoized; the next call after `getProps()`
	* fills in `props` on the same object. Callers that read `props`
	* must await `getProps()` first.
	*/
	getAPIContext() {
		if (this.apiContext !== null) return this.apiContext;
		const actionApiContext = this.getActionAPIContext();
		const state = this;
		const redirect = (path, status = 302) => new Response(null, {
			status,
			headers: { Location: path }
		});
		const rewrite = async (reroutePayload) => {
			return await state.rewrite(reroutePayload);
		};
		actionApiContext[fetchStateSymbol] = this;
		const apiContext = Object.assign(actionApiContext, {
			props: this.props,
			redirect,
			rewrite,
			getActionResult: createGetActionResult(actionApiContext.locals),
			callAction: createCallAction(actionApiContext)
		});
		if (this.props !== null) this.apiContext = apiContext;
		return apiContext;
	}
	/**
	* Invalidates the cached `APIContext` so the next `getAPIContext()`
	* call re-derives it from the (possibly mutated) state. Used
	* after an in-flight rewrite swaps the route / request / params.
	*/
	invalidateContexts() {
		this.props = null;
		this.actionApiContext = null;
		this.apiContext = null;
	}
	resetResponseMetadata() {
		this.responseRouteType = void 0;
		this.skipErrorReroute = false;
	}
};
// ../Alga Meet/node_modules/@astrojs/internal-helpers/dist/object.js
/**
* Keys that must be rejected when traversing object paths (e.g. dot-separated
* property lookups) to prevent prototype-pollution attacks.
*/
var FORBIDDEN_PATH_KEYS = /* @__PURE__ */ new Set([
	"__proto__",
	"constructor",
	"prototype"
]);
// ../Alga Meet/node_modules/astro/dist/actions/noop-actions.js
var NOOP_ACTIONS_MOD = { server: {} };
// ../Alga Meet/node_modules/astro/dist/actions/load.js
var actionsMemo = createAsyncManifestMemo(async (manifest) => manifest.actions ? await manifest.actions() : NOOP_ACTIONS_MOD);
/** Resolves the actions module from the manifest (a no-op module when none). */
function getActions(manifest) {
	return actionsMemo.get(manifest);
}
/** Looks up a single action handler by its dot-separated path. */
async function getAction(manifest, path) {
	const pathKeys = path.split(".").map((key) => decodeURIComponent(key));
	let { server } = await getActions(manifest);
	if (!server || !(typeof server === "object")) throw new TypeError(`Expected \`server\` export in actions file to be an object. Received ${typeof server}.`);
	for (const key of pathKeys) {
		if (typeof server === "function") throw new AstroError({
			...ActionNotFoundError,
			message: ActionNotFoundError.message(pathKeys.join("."))
		});
		if (FORBIDDEN_PATH_KEYS.has(key)) throw new AstroError({
			...ActionNotFoundError,
			message: ActionNotFoundError.message(pathKeys.join("."))
		});
		if (!Object.hasOwn(server, key)) throw new AstroError({
			...ActionNotFoundError,
			message: ActionNotFoundError.message(pathKeys.join("."))
		});
		server = server[key];
	}
	if (typeof server !== "function") throw new TypeError(`Expected handler for action ${pathKeys.join(".")} to be a function. Received ${typeof server}.`);
	return server;
}
// ../Alga Meet/node_modules/astro/dist/actions/runtime/server.js
/**
* Access information about Action requests from middleware.
*/
function getActionContext(context) {
	const callerInfo = getCallerInfo(context);
	const actionResultAlreadySet = Boolean(context.locals._actionPayload);
	let action = void 0;
	if (callerInfo && context.request.method === "POST" && !actionResultAlreadySet) action = {
		calledFrom: callerInfo.from,
		name: callerInfo.name,
		handler: async () => {
			const { manifest } = getFetchStateFromAPIContext(context);
			const callerInfoName = shouldAppendForwardSlash(manifest.trailingSlash, manifest.buildFormat) ? removeTrailingForwardSlash(callerInfo.name) : callerInfo.name;
			let baseAction;
			try {
				baseAction = await getAction(manifest, callerInfoName);
			} catch (error) {
				if (error instanceof Error && "name" in error && typeof error.name === "string" && error.name === ActionNotFoundError.name) return {
					data: void 0,
					error: new ActionError({ code: "NOT_FOUND" })
				};
				if (error instanceof URIError) return {
					data: void 0,
					error: new ActionError({ code: "NOT_FOUND" })
				};
				throw error;
			}
			const bodySizeLimit = manifest.actionBodySizeLimit;
			let input;
			try {
				input = await parseRequestBody(context.request, bodySizeLimit);
			} catch (e) {
				if (e instanceof ActionError) return {
					data: void 0,
					error: e
				};
				if (e instanceof TypeError) return {
					data: void 0,
					error: new ActionError({ code: "UNSUPPORTED_MEDIA_TYPE" })
				};
				if (e instanceof SyntaxError) return {
					data: void 0,
					error: new ActionError({
						code: "BAD_REQUEST",
						message: "Invalid JSON request body"
					})
				};
				throw e;
			}
			const omitKeys = [
				"props",
				"getActionResult",
				"callAction",
				"redirect"
			];
			const actionAPIContext = Object.create(Object.getPrototypeOf(context), Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(context)).filter(([key]) => !omitKeys.includes(key))));
			Reflect.set(actionAPIContext, ACTION_API_CONTEXT_SYMBOL, true);
			return baseAction.bind(actionAPIContext)(input);
		}
	};
	function setActionResult(actionName, actionResult) {
		context.locals._actionPayload = {
			actionResult,
			actionName
		};
	}
	return {
		action,
		setActionResult,
		serializeActionResult,
		deserializeActionResult
	};
}
function getCallerInfo(ctx) {
	if (ctx.routePattern === "/_actions/[...path]") return {
		from: "rpc",
		name: ctx.url.pathname.replace(/^.*\/_actions\//, "")
	};
	const queryParam = ctx.url.searchParams.get(ACTION_QUERY_PARAMS.actionName);
	if (queryParam) return {
		from: "form",
		name: queryParam
	};
}
async function parseRequestBody(request, bodySizeLimit) {
	const contentType = request.headers.get("content-type");
	const contentLengthHeader = request.headers.get("content-length");
	const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : void 0;
	const hasContentLength = typeof contentLength === "number" && Number.isFinite(contentLength);
	if (!contentType) return void 0;
	if (hasContentLength && contentLength > bodySizeLimit) throw new ActionError({
		code: "CONTENT_TOO_LARGE",
		message: `Request body exceeds ${bodySizeLimit} bytes`
	});
	try {
		if (hasContentType(contentType, formContentTypes)) {
			if (!hasContentLength) {
				const body = await readBodyWithLimit(request.clone(), bodySizeLimit);
				return await new Request(request.url, {
					method: request.method,
					headers: request.headers,
					body: toArrayBuffer(body)
				}).formData();
			}
			return await request.clone().formData();
		}
		if (hasContentType(contentType, ["application/json"])) {
			if (contentLength === 0) return void 0;
			if (!hasContentLength) {
				const body = await readBodyWithLimit(request.clone(), bodySizeLimit);
				if (body.byteLength === 0) return void 0;
				return JSON.parse(new TextDecoder().decode(body));
			}
			return await request.clone().json();
		}
	} catch (e) {
		if (e instanceof BodySizeLimitError) throw new ActionError({
			code: "CONTENT_TOO_LARGE",
			message: `Request body exceeds ${bodySizeLimit} bytes`
		});
		throw e;
	}
	throw new TypeError("Unsupported content type");
}
var ACTION_API_CONTEXT_SYMBOL = Symbol.for("astro.actionAPIContext");
var formContentTypes = ["application/x-www-form-urlencoded", "multipart/form-data"];
function hasContentType(contentType, expected) {
	const type = contentType.split(";")[0].toLowerCase();
	return expected.some((t) => type === t);
}
function serializeActionResult(res) {
	if (res.error) {
		if (Object.assign({
			"ASSETS_PREFIX": void 0,
			"BASE_URL": "/",
			"DEV": false,
			"MODE": "production",
			"PROD": true,
			"PUBLIC_API_URL": "http://localhost:4599",
			"PUBLIC_SITE_URL": "http://localhost:4599",
			"SITE": "http://localhost:4599",
			"SSR": true
		}, {
			OS: "Windows_NT",
			_: "C:/Program Files/nodejs/node.exe"
		})?.DEV) actionResultErrorStack.set(res.error.stack);
		let body;
		if (res.error instanceof ActionInputError) body = {
			type: res.error.type,
			issues: res.error.issues,
			fields: res.error.fields
		};
		else body = {
			...res.error,
			message: res.error.message
		};
		return {
			type: "error",
			status: res.error.status,
			contentType: "application/json",
			body: JSON.stringify(body)
		};
	}
	if (res.data === void 0) return {
		type: "empty",
		status: 204
	};
	let body;
	try {
		body = stringify(res.data, { URL: (value) => value instanceof URL && value.href });
	} catch (e) {
		let hint = ActionsReturnedInvalidDataError.hint;
		if (res.data instanceof Response) hint = REDIRECT_STATUS_CODES.includes(res.data.status) ? "If you need to redirect when the action succeeds, trigger a redirect where the action is called. See the Actions guide for server and client redirect examples: https://docs.astro.build/en/guides/actions." : "If you need to return a Response object, try using a server endpoint instead. See https://docs.astro.build/en/guides/endpoints/#server-endpoints-api-routes";
		throw new AstroError({
			...ActionsReturnedInvalidDataError,
			message: ActionsReturnedInvalidDataError.message(String(e)),
			hint
		});
	}
	return {
		type: "data",
		status: 200,
		contentType: "application/json+devalue",
		body
	};
}
function toArrayBuffer(buffer) {
	const copy = new Uint8Array(buffer.byteLength);
	copy.set(buffer);
	return copy.buffer;
}
// ../Alga Meet/node_modules/astro/dist/actions/handler.js
/**
* Handles Astro Action requests in both modes:
*
* - **RPC**: POST requests to `/_actions/<name>` (originating from the
*   generated JS client). Runs the action and returns the serialized result
*   as the response, so the caller can short-circuit rendering.
* - **Form**: POST requests with `?_action=<name>` targeting a page route
*   (originating from an HTML `<form action={actions.foo}>`). Runs the
*   action, stashes the result into `locals._actionPayload`, and returns
*   `undefined` so the caller continues to render the page.
*
* Non-action requests are a no-op (`undefined`).
*
* This handler is invoked at the bottom of the middleware chain, before
* page dispatch. That placement preserves the existing behavior where
* user middleware sees action requests and response finalization (cookies,
* sessions, etc.) runs around the action response.
*
* Expects the APIContext that is already being used by the render pipeline.
* Returns a `Response` when the action fully handles the request (RPC),
* or `undefined` when the caller should continue processing the request
* (form actions or non-action requests).
*/
function handleAction(apiContext, state) {
	markFeatureUsed(state.manifest, FetchFeatures.actions);
	const invalidEncodingResponse = rejectInvalidEncoding(state);
	if (invalidEncodingResponse) return Promise.resolve(invalidEncodingResponse);
	if (apiContext.isPrerendered) return;
	const { action, setActionResult } = getActionContext(apiContext);
	if (!action) return;
	if (state.manifest.checkOrigin && isForbiddenCrossOriginRequest(apiContext.request, apiContext.url, apiContext.isPrerendered)) return Promise.resolve(createCrossOriginForbiddenResponse(apiContext.request));
	return executeAction(action, setActionResult);
}
async function executeAction(action, setActionResult) {
	const serialized = serializeActionResult(await action.handler());
	if (action.calledFrom === "rpc") {
		if (serialized.type === "empty") return new Response(null, { status: serialized.status });
		return new Response(serialized.body, {
			status: serialized.status,
			headers: { "Content-Type": serialized.contentType }
		});
	}
	setActionResult(action.name, serialized);
}
// ../Alga Meet/node_modules/astro/dist/core/routing/3xx.js
/**
* Generates a minimal HTML redirect page used for SSR redirects.
*/
function redirectTemplate({ status, absoluteLocation, relativeLocation, from }) {
	const delay = status === 302 ? 2 : 0;
	const rel = escape(String(relativeLocation));
	return `<!doctype html>
<title>Redirecting to: ${rel}</title>
<meta http-equiv="refresh" content="${delay};url=${rel}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${escape(String(absoluteLocation))}">
<body>
	<a href="${rel}">Redirecting ${from ? `from <code>${escape(from)}</code> ` : ""}to <code>${rel}</code></a>
</body>`;
}
// ../Alga Meet/node_modules/astro/dist/core/routing/trailing-slash-handler.js
/**
* Handles trailing-slash normalization for incoming requests. If the
* request's pathname does not match the manifest's configured
* `trailingSlash` policy, a redirect `Response` is returned. Otherwise,
* returns `undefined` so the caller can continue processing the request.
* Paths encoded too many times to decode get a 400 instead of a redirect.
*/
function handleTrailingSlash(state) {
	const invalidEncodingResponse = rejectInvalidEncoding(state);
	if (invalidEncodingResponse) return invalidEncodingResponse;
	const url = new URL(state.request.url);
	const redirect = redirectTrailingSlash(state.manifest.trailingSlash, url.pathname);
	if (redirect === url.pathname) return;
	const addCookieHeader = state.renderOptions.addCookieHeader;
	const status = state.request.method === "GET" ? 301 : 308;
	const location = redirect + url.search;
	const response = new Response(redirectTemplate({
		status,
		relativeLocation: location,
		absoluteLocation: location,
		from: state.request.url
	}), {
		status,
		headers: { location }
	});
	prepareResponse(response, { addCookieHeader });
	return response;
}
function redirectTrailingSlash(trailingSlash, pathname) {
	if (pathname === "/" || isInternalPath(pathname)) return pathname;
	const path = collapseDuplicateTrailingSlashes(pathname, trailingSlash !== "never");
	if (path !== pathname) return path;
	if (trailingSlash === "ignore") return pathname;
	if (trailingSlash === "always" && !hasFileExtension(pathname)) return appendForwardSlash(pathname);
	if (trailingSlash === "never") return removeTrailingForwardSlash(pathname);
	return pathname;
}
// ../Alga Meet/node_modules/astro/dist/core/errors/not-found.js
/**
* Renders the 404 error page when no route matched the request, or returns
* `undefined` when a route matched. Returns an empty `400` when the request
* path is over-encoded.
*
* `FetchState` only falls back to an SSR `404.astro`, so this renders a
* prerendered (or absent) custom 404 page: through
* `renderOptions.prerenderedErrorPageFetch` in production, or by rendering
* the page source in dev.
*/
function handleNotFound(state) {
	const invalidEncodingResponse = rejectInvalidEncoding(state);
	if (invalidEncodingResponse) return Promise.resolve(invalidEncodingResponse);
	if (state.routeData) return;
	return renderErrorFromState(state, state.request, {
		...state.renderOptions,
		status: 404,
		pathname: state.pathname
	});
}
// ../Alga Meet/node_modules/astro/dist/core/redirects/render.js
function isExternalURL(url) {
	return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}
function redirectIsExternal(redirect) {
	if (typeof redirect === "string") return isExternalURL(redirect);
	else return isExternalURL(redirect.destination);
}
/**
* Computes the HTTP status code for a redirect response.
*
* - If the route has a `redirectRoute` and an explicit numeric status, that status is used.
* - Otherwise: GET → 301, non-GET (e.g. POST) → 308.
*/
function computeRedirectStatus(method, redirect, redirectRoute) {
	return redirectRoute && typeof redirect === "object" ? redirect.status : method === "GET" ? 301 : 308;
}
/**
* Resolves the final redirect target URL by substituting dynamic params into
* the redirect string (e.g. `/[slug]/page` → `/hello/page`).
*
* When `redirectRoute` is provided its route generator is used; otherwise params
* are substituted manually into the string redirect target.
*/
function resolveRedirectTarget(params, redirect, redirectRoute, trailingSlash) {
	if (typeof redirectRoute !== "undefined") return getRouteGenerator(redirectRoute.segments, trailingSlash)(params) || redirectRoute?.pathname || "/";
	else if (typeof redirect === "string") {
		if (redirectIsExternal(redirect)) return redirect;
		else {
			let target = redirect;
			for (const param of Object.keys(params)) {
				const paramValue = params[param];
				target = target.replace(`[${param}]`, () => paramValue).replace(`[...${param}]`, () => paramValue);
			}
			return target;
		}
	} else if (typeof redirect === "undefined") return "/";
	return redirect.destination;
}
async function renderRedirect(state) {
	markFeatureUsed(state.manifest, FetchFeatures.redirects);
	const { redirect, redirectRoute } = state.routeData;
	const status = computeRedirectStatus(state.request.method, redirect, redirectRoute);
	const headers = { location: encodeURI(resolveRedirectTarget(state.params, redirect, redirectRoute, state.manifest.trailingSlash)) };
	if (redirect && redirectIsExternal(redirect)) {
		if (typeof redirect === "string") return Response.redirect(redirect, status);
		else return Response.redirect(redirect.destination, status);
	}
	return new Response(null, {
		status,
		headers
	});
}
// ../Alga Meet/node_modules/astro/dist/core/routing/redirect-page.js
/** The delay Astro's built-in redirect page uses for `status`. */
function redirectDelayFor(status) {
	return status === 302 ? 2 : 0;
}
/**
* Renders the project's `src/pages/3xx.astro` as the body of a redirect,
* returning its HTML.
*
* Returns `undefined` when the project has no `3xx.astro`, or when rendering it
* fails — the caller falls back to Astro's built-in redirect page so a broken
* custom page degrades to a working redirect instead of failing the build.
*
* Middleware is skipped: it already ran for the request that produced the
* redirect, and re-running it around a template render would let a middleware
* that redirects recurse.
*/
async function renderRedirectPage(manifest, request, props) {
	const route = getRouteTable(manifest).routes.find((candidate) => isRoute3xx(candidate.route));
	if (!route) return;
	const state = new FetchState(manifest, request);
	try {
		state.skipMiddleware = true;
		state.routeData = route;
		state.pathname = route.route;
		state.status = 200;
		state.componentInstance = await getEnvironment(manifest).getComponentByRoute(manifest, route);
		state.initialProps = { ...props };
		return await (await handleMiddleware(state, handlePages)).text();
	} catch (err) {
		state.logger.error("redirects", `Failed to render \`src/pages/3xx.astro\` for the redirect from \`${props.from}\` to \`${props.to}\`. Falling back to the built-in redirect page.\n${err instanceof Error ? err.stack ?? err.message : String(err)}`);
		return;
	} finally {
		try {
			const finalize = state.finalizeAll();
			if (finalize) await finalize;
		} catch (err) {
			state.logger.error("redirects", `Failed to finalize the \`src/pages/3xx.astro\` render for the redirect from \`${props.from}\` to \`${props.to}\`.\n${err instanceof Error ? err.stack ?? err.message : String(err)}`);
		}
	}
}
// ../Alga Meet/node_modules/astro/dist/core/routing/handler.js
/**
* Dispatches request logging: through the facade's late-bound
* `logThisRequest` hook when the state was built by `BaseApp.render`'s fast
* path (preserving subclass overrides), else through the environment's
* `logRequest` behavior (dev request lines; prod/build/container no-op).
*/
function logRequestFromState(state, payload) {
	if (state.logRequest) state.logRequest(payload);
	else getEnvironment(state.manifest).logRequest(state.manifest, payload);
}
/**
* Runs actions then pages — the callback at the bottom of the middleware
* chain. A module-level function so passing it by reference costs zero
* per-request allocation.
*/
function actionsAndPages(state, ctx) {
	if (!state.skipMiddleware) {
		const actionResult = handleAction(ctx, state);
		if (actionResult) return actionResult.then((response) => response ?? handlePages(state, ctx));
	}
	return handlePages(state, ctx);
}
/**
* Swaps a bodiless redirect response for one carrying the project's rendered
* `src/pages/3xx.astro`.
*
* Only the build environment opts in (see `RenderEnvironment.rendersRedirectPage`):
* a static site has no `Location` header to follow, so the HTML body is the
* redirect. Responses that already carry a body — the trailing-slash
* normalizer's, or a page that rendered its own — are left alone.
*/
async function withRedirectPageBody(state, response) {
	const status = response.status;
	if (status < 300 || status >= 400 || response.body !== null) return response;
	if (!getEnvironment(state.manifest).rendersRedirectPage()) return response;
	const to = response.headers.get("location");
	if (!to) return response;
	const html = await renderRedirectPage(state.manifest, state.request, {
		from: state.pathname,
		to,
		status,
		delay: redirectDelayFor(status)
	});
	if (html === void 0) return response;
	const headers = new Headers(response.headers);
	if (!headers.has("content-type")) headers.set("content-type", "text/html");
	return new Response(html, {
		status,
		statusText: response.statusText,
		headers
	});
}
/**
* The composite "batteries-included" handler that wires up every request
* feature internally; `astro(state)` (astro/fetch) delegates here, as does
* `BaseApp.render`'s default-handler fast path.
*/
async function handleRequest(state) {
	await getResolvedLogger(state.manifest);
	markFeatureUsed(state.manifest, ALL_FETCH_FEATURES);
	const invalidEncodingResponse = rejectInvalidEncoding(state);
	if (invalidEncodingResponse) return invalidEncodingResponse;
	const trailingSlashRedirect = handleTrailingSlash(state);
	if (trailingSlashRedirect) return trailingSlashRedirect;
	const notFoundResponse = handleNotFound(state);
	if (notFoundResponse) return notFoundResponse;
	return render(state);
}
/**
* Renders a response for the given `FetchState`. Assumes trailing-slash
* redirects and routeData resolution have already run.
*
* User-triggered rewrites (`Astro.rewrite` / `ctx.rewrite`) go through
* `executeRewrite` on the current `FetchState` — they mutate the existing
* state in place and re-run middleware + page dispatch.
*/
async function render(state) {
	const routeData = state.routeData;
	const pathname = state.pathname;
	const request = state.request;
	const { addCookieHeader } = state.renderOptions;
	state.status = getDefaultStatusCode(state.manifest, routeData, pathname);
	let response;
	let finalizeError;
	try {
		const sessionP = state.manifest.sessionConfig ? provideSession(state) : void 0;
		const cacheP = provideCache(state);
		if (sessionP || cacheP) await Promise.all([sessionP, cacheP]);
		markFeatureUsed(state.manifest, FetchFeatures.sessions);
		if (routeData.type === "redirect") {
			const redirectResponse = await withRedirectPageBody(state, await renderRedirect(state));
			logRequestFromState(state, {
				pathname,
				method: request.method,
				statusCode: redirectResponse.status,
				isRewrite: false,
				timeStart: state.timeStart
			});
			prepareResponse(redirectResponse, { addCookieHeader });
			state.logger.flush();
			return redirectResponse;
		}
		const i18n = getI18n(state.manifest);
		if (!state.manifest.cacheProvider) {
			markFeatureUsed(state.manifest, FetchFeatures.cache);
			response = await handleMiddleware(state, actionsAndPages);
			if (i18n) response = await finalizeI18n(i18n, state, response);
		} else {
			const runPipeline = async () => {
				let res = await handleMiddleware(state, actionsAndPages);
				if (i18n) res = await finalizeI18n(i18n, state, res);
				return res;
			};
			response = await handleCache(state, runPipeline);
		}
		logRequestFromState(state, {
			pathname,
			method: request.method,
			statusCode: response.status,
			isRewrite: state.isRewriting,
			timeStart: state.timeStart
		});
	} catch (err) {
		state.logger.error(null, err.stack || err.message || String(err));
		return renderErrorFromState(state, request, {
			...state.renderOptions,
			status: 500,
			error: err,
			pathname: state.pathname
		});
	} finally {
		try {
			const finalize = state.finalizeAll();
			if (finalize) await finalize;
		} catch (err) {
			finalizeError = err;
			state.logger.error(null, err.stack || err.message || String(err));
		}
	}
	if (finalizeError) return renderErrorFromState(state, request, {
		...state.renderOptions,
		status: 500,
		error: finalizeError,
		pathname: state.pathname
	});
	if (REROUTABLE_STATUS_CODES.includes(response.status) && response.body === null && !state.skipErrorReroute) return renderErrorFromState(state, request, {
		...state.renderOptions,
		response,
		status: response.status,
		error: response.status === 500 ? null : void 0,
		pathname: state.pathname
	});
	response = await withRedirectPageBody(state, response);
	prepareResponse(response, { addCookieHeader });
	state.logger.flush();
	return response;
}
// ../Alga Meet/node_modules/astro/dist/core/fetch/default-handler.js
/**
* The default request handler for `BaseApp`. Stateless: builds the
* per-request `FetchState` from the manifest and delegates to
* `handleRequest`.
*
* The export path (`astro/app/fetch/default-handler`), the class name, and
* no-arg constructibility are baked into generated builds
* (`core/fetch/vite-plugin.ts` emits `new DefaultFetchHandler()`), so all
* three survive.
*/
var DefaultFetchHandler = class {
	#manifest;
	/**
	* `BaseApp` passes itself so states resolve that app's manifest ahead of
	* the ambient one; generated builds construct the handler with no
	* arguments and use the ambient manifest.
	*/
	constructor(app) {
		this.#manifest = app?.manifest;
	}
	fetch = (request) => {
		const options = getRenderOptions(request);
		return handleRequest(new FetchState(this.#manifest ?? getAmbientManifest(), request, options));
	};
};
// ../Alga Meet/node_modules/astro/dist/core/routing/match-request.js
/**
* Fully decodes a pathname, falling back to a single decode and then the raw pathname
* when validation fails. Matching runs before `render()`, so it must not throw for
* request input that render-time validation handles.
*/
function safeDecodePathname(manifest, pathname) {
	try {
		return validateAndDecodePathname(pathname);
	} catch (e) {
		new AstroIntegrationLogger(getLogger(manifest).options, manifest.adapterName).debug(e.toString());
		try {
			return decodeURI(pathname);
		} catch {
			return pathname;
		}
	}
}
/**
* Given a `Request`, returns the `RouteData` that matches its pathname — the
* appless, purely functional body of `BaseApp.match()`. By default, prerendered
* routes aren't returned, even if they are matched; when
* `allowPrerenderedRoutes` is `true`, matched prerendered routes are returned
* too.
*/
function matchRequest(manifest, request, allowPrerenderedRoutes = false) {
	const url = new URL(request.url);
	if (manifest.assets.has(url.pathname)) return void 0;
	let pathname = computePathnameFromDomain(request, url, manifest.i18n, manifest.base, manifest.trailingSlash, manifest.allowedDomains, getLogger(manifest));
	if (!pathname) pathname = prependForwardSlash(stripRequestBase(url.pathname, manifest.base));
	pathname = safeDecodePathname(manifest, pathname);
	const routeData = matchRoute(manifest, pathname);
	if (!routeData) return void 0;
	if (allowPrerenderedRoutes) return routeData;
	if (routeData.prerender) {
		if (routeData.params.length > 0) return matchAllRoutes(manifest, pathname).find((r) => !r.prerender);
		return;
	}
	return routeData;
}
// ../Alga Meet/node_modules/astro/dist/core/app/base.js
var BaseApp = class BaseApp {
	manifest;
	#adapterLogger;
	baseWithoutTrailingSlash;
	/**
	* The streaming flag passed to the constructor, surfaced through the
	* protected `resolveStreaming()` hook and fed into the internal
	* `FetchState` facade hooks on the fast path.
	*/
	#streaming;
	/**
	* The handler that turns incoming `Request` objects into `Response`s.
	* Defaults to a `DefaultFetchHandler` pinned to this app and can be
	* overridden via `setFetchHandler` — typically by the bundled
	* entrypoint after importing `virtual:astro:fetchable`.
	*/
	#fetchHandler;
	#errorHandler;
	/**
	* Whether a custom fetch handler (from `src/fetch.ts`) has been set
	* via `setFetchHandler`. When false, the `DefaultFetchHandler` is
	* in use and all features are implicitly active.
	*/
	#hasCustomFetchHandler = false;
	/**
	* Whether the missing-feature check has already run. We only want
	* to warn once — after the first request in dev, or at build end.
	*/
	#featureCheckDone = false;
	get logger() {
		return getLogger(this.manifest);
	}
	/**
	* Route data derived from the manifest, used for route matching. Reads and
	* writes go through the single per-manifest route table, so HMR updates are
	* visible to every consumer at once.
	*/
	get manifestData() {
		return getRouteTable(this.manifest);
	}
	set manifestData(routesList) {
		updateRouteTable(this.manifest, routesList.routes);
	}
	get adapterLogger() {
		const currentOptions = this.logger.options;
		if (!this.#adapterLogger || this.#adapterLogger.options !== currentOptions) this.#adapterLogger = new AstroIntegrationLogger(currentOptions, this.manifest.adapterName);
		return this.#adapterLogger;
	}
	constructor(manifest, streaming = true) {
		this.manifest = manifest;
		this.baseWithoutTrailingSlash = removeTrailingForwardSlash(manifest.base);
		this.#streaming = streaming;
		getRouteTable(manifest);
		getLogger(manifest);
		this.#fetchHandler = new DefaultFetchHandler(this);
		this.#errorHandler = this.createErrorHandler();
	}
	/**
	* Resolves the user-configured logger destination from the manifest and
	* returns the logger. Lazy and only resolves once; safe to call before
	* the first render (adapters use this to log startup messages through
	* the configured destination).
	*/
	getLogger() {
		return getResolvedLogger(this.manifest);
	}
	/**
	* The streaming flag fed into the internal `FetchState` facade hooks on
	* the fast path. Returns the constructor flag by
	* default; `BuildApp` overrides this to return `undefined` so streaming
	* falls through to the environment default (`manifest.serverLike`).
	*/
	resolveStreaming() {
		return this.#streaming;
	}
	/**
	* Override the fetch handler used to dispatch requests. Entrypoints
	* call this with the default export of `virtual:astro:fetchable` to
	* plug in a user-authored handler from `src/fetch.ts`.
	*/
	setFetchHandler(handler) {
		this.#fetchHandler = handler;
		this.#hasCustomFetchHandler = !(handler instanceof DefaultFetchHandler);
	}
	/**
	* Returns the error handler used by this app. The default is a thin
	* bridge over the functional error API — strategy selection (production
	* default / dev / build) is environment-driven inside `renderErrorPage`.
	* External subclasses can override this to customize error rendering.
	*/
	createErrorHandler() {
		return { renderError: (request, options) => renderErrorPage(this.manifest, request, options) };
	}
	/**
	* Resets the cached adapter logger so it picks up a new logger instance.
	* Used by BuildApp when the logger is replaced via setOptions().
	*/
	resetAdapterLogger() {
		this.#adapterLogger = void 0;
	}
	getAllowedDomains() {
		return this.manifest.allowedDomains;
	}
	matchesAllowedDomains(forwardedHost, protocol) {
		return BaseApp.validateForwardedHost(forwardedHost, this.manifest.allowedDomains, protocol);
	}
	static validateForwardedHost(forwardedHost, allowedDomains, protocol) {
		if (!allowedDomains || allowedDomains.length === 0) return false;
		try {
			const testUrl = new URL(`${protocol || "https"}://${forwardedHost}`);
			return allowedDomains.some((pattern) => {
				return matchPattern(testUrl, pattern);
			});
		} catch {
			return false;
		}
	}
	set setManifestData(newManifestData) {
		updateRouteTable(this.manifest, newManifestData.routes);
	}
	removeBase(pathname) {
		return stripRequestBase(pathname, this.manifest.base);
	}
	/**
	* Fully decodes a pathname, falling back to a single decode and then the raw pathname
	* when validation fails. Adapter matching runs before `render()`, so it must not throw
	* for request input that render-time validation handles.
	*/
	safeDecodePathname(pathname) {
		try {
			return validateAndDecodePathname(pathname);
		} catch (e) {
			this.adapterLogger.debug(e.toString());
			try {
				return decodeURI(pathname);
			} catch {
				return pathname;
			}
		}
	}
	/**
	* Extracts the base-stripped, decoded pathname from a request.
	* Used by adapters to compute the pathname for dev-mode route matching.
	*/
	getPathnameFromRequest(request) {
		const url = new URL(request.url);
		const pathname = prependForwardSlash(this.removeBase(url.pathname));
		return this.safeDecodePathname(pathname);
	}
	/**
	* Given a `Request`, it returns the `RouteData` that matches its `pathname`. By default, prerendered
	* routes aren't returned, even if they are matched.
	*
	* When `allowPrerenderedRoutes` is `true`, the function returns matched prerendered routes too.
	* @param request
	* @param allowPrerenderedRoutes
	*/
	match(request, allowPrerenderedRoutes = false) {
		return matchRequest(this.manifest, request, allowPrerenderedRoutes);
	}
	/**
	* A matching route function to use in the development server.
	* Contrary to the `.match` function, this function resolves props and params, returning the correct
	* route based on the priority, segments. It also returns the correct, resolved pathname.
	* @param pathname
	*/
	devMatch(pathname) {}
	computePathnameFromDomain(request) {
		return computePathnameFromDomain(request, new URL(request.url), this.manifest.i18n, this.manifest.base, this.manifest.trailingSlash, this.manifest.allowedDomains, this.logger);
	}
	async render(request, { addCookieHeader = false, clientAddress = Reflect.get(request, clientAddressSymbol), locals, prerenderedErrorPageFetch = fetch, routeData, waitUntil } = {}) {
		await getResolvedLogger(this.manifest);
		if (routeData) {
			this.logger.debug("router", "The adapter " + this.manifest.adapterName + " provided a custom RouteData for ", request.url);
			this.logger.debug("router", "RouteData");
			this.logger.debug("router", routeData);
		}
		if (locals) {
			if (typeof locals !== "object") {
				const error = new AstroError(LocalsNotAnObject);
				this.logger.error(null, error.stack);
				return this.renderError(request, {
					addCookieHeader,
					clientAddress,
					prerenderedErrorPageFetch,
					locals: void 0,
					routeData,
					waitUntil,
					status: 500,
					error
				});
			}
		}
		if (!routeData) {
			const domainPathname = this.computePathnameFromDomain(request);
			if (domainPathname) routeData = matchRoute(this.manifest, this.safeDecodePathname(domainPathname));
		}
		const resolvedOptions = {
			addCookieHeader,
			clientAddress,
			prerenderedErrorPageFetch,
			locals,
			routeData,
			waitUntil
		};
		let response;
		if (this.#fetchHandler instanceof DefaultFetchHandler) response = await handleRequest(new FetchState(this.manifest, request, resolvedOptions, {
			streaming: this.resolveStreaming(),
			renderError: (req, opts) => this.renderError(req, opts),
			logRequest: (payload) => this.logThisRequest(payload)
		}));
		else {
			setRenderOptions(request, resolvedOptions);
			response = await this.#fetchHandler.fetch(request);
		}
		this.#warnMissingFeatures();
		if (response.headers.get("X-Astro-Error")) {
			response.headers.delete(ASTRO_ERROR_HEADER);
			return this.renderError(request, {
				addCookieHeader,
				clientAddress,
				prerenderedErrorPageFetch,
				locals,
				routeData,
				waitUntil,
				response,
				status: response.status,
				error: response.status === 500 ? null : void 0
			});
		}
		return response;
	}
	setCookieHeaders(response) {
		return getSetCookiesFromResponse(response);
	}
	/**
	* Reads all the cookies written by `Astro.cookie.set()` onto the passed response.
	* For example,
	* ```ts
	* for (const cookie_ of App.getSetCookieFromResponse(response)) {
	*     const cookie: string = cookie_
	* }
	* ```
	* @param response The response to read cookies from.
	* @returns An iterator that yields key-value pairs as equal-sign-separated strings.
	*/
	static getSetCookieFromResponse = getSetCookiesFromResponse;
	/**
	* If it is a known error code, try sending the according page (e.g. 404.astro / 500.astro).
	* This also handles pre-rendered /404 or /500 routes.
	*
	* Delegates to the app's configured `ErrorHandler`. To customize behavior
	* for a specific environment, override `createErrorHandler()` rather than
	* this method.
	*/
	async renderError(request, options) {
		return this.#errorHandler.renderError(request, options);
	}
	/**
	* One-shot check: after the first request with a custom `src/fetch.ts`,
	* compare `usedFeatures` against the manifest and warn about any
	* configured features the user's pipeline doesn't call.
	*/
	#warnMissingFeatures() {
		if (this.#featureCheckDone || !this.#hasCustomFetchHandler) return;
		this.#featureCheckDone = true;
		const manifest = this.manifest;
		const missing = [];
		const used = getUsedFeatures(this.manifest);
		if (manifest.routes.some((r) => r.routeData.type === "redirect") && !(used & FetchFeatures.redirects)) missing.push("redirects");
		if (manifest.sessionConfig && !(used & FetchFeatures.sessions)) missing.push("sessions");
		if (manifest.actions && !(used & FetchFeatures.actions)) missing.push("actions");
		if (manifest.middleware && !(used & FetchFeatures.middleware)) missing.push("middleware");
		if (manifest.i18n && manifest.i18n.strategy !== "manual" && !(used & FetchFeatures.i18n)) missing.push("i18n");
		if (manifest.cacheConfig && !(used & FetchFeatures.cache)) missing.push("cache");
		for (const feature of missing) this.logger.warn("router", `Your project uses ${feature}, but your custom src/fetch.ts does not call the ${feature}() handler. This feature will not work unless your fetch handler calls it.`);
	}
	getDefaultStatusCode(routeData, pathname) {
		return getDefaultStatusCode(this.manifest, routeData, pathname);
	}
	getManifest() {
		return this.manifest;
	}
	logThisRequest({ pathname, method, statusCode, isRewrite, timeStart }) {
		const timeEnd = performance.now();
		this.logRequest({
			pathname,
			method,
			statusCode,
			isRewrite,
			reqTime: timeEnd - timeStart
		});
	}
};
// ../Alga Meet/node_modules/astro/dist/core/build/app.js
/**
* The build / prerender facade: a thin shell over the
* build environment record. The two-phase init state (`setInternals` /
* `setOptions`, injected by `createDefaultPrerenderer.setup()` after the
* prerender bundle import) lives in the `BuildEnvironmentSlots` closure
* created by the prerender entrypoint; the facade only forwards across the
* bundle boundary into those slots.
*/
var BuildApp = class extends BaseApp {
	#buildEnv;
	constructor(manifest, buildEnv) {
		super(manifest);
		this.#buildEnv = buildEnv;
	}
	isDev() {
		return true;
	}
	/**
	* Streaming falls through to the environment default
	* (`manifest.serverLike` for the build environment) — we can skip
	* streaming in SSG for performance, as writing strings is faster.
	*/
	resolveStreaming() {}
	setInternals(internals) {
		this.#buildEnv.setInternals(internals);
	}
	setOptions(options) {
		this.#buildEnv.setOptions(options);
		this.logger.setDestination(options.logger.options.destination);
		this.resetAdapterLogger();
	}
	getOptions() {
		return this.#buildEnv.getOptions();
	}
	getSettings() {
		return this.#buildEnv.getSettings();
	}
	/**
	* Route cache and component loader for `StaticPaths`. Defined on the app
	* (rather than reached through the functional core at the call site) so
	* they execute inside the prerender bundle's module graph: the default
	* prerenderer constructs `StaticPaths` from a different bundle, whose
	* copies of the core modules hold separate per-manifest state.
	*/
	get routeCache() {
		return getRouteCache(this.manifest);
	}
	getComponentByRoute(routeData) {
		return getEnvironment(this.manifest).getComponentByRoute(this.manifest, routeData);
	}
	async addStaticPath(routeData, item) {
		const mod = await this.getComponentByRoute(routeData);
		const key = stringifyParams(item.params, routeData, this.manifest.trailingSlash);
		const cached = this.routeCache.get(routeData);
		if (cached?.mod === mod) {
			if (cached.staticPaths.keyed.has(key)) return;
			cached.staticPaths.push(item);
			cached.staticPaths.keyed.set(key, item);
			return;
		}
		const staticPaths = Object.assign([item], { keyed: /* @__PURE__ */ new Map([[key, item]]) });
		this.routeCache.set(routeData, {
			mod,
			staticPaths,
			partial: true
		});
	}
	logRequest(_options) {}
};
// ../Alga Meet/node_modules/astro/dist/entrypoints/prerender.js
var buildEnv = createBuildEnvironment();
setEnvironment(manifest, buildEnv.env);
var app = new BuildApp(manifest, buildEnv);
export { app, manifest };
