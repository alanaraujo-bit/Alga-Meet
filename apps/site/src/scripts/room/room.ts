// A sala (momento 2, nível A): cinco amigos em roda sobre um chão líquido. Quem fala manda ondas de luz pelo chão.
// O shader lê o envelope de fala de cada um ATRASADO pela distância (t − r/c): a onda viaja junto com a fala.
import { Renderer, Camera, Transform, Program, Mesh, Plane, Geometry, Texture } from 'ogl';
import { people, envelopes, T } from '../../data/conversation';

const N = 1024;          // amostras do envelope
const R = 2.15;          // raio da roda
const C = 2.4;           // velocidade da onda (unidades/s)

const floorVert = /* glsl */ `
attribute vec3 position;
attribute vec2 uv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

const floorFrag = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform sampler2D tEnv;
uniform float uT, uTime, uReveal, uImpact, uT0;
uniform vec3 uCam;
uniform vec2 uPos[5];
uniform vec3 uCol[5];
const float C = ${C.toFixed(2)};
const float TT = ${T.toFixed(2)};
float env(int i, float t) {
  if (t < 0.0 || t > TT) return 0.0;
  return texture2D(tEnv, vec2(t / TT, (float(i) + 0.5) / 8.0)).r;
}
void main() {
  vec2 p = vW.xz;
  vec2 grad = vec2(0.0);
  float crest = 0.0;
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    vec2 d = p - uPos[i];
    float r = length(d) + 1e-4;
    float e = env(i, uT - (r - 0.32) / C);
    float fall = 1.0 / (1.0 + r * 0.9);
    float ph = r * 10.0 - uTime * 10.0 * C * 0.55;
    float amp = e * fall * smoothstep(0.3, 0.42, r);
    grad += (d / r) * cos(ph) * amp;
    crest += pow(max(sin(ph), 0.0), 4.0) * amp;
    float now = env(i, uT);
    glow += uCol[i] * exp(-r * r * 3.2) * (0.06 + now * 0.5);
  }
  // onda de chegada (a gota que acende o chão)
  float rc = length(p);
  float front = uImpact * 3.4;
  float ring = exp(-pow((rc - front) * 3.5, 2.0)) * (1.0 - smoothstep(4.0, 9.0, front)) * step(0.001, uImpact);
  grad += normalize(p + 1e-4) * cos(rc * 9.0 - front * 9.0) * ring * 0.9;
  crest += ring * 0.7;

  vec3 n = normalize(vec3(-grad.x * 0.55, 1.0, -grad.y * 0.55));
  vec3 v = normalize(uCam - vW);
  // céu da sala: escuro, com uma luz índigo larga lá em cima
  vec3 rd = reflect(-v, n);
  float sky = pow(max(rd.y, 0.0), 3.0);
  vec3 refl = vec3(0.02, 0.022, 0.05) + vec3(0.32, 0.34, 0.8) * pow(max(dot(rd, normalize(vec3(0.2, 1.0, -0.3))), 0.0), 40.0) * 0.8 + vec3(0.1, 0.11, 0.3) * sky * 0.4;
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 col = vec3(0.008, 0.008, 0.014) + refl * fres * 1.4;
  col += glow;
  col += vec3(0.55, 0.57, 1.0) * crest * 0.95;
  // névoa: a sala termina no escuro
  float dist = length(vW - uCam);
  float fog = smoothstep(5.5, 13.0, length(p) + dist * 0.15);
  col = mix(col, vec3(0.004, 0.004, 0.008), fog);
  // a sala só existe onde a primeira onda já passou
  col *= 1.0 - smoothstep(uReveal - 1.2, uReveal, rc);
  gl_FragColor = vec4(col, 1.0);
}
`;

const avVert = /* glsl */ `
attribute vec2 position;
attribute float idx;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uRight, uUp;
uniform vec2 uPos[5];
uniform float uLift, uSize;
varying vec2 vUv;
varying float vI;
void main() {
  int i = int(idx);
  vec2 c = uPos[0];
  if (i == 1) c = uPos[1]; else if (i == 2) c = uPos[2]; else if (i == 3) c = uPos[3]; else if (i == 4) c = uPos[4];
  vec3 w = vec3(c.x, uLift, c.y) + (uRight * position.x + uUp * position.y) * uSize;
  vUv = position * 0.5 + 0.5;
  vI = idx;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const avFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vI;
uniform sampler2D tAtlas, tEnv;
uniform float uT, uTime, uReveal;
uniform vec2 uPos[5];
const float TT = ${T.toFixed(2)};
void main() {
  int i = int(vI + 0.5);
  float e = (uT < 0.0 || uT > TT) ? 0.0 : texture2D(tEnv, vec2(uT / TT, (vI + 0.5) / 8.0)).r;
  vec2 q = vUv - 0.5;
  float d = length(q);
  vec4 face = texture2D(tAtlas, vec2((vI + vUv.x) / 5.0, 1.0 - vUv.y));
  // anel de fala do app: 2 px índigo + borda macia, aqui com brilho
  float ring = (1.0 - smoothstep(0.0, 0.014, abs(d - 0.405))) * e;
  float halo = exp(-max(d - 0.4, 0.0) * 18.0) * step(0.39, d) * (1.0 - smoothstep(0.42, 0.5, d)) * e * 0.55;
  vec3 col = face.rgb * face.a + vec3(0.62, 0.64, 1.0) * (ring * 1.4 + halo);
  float a = max(face.a, max(ring, halo));
  vec2 c = uPos[0];
  if (i == 1) c = uPos[1]; else if (i == 2) c = uPos[2]; else if (i == 3) c = uPos[3]; else if (i == 4) c = uPos[4];
  float shown = smoothstep(length(c) + 0.2, length(c) + 0.9, uReveal);
  gl_FragColor = vec4(col * shown, a * shown);
}
`;

const dropVert = /* glsl */ `
attribute vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uY, uPx;
void main() { vec4 mv = viewMatrix * vec4(0.0, uY, 0.0, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx / -mv.z; }
`;
const dropFrag = /* glsl */ `
precision highp float;
uniform float uOn;
void main() { float d = length(gl_PointCoord - 0.5); float a = exp(-d * d * 60.0) + exp(-d * 9.0) * 0.4; gl_FragColor = vec4(vec3(0.82, 0.84, 1.0) * a * uOn, a * uOn); }
`;

function atlas(): HTMLCanvasElement {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s * 5; c.height = s;
  const g = c.getContext('2d')!;
  people.forEach((p, i) => {
    const x = i * s + s / 2, y = s / 2, r = s * 0.36;
    const lg = g.createLinearGradient(x - r, y - r, x + r, y + r);
    lg.addColorStop(0, p.grad[0]); lg.addColorStop(1, p.grad[1]);
    g.fillStyle = lg;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    // brilho de cima, como as bolinhas do app
    const sh = g.createRadialGradient(x - r * 0.35, y - r * 0.45, 0, x, y, r);
    sh.addColorStop(0, 'rgba(255,255,255,0.28)'); sh.addColorStop(0.6, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (p.initials) {
      g.fillStyle = 'rgba(247,248,248,0.92)';
      g.font = `600 ${Math.round(r * 0.72)}px 'Inter Variable', system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(p.initials, x, y + 2);
    }
  });
  return c;
}

export class Room {
  private renderer: any;
  private gl: any;
  private camera: any;
  private scene: any;
  private floor: any;
  private avatars: any;
  private drop: any;
  private raf = 0;
  private running = false;
  private t0 = performance.now();
  private pos: number[] = [];
  canvas: HTMLCanvasElement;
  /** escrito de fora: tempo da conversa, revelação, câmera */
  t = -1;
  reveal = 0;
  impact = 0;
  dropY = 6;
  dropOn = 0;
  azimuth = 0;
  elev = 0.62;
  dist = 7.2;
  /** desloca o alvo da câmera para perto dela: a roda sobe na tela e deixa a legenda livre embaixo */
  shift = 0.9;
  onFrame?: () => void;

  constructor(host: HTMLElement) {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.renderer = new Renderer({ dpr, alpha: false, antialias: true, powerPreference: 'high-performance' });
    const gl = (this.gl = this.renderer.gl);
    this.canvas = gl.canvas;
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    gl.clearColor(0.004, 0.004, 0.008, 1);
    this.camera = new Camera(gl, { fov: 32, near: 0.1, far: 60 });
    this.scene = new Transform();

    // envelopes → textura (5 linhas úteis de 8)
    const env = envelopes(N);
    const data = new Uint8Array(N * 8 * 4);
    env.forEach((row, y) => row.forEach((v, x) => { const o = (y * N + x) * 4; data[o] = data[o + 1] = data[o + 2] = Math.min(255, v * 255); data[o + 3] = 255; }));
    const tEnv = new Texture(gl, { image: data, width: N, height: 8, generateMipmaps: false, flipY: false, minFilter: gl.LINEAR, magFilter: gl.LINEAR, wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE });

    people.forEach((_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      this.pos.push(Math.cos(a) * R, Math.sin(a) * R);
    });
    const cols = people.flatMap((p) => { const h = p.grad[0]; return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; });

    this.floor = new Mesh(gl, {
      geometry: new Plane(gl, { width: 30, height: 30 }),
      program: new Program(gl, {
        vertex: floorVert, fragment: floorFrag,
        uniforms: { tEnv: { value: tEnv }, uT: { value: 0 }, uTime: { value: 0 }, uReveal: { value: 0 }, uImpact: { value: 0 }, uT0: { value: 0 }, uCam: { value: [0, 4, 7] }, uPos: { value: this.pos }, uCol: { value: cols } },
      }),
    });
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.setParent(this.scene);

    const quad = new Float32Array(5 * 4 * 2), idx = new Float32Array(5 * 4), ind: number[] = [];
    for (let i = 0; i < 5; i++) {
      quad.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      idx.set([i, i, i, i], i * 4);
      ind.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    }
    const tAtlas = new Texture(gl, { image: atlas(), generateMipmaps: true, flipY: false });
    const avProg = new Program(gl, {
      vertex: avVert, fragment: avFrag, transparent: true, depthTest: true, depthWrite: false, cullFace: null,
      uniforms: { tAtlas: { value: tAtlas }, tEnv: { value: tEnv }, uT: { value: 0 }, uTime: { value: 0 }, uReveal: { value: 0 }, uPos: { value: this.pos }, uRight: { value: [1, 0, 0] }, uUp: { value: [0, 1, 0] }, uLift: { value: 0.4 }, uSize: { value: 0.36 } },
    });
    avProg.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.avatars = new Mesh(gl, { geometry: new Geometry(gl, { position: { size: 2, data: quad }, idx: { size: 1, data: idx }, index: { data: new Uint16Array(ind) } }), program: avProg, frustumCulled: false });
    this.avatars.setParent(this.scene);

    const dropProg = new Program(gl, { vertex: dropVert, fragment: dropFrag, transparent: true, depthTest: false, depthWrite: false, uniforms: { uY: { value: 6 }, uPx: { value: 400 }, uOn: { value: 0 } } });
    dropProg.setBlendFunc(gl.ONE, gl.ONE);
    this.drop = new Mesh(gl, { mode: gl.POINTS, geometry: new Geometry(gl, { position: { size: 3, data: new Float32Array([0, 0, 0]) } }), program: dropProg, frustumCulled: false });
    this.drop.setParent(this.scene);

    this.resize();
    addEventListener('resize', this.resize);
  }

  resize = () => {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height);
    this.camera.perspective({ aspect: r.width / r.height, fov: r.width < r.height ? 46 : 32 });
    this.drop.program.uniforms.uPx.value = r.height * this.renderer.dpr * 0.9;
  };

  /** Posição (px no canvas) logo abaixo de cada avatar, para os nomes em HTML. */
  screen(i: number): [number, number] {
    const mul = (M: number[], x: number[]) => [0, 1, 2, 3].map((r) => M[r] * x[0] + M[4 + r] * x[1] + M[8 + r] * x[2] + M[12 + r] * x[3]);
    const c = mul(this.camera.projectionMatrix, mul(this.camera.viewMatrix, [this.pos[i * 2], 0.06, this.pos[i * 2 + 1], 1]));
    return [((c[0] / c[3]) * 0.5 + 0.5) * this.canvas.clientWidth, (0.5 - (c[1] / c[3]) * 0.5) * this.canvas.clientHeight];
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => { if (!this.running) return; this.frame(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private frame() {
    const time = (performance.now() - this.t0) / 1000;
    this.onFrame?.();
    const az = this.azimuth, el = this.elev, d = this.dist;
    const cam = [Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d];
    this.camera.position.set(cam[0], cam[1], cam[2]);
    this.camera.lookAt([Math.sin(az) * this.shift, 0.1, Math.cos(az) * this.shift]);
    this.camera.updateMatrixWorld();
    const m = this.camera.worldMatrix;
    const fu = this.floor.program.uniforms;
    fu.uT.value = this.t; fu.uTime.value = time; fu.uReveal.value = this.reveal; fu.uImpact.value = this.impact; fu.uCam.value = cam;
    const au = this.avatars.program.uniforms;
    au.uT.value = this.t; au.uTime.value = time; au.uReveal.value = this.reveal;
    au.uRight.value = [m[0], m[1], m[2]]; au.uUp.value = [m[4], m[5], m[6]];
    const du = this.drop.program.uniforms;
    du.uY.value = this.dropY; du.uOn.value = this.dropOn;
    this.renderer.render({ scene: this.scene, camera: this.camera });
  }

  dispose() {
    this.stop();
    removeEventListener('resize', this.resize);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
  }
}
