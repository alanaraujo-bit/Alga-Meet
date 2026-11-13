// Evaluates a glTF animation at a point in time and returns world-space joint positions. Used only to prove,
// with numbers, that the converted clips move the skeleton exactly like the originals.

function compose(translation, rotation, scale) {
  const [x, y, z, w] = rotation
  const [sx, sy, sz] = scale
  // prettier-ignore
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    translation[0], translation[1], translation[2], 1,
  ]
}

/** Column-major 4x4 product a·b. */
export function multiply(a, b) {
  const out = new Array(16)
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3]
    }
  }
  return out
}

function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const sign = dot < 0 ? -1 : 1
  dot = Math.min(1, Math.abs(dot))
  let weightA = 1 - t
  let weightB = t
  if (dot < 0.999999) {
    const angle = Math.acos(dot)
    weightA = Math.sin((1 - t) * angle) / Math.sin(angle)
    weightB = Math.sin(t * angle) / Math.sin(angle)
  }
  const out = a.map((value, index) => value * weightA + b[index] * sign * weightB)
  const length = Math.hypot(...out)
  return out.map((value) => value / length)
}

/** Value of one channel at `time`, following glTF sampling rules (clamped outside the key range). */
function sampleChannel(channel, time) {
  const sampler = channel.getSampler()
  const input = sampler.getInput()
  const output = sampler.getOutput()
  const interpolation = sampler.getInterpolation()
  if (interpolation === 'CUBICSPLINE') throw new Error('CUBICSPLINE clips are not handled')
  const count = input.getCount()
  let next = 0
  while (next < count && input.getScalar(next) <= time) next++
  if (next === 0) return output.getElement(0, [])
  if (next === count) return output.getElement(count - 1, [])
  const before = output.getElement(next - 1, [])
  if (interpolation === 'STEP') return before
  const after = output.getElement(next, [])
  const t = (time - input.getScalar(next - 1)) / (input.getScalar(next) - input.getScalar(next - 1))
  if (channel.getTargetPath() === 'rotation') return slerp(before, after, t)
  return before.map((value, index) => value + (after[index] - value) * t)
}

/**
 * World matrix (column-major) of every node with `animation` applied at `time`; nodes the clip does not drive
 * keep their rest transform. Pass no animation for the plain rest pose.
 */
export function worldMatrices(document, animation, time) {
  const posed = new Map()
  for (const channel of animation?.listChannels() ?? []) {
    const node = channel.getTargetNode()
    if (!node || channel.getTargetPath() === 'weights') continue
    if (!posed.has(node)) posed.set(node, {})
    posed.get(node)[channel.getTargetPath()] = sampleChannel(channel, time)
  }
  const matrices = new Map()
  const worldMatrix = (node) => {
    if (matrices.has(node)) return matrices.get(node)
    const pose = posed.get(node) ?? {}
    const local = compose(pose.translation ?? node.getTranslation(), pose.rotation ?? node.getRotation(), pose.scale ?? node.getScale())
    const parent = node.getParentNode()
    const world = parent ? multiply(worldMatrix(parent), local) : local
    matrices.set(node, world)
    return world
  }
  for (const node of document.getRoot().listNodes()) worldMatrix(node)
  return matrices
}

/** World-space positions of the named nodes; see worldMatrices(). */
export function worldPositions(document, animation, time, names) {
  const matrices = worldMatrices(document, animation, time)
  const nodes = document.getRoot().listNodes()
  return Object.fromEntries(
    names.map((name) => {
      const node = nodes.find((candidate) => candidate.getName() === name)
      if (!node) throw new Error(`no node named ${name}`)
      return [name, matrices.get(node).slice(12, 15)]
    }),
  )
}

export function clipDuration(animation) {
  let duration = 0
  for (const sampler of animation.listSamplers()) duration = Math.max(duration, sampler.getInput().getMax([])[0])
  return duration
}
