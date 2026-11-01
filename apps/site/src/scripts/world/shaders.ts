// GLSL da água global (nível A). Tudo procedural: nenhuma textura baixada.
export const noiseGLSL = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Cáustica: domínio dobrado sobre si mesmo; a rede de luz que a superfície projeta.
// Ladrilhável (período 1); o deslocamento de -250 mantém o domínio longe de zero, onde a divisão explode.
float caustic(vec2 x, float t) {
  vec2 p = mod(x * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

export const fullVert = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`;

// Água: gradiente de profundidade, raios de luz, cáusticas, poça de luz, cursor, anéis e (no fechamento) o céu.
export const waterFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime, uAspect, uDepth, uRays, uIntro, uSurface, uFlow;
uniform vec3 uTint;
uniform vec2 uMouse;
uniform float uMouseOn;
uniform vec4 uRip[6];
uniform vec4 uPool;
uniform vec4 uObjA;
uniform vec4 uObjB;
uniform vec3 uBed;
uniform vec3 uDust;
${noiseGLSL}

vec3 sky(vec2 uv, vec2 p, float t) {
  // Hora azul: índigo profundo em cima, faixa de luz no horizonte, água escura embaixo.
  float h = 0.36;
  float yy = uv.y - h;
  vec3 top = vec3(0.07, 0.08, 0.24);
  vec3 band = vec3(0.42, 0.44, 0.95);
  vec3 col = mix(band, top, smoothstep(0.0, 0.55, yy));
  col += vec3(0.95, 0.75, 0.85) * 0.18 * exp(-yy * 18.0) * step(0.0, yy);
  // estrelas raras
  float s = step(0.9975, hash(floor(uv * vec2(uAspect, 1.0) * 220.0))) * smoothstep(0.15, 0.6, yy);
  col += s * 0.6;
  // mar: reflexo da faixa, ondinhas
  if (yy < 0.0) {
    float d = -yy;
    float w = noise(vec2(p.x * 40.0 / (d + 0.05), d * 120.0 - t * 1.2));
    vec3 sea = mix(band * 0.55, vec3(0.01, 0.012, 0.03), smoothstep(0.0, 0.35, d));
    sea += band * 0.25 * smoothstep(0.55, 1.0, w) * exp(-d * 9.0);
    col = sea;
  }
  col += vec3(0.75, 0.78, 1.0) * exp(-abs(yy) * 90.0) * 0.6;
  return col;
}

void main() {
  vec2 uv = vUv;
  vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y - 0.5);
  float t = uTime;

  // anéis do cursor/clique: deslocam a água e acendem a crista
  vec2 disp = vec2(0.0);
  float rip = 0.0;
  for (int k = 0; k < 6; k++) {
    vec4 r = uRip[k];
    float age = t - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 4.0) continue;
    vec2 d = p - vec2((r.x - 0.5) * uAspect, r.y - 0.5);
    float dist = length(d);
    float front = age * 0.32;
    float w = sin((dist - front) * 70.0) * exp(-pow((dist - front) * 10.0, 2.0)) * exp(-age * 1.1) * r.w;
    disp += d / (dist + 1e-4) * w * 0.010;
    rip += max(w, 0.0);
  }
  vec2 q = p + disp;

  // profundidade: em cima clareia (superfície), embaixo afunda no quase preto
  float k = clamp(uv.y + disp.y * 2.0, 0.0, 1.0);
  vec3 deep = vec3(0.010, 0.010, 0.018);
  vec3 col = mix(deep, uTint * 0.22 * (1.0 - uDepth * 0.75), smoothstep(0.0, 0.75, k));
  col = mix(col, uTint * 0.62, smoothstep(0.6, 1.08, k) * (1.0 - uDepth * 0.85));

  // raios: nascem acima da tela e abrem em leque
  vec2 o = vec2(0.18 * uAspect + 0.05 * sin(t * 0.05), 0.9);
  vec2 dd = q - o;
  float ang = atan(dd.x, -dd.y);
  float r1 = noise(vec2(ang * 7.0 + uFlow, t * 0.10));
  float r2 = noise(vec2(ang * 19.0 + 4.0 - uFlow, t * 0.19));
  float rays = smoothstep(0.42, 1.0, r1) * 0.7 + smoothstep(0.58, 1.0, r2) * 0.45;
  rays *= exp(-length(dd) * 1.05) * (1.0 - smoothstep(0.2, 1.2, abs(ang)));
  col += uTint * rays * uRays * (1.0 - uDepth * 0.7);

  // cáusticas no volume, mais fortes perto da superfície
  float c = caustic(q * 0.75 + vec2(0.0, t * 0.01), t * 0.45 + 23.0);
  col += vec3(0.62, 0.66, 1.0) * c * 0.10 * smoothstep(0.15, 1.0, k) * (1.0 - uDepth * 0.6) * uRays;
  // brilho da superfície vista de baixo
  float surf = smoothstep(0.86, 1.0, k) * (0.55 + 0.45 * noise(vec2(q.x * 9.0 + t * 0.2, t * 0.6)));
  col += uTint * surf * 0.45 * (1.0 - uDepth);

  // poça de luz (de onde o app sobe)
  vec2 pp = q - vec2((uPool.x - 0.5) * uAspect, uPool.y - 0.5);
  float pool = exp(-length(pp * vec2(1.0, 2.4)) * (3.2 / max(uPool.z, 0.05)));
  col += vec3(0.55, 0.57, 1.0) * pool * uPool.w;
  col += vec3(0.9, 0.92, 1.0) * pow(pool, 4.0) * uPool.w * 0.6;

  // objetos da leveza: esfera densa (A) e bolha de vidro (B)
  for (int i = 0; i < 2; i++) {
    vec4 ob = i == 0 ? uObjA : uObjB;
    if (ob.w <= 0.0) continue;
    vec2 d = q - vec2((ob.x - 0.5) * uAspect, ob.y - 0.5);
    float r = ob.z;
    float L = length(d) / r;
    float edge = 1.0 - smoothstep(0.985, 1.0, L);
    float z = sqrt(max(0.0, 1.0 - L * L));
    vec3 n = vec3(d / r, z);
    vec3 ld = normalize(vec3(-0.35, 0.8, 0.6));
    float diff = max(dot(n, ld), 0.0);
    float spec = pow(max(dot(reflect(-ld, n), vec3(0, 0, 1)), 0.0), 40.0);
    float fres = pow(1.0 - z, 3.0);
    vec3 oc;
    if (i == 0) {
      oc = vec3(0.035, 0.035, 0.045) + vec3(0.12, 0.12, 0.16) * diff + vec3(0.7, 0.72, 0.9) * spec * 0.5 + uTint * fres * 0.25;
      col = mix(col, oc, edge * ob.w);
    } else {
      vec3 refr = col * 0.8 + uTint * 0.12;
      oc = refr + vec3(0.85, 0.88, 1.0) * (fres * 0.9 + spec * 1.2) + vec3(0.55, 0.56, 0.97) * 0.08;
      col = mix(col, oc, edge * ob.w);
      col += vec3(0.6, 0.62, 1.0) * exp(-max(L - 1.0, 0.0) * 9.0) * 0.12 * ob.w * step(1.0, L);
    }
  }

  // sedimento levantado quando a esfera pesada bate no fundo
  if (uDust.z > 0.0) {
    vec2 dp = q - vec2((uDust.x - 0.5) * uAspect, uDust.y - 0.5);
    float cloud = noise(dp * 14.0 + vec2(t * 0.3, -t * 0.5)) * 0.6 + noise(dp * 31.0 - t * 0.4) * 0.4;
    float shape = exp(-length(dp * vec2(0.8 / max(uDust.z, 0.2), 2.6)) * 4.0);
    col += vec3(0.42, 0.44, 0.62) * cloud * shape * uDust.z * 0.55;
  }

  // leito: a luz que mora onde as frondes nascem
  vec2 bed = q - vec2((uBed.x - 0.5) * uAspect, uBed.y - 0.5);
  col += vec3(0.42, 0.5, 1.0) * exp(-length(bed * vec2(1.0, 4.0)) * 5.0) * 0.32 * uBed.z;

  // luz do cursor
  vec2 dm = q - vec2((uMouse.x - 0.5) * uAspect, uMouse.y - 0.5);
  col += vec3(0.5, 0.52, 1.0) * exp(-dot(dm, dm) * 14.0) * 0.10 * uMouseOn;
  col += vec3(0.8, 0.82, 1.0) * rip * 0.22;

  // acima da superfície (fechamento)
  if (uSurface > 0.0) {
    float line = mix(1.2, 0.0, uSurface) + 0.012 * sin(p.x * 14.0 + t * 1.4) + 0.006 * sin(p.x * 31.0 - t * 2.0);
    vec3 s = sky(uv, p, t);
    float above = smoothstep(line - 0.004, line + 0.004, uv.y);
    col = mix(col, s, above);
    col += vec3(0.8, 0.82, 1.0) * exp(-abs(uv.y - line) * 160.0) * 0.5 * step(0.001, uSurface) * (1.0 - smoothstep(0.9, 1.0, uSurface));
  }

  // vinheta
  col *= 1.0 - 0.45 * pow(length((uv - 0.5) * vec2(1.0, 1.25)), 2.2);
  gl_FragColor = vec4(col * uIntro, 1.0);
}
`;

// Composição em resolução cheia: escala a água e espalha um pontilhado para o gradiente escuro não fazer degraus.
export const compositeFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tWater;
uniform float uTime;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
void main() {
  vec3 c = texture2D(tWater, vUv).rgb;
  c += (h(gl_FragCoord.xy) - 0.5) / 160.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

export const particleVert = /* glsl */ `
attribute vec3 position;
attribute vec4 rnd;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime, uPx, uFocus, uScroll;
varying float vA;
void main() {
  vec3 p = position;
  p.y = mod(p.y + uTime * (0.02 + rnd.x * 0.05) + uScroll * (0.4 + rnd.z * 0.8) + 5.0, 10.0) - 5.0;
  p.x += sin(uTime * 0.27 + rnd.y * 6.28) * 0.18;
  p.z += cos(uTime * 0.21 + rnd.z * 6.28) * 0.12;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.1);
  float coc = abs(dist - uFocus) * 0.55;
  gl_PointSize = clamp((1.2 + rnd.w * 2.0 + coc * 7.0) * uPx / dist, 1.0, 48.0);
  vA = (0.18 + rnd.w * 0.5) / (1.0 + coc * coc * 9.0) * smoothstep(0.2, 1.2, dist);
}
`;

export const particleFrag = /* glsl */ `
precision highp float;
varying float vA;
uniform float uIntro;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.18, 0.5, d)) * vA * uIntro;
  gl_FragColor = vec4(vec3(0.7, 0.73, 1.0) * a, a * 0.9);
}
`;

// Frondes do Encosto: tira subdividida com a silhueta exata do SVG (máscara), curvada pela corrente.
export const bladeVert = /* glsl */ `
attribute vec3 position;
attribute vec2 tex;
attribute float h;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime, uPhase, uBend, uHeight;
varying vec2 vTex;
varying float vH;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  float sway = sin(uTime * 0.72 + uPhase) * 0.05 + sin(uTime * 1.31 + uPhase * 2.1) * 0.018 + uBend;
  p.x += sway * h * h * uHeight;
  p.z += sin(uTime * 0.5 + uPhase) * 0.12 * h * uHeight;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vTex = tex;
  vH = h;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const bladeFrag = /* glsl */ `
precision highp float;
varying vec2 vTex;
varying float vH;
varying vec3 vWorld;
uniform sampler2D tMask;
uniform float uTime, uGrow, uChannel, uFade, uGlow;
uniform vec3 uColor;
${noiseGLSL}
void main() {
  vec4 m = texture2D(tMask, vTex);
  float a = uChannel < 0.5 ? m.r : m.g;
  float front = uGrow * 1.06;
  a *= 1.0 - smoothstep(front - 0.05, front, vH);
  if (a < 0.003) discard;
  // relevo: o gradiente da máscara desfocada vira normal; luz de cima à esquerda, como a da superfície
  vec2 e = vec2(0.006, 0.003);
  float gx = texture2D(tMask, vTex + vec2(e.x, 0.0)).b - texture2D(tMask, vTex - vec2(e.x, 0.0)).b;
  float gy = texture2D(tMask, vTex - vec2(0.0, e.y)).b - texture2D(tMask, vTex + vec2(0.0, e.y)).b;
  vec3 n = normalize(vec3(-gx * 3.2, -gy * 3.2, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.65, 0.6));
  float diff = 0.62 + 0.38 * dot(n, L);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
  float fres = pow(1.0 - n.z, 1.6);
  float growing = step(0.001, uGrow) * (1.0 - smoothstep(0.9, 1.0, uGrow));
  float frontGlow = exp(-pow((vH - front + 0.03) * 34.0, 2.0)) * growing;
  // a água absorve a luz perto do fundo
  vec3 base = mix(uColor * vec3(0.42, 0.45, 0.78), uColor, smoothstep(0.0, 0.7, vH));
  float c = caustic(vWorld.xy * 0.45 + vec2(0.0, uTime * 0.012), uTime * 0.45);
  vec3 col = base * diff + vec3(0.75, 0.82, 1.0) * c * 0.32 * smoothstep(0.15, 0.9, vH);
  col += vec3(0.9, 0.92, 1.0) * spec * 0.4 + vec3(0.55, 0.62, 1.0) * fres * 0.8;
  // contraluz: a borda de cima pega a luz da superfície
  col += vec3(0.7, 0.78, 1.0) * smoothstep(0.0, 0.5, -gy * 4.0) * 0.35;
  a *= smoothstep(0.0, 0.07, vH);
  col += vec3(0.92, 0.94, 1.0) * frontGlow * 1.6;
  col += uColor * uGlow * 0.6;
  gl_FragColor = vec4(col * a * uFade, a * uFade);
}
`;
