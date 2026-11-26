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
  const capWidth = 0.075, capDepth = 0.06;
  let originalUVs;
  try {
    for (const [width, depth] of sizes) {
      const block = createNineSliceBlock(scene, 17, false, { width, depth, capWidth, capDepth });
      const count = block.subMeshes[0].verticesCount;
      const positions = block.getVerticesData('position');
      const world = block.computeWorldMatrix(true);
      const points = Array.from({ length: count }, (_, i) => Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), world));
      const axes = ['x', 'z'].map((key) => [...new Set(points.map((point) => point[key]))].sort((a, b) => a - b));
      for (const [axis, extent, cap] of [[axes[0], width, capWidth], [axes[1], depth, capDepth]]) {
        close(axis[1] - axis[0], cap);
        close(axis.at(-1) - axis.at(-2), cap);
        close(axis.at(-2) - axis[1], extent - 2 * cap);
      }
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
