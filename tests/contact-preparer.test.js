import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { createNineSliceBlock } from '../src/terrain.js';
import { createContactPreparer, sampleContactTimeline } from '../src/contact-preparer.js';

async function controlled(run) {
  const previous = globalThis.Worker, workers = [];
  class Worker {
    constructor() { workers.push(this); }
    postMessage(data, transfer) { if (this.throwOnPost) throw new Error('injected transfer failure'); this.message = structuredClone(data, { transfer }); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
  }
  globalThis.Worker = Worker;
  const engine = new NullEngine(), scene = new Scene(engine), mesh = createNineSliceBlock(scene, 0);
  const fragment = { mesh, base: Vector3.Zero(), center: Vector3.Zero(), volume: .3, topArea: .5, part: 0, supportGroup: 0, supportLayer: 0, columnConstraints: [] };
  const preparer = createContactPreparer(), prepare = () => preparer.prepare([fragment], { family: 'inward', seed: 11 }, new Map(), {});
  try { await run({ workers, Worker, mesh, preparer, prepare }); }
  finally { preparer.dispose(); scene.dispose(); engine.dispose(); if (previous === undefined) delete globalThis.Worker; else globalThis.Worker = previous; }
}

test('physics worker copies render geometry and returns the actual cached timeline', () => controlled(async ({ workers, mesh, prepare }) => {
  const original = [...mesh.getVerticesData('position')], pending = prepare();
  assert.ok(workers[0].message.fragments[0].positions.length > 0);
  assert.deepEqual(mesh.getVerticesData('position'), original, 'transferred sampling buffers cannot detach or change the visible mesh');
  const timeline = { engine: 'Havok', count: 1, steps: 1, bodies: [{ scale: .86 }], values: new Float64Array([0, 0, 0, 0, 0, 0, 1, 0, 0, -.2, 0, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 1]) };
  workers[0].reply(timeline);
  const received = await pending;
  for (const key of Object.keys(timeline)) assert.deepEqual(received[key], timeline[key]);
  assert.ok(received.snapshotMs >= 0 && received.totalPreparationMs >= received.snapshotMs);
  assert.equal(workers[0].terminated, true);
  const middle = sampleContactTimeline(timeline, 0, .5);
  assert.ok(Math.abs(middle.offset.y + .1) < 1e-12);
  assert.ok(Math.abs(middle.quaternion.length() - 1) < 1e-12, 'interpolated body rotation must remain a unit quaternion');
  assert.equal(middle.contact, true);
  assert.equal(middle.scale, .86);
}));

test('cancelled physics results cannot replace a newer job and disposed planners cannot restart', () => controlled(async ({ workers, preparer, prepare }) => {
  const first = prepare(), aborted = assert.rejects(first, { name: 'AbortError' });
  const staleSuccess = workers[0].onmessage, staleError = workers[0].onerror, staleUnreadable = workers[0].onmessageerror;
  const next = prepare(); await aborted; assert.equal(workers[0].terminated, true);
  staleSuccess({ data: { obsolete: true } }); staleError({ message: 'late old error' }); staleUnreadable();
  workers[1].reply({ current: true }); assert.equal((await next).current, true);
  const pending = prepare(), disposed = assert.rejects(pending, { name: 'AbortError' });
  preparer.dispose(); await disposed; assert.equal(workers[2].terminated, true);
  const forbidden = prepare(); forbidden.catch(() => {});
  assert.equal(workers.length, 3);
  await assert.rejects(forbidden, { name: 'AbortError' });
}));

test('physics load, message and transfer failures release the worker and allow retry', () => controlled(async ({ workers, Worker, prepare }) => {
  for (const kind of ['load', 'message', 'solver']) {
    const pending = prepare(), rejected = assert.rejects(pending, /physics|solver|Unreadable/), worker = workers.at(-1);
    if (kind === 'load') worker.onerror({ message: 'physics load failure' });
    else if (kind === 'message') worker.onmessageerror();
    else worker.reply({ error: 'solver failure' });
    await rejected; assert.equal(worker.terminated, true);
  }
  Worker.prototype.throwOnPost = true;
  await assert.rejects(prepare(), /injected transfer failure/);
  assert.equal(workers.at(-1).terminated, true, 'synchronous transport failure must not leave a worker alive');
  Worker.prototype.throwOnPost = false;
  const retry = prepare(); workers.at(-1).reply({ recovered: true });
  assert.equal((await retry).recovered, true);
}));
