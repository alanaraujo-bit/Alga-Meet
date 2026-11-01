// The cargo tests' scenarios once more through the real WASM build: `node --test native/mls/test/wasm.test.mjs`.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const { Client } = createRequire(import.meta.url)('../pkg/alga_mls.js')
const enc = new TextEncoder()
const GID = enc.encode('call:wasm-test')
const DS_ID = enc.encode('alga-ds')
const CTX = enc.encode('user0\0device')
const hex = (b) => Buffer.from(b).toString('hex')
let seq = 0
const fresh = () => new Client(enc.encode(`user${seq++}:device`))
const take = (c) => {
  const out = { commit: c.commit, welcome: c.welcome }
  c.free()
  return out
}

function groupOf(ds, n) {
  const g = [fresh()]
  g[0].create_group(GID, ds.signature_public_key(), DS_ID)
  const joiners = Array.from({ length: n - 1 }, fresh)
  if (!joiners.length) return g
  for (const j of joiners) assert.equal(g[0].process(ds.external_propose_add(GID, g[0].epoch(), j.key_package())), 'proposal')
  const c = take(g[0].commit_pending())
  assert.equal(g[0].process(c.commit), 'commit')
  for (const j of joiners) j.process_welcome(c.welcome)
  return [...g, ...joiners]
}

function agreed(g) {
  const s = hex(g[0].export_secret('Alga Media v1', CTX, 32))
  for (const m of g) {
    assert.equal(m.epoch(), g[0].epoch())
    assert.equal(hex(m.export_secret('Alga Media v1', CTX, 32)), s)
  }
  return s
}

function dsEpoch(g, proposal) {
  for (const m of g) assert.equal(m.process(proposal), 'proposal')
  const c = take(g[0].commit_pending())
  for (const m of g) assert.equal(m.process(c.commit), 'commit')
  return c
}

test('groups of 2..99 agree per epoch; a removed member is locked out', () => {
  const ds = new Client(DS_ID)
  for (const n of [2, 10, 25, 99]) {
    const g = groupOf(ds, n)
    const s1 = agreed(g)
    const gone = g.pop()
    const remove = ds.external_propose_remove(GID, g[0].epoch(), gone.own_leaf_index())
    assert.equal(gone.process(remove), 'proposal')
    const before = gone.save_state()
    const c = dsEpoch(g, remove)
    assert.equal(gone.process(c.commit), 'removed')
    assert.throws(() => gone.export_secret('Alga Media v1', CTX, 32))
    const s2 = agreed(g)
    assert.notEqual(s1, s2)
    if (n > 2) {
      const add = ds.external_propose_add(GID, g[0].epoch(), fresh().key_package())
      const c3 = dsEpoch(g, add)
      const ghost = Client.load_state(before)
      assert.equal(hex(ghost.export_secret('Alga Media v1', CTX, 32)), s1)
      assert.throws(() => ghost.process(c3.commit))
      assert.notEqual(agreed(g), s2)
    }
  }
})

test('tampered commit is rejected at every byte', () => {
  const ds = new Client(DS_ID)
  const g = groupOf(ds, 3)
  const add = ds.external_propose_add(GID, g[0].epoch(), fresh().key_package())
  for (const m of g) m.process(add)
  const c = take(g[0].commit_pending())
  for (let i = 0; i < c.commit.length; i++) {
    const bad = c.commit.slice()
    bad[i] ^= 1
    assert.throws(() => g[1].process(bad), undefined, `byte ${i}`)
  }
  for (const m of g) assert.equal(m.process(c.commit), 'commit')
  agreed(g)
  // Removal commit: carries an UpdatePath.
  const remove = ds.external_propose_remove(GID, g[0].epoch(), 2)
  for (const m of g) m.process(remove)
  const r = take(g[0].commit_pending())
  for (let i = 0; i < r.commit.length; i++) {
    const bad = r.commit.slice()
    bad[i] ^= 1
    assert.throws(() => g[1].process(bad), undefined, `removal byte ${i}`)
  }
  assert.equal(g[2].process(r.commit), 'removed')
  for (const m of g.slice(0, 2)) assert.equal(m.process(r.commit), 'commit')
  agreed(g.slice(0, 2))
})

test('only the configured DS may propose', () => {
  const g = groupOf(new Client(DS_ID), 2)
  assert.throws(() => g[1].process(new Client(DS_ID).external_propose_add(GID, g[0].epoch(), fresh().key_package())))
})

test('state round-trips deterministically through serialization', () => {
  const ds = new Client(DS_ID)
  const g = groupOf(ds, 3)
  const blob = g[2].save_state()
  assert.equal(hex(g[2].save_state()), hex(blob))
  g[2] = Client.load_state(blob)
  assert.equal(hex(g[2].save_state()), hex(blob))
  dsEpoch(g, ds.external_propose_add(GID, g[0].epoch(), fresh().key_package()))
  agreed(g)
  const id = g[1].export_identity()
  assert.equal(hex(Client.from_identity(id).signature_public_key()), hex(g[1].signature_public_key()))
  assert.throws(() => Client.load_state(blob.slice(0, -1)))
})
