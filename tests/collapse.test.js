import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildPhysicsTimeline } from '../src/contact-physics.js';
import { snapshotContactFragments } from '../src/contact-preparer.js';
import { createNineSliceBlock } from '../src/terrain.js';
import { fractureBlock, createFractureCrack } from '../src/collapse.js';
import { snapshotFracture, restoreFracture, fractureTransferables } from '../src/fracture-data.js';
import { createCollapseMotion, collapsePose, createCrackedSurface, createSplitRoof } from '../src/scene.js';

function inspectSolid(mesh) {
  const positions = mesh.getVerticesData('position'), indices = mesh.getIndices();
  const vertexCount = positions.length / 3;
  assert.ok(positions.every(Number.isFinite));
  for (const [kind, stride] of [['normal', 3], ['uv', 2], ['color', 4], ['terrainStoneUV', 2], ['terrainBottomLight', 1]]) {
    const values = mesh.getVerticesData(kind);
    assert.equal(values.length, vertexCount * stride, `${kind} must accompany every clipped vertex`);
    assert.ok(values.every(Number.isFinite), `${kind} must remain finite after interpolation`);
    if (kind === 'terrainBottomLight') {
      assert.ok(values.every(value => value >= -1e-9 && value <= 1 + 1e-9), `${kind} must remain inside its authored range within interpolation precision`);
    }
    if (kind === 'terrainStoneUV') {
      const span = mesh.metadata.stoneTextureRange?.[1] ?? mesh.metadata.nineSlice?.stoneUSpan ?? 0;
      assert.ok(values.every((value, i) => value >= -1e-9 && value <= 1 + (i % 2 ? 0 : span) + 1e-9), 'stone V stays in the atlas; seam U may unwrap by one period before fragment-shader wrapping');
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

let havokBinary;
async function inspectSupportOrder(tileIndex, fragments, options = {}) {
  havokBinary ??= await readFile(new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm')));
  const raw = snapshotContactFragments(fragments);
  const timeline = await buildPhysicsTimeline(raw, { ...options, seed: tileIndex }, { wasmBinary: havokBinary });
  assert.equal(timeline.engine, 'Havok');
  assert.ok(timeline.dt > 0 && timeline.dt <= 1 / 60);
  assert.equal(timeline.count, fragments.length);
  assert.equal(timeline.values.length, (timeline.steps + 1) * timeline.count * 8);
  assert.ok(timeline.values.every(Number.isFinite));
  assert.ok(timeline.bodies.every(body => body.mass > 0));
  const motion = createCollapseMotion(tileIndex, fragments, { ...options, timeline });
  const repeated = createCollapseMotion(tileIndex, fragments, { ...options, timeline });
  assert.deepEqual(motion, repeated, 'the same cached physical trajectory must play identically');
  let moving = 0, turning = 0;
  for (let i = 0; i < fragments.length; i++) {
    const initial = collapsePose(motion[i], 3, 0);
    assert.ok(initial.offset.length() < 1e-6 && initial.rotation.length() < 1e-6, 'the physical plan must start at its submitted stage-two pose');
    assert.equal(initial.scale, 1, 'stage two cannot inherit the later shrink early');
    const center = Vector3.FromArray(timeline.bodies[i].center), base = fragments[i].base;
    let previousScale = 1;
    for (const t of [.08, .1, .13, .16, .179999, .18]) {
      const pose = collapsePose(motion[i], 3, t);
      const renderedCenter = base.add(pose.offset).add(center.subtract(base).scale(pose.scale));
      assert.ok(Vector3.Distance(renderedCenter, center) < 1e-6, 'space-making shrink must keep the actual body center fixed');
      assert.ok(pose.scale <= previousScale + 1e-9 && pose.scale > .7);
      previousScale = pose.scale;
    }
    assert.equal(previousScale, timeline.bodies[i].scale, 'render and Havok must share the same collision scale');
    const beforePhysics = collapsePose(motion[i], 3, .18 - 1e-7), afterPhysics = collapsePose(motion[i], 3, .18);
    assert.ok(Vector3.Distance(beforePhysics.offset, afterPhysics.offset) < 1e-6 && Math.abs(beforePhysics.scale - afterPhysics.scale) < 1e-6, 'shrink-to-physics handoff must be continuous');
    for (const t of [.1, .25, .4, .6, .8, 1]) {
      const pose = collapsePose(motion[i], 3, t);
      assert.deepEqual(pose, collapsePose(repeated[i], 3, t));
      assert.ok([...pose.offset.asArray(), ...pose.quaternion.asArray(), pose.fade].every(Number.isFinite));
      assert.ok(Math.abs(pose.quaternion.length() - 1) < 1e-5);
      assert.ok(pose.fade >= 0 && pose.fade <= 1);
    }
    const middle = collapsePose(motion[i], 3, .6);
    if (middle.offset.y < -.03) moving++;
    if (middle.rotation.length() > .03) turning++;
    assert.equal(collapsePose(motion[i], 3, 1).fade, 0);
  }
  assert.ok(moving >= fragments.length * .75, 'the real solver must move the main body, not return a zero-pose metadata fallback');
  assert.ok(turning > 0, 'physical bodies must actually turn while collapsing');
  // Exact pair distances and lower-first ordering are deliberately not required:
  // independent bodies may contact and roll. Actual mesh overlap and the visible
  // upper/lower cadence are checked against the bent production meshes in WebGL.
}

function inspectCrackedSurface(source, crack, family) {
  const sourcePositions = [...source.getVerticesData('position')], crackPositions = [...crack.getVerticesData('position')];
  const sourceColors = [...source.getVerticesData('color')];
  const surface = createCrackedSurface(source, crack, { family });
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

function meshWorldPositions(mesh) {
  const base = mesh.getVerticesData('position'), p = [...base], matrix = mesh.computeWorldMatrix(true);
  const manager = mesh.morphTargetManager;
  for (let i = 0; manager && i < manager.numTargets; i++) {
    const target = manager.getTarget(i), positions = target.getPositions();
    if (positions) for (let j = 0; j < p.length; j++) p[j] += (positions[j] - base[j]) * target.influence;
  }
  return Array.from({ length: p.length / 3 }, (_, i) => Vector3.TransformCoordinates(Vector3.FromArray(p, i * 3), matrix));
}

function inspectSplitRoof(source, fragments, family) {
  const saved = fragments.map(f => ({ p: [...f.mesh.getVerticesData('position')], n: [...f.mesh.getVerticesData('normal')], world: meshWorldPositions(f.mesh) }));
  const initialManagers = source.getScene().morphTargetManagers.length;
  const split = createSplitRoof(fragments, family), direction = family === 'inward' ? -1 : 1;
  const footprint = meshWorldPositions(source), low = [0, 2].map(axis => Math.min(...footprint.map(v => v.asArray()[axis]))), high = [0, 2].map(axis => Math.max(...footprint.map(v => v.asArray()[axis])));
  // The authored .999-wide block leaves a tiny seam inside its 1-unit grid
  // cell. Opening pieces may use that seam without entering the next cell.
  const origin = source.getAbsolutePosition();
  for (const [j, axis] of ['x', 'z'].entries()) {
    low[j] = Math.min(low[j], origin[axis] - .5 * source.scaling[axis]);
    high[j] = Math.max(high[j], origin[axis] + .5 * source.scaling[axis]);
  }
  const tilted = new Set();
  for (const t of [0, .25, .5, .75, 1 - 1e-7, 1]) {
    split.update(t);
    fragments.forEach((f, i) => {
      const world = meshWorldPositions(f.mesh);
      const anchor = f.mesh.metadata.roofSplit.anchor;
      assert.ok(world.every((v, j) => saved[i].p[j * 3 + 1] > anchor || Vector3.Distance(v, saved[i].world[j]) < 1e-8), 'the anchored foot of each soil column must remain stationary');
      if (f.supportLayer === 1) {
        for (const v of world) for (const [j, axis] of ['x', 'z'].entries()) assert.ok(v[axis] >= low[j] - .0001 && v[axis] <= high[j] + .0001, `roof footprint tile=${source.metadata.tileIndex} family=${family} t=${t} axis=${axis} value=${v[axis]} bounds=${low[j]},${high[j]}`);
        if (t === .75) {
          const siblings = fragments.filter(part => part.supportGroup === f.supportGroup && part.supportLayer === 1);
          const radial = siblings.reduce((sum, part) => sum.addInPlace(part.center.scale(part.volume)), Vector3.Zero()); radial.y = 0; radial.normalize();
          let lean = 0, area = 0;
          const indices = f.mesh.getIndices();
          for (const sub of f.mesh.subMeshes.filter(s => s.materialIndex === 0)) for (let j = sub.indexStart; j < sub.indexStart + sub.indexCount; j += 3) {
            const ids = indices.slice(j, j + 3), [a, b, c] = ids.map(id => saved[i].world[id]);
            const before = Vector3.Cross(b.subtract(a), c.subtract(a)).normalize(); if (before.y < 0) before.scaleInPlace(-1);
            if (before.y < .9999) continue;
            const [x, y, z] = ids.map(id => world[id]), after = Vector3.Cross(y.subtract(x), z.subtract(x)); if (after.y < 0) after.scaleInPlace(-1);
            const weight = after.length(); after.normalize();
            lean += Vector3.Dot(after.subtract(before), radial) * weight; area += weight;
          }
          if (area > .001 && lean / area * direction > .008) tilted.add(f.supportGroup);
        }
        if (t === 1 - 1e-7) saved[i].beforeBake = world;
        if (t === 1) {
          assert.ok(world.every((v, j) => Vector3.Distance(v, saved[i].beforeBake[j]) < 1e-5), 'baking the final split pose cannot pop a piece before the fall');
          assert.ok(f.mesh.subMeshes.some(s => s.materialIndex === 2 && s.indexCount > 0), 'opened upper pieces require actual interior cut faces');
          let beforeArea = 0, afterArea = 0;
          const indices = f.mesh.getIndices();
          for (const sub of f.mesh.subMeshes.filter(s => s.materialIndex === 0)) for (let j = sub.indexStart; j < sub.indexStart + sub.indexCount; j += 3) {
            const ids = indices.slice(j, j + 3);
            const areaXZ = points => { const [a,b,c] = ids.map(id => points[id]); return Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x)); };
            beforeArea += areaXZ(saved[i].world); afterArea += areaXZ(world);
          }
          if (beforeArea > .005) assert.ok(afterArea / beforeArea >= .84, 'the mild split must retain most of its grass standing area');
          assert.ok(world.every((v, j) => saved[i].p[j * 3 + 1] < .15 || Math.abs(v.y - saved[i].world[j].y) < .08), 'roof fragments cannot rise into separate high platforms');
        }
      }
    });
  }
  assert.ok(tilted.size >= 2, 'separate upper pieces must visibly tilt in the chosen direction');
  assert.equal(source.getScene().morphTargetManagers.length, initialManagers, 'baking must release every temporary morph target manager');
  split.dispose();
  fragments.forEach((f, i) => {
    f.mesh.setVerticesData('position', saved[i].p); f.mesh.setVerticesData('normal', saved[i].n);
    f.root.position.copyFrom(f.base); f.root.rotation.setAll(0); f.root.scaling.setAll(1);
  });
}

function inspectTransport(source, result) {
  const scene = source.getScene(), before = [scene.meshes.length, scene.transformNodes.length, scene.geometries.length];
  const raw = snapshotFracture(result), buffers = fractureTransferables(raw);
  const transported = structuredClone(raw, { transfer: buffers });
  assert.ok(buffers.every(buffer => buffer.byteLength === 0), 'worker transfer should move only snapshot-owned buffers');
  if (result.secondaryFragments?.length) {
    const addMesh = scene.addMesh, childName = result.secondaryFragments[1].mesh.name;
    let injected = false;
    scene.addMesh = function(mesh, ...args) {
      const added = addMesh.call(this, mesh, ...args);
      if (mesh.name === childName) { injected = true; throw new Error('injected child hydration failure'); }
      return added;
    };
    try { assert.throws(() => restoreFracture(source, transported), /injected child hydration failure/); }
    finally { scene.addMesh = addMesh; }
    assert.ok(injected, 'the failure must occur after a parent and an earlier child were allocated');
    assert.deepEqual([scene.meshes.length, scene.transformNodes.length, scene.geometries.length], before, 'a failed child hydration must roll back parents and partial children together');
  }
  const restored = restoreFracture(source, transported);
  const originals = [...result.fragments, ...(result.secondaryFragments || [])];
  const copies = [...restored.fragments, ...(restored.secondaryFragments || [])];
  assert.equal(copies.length, originals.length);
  for (const [i, original] of [result.crack, ...originals.map(f => f.mesh)].entries()) {
    const actual = [restored.crack, ...copies.map(f => f.mesh)][i];
    for (const kind of original.getVerticesDataKinds()) assert.deepEqual(actual.getVerticesData(kind), original.getVerticesData(kind), `worker transport must preserve ${kind}`);
    assert.deepEqual(Array.from(actual.getIndices()), Array.from(original.getIndices()), 'typed transport must preserve the actual triangle index values');
    assert.deepEqual(actual.subMeshes.map(s => [s.materialIndex, s.indexStart, s.indexCount]), original.subMeshes.map(s => [s.materialIndex, s.indexStart, s.indexCount]));
  }
  copies.forEach((f, i) => {
    assert.ok(!f.root.isEnabled(), 'hydrated pieces must remain hidden until their stage is displayed');
    for (const kind of ['columnConstraints', 'solidConstraints']) for (const [j, constraint] of (f[kind] || []).entries()) for (const point of [[-.3, -.2, .17], [.13, .2, -.23], [0, 0, 0]]) assert.equal(constraint.field(point), originals[i][kind][j].field(point), 'serialized cut definitions must rebuild the same field');
    for (const key of ['parentPart', 'secondary', 'sizeRatio']) assert.equal(f[key], originals[i][key]);
    if (f.secondary) assert.equal(f.secondaryCut.field([.1, -.2, .3]), originals[i].secondaryCut.field([.1, -.2, .3]));
  });
  restored.dispose();
  assert.deepEqual([scene.meshes.length, scene.transformNodes.length, scene.geometries.length], before);
  const crack = createFractureCrack(source, { variant: result.variant });
  assert.equal(patternHash(crack, true), patternHash(result, true), 'the immediate crack must match the eventual worker partition');
  assert.equal(crack.fragments.length, 0, 'the first click cannot synchronously build solid fragments');
  crack.dispose();
}

test('secondary cuts replace existing parents with closed smaller solids and survive worker transfer', async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    for (const [seed, variant] of [[0, 0], [12, 1], [24, 0]]) {
      const source = createNineSliceBlock(scene, seed); source.metadata.tileIndex = seed;
      const sourceBefore = source.getVerticesDataKinds().map(kind => [kind, [...source.getVerticesData(kind)]]);
      const base = fractureBlock(source, { variant });
      const parentHash = patternHash(base); base.dispose();
      const result = fractureBlock(source, { variant, secondary: true });
      assert.equal(patternHash(result), parentHash, 'preparing later cuts must leave every accepted stage-two parent unchanged');
      const groups = new Map();
      for (const child of result.secondaryFragments) {
        const parent = result.fragments.find(f => f.part === child.parentPart);
        assert.ok(parent && child.secondary, 'each extra piece must come from a real existing parent');
        assert.ok(!child.root.isEnabled(), 'children must not overlap visible parents before the replacement pulse');
        assert.equal(child.supportGroup, parent.supportGroup);
        assert.equal(child.supportLayer, parent.supportLayer);
        const volume = inspectSolid(child.mesh), parentVolume = inspectSolid(parent.mesh);
        assert.equal(Math.sign(volume), Math.sign(parentVolume));
        assert.ok(Math.abs(Math.abs(volume / parentVolume) - child.sizeRatio) < 1e-8, 'reported size must match the actual closed solid');
        const p = child.mesh.getVerticesData('position'), bounds = parent.bounds;
        const tolerance = child.mesh.metadata.roundedSolid.surfaceSpacing * Math.sqrt(3) + 1e-7;
        for (let i = 0; i < p.length; i++) assert.ok(p[i] >= bounds.min[i % 3] - tolerance && p[i] <= bounds.max[i % 3] + tolerance, 'children cannot spawn unrelated material beyond the parent sampling margin');
        assert.ok(child.mesh.subMeshes.some(s => s.materialIndex === 2 && s.indexCount > 0), 'a secondary split needs a real textured interior');
        if (!groups.has(parent.part)) groups.set(parent.part, []);
        groups.get(parent.part).push({ child, volume: Math.abs(volume), parentVolume: Math.abs(parentVolume) });
      }
      assert.ok(groups.size >= 2 && groups.size <= 3, 'several existing clods must actually subdivide');
      for (const pieces of groups.values()) {
        assert.equal(pieces.length, 2);
        const retained = pieces.reduce((sum, p) => sum + p.volume, 0) / pieces[0].parentVolume;
        assert.ok(retained > .90 && retained <= 1.000001, 'secondary rounding may trim a narrow rim, not erase or duplicate the parent mass');
        const sizes = pieces.map(p => p.volume).sort((a, b) => a - b);
        assert.ok(sizes[0] / sizes[1] < .7, 'the added break must make a smaller chip and a larger supporting clod');
      }
      if (seed === 0) {
        const replaced = new Set(groups.keys());
        const falling = [...result.fragments.filter(f => !replaced.has(f.part)), ...result.secondaryFragments];
        for (const family of ['inward', 'outward']) await inspectSupportOrder(seed, falling, { family, variant });
      }
      inspectTransport(source, result);
      for (const [kind, values] of sourceBefore) assert.deepEqual(source.getVerticesData(kind), values);
      result.dispose(); source.dispose();
      assert.deepEqual([scene.meshes.length, scene.transformNodes.length, scene.geometries.length], [0, 0, 0]);
    }
  } finally { scene.dispose(); engine.dispose(); }
});

test('rounded fragments have closed cut faces, bounded remeshing and preserved source attributes', async () => {
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
      for (const family of ['inward', 'outward']) inspectCrackedSurface(source, result.crack, family);
      for (const family of ['inward', 'outward']) await inspectSupportOrder(seed, result.fragments, { family, variant });
      const naturalMotion = createCollapseMotion(seed, result.fragments, { variant });
      assert.deepEqual(naturalMotion, createCollapseMotion(seed, result.fragments, { variant, family: naturalMotion[0].family }), 'forcing the selected family must reproduce the natural seeded path');
      let fragmentVolume = 0;
      for (const { mesh } of result.fragments) {
        const volume = inspectSolid(mesh);
        assert.deepEqual(mesh.metadata.stoneTextureRange, [source.metadata.nineSlice.stoneUStart, source.metadata.nineSlice.stoneUSpan], 'every broken piece must retain the original atlas wrap range');
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
      inspectTransport(source, result);
      for (const family of ['inward', 'outward']) inspectSplitRoof(source, result.fragments, family);
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
