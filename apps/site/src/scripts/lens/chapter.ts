// A lente sobre a transmissão. Nível A: o jogo em WebGL (game.ts) e a lente no shader.
// B e C: duas fotos do mesmo quadro (1080p e 720p) e a lente em CSS (clip-path). C não passeia sozinha.
export async function initLens(tier: 'a' | 'b' | 'c') {
  const frame = document.querySelector<HTMLElement>('[data-lens-host]');
  if (!frame) return;
  const tag = frame.querySelector<HTMLElement>('[data-lens-tag]');
  let game: import('./game').Game | null = null;
  // O jogo (WebGL) só nasce quando a transmissão chega perto da tela: nada disso pesa no carregamento.
  const makeGame = async () => {
    try {
      const { Game } = await import('./game');
      await document.fonts?.ready;
      frame.classList.add('gl'); // antes do Game: ele mede o tamanho do palco
      game = new Game(frame.querySelector<HTMLElement>('[data-game]')!);
      (frame as any).__game = game; // capturas das fotos dos níveis B/C (scripts/game-stills.mjs)
      addEventListener('pagehide', () => game!.dispose(), { once: true });
    } catch { game = null; frame.classList.remove('gl'); }
  };
  let pending: Promise<void> | null = null;
  const pos = { x: 0.3, y: 0.2, tx: 0.3, ty: 0.2 };
  let user = false, idle = 0, raf = 0, visible = false;
  const radius = () => Math.max(64, Math.min(170, frame.clientWidth * 0.12));
  const apply = () => {
    const r = radius();
    if (game) { game.lensX = pos.x; game.lensY = pos.y; game.lensR = r; }
    frame.style.setProperty('--lx', `${pos.x * 100}%`);
    frame.style.setProperty('--ly', `${pos.y * 100}%`);
    frame.style.setProperty('--lr', `${r}px`);
    if (tag) tag.style.transform = `translate(${pos.x * frame.clientWidth}px, ${pos.y * frame.clientHeight + r + 10}px) translateX(-50%)`;
  };
  const move = (e: PointerEvent) => {
    const b = frame.getBoundingClientRect();
    pos.tx = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
    pos.ty = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
    user = true; idle = performance.now();
    if (tier === 'c') { pos.x = pos.tx; pos.y = pos.ty; apply(); }
  };
  frame.addEventListener('pointermove', move);
  frame.addEventListener('pointerdown', move);
  frame.addEventListener('pointerleave', () => { user = false; });

  const tick = (now: number) => {
    // sem ninguém mexendo, a lente passeia pelos detalhes finos (HUD, minimapa, chat)
    if (!user || now - idle > 4000) {
      const t = now / 1000;
      pos.tx = 0.5 + 0.38 * Math.sin(t * 0.37);
      pos.ty = 0.5 + 0.36 * Math.sin(t * 0.61 + 1.2);
    }
    const k = user ? 0.18 : 0.04;
    pos.x += (pos.tx - pos.x) * k; pos.y += (pos.ty - pos.y) * k;
    apply();
    raf = requestAnimationFrame(tick);
  };
  const start = async () => {
    if (tier === 'a' && !game) { pending ??= makeGame(); await pending; if (!visible) return; }
    game?.start();
    if (tier !== 'c') { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }
  };
  const stop = () => { game?.stop(); cancelAnimationFrame(raf); };
  apply();
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible && !document.hidden ? start() : stop(); }, { rootMargin: '400px 0px' }).observe(frame);
  document.addEventListener('visibilitychange', () => (visible && !document.hidden ? start() : stop()));
}
