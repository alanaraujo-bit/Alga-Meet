// "The film": original placeholder imagery drawn in SVG (no real stills, posters or logos).
// scene(variant, id) returns an <svg> in a 2.39:1 frame (2390×1000); CSS crops it with object-fit / slice.
// Variants: dusk (the cover and the main shots), night (the most-reacted moment), storm (a later chapter), banquet (next episode).
;(function () {
  const W = 2390
  const crest = {
    far: 'M0 742 C220 724 420 694 640 704 C820 712 940 738 1120 732 C1300 726 1440 698 1640 694 C1840 690 2060 718 2390 708',
    mid: 'M0 850 C260 820 520 770 780 758 C960 750 1100 772 1240 760 C1330 752 1380 722 1420 714 C1470 706 1560 732 1700 762 C1900 804 2150 806 2390 796',
    near: 'M0 934 C300 904 700 884 1000 906 C1200 922 1350 960 1500 1000',
    nearR: 'M1720 1000 C1900 952 2150 924 2390 918',
  }
  const close = (d) => d + ` L${W} 1000 L0 1000 Z`
  const closeL = (d) => d + ' L0 1000 Z'
  const mesa =
    'M0 712 L0 690 C200 682 330 686 420 674 L470 656 L700 654 L745 674 C900 682 1080 684 1250 690 C1500 698 1900 676 2050 678 L2100 662 L2260 660 L2300 680 C2340 684 2370 686 2390 686 L2390 712 Z'
  const slip = 'M1420 714 C1408 780 1392 880 1372 1000 L1960 1000 C1840 890 1620 780 1420 714 Z'
  const ripples = ['M60 968 C380 942 700 928 990 946', 'M140 990 C420 968 690 958 940 972', 'M1820 990 C1980 960 2200 944 2390 942']
  // A cloaked walker with a staff, feet at (0,0), ~42 units tall.
  const walker = (x, y, s, fill, rot = 0) => `
    <g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" fill="${fill}">
      <circle cx="0" cy="-37" r="4.6"/>
      <path d="M-3.5 -33 C-8.5 -25 -11 -11 -12.5 0 L11 0 C10 -10 7.5 -24 3.5 -33 Z"/>
      <path d="M3 -31 C10 -27 17 -16 22 -3 C17 -6 13 -8 9 -9 Z"/>
      <path d="M-9.5 -47 L-13.5 0" stroke="${fill}" stroke-width="1.8" stroke-linecap="round"/>
    </g>`

  const P = {
    dusk: {
      sky: [['0', '#121625'], ['.28', '#272840'], ['.5', '#5d4458'], ['.62', '#a96b5c'], ['.69', '#e2a271'], ['.72', '#f0bd86']],
      sun: { cx: 1600, cy: 668, r: 74, fill: '#f8e2bd', halo: '#f3b98a', haloO: 0.42 },
      mesa: '#86595f', mesaO: 0.62,
      far: ['#8a5048', '#3e2529'], mid: ['#4a2a2f', '#1d1317'], slip: '#140d10', near: '#0f0a0c',
      rim: '#ffcf9a', haze: 'rgba(240,170,120,.26)', stars: 0.35, figure: '#0d0809',
      figures: [[1420, 715, 1.05, 0], [1486, 731, 0.9, 0]],
    },
    night: {
      sky: [['0', '#05070f'], ['.35', '#0d1428'], ['.6', '#1c2945'], ['.7', '#33456a']],
      sun: { cx: 640, cy: 250, r: 44, fill: '#e3e8f1', halo: '#9fb2d8', haloO: 0.22 },
      mesa: '#2b3854', mesaO: 0.7,
      far: ['#2c3a58', '#141c2e'], mid: ['#1a2236', '#0b0f19'], slip: '#070a12', near: '#05070c',
      rim: '#c9d6f0', haze: 'rgba(120,140,190,.16)', stars: 0.9, figure: '#04050a',
      figures: [[1300, 742, 1, 0], [1352, 770, 0.95, 30]],
    },
    storm: {
      sky: [['0', '#3a2a24'], ['.4', '#7a5240'], ['.62', '#b98458'], ['.72', '#d6a272']],
      sun: { cx: 2010, cy: 560, r: 60, fill: '#f2d6aa', halo: '#e6b07c', haloO: 0.3 },
      mesa: '#9a6c50', mesaO: 0.35,
      far: ['#a07050', '#6a4434'], mid: ['#6a4232', '#3a241c'], slip: '#2a1913', near: '#20140f',
      rim: '#f1c592', haze: 'rgba(225,170,120,.4)', stars: 0, figure: '#22150f',
      figures: [[1420, 715, 1.05, 8], [1490, 732, 0.9, 10]],
      wall: true,
    },
  }

  function stars(id, o) {
    if (!o) return ''
    let s = ''
    let seed = 7
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W
      const y = rnd() * 420
      const r = 0.6 + rnd() * 1.4
      s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" opacity="${(o * (0.25 + rnd() * 0.75) * (1 - y / 520)).toFixed(2)}"/>`
    }
    return s
  }

  function landscape(v, id) {
    const p = P[v]
    const g = (n) => `${id}-${n}`
    const sky = p.sky.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
    return `
    <svg viewBox="0 0 ${W} 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${g('sky')}" x1="0" y1="0" x2="0" y2="1">${sky}</linearGradient>
        <radialGradient id="${g('halo')}" cx="${p.sun.cx}" cy="${p.sun.cy}" r="620" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${p.sun.halo}" stop-opacity="${p.sun.haloO}"/><stop offset=".35" stop-color="${p.sun.halo}" stop-opacity="${p.sun.haloO * 0.35}"/><stop offset="1" stop-color="${p.sun.halo}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="${g('far')}" x1="0" y1="690" x2="0" y2="1000" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.far[0]}"/><stop offset="1" stop-color="${p.far[1]}"/></linearGradient>
        <linearGradient id="${g('mid')}" x1="0" y1="710" x2="0" y2="1000" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.mid[0]}"/><stop offset="1" stop-color="${p.mid[1]}"/></linearGradient>
        <linearGradient id="${g('rim')}" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${p.rim}" stop-opacity=".08"/><stop offset="${(p.sun.cx / W).toFixed(2)}" stop-color="${p.rim}" stop-opacity=".95"/><stop offset="1" stop-color="${p.rim}" stop-opacity=".15"/>
        </linearGradient>
        <linearGradient id="${g('slip')}" x1="0" y1="714" x2="0" y2="1000" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.slip}" stop-opacity=".75"/><stop offset="1" stop-color="${p.slip}" stop-opacity=".05"/></linearGradient>
        <linearGradient id="${g('haze')}" x1="0" y1="560" x2="0" y2="820" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.haze}" stop-opacity="0"/><stop offset=".5" stop-color="${p.haze}"/><stop offset="1" stop-color="${p.haze}" stop-opacity="0"/></linearGradient>
        <radialGradient id="${g('vig')}" cx="50%" cy="48%" r="72%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
        <filter id="${g('soft')}" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>
        <radialGradient id="${g('slipg')}" cx="1440" cy="740" r="420" gradientUnits="userSpaceOnUse" gradientTransform="translate(1440 740) scale(1.1 .75) translate(-1440 -740)"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <mask id="${g('slipm')}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="1000"><rect width="${W}" height="1000" fill="url(#${g('slipg')})"/></mask>
        <filter id="${g('blur')}" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="26"/></filter>
        <filter id="${g('grain')}"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .09"/></feComponentTransfer></filter>
      </defs>
      <rect width="${W}" height="1000" fill="url(#${g('sky')})"/>
      ${stars(id, p.stars)}
      <rect width="${W}" height="1000" fill="url(#${g('halo')})"/>
      <circle cx="${p.sun.cx}" cy="${p.sun.cy}" r="${p.sun.r}" fill="${p.sun.fill}"/>
      <g opacity=".5" filter="url(#${g('blur')})">
        <ellipse cx="${p.sun.cx - 380}" cy="${p.sun.cy - 70}" rx="520" ry="10" fill="${p.rim}" opacity=".35"/>
        <ellipse cx="${p.sun.cx + 260}" cy="${p.sun.cy - 120}" rx="380" ry="8" fill="${p.rim}" opacity=".25"/>
      </g>
      <path d="${mesa}" fill="${p.mesa}" opacity="${p.mesaO}"/>
      <rect y="560" width="${W}" height="260" fill="url(#${g('haze')})"/>
      <path d="${close(crest.far)}" fill="url(#${g('far')})"/>
      <path d="${crest.far}" fill="none" stroke="url(#${g('rim')})" stroke-width="3" opacity=".55" filter="url(#${g('soft')})"/>
      ${p.wall ? `<path d="M1200 1000 C1250 700 1500 420 1900 380 C2150 360 2300 420 2390 470 L2390 1000 Z" fill="#c69467" opacity=".55" filter="url(#${g('blur')})"/>` : ''}
      <path d="${close(crest.mid)}" fill="url(#${g('mid')})"/>
      <path d="${slip}" fill="${p.slip}" opacity=".7" mask="url(#${g('slipm')})"/>
      <ellipse cx="${p.sun.cx}" cy="772" rx="560" ry="46" fill="${p.rim}" opacity=".10" filter="url(#${g('blur')})"/>
      <path d="${crest.mid}" fill="none" stroke="url(#${g('rim')})" stroke-width="4" filter="url(#${g('soft')})"/>
      <path d="${crest.mid}" fill="none" stroke="url(#${g('rim')})" stroke-width="1.4"/>
      ${p.figures.map(([x, y, s, r]) => walker(x, y, s, p.figure, r)).join('')}
      <path d="${closeL(crest.near)}" fill="${p.near}"/>
      <path d="${crest.nearR} L2390 1000 Z" fill="${p.near}"/>
      <path d="${crest.near}" fill="none" stroke="${p.rim}" stroke-width="2" opacity=".18" filter="url(#${g('soft')})"/>
      ${ripples.map((d) => `<path d="${d}" fill="none" stroke="${p.rim}" stroke-width="2" opacity=".05"/>`).join('')}
      <rect width="${W}" height="1000" fill="url(#${g('vig')})"/>
      <rect width="${W}" height="1000" filter="url(#${g('grain')})"/>
    </svg>`
  }

  function banquet(id) {
    const g = (n) => `${id}-${n}`
    let candles = ''
    let heads = ''
    for (let i = 0; i < 7; i++) {
      const t = i / 6
      const y = 560 + t * t * 300
      const spread = 90 + t * t * 470
      for (const side of [-1, 1]) {
        const x = 800 + side * spread * 0.55
        candles += `<circle cx="${x}" cy="${y - 34 - t * 26}" r="${70 + t * 90}" fill="url(#${g('glow')})"/>`
        candles += `<rect x="${x - 2 - t * 2}" y="${y - 26 - t * 24}" width="${4 + t * 4}" height="${22 + t * 22}" fill="#e8d2b0" opacity=".85"/>`
        candles += `<ellipse cx="${x}" cy="${y - 32 - t * 28}" rx="${3 + t * 3}" ry="${6 + t * 6}" fill="#ffd79a"/>`
        const hx = 800 + side * (spread + 30 + t * 50)
        const cw = 26 + t * 46
        const ch = 120 + t * 210
        heads += `<rect x="${hx - cw / 2}" y="${y - ch + 30}" width="${cw}" height="${ch}" rx="${cw / 2}" fill="#0d0907"/>`
        heads += `<ellipse cx="${800 + side * spread * 0.32}" cy="${y + 4}" rx="${10 + t * 22}" ry="${3 + t * 7}" fill="#cdb79a" opacity=".35"/>`
      }
    }
    return `
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${g('wall')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140d0b"/><stop offset="1" stop-color="#2a1a13"/></linearGradient>
        <linearGradient id="${g('win')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2440"/><stop offset="1" stop-color="#4a5b86"/></linearGradient>
        <radialGradient id="${g('glow')}"><stop offset="0" stop-color="#ffb866" stop-opacity=".42"/><stop offset=".4" stop-color="#ff9a4a" stop-opacity=".12"/><stop offset="1" stop-color="#ff9a4a" stop-opacity="0"/></radialGradient>
        <linearGradient id="${g('table')}" x1="0" y1="540" x2="0" y2="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4a3226"/><stop offset="1" stop-color="#7a5236"/></linearGradient>
        <radialGradient id="${g('vig')}" cx="50%" cy="50%" r="75%"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>
        <filter id="${g('grain')}"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .1"/></feComponentTransfer></filter>
      </defs>
      <rect width="1600" height="900" fill="url(#${g('wall')})"/>
      ${[560, 760, 960].map((x) => `<path d="M${x} 470 L${x} 250 A${50} ${50} 0 0 1 ${x + 100} 250 L${x + 100} 470 Z" transform="translate(-50 0)" fill="url(#${g('win')})" opacity=".85"/>`).join('')}
      <path d="M700 545 L900 545 L1380 900 L220 900 Z" fill="url(#${g('table')})"/>
      ${heads}
      ${candles}
      <rect width="1600" height="900" fill="url(#${g('vig')})"/>
      <rect width="1600" height="900" filter="url(#${g('grain')})"/>
    </svg>`
  }

  let n = 0
  window.scene = (variant = 'dusk') => {
    const id = `s${n++}`
    return variant === 'banquet' ? banquet(id) : landscape(variant, id)
  }
})()
