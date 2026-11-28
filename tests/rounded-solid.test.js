import test from 'node:test';
import assert from 'node:assert/strict';
import {roundVoxelSolid} from '../src/rounded-solid.js';

function sampleSolid(bounds, spacing, contains) {
  const origin = bounds[0], [nx, ny, nz] = bounds[1].map((value, j) => Math.ceil((value - origin[j]) / spacing) + 1);
  const occupancy = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    occupancy[x + nx * (y + ny * z)] = Number(contains(origin[0] + x * spacing, origin[1] + y * spacing, origin[2] + z * spacing));
  }
  return {occupancy, nx, ny, nz, origin, spacing};
}

function inspectClosedSurface({positions: p, indices, normals}) {
  assert.equal(p.length, normals.length);
  assert.ok(p.every(Number.isFinite)); assert.ok(normals.every(Number.isFinite));
  const edges = new Map(), adjacent = new Map(), unique = new Set();
  let signedVolume = 0;
  for (let id = 0; id < p.length / 3; id++) {
    assert.ok(Math.abs(Math.hypot(...normals.slice(id * 3, id * 3 + 3)) - 1) < 1e-8);
    const key = p.slice(id * 3, id * 3 + 3).map(value => value.toFixed(10)).join(',');
    assert.ok(!unique.has(key), 'coincident surface points should share an indexed vertex'); unique.add(key);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3), A = p.slice(a * 3, a * 3 + 3), B = p.slice(b * 3, b * 3 + 3), C = p.slice(c * 3, c * 3 + 3);
    const ab = B.map((v, j) => v - A[j]), ac = C.map((v, j) => v - A[j]);
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    assert.ok(Math.hypot(...cross) > 1e-12, 'every surface triangle has physical area');
    assert.ok(cross.reduce((sum, value, j) => sum + value * (normals[a * 3 + j] + normals[b * 3 + j] + normals[c * 3 + j]), 0) < 0, 'Babylon clockwise triangles face opposite the outward normal cross');
    signedVolume += (A[0] * (B[1] * C[2] - B[2] * C[1]) + A[1] * (B[2] * C[0] - B[0] * C[2]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(from, to)},${Math.max(from, to)}`, edge = edges.get(key) || {count: 0, winding: 0};
      edge.count++; edge.winding += from < to ? 1 : -1; edges.set(key, edge);
      if (!adjacent.has(from)) adjacent.set(from, new Set()); adjacent.get(from).add(to);
      if (!adjacent.has(to)) adjacent.set(to, new Set()); adjacent.get(to).add(from);
    }
  }
  for (const edge of edges.values()) { assert.equal(edge.count, 2, 'no holes or nonmanifold edges'); assert.equal(edge.winding, 0, 'edge orientations agree'); }
  const visited = new Set(), pending = [indices[0]];
  while (pending.length) { const id = pending.pop(); if (visited.has(id)) continue; visited.add(id); pending.push(...adjacent.get(id)); }
  assert.equal(visited.size, p.length / 3, 'the output is one connected surface');
  assert.equal(p.length / 3 - edges.size + indices.length / 3, 2, 'simple fixtures remain a closed genus-zero solid');
  assert.ok(signedVolume < 0, 'Babylon source and fragment signed-volume conventions agree');
  return -signedVolume;
}

test('rounding removes a long thin spike while retaining the broad original chunk', () => {
  const contains = (x, y, z, margin = 0) => (
    Math.abs(x) <= 0.28 + margin && Math.abs(y) <= 0.24 + margin && Math.abs(z) <= 0.22 + margin
  ) || (x >= 0.28 - margin && x <= 0.60 + margin && Math.abs(y) <= 0.022 + margin && Math.abs(z) <= 0.022 + margin);
  const grid = sampleSolid([[-0.42, -0.38, -0.36], [0.74, 0.38, 0.36]], 0.015, contains), original = grid.occupancy.slice();
  const rounded = roundVoxelSolid({...grid, radius: 0.06}), volume = inspectClosedSurface(rounded);
  assert.deepEqual(grid.occupancy, original, 'rounding cannot mutate the intact source occupancy');
  const xs = rounded.positions.filter((_, i) => i % 3 === 0), ys = rounded.positions.filter((_, i) => i % 3 === 1), zs = rounded.positions.filter((_, i) => i % 3 === 2);
  assert.ok(Math.max(...xs) < 0.34, 'the source spike reaching x=.60 must be physically removed');
  assert.ok(Math.min(...xs) < -0.25 && Math.max(...ys) > 0.21 && Math.max(...zs) > 0.19, 'broad stone faces remain near their original extents');
  assert.ok(volume > 0.75 * (0.56 * 0.48 * 0.44), 'rounding must retain the main stone volume');
  assert.ok(volume < 0.56 * 0.48 * 0.44 + 0.32 * 0.044 ** 2, 'rounding must not inflate the source');
  for (let i = 0; i < rounded.positions.length; i += 3) assert.ok(contains(...rounded.positions.slice(i, i + 3), Math.sqrt(3) * grid.spacing), 'interpolated surface stays inside the source within one grid-cell diagonal');
  assert.ok(rounded.stats.roundOccupied <= rounded.stats.originalOccupied);
});

test('exact-integer radii still produce a closed smooth sphere with outward normals', () => {
  const center = [0.13, -0.07, 0.23], radius = 0.26;
  const grid = sampleSolid([center.map(v => v - 0.38), center.map(v => v + 0.38)], 0.02, (x, y, z) => Math.hypot(x - center[0], y - center[1], z - center[2]) <= radius);
  const result = roundVoxelSolid({...grid, radius: 0.08}), volume = inspectClosedSurface(result);
  assert.ok(volume > 0.80 * 4 / 3 * Math.PI * radius ** 3, 'an already round stone should preserve most of its mass');
  for (let i = 0; i < result.positions.length; i += 3) {
    const radial = result.positions.slice(i, i + 3).map((v, j) => v - center[j]);
    assert.ok(Math.hypot(...radial) < radius + grid.spacing, 'the rounded sphere cannot grow a spike');
    assert.ok(radial.reduce((sum, v, j) => sum + v * result.normals[i + j], 0) > 0, 'sphere normals point away from its center');
  }
  const repeat = roundVoxelSolid({...grid, radius: 0.08});
  assert.deepEqual(repeat.positions, result.positions); assert.deepEqual(repeat.indices, result.indices);
});

test('erosion drops disconnected small crumbs instead of returning loose or open fragments', () => {
  const grid = sampleSolid([[-0.4, -0.4, -0.4], [0.73, 0.4, 0.4]], 0.02, (x, y, z) => Math.hypot(x, y, z) < 0.25 || Math.hypot(x - 0.51, y, z) < 0.085);
  const result = roundVoxelSolid({...grid, radius: 0.06});
  inspectClosedSurface(result);
  assert.equal(result.stats.componentsDiscarded, 1);
  assert.ok(Math.max(...result.positions.filter((_, i) => i % 3 === 0)) < 0.30, 'the separate crumb must not remain as another mesh component');
});

test('production surface stride keeps the same erosion and closes grids with short final intervals', () => {
  const grid = sampleSolid([[-0.43, -0.39, -0.37], [0.43, 0.39, 0.37]], 0.02, (x, y, z) => Math.abs(x - 0.06) < 0.22 && Math.abs(y - 0.04) < 0.20 && Math.abs(z - 0.02) < 0.18);
  assert.ok([grid.nx, grid.ny, grid.nz].some(size => size % 2 === 0), 'fixture includes an odd number of grid intervals');
  const dense = roundVoxelSolid({...grid, radius: 0.07, surfaceStride: 1});
  const production = roundVoxelSolid({...grid, radius: 0.07});
  const denseVolume = inspectClosedSurface(dense), productionVolume = inspectClosedSurface(production);
  assert.equal(production.stats.surfaceStride, 2);
  assert.equal(production.stats.coreOccupied, dense.stats.coreOccupied);
  assert.equal(production.stats.roundOccupied, dense.stats.roundOccupied, 'fewer rendering triangles cannot change tip removal');
  assert.ok(production.indices.length < dense.indices.length * 0.35, 'the production surface materially reduces projection and packing work');
  assert.ok(Math.abs(productionVolume - denseVolume) / denseVolume < 0.035, 'coarser rendering retains the rounded stone volume');
  for (let axis = 0; axis < 3; axis++) {
    const full = dense.positions.filter((_, i) => i % 3 === axis), sparse = production.positions.filter((_, i) => i % 3 === axis);
    assert.ok(Math.abs(Math.min(...full) - Math.min(...sparse)) < grid.spacing);
    assert.ok(Math.abs(Math.max(...full) - Math.max(...sparse)) < grid.spacing, 'the final padded interval cannot clip a positive-facing surface');
  }
});

test('invalid padding and an absent surviving core fail explicitly', () => {
  const solid = new Uint8Array(9 ** 3).fill(1);
  assert.throws(() => roundVoxelSolid({occupancy: solid, nx: 9, ny: 9, nz: 9, spacing: 0.02, radius: 0.04}), /padding/);
  const thin = sampleSolid([[-0.2, -0.2, -0.2], [0.2, 0.2, 0.2]], 0.02, (x, y, z) => Math.abs(x) < 0.08 && Math.abs(y) < 0.01 && Math.abs(z) < 0.08);
  assert.throws(() => roundVoxelSolid({...thin, radius: 0.06}), /no core/);
});
