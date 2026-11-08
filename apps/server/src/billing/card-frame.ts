import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serverRoot } from '../config.js'

/**
 * GET /billing/card-frame: the three card fields of the in-app checkout, framed by the desktop modal.
 *
 * Why a page of ours and not the SDK inside the app: Mercado Pago's script must never run next to the app's preload
 * bridge (session, IPC). Here it runs on the API origin, cross-origin to the app; number, expiry and CVV are MP's own
 * iframes (Secure Fields), so neither this page nor the app ever sees them. Everything else of the checkout (name,
 * CPF, button, errors) is the app's own UI; this page only draws the fields exactly like the app's TextField.
 *   frame → app  { source: 'alga-card', type: 'ready' | 'height' | 'brand' | 'token' | 'invalid' | 'error', … }
 *   app → frame  { target: 'alga-card', type: 'submit', cardholderName, document }
 * The token is useless outside our Mercado Pago account, so it may be posted to '*' (the app's origin is file://).
 */
export function cardFrameHtml(publicKey: string, accent: string): string {
  const config = JSON.stringify({ publicKey }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cartão</title>
<style>
@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;font-display:block;src:url(card-frame/inter.woff2) format('woff2')}
/* Mirrors the app's TextField (apps/desktop/src/renderer/src/ui/TextField.module.css) and tokens. */
:root{color-scheme:dark;--accent:#${accent};--text:#f7f8f8;--label:#d0d6e0;--placeholder:#8a8f98;--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.12);--danger:#e66e68;
  --font:'Inter Variable','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;--ease:cubic-bezier(.25,.46,.45,.94)}
*{box-sizing:border-box}
/* color-scheme must match at each frame level or Chromium paints an opaque canvas: dark here (like the app's
   <iframe>), light on MP's field iframes (their documents declare none). */
html,body{margin:0;background:transparent;color:var(--text);font:400 13px/20px var(--font);font-feature-settings:'calt','cv01','ss03';-webkit-font-smoothing:antialiased;overflow:hidden}
form{display:grid;gap:16px;padding:3px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.field{display:grid;gap:6px}
.label{font:510 12px/16px var(--font);color:var(--label)}
.box{position:relative;height:36px;border-radius:8px;background:rgba(255,255,255,.025);box-shadow:inset 0 0 0 1px var(--line);transition:box-shadow .16s var(--ease),background-color .16s var(--ease);cursor:text}
.box:hover{transition-duration:0ms;box-shadow:inset 0 0 0 1px var(--line-strong)}
.box.focus{transition-duration:.1s;background:rgba(255,255,255,.035);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 75%,transparent),0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
.box.bad,.box.bad:hover{box-shadow:inset 0 0 0 1px var(--danger)}
.box.bad.focus{box-shadow:inset 0 0 0 1px var(--danger),0 0 0 3px rgba(230,110,104,.12)}
.mp{position:absolute;inset:0 12px;display:flex;align-items:center}
.mp>*{flex:1}
.mp iframe{color-scheme:light;background:transparent;height:34px!important}
#number{right:72px}
.brand{position:absolute;right:8px;top:50%;transform:translateY(-50%) scale(.94);font:590 10px/14px var(--font);letter-spacing:.04em;text-transform:uppercase;color:var(--label);padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px var(--line);opacity:0;transition:opacity .2s var(--ease),transform .2s var(--ease);pointer-events:none}
.brand.on{opacity:1;transform:translateY(-50%) scale(1)}
.err{display:flex;align-items:center;gap:4px;min-height:16px;font:400 12px/16px var(--font);color:var(--danger)}
.err:empty{display:none}
.err svg{flex-shrink:0}
</style></head>
<body>
<form id="f" novalidate>
  <div class="field"><span class="label" id="l-number">Número do cartão</span><div class="box" id="b-number"><div class="mp" id="number"></div><span class="brand" id="brand"></span></div><span class="err" id="e-number" role="alert"></span></div>
  <div class="row">
    <div class="field"><span class="label">Validade</span><div class="box" id="b-expiry"><div class="mp" id="expiry"></div></div><span class="err" id="e-expiry" role="alert"></span></div>
    <div class="field"><span class="label">CVV</span><div class="box" id="b-cvv"><div class="mp" id="cvv"></div></div><span class="err" id="e-cvv" role="alert"></span></div>
  </div>
</form>
<script>window.ALGA_CARD=${config}</script>
<script src="https://www.mercadopago.com/v2/security.js" view="checkout" output="deviceId"></script>
<script src="https://sdk.mercadopago.com/js/v2"></script>
<script>
(function(){
  var cfg = window.ALGA_CARD
  var post = function (m) { m.source = 'alga-card'; parent.postMessage(m, '*') }
  var $ = function (id) { return document.getElementById(id) }
  var ICON = '<svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24Zm0 192a88 88 0 1 1 88-88 88.1 88.1 0 0 1-88 88Zm-8-80V80a8 8 0 0 1 16 0v56a8 8 0 0 1-16 0Zm20 36a12 12 0 1 1-12-12 12 12 0 0 1 12 12Z"/></svg>'
  var bad = {}, method = null, issuer = null, lastBin = null, busy = false
  function setErr(k, msg) {
    var el = $('e-' + k)
    el.innerHTML = ''
    if (msg) { el.innerHTML = ICON; el.appendChild(document.createTextNode(msg)) }
    $('b-' + k).classList.toggle('bad', !!msg); bad[k] = !!msg
  }
  function height() { post({ type: 'height', value: Math.ceil(document.querySelector('form').getBoundingClientRect().height) }) }
  new ResizeObserver(height).observe(document.querySelector('form'))
  if (!window.MercadoPago) { post({ type: 'error', message: 'sdk' }); return }
  var mp = new MercadoPago(cfg.publicKey, { locale: 'pt-BR' })
  var style = { height: '34px', fontSize: '14px', fontFamily: 'Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif', color: '#f7f8f8', placeholderColor: '#8a8f98' }
  var fields = {
    number: mp.fields.create('cardNumber', { placeholder: '0000 0000 0000 0000', style: style }).mount('number'),
    expiry: mp.fields.create('expirationDate', { placeholder: 'MM/AA', style: style }).mount('expiry'),
    cvv: mp.fields.create('securityCode', { placeholder: '123', style: style }).mount('cvv'),
  }
  var labels = { number: 'Confira o número do cartão.', expiry: 'Confira a validade.', cvv: 'Confira o CVV.' }
  var ready = 0
  Object.keys(fields).forEach(function (k) {
    var f = fields[k], box = $('b-' + k)
    f.on('focus', function () { box.classList.add('focus') })
    f.on('blur', function () { box.classList.remove('focus') })
    f.on('validityChange', function (e) { setErr(k, e && e.errorMessages && e.errorMessages.length ? labels[k] : '') })
    f.on('ready', function () { if (++ready === 3) { post({ type: 'ready' }); height() } })
    box.addEventListener('click', function () { try { f.focus() } catch (e) {} })
  })
  fields.number.on('binChange', function (e) {
    var bin = e && e.bin
    if (!bin) { method = null; issuer = null; lastBin = null; $('brand').classList.remove('on'); post({ type: 'brand', value: null }); return }
    if (bin === lastBin) return
    lastBin = bin
    mp.getPaymentMethods({ bin: bin }).then(function (r) {
      var pm = r && r.results && r.results[0]
      if (!pm) { method = null; setErr('number', 'Este cartão não é aceito.'); return }
      method = pm.id
      issuer = pm.issuer && pm.issuer.id != null ? String(pm.issuer.id) : null
      var st = pm.settings && pm.settings[0]
      if (st) { fields.number.update({ settings: st.card_number }); fields.cvv.update({ settings: st.security_code }) }
      $('brand').textContent = pm.name || pm.id; $('brand').classList.add('on')
      post({ type: 'brand', value: pm.id })
      if (pm.additional_info_needed && pm.additional_info_needed.indexOf('issuer_id') >= 0) {
        mp.getIssuers({ paymentMethodId: pm.id, bin: bin }).then(function (list) { if (list && list[0]) issuer = String(list[0].id) }).catch(function () {})
      }
    }).catch(function () { method = null })
  })
  function fail(msg) { busy = false; post({ type: 'invalid', message: msg }) }
  window.addEventListener('message', function (e) {
    var d = e.data
    if (e.source !== parent || !d || d.target !== 'alga-card' || d.type !== 'submit' || busy) return
    var name = String(d.cardholderName || '').slice(0, 60)
    var doc = String(d.document || '').replace(/\\D/g, '').slice(0, 14)
    busy = true
    if (!method && !bad.number) setErr('number', 'Digite o número do cartão.')
    if (bad.number || bad.expiry || bad.cvv) return fail('')
    mp.fields.createCardToken({ cardholderName: name, identificationType: doc.length === 14 ? 'CNPJ' : 'CPF', identificationNumber: doc }).then(function (t) {
      busy = false
      post({ type: 'token', token: t.id, paymentMethodId: method, issuerId: issuer || undefined, document: doc,
        deviceId: window.deviceId || window.MP_DEVICE_SESSION_ID || undefined })
    }).catch(function (err) {
      var causes = (err && (err.cause || err)) || []
      var hit = false
      ;[].concat(causes).forEach(function (c) {
        var code = String((c && (c.code || c.field)) || '')
        if (/E301|cardNumber/i.test(code)) { setErr('number', labels.number); hit = true }
        if (/E30[56]|208|209|expiration/i.test(code)) { setErr('expiry', labels.expiry); hit = true }
        if (/E302|E203|224|securityCode/i.test(code)) { setErr('cvv', labels.cvv); hit = true }
      })
      fail(hit ? '' : 'Confira os dados do cartão.')
    })
  })
})()
</script>
</body></html>`
}

/** Inter (the app's typeface, OFL), served next to the frame so the fields read exactly like the app. */
export const interWoff2 = (() => {
  try {
    return readFileSync(join(serverRoot, 'assets', 'inter-latin-wght-normal.woff2'))
  } catch {
    return null
  }
})()
