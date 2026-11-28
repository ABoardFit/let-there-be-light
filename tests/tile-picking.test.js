import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { pickTileTop } from '../src/scene.js';

test('logical top picking covers each tile and ignores actors, cracks and decorative side geometry', () => {
  for (let size = 1; size <= 5; size++) for (let index = 0; index < size * size; index++) {
    const x = (index % size - (size - 1) / 2) * 1.16, z = ((size - 1) / 2 - Math.floor(index / size)) * 1.16;
    for (const stage of [0, 1, 2, 3]) {
      const stages = new Array(size * size).fill(0); stages[index] = stage;
      for (const dx of [-.5, 0, .5]) for (const dz of [-.5, 0, .5]) {
        const ray = new Ray(new Vector3(x + dx, 4, z + dz), Vector3.Down());
        assert.equal(pickTileTop(ray, { size, stages }), stage === 3 ? null : index);
      }
    }
  }
});

test('top picking rejects soil sides, outside points and holes even when a farther raised tile could be hit', () => {
  assert.equal(pickTileTop(new Ray(new Vector3(0, -.2, 4), new Vector3(0, 0, -1)), { size: 5 }), null, 'a side-facing ray cannot select soil');
  assert.equal(pickTileTop(new Ray(new Vector3(0, -.2, 0), Vector3.Down()), { size: 5 }), null, 'a point below the surface cannot hit its underside');
  assert.equal(pickTileTop(new Ray(new Vector3(3, 4, 0), Vector3.Down()), { size: 5 }), null);
  assert.equal(pickTileTop(new Ray(new Vector3(0, 4, 0), Vector3.Down(), .5), { size: 5 }), null);
  const slanted = new Ray(new Vector3(-1.335, 2, .58), new Vector3(1, -1, 0));
  assert.equal(pickTileTop(slanted, { size: 2, heights: [1, 0, 0, 0] }), 0);
  assert.equal(pickTileTop(slanted, { size: 2, heights: [1, 0, 0, 0], stages: [3, 0, 0, 0] }), null, 'a removed near tile cannot redirect the click onto a farther tile');
});

test('board-local picking remains correct after quarter-turn world rotations', () => {
  const original = new Ray(new Vector3(-2.32, 4, 1.16), Vector3.Down());
  for (const angle of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    const board = Matrix.RotationY(angle), worldRay = Ray.Transform(original, board);
    const localRay = Ray.Transform(worldRay, board.clone().invert());
    assert.equal(pickTileTop(localRay, { size: 5 }), 5);
  }
});
