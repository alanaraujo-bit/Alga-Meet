/**
 * GET /billing/card-frame: the card form of the in-app checkout, embedded by the desktop modal in an iframe.
 *
 * Why a page of ours and not the SDK inside the app: Mercado Pago's script must never run next to the app's preload
 * bridge (session, IPC). Here it runs on the API origin, cross-origin to the app; the number, expiry and CVV are MP's
 * own iframes inside it (Secure Fields), so neither this page nor the app ever sees them. The page only hands the
 * parent a single-use card token, through postMessage:
 *   frame → app  { source: 'alga-card', type: 'ready' | 'height' | 'brand' | 'token' | 'invalid' | 'error', … }
 *   app → frame  { target: 'alga-card', type: 'submit' }
 * The token is useless outside our Mercado Pago account, so it may be posted to '*' (the app's origin is file://).
 */
export function cardFrameHtml(publicKey: string, accent: string): string {
  const config = JSON.stringify({ publicKey, accent: `#${accent}` }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cartão</title>
<style>
:root{--accent:#${accent};--text:#f7f8f8;--muted:#8a8f98;--faint:#62666d;--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.14);--field:rgba(255,255,255,.035);--danger:#e66e68}
*{box-sizing:border-box}
html,body{margin:0;background:transparent;color:var(--text);font:13px/1.4 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
form{display:grid;gap:12px;padding:2px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
label{display:grid;gap:6px;font-size:12px;color:var(--muted);font-weight:500}
.box{position:relative;height:40px;border-radius:8px;background:var(--field);border:1px solid var(--line);transition:border-color .15s,box-shadow .15s}
.box:hover{border-color:var(--line-strong)}
.box.focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.box.bad{border-color:color-mix(in srgb,var(--danger) 70%,transparent)}
.box iframe{height:38px!important}
.mp{position:absolute;inset:0 12px;display:flex;align-items:center}
.mp>*{flex:1}
input{all:unset;box-sizing:border-box;width:100%;height:38px;padding:0 12px;font:14px/1 inherit;font-family:inherit;color:var(--text)}
input::placeholder{color:var(--faint)}
.brand{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:3px 7px;border-radius:5px;background:rgba(255,255,255,.06);opacity:0;transition:opacity .2s}
.brand.on{opacity:1}
.err{min-height:0;font-size:12px;color:var(--danger)}
.err:empty{display:none}
</style></head>
<body>
<form id="f" autocomplete="on" novalidate>
  <label>Número do cartão<div class="box" id="b-number"><div class="mp" id="number"></div><span class="brand" id="brand"></span></div><span class="err" id="e-number"></span></label>
  <label>Nome impresso no cartão<div class="box" id="b-name"><input id="name" autocomplete="cc-name" placeholder="Como está no cartão" maxlength="60" spellcheck="false"></div><span class="err" id="e-name"></span></label>
  <div class="row">
    <label>Validade<div class="box" id="b-expiry"><div class="mp" id="expiry"></div></div><span class="err" id="e-expiry"></span></label>
    <label>CVV<div class="box" id="b-cvv"><div class="mp" id="cvv"></div></div><span class="err" id="e-cvv"></span></label>
  </div>
  <label>CPF do titular<div class="box" id="b-doc"><input id="doc" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" maxlength="14"></div><span class="err" id="e-doc"></span></label>
</form>
<script>window.ALGA_CARD=${config}</script>
<script src="https://www.mercadopago.com/v2/security.js" view="checkout" output="deviceId"></script>
<script src="https://sdk.mercadopago.com/js/v2"></script>
<script>
(function(){
  var cfg = window.ALGA_CARD
  var post = function (m) { m.source = 'alga-card'; parent.postMessage(m, '*') }
  var $ = function (id) { return document.getElementById(id) }
  var bad = {}, method = null, issuer = null, lastBin = null, busy = false
  function setErr(k, msg) { $('e-' + k).textContent = msg || ''; $('b-' + k).classList.toggle('bad', !!msg); bad[k] = !!msg }
  function height() { post({ type: 'height', value: Math.ceil(document.documentElement.getBoundingClientRect().height) }) }
  new ResizeObserver(height).observe(document.body)
  if (!window.MercadoPago) { post({ type: 'error', message: 'Não foi possível carregar o pagamento por cartão.' }); return }
  var mp = new MercadoPago(cfg.publicKey, { locale: 'pt-BR' })
  var style = { height: '38px', fontSize: '14px', fontFamily: 'Segoe UI, system-ui, sans-serif', color: '#f7f8f8', placeholderColor: '#62666d' }
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
      var s = pm.settings && pm.settings[0]
      if (s) { fields.number.update({ settings: s.card_number }); fields.cvv.update({ settings: s.security_code }) }
      $('brand').textContent = pm.name || pm.id; $('brand').classList.add('on')
      post({ type: 'brand', value: pm.id })
      if (pm.additional_info_needed && pm.additional_info_needed.indexOf('issuer_id') >= 0) {
        mp.getIssuers({ paymentMethodId: pm.id, bin: bin }).then(function (list) { if (list && list[0]) issuer = String(list[0].id) }).catch(function () {})
      }
    }).catch(function () { method = null })
  })
  // Boxes focus their field on click anywhere inside them (MP's iframe is narrower than the box).
  ;['b-name', 'b-doc'].forEach(function (id) { $(id).addEventListener('click', function () { $(id).querySelector('input').focus() }) })
  ;['name', 'doc'].forEach(function (k) {
    var el = $(k), box = $('b-' + k)
    el.addEventListener('focus', function () { box.classList.add('focus') })
    el.addEventListener('blur', function () { box.classList.remove('focus') })
    el.addEventListener('input', function () { if (bad[k]) setErr(k, '') })
  })
  $('doc').addEventListener('input', function (e) {
    var d = e.target.value.replace(/\\D/g, '').slice(0, 11)
    e.target.value = d.replace(/(\\d{3})(\\d)/, '$1.$2').replace(/(\\d{3})(\\d)/, '$1.$2').replace(/(\\d{3})(\\d{1,2})$/, '$1-$2')
  })
  function cpfOk(d) {
    if (!/^\\d{11}$/.test(d) || /^(\\d)\\1{10}$/.test(d)) return false
    for (var t = 9; t < 11; t++) {
      var sum = 0
      for (var i = 0; i < t; i++) sum += Number(d[i]) * (t + 1 - i)
      if (((sum * 10) % 11) % 10 !== Number(d[t])) return false
    }
    return true
  }
  function fail(msg) { busy = false; post({ type: 'invalid', message: msg }) }
  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || e.data.target !== 'alga-card' || e.data.type !== 'submit' || busy) return
    busy = true
    var name = $('name').value.trim().replace(/\\s+/g, ' ')
    var doc = $('doc').value.replace(/\\D/g, '')
    if (name.split(' ').length < 2) setErr('name', 'Escreva o nome como está no cartão.')
    if (!cpfOk(doc)) setErr('doc', 'CPF inválido.')
    if (!method && !bad.number) setErr('number', 'Digite o número do cartão.')
    if (bad.number || bad.name || bad.expiry || bad.cvv || bad.doc) return fail('Confira os campos destacados.')
    mp.fields.createCardToken({ cardholderName: name, identificationType: 'CPF', identificationNumber: doc }).then(function (t) {
      busy = false
      post({ type: 'token', token: t.id, paymentMethodId: method, issuerId: issuer || undefined, document: doc, lastFour: t.last_four_digits || null,
        deviceId: window.deviceId || window.MP_DEVICE_SESSION_ID || undefined })
    }).catch(function (err) {
      var causes = (err && (err.cause || err)) || []
      ;[].concat(causes).forEach(function (c) {
        var code = String((c && (c.code || c.field)) || '')
        if (/E301|cardNumber/i.test(code)) setErr('number', labels.number)
        if (/E30[56]|208|209|expiration/i.test(code)) setErr('expiry', labels.expiry)
        if (/E302|E203|224|securityCode/i.test(code)) setErr('cvv', labels.cvv)
      })
      fail('Confira os dados do cartão.')
    })
  })
})()
</script>
</body></html>`
}
