import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { createNineSliceBlock } from '../src/scene.js';

test('resizing a nine-slice block preserves world-space caps and source UVs', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
  const sizes = [[0.99, 0.99], [1.6, 0.99], [0.99, 1.3], [1.8, 1.4]];
  const capWidth = 0.125, capDepth = 0.105;
  let originalUVs;
  try {
    for (const [width, depth] of sizes) {
      const block = createNineSliceBlock(scene, 17, false, { width, depth, capWidth, capDepth });
      const count = block.subMeshes[0].verticesCount;
      const positions = block.getVerticesData('position');
      const world = block.computeWorldMatrix(true);
      const points = Array.from({ length: count }, (_, i) => Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), world));
      const extent = (ids, key) => {
        const values = ids.map((id) => points[id][key]);
        return Math.max(...values) - Math.min(...values);
      };
      // Read the actual vertices of each semantic patch, including its curved subdivisions.
      // A resized uniform box would fail these physical cap measurements.
      for (const corner of block.metadata.nineSlice.patches.filter((patch) => patch.kind === 'corner')) {
        close(extent(corner.vertexIndices, 'x'), capWidth);
        close(extent(corner.vertexIndices, 'z'), capDepth);
      }
      const center = block.metadata.nineSlice.patches.find((patch) => patch.kind === 'center');
      close(extent(center.vertexIndices, 'x'), width - 2 * capWidth);
      close(extent(center.vertexIndices, 'z'), depth - 2 * capDepth);
      close(extent(center.vertexIndices, 'y'), 0);
      const uvs = Array.from(block.getVerticesData('uv').slice(0, count * 2));
      if (originalUVs) {
        assert.equal(uvs.length, originalUVs.length);
        uvs.forEach((value, i) => close(value, originalUVs[i]));
      } else originalUVs = uvs;
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('grass is one connected surface with open edges only along its bottom', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const block = createNineSliceBlock(scene, 23, true);
    const grass = block.subMeshes[0];
    const indices = block.getIndices().slice(grass.indexStart, grass.indexStart + grass.indexCount);
    const positions = block.getVerticesData('position');
    const neighbours = new Map(), edges = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3);
      for (const [from, to] of [[a, b], [b, c], [c, a]]) {
        if (!neighbours.has(from)) neighbours.set(from, new Set());
        if (!neighbours.has(to)) neighbours.set(to, new Set());
        neighbours.get(from).add(to);
        neighbours.get(to).add(from);
        const ends = [from, to].sort((x, y) => x - y), key = ends.join(',');
        const edge = edges.get(key) || { ends, uses: 0 };
        edge.uses++;
        edges.set(key, edge);
      }
    }
    const pending = [indices[0]], visited = new Set();
    while (pending.length) {
      const vertex = pending.pop();
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      for (const neighbour of neighbours.get(vertex)) pending.push(neighbour);
    }
    assert.equal(visited.size, neighbours.size, 'the top, curved caps and grass sides must share vertices');
    const bottom = Math.min(...[...neighbours.keys()].map((vertex) => positions[vertex * 3 + 1]));
    const open = [...edges.values()].filter((edge) => edge.uses === 1);
    assert.ok(open.length > 0, 'the grass surface terminates at the soil boundary');
    for (const edge of edges.values()) assert.ok(edge.uses <= 2, 'a surface edge cannot belong to more than two triangles');
    for (const edge of open) {
      for (const vertex of edge.ends) {
        assert.ok(Math.abs(positions[vertex * 3 + 1] - bottom) < 1e-8, 'an open edge above the bottom would expose an internal seam');
      }
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
