import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createNineSliceBlock } from '../src/terrain.js';
import { createFracturePreparer } from '../src/fracture-preparer.js';

async function withWorker(run) {
  const previous = globalThis.Worker, workers = [];
  class ControlledWorker {
    constructor() { workers.push(this); this.messages = []; }
    postMessage(data, transfer) { this.messages.push(structuredClone(data, { transfer })); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
  }
  globalThis.Worker = ControlledWorker;
  const engine = new NullEngine(), scene = new Scene(engine), source = createNineSliceBlock(scene, 0);
  source.metadata.tileIndex = 0;
  const preparer = createFracturePreparer();
  try { await run({ workers, source, scene, preparer }); }
  finally { preparer.dispose(); scene.dispose(); engine.dispose(); if (previous === undefined) delete globalThis.Worker; else globalThis.Worker = previous; }
}

test('worker preparation coalesces one request, preserves source buffers and reuses the idle worker', () => withWorker(async ({ workers, source, preparer }) => {
  const positions = [...source.getVerticesData('position')];
  const first = preparer.prepare(source, { variant: 0 });
  assert.equal(preparer.prepare(source, { variant: 0 }), first);
  assert.equal(workers.length, 1); assert.equal(workers[0].messages.length, 1);
  assert.deepEqual(source.getVerticesData('position'), positions, 'transfers cannot detach the original render buffers');
  workers[0].reply({ data: { result: 'first' } });
  assert.deepEqual(await first, { result: 'first' });
  assert.equal(preparer.prepare(source, { variant: 0 }), first, 'the same prepared result should be reused');
  assert.equal(workers[0].onmessage, null, 'idle worker callbacks cannot retain the consumed request closure');
  const second = preparer.prepare(source, { variant: 1 });
  assert.equal(workers.length, 1, 'an idle worker should not reload its engine for every tile');
  workers[0].reply({ data: { result: 'second' } });
  assert.deepEqual(await second, { result: 'second' });
}));

test('cancel and replacement reject obsolete work and ignore late replies', () => withWorker(async ({ workers, source, scene, preparer }) => {
  const first = preparer.fracture(source, { variant: 0 }), rejected = assert.rejects(first, { name: 'AbortError' });
  const staleReply = workers[0].onmessage, staleError = workers[0].onerror, staleUnreadable = workers[0].onmessageerror;
  const next = preparer.prepare(source, { variant: 1 });
  await rejected; assert.equal(workers[0].terminated, true);
  staleReply({ data: { data: { obsolete: true } } });
  staleError({ message: 'queued error from terminated worker' }); staleUnreadable();
  workers[1].reply({ data: { current: true } });
  assert.deepEqual(await next, { current: true });
  assert.equal(scene.meshes.length, 1); assert.equal(scene.transformNodes.length, 0, 'late results cannot allocate scene nodes');
  const pending = preparer.prepare(source, { variant: 2 }), cancelled = assert.rejects(pending, { name: 'AbortError' });
  assert.equal(workers.length, 2, 'stale errors must not erase the current idle worker handle');
  preparer.cancel(); await cancelled;
  assert.equal(workers[1].terminated, true);
  const last = preparer.prepare(source, { variant: 3 }), disposed = assert.rejects(last, { name: 'AbortError' });
  preparer.dispose(); await disposed; assert.equal(workers[2].terminated, true);
  await assert.rejects(preparer.prepare(source), { name: 'AbortError' });
}));

test('worker errors permit retry and disposed sources never hydrate a late result', () => withWorker(async ({ workers, source, scene, preparer }) => {
  const first = preparer.prepare(source), failed = assert.rejects(first, /worker load failed/);
  workers[0].onerror({ message: 'worker load failed' }); await failed;
  assert.equal(workers[0].terminated, true);
  const second = preparer.prepare(source), logicalFailure = assert.rejects(second, /generation failed/);
  workers[1].reply({ error: 'generation failed' }); await logicalFailure;
  const unreadable = preparer.prepare(source), messageFailure = assert.rejects(unreadable, /unreadable/);
  workers[1].onmessageerror(); await messageFailure;
  const retry = preparer.fracture(source), aborted = assert.rejects(retry, { name: 'AbortError' });
  source.dispose(); workers[2].reply({ data: {} }); await aborted;
  assert.equal(scene.meshes.length, 0); assert.equal(scene.transformNodes.length, 0);
}));
