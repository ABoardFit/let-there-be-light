import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createNineSliceBlock } from '../src/terrain.js';
import { fractureBlock } from '../src/collapse.js';

function inspectSolid(mesh) {
  const positions = mesh.getVerticesData('position'), indices = mesh.getIndices();
  const vertexCount = positions.length / 3;
  assert.ok(positions.every(Number.isFinite));
  for (const [kind, stride] of [['normal', 3], ['uv', 2], ['color', 4], ['terrainStoneUV', 2], ['terrainBottomLight', 1]]) {
    const values = mesh.getVerticesData(kind);
    assert.equal(values.length, vertexCount * stride, `${kind} must accompany every clipped vertex`);
    assert.ok(values.every(Number.isFinite), `${kind} must remain finite after interpolation`);
    // Grass UVs deliberately wrap past 0..1; the stone atlas and light mask do not.
    if (kind === 'terrainStoneUV' || kind === 'terrainBottomLight') {
      assert.ok(values.every(value => value >= 0 && value <= 1), `${kind} must remain inside its authored range`);
    }
  }
  // The mesh intentionally duplicates vertices at UV seams. Compare positions,
  // rather than indices, to detect genuinely open or inconsistently wound cuts.
  const keys = Array.from({ length: vertexCount }, (_, i) => positions.slice(i * 3, i * 3 + 3).map(value => Math.round(value * 1e7)).join(','));
  const edges = new Map();
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i, i + 3);
    const [a, b, c] = ids.map(id => positions.slice(id * 3, id * 3 + 3));
    const ab = b.map((value, axis) => value - a[axis]), ac = c.map((value, axis) => value - a[axis]);
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    // Near-flat grass creates valid slivers around 2e-11 in cross length.
    assert.ok(Math.hypot(...cross) > 1e-12, 'clipping cannot create a collapsed triangle');
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (let j = 0; j < 3; j++) {
      const from = keys[ids[j]], to = keys[ids[(j + 1) % 3]], key = [from, to].sort().join('|');
      const edge = edges.get(key) || { uses: 0, orientation: 0 };
      edge.uses++; edge.orientation += from < to ? 1 : -1; edges.set(key, edge);
    }
  }
  for (const edge of edges.values()) {
    assert.equal(edge.uses, 2, 'each fracture boundary must be closed by an actual cut face');
    assert.equal(edge.orientation, 0, 'cut faces must agree with the original surface winding');
  }
  return volume;
}

test('fractured blocks have closed cut faces, conserve volume and preserve shader attributes', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    for (const seed of [0, 12, 24]) {
      const source = createNineSliceBlock(scene, seed), sourceVolume = inspectSolid(source);
      const originalPositions = [...source.getVerticesData('position')], originalUV = [...source.getVerticesData('uv')];
      const result = fractureBlock(source);
      assert.equal(result.fragments.length, 5);
      let fragmentVolume = 0;
      for (const { mesh } of result.fragments) {
        const volume = inspectSolid(mesh);
        assert.equal(Math.sign(volume), Math.sign(sourceVolume), 'each fragment keeps outward face orientation');
        fragmentVolume += volume;
      }
      assert.ok(Math.abs(fragmentVolume - sourceVolume) < 1e-6, 'partitioning must preserve the original solid volume');
      assert.deepEqual(source.getVerticesData('position'), originalPositions, 'fracturing cannot deform the restorable source');
      assert.deepEqual(source.getVerticesData('uv'), originalUV, 'fracturing cannot repaint the restorable source');
      result.dispose(); source.dispose();
      assert.equal(scene.meshes.length, 0);
      assert.equal(scene.transformNodes.length, 0);
    }
  } finally { scene.dispose(); engine.dispose(); }
});
