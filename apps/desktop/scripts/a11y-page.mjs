// In-page accessibility library for a11y-audit.mjs, injected with page.evaluate(installA11y). No dependencies
// (no axe-core): approximations of the WAI-ARIA / WCAG checks that matter for this app, run on the live DOM with
// computed styles. Everything must stay inside installA11y (Playwright serializes the function source).
//   window.__a11y.audit()       → { name, tabindex, hiddenFocus, dialog, menu, img, contrast } findings
//   window.__a11y.active()      → the focused element, described (role, accessible name, landmarks around it)
//   window.__a11y.focusProbe()  → does the focused element look different focused vs. blurred? (re-focuses it)
//   window.__a11y.recordLive()  → starts logging text that reaches ARIA live regions (window.__a11y.live)
//   window.__a11y.animations()  → running non-finished animations (reduced-motion check)
//   window.__a11y.forcedStates() → selected/pressed/current states unreadable or invisible in forced colors
//   window.__a11y.contrast(fg, bg) → WCAG ratio of two CSS colors (self-test)
export function installA11y() {
  if (window.__a11y) return
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const colorCache = new Map()
  /** Any CSS color (rgb, color(srgb …), oklch, color-mix result…) → [r, g, b, a] in sRGB 0..255 / 0..1, via canvas. */
  const rgba = (css) => {
    if (colorCache.has(css)) return colorCache.get(css)
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = 'rgba(0,0,0,0)'
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    const v = [d[0], d[1], d[2], d[3] / 255]
    colorCache.set(css, v)
    return v
  }
  /** `top` over `bottom` (straight alpha). */
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3])
    if (a === 0) return [0, 0, 0, 0]
    return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a)
  }
  const lum = (c) => {
    const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

  const visible = (el) => {
    if (!el.getClientRects().length) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const hiddenFromAT = (el) => !!el.closest('[aria-hidden="true"], [inert]')
  const desc = (el) => {
    const role = el.getAttribute('role')
    const label = el.getAttribute('aria-label')
    const txt = (label ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48)
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean)[0]?.replace(/^_?([A-Za-z][A-Za-z0-9]*)_.*$/, '$1') : ''
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${role ? `[role=${role}]` : ''}${txt ? ` "${txt}"` : ''}`
  }

  // ── accessible name (accname 1.2, simplified: labelledby > label > labels > content > title > placeholder) ──
  const textOf = (n, root) => {
    if (n.nodeType === 3) return n.textContent
    if (n.nodeType !== 1) return ''
    const el = n
    if (el !== root && el.getAttribute('aria-hidden') === 'true') return ''
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return ''
    if (el !== root && el.getAttribute('aria-label')) return ' ' + el.getAttribute('aria-label') + ' '
    if (el.tagName === 'IMG') return el.getAttribute('alt') ?? ''
    // Embedded controls: a text field contributes its value, a radio/checkbox nothing (accname 2C).
    if (el.tagName === 'INPUT') return /^(radio|checkbox|button|submit|reset|hidden|range|file)$/.test(el.type) ? '' : (el.value ?? '')
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return el.value ?? ''
    if (el.tagName.toLowerCase() === 'svg') return ''
    return [...el.childNodes].map((c) => textOf(c, root)).join(cs.display.startsWith('inline') ? '' : ' ')
  }
  const NAME_FROM_CONTENT = /^(button|link|menuitem|menuitemcheckbox|menuitemradio|tab|radio|checkbox|switch|option|treeitem|cell|heading|tooltip|row|columnheader)$/
  const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const name = (el) => {
    const ids = el.getAttribute('aria-labelledby')
    if (ids) {
      const t = clean(ids.split(/\s+/).map((id) => { const x = document.getElementById(id); return x ? textOf(x, x) : '' }).join(' '))
      if (t) return t
    }
    const al = clean(el.getAttribute('aria-label'))
    if (al) return al
    if (el.labels?.length) {
      const t = clean([...el.labels].map((l) => textOf(l, l)).join(' '))
      if (t) return t
    }
    const role = el.getAttribute('role') ?? ''
    if (el.tagName === 'IMG') return clean(el.getAttribute('alt'))
    if (/^(BUTTON|A|SUMMARY)$/.test(el.tagName) || NAME_FROM_CONTENT.test(role)) {
      const t = clean([...el.childNodes].map((c) => textOf(c, el)).join(' '))
      if (t) return t
    }
    if (el.tagName === 'INPUT' && /^(submit|button|reset)$/.test(el.type) && el.value) return el.value
    return clean(el.getAttribute('title') || el.getAttribute('placeholder'))
  }

  const WIDGETS = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea',
    ...['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'radio', 'checkbox', 'switch', 'option', 'slider', 'combobox', 'textbox', 'searchbox', 'spinbutton', 'listbox', 'radiogroup', 'meter', 'progressbar'].map((r) => `[role=${r}]`),
  ].join(',')
  const NATIVE_FOCUSABLE = 'a[href], button:not(:disabled), input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]'
  const tabbable = (el) => el.matches(NATIVE_FOCUSABLE) && el.getAttribute('tabindex') !== '-1' && !el.closest('[inert]')

  function contrastFindings() {
    const seen = new Map()
    const stats = (window.__a11y.contrastStats = { checked: 0, gradientOrMedia: 0 })
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const check = (el, text, fgCss, placeholder) => {
      if (!visible(el)) return
      const r = el.getBoundingClientRect()
      if (r.width <= 2 || r.height <= 2) return // .sr-only and clipped text
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return
      if (el.closest(':disabled, [aria-disabled="true"]')) return // WCAG 1.4.3: inactive UI is exempt
      const cs = getComputedStyle(el)
      let opacity = 1
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity)
      if (opacity < 0.05) return
      const layers = []
      let complex = false
      for (let n = el; n; n = n.parentElement) {
        const ncs = getComputedStyle(n)
        if (ncs.backgroundImage !== 'none' && !/^linear-gradient\(rgba?\(0, 0, 0, 0\)/.test(ncs.backgroundImage)) complex = true
        const bg = rgba(ncs.backgroundColor)
        if (bg[3] > 0) layers.push(bg)
        if (bg[3] >= 1) break
      }
      if (complex || el.closest('video, canvas, img')) return void stats.gradientOrMedia++
      stats.checked++
      let bg = [8, 11, 12, 1] // --bg-app under everything (body)
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg)
      const fg0 = rgba(fgCss)
      const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * opacity], bg)
      const size = parseFloat(cs.fontSize)
      const weight = parseInt(cs.fontWeight, 10)
      const large = size >= 24 || (size >= 18.66 && weight >= 700)
      const min = large ? 3 : 4.5
      const cr = ratio(fg, bg)
      if (cr + 0.005 >= min) return
      const key = `${hex(fg)}|${hex(bg)}|${large}`
      const f = seen.get(key) ?? { rule: 'contrast', fg: hex(fg), bg: hex(bg), ratio: Math.round(cr * 100) / 100, min, size, weight, count: 0, samples: [] }
      f.count++
      if (f.samples.length < 3) f.samples.push(`${placeholder ? 'placeholder ' : ''}"${text.slice(0, 40)}" @ ${desc(el)}`)
      seen.set(key, f)
    }
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim()
      if (!text || !n.parentElement) continue
      check(n.parentElement, text, getComputedStyle(n.parentElement).color, false)
    }
    for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
      if (el.value) continue
      check(el, el.getAttribute('placeholder'), getComputedStyle(el, '::placeholder').color, true)
    }
    return [...seen.values()]
  }

  function audit() {
    const out = { name: [], genericLabel: [], tabindex: [], hiddenFocus: [], dialog: [], menu: [], img: [], contrast: [] }
    const vw = innerWidth * innerHeight
    for (const el of document.querySelectorAll(WIDGETS)) {
      if (!visible(el) || hiddenFromAT(el)) continue
      if (el.matches('input[type=radio], input[type=checkbox]') && el.closest('label') && name(el.closest('label'))) continue
      if (!name(el)) out.name.push(desc(el))
    }
    for (const el of document.querySelectorAll('[tabindex]')) {
      if (Number(el.getAttribute('tabindex')) > 0) out.tabindex.push(`${desc(el)} tabindex=${el.getAttribute('tabindex')}`)
      if (Number(el.getAttribute('tabindex')) >= 0 && visible(el) && !hiddenFromAT(el) && !el.matches(WIDGETS) && !el.getAttribute('role'))
        out.name.push(`${desc(el)} (focusável sem papel)`)
    }
    // ARIA 1.2: a name on a generic div/span (no role) is ignored by screen readers.
    for (const el of document.querySelectorAll('div[aria-label], span[aria-label]')) if (!el.getAttribute('role') && visible(el) && !hiddenFromAT(el)) out.genericLabel.push(desc(el))
    for (const el of document.querySelectorAll(NATIVE_FOCUSABLE)) if (tabbable(el) && visible(el) && el.closest('[aria-hidden="true"]')) out.hiddenFocus.push(desc(el))

    // Dialogs: named, modal ones say so, focus inside the top modal; big fixed layers without a dialog role.
    const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')].filter(visible)
    for (const d of dialogs) {
      if (!name(d)) out.dialog.push(`${desc(d)} sem nome`)
      const r = d.getBoundingClientRect()
      if (r.width * r.height > vw * 0.35 && d.getAttribute('aria-modal') !== 'true') out.dialog.push(`${desc(d)} cobre a tela sem aria-modal`)
    }
    const modals = dialogs.filter((d) => d.getAttribute('aria-modal') === 'true')
    const top = modals[modals.length - 1]
    if (top && !top.contains(document.activeElement) && !document.activeElement?.closest('[role=menu], [role=dialog]:not([aria-modal])'))
      out.dialog.push(`foco fora do diálogo modal aberto (${desc(top)}; foco em ${document.activeElement ? desc(document.activeElement) : 'nada'})`)
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed' || !visible(el) || hiddenFromAT(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width * r.height < vw * 0.3 || !el.querySelector(NATIVE_FOCUSABLE)) continue
      if (el.closest('[role=dialog], [role=alertdialog]') || el.querySelector('[role=dialog], [role=alertdialog], main, nav')) continue
      out.dialog.push(`${desc(el)} camada fixa sem role=dialog`)
    }

    // Menus: named, only menu items inside, focus inside, valid active descendant; triggers expose aria-expanded.
    for (const m of document.querySelectorAll('[role=menu]')) {
      if (!visible(m)) continue
      if (!name(m)) out.menu.push(`${desc(m)} sem nome`)
      for (const c of m.children) {
        const r = c.getAttribute('role')
        if (!/^(menuitem|menuitemcheckbox|menuitemradio|separator|group|presentation|none)$/.test(r ?? '')) out.menu.push(`${desc(c)} filho inválido em menu`)
        if (/^menuitem/.test(r ?? '') && !name(c)) out.menu.push(`${desc(c)} item sem nome`)
      }
      if (!m.contains(document.activeElement)) out.menu.push(`${desc(m)} aberto sem foco dentro`)
      const ad = m.getAttribute('aria-activedescendant')
      if (ad && !m.querySelector(`#${CSS.escape(ad)}`)) out.menu.push(`${desc(m)} aria-activedescendant inválido`)
    }
    for (const t of document.querySelectorAll('[aria-haspopup="menu"], [aria-haspopup="true"]')) {
      if (visible(t) && !t.hasAttribute('aria-expanded')) out.menu.push(`${desc(t)} gatilho sem aria-expanded`)
    }

    // Images: alt present (empty = decorative), role=img named, svg either hidden or named.
    for (const img of document.querySelectorAll('img')) {
      if (!visible(img) || hiddenFromAT(img)) continue
      if (!img.hasAttribute('alt')) out.img.push(`${desc(img)} sem alt (${(img.getAttribute('src') ?? '').slice(0, 40)})`)
    }
    for (const el of document.querySelectorAll('[role=img]')) if (visible(el) && !hiddenFromAT(el) && !name(el)) out.img.push(`${desc(el)} role=img sem nome`)
    for (const svg of document.querySelectorAll('svg')) {
      if (!visible(svg) || hiddenFromAT(svg) || svg.getAttribute('role') === 'presentation') continue
      if (!name(svg) && !svg.querySelector('title') && !svg.parentElement?.closest(WIDGETS)) out.img.push(`${desc(svg.parentElement ?? svg)} svg exposto sem nome`)
    }
    out.contrast = contrastFindings()
    return out
  }

  /** Focused element: role, accessible name and where it lives (for keyboard journeys). */
  function active() {
    const el = document.activeElement
    if (!el || el === document.body) return { tag: 'body', role: null, name: '', where: [] }
    const where = []
    for (let n = el; n; n = n.parentElement) {
      const r = n.getAttribute?.('role') ?? ({ NAV: 'navigation', ASIDE: 'complementary', MAIN: 'main', DIALOG: 'dialog' })[n.tagName]
      if (r && /^(navigation|complementary|main|dialog|menu|toolbar|log|listbox|radiogroup|tablist|region)$/.test(r)) where.push(`${r}:${name(n) || n.getAttribute('aria-label') || ''}`)
    }
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') ?? ({ BUTTON: 'button', TEXTAREA: 'textbox', INPUT: /^(checkbox|radio|range)$/.test(el.type) ? el.type.replace('range', 'slider') : 'textbox', A: 'link' })[el.tagName] ?? null,
      name: name(el),
      checked: el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed') ?? (/^(checkbox|radio)$/.test(el.type) ? String(el.checked) : null),
      focusVisible: el.matches(':focus-visible'),
      key: el.closest('[data-key]')?.getAttribute('data-key') ?? null,
      where,
    }
  }

  /** Visible focus: compare computed styles focused vs. blurred on the element, two ancestors and its next sibling. */
  const PROPS = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderTopWidth', 'color', 'textDecorationLine']
  const OUTLINE = new Set(['outlineStyle', 'outlineWidth', 'outlineColor', 'borderTopWidth'])
  const snap = (el) => {
    const nodes = [el, el.parentElement, el.parentElement?.parentElement, el.nextElementSibling].filter(Boolean)
    return nodes.flatMap((n) => {
      const pseudo = ['::before', '::after'].map((p) => getComputedStyle(n, p))
      return [getComputedStyle(n), ...pseudo].flatMap((cs) => PROPS.map((p) => [p, cs[p]]))
    })
  }
  function focusProbe() {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const seen = (window.__a11ySeen ??= new WeakSet())
    const repeat = seen.has(el)
    seen.add(el)
    const fv = el.matches(':focus-visible')
    const on = snap(el)
    const r = el.getBoundingClientRect()
    el.blur()
    const off = snap(el)
    el.focus()
    const changed = on.some(([, v], i) => v !== off[i][1])
    const outline = on.some(([p, v], i) => OUTLINE.has(p) && v !== off[i][1] && !(p === 'outlineStyle' && v === 'none'))
    return { desc: desc(el), repeat, focusVisible: fv, changed, outline, offscreen: r.bottom < 0 || r.top > innerHeight || r.width === 0 }
  }

  /** Logs text added to ARIA live regions. `announced`: the region existed before the change (or is role=alert). */
  function recordLive() {
    if (window.__a11y.live) return
    const log = (window.__a11y.live = [])
    const known = new WeakSet()
    const SEL = '[aria-live], [role=status], [role=alert], [role=log]'
    const isLive = (e) => {
      const l = e.getAttribute('aria-live')
      if (l) return l !== 'off'
      return /^(status|alert|log)$/.test(e.getAttribute('role') ?? '')
    }
    const regionOf = (n) => {
      for (let e = n.nodeType === 1 ? n : n.parentElement; e && e !== document.body; e = e.parentElement) {
        if (e.getAttribute('aria-live') === 'off') return null
        if (isLive(e)) return e
      }
      return null
    }
    const mark = () => document.querySelectorAll(SEL).forEach((e) => known.add(e))
    mark()
    new MutationObserver((muts) => {
      for (const m of muts) {
        const nodes = m.type === 'characterData' ? [m.target] : [...m.addedNodes]
        for (const n of nodes) {
          const region = regionOf(n)
          const text = clean(n.textContent)
          if (!region || !text) continue
          log.push({ at: Date.now(), text: text.slice(0, 160), region: desc(region).slice(0, 80), announced: known.has(region) || region.getAttribute('role') === 'alert' })
        }
      }
      mark()
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  }

  /**
   * Forced colors: a state drawn as a tint (current page, selected, pressed, checked) must stay readable and differ
   * from its unselected peers once backgrounds flatten to Canvas.
   */
  function forcedStates() {
    const out = []
    const SEL = "[aria-current='page'], [aria-selected='true'], [aria-pressed='true'], [role='radio'][aria-checked='true']"
    const bgOf = (el) => {
      let bg = [255, 255, 255, 1]
      const layers = []
      for (let n = el; n; n = n.parentElement) {
        const c = rgba(getComputedStyle(n).backgroundColor)
        if (c[3] > 0) layers.push(c)
        if (c[3] >= 1) break
      }
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg)
      return bg
    }
    const look = (el) => {
      const cs = getComputedStyle(el)
      return [hex(bgOf(el)), cs.outlineStyle, cs.borderTopStyle, cs.borderTopWidth, cs.fontWeight, cs.textDecorationLine].join('|')
    }
    for (const el of document.querySelectorAll(SEL)) {
      if (!visible(el) || hiddenFromAT(el)) continue
      const bg = bgOf(el)
      const fg = over(rgba(getComputedStyle(el).color), bg)
      const cr = ratio(fg, bg)
      if ((el.textContent ?? '').trim() && cr < 3) out.push(`${desc(el)} ilegível (${hex(fg)} sobre ${hex(bg)}, ${cr.toFixed(2)}:1)`)
      const box = el.closest('[role=tablist], [role=radiogroup], [role=listbox], [role=menu], [role=toolbar], nav, aside') ?? el.parentElement
      const role = el.getAttribute('role')
      const peer = [...(box?.querySelectorAll(el.tagName) ?? [])].find((p) => p !== el && p.getAttribute('role') === role && !p.matches(SEL) && visible(p))
      if (peer && look(peer) === look(el)) out.push(`${desc(el)} igual a um item não selecionado`)
    }
    return out
  }

  /** Animations still moving (finished ones and those with no duration are not motion). */
  function animations() {
    return document.getAnimations().filter((a) => {
      if (a.playState !== 'running') return false
      const t = a.effect?.getComputedTiming?.()
      return t && (t.iterations === Infinity || t.activeDuration > 50)
    }).map((a) => `${a.animationName ?? a.constructor.name}${a.effect?.target ? ' @ ' + desc(a.effect.target) : ''}`)
  }

  window.__a11y = { audit, active, focusProbe, recordLive, animations, forcedStates, name, desc, contrast: (a, b) => ratio(rgba(a), rgba(b)) }
}
