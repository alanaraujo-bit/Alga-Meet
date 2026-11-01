// A água global do nível A: um canvas fixo atrás da página inteira (OGL / WebGL).
// A água é renderizada a 0,5× (é luz difusa) e composta em resolução cheia; frondes e partículas vão por cima, nítidas.
// Pausa com a aba escondida; `dispose()` solta tudo.
import { Renderer, Camera, Transform, Program, Mesh, Triangle, Geometry, Texture, RenderTarget } from 'ogl';
import { fullVert, waterFrag, compositeFrag, particleVert, particleFrag, bladeVert, bladeFrag } from './shaders';

// Encosto v2 final (apps/desktop/build/brand/web/mark.svg, viewBox 75 24 105.2 208.2): formas exatas.
const WHITE = 'M106 24C113 24 118 31 121 40C127 58 129 84 126 108C123 132 117 150 117 176C117 198 121 214 123 222C125 229 122 233 117 232C108 230 98 222 91 210C80 192 75 168 75 142C75 108 84 78 94 50C97.5 40.2 99 24 106 24Z';
const INDIGO = 'M160 78C166 78 169.6 85.6 172 92C178 108 181 124 180 142C179 166 171 186 158 202C150 212 144 220 140 225C137 229 132 228 132 223C131 204 133 172 137 150C141 126 146 104 151 90C153.3 83.6 155 78 160 78Z';
// Área da máscara em coordenadas do SVG (com folga para o desfoque da espessura).
const MX0 = 62, MX1 = 194, MY0 = 12, MY1 = 244;
const MARK_H = 208.2;

type V4 = { x: number; y: number; r: number; i: number };
export type WaterState = { depth: number; rays: number; tint: [number, number, number]; surface: number; horizon: number; pool: V4; objA: V4; objB: V4 };
const v4 = (o: V4) => [o.x, o.y, o.r, o.i];

function maskTexture(): HTMLCanvasElement {
  const s = 5;
  const c = document.createElement('canvas');
  c.width = Math.round((MX1 - MX0) * s);
  c.height = Math.round((MY1 - MY0) * s);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.setTransform(s, 0, 0, s, -MX0 * s, -MY0 * s);
  g.globalCompositeOperation = 'lighter';
  // B = "espessura" (máscara desfocada): o meio da fronde acende, a borda escurece.
  // O desfoque roda numa tela 4× menor (o filtro de canvas é caro) e sobe ampliado: o resultado é o mesmo borrão.
  const q = 4, bc = document.createElement('canvas');
  bc.width = Math.ceil(c.width / q); bc.height = Math.ceil(c.height / q);
  const bg = bc.getContext('2d')!;
  bg.setTransform(s / q, 0, 0, s / q, (-MX0 * s) / q, (-MY0 * s) / q);
  bg.filter = `blur(${26 / q}px)`;
  bg.fillStyle = '#0000ff';
  bg.fill(new Path2D(WHITE));
  bg.fill(new Path2D(INDIGO));
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingQuality = 'high'; g.drawImage(bc, 0, 0, c.width, c.height); g.restore();
  g.fillStyle = '#ff0000';
  g.fill(new Path2D(WHITE));
  g.fillStyle = '#00ff00';
  g.fill(new Path2D(INDIGO));
  return c;
}

// Tira vertical cobrindo a caixa da fronde; posições relativas à base (pivô), altura h ∈ [0,1].
function bladeGeometry(gl: any, box: [number, number, number, number], pivot: [number, number], unit: number) {
  const [x0, y0, x1, y1] = box;
  const rows = 56;
  const pos: number[] = [], tex: number[] = [], hh: number[] = [], idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const my = y1 - ((y1 - y0) * r) / rows;
    for (const mx of [x0, x1]) {
      pos.push((mx - pivot[0]) * unit, (pivot[1] - my) * unit, 0);
      tex.push((mx - MX0) / (MX1 - MX0), (my - MY0) / (MY1 - MY0));
      hh.push(r / rows);
    }
    if (r < rows) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  return new Geometry(gl, {
    position: { size: 3, data: new Float32Array(pos) },
    tex: { size: 2, data: new Float32Array(tex) },
    h: { size: 1, data: new Float32Array(hh) },
    index: { data: new Uint16Array(idx) },
  });
}

export class World {
  canvas: HTMLCanvasElement;
  private renderer: any;
  private gl: any;
  private camera: any;
  private scene: any;
  private fsScene: any;
  private water: any;
  private composite: any;
  private target: any;
  private particles: any;
  private blades: { mesh: any; prog: any }[] = [];
  private bladeGroup: any;
  private raf = 0;
  private running = false;
  private t0 = performance.now();
  private ripIdx = 0;
  private mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, on: 0, ton: 0 };
  private lastRip = { x: 0, y: 0, t: 0 };
  private intro = 0;
  private onResize = () => this.resize();
  private onVis = () => (document.hidden ? this.stop() : this.start());
  private onMove = (e: PointerEvent) => this.pointer(e);
  /** Parâmetros ligados à rolagem (escritos de fora pelo roteiro). */
  cam = { z: 6, y: 0, x: 0 };
  blade = { grow: [0, 0], lean: 1, fade: 1, glow: 0, x: 0, y: 0, scale: 1, bend: 0 };
  state: WaterState = {
    depth: 0, rays: 1, tint: [0.26, 0.32, 0.86], surface: 0, horizon: 0.36,
    pool: { x: 0.5, y: -0.15, r: 1, i: 0 }, objA: { x: 0, y: 0, r: 0, i: 0 }, objB: { x: 0, y: 0, r: 0, i: 0 },
  };
  scroll = 0;
  flow = 0;
  /** sedimento: x, y (fração da tela, y para cima) e quantidade */
  dust = { x: 0.5, y: 0.1, a: 0 };
  /** frondes presas a um ponto da tela (dentro da bolha): x, y (y para cima) e altura em fração da tela */
  bladeAt: { x: number; y: number; h: number } | null = null;
  onFrame?: (t: number) => void;

  constructor() {
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    this.renderer = new Renderer({ dpr, alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
    const gl = (this.gl = this.renderer.gl);
    this.canvas = gl.canvas;
    this.canvas.className = 'world';
    this.canvas.setAttribute('aria-hidden', 'true');
    gl.clearColor(0.04, 0.04, 0.05, 1);

    this.camera = new Camera(gl, { fov: 35, near: 0.1, far: 60 });
    this.scene = new Transform();
    this.fsScene = new Transform();

    const tri = new Triangle(gl);
    this.target = new RenderTarget(gl, { width: 2, height: 2, depth: false });
    const rip = Array.from({ length: 6 }, () => [0, 0, -10, 0]);
    this.water = new Program(gl, {
      vertex: fullVert, fragment: waterFrag, depthTest: false, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uAspect: { value: 1 }, uDepth: { value: 0 }, uRays: { value: 1 }, uIntro: { value: 0 },
        uSurface: { value: 0 }, uFlow: { value: 0 }, uTint: { value: [0.26, 0.32, 0.86] }, uBed: { value: [0.5, 0, 0] }, uDust: { value: [0.5, 0, 0] }, uHorizon: { value: 0.36 },
        uMouse: { value: [0.5, 0.5] }, uMouseOn: { value: 0 }, uRip: { value: rip.flat() },
        uPool: { value: [0.5, -0.15, 1, 0] }, uObjA: { value: [0, 0, 0, 0] }, uObjB: { value: [0, 0, 0, 0] },
      },
    });
    this.water.ripples = rip;
    const waterMesh = new Mesh(gl, { geometry: tri, program: this.water });
    waterMesh.setParent(this.fsScene);
    this.composite = new Mesh(gl, {
      geometry: tri,
      program: new Program(gl, { vertex: fullVert, fragment: compositeFrag, depthTest: false, depthWrite: false, uniforms: { tWater: { value: this.target.texture }, uTime: { value: 0 } } }),
    });

    // Frondes do Encosto
    this.bladeGroup = new Transform();
    this.bladeGroup.setParent(this.scene);
    const mask = new Texture(gl, { image: maskTexture(), generateMipmaps: false, flipY: false, minFilter: gl.LINEAR, magFilter: gl.LINEAR });
    const unit = 3.1 / MARK_H;
    const defs = [
      { box: [72, 22, 132, 235] as [number, number, number, number], pivot: [117, 232] as [number, number], color: [0.93, 0.94, 0.98], ch: 0, phase: 0 },
      { box: [128, 76, 184, 231] as [number, number, number, number], pivot: [135, 227] as [number, number], color: [0.55, 0.56, 0.97], ch: 1, phase: 1.7 },
    ];
    for (const d of defs) {
      const prog = new Program(gl, {
        vertex: bladeVert, fragment: bladeFrag, transparent: true, depthTest: false, depthWrite: false, cullFace: null,
        uniforms: {
          tMask: { value: mask }, uTime: { value: 0 }, uGrow: { value: 0 }, uChannel: { value: d.ch }, uFade: { value: 1 },
          uGlow: { value: 0 }, uColor: { value: d.color }, uPhase: { value: d.phase }, uBend: { value: 0 }, uHeight: { value: 3.1 * ((d.box[3] - d.box[1]) / MARK_H) },
        },
      });
      prog.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const mesh = new Mesh(gl, { geometry: bladeGeometry(gl, d.box, d.pivot, unit), program: prog });
      mesh.position.set((d.pivot[0] - 127.6) * unit, (232.2 - d.pivot[1]) * unit, 0);
      mesh.setParent(this.bladeGroup);
      this.blades.push({ mesh, prog });
    }

    // Plâncton de luz
    const N = matchMedia('(max-width: 760px)').matches ? 420 : 760;
    const pos = new Float32Array(N * 3), rnd = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      pos.set([(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 10, -9 + Math.random() * 13], i * 3);
      rnd.set([Math.random(), Math.random(), Math.random(), Math.random() ** 2], i * 4);
    }
    const pProg = new Program(gl, {
      vertex: particleVert, fragment: particleFrag, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uFocus: { value: 6 }, uScroll: { value: 0 }, uIntro: { value: 0 } },
    });
    pProg.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.particles = new Mesh(gl, { mode: gl.POINTS, geometry: new Geometry(gl, { position: { size: 3, data: pos }, rnd: { size: 4, data: rnd } }), program: pProg });

    document.body.prepend(this.canvas);
    this.resize();
    addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVis);
    if (matchMedia('(pointer: fine)').matches) addEventListener('pointermove', this.onMove, { passive: true });
  }

  /** Anel na água (cursor, clique). x,y em fração da viewport, y para baixo. */
  ripple(x: number, y: number, strength = 1) {
    const r = this.water.ripples[this.ripIdx++ % 6];
    r[0] = x; r[1] = 1 - y; r[2] = this.time(); r[3] = strength;
  }

  private pointer(e: PointerEvent) {
    const x = e.clientX / innerWidth, y = e.clientY / innerHeight;
    this.mouse.tx = x; this.mouse.ty = 1 - y; this.mouse.ton = 1;
    const now = this.time();
    const d = Math.hypot((x - this.lastRip.x) * innerWidth, (y - this.lastRip.y) * innerHeight);
    if (d > 90 && now - this.lastRip.t > 0.18) { this.ripple(x, y, 0.35); this.lastRip = { x, y, t: now }; }
  }

  time() { return (performance.now() - this.t0) / 1000; }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.target.setSize(Math.max(2, Math.round(w * 0.5)), Math.max(2, Math.round(h * 0.5)));
    this.camera.perspective({ aspect: w / h });
    this.water.uniforms.uAspect.value = w / h;
    this.particles.program.uniforms.uPx.value = h * this.renderer.dpr * 0.5;
    // Frondes: à direita no desktop (texto à esquerda), centradas e menores no celular.
    const narrow = w / h < 1;
    const vh = 2 * 6 * Math.tan((35 * Math.PI) / 360);
    this.layout = narrow
      ? { x: vh * (w / h) * 0.18, y: -vh / 2 + 0.04, s: (vh * 0.3) / 3.1 }
      : { x: (vh / 2) * (w / h) * 0.46, y: -vh / 2 + 0.16, s: (vh * 0.7) / 3.1 };
  }
  layout = { x: 0, y: 0, s: 1 };

  start() {
    if (this.running || document.hidden) return;
    this.running = true;
    const loop = () => { if (!this.running) return; this.frame(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private frame() {
    const t = this.time();
    this.onFrame?.(t);
    this.intro = Math.min(1, this.intro + 0.012);
    const ease = 1 - Math.pow(1 - this.intro, 3);
    const m = this.mouse;
    m.x += (m.tx - m.x) * 0.06; m.y += (m.ty - m.y) * 0.06; m.on += (m.ton - m.on) * 0.04;

    const s = this.state, u = this.water.uniforms;
    u.uTime.value = t; u.uIntro.value = ease; u.uDepth.value = s.depth; u.uRays.value = s.rays; u.uTint.value = s.tint;
    u.uSurface.value = s.surface; u.uHorizon.value = s.horizon; u.uPool.value = v4(s.pool); u.uObjA.value = v4(s.objA); u.uObjB.value = v4(s.objB);
    // leito sob as frondes: projeta a base do grupo na tela
    const bx = 0.5 + (this.layout.x + this.blade.x) / ((2 * this.cam.z * Math.tan((35 * Math.PI) / 360)) * (innerWidth / innerHeight));
    const by = 0.5 + (this.layout.y + this.blade.y) / (2 * this.cam.z * Math.tan((35 * Math.PI) / 360));
    u.uBed.value = [bx, by, this.bladeAt ? 0 : this.blade.fade * ease];
    u.uDust.value = [this.dust.x, this.dust.y, this.dust.a];
    u.uMouse.value = [m.x, m.y]; u.uMouseOn.value = m.on; u.uFlow.value = this.flow;
    u.uRip.value = this.water.ripples.flat();
    this.renderer.render({ scene: this.fsScene, target: this.target, clear: false });

    this.camera.position.set(this.cam.x, this.cam.y, this.cam.z);
    this.camera.lookAt([this.cam.x * 0.6, this.cam.y * 0.6, 0]);
    this.composite.program.uniforms.uTime.value = t % 10;

    const b = this.blade, L = this.layout;
    if (this.bladeAt) {
      // de fração da tela para o plano z = 0 visto pela câmera atual
      const H = 2 * this.cam.z * Math.tan((35 * Math.PI) / 360), A = innerWidth / innerHeight;
      const mh = this.bladeAt.h * H;
      this.bladeGroup.position.set(this.cam.x * 0.6 + (this.bladeAt.x - 0.5) * H * A, this.cam.y * 0.6 + (this.bladeAt.y - 0.5) * H - mh / 2, 0);
      this.bladeGroup.scale.set(mh / 3.1);
    } else {
      this.bladeGroup.position.set(L.x + b.x, L.y + b.y, 0);
      this.bladeGroup.scale.set(L.s * b.scale);
    }
    this.blades.forEach(({ mesh, prog }, i) => {
      const pu = prog.uniforms;
      pu.uTime.value = t; pu.uGrow.value = b.grow[i]; pu.uFade.value = b.fade * ease; pu.uGlow.value = b.glow; pu.uBend.value = b.bend;
      // A índigo começa afastada e se inclina até encostar (lean 1 → 0).
      if (i === 1) { mesh.rotation.z = -0.42 * b.lean; mesh.position.x = (135 - 127.6) * (3.1 / MARK_H) + 0.28 * b.lean; }
    });
    const pu = this.particles.program.uniforms;
    pu.uTime.value = t; pu.uScroll.value = this.scroll; pu.uIntro.value = ease * (1 - s.surface * 0.85); pu.uFocus.value = this.cam.z;

    this.renderer.render({ scene: this.composite, clear: false });
    this.renderer.render({ scene: this.scene, camera: this.camera, clear: false, frustumCull: false });
    this.renderer.render({ scene: this.particles, camera: this.camera, clear: false, frustumCull: false });
  }

  dispose() {
    this.stop();
    removeEventListener('resize', this.onResize);
    removeEventListener('pointermove', this.onMove);
    document.removeEventListener('visibilitychange', this.onVis);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
  }
}
