// "Sua tela, nítida" (nível A): um jogo que a gente mesmo gera — voo baixo por um canal na hora azul — renderizado
// em 1920×1080 (o 1080p) e reduzido para 1280×720 (o 720p, exatamente 2/3). Fora da lente você vê o 720p ampliado;
// dentro dela, o mesmo quadro em 1080p. A cena anda a 30 quadros por segundo (as duas transmissões são 30 fps);
// só a lente roda a 60.
import { Renderer, Camera, Transform, Program, Mesh, Box, Plane, Triangle, Geometry, Texture, RenderTarget } from 'ogl';

const HI = [1920, 1080], LO = [1280, 720];
const LOOP = 160;

const hash = `float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}`;
const SKY = `
vec3 skyCol(float y){
  vec3 top = vec3(0.05, 0.07, 0.2), mid = vec3(0.2, 0.26, 0.62), hor = vec3(0.62, 0.6, 0.95);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, y));
  return mix(c, top, smoothstep(0.18, 0.7, y));
}`;

const skyFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
${hash}
${SKY}
void main(){
  float y = vUv.y - 0.42;
  vec3 c = skyCol(max(y, 0.0));
  c += vec3(0.95, 0.72, 0.8) * 0.25 * exp(-abs(y) * 22.0);
  float s = step(0.998, hash(floor(vUv * vec2(1920.0, 1080.0) / 2.0))) * smoothstep(0.1, 0.4, y);
  c += s * 0.8;
  // lua fina
  vec2 m = (vUv - vec2(0.74, 0.8)) * vec2(1.78, 1.0);
  float moon = (1.0 - smoothstep(0.022, 0.024, length(m))) * smoothstep(0.02, 0.024, length(m - vec2(0.008, 0.004)));
  c += vec3(0.9, 0.92, 1.0) * moon;
  gl_FragColor = vec4(c, 1.0);
}`;
const fullVert = `attribute vec2 position; attribute vec2 uv; varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }`;

const bldVert = /* glsl */ `
attribute vec3 position;
attribute vec3 normal;
attribute vec3 offset;
attribute vec3 scale;
attribute float rnd;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uCamZ;
varying vec3 vN; varying vec3 vW; varying vec3 vL; varying float vR;
void main(){
  vec3 o = offset;
  o.z = uCamZ + 6.0 - mod(uCamZ + 6.0 - o.z, ${LOOP.toFixed(1)});
  vec3 p = position * scale + o + vec3(0.0, scale.y * 0.5, 0.0);
  vL = (position + 0.5) * scale;
  vN = normal; vW = p; vR = rnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const bldFrag = /* glsl */ `
precision highp float;
varying vec3 vN; varying vec3 vW; varying vec3 vL; varying float vR;
uniform vec3 uCam; uniform float uTime;
${hash}
${SKY}
void main(){
  vec2 f = abs(vN.x) > 0.5 ? vL.zy : vL.xy;
  vec2 cell = floor(f / vec2(0.46, 0.62));
  vec2 inC = fract(f / vec2(0.46, 0.62));
  float win = step(0.2, inC.x) * step(inC.x, 0.8) * step(0.22, inC.y) * step(inC.y, 0.8);
  // vR é constante na instância, mas interpolado ele varia no último bit; arredondado, o sorteio fica estável
  float id = floor(vR * 997.0 + 0.5);
  float h = hash(cell + id * 13.0);
  float lit = step(0.58, h) * win * step(1.0, f.y) * step(0.12, vR);
  vec3 wc = h > 0.9 ? vec3(1.0, 0.78, 0.55) : h > 0.7 ? vec3(0.75, 0.78, 1.0) : vec3(0.55, 0.57, 1.0);
  vec3 base = mix(vec3(0.03, 0.035, 0.07), vec3(0.08, 0.09, 0.18), clamp(vN.y, 0.0, 1.0) + 0.25 * step(0.5, abs(vN.z)));
  vec3 c = base + wc * lit * (0.7 + 0.3 * hash(cell * 1.7));
  c += vec3(0.12, 0.13, 0.3) * step(0.5, vN.y);
  float d = length(vW - uCam);
  float fog = smoothstep(18.0, 120.0, d);
  c = mix(c, skyCol(0.02) * 0.85, fog);
  gl_FragColor = vec4(c, 1.0);
}`;

const waterFrag = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform vec3 uCam; uniform float uTime;
${hash}
${SKY}
float n1(float x){ float i = floor(x), f = fract(x); return mix(hash(vec2(i, 3.1)), hash(vec2(i + 1.0, 3.1)), f * f * (3.0 - 2.0 * f)); }
void main(){
  float d = length(vW - uCam);
  // reflexos verticais das janelas, quebrados pelas ondinhas
  float wob = sin(vW.z * 3.0 + uTime * 2.0) * 0.08 + sin(vW.z * 7.3 - uTime * 3.1) * 0.04;
  float sx = vW.x + wob;
  float streak = pow(n1(sx * 9.0), 6.0) * 1.6 + pow(n1(sx * 23.0 + 5.0), 8.0) * 1.2;
  float edge = smoothstep(1.6, 3.2, abs(vW.x));
  vec3 c = vec3(0.02, 0.025, 0.07) + skyCol(0.05) * 0.18;
  c += vec3(0.55, 0.58, 1.0) * streak * edge * 0.22;
  c += vec3(0.9, 0.75, 0.6) * pow(n1(sx * 13.0 + 11.0), 12.0) * edge * 0.6;
  float fog = smoothstep(18.0, 120.0, d);
  c = mix(c, skyCol(0.02) * 0.85, fog);
  gl_FragColor = vec4(c, 1.0);
}`;
const waterVert = `attribute vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const ringVert = /* glsl */ `
attribute vec2 position;
attribute float zi;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uCamZ;
varying vec2 vP; varying float vD;
float px(float z){ return sin(z * 0.05) * 1.3; }
float py(float z){ return 2.3 + sin(z * 0.11) * 0.35; }
void main(){
  float z = uCamZ + 6.0 - mod(uCamZ + 6.0 - zi, ${LOOP.toFixed(1)});
  vec3 c = vec3(px(z), py(z), z);
  vP = position;
  vD = uCamZ - z;
  gl_Position = projectionMatrix * viewMatrix * vec4(c + vec3(position * 1.25, 0.0), 1.0);
}`;
const ringFrag = /* glsl */ `
precision highp float;
varying vec2 vP; varying float vD;
void main(){
  float r = length(vP);
  float ring = (1.0 - smoothstep(0.0, 0.05, abs(r - 0.88))) + exp(-abs(r - 0.88) * 14.0) * 0.5;
  float seg = step(0.5, fract(atan(vP.y, vP.x) / 6.2832 * 24.0));
  float a = ring * mix(0.55, 1.0, seg) * (1.0 - smoothstep(30.0, 110.0, vD)) * smoothstep(2.0, 6.0, vD);
  gl_FragColor = vec4(vec3(0.62, 0.64, 1.0) * a, a);
}`;

const meshVert = `attribute vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;
const gliderFrag = /* glsl */ `
precision highp float;
varying vec3 vP;
void main(){ float e = smoothstep(0.0, 0.5, -vP.z + 0.4); gl_FragColor = vec4(mix(vec3(0.95, 0.96, 1.0), vec3(0.55, 0.57, 1.0), e), 1.0); }`;

const hudFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tHud, tDyn;
uniform vec4 uDyn;
void main(){
  vec4 h = texture2D(tHud, vec2(vUv.x, 1.0 - vUv.y));
  vec2 q = (vec2(vUv.x, 1.0 - vUv.y) - uDyn.xy) / uDyn.zw;
  if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) { vec4 d = texture2D(tDyn, q); h = d + h * (1.0 - d.a); }
  gl_FragColor = h;
}`;

const downFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tHi;
uniform vec2 uTexel;
void main(){
  // redução de 1920 para 1280 com filtro de caixa (como faria o codificador antes de mandar 720p)
  vec3 c = texture2D(tHi, vUv + uTexel * vec2(-0.25, -0.25)).rgb + texture2D(tHi, vUv + uTexel * vec2(0.25, -0.25)).rgb
         + texture2D(tHi, vUv + uTexel * vec2(-0.25, 0.25)).rgb + texture2D(tHi, vUv + uTexel * vec2(0.25, 0.25)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const lensFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tHi, tLo;
uniform vec2 uLens;
uniform float uR, uOn;
void main(){
  vec2 d = gl_FragCoord.xy - uLens;
  float r = length(d);
  float inside = (1.0 - smoothstep(uR - 1.5, uR + 0.5, r)) * uOn;
  float k = smoothstep(uR * 0.7, uR, r);
  vec2 dir = d / max(r, 1.0);
  vec2 off = dir * k * k * 0.012;
  vec3 hi = vec3(texture2D(tHi, vUv - off * 1.15).r, texture2D(tHi, vUv - off).g, texture2D(tHi, vUv - off * 0.85).b);
  vec3 lo = texture2D(tLo, vUv).rgb;
  vec3 c = mix(lo, hi, inside);
  c += vec3(0.85, 0.87, 1.0) * exp(-pow((r - uR) / 1.6, 2.0)) * 0.55 * uOn;
  c += vec3(0.6, 0.62, 1.0) * k * inside * 0.08;
  c *= 1.0 - 0.35 * exp(-max(r - uR, 0.0) / 22.0) * step(uR, r) * uOn;
  gl_FragColor = vec4(c, 1.0);
}`;

function hudCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = HI[0]; c.height = HI[1];
  const g = c.getContext('2d')!;
  const F = (w: number, s: number) => `${w} ${s}px 'Inter Variable', system-ui, sans-serif`;
  g.textBaseline = 'alphabetic';
  // canto superior esquerdo: checkpoints
  g.fillStyle = 'rgba(8,9,20,0.55)'; round(g, 48, 44, 420, 118, 14); g.fill();
  g.fillStyle = '#a9acff'; g.font = F(600, 18); g.fillText('CHECKPOINT', 72, 84);
  g.fillStyle = '#f7f8f8'; g.font = F(650, 40); g.fillText('3 / 12', 72, 128);
  for (let i = 0; i < 12; i++) { g.fillStyle = i < 3 ? '#8b8ef7' : 'rgba(255,255,255,0.18)'; g.fillRect(232 + i * 18, 106, 12, 4); }
  g.fillStyle = 'rgba(208,214,224,0.75)'; g.font = F(500, 15); g.fillText('Melhor volta 1:42.318 · Carlinha', 232, 140);
  // minimapa
  const mx = 1730, my = 172, mr = 118;
  g.fillStyle = 'rgba(8,9,20,0.55)'; g.beginPath(); g.arc(mx, my, mr, 0, 7); g.fill();
  g.strokeStyle = 'rgba(160,165,255,0.35)'; g.lineWidth = 1;
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(mx + i * 30, my - mr); g.lineTo(mx + i * 30, my + mr); g.stroke(); g.beginPath(); g.moveTo(mx - mr, my + i * 30); g.lineTo(mx + mr, my + i * 30); g.stroke(); }
  g.strokeStyle = 'rgba(169,172,255,0.9)'; g.lineWidth = 3; g.beginPath();
  for (let i = 0; i <= 40; i++) { const t = i / 40; const x = mx + Math.sin(t * 9) * 26, y = my + mr - t * mr * 2; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  const dots: [string, string, number, number][] = [['Carlinha', '#f7c46c', -12, -60], ['Bruno', '#7cc0f5', 20, -18], ['Diego', '#c9a99a', -20, 40], ['Você', '#f7f8f8', 0, 72]];
  for (const [n, col, dx, dy] of dots) {
    g.fillStyle = col; g.beginPath(); g.arc(mx + dx, my + dy, 5, 0, 7); g.fill();
    g.fillStyle = 'rgba(247,248,248,0.9)'; g.font = F(560, 13); g.fillText(n, mx + dx + 9, my + dy + 4);
  }
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1.5; g.beginPath(); g.arc(mx, my, mr, 0, 7); g.stroke();
  // mira
  g.strokeStyle = 'rgba(247,248,248,0.8)'; g.lineWidth = 1.5;
  for (const [a, b, cc, dd] of [[960, 520, 960, 530], [960, 550, 960, 560], [930, 540, 940, 540], [980, 540, 990, 540]]) { g.beginPath(); g.moveTo(a, b); g.lineTo(cc, dd); g.stroke(); }
  // chat do grupo
  const chat: [string, string, string][] = [['Bruno', '#7cc0f5', 'essa curva é sua, vai'], ['Carlinha', '#f7c46c', 'AAAAA quase'], ['Diego', '#c9a99a', 'gg, próxima eu ganho'], ['Ana', '#a9acff', 'transmitindo em 1080p pra vocês']];
  g.fillStyle = 'rgba(8,9,20,0.5)'; round(g, 1420, 830, 452, 200, 14); g.fill();
  chat.forEach(([n, col, t], i) => {
    g.font = F(600, 16); g.fillStyle = col; g.fillText(n, 1444, 872 + i * 42);
    const w = g.measureText(n).width;
    g.font = F(450, 16); g.fillStyle = 'rgba(247,248,248,0.88)'; g.fillText(t, 1452 + w, 872 + i * 42);
  });
  // barra de turbo
  g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(48, 1040, 300, 4);
  g.fillStyle = '#8b8ef7'; g.fillRect(48, 1040, 204, 4);
  g.fillStyle = 'rgba(208,214,224,0.75)'; g.font = F(560, 14); g.fillText('TURBO 68%', 48, 1030);
  return c;
}
function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export class Game {
  private renderer: any;
  private gl: any;
  private camera: any;
  private scene: any;
  private sky: any;
  private hud: any;
  private down: any;
  private lens: any;
  private hi: any;
  private lo: any;
  private glider: any;
  private dyn: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: any };
  private bld: any; private water: any; private rings: any;
  private raf = 0;
  private running = false;
  private t0 = performance.now();
  private lastScene = 0;
  private lastDyn = 0;
  canvas: HTMLCanvasElement;
  lensX = 0.5; lensY = 0.5; lensR = 140; lensOn = 1;

  constructor(host: HTMLElement) {
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    this.renderer = new Renderer({ dpr, alpha: false, antialias: false, powerPreference: 'high-performance' });
    const gl = (this.gl = this.renderer.gl);
    this.canvas = gl.canvas;
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    this.hi = new RenderTarget(gl, { width: HI[0], height: HI[1] });
    this.lo = new RenderTarget(gl, { width: LO[0], height: LO[1], depth: false });
    this.camera = new Camera(gl, { fov: 58, aspect: 16 / 9, near: 0.6, far: 170 });
    this.scene = new Transform();
    const tri = new Triangle(gl);

    this.sky = new Mesh(gl, { geometry: tri, program: new Program(gl, { vertex: fullVert, fragment: skyFrag, depthTest: false, depthWrite: false, uniforms: { uTime: { value: 0 } } }) });

    // prédios dos dois lados do canal
    // prédios em fila dos dois lados, sem se sobrepor (sobreposição + profundidade de 16 bits = faces brigando)
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const O: number[] = [], S: number[] = [], RN: number[] = [];
    for (const side of [-1, 1]) {
      let z = 0;
      while (z < LOOP - 3) {
        const d = Math.min(LOOP - z, 2.6 + r() * 4.5), w = 2.5 + r() * 4, h = 5 + r() * r() * 28;
        O.push(side * (3.7 + w / 2 + r() * 0.8), 0, -(z + d / 2)); S.push(w, h, d - 0.12); RN.push(r());
        // uma torre mais alta atrás, de vez em quando
        if (r() > 0.6) { const w2 = 3 + r() * 4; O.push(side * (3.7 + w + 1.5 + w2 / 2), 0, -(z + d / 2)); S.push(w2, 14 + r() * 30, d * 0.8); RN.push(r()); }
        z += d + (r() > 0.75 ? 1.4 : 0.1);
      }
    }
    const off = new Float32Array(O), sc = new Float32Array(S), rn = new Float32Array(RN);
    const box = new Box(gl);
    box.addAttribute('offset', { instanced: 1, size: 3, data: off });
    box.addAttribute('scale', { instanced: 1, size: 3, data: sc });
    box.addAttribute('rnd', { instanced: 1, size: 1, data: rn });
    this.bld = new Mesh(gl, { geometry: box, program: new Program(gl, { vertex: bldVert, fragment: bldFrag, uniforms: { uCamZ: { value: 0 }, uCam: { value: [0, 0, 0] }, uTime: { value: 0 } } }), frustumCulled: false });
    this.bld.setParent(this.scene);

    this.water = new Mesh(gl, { geometry: new Plane(gl, { width: 60, height: 400 }), program: new Program(gl, { vertex: waterVert, fragment: waterFrag, uniforms: { uCam: { value: [0, 0, 0] }, uTime: { value: 0 } } }), frustumCulled: false });
    this.water.rotation.x = -Math.PI / 2;
    this.water.setParent(this.scene);

    const rq = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    const ringGeo = new Geometry(gl, { position: { size: 2, data: rq }, index: { data: new Uint16Array([0, 1, 2, 0, 2, 3]) }, zi: { instanced: 1, size: 1, data: new Float32Array([-30, -70, -110, -150]) } });
    const ringProg = new Program(gl, { vertex: ringVert, fragment: ringFrag, transparent: true, depthWrite: false, cullFace: null, uniforms: { uCamZ: { value: 0 } } });
    ringProg.setBlendFunc(gl.ONE, gl.ONE);
    this.rings = new Mesh(gl, { geometry: ringGeo, program: ringProg, frustumCulled: false });
    this.rings.setParent(this.scene);

    // planador: uma flecha com diedro
    const gp = new Float32Array([0, 0, -0.55, -0.62, 0.08, 0.3, 0, 0.05, 0.12, 0, 0, -0.55, 0, 0.05, 0.12, 0.62, 0.08, 0.3]);
    this.glider = new Mesh(gl, { geometry: new Geometry(gl, { position: { size: 3, data: gp } }), program: new Program(gl, { vertex: meshVert, fragment: gliderFrag, cullFace: null }), frustumCulled: false });
    this.glider.scale.set(1.5);
    this.glider.setParent(this.scene);

    // HUD fino (a prova da resolução) + pedaço dinâmico (velocidade e tempo)
    const dc = document.createElement('canvas'); dc.width = 512; dc.height = 160;
    this.dyn = { c: dc, g: dc.getContext('2d')!, tex: new Texture(gl, { image: dc, generateMipmaps: false, flipY: false }) };
    this.hud = new Mesh(gl, {
      geometry: tri,
      program: new Program(gl, {
        vertex: fullVert, fragment: hudFrag, transparent: true, depthTest: false, depthWrite: false,
        uniforms: { tHud: { value: new Texture(gl, { image: hudCanvas(), generateMipmaps: false, flipY: false }) }, tDyn: { value: this.dyn.tex }, uDyn: { value: [48 / 1920, 880 / 1080, 512 / 1920, 160 / 1080] } },
      }),
    });
    this.hud.program.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.down = new Mesh(gl, { geometry: tri, program: new Program(gl, { vertex: fullVert, fragment: downFrag, depthTest: false, depthWrite: false, uniforms: { tHi: { value: this.hi.texture }, uTexel: { value: [1 / LO[0], 1 / LO[1]] } } }) });
    this.lens = new Mesh(gl, { geometry: tri, program: new Program(gl, { vertex: fullVert, fragment: lensFrag, depthTest: false, depthWrite: false, uniforms: { tHi: { value: this.hi.texture }, tLo: { value: this.lo.texture }, uLens: { value: [0, 0] }, uR: { value: 100 }, uOn: { value: 1 } } }) });

    this.resize();
    addEventListener('resize', this.resize);
  }

  resize = () => {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height);
  };

  private drawDyn(t: number) {
    const { g, c, tex } = this.dyn;
    g.clearRect(0, 0, c.width, c.height);
    const speed = Math.round(204 + Math.sin(t * 0.9) * 9 + Math.sin(t * 2.3) * 3);
    g.fillStyle = 'rgba(8,9,20,0.55)'; round(g, 0, 0, 300, 120, 14); g.fill();
    g.fillStyle = '#f7f8f8'; g.font = "650 64px 'Inter Variable', system-ui, sans-serif"; g.fillText(String(speed), 24, 84);
    g.fillStyle = 'rgba(208,214,224,0.8)'; g.font = "560 18px 'Inter Variable', system-ui, sans-serif"; g.fillText('km/h', 152, 84);
    const lap = 61 + (t % 40);
    g.font = "500 16px 'Inter Variable', system-ui, sans-serif"; g.fillText(`Volta ${Math.floor(lap / 60)}:${(lap % 60).toFixed(3).padStart(6, '0')}`, 24, 108);
    tex.image = c; tex.needsUpdate = true;
  }

  private renderScene(t: number) {
    const z = -t * 14;
    const px = (zz: number) => Math.sin(zz * 0.05) * 1.3, py = (zz: number) => 2.3 + Math.sin(zz * 0.11) * 0.35;
    const gz = z - 6;
    this.glider.position.set(px(gz), py(gz), gz);
    const dx = Math.cos(gz * 0.05) * 0.065;
    this.glider.rotation.set(0.32 + Math.cos(gz * 0.11) * 0.04, -dx * 0.9, -dx * 7);
    this.camera.position.set(px(gz) * 0.55, py(gz) + 0.95, z);
    this.camera.lookAt([px(gz - 8) * 0.8, py(gz) + 0.35, gz - 8]);
    this.camera.rotation.z += -dx * 2.2;
    const cam = [this.camera.position.x, this.camera.position.y, this.camera.position.z];
    this.bld.program.uniforms.uCamZ.value = z; this.bld.program.uniforms.uCam.value = cam; this.bld.program.uniforms.uTime.value = t;
    this.water.position.z = z - 150;
    this.water.program.uniforms.uCam.value = cam; this.water.program.uniforms.uTime.value = t;
    this.rings.program.uniforms.uCamZ.value = z;
    this.sky.program.uniforms.uTime.value = t;
    this.renderer.render({ scene: this.sky, target: this.hi });
    this.renderer.render({ scene: this.scene, camera: this.camera, target: this.hi, clear: false });
    this.renderer.render({ scene: this.hud, target: this.hi, clear: false });
    this.renderer.render({ scene: this.down, target: this.lo });
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      const t = (now - this.t0) / 1000;
      if (now - this.lastDyn > 100) { this.lastDyn = now; this.drawDyn(t); }
      // a transmissão anda a 30 quadros por segundo; a lente acompanha o cursor a cada quadro
      if (now - this.lastScene > 1000 / 30 - 2) { this.lastScene = now; this.renderScene(t); }
      const u = this.lens.program.uniforms, dpr = this.renderer.dpr;
      u.uLens.value = [this.lensX * this.canvas.clientWidth * dpr, (1 - this.lensY) * this.canvas.clientHeight * dpr];
      u.uR.value = this.lensR * dpr; u.uOn.value = this.lensOn;
      this.renderer.render({ scene: this.lens });
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  /** Fotos do mesmo quadro em 1080p e 720p (para os níveis B e C; ver scripts/game-stills.mjs). */
  snapshot(t: number) {
    this.drawDyn(t);
    this.renderScene(t);
    const gl = this.gl;
    const read = (rt: any, w: number, h: number) => {
      const px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.buffer);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const img = new ImageData(w, h);
      for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      c.getContext('2d')!.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    };
    return { hi: read(this.hi, HI[0], HI[1]), lo: read(this.lo, LO[0], LO[1]) };
  }
  dispose() { this.stop(); removeEventListener('resize', this.resize); this.gl.getExtension('WEBGL_lose_context')?.loseContext(); this.canvas.remove(); }
}
