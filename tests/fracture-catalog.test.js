import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFractureBinary, decodeFractureBinary, fractureDecoderReady } from '../src/fracture-binary.js';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { chooseFracturePatterns, createBakedCrackedSurface, createBakedSplitRoof } from '../src/scene.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createNineSliceBlock } from '../src/terrain.js';
import { snapshotFractureMesh, restoreFractureMesh, restoreFracture } from '../src/fracture-data.js';

test('catalog binary preserves bounded source precision, exact indices and animation precision', () => {
  const source = new Float64Array([-.4, .123456789, 0, .8, -.123456789, 1]);
  const positions = new Float32Array([-.413762, .2137, .9786, -.4, .2121, -.7, .413762, .013, .1]);
  const normals = new Float32Array([-.5773502, .5773502, .5773502, 0, 1, 0]);
  const colors = new Float32Array([.123456, .654321, .3, 1, .5, .9, .75, 1]);
  const indices = new Uint32Array([0, 2, 1, 65537, 0x80000001, 0xffffffff]);
  const value = { version: 1, source: { attributes: [{ kind: 'position', data: source }] }, positions, normals, colors, indices, repeatedPositions: positions };
  const before = [...positions], binary = encodeFractureBinary(value);
  const padded = new Uint8Array(binary.length + 3); padded.set(binary, 3);
  const result = decodeFractureBinary(padded.subarray(3));
  assert.ok(result.source.attributes[0].data.every((v, i) => Math.abs(v - source[i]) < 2e-5), 'intact geometry quantization must remain within the position error budget');
  assert.deepEqual(result.indices, indices, 'index predictors must preserve all 32 unsigned bits');
  for (const [kind, values, tolerance] of [['positions', positions, 2e-5], ['normals', normals, 2e-5], ['colors', colors, .00025]]) {
    assert.equal(result[kind].length, values.length);
    assert.ok(result[kind].every((value, i) => Number.isFinite(value) && Math.abs(value - values[i]) <= tolerance), `${kind} quantization must stay below its visible precision budget`);
  }
  assert.equal(result.positions, result.repeatedPositions, 'identical stored sections should decode once');
  assert.deepEqual([...positions], before, 'encoding cannot quantize the live source arrays in place');
  const independent = decodeFractureBinary(binary);
  result.positions[0] = 99;
  assert.notEqual(independent.positions[0], 99, 'different catalog decodes cannot share writable buffers');
});

test('production meshopt codec lazily restores shared buffers after eviction without changing contact flags', async () => {
  await Promise.all([fractureDecoderReady, MeshoptEncoder.ready]);
  const positions = new Float32Array([-.4, 0, -.4, .4, 0, -.4, .4, .2, .4, -.4, .2, .4]);
  const normals = new Float32Array([0, 1, 0, .6, .8, 0, -.6, .8, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const values = new Float32Array([-.123, .456, -.789, 0, 0, 0, 1, 0, -.4, -7.123, .5, 0, .6, 0, .8, 1]);
  const binary = encodeFractureBinary({ positions, normals, indices, values, same: positions }, MeshoptEncoder);
  const template = decodeFractureBinary(binary, { lazy: true });
  assert.equal(template.decodedBufferBytes, 0);
  const copied = template.positions.slice(), first = template.positions;
  assert.equal(template.same, first);
  assert.ok(first.every((v, i) => Math.abs(v - positions[i]) < 2e-5));
  assert.ok(template.normals.every((v, i) => Math.abs(v - normals[i]) < 7e-5));
  assert.deepEqual(template.indices, indices);
  assert.equal(template.values[7], 0); assert.equal(template.values[15], 1);
  assert.ok(template.decodedBufferBytes > 0);
  template.clearDecodedBuffers(); assert.equal(template.decodedBufferBytes, 0);
  assert.notEqual(template.positions, first);
  assert.deepEqual(template.positions, copied, 'eviction must reconstruct identical geometry for the next hit');
  first[0] = 99;
  assert.deepEqual(template.positions, copied, 'a retained old instance cannot mutate the redecoded cache');
});

test('catalog binary rejects truncated headers, offsets and buffers', () => {
  assert.throws(() => decodeFractureBinary(new Uint8Array(8)), /header/);
  const binary = encodeFractureBinary({ positions: new Float32Array([1, 2, 3]) });
  const badMagic = binary.slice(); new DataView(badMagic.buffer).setUint32(0, 0, true);
  assert.throws(() => decodeFractureBinary(badMagic), /header/);
  const badOffset = binary.slice(); new DataView(badOffset.buffer).setUint32(8, 13, true);
  assert.throws(() => decodeFractureBinary(badOffset), /offset/);
  assert.throws(() => decodeFractureBinary(binary.slice(0, -1)), /buffer/);
});

test('sixteen preassigned patterns avoid all eight neighbours and change every tile on reset', () => {
  const seen = new Set();
  for (let size = 1; size <= 5; size++) {
    let previous = [];
    for (let seed = 0; seed < 100; seed++) {
      const before = [...previous], next = chooseFracturePatterns(size, seed, previous);
      assert.deepEqual(next, chooseFracturePatterns(size, seed, previous), 'selection cannot depend on camera or frame timing');
      assert.deepEqual(previous, before, 'selection cannot change the previous board in place');
      assert.equal(next.length, size * size);
      next.forEach((id, index) => {
        assert.ok(Number.isInteger(id) && id >= 0 && id < 16);
        seen.add(id); assert.notEqual(id, previous[index], 'a reset must assign a new pattern to the same tile');
        const x = index % size, y = Math.floor(index / size);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((dx || dy) && nx >= 0 && nx < size && ny >= 0 && ny < size) assert.notEqual(id, next[ny * size + nx], 'including diagonal neighbours cannot repeat a pattern');
        }
      });
      previous = next;
    }
  }
  assert.equal(seen.size, 16, 'the finite library must not silently reduce to a few repeating patterns');
});

test('catalog loading coalesces downloads and ready lookups perform no further I/O', async () => {
  const { loadFractureCatalog, getFractureTemplate } = await import('../src/fracture-catalog.js?test=ready');
  const patterns = Array.from({ length: 16 }, (_, id) => ({ id, file: `pattern-${id}.bin.gz`, sha256: `test-${id}` }));
  const requests = [], progress = []; let active = 0, maximum = 0;
  const fetch = async url => {
    requests.push(String(url)); active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    if (url.pathname.endsWith('manifest.json')) return Response.json({ version: 1, patterns });
    const id = Number(url.pathname.match(/pattern-(\d+)/)[1]);
    return new Response(gzipSync(encodeFractureBinary({ version: 1, id, values: new Float32Array([id, .25]) })));
  };
  assert.throws(() => getFractureTemplate(0), /not loaded/);
  const first = loadFractureCatalog({ fetch, baseUrl: 'http://fixtures.invalid/', onProgress: n => progress.push(n) });
  assert.equal(loadFractureCatalog({ fetch }), first, 'simultaneous worlds must share one initial catalog download');
  const catalog = await first;
  assert.equal(requests.length, 17); assert.ok(maximum <= 4);
  assert.deepEqual(progress, Array.from({ length: 17 }, (_, n) => n));
  const retained = getFractureTemplate(0), copied = retained.values.slice();
  for (const id of [1, 2, 3]) getFractureTemplate(id).values;
  assert.equal(retained.decodedBufferBytes, 0, 'the fourth decoded pattern must evict the least recently used one');
  assert.deepEqual(getFractureTemplate(0).values, copied, 'evicted patterns remain immediately usable without a new download');
  for (let n = 0; n < 40; n++) assert.equal(getFractureTemplate(n % 16), catalog.patterns[n % 16]);
  assert.equal(await loadFractureCatalog({ fetch: () => { throw new Error('unexpected fetch after ready'); } }), catalog);
  assert.equal(requests.length, 17);
  assert.throws(() => getFractureTemplate(16), /Unknown/);
});

test('a failed catalog load does not publish a partial library and can be retried', async () => {
  const { loadFractureCatalog, getFractureTemplate } = await import('../src/fracture-catalog.js?test=retry');
  let fail = true;
  const patterns = Array.from({ length: 16 }, (_, id) => ({ id, file: `pattern-${id}.bin`, sha256: 'fixture' }));
  const fetch = async url => {
    if (url.pathname.endsWith('manifest.json')) return Response.json({ version: 1, patterns });
    const id = Number(url.pathname.match(/pattern-(\d+)/)[1]);
    if (fail && id === 3) return new Response('missing', { status: 503 });
    return new Response(encodeFractureBinary({ version: 1, id }));
  };
  await assert.rejects(loadFractureCatalog({ fetch, baseUrl: 'http://fixtures.invalid/' }), /pattern 3/);
  assert.throws(() => getFractureTemplate(0), /not loaded/);
  fail = false;
  const catalog = await loadFractureCatalog({ fetch, baseUrl: 'http://fixtures.invalid/' });
  assert.equal(catalog.patterns.length, 16);
});

test('instances copy shared catalog buffers and nested metadata before animation mutates them', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const source = createNineSliceBlock(scene, 0);
    source.metadata.testNested = { ids: [1, 2, 3] };
    const raw = snapshotFractureMesh(source);
    raw.attributes = raw.attributes.map(a => ({ ...a, data: new Float32Array(a.data) }));
    const before = structuredClone(raw), first = restoreFractureMesh(scene, raw), second = restoreFractureMesh(scene, raw);
    first.metadata.testNested.ids[0] = 99;
    first.metadata.collapseMotion = { active: true };
    first.getVerticesData('position')[0] = 99;
    first.getIndices()[0] = 99;
    assert.deepEqual(raw, before, 'display state and geometry updates cannot contaminate a shared template');
    assert.equal(second.metadata.testNested.ids[0], 1);
    assert.notEqual(second.getVerticesData('position')[0], 99);
    assert.notEqual(second.getIndices()[0], 99);
    first.dispose(); second.dispose(); source.dispose();
    assert.equal(scene.meshes.length, 0); assert.equal(scene.geometries.length, 0);
  } finally { scene.dispose(); engine.dispose(); }
});

test('shipped sixteen patterns contain complete coherent stages and distinct source artwork coordinates', async () => {
  await fractureDecoderReady;
  const manifest = JSON.parse(await readFile(new URL('../public/fractures/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.patterns.length, 16);
  const shapes = new Set(), artwork = new Set(), families = new Set();
  const sourceEngine = new NullEngine(), sourceScene = new Scene(sourceEngine);
  try {
  for (const entry of manifest.patterns) {
    const packed = await readFile(new URL(`../public/fractures/${entry.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(packed).digest('hex'), entry.sha256);
    const template = decodeFractureBinary(gunzipSync(packed), { lazy: true });
    assert.equal(template.id, entry.id); assert.equal(template.sourceSeed, entry.id);
    assert.equal(template.geometryPose, 'resting'); families.add(template.family);
    const rebuilt = createNineSliceBlock(sourceScene, entry.sourceSeed);
    for (const kind of ['position', 'uv', 'terrainStoneUV']) {
      const actual = template.source.attributes.find(a => a.kind === kind).data, expected = rebuilt.getVerticesData(kind);
      assert.equal(actual.length, expected.length, 'shipped source must include the latest UV-seam topology');
      assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) < 2.5e-5), `pattern ${entry.id}: baked ${kind} must match the current source within codec precision`);
    }
    rebuilt.dispose();
    const fingerprint = values => createHash('sha256').update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)).digest('hex');
    shapes.add(fingerprint(template.fracture.crack.attributes.find(a => a.kind === 'position').data));
    artwork.add(fingerprint(template.source.attributes.find(a => a.kind === 'terrainStoneUV').data));
    for (const fragment of [...template.fracture.fragments, ...template.fracture.secondaryFragments]) {
      const mesh = fragment.mesh, positions = mesh.attributes.find(a => a.kind === 'position').data, vertices = positions.length / 3;
      assert.deepEqual(mesh.metadata.stoneTextureRange, [template.source.metadata.nineSlice.stoneUStart, template.source.metadata.nineSlice.stoneUSpan], 'baked fragments need the same atlas seam period as their intact source');
      assert.ok(Number.isInteger(vertices) && vertices > 0 && positions.every(Number.isFinite));
      for (const attribute of mesh.attributes) assert.ok(attribute.data.length === vertices * attribute.stride && attribute.data.every(Number.isFinite));
      assert.ok(mesh.indices.length % 3 === 0 && mesh.indices.every(i => i < vertices));
      const stage = (fragment.secondary ? template.stages.children : template.stages.resting).find(stage => stage.part === fragment.part);
      assert.deepEqual(positions, stage.positions, 'runtime hydration must use its already prepared pose');
      if (!fragment.secondary) {
        const final = template.stages.supported.find(stage => stage.part === fragment.part);
        assert.equal(final.positions.length, positions.length); assert.equal(final.normals.length, positions.length);
      }
    }
    const replaced = new Set(template.fracture.secondaryFragments.map(f => f.parentPart));
    const falling = [...template.fracture.fragments.filter(f => !replaced.has(f.part)), ...template.fracture.secondaryFragments];
    assert.deepEqual(template.timeline.bodies.map(b => b.part), falling.map(f => f.part));
    assert.equal(template.timeline.values.length, (template.timeline.steps + 1) * falling.length * 8);
    assert.ok(template.timeline.values.every(Number.isFinite));
    for (let i = 7; i < template.timeline.values.length; i += 8) assert.ok(template.timeline.values[i] === 0 || template.timeline.values[i] === 1);
    template.clearDecodedBuffers(); assert.equal(template.decodedBufferBytes, 0);
  }
  } finally { sourceScene.dispose(); sourceEngine.dispose(); }
  assert.equal(shapes.size, 16); assert.equal(artwork.size, 16); assert.equal(families.size, 2);
});

test('baked stage-two endpoint keeps its live morph shader until the damage is disposed', async () => {
  await fractureDecoderReady;
  const packed = await readFile(new URL('../public/fractures/pattern-00.bin.gz', import.meta.url));
  const template = decodeFractureBinary(gunzipSync(packed), { lazy: true });
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const source = restoreFractureMesh(scene, template.source), damage = restoreFracture(source, template.fracture);
    const split = createBakedSplitRoof(damage.fragments, template.stages);
    const original = damage.fragments.map(f => f.mesh.getVerticesData('position').slice());
    const managers = damage.fragments.map(f => f.mesh.morphTargetManager);
    split.update(.999999); split.update(1);
    damage.fragments.forEach((fragment, i) => {
      assert.equal(fragment.mesh.morphTargetManager, managers[i], 'the last visible frame cannot switch shader variants');
      assert.equal(managers[i].getTarget(0).influence, 1);
      assert.deepEqual(fragment.mesh.getVerticesData('position'), original[i], 'the endpoint is displayed through the prepared morph, not an intervening raw-buffer upload');
      const expected = template.stages.supported.find(stage => stage.part === fragment.part);
      assert.deepEqual(managers[i].getTarget(0).getPositions(), expected.positions);
      fragment.mesh.metadata.roofSplit.angle = 99;
      assert.notEqual(expected.roofSplit.angle, 99, 'per-instance pose metadata must not modify its catalog template');
    });
    split.dispose(); split.dispose(); assert.equal(scene.morphTargetManagers.length, 0);
    damage.dispose(); source.dispose(); assert.equal(scene.meshes.length, 0);
  } finally { scene.dispose(); engine.dispose(); }
});

test('the first cracked replacement starts at the intact surface with complete shader inputs and independent buffers', async () => {
  await fractureDecoderReady;
  const packed = await readFile(new URL('../public/fractures/pattern-00.bin.gz', import.meta.url));
  const template = decodeFractureBinary(gunzipSync(packed), { lazy: true });
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const source = restoreFractureMesh(scene, template.source), damage = restoreFracture(source, template.fracture);
    const original = Object.fromEntries(source.getVerticesDataKinds().map(kind => [kind, Array.from(source.getVerticesData(kind))]));
    const surface = createBakedCrackedSurface(source, damage.crack, template.stages, template.family);
    surface.mesh.setEnabled(false);
    assert.notEqual(surface.mesh.geometry, source.geometry, 'warming a hidden replacement cannot change the visible source');
    for (const kind of ['position', 'normal', 'color', 'uv', 'terrainStoneUV']) {
      assert.deepEqual(Array.from(surface.mesh.getVerticesData(kind)), original[kind], 'the first visible replacement must have the intact shape and artwork');
    }
    assert.deepEqual(Array.from(surface.mesh.getVerticesData('terrainAuthoredHeight')), original.position.filter((_, i) => i % 3 === 1), 'authored-height shader inputs must exist before shader preparation, not appear on the first visible frame');
    const originalHeight = Array.from(surface.mesh.getVerticesData('terrainAuthoredHeight'));
    surface.update(.5);
    const middle = surface.mesh.getVerticesData('position');
    assert.ok(middle.some((v, i) => i % 3 === 1 && v < original.position[i] - .02), 'a real partial depression must have begun');
    surface.update(1);
    assert.deepEqual(Array.from(surface.mesh.getVerticesData('position')), Array.from(template.stages.cracked.positions));
    assert.deepEqual(Array.from(surface.mesh.getVerticesData('terrainAuthoredHeight')), originalHeight, 'depression must retain the authored material height');
    for (const [kind, values] of Object.entries(original)) assert.deepEqual(Array.from(source.getVerticesData(kind)), values);
    assert.equal(source.isVerticesDataPresent('terrainAuthoredHeight'), false, 'preparing the replacement cannot change the original shader variant');
    surface.mesh.dispose(false, false); damage.dispose(); source.dispose();
    assert.equal(scene.meshes.length, 0); assert.equal(scene.geometries.length, 0); assert.equal(scene.morphTargetManagers.length, 0);
  } finally { scene.dispose(); engine.dispose(); }
});
