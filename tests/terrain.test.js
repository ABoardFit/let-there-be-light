import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { createNineSliceBlock } from '../src/terrain.js';

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
      // Different aspect ratios can need one extra atlas-seam duplicate. The
      // authored grass samples must stay the same, independently of duplication.
      const uniqueUVs = [...new Set(Array.from({ length: uvs.length / 2 }, (_, i) => `${uvs[i * 2].toFixed(10)},${uvs[i * 2 + 1].toFixed(10)}`))].sort();
      if (originalUVs) {
        assert.deepEqual(uniqueUVs, originalUVs);
      } else originalUVs = uniqueUVs;
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('grass is one connected surface with open edges only along its irregular bottom', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const block = createNineSliceBlock(scene, 23, true);
    const grass = block.subMeshes[0];
    const indices = block.getIndices().slice(grass.indexStart, grass.indexStart + grass.indexCount);
    const positions = block.getVerticesData('position');
    // UV discontinuities duplicate attributes, not physical surface vertices.
    const representatives = new Map();
    const spatial = Array.from({ length: positions.length / 3 }, (_, id) => {
      const key = positions.slice(id * 3, id * 3 + 3).map(v => v.toFixed(8)).join(',');
      if (!representatives.has(key)) representatives.set(key, id);
      return representatives.get(key);
    });
    const neighbours = new Map(), edges = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3).map(id => spatial[id]);
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
    const pending = [spatial[indices[0]]], visited = new Set();
    while (pending.length) {
      const vertex = pending.pop();
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      for (const neighbour of neighbours.get(vertex)) pending.push(neighbour);
    }
    assert.equal(visited.size, neighbours.size, 'the top, curved caps and grass sides must form one spatially connected surface');
    const bottom = Math.min(...[...neighbours.keys()].map((vertex) => positions[vertex * 3 + 1]));
    const open = [...edges.values()].filter((edge) => edge.uses === 1);
    assert.ok(open.length > 0, 'the grass surface terminates at the soil boundary');
    for (const edge of edges.values()) assert.ok(edge.uses <= 2, 'a surface edge cannot belong to more than two triangles');
    for (const edge of open) {
      for (const vertex of edge.ends) {
        assert.ok(positions[vertex * 3 + 1] - bottom < 0.060, 'open edges must remain within the 6 cm irregular grass hem; a higher edge exposes an internal seam');
      }
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('every block is a closed oriented solid, including the grass join and underside', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    for (let seed = 0; seed < 25; seed++) {
      const mesh = createNineSliceBlock(scene, seed, false), p = mesh.getVerticesData('position'), indices = mesh.getIndices();
      assert.ok([...p, ...mesh.getVerticesData('normal'), ...mesh.getVerticesData('uv')].every(Number.isFinite), 'every rendered coordinate, normal and UV must be finite');
      const keys = Array.from({length: p.length / 3}, (_, i) => p.slice(i * 3, i * 3 + 3).map(v => v.toFixed(7)).join(','));
      const edges = new Map();
      for (let i = 0; i < indices.length; i += 3) {
        const ids = indices.slice(i, i + 3), a = Vector3.FromArray(p, ids[0] * 3), b = Vector3.FromArray(p, ids[1] * 3), c = Vector3.FromArray(p, ids[2] * 3);
        assert.ok(Vector3.Cross(b.subtract(a), c.subtract(a)).lengthSquared() > 1e-17, 'no collapsed triangles');
        for (let j = 0; j < 3; j++) {
          const from = keys[ids[j]], to = keys[ids[(j + 1) % 3]], key = [from, to].sort().join('|');
          const edge = edges.get(key) || {count: 0, orientation: 0};
          edge.count++; edge.orientation += from < to ? 1 : -1; edges.set(key, edge);
        }
      }
      for (const edge of edges.values()) {
        assert.equal(edge.count, 2, 'every spatial edge must be shared by exactly two faces');
        assert.equal(edge.orientation, 0, 'adjacent faces must have consistent winding');
      }
      const body = mesh.metadata.nineSlice;
      const other = createNineSliceBlock(scene, seed, true);
      assert.deepEqual(mesh.getVerticesData('position'), other.getVerticesData('position'), 'front-row flags cannot truncate or recess any block');
      other.dispose();
      assert.ok(body.bottomIds.length > 32, 'the lower silhouette is resolved by geometry');
      for (let j = 0; j < body.stoneRings[0].length; j++) {
        for (let r = 1; r < body.stoneRings.length; r++) {
          assert.ok(p[body.stoneRings[r][j] * 3 + 1] < p[body.stoneRings[r - 1][j] * 3 + 1], 'stone columns must descend without vertical folds');
        }
      }
      // Measure actual silhouette peaks, independently of the contour generator.
      // A steep broad clod is valid; a deep, narrow downward tip is not.
      const ring = body.stoneRings.at(-1).slice(0, -1), n = ring.length;
      const heights = ring.map(id => p[id * 3 + 1]);
      const distance = (a, b) => Math.hypot(p[ring[a] * 3] - p[ring[b] * 3], p[ring[a] * 3 + 2] - p[ring[b] * 3 + 2]);
      for (let j = 0; j < n; j++) {
        if (!(heights[j] < heights[(j + n - 1) % n] && heights[j] <= heights[(j + 1) % n])) continue;
        const adjacentPeak = direction => {
          let current = j;
          for (let step = 0; step < n; step++) {
            const next = (current + direction + n) % n;
            if (heights[next] < heights[current]) return heights[current];
            current = next;
          }
          return heights[current];
        };
        const prominence = Math.min(adjacentPeak(-1), adjacentPeak(1)) - heights[j];
        if (prominence < 0.03) continue;
        const halfway = heights[j] + prominence / 2;
        const halfWidth = direction => {
          let current = j, width = 0;
          for (let step = 0; step < n; step++) {
            const next = (current + direction + n) % n, length = distance(current, next);
            if (heights[next] >= halfway) return width + length * (halfway - heights[current]) / (heights[next] - heights[current]);
            width += length; current = next;
          }
          return width;
        };
        assert.ok(halfWidth(-1) + halfWidth(1) > 0.04, `block ${seed}: a downward lobe at least 3 cm deep must span over 4 cm at half prominence`);
      }
      mesh.dispose();
    }
  } finally { scene.dispose(); engine.dispose(); }
});

test('stone UVs preserve source pixel aspect and affine height while geometry follows the original clods', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    for (const seed of [0, 1, 4, 12, 17, 24]) {
      const mesh = createNineSliceBlock(scene, seed, true), uv = mesh.getVerticesData('uv'), p = mesh.getVerticesData('position');
      const {stoneRings: rings, bodyDepth} = mesh.metadata.nineSlice;
      for (let j = 0; j < rings[0].length; j++) {
        const top = rings[0][j], bottom = rings.at(-1)[j];
        assert.ok(Math.abs(uv[top * 2 + 1] - 0.53) < 1e-8, 'the stone starts at the original source row');
        assert.ok(uv[bottom * 2 + 1] >= 0.30 && uv[bottom * 2 + 1] < 0.44, 'geometry terminates within the original broad clod rows, including their rounded lower tips');
        for (let r = 0; r < rings.length; r++) {
          const id = rings[r][j];
          const physicalT = (p[top * 3 + 1] - p[id * 3 + 1]) / (bodyDepth * 0.80);
          // Per-column cropping would shrink or warp the original clod shapes.
          assert.ok(Math.abs(uv[id * 2 + 1] - (0.53 - 0.21 * physicalT)) < 1e-8, 'original source V must remain linear through each side column');
          if (j) assert.ok(uv[id * 2] > uv[rings[r][j - 1] * 2], 'source U progresses once around all four faces');
          if (r) assert.ok(uv[id * 2 + 1] < uv[rings[r - 1][j] * 2 + 1], 'stone rows descend exactly once');
        }
      }
      const lowerY = rings.at(-1).map(id => p[id * 3 + 1]);
      assert.ok(Math.max(...lowerY) - Math.min(...lowerY) > 0.15, 'the original broad scallops must remain visible instead of a nearly flat brick bottom');
      // The actual scene scales X/Z by STEP=1.16, but leaves Y unchanged.
      // Compare measured geometry and atlas pixels, not the generator's U-span
      // formula: equal pixel densities preserve the original rock proportions.
      let perimeter = 0;
      for (let j = 1; j < rings[0].length; j++) {
        const a = rings[0][j - 1] * 3, b = rings[0][j] * 3;
        perimeter += Math.hypot(p[b] - p[a], p[b + 2] - p[a + 2]) * 1.16;
      }
      const horizontalDensity = (uv[rings[0].at(-1) * 2] - uv[rings[0][0] * 2]) * 2172 / perimeter;
      for (let j = 0; j < rings[0].length; j++) {
        const top = rings[0][j], bottom = rings.at(-1)[j];
        const verticalDensity = (uv[top * 2 + 1] - uv[bottom * 2 + 1]) * 724 / (p[top * 3 + 1] - p[bottom * 3 + 1]);
        assert.ok(Math.abs(horizontalDensity / verticalDensity - 1) < 0.01, 'original stone pixels must have equal horizontal and vertical world scale');
      }
      assert.equal(mesh.getVerticesData('terrainStoneUV').length, uv.length);
      mesh.dispose();
    }
  } finally { scene.dispose(); engine.dispose(); }
});

test('stone walls keep near-flush contact and the grass blend samples vertical texture detail', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const mesh = createNineSliceBlock(scene, 17), p = mesh.getVerticesData('position'), stoneUV = mesh.getVerticesData('terrainStoneUV');
    const {width, depth, topVertexCount, stoneRings, bodyOutline} = mesh.metadata.nineSlice;
    const wall = stoneRings[2];
    assert.ok(Math.abs(Math.max(...wall.map(id => p[id * 3])) - width / 2) < 1e-8, 'side walls must retain the full tile width');
    assert.ok(Math.abs(Math.max(...wall.map(id => p[id * 3 + 2])) - depth / 2) < 1e-8, 'side walls must retain the full tile depth');
    const diagonal = wall.filter(id => p[id * 3] > width / 2 - 0.02 && p[id * 3 + 2] > depth / 2 - 0.02);
    const nearestCorner = Math.min(...diagonal.map(id => Math.hypot(width / 2 - p[id * 3], depth / 2 - p[id * 3 + 2])));
    assert.ok(nearestCorner < 0.006, 'rounded stone corners must not leave a vertical sky slit between neighbouring tiles');
    const lowerV = bodyOutline.map(id => stoneUV[id * 2 + 1]), upperV = Array.from({length: topVertexCount}, (_,id) => stoneUV[id * 2 + 1]);
    assert.ok(Math.max(...upperV) - Math.max(...lowerV) > 0.015, 'the grass blend must use multiple source rows instead of stretching one row');
    for (const v of lowerV) assert.ok(Math.abs(v - 0.53) < 1e-8, 'grass hem and stone wall must meet at the same source row');
  } finally { scene.dispose(); engine.dispose(); }
});

test('neighbouring tiles show four distinct original stone regions on the same facing wall', () => {
  const engine = new NullEngine(), scene = new Scene(engine), facingCrops = [];
  try {
    for (let seed = 0; seed < 4; seed++) {
      const mesh = createNineSliceBlock(scene, seed), p = mesh.getVerticesData('position'), uv = mesh.getVerticesData('uv');
      const {stoneRings, stoneUStart, stoneUSpan} = mesh.metadata.nineSlice;
      const front = stoneRings[0].reduce((best, id) => {
        const score = Math.abs(p[id * 3]) + p[id * 3 + 2];
        return score < Math.abs(p[best * 3]) + p[best * 3 + 2] ? id : best;
      }, stoneRings[0][0]);
      facingCrops.push((uv[front * 2] - stoneUStart) / stoneUSpan);
      mesh.dispose();
    }
    facingCrops.sort((a, b) => a - b);
    for (let i = 1; i < facingCrops.length; i++) assert.ok(facingCrops[i] - facingCrops[i - 1] > 0.20, 'adjacent tiles must sample distinct quarters of the original stone strip');
  } finally { scene.dispose(); engine.dispose(); }
});

test('visible grass-rim triangles never interpolate across the atlas and share stone-wall texel density', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    for (let seed = 0; seed < 16; seed++) {
      const mesh = createNineSliceBlock(scene, seed), p = mesh.getVerticesData('position'), uv = mesh.getVerticesData('terrainStoneUV'), indices = mesh.getIndices();
      const { stoneUSpan, topVertexCount, bodyOutline, stoneRings } = mesh.metadata.nineSlice;
      const grass = mesh.subMeshes[0]; let visibleTriangles = 0, verticalPairs = 0, duplicatedSeams = 0;
      for (let i = grass.indexStart; i < grass.indexStart + grass.indexCount; i += 3) {
        const ids = indices.slice(i, i + 3);
        if (Math.min(...ids.map(id => p[id * 3 + 1])) >= .20) continue;
        visibleTriangles++;
        const us = ids.map(id => uv[id * 2]);
        assert.ok(Math.max(...us) - Math.min(...us) < stoneUSpan * .1, `pattern ${seed}: a narrow visible rim cannot stretch the whole atlas across one triangle`);
      }
      const samePosition = new Map();
      for (let id = 0; id < topVertexCount; id++) {
        const key = p.slice(id * 3, id * 3 + 3).map(v => v.toFixed(8)).join(',');
        if (samePosition.has(key) && Math.abs(uv[id * 2] - uv[samePosition.get(key) * 2]) > stoneUSpan * .5) {
          duplicatedSeams++;
          assert.ok(Math.abs(Math.abs(uv[id * 2] - uv[samePosition.get(key) * 2]) - stoneUSpan) < 1e-8, 'seam copies differ by exactly one atlas period');
        }
        samePosition.set(key, id);
      }
      for (const hem of bodyOutline) {
        const wall = stoneRings[0].find(id => Math.hypot(p[id * 3] - p[hem * 3], p[id * 3 + 2] - p[hem * 3 + 2]) < 1e-8);
        assert.notEqual(wall, undefined);
        const j = stoneRings[0].indexOf(wall), below = stoneRings[1][j];
        const lowerDensity = (uv[wall * 2 + 1] - uv[below * 2 + 1]) / (p[wall * 3 + 1] - p[below * 3 + 1]);
        for (let above = 0; above < topVertexCount; above++) {
          if (p[above * 3 + 1] <= .03 || p[above * 3 + 1] >= .20 || Math.hypot(p[above * 3] - p[hem * 3], p[above * 3 + 2] - p[hem * 3 + 2]) > 1e-8) continue;
          const upperDensity = (uv[above * 2 + 1] - uv[hem * 2 + 1]) / (p[above * 3 + 1] - p[hem * 3 + 1]);
          assert.ok(Math.abs(upperDensity / lowerDensity - 1) < 1e-7, 'the grass wrap and stone wall must sample the same vertical pixel scale');
          verticalPairs++;
        }
      }
      assert.ok(visibleTriangles > 100 && verticalPairs > 100 && duplicatedSeams > 0, 'the test must include visible walls and actual atlas seams');
      mesh.dispose();
    }
  } finally { scene.dispose(); engine.dispose(); }
});
