import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { createTerrainDust } from '../src/terrain-dust.js';

for (const reducedMotion of [false, true]) test(`dust bursts share resources, follow their tile and completely expire (${reducedMotion ? 'reduced' : 'normal'})`, () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  // NullEngine has no DOM canvas; only the procedural texture's pixel sink is
  // substituted. Mesh/material/texture ownership uses the real Babylon classes.
  let textureWrites = 0;
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => { textureWrites++; },
  }) });
  const excluded = new Set(), glow = { addExcludedMesh: m => excluded.add(m), removeExcludedMesh: m => excluded.delete(m) };
  const makeCrack = (tileIndex, x) => {
    const root = new TransformNode(`tile-${tileIndex}`, scene); root.position.x = x;
    const mesh = new Mesh(`crack-${tileIndex}`, scene); mesh.parent = root;
    mesh.metadata = { tileIndex }; mesh.scaling.set(1.16, 1, 1.16);
    mesh.setVerticesData('position', [-.3, .24, -.2, .3, .24, .2, 0, .16, 0]);
    return mesh;
  };
  try {
    const first = makeCrack(2, 1.16), second = makeCrack(3, 2.32);
    first.material = second.material = scene.defaultMaterial;
    const originalMaterials = [...scene.materials], originalTextures = [...scene.textures];
    const original = Array.from(first.getVerticesData('position'));
    const dust = createTerrainDust(scene, { reducedMotion, glow });
    // NullEngine does not compile GPU effects. Control only readiness while the
    // real resource graph and update/expiry paths run; Chrome verifies the shader.
    let gpuReady = false;
    const baseline = { meshes: scene.meshes.length, nodes: scene.transformNodes.length, geometry: scene.geometries.length, materials: scene.materials.length, textures: scene.textures.length };
    const particles = () => scene.meshes.filter(m => m.metadata?.terrainDust);
    for (let cycle = 0; cycle < 12; cycle++) for (const stage of [1, 2, 3]) {
      const now = (cycle * 3 + stage) * 2000;
      first.parent.rotation.y = 0;
      gpuReady = false;
      dust.emit(first, stage, cycle, now); dust.emit(second, stage, cycle + 1, now);
      particles().forEach(mesh => { mesh.isReady = () => gpuReady; }); dust.update(now + 100);
      assert.ok(particles().every(m => m.visibility === 0), 'an unprepared replacement cannot become visible');
      gpuReady = true; dust.update(now + 150); dust.update(now + 250);
      const active = particles();
      assert.ok(active.length > 0 && active.length < 64, 'two concurrent tiles must have a bounded visible burst');
      assert.ok(active.some(m => m.visibility > 0), 'events must produce visible particles, including reduced motion');
      assert.ok(active.every(m => !m.isPickable && m.metadata.dustStage === stage && excluded.has(m)));
      assert.equal(new Set(active.map(m => m.geometry)).size, 1, 'bursts reuse their plane geometry');
      assert.equal(new Set(active.map(m => m.material)).size, 1, 'bursts reuse their material');
      assert.equal(scene.geometries.length, baseline.geometry); assert.equal(scene.materials.length, baseline.materials); assert.equal(scene.textures.length, baseline.textures);
      const particle = active.find(m => m.metadata.tileIndex === 2);
      assert.ok(particle.isDescendantOf(first.parent));
      particle.computeWorldMatrix(true);
      const localAnchor = Vector3.TransformCoordinates(particle.getAbsolutePosition(), first.parent.computeWorldMatrix(true).clone().invert());
      first.parent.rotation.y = Math.PI / 2;
      const expected = Vector3.TransformCoordinates(localAnchor, first.parent.computeWorldMatrix(true));
      particle.computeWorldMatrix(true);
      assert.ok(Vector3.Distance(expected, particle.getAbsolutePosition()) < 1e-6, 'board rotation must move dust anchors with the owning tile');
      dust.clear(first.parent);
      assert.ok(particles().length > 0 && particles().every(m => m.isDescendantOf(second.parent)), 'clearing one tile cannot remove another tile’s effect');
      dust.update(now + 2000);
      assert.equal(particles().length, 0); assert.equal(scene.meshes.length, baseline.meshes); assert.equal(scene.transformNodes.length, baseline.nodes);
    }
    assert.equal(textureWrites, 1, 'emitting and updating bursts cannot regenerate the procedural texture');
    assert.deepEqual(Array.from(first.getVerticesData('position')), original);
    gpuReady = false; dust.emit(first, 1, 18, 90000);
    particles().forEach(mesh => { mesh.isReady = () => gpuReady; }); dust.update(92500);
    assert.equal(particles().length, 0, 'a shader that never becomes ready cannot leave permanent invisible effects');
    dust.emit(first, 3, 19, 99999); dust.dispose(); dust.dispose(); dust.emit(first, 1, 20, 100000);
    assert.equal(particles().length, 0); assert.equal(excluded.size, 0);
    assert.deepEqual(scene.materials, originalMaterials); assert.deepEqual(scene.textures, originalTextures);
    const roots = [first.parent, second.parent];
    first.dispose(); second.dispose(); roots.forEach(root => root.dispose());
    assert.equal(scene.meshes.length, 0); assert.equal(scene.geometries.length, 0); assert.equal(scene.transformNodes.length, 0);
  } finally { scene.dispose(); engine.dispose(); }
});
