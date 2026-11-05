// Sala de Cinema: static screens. index.html?screen=NN-name renders one 1440×900 frame.
;(function () {
  const A = window.A
  const scene = window.scene

  // ── Primitives ────────────────────────────────────────────────
  const I = (name, size = 20, weight) => {
    const w = weight ?? (size <= 18 ? 'bold' : 'regular')
    const svg = A.icon[w === 'regular' ? name : `${name}.${w}`]
    return svg.replace('<svg ', '<svg class="i" ').replace('width="20"', `width="${size}"`).replace('height="20"', `height="${size}"`)
  }
  const PEOPLE = {
    ana: { name: 'Ana', full: 'Ana Souza', hue: 350 },
    pedro: { name: 'Pedro', full: 'Pedro Alves', hue: 250 },
    bia: { name: 'Bia', full: 'Bia Lima', hue: 295 },
    lucas: { name: 'Lucas', full: 'Lucas Prado', hue: 70 },
    carlos: { name: 'Carlos', full: 'Carlos Mendes', hue: 150, initials: 'CM' },
  }
  const av = (id, size, cls = '', extra = '') => {
    const p = PEOPLE[id]
    if (p.initials)
      return `<div class="av ${cls}" style="width:${size}px;height:${size}px"><div class="disc" style="background:oklch(.29 .02 ${p.hue});color:oklch(.86 .03 ${p.hue});font:590 ${Math.round(size * 0.34)}px/1 var(--font-ui)">${p.initials}</div>${extra}</div>`
    const src = A.avatar[id + (size >= 40 ? 64 : size >= 24 ? 32 : 20)]
    return `<div class="av ${cls}" style="width:${size}px;height:${size}px"><div class="disc" style="background:color-mix(in srgb, ${A.accent[id]} 9%, #121216)">${src}</div>${extra}</div>`
  }
  /** Thin ring around an avatar: frac 1 = ready (full), < 1 = preparing (arc over a faint track). */
  const ring = (size, frac, gap = 5, stroke = 2) => {
    const d = size + gap * 2 + stroke * 2
    const r = size / 2 + gap
    const c = 2 * Math.PI * r
    return `<svg class="ring" width="${d}" height="${d}" style="left:${-gap - stroke}px;top:${-gap - stroke}px;position:absolute" viewBox="0 0 ${d} ${d}">
      <circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="${stroke}"/>
      <circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${d / 2} ${d / 2})"/>
    </svg>`
  }
  const check = (s = 20) => `<div class="check" style="width:${s}px;height:${s}px;box-shadow:0 0 0 2px var(--bgc, #0f1011)">${I('Check', Math.round(s * 0.6), 'bold')}</div>`
  const pic = (variant, w, h, style = '', viewBox) => {
    let s = scene(variant)
    if (viewBox) s = s.replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`)
    return `<div class="pic" style="width:${w}px;height:${h}px;overflow:hidden;${style}">${s.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')}</div>`
  }
  const LOGO = `<svg width="16" height="16" viewBox="0 0 256 256"><path fill="#f7f8f8" d="M106 24C113 24 118 31 121 40C127 58 129 84 126 108C123 132 117 150 117 176C117 198 121 214 123 222C125 229 122 233 117 232C108 230 98 222 91 210C80 192 75 168 75 142C75 108 84 78 94 50C97.5 40.2 99 24 106 24Z"/><path fill="#8b8ef7" d="M160 78C166 78 169.6 85.6 172 92C178 108 181 124 180 142C179 166 171 186 158 202C150 212 144 220 140 225C137 229 132 228 132 223C131 204 133 172 137 150C141 126 146 104 151 90C153.3 83.6 155 78 160 78Z"/></svg>`
  const caption = (color = 'var(--text-tertiary)') =>
    `<div class="caption" style="color:${color}"><span style="color:inherit"><svg width="10" height="10"><path d="M0 5.5h10" stroke="currentColor"/></svg></span><span style="color:inherit"><svg width="10" height="10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg></span><span style="color:inherit"><svg width="10" height="10"><path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor"/></svg></span></div>`

  // ── App chrome (rail, sidebar, stage panel) ───────────────────
  function chrome({ me, stage, cinema = false, scrim = '' }) {
    const people = ['ana', 'pedro', 'bia', 'carlos', 'lucas']
    const sbPerson = (id) =>
      `<div class="sb-row person">${av(id, 20, id === 'pedro' ? 'speak' : '')}<span>${PEOPLE[id].full}</span>${
        id === 'ana' && cinema ? `<span class="end"><span class="pill" style="background:rgba(255,255,255,.07);color:var(--text-secondary)">${I('ProjectorScreen', 12, 'bold')}Cinema</span></span>` : ''
      }${id === 'carlos' ? `<span class="end" style="color:var(--danger)">${I('Microphone', 14)}</span>` : ''}</div>`
    return `<div class="win">
      <div class="titlebar"><div class="brand">${LOGO}<span>Alga Meet</span></div>
        <div class="search">${I('MagnifyingGlass', 14)}<span>Buscar ou ir para…</span><span style="margin-left:auto;display:flex;gap:3px"><span class="kbd">Ctrl</span><span class="kbd">K</span></span></div>
        ${caption()}</div>
      <div class="rail">
        <div class="tile" style="background:rgba(255,255,255,.04);color:var(--text-secondary)">${I('ChatCircle', 20)}<span class="badge">2</span></div>
        <div class="sep"></div>
        <div class="tile" style="background:var(--state-current);box-shadow:inset 0 0 0 1px rgba(139,142,247,.35)"><span style="background:linear-gradient(160deg, oklch(.33 .05 300), oklch(.24 .035 300));position:absolute;inset:0;border-radius:12px;opacity:.55"></span><span style="position:relative">OS</span><span class="dot"></span></div>
        <div class="tile" style="background:linear-gradient(160deg, oklch(.33 .05 240), oklch(.24 .035 240))">EA</div>
        <div class="tile" style="background:rgba(255,255,255,.04);color:var(--text-tertiary)">${I('Plus', 18)}</div>
      </div>
      <div class="sidebar">
        <div class="sb-head"><span>Os de Sempre</span><span class="t3">${I('CaretDown', 16)}</span></div>
        <div class="sb-label">Canais de texto</div>
        <div class="sb-row">${I('Hash', 18)}geral</div>
        <div class="sb-row unread">${I('Hash', 18)}filmes</div>
        <div class="sb-row">${I('Hash', 18)}memes</div>
        <div class="sb-label">Canais de voz</div>
        <div class="sb-row">${I('SpeakerHigh', 18)}Geral</div>
        <div class="sb-row current">${I('SpeakerHigh', 18, 'fill')}Sexta do filme<span class="end"><span class="vdot" style="box-shadow:0 0 0 2px #1a1a26, 0 0 0 3.5px rgba(139,142,247,.55)"></span><span class="t3 tnum" style="font-weight:510">5</span></span></div>
        ${people.map(sbPerson).join('')}
        <div class="sb-row">${I('SpeakerHigh', 18)}Sala de jogo</div>
        <div class="voice-panel">
          <div class="row" style="gap:8px"><span class="vdot"></span><span style="font-weight:510">Voz conectada</span><span class="bars" style="margin-left:6px"><i style="height:5px"></i><i style="height:8px"></i><i style="height:12px"></i></span>
            <span class="row t3" style="margin-left:auto;gap:14px">${I('MonitorArrowUp', 16)}${I('PhoneDisconnect', 16)}</span></div>
          <div class="t3" style="font-size:12px;line-height:16px;margin:2px 0 10px 14px">Sexta do filme · Os de Sempre</div>
          <div style="height:1px;background:var(--border-subtle);margin:0 -12px 10px"></div>
          <div class="row" style="gap:10px">${av(me, 32)}<div class="col" style="line-height:16px"><span style="font-weight:510;font-size:13px">${PEOPLE[me].full}</span><span class="t3" style="font-size:12px">Online</span></div>
            <span class="row t3" style="margin-left:auto;gap:12px">${I('Microphone', 16)}${I('Headphones', 16)}${I('GearSix', 16)}</span></div>
        </div>
      </div>
      <div class="stage">${stage}</div>
      ${scrim}
    </div>`
  }
  const stageHead = (right = '', sub = 'Filme toda sexta, 21h') => `<div class="stage-head">
      <span class="t3">${I('SpeakerHigh', 18)}</span><span class="name">Sexta do filme</span><span class="vsep"></span><span class="t3">${sub}</span>
      <span class="row" style="margin-left:auto;gap:16px">${right}<span class="row t2" style="gap:6px;font:510 12px/1 var(--font-ui)"><span class="t3">${I('LockSimple', 14)}</span>Criptografia de ponta a ponta</span></span></div>`
  const dock = (cinema = '', tip = '') => `<div class="dock">
      <div class="b">${I('Microphone', 20)}</div><div class="b">${I('Headphones', 20)}</div><span class="sep"></span>
      <div class="b">${I('MonitorArrowUp', 20)}</div>
      <div class="b ${cinema}">${I('ProjectorScreen', 20, cinema === 'on' ? 'fill' : 'regular')}${tip}</div>
      <div class="b">${I('SlidersHorizontal', 20)}</div><span class="sep"></span>
      <div class="b hang">${I('PhoneDisconnect', 22, 'fill')}</div></div>`
  /** Bare call-stage faces centered on (cx, top). */
  const faces = (ids, cx, top, size, gap, { speak, muted = [] } = {}) => {
    const w = ids.length * size + (ids.length - 1) * gap
    return ids
      .map((id, k) => {
        const x = cx - w / 2 + size / 2 + k * (size + gap)
        const p = PEOPLE[id]
        const lit = id === speak
        const you = id === 'you'
        return `<div class="face" style="left:${x}px;top:${top}px">
          <div class="floor" style="background:radial-gradient(closest-side, oklch(.62 .08 ${p.hue} / ${lit ? 0.11 : 0.06}), transparent)"></div>
          ${av(id, size, lit ? 'speak' : '', muted.includes(id) ? `<div class="mutebadge">${I('Microphone', 13, 'bold')}</div>` : '')}
          <div class="namechip" style="background:oklch(.29 .028 ${p.hue} / .55);color:${lit ? 'var(--text-primary)' : 'var(--text-secondary)'}">${p.full}${you ? '' : ''}</div></div>`
      })
      .join('')
  }
  const roomLight = (hue, x, y) =>
    `<div class="abs" style="left:${x - 520}px;top:${y - 340}px;width:1040px;height:680px;background:radial-gradient(closest-side, oklch(.62 .08 ${hue} / .12), oklch(.62 .08 ${hue} / .05) 50%, transparent);pointer-events:none"></div>`

  // ── 01 · the call sees the session card ───────────────────────
  function s01() {
    const card = `<div class="abs card" style="left:280px;top:172px;width:560px;overflow:hidden">
        <div style="position:relative;height:234px">${pic('dusk', 560, 234)}
          <div class="abs" style="inset:0;background:linear-gradient(180deg, rgba(0,0,0,.25) 0%, transparent 30%, transparent 45%, rgba(0,0,0,.72) 100%)"></div>
          <span class="abs btn glass sm" style="left:14px;top:14px;height:24px;padding:0 8px;font-size:12px;border-radius:12px;gap:5px">${I('ProjectorScreen', 13, 'bold')}Sessão de cinema</span>
          <div class="abs" style="left:20px;bottom:16px"><div class="disp" style="font:590 22px/28px var(--font-ui);letter-spacing:-0.016em">Duna Parte Dois <span style="font-weight:400;color:var(--text-secondary)">(2024)</span></div>
            <div class="row tnum" style="gap:8px;margin-top:4px;color:var(--text-secondary);font-weight:510">2h46 <span class="t3">·</span> 4K HDR <span class="t3">·</span> Áudio 5.1</div></div>
        </div>
        <div class="row" style="height:68px;padding:0 16px;gap:12px">${av('ana', 32)}
          <div class="col" style="line-height:18px"><span style="font-weight:510;font-size:14px">Ana abriu uma sessão</span><span class="t3" style="font-size:12px">Ana está sentada · 7 poltronas livres</span></div>
          <span class="btn lg primary" style="margin-left:auto">${I('Armchair', 16, 'bold')}Sentar</span></div>
      </div>`
    const stage = `${roomLight(250, 356, 566)}${stageHead()}${card}
      ${faces(['pedro', 'bia', 'carlos', 'lucas'], 560, 526, 88, 48, { speak: 'pedro', muted: ['carlos'] })}
      ${dock('', `<div class="tip" style="bottom:52px;left:50%;transform:translateX(-50%)">Cinema <span class="t3">· projetar um filme</span></div>`)}`
    return chrome({ me: 'bia', stage, cinema: true })
  }

  // ── 02 · the host's film sheet ────────────────────────────────
  function s02() {
    const stage = `${stageHead()}${faces(['ana', 'pedro', 'bia', 'carlos'], 560, 320, 112, 48, { muted: ['carlos'] })}${dock('on')}`
    const track = (code, name, kind, right) => `<div class="row" style="height:36px;padding:0 12px;gap:10px;border-radius:8px;background:rgba(255,255,255,.025);box-shadow:inset 0 0 0 1px var(--border-subtle)">
        <span style="width:30px;height:18px;border-radius:4px;background:rgba(255,255,255,.07);display:grid;place-items:center;font:590 10px/1 var(--font-ui);color:var(--text-secondary);letter-spacing:.02em">${code}</span>
        <span style="font-weight:510">${name}</span><span class="t3">${kind}</span><span class="t3" style="margin-left:auto;font-size:12px">${right}</span></div>`
    const section = (title, body) => `<div style="margin-top:18px"><div class="label" style="margin-bottom:8px">${title}</div><div class="col" style="gap:6px">${body}</div></div>`
    const modal = `<div class="abs" style="z-index:51;left:290px;top:64px;width:860px;border-radius:16px;background:var(--bg-modal);box-shadow:var(--elev-modal);overflow:hidden">
      <div class="row" style="padding:22px 24px 0;align-items:flex-start"><div><div class="disp" style="font:590 20px/28px var(--font-ui);letter-spacing:-0.016em">Projetar para a sala</div>
        <div class="t3" style="margin-top:2px">Sexta do filme · 5 pessoas na chamada</div></div><span class="ib" style="margin:-6px -8px 0 auto;color:var(--text-tertiary)">${I('X', 18)}</span></div>
      <div style="display:grid;grid-template-columns:300px 1fr;gap:28px;padding:20px 24px 24px">
        <div>
          <div style="position:relative;border-radius:8px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--border-default)">${pic('dusk', 300, 169)}
            <span class="abs btn glass sm" style="left:8px;bottom:8px;height:22px;padding:0 8px;font-size:11.5px;border-radius:11px">Capa · 0:41:12</span></div>
          <div class="row" style="gap:8px;margin-top:8px">
            <div style="border-radius:6px;overflow:hidden;box-shadow:0 0 0 2px var(--bg-modal),0 0 0 3.5px var(--accent)">${pic('dusk', 94, 53, '', '760 330 1200 676')}</div>
            <div style="border-radius:6px;overflow:hidden;opacity:.7">${pic('storm', 94, 53)}</div>
            <div style="border-radius:6px;overflow:hidden;opacity:.7">${pic('night', 94, 53)}</div></div>
          <div class="t3" style="font-size:12px;line-height:16px;margin-top:8px">Três frames do próprio arquivo. Nada vai para serviços de fora.</div>
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-subtle)">
            <div style="font:400 11.5px/17px var(--font-mono);color:var(--text-tertiary);word-break:break-all">Duna.Parte.Dois.2024.2160p.WEB-DL.DDP5.1.HDR.mkv</div>
            <div class="t3 tnum" style="font-size:12px;margin-top:6px">18,4 GB · 2h46 · 21 capítulos</div></div>
          <div style="margin-top:18px;padding:12px;border-radius:8px;background:rgba(255,255,255,.025);box-shadow:inset 0 0 0 1px var(--border-subtle)">
            <div class="row tnum" style="justify-content:space-between"><span class="label">Seu upload</span><span class="t2" style="font-size:12px;font-weight:510">~22 de 250 Mb/s</span></div>
            <div style="position:relative;height:4px;border-radius:2px;background:rgba(255,255,255,.08);margin:8px 0"><i class="abs" style="left:0;top:0;bottom:0;width:9%;border-radius:2px;background:var(--accent)"></i></div>
            <div class="t3" style="font-size:12px;line-height:16px">Filme a 15 Mb/s. Os amigos repassam as peças entre si, então você envia cerca de 1,5× o filme, não 4×.</div></div>
        </div>
        <div>
          <div class="label" style="margin-bottom:6px">Título</div>
          <div class="row" style="height:40px;padding:0 12px;border-radius:8px;background:rgba(255,255,255,.03);box-shadow:0 0 0 1px var(--accent), 0 0 0 4px var(--accent-tint-strong)">
            <span class="disp" style="font:590 17px/24px var(--font-ui);letter-spacing:-0.016em">Duna Parte Dois (2024)</span><span style="width:1.5px;height:20px;background:var(--text-primary);margin-left:2px"></span>
            <span class="t3" style="margin-left:auto">${I('PencilSimple', 16)}</span></div>
          <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap">
            <span class="chip"><span style="color:var(--accent)">${I('Check', 12, 'bold')}</span><b>Vídeo nativo</b> · 4K · HDR10 · HEVC</span>
            <span class="chip"><b>Áudio 5.1</b> · Dolby Digital → AAC 5.1</span></div>
          <div class="t3" style="font-size:12px;line-height:16px;margin-top:8px">O vídeo chega como está no arquivo. Só o áudio Dolby Digital é convertido, sem perder canais.</div>
          ${section('Áudio · 2 faixas', track('PT', 'Português 5.1', 'Dublado', 'Dolby Digital → AAC 5.1') + track('EN', 'Inglês 5.1', 'Original', 'Dolby Digital → AAC 5.1'))}
          ${section(
            'Legendas · 2 faixas',
            track('PT', 'Português (Brasil)', '', 'SRT') +
              track('EN', 'Inglês', '', 'SRT') +
              `<div class="row t3" style="height:32px;padding:0 12px;gap:8px;border-radius:8px;border:1px dashed var(--border-strong);font-size:12px">${I('Plus', 14)}Arraste um .srt ou .ass para adicionar</div>`,
          )}
          ${section(
            'Quem está na chamada',
            `<div class="row" style="gap:8px;height:24px"><span class="row" style="color:var(--accent)">${I('Check', 14, 'bold')}</span><span class="t2">Pedro, Bia e Lucas tocam 4K HDR no PC deles</span></div>
            <div class="row" style="gap:12px;padding:10px 12px;border-radius:8px;background:var(--warning-tint);box-shadow:inset 0 0 0 1px rgba(230,180,99,.14);align-items:flex-start">
              <span style="color:var(--warning);margin-top:1px">${I('Warning', 18, 'fill')}</span>
              <div class="col" style="gap:2px"><span style="font-weight:510">Carlos não decodifica HEVC neste PC</span><span class="t2" style="font-size:12px;line-height:16px">Ele continua na chamada, mas não senta nesta sessão. Uma versão H.264 do arquivo resolve.</span></div></div>`,
          )}
        </div>
      </div>
      <div class="row" style="padding:14px 24px;border-top:1px solid var(--border-subtle);gap:10px;background:rgba(0,0,0,.12)">
        <span class="t3">${I('LockSimple', 14)}</span><span class="t3" style="font-size:12px;line-height:16px;max-width:430px">Vai direto do seu PC para quem sentar, criptografado. O Alga não vê nem guarda o filme.</span>
        <span class="btn secondary" style="margin-left:auto">Cancelar</span><span class="btn lg primary">${I('ProjectorScreen', 16, 'bold')}Abrir sessão</span></div>
    </div>`
    return chrome({ me: 'ana', stage, scrim: `<div class="abs" style="inset:0;background:var(--scrim);z-index:50"></div>${modal}` })
  }

  // ── 03 / 04 · the foyer (lights on) ───────────────────────────
  const blurredCover = (opacity) => `<div class="fill" style="opacity:${opacity}"><div class="fill" style="filter:blur(64px) saturate(1.15);transform:scale(1.2)">${scene('dusk').replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')}</div></div>`
  function foyer(seats, hint) {
    const xs = [335, 485, 635, 785]
    const seatHtml = seats
      .map((s, k) => {
        const x = xs[k]
        const top = 578
        if (s === 'eco')
          return `<div class="seat" style="left:${x}px;top:${top - 34}px;width:220px">${A.eco.idle.replace('width="100" height="130"', 'width="80" height="104"')}
            <div class="nm" style="margin-top:8px;color:var(--text-secondary)">Esperando a galera sentar</div><div class="st">O Eco guarda os lugares</div></div>`
        if (!s)
          return `<div class="seat" style="left:${x}px;top:${top}px"><div class="empty-seat" style="width:64px;height:64px">${I('Armchair', 22)}</div><div class="nm t3" style="color:var(--text-tertiary)">Livre</div></div>`
        const [id, state, choice] = s
        const ready = state === 'ready'
        return `<div class="seat" style="left:${x}px;top:${top}px">
          <div style="position:relative">${av(id, 64)}${ring(64, ready ? 1 : state)}${ready ? check(20) : ''}</div>
          <div class="nm">${PEOPLE[id].name}${id === 'ana' ? ' <small>(você)</small>' : ''}</div>
          <div class="st ${ready ? 'ok' : ''}">${ready ? (id === 'ana' ? 'Pronta' : 'Pronto') : `Preparando · ${Math.round(state * 100)}%`}</div>
          <div class="st" style="margin-top:2px;color:var(--text-disabled)">${choice}</div></div>`
      })
      .join('')
    const stage = `${blurredCover(0.5)}
      <div class="fill" style="background:linear-gradient(180deg, rgba(15,16,17,.7) 0%, rgba(15,16,17,.25) 30%, rgba(15,16,17,.55) 62%, rgba(15,16,17,.92) 100%)"></div>
      ${stageHead(`<span class="btn ghost sm">${I('SignOut', 14)}Encerrar sessão</span>`, `<span class="row" style="gap:6px">${I('ProjectorScreen', 14)}Sessão de cinema</span>`)}
      <div class="abs" style="left:240px;top:100px;width:640px;height:268px;border-radius:12px;overflow:hidden;box-shadow:var(--elev-modal)">${pic('dusk', 640, 268)}<div class="abs" style="inset:0;border-radius:12px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)"></div></div>
      <div class="abs disp" style="left:0;right:0;top:392px;text-align:center;font:590 32px/40px var(--font-ui);letter-spacing:-0.022em">Duna Parte Dois <span style="font-weight:400;color:var(--text-tertiary)">(2024)</span></div>
      <div class="abs row" style="left:0;right:0;top:442px;justify-content:center;gap:8px">
        <span class="chip"><span style="color:var(--accent)">${I('Check', 12, 'bold')}</span><b>Nativo</b> · 4K · HDR10</span><span class="chip">Áudio 5.1</span><span class="chip tnum">2h46</span>
        <span class="chip">${I('ProjectorScreen', 12, 'bold')}Ana está projetando</span></div>
      <div class="abs row" style="left:0;right:0;top:488px;justify-content:center;gap:12px"><span class="label">Você assiste</span>
        <span class="seg"><span class="on">Dublado · Português 5.1</span><span>Legendado · Inglês 5.1</span></span></div>
      ${seatHtml}
      ${dock('on')}
      <div class="abs row" style="right:20px;bottom:20px;gap:14px"><div class="col" style="align-items:flex-end;line-height:17px">${hint}</div>
        <span class="btn lg primary">${I('Play', 14, 'fill')}Começar</span></div>`
    return chrome({ me: 'ana', stage, cinema: true })
  }
  const s03 = () =>
    foyer(
      [['ana', 'ready', 'Dublado'], ['pedro', 'ready', 'Legendado'], ['bia', 0.64, 'Dublado'], null],
      `<span style="font-weight:510">2 de 3 prontos</span><span class="t3" style="font-size:12px">A Bia está carregando o começo</span>`,
    )
  const s04 = () =>
    foyer(
      [['ana', 'ready', 'Dublado'], 'eco', null, null],
      `<span style="font-weight:510">Só você sentou</span><span class="t3" style="font-size:12px">Pedro, Bia e Lucas viram o cartão</span>`,
    )

  // ── The room (modo sala): 2.39 frame, letterbox bands hold the UI ──
  const D = 9960
  const CHAPTERS = [250, 1110, 2040, 3080, 4060, 5070, 6060, 7330, 8490, 9480]
  const X0 = 32
  const TW = 1376
  const tx = (s) => X0 + (TW * s) / D
  const fmt = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  function heat(top, played) {
    const bumps = [[620, 0.3], [1500, 0.45], [2600, 0.28], [3300, 0.55], [4360, 1], [5200, 0.42], [6400, 0.72], [7800, 0.38], [8900, 0.62], [9500, 0.3]]
    const pts = []
    for (let i = 0; i <= 240; i++) {
      const s = (D * i) / 240
      let v = 0.06 + 0.04 * Math.sin(i * 1.7) * Math.sin(i * 0.37)
      for (const [c, a] of bumps) v += a * Math.exp(-(((s - c) / 260) ** 2))
      pts.push([(TW * i) / 240, 20 - Math.min(1, v) * 18])
    }
    const d = `M0 20 ${pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')} L${TW} 20 Z`
    const px = (TW * played) / D
    return `<svg class="abs" style="left:${X0}px;top:${top}px" width="${TW}" height="20"><defs><clipPath id="hp"><rect width="${px}" height="20"/></clipPath></defs>
      <path d="${d}" fill="rgba(255,255,255,.11)"/><path d="${d}" fill="rgba(255,255,255,.2)" clip-path="url(#hp)"/></svg>`
  }
  function track(top, played, buffered, bg, { knob = true } = {}) {
    const gaps = CHAPTERS.map((c) => `<i class="abs" style="left:${tx(c) - X0 - 1.5}px;top:-1px;width:3px;height:6px;background:${bg}"></i>`).join('')
    return `<div class="abs" style="left:${X0}px;top:${top}px;width:${TW}px;height:4px;border-radius:2px;background:rgba(255,255,255,.1)">
      <i class="abs" style="left:0;top:0;height:4px;border-radius:2px;width:${tx(buffered) - X0}px;background:rgba(255,255,255,.2)"></i>
      <i class="abs" style="left:0;top:0;height:4px;border-radius:2px;width:${tx(played) - X0}px;background:var(--accent)"></i>${gaps}
      ${knob ? `<i class="abs" style="left:${tx(played) - X0 - 6}px;top:-4px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.6)"></i>` : ''}</div>`
  }
  const skip = (dir) => `<div class="ib skip">${I(dir < 0 ? 'ArrowCounterClockwise' : 'ArrowClockwise', 24)}<b>10</b></div>`
  function controls(top, playing, played) {
    return `<div class="abs row" style="left:24px;right:24px;top:${top}px;height:40px;gap:4px">
      <div class="ib play">${I(playing ? 'Pause' : 'Play', 20, 'fill')}</div>${skip(-1)}${skip(1)}
      <span class="tnum" style="margin-left:10px;font-weight:510">${fmt(played)}</span><span class="t3 tnum" style="margin-left:4px">/ 2:46:00</span>
      <span class="row" style="margin-left:auto;gap:4px">
        <div class="ib">${I('Smiley', 20)}</div><div class="ib">${I('Subtitles', 20)}</div><span class="vsep" style="margin:0 10px"></span>
        <span class="row" style="gap:10px"><span class="t2">${I('SpeakerHigh', 18)}</span><span class="label">Filme</span><span class="slider"><i style="width:68%"></i><u style="left:68%"></u></span></span>
        <span class="row" style="gap:10px;margin-left:18px"><span class="label">Vozes</span><span class="slider"><i style="width:86%"></i><u style="left:86%"></u></span></span>
        <span class="vsep" style="margin:0 10px"></span><div class="ib">${I('CornersOut', 20)}</div><div class="ib">${I('DotsThree', 20, 'bold')}</div></span></div>`
  }
  const SEATS = ['ana', 'pedro', 'bia', 'lucas']
  function thinSeats(top, { speak, dim = 1, ringFor, size = 28, bgc = '#020203', react } = {}) {
    return `<div class="thinseats" style="top:${top}px;--bgc:${bgc}">${SEATS.map((id) => {
      const lit = id === speak
      const prog = ringFor && ringFor[0] === id
      return `<div style="position:relative;opacity:${lit || prog ? 1 : id === react ? 0.6 : dim}">${av(id, size, lit ? 'speak' : '')}${prog ? ring(size, ringFor[1], 3, 2) : ''}</div>`
    }).join('')}</div>`
  }
  const seatX = (k, size = 28, gap = 14) => 720 - (4 * size + 3 * gap) / 2 + size / 2 + k * (size + gap)
  function topRow(title, chip, right = '', dim = 1) {
    return `<div class="ptop" style="opacity:${dim}"><div class="ib" style="margin-left:-8px">${I('ArrowLeft', 20)}</div>
      <span class="ptitle">${title}</span><span class="chip">${chip}</span><span class="t3">${I('ProjectorScreen', 14)}</span><span class="t3" style="margin-left:-6px">Ana está projetando</span>
      <span style="margin-left:auto" class="row">${right}</span></div>`
  }
  const syncChip = (tip = '', text = 'Em sincronia') => `<span class="sync" style="position:relative"><i></i>${text}${tip}</span>`
  const room = (bg, inner) => `<div class="room" style="background:${bg}">${inner}</div>`
  const spill = (variant, o) => `<div class="fill" style="opacity:${o}"><div class="spill">${scene(variant)}</div></div>`
  const frame = (variant, style = '') => `<div class="frame" style="${style}">${scene(variant)}</div>`
  const DUNA = 'Duna Parte Dois <span style="font-weight:400;color:var(--text-tertiary)">(2024)</span>'
  const NATIVO = `<span style="color:var(--accent)">${I('Check', 12, 'bold')}</span><b>Nativo</b> · 4K HDR`

  // ── 05 · watching, UI visible ─────────────────────────────────
  function s05() {
    const played = 3733
    const hx = tx(4360)
    return room(
      '#020203',
      `${spill('dusk', 0.1)}${frame('dusk')}${caption('#3a3b40')}
      ${topRow(DUNA, NATIVO, syncChip(`<span class="tip" style="top:36px;right:0">4 de 4 · ±6 ms</span>`))}
      <div class="abs" style="left:${hx - 0.5}px;top:724px;width:1px;height:42px;background:rgba(255,255,255,.4)"></div>
      <div class="abs" style="left:${hx - 120}px;top:612px;width:240px;border-radius:8px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.14), 0 12px 32px rgba(0,0,0,.6)">
        ${pic('night', 240, 100)}
        <div class="row" style="height:28px;padding:0 10px;background:var(--bg-overlay);gap:8px;font-size:12px"><span class="tnum" style="font-weight:590">${fmt(4360)}</span><span class="t3">A travessia</span><span style="margin-left:auto" class="t2">😂 23</span></div></div>
      ${heat(738, played)}
      ${track(764, played, 5460, '#020203')}
      ${controls(786, true, played)}
      ${thinSeats(846, { speak: 'pedro', dim: 0.85 })}`,
    )
  }

  // ── 06 · watching, UI hidden ──────────────────────────────────
  function s06() {
    return room(
      '#010102',
      `${spill('night', 0.14)}${frame('night')}${caption('#232428')}
      <div class="subtitle" style="top:736px">Não corre. Na areia, quem corre afunda.</div>
      ${thinSeats(846, { speak: 'bia', dim: 0.3, bgc: '#010102', react: 'lucas' })}
      <div class="abs" style="left:${seatX(3) - 16}px;top:796px;font-size:28px;line-height:32px">😂</div>`,
    )
  }

  // ── 07 · paused (half light) ──────────────────────────────────
  const halfLight = `<div class="fill" style="background:radial-gradient(ellipse 1100px 420px at 50% -8%, rgba(255,255,255,.075), transparent 70%)"></div>`
  function pausedRoom(variant, played, center, seatOpts, chip = syncChip()) {
    const bg = '#0c0c0e'
    return room(
      bg,
      `${halfLight}${frame(variant, 'filter:brightness(.4) saturate(.7)')}${caption()}
      <div class="abs" style="left:0;top:112px;width:1440px;height:602px;background:radial-gradient(ellipse 560px 260px at 50% 50%, rgba(0,0,0,.35), transparent)"></div>
      ${topRow(DUNA, NATIVO, chip)}
      <div class="abs col" style="left:0;right:0;top:112px;height:602px;align-items:center;justify-content:center;text-align:center">${center}</div>
      ${heat(738, played)}${track(764, played, played + 1500, bg, { knob: true })}${controls(786, false, played)}
      ${thinSeats(846, { bgc: bg, ...seatOpts })}`,
    )
  }
  const s07 = () =>
    pausedRoom(
      'dusk',
      3733,
      `${av('pedro', 56)}
      <div class="disp" style="margin-top:18px;font:590 30px/38px var(--font-ui);letter-spacing:-0.022em">Pedro pausou</div>
      <div class="t2 tnum" style="margin-top:4px;font-size:15px;line-height:22px">em 1:02:13 · o mesmo frame para todos</div>
      <div class="row" style="gap:12px;margin-top:24px"><span class="btn lg primary">${I('Play', 14, 'fill')}Continuar</span><span class="kbd" style="height:22px;padding:0 7px">Espaço</span></div>
      <div class="t3 tnum" style="margin-top:16px;font-size:12px">Vira intervalo em 2:47</div>`,
      { speak: 'pedro' },
    )

  // ── 08 · waiting for someone ──────────────────────────────────
  const s08 = () =>
    pausedRoom(
      'storm',
      4805,
      `<div style="position:relative">${av('ana', 64)}${ring(64, 0.6, 6, 2.5)}</div>
      <div class="disp" style="margin-top:22px;font:590 30px/38px var(--font-ui);letter-spacing:-0.022em">Esperando a Ana</div>
      <div class="t2" style="margin-top:6px;font-size:15px;line-height:22px">A conexão dela oscilou. A sala volta sozinha quando ela tiver 10 s à frente.</div>
      <div class="row tnum" style="gap:8px;margin-top:10px;font:510 12px/1 var(--font-ui);color:var(--accent)">6 de 10 s</div>
      <div class="row" style="gap:12px;margin-top:22px"><span class="btn lg secondary">Continuar sem a Ana</span></div>`,
      { ringFor: ['ana', 0.6] },
      syncChip('', '3 de 4 prontos'),
    )

  // ── 09 · intermission (lights on) ─────────────────────────────
  function s09() {
    const played = 5652
    const xs = [510, 650, 790, 930]
    const st = {
      ana: `<div class="st ok">Pronta</div>`,
      pedro: `<div class="st ok">Pronto</div>`,
      bia: `<span class="btn sm primary" style="margin-top:8px;height:26px">${I('Check', 14, 'bold')}Estou pronta</span>`,
      lucas: `<div class="st">Ainda não</div>`,
    }
    const seats = SEATS.map((id, k) => {
      const ready = id === 'ana' || id === 'pedro'
      const lit = id === 'pedro'
      return `<div class="seat" style="left:${xs[k]}px;top:552px;--bgc:#0f1011">
        ${lit ? `<div class="abs" style="left:50%;top:-30px;width:300px;height:180px;transform:translateX(-50%);background:radial-gradient(closest-side, oklch(.62 .08 250 / .12), transparent)"></div>` : ''}
        <div style="position:relative">${av(id, 56, lit ? 'speak' : '')}${ready ? ring(56, 1) + check(18) : ''}</div>
        <div class="nm">${PEOPLE[id].name}${id === 'bia' ? ' <small>(você)</small>' : ''}</div>${st[id]}</div>`
    }).join('')
    return room(
      '#0f1011',
      `${blurredCover(0.52)}<div class="fill" style="background:linear-gradient(180deg, rgba(15,16,17,.55), rgba(15,16,17,.3) 35%, rgba(15,16,17,.7) 70%, #0f1011)"></div>${caption()}
      ${topRow(DUNA, NATIVO, `<span class="btn ghost sm">${I('SignOut', 14)}Levantar</span>`)}
      <div class="abs" style="left:440px;top:112px;width:560px;height:234px;border-radius:12px;overflow:hidden;box-shadow:var(--elev-modal)">${pic('dusk', 560, 234)}<div class="abs" style="inset:0;border-radius:12px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)"></div></div>
      <div class="abs col" style="left:0;right:0;top:372px;align-items:center;text-align:center">
        <div class="overline">Intervalo</div>
        <div class="disp tnum" style="margin-top:6px;font:590 44px/52px var(--font-ui);letter-spacing:-0.024em">Faltam 1h12</div>
        <div class="t3 tnum" style="margin-top:4px;font-size:14px">Pausado em 1:34:12 pela Ana · conversem à vontade</div></div>
      ${seats}
      <div class="abs t3" style="left:0;right:0;top:720px;text-align:center">Quando todos estiverem prontos, as luzes apagam em 3 s.</div>
      ${track(838, played, 7800, '#0f1011', { knob: false })}
      <div class="abs row tnum t3" style="left:32px;right:32px;top:852px;font-size:12px"><span>${fmt(played)}</span><span style="margin-left:auto">2:46:00</span></div>`,
    )
  }

  // ── 10 · credits and the next episode ─────────────────────────
  function s10() {
    const credits = [
      ['Direção de fotografia', 'Iara Nunes'], ['Montagem', 'Davi Rocha'], ['Desenho de som', 'Marina Assis'],
      ['Música original', 'Lia Couto e Teo Valadares'], ['Direção de arte', 'Raul Sena'], ['Figurino', 'Clara Bastos'], ['Elenco', 'Nina Torres'], ['Mixagem', 'Otávio Reis'], ['Colorista', 'Yara Mendonça'],
    ]
    return room(
      '#060607',
      `${caption()}
      ${topRow('A Travessia <span style="font-weight:400;color:var(--text-tertiary)">· S01E02 — Tempestade</span>', `<span style="color:var(--accent)">${I('Check', 12, 'bold')}</span><b>Nativo</b> · 1080p`, syncChip(), 0.7)}
      <div class="frame" style="background:#000">
        <div class="abs col" style="left:0;right:0;top:-6px;bottom:-6px;align-items:center;justify-content:center;gap:24px;-webkit-mask-image:linear-gradient(180deg, transparent 4%, #000 26%, #000 74%, transparent 96%)">
          ${credits.map(([r, n]) => `<div class="col" style="align-items:center;gap:4px"><span style="font:510 11px/14px var(--font-ui);letter-spacing:.16em;text-transform:uppercase;color:#7c8088">${r}</span><span style="font:400 17px/22px var(--font-ui);color:#d9dde4;letter-spacing:.01em">${n}</span></div>`).join('')}
        </div>
        <div class="abs card" style="right:32px;bottom:28px;width:360px;padding:12px;background:var(--bg-overlay)">
          <div style="position:relative;border-radius:8px;overflow:hidden">${pic('banquet', 336, 189)}
            <div class="abs" style="left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.15)"><i class="abs" style="left:0;top:0;bottom:0;width:18%;background:var(--accent)"></i></div></div>
          <div style="padding:12px 4px 4px">
            <div class="disp" style="font:590 17px/24px var(--font-ui);letter-spacing:-0.016em">Próximo: S01E03 — O Banquete</div>
            <div class="t2 tnum" style="margin-top:2px">Começa em <b style="color:var(--text-primary);font-weight:590">10 s</b> · mesmas poltronas</div>
            <div class="t3 row" style="margin-top:4px;gap:6px;font-size:12px">${I('Check', 12, 'bold')}A Ana já preparou o próximo arquivo da pasta</div>
            <div class="row" style="gap:8px;margin-top:14px"><span class="btn primary">${I('Play', 14, 'fill')}Assistir agora</span><span class="btn secondary">Cancelar</span></div></div>
        </div>
      </div>
      ${thinSeats(846, { speak: 'lucas', dim: 0.5, bgc: '#060607' })}`,
    )
  }

  // ── 11 · the ticket stub ──────────────────────────────────────
  function s11() {
    const W = 960
    const H = 312
    const P = 760
    const mask = `radial-gradient(circle at ${P}px 0, transparent 12px, #000 12.5px), radial-gradient(circle at ${P}px 100%, transparent 12px, #000 12.5px)`
    const stack = SEATS.map((id, k) => `<div style="margin-left:${k ? -5 : 0}px;border-radius:50%;box-shadow:0 0 0 2.5px #161718">${av(id, 30)}</div>`).join('')
    const ticket = `<div class="abs" style="left:${(1440 - W) / 2}px;top:250px;width:${W}px;height:${H}px;filter:drop-shadow(0 0 1px rgba(0,0,0,.7)) drop-shadow(0 24px 40px rgba(0,0,0,.45))">
      <div class="abs" style="inset:0;border-radius:16px;overflow:hidden;background:#161718;-webkit-mask:${mask};mask:${mask};mask-composite:intersect;-webkit-mask-composite:source-in">
        <div class="abs" style="inset:0;border-radius:16px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07), inset 0 1px 0 rgba(255,255,255,.06)"></div>
        <div class="abs" style="left:0;top:0">${pic('dusk', 260, H, '', '1236 336 460 602')}</div>
        <div class="abs" style="left:0;top:0;width:260px;height:${H}px;background:linear-gradient(90deg, transparent 70%, rgba(22,23,24,.5))"></div>
        <div class="abs" style="left:${P}px;top:0;right:0;bottom:0;background:#131415"></div>
        <div class="abs" style="left:${P - 1}px;top:20px;bottom:20px;width:2px;background:repeating-linear-gradient(180deg, rgba(255,255,255,.16) 0 3px, transparent 3px 9px)"></div>
        <div class="abs" style="left:292px;top:28px;width:440px">
          <div class="overline">Alga Meet · Sala de cinema</div>
          <div class="disp" style="margin-top:10px;font:590 32px/38px var(--font-ui);letter-spacing:-0.022em">Duna Parte Dois <span style="font-weight:400;color:var(--text-tertiary)">(2024)</span></div>
          <div class="t2" style="margin-top:6px">Sexta, 6 de novembro de 2026 · 21h04</div>
          <div style="display:grid;grid-template-columns:196px 1fr;gap:24px;margin-top:22px">
            <div>
              <div class="label">Na fileira</div>
              <div class="row" style="margin-top:8px">${stack}</div>
              <div class="t2" style="margin-top:8px;font-size:12px">Ana, Pedro, Bia e Lucas</div>
              <div class="row" style="gap:26px;margin-top:16px">
                <div><div class="disp tnum" style="font:590 26px/30px var(--font-ui);letter-spacing:-0.02em">2h46</div><div class="label">juntos</div></div>
                <div><div class="disp tnum" style="font:590 26px/30px var(--font-ui);letter-spacing:-0.02em">127</div><div class="label">reações</div></div></div>
            </div>
            <div>
              <div class="label">Momento mais reagido</div>
              <div style="position:relative;margin-top:8px;border-radius:6px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)">${pic('night', 220, 92)}
                <span class="abs btn glass sm" style="left:6px;bottom:6px;height:22px;padding:0 7px;font-size:12px;border-radius:11px">😂 23</span></div>
              <div class="t2 tnum" style="margin-top:8px;font-size:12px"><b style="font-weight:590;color:var(--text-primary)">1:12:40</b> · A travessia</div>
            </div>
          </div>
        </div>
        <div class="abs col" style="left:${P}px;right:0;top:0;bottom:0;align-items:center;text-align:center;padding:30px 20px 24px">
          <div class="overline">Admite</div>
          <div class="disp tnum" style="font:590 56px/60px var(--font-ui);letter-spacing:-0.03em;margin-top:6px">4</div>
          <div class="label">poltronas</div>
          <div style="width:48px;height:1px;background:var(--border-default);margin:18px 0"></div>
          <div style="font-weight:510">Sexta do filme</div><div class="t3" style="font-size:12px">Os de Sempre</div>
          <div class="row" style="margin-top:auto;gap:8px">${LOGO}<span style="font:400 11px/1 var(--font-mono);color:var(--text-tertiary)">Nº 0042</span></div>
        </div>
      </div></div>`
    return room(
      '#0f1011',
      `${blurredCover(0.32)}<div class="fill" style="background:linear-gradient(180deg, rgba(15,16,17,.5), rgba(15,16,17,.62) 60%, #0f1011)"></div>${caption()}
      <div class="ptop"><div class="ib" style="margin-left:-8px">${I('ArrowLeft', 20)}</div><span class="t2" style="font-weight:510">Voltar para a chamada</span></div>
      <div class="abs col" style="left:0;right:0;top:172px;align-items:center"><div class="overline">Fim da sessão</div><div class="t3" style="margin-top:4px">As luzes acenderam às 23h58</div></div>
      ${ticket}
      <div class="abs row" style="left:0;right:0;top:598px;justify-content:center;gap:10px"><span class="btn lg primary">${I('Copy', 16, 'bold')}Copiar imagem</span><span class="btn lg secondary">${I('DownloadSimple', 16, 'bold')}Salvar</span></div>
      <div class="abs t3" style="left:0;right:0;top:646px;text-align:center;font-size:12px">Cola em qualquer conversa do Alga.</div>
      <div class="abs row t2" style="left:0;right:0;bottom:36px;justify-content:center;gap:10px"><span class="vdot" style="box-shadow:0 0 0 3px #0f1011, 0 0 0 4.5px rgba(139,142,247,.55)"></span>A chamada continua em <b style="font-weight:510;color:var(--text-primary)">Sexta do filme</b></div>`,
    )
  }

  const SCREENS = {
    '01-chamada-cartao': s01, '02-ficha': s02, '03-foyer': s03, '04-foyer-vazio': s04, '05-assistindo-ui': s05,
    '06-assistindo-limpo': s06, '07-pausa': s07, '08-esperando': s08, '09-intervalo': s09, '10-proximo-episodio': s10, '11-canhoto': s11,
  }
  const name = new URLSearchParams(location.search).get('screen') ?? '01-chamada-cartao'
  document.title = `Sala de Cinema · ${name}`
  document.body.innerHTML = SCREENS[name]()
})()
