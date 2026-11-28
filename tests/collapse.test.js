import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { createHash } from 'node:crypto';
import { createNineSliceBlock } from '../src/terrain.js';
import { fractureBlock } from '../src/collapse.js';
import { createCollapseMotion, collapsePose, createCrackedSurface } from '../src/scene.js';

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
      assert.ok(values.every(value => value >= -1e-9 && value <= 1 + 1e-9), `${kind} must remain inside its authored range within interpolation precision`);
    }
  }
  // The mesh intentionally duplicates vertices at UV seams. Compare positions,
  // rather than indices, to detect genuinely open or inconsistently wound cuts.
  const keys = Array.from({ length: vertexCount }, (_, i) => positions.slice(i * 3, i * 3 + 3).map(value => Math.round(value * 1e9)).join(','));
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

function patternHash(result, crackOnly = false) {
  const arrays = crackOnly
    ? [result.crack.getVerticesData('position'), result.crack.getIndices()]
    : result.fragments.map(({ root, mesh }) => [root.position.asArray(), mesh.position.asArray(), mesh.getVerticesData('position'), mesh.getIndices()]);
  return createHash('sha256').update(JSON.stringify(arrays)).digest('hex');
}

function inspectVolumeCuts(fragments) {
  let turfFree = 0, obliqueFaces = 0;
  const centers = [];
  for (const { mesh } of fragments) {
    const positions = mesh.getVerticesData('position'), normals = mesh.getVerticesData('normal'), indices = mesh.getIndices();
    const turf = mesh.subMeshes.filter(part => part.materialIndex === 0).reduce((sum, part) => sum + part.indexCount, 0);
    if (!turf) turfFree++;
    const heights = Array.from({ length: positions.length / 3 }, (_, i) => positions[i * 3 + 1]);
    centers.push((Math.min(...heights) + Math.max(...heights)) / 2);
    const cuts = mesh.subMeshes.filter(part => part.materialIndex === 2);
    assert.ok(cuts.some(part => part.indexCount > 0), 'each solid fragment needs a separately textured interior cut surface');
    for (const sub of cuts) {
      for (let i = sub.indexStart; i < sub.indexStart + sub.indexCount; i += 3) {
        const ids = indices.slice(i, i + 3), n = normals.slice(ids[0] * 3, ids[0] * 3 + 3);
        // Inspect the actual new interior triangles, not the original curved
        // stone walls, whose normals would also contain vertical components.
        if (Math.abs(n[1]) > 0.15 && Math.hypot(n[0], n[2]) > 0.15) obliqueFaces++;
      }
    }
    const surfaces = mesh.metadata.cutSurfaces;
    assert.ok(surfaces?.length > 0, 'interior triangles must identify their shared cut surface');
    let curvedSurfaces = 0, groupedIndices = 0;
    for (const surface of surfaces) {
      assert.ok(cuts.some(part => surface.indexStart >= part.indexStart && surface.indexStart + surface.indexCount <= part.indexStart + part.indexCount), 'cut groups must refer only to actual interior geometry');
      groupedIndices += surface.indexCount;
      let largestArea = 0, plane;
      const points = new Set();
      for (let i = surface.indexStart; i < surface.indexStart + surface.indexCount; i += 3) {
        const ids = indices.slice(i, i + 3);
        ids.forEach(id => points.add(id));
        const [a, b, c] = ids.map(id => Vector3.FromArray(positions, id * 3));
        const cross = Vector3.Cross(b.subtract(a), c.subtract(a)), area = cross.length();
        if (area > largestArea) { largestArea = area; plane = { origin: a, normal: cross.scale(1 / area) }; }
      }
      assert.ok(plane, 'each grouped cut needs actual triangles');
      let departure = 0;
      for (const id of points) departure = Math.max(departure, Math.abs(Vector3.Dot(Vector3.FromArray(positions, id * 3).subtract(plane.origin), plane.normal)));
      // Several intersecting flat planes would also look nonplanar together.
      // Measure one cut ID at a time, using its largest actual triangle as a
      // stable reference, so a flat knife cut cannot pass this requirement.
      if (departure > 0.003) curvedSurfaces++;
    }
    assert.equal(groupedIndices, cuts.reduce((sum, part) => sum + part.indexCount, 0), 'groups must cover every interior triangle');
    assert.ok(curvedSurfaces > 0, 'each fragment must expose actual curved cut geometry, not only a shaded flat plane');
  }
  assert.ok(turfFree > 0, 'height cuts must create stone-only fragments, not exclusively grass-topped columns');
  assert.ok(obliqueFaces > 0, 'new cut surfaces must include normals tilted in three dimensions');
  assert.ok(Math.max(...centers) - Math.min(...centers) > 0.15, 'pieces must occupy distinct vertical regions');
}

function inspectSupportOrder(tileIndex, fragments, options = {}) {
  const motion = createCollapseMotion(tileIndex, fragments, options);
  assert.deepEqual(motion, createCollapseMotion(tileIndex, fragments, options), 'the same variant and family must reproduce the same motion');
  assert.ok(motion.every(item => item.family === options.family && item.variant === options.variant));
  for (const item of motion) for (const t of [0, .2, .4, .6, .8, 1]) {
    const pose = collapsePose(item, 2, t);
    assert.ok(Math.hypot(pose.offset.x, pose.offset.z) < 1e-9, 'partial collapse must not spread into adjacent tiles');
    assert.ok(pose.rotation.length() < 1e-9, 'partial collapse must descend without tipping into adjacent tiles');
  }
  let supportedPairs = 0;
  for (let lower = 0; lower < fragments.length; lower++) {
    for (let upper = 0; upper < fragments.length; upper++) {
      const a = fragments[lower], b = fragments[upper];
      if (a.supportGroup !== b.supportGroup || a.supportLayer !== 0 || b.supportLayer !== 1) continue;
      supportedPairs++;
      assert.equal(motion[lower].affected, motion[upper].affected, 'the turf and its supporting soil must fail as one column');
      assert.ok(motion[lower].lag <= motion[upper].lag && motion[lower].fallLag <= motion[upper].fallLag, 'supporting soil must begin releasing before its turf');
      const originalGap = b.center.y - a.center.y;
      assert.ok(originalGap > 0, 'the declared support layer must actually be below its upper chunk');
      for (const stage of [2, 3]) for (const t of [0, .1, .25, .35, .5, .65]) {
        const low = collapsePose(motion[lower], stage, t), high = collapsePose(motion[upper], stage, t);
        const gap = b.center.y + high.offset.y - a.center.y - low.offset.y;
        assert.ok(gap >= originalGap - 1e-8, 'falling turf cannot close the original vertical gap by passing into its support');
        if (high.offset.y < -1e-4) assert.ok(low.offset.y < high.offset.y - 1e-4, 'when the upper chunk starts falling, the lower chunk must already be farther down');
      }
    }
  }
  assert.ok(supportedPairs >= 4, 'the test must exercise real upper/lower columns, not an empty support graph');
  let siblingPairs = 0;
  for (let i = 0; i < fragments.length; i++) for (let j = i + 1; j < fragments.length; j++) {
    const a = fragments[i], b = fragments[j];
    if (a.supportGroup !== b.supportGroup || a.supportLayer !== b.supportLayer) continue;
    siblingPairs++;
    const distance = Vector3.Distance(a.base, b.base);
    for (const t of [.7, .85, 1]) {
      const left = collapsePose(motion[i], 3, t), right = collapsePose(motion[j], 3, t);
      const movedDistance = Vector3.Distance(a.base.add(left.offset), b.base.add(right.offset));
      // Babylon stores its rotation matrix in Float32 even when source vertex
      // arrays are doubles. This tolerance is below a visible displacement.
      assert.ok(Math.abs(movedDistance - distance) < 1e-6, 'late tumble must keep same-layer chunks at their original separation');
      assert.ok(Vector3.Distance(left.rotation, right.rotation) < 1e-8, 'same-layer chunks must rotate as one rigid assembly');
    }
  }
  if (fragments.length > 8) assert.ok(siblingPairs > 0, 'extra subdivisions must exercise the sibling collision regression');
  const columns = new Map();
  fragments.forEach((fragment, i) => {
    if (!columns.has(fragment.supportGroup)) columns.set(fragment.supportGroup, []);
    columns.get(fragment.supportGroup).push(i);
  });
  let visibleTilts = 0;
  for (const ids of columns.values()) {
    const radial = ids.reduce((sum, i) => sum.addInPlace(fragments[i].base.scale(fragments[i].volume)), Vector3.Zero());
    radial.y = 0; radial.normalize();
    for (const i of ids) for (const t of [.5, .65, .75, .82, .9]) {
      const pose = collapsePose(motion[i], 3, t), r = pose.rotation;
      const up = Vector3.TransformNormal(Vector3.Up(), Matrix.RotationYawPitchRoll(r.y, r.x, r.z)).normalize();
      const lean = Vector3.Dot(up, radial), expectedSign = options.family === 'inward' ? -1 : 1;
      assert.ok(lean * expectedSign >= -1e-6, 'the actual top orientation must lean in the selected radial direction');
      if (Math.abs(lean) > .10 && pose.fade > .5) visibleTilts++;
    }
  }
  assert.ok(visibleTilts > 0, 'the family must visibly tip the upper surface rather than only translate its center');
}

function inspectCrackedSurface(source, crack) {
  const sourcePositions = [...source.getVerticesData('position')], crackPositions = [...crack.getVerticesData('position')];
  const sourceColors = [...source.getVerticesData('color')];
  const surface = createCrackedSurface(source, crack);
  assert.notEqual(surface.mesh.geometry, source.geometry, 'subsidence needs a separate restorable geometry');
  assert.ok(!source.isVerticesDataPresent('terrainAuthoredHeight'), 'damage cannot add shader inputs to the intact source');
  assert.deepEqual(surface.mesh.getVerticesData('terrainAuthoredHeight'), sourcePositions.filter((_, i) => i % 3 === 1), 'texture blending must keep the original material height while geometry sinks');
  const topCount = source.metadata.nineSlice.topVertexCount;
  const center = Array.from({ length: topCount }, (_, i) => i).reduce((best, i) => Math.hypot(sourcePositions[i * 3], sourcePositions[i * 3 + 2]) < Math.hypot(sourcePositions[best * 3], sourcePositions[best * 3 + 2]) ? i : best, 0);
  surface.update(.5);
  const halfDepth = sourcePositions[center * 3 + 1] - surface.mesh.getVerticesData('position')[center * 3 + 1];
  surface.update(1); surface.mesh.computeWorldMatrix(true);
  const depressed = surface.mesh.getVerticesData('position'), depth = sourcePositions[center * 3 + 1] - depressed[center * 3 + 1];
  assert.ok(depth >= .12 && depth <= .16 && halfDepth > 0 && halfDepth < depth, 'stage one must visibly lower the center progressively');
  for (let i = 0; i < depressed.length; i += 3) {
    assert.ok(depressed[i] === sourcePositions[i] && depressed[i + 2] === sourcePositions[i + 2]);
    if (Math.max(Math.abs(sourcePositions[i]), Math.abs(sourcePositions[i + 2])) > .47) assert.equal(depressed[i + 1], sourcePositions[i + 1], 'the outer tile boundary must stay fixed');
  }
  inspectSolid(surface.mesh);
  const marks = crack.getVerticesData('position'), stride = Math.max(1, Math.floor(marks.length / 3 / 20));
  for (let vertex = 0; vertex < marks.length / 3; vertex += stride) {
    const i = vertex * 3, hit = surface.mesh.intersects(new Ray(new Vector3(marks[i], 2, marks[i + 2]), new Vector3(0, -1, 0)), false);
    assert.ok(hit.hit, 'the crack must stay over the deformed turf');
    assert.ok(Math.abs(marks[i + 1] - hit.pickedPoint.y - .004) < 1e-5, 'the crack must follow the actual triangles instead of floating above the depression');
  }
  assert.deepEqual(source.getVerticesData('position'), sourcePositions, 'subsidence cannot deform the intact source');
  surface.update(0);
  assert.ok(surface.mesh.getVerticesData('position').every((value, i) => value === sourcePositions[i]));
  assert.deepEqual(surface.mesh.getVerticesData('color'), sourceColors, 'resetting the damaged copy must also remove its local depression shading');
  assert.deepEqual(crack.getVerticesData('position'), crackPositions);
  surface.mesh.dispose();
}

test('rounded fragments have closed cut faces, bounded remeshing and preserved source attributes', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    for (const [seed, variant] of [[0, 0], [0, 1], [12, 0], [24, 0], [19, 19]]) {
      const source = createNineSliceBlock(scene, seed), sourceVolume = inspectSolid(source);
      source.metadata.tileIndex = seed;
      const original = new Map(['position', 'normal', 'uv', 'color', 'terrainStoneUV', 'terrainBottomLight'].map(kind => [kind, [...source.getVerticesData(kind)]]));
      const originalIndices = [...source.getIndices()], sourceLow = [Infinity, Infinity, Infinity], sourceHigh = [-Infinity, -Infinity, -Infinity];
      original.get('position').forEach((value, i) => { const axis = i % 3; sourceLow[axis] = Math.min(sourceLow[axis], value); sourceHigh[axis] = Math.max(sourceHigh[axis], value); });
      const result = fractureBlock(source, { variant });
      assert.equal(result.variant, variant);
      assert.ok(result.fragments.length >= 8 && result.fragments.length <= 12, 'each tile must partition into 8–12 solid fragments');
      inspectVolumeCuts(result.fragments);
      inspectCrackedSurface(source, result.crack);
      for (const family of ['inward', 'outward']) inspectSupportOrder(seed, result.fragments, { family, variant });
      const naturalMotion = createCollapseMotion(seed, result.fragments, { variant });
      assert.deepEqual(naturalMotion, createCollapseMotion(seed, result.fragments, { variant, family: naturalMotion[0].family }), 'forcing the selected family must reproduce the natural seeded path');
      let fragmentVolume = 0;
      for (const { mesh } of result.fragments) {
        const volume = inspectSolid(mesh);
        assert.equal(mesh.metadata.fractureVariant, variant);
        assert.equal(Math.sign(volume), Math.sign(sourceVolume), 'each fragment keeps outward face orientation');
        const { cellSize, radius } = mesh.metadata.roundedSolid;
        assert.ok(cellSize > 0 && radius > 0 && cellSize <= radius / 4 + 1e-9, 'the rounded surface needs at least four grid samples across its radius');
        const p = mesh.getVerticesData('position'), low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.length; i++) { const axis = i % 3; low[axis] = Math.min(low[axis], p[i]); high[axis] = Math.max(high[axis], p[i]); }
        const extent = high.map((value, axis) => value - low[axis]);
        for (let axis = 0; axis < 3; axis++) {
          const tolerance = cellSize * Math.sqrt(3) + 1e-7;
          assert.ok(low[axis] >= sourceLow[axis] - tolerance && high[axis] <= sourceHigh[axis] + tolerance, 'rounded fragments cannot grow beyond the source except for one sampling-cell diagonal');
        }
        assert.ok(Math.max(...extent) / Math.min(...extent) < 4, 'fragments must be solid rock chunks rather than long narrow blades');
        assert.ok(Math.abs(volume) / extent.reduce((a, b) => a * b, 1) > 0.20, 'a fragment must occupy substantial space inside its bounds rather than form a thin wedge');
        fragmentVolume += volume;
      }
      // Removing thin protrusions and rolling the fractured shoulders removes
      // material only from the disposable copies. Final tolerance is measured
      // against the whole solid, independently of reported fragment metadata.
      const loss = (Math.abs(sourceVolume) - Math.abs(fragmentVolume)) / Math.abs(sourceVolume);
      assert.ok(loss >= -1e-6 && loss <= 0.12, 'rounded chunks must retain at least 88% of the original volume without inflation');
      for (const [kind, values] of original) assert.deepEqual(source.getVerticesData(kind), values, `fracturing cannot change the restorable source ${kind}`);
      assert.deepEqual(source.getIndices(), originalIndices, 'fracturing cannot change the restorable source topology');
      result.dispose(); source.dispose();
      assert.equal(scene.meshes.length, 0);
      assert.equal(scene.transformNodes.length, 0);
    }
  } finally { scene.dispose(); engine.dispose(); }
});

test('tile identity and reset variants change real partitions while camera and board rotation do not', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const parent = new TransformNode('board', scene), source = createNineSliceBlock(scene, 0);
    source.parent = parent;
    const camera = new ArcRotateCamera('test-camera', -Math.PI / 2, 0.94, 8, Vector3.Zero(), scene);
    const geometryHashes = new Set(), crackHashes = new Set(), variantVolumes = new Map();
    for (const [tileIndex, variant] of [[0, 0], [12, 0], [24, 0], [0, 1]]) {
      // Keep the source identical: diversity must come from destruction, not
      // from different underlying grass/stone terrain seeds.
      source.metadata.tileIndex = tileIndex;
      const first = fractureBlock(source, { variant }), geometry = patternHash(first), crack = patternHash(first, true);
      if (tileIndex === 0) {
        const total = first.fragments.reduce((sum, fragment) => sum + fragment.volume, 0);
        variantVolumes.set(variant, first.fragments.map(fragment => Math.round(fragment.volume / total * 1e5)).sort((a, b) => a - b));
      }
      geometryHashes.add(geometry); crackHashes.add(crack); first.dispose();
      camera.alpha += Math.PI / 2; camera.beta = 1.3; parent.rotation.y += Math.PI / 2;
      const rotated = fractureBlock(source, { variant });
      assert.equal(patternHash(rotated), geometry, 'the camera and board yaw cannot change local fracture geometry');
      assert.equal(patternHash(rotated, true), crack, 'the camera and board yaw cannot repaint the crack layout');
      rotated.dispose();
    }
    assert.equal(geometryHashes.size, 4, 'different tiles and variants must not reuse a fixed cut template');
    assert.equal(crackHashes.size, 4, 'different tiles and variants must show different crack paths');
    assert.notDeepEqual(variantVolumes.get(0), variantVolumes.get(1), 'a new variant must repartition the solid, not only rotate an identical set of chunks');
    source.dispose(); parent.dispose(); camera.dispose();
    assert.equal(scene.meshes.length, 0); assert.equal(scene.transformNodes.length, 0);
  } finally { scene.dispose(); engine.dispose(); }
});

test('a failed fragment allocation rolls back partial meshes and permits a clean retry', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const source = createNineSliceBlock(scene, 0); source.metadata.tileIndex = 0;
    const baseline = { meshes: scene.meshes.length, nodes: scene.transformNodes.length, geometries: scene.geometries.length };
    const originalPositions = [...source.getVerticesData('position')], addMesh = scene.addMesh;
    let allocatedFragments = 0;
    scene.addMesh = function(mesh, ...args) {
      const result = addMesh.call(this, mesh, ...args);
      if (mesh.name.includes('-fragment-') && ++allocatedFragments === 2) throw new Error('injected fracture allocation failure');
      return result;
    };
    try { assert.throws(() => fractureBlock(source), /injected fracture allocation failure/); }
    finally { scene.addMesh = addMesh; }
    assert.equal(allocatedFragments, 2, 'the failure must occur after partial fragment construction');
    assert.deepEqual({ meshes: scene.meshes.length, nodes: scene.transformNodes.length, geometries: scene.geometries.length }, baseline, 'failed construction must release every partial mesh, transform and buffer');
    assert.deepEqual(source.getVerticesData('position'), originalPositions);
    const retry = fractureBlock(source);
    assert.ok(retry.fragments.length >= 8 && retry.fragments.length <= 12);
    assert.ok(retry.fragments.every(({root}) => !root.isEnabled()), 'new pieces must remain hidden until their stage is displayed');
    retry.dispose();
    assert.deepEqual({ meshes: scene.meshes.length, nodes: scene.transformNodes.length, geometries: scene.geometries.length }, baseline);
    source.dispose();
    assert.equal(scene.meshes.length, 0); assert.equal(scene.transformNodes.length, 0);
  } finally { scene.dispose(); engine.dispose(); }
});
