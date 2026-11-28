import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

const randomSource = seed => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

// One small, irregular opacity texture and one plane geometry serve every burst.
// Positions remain under the crack's tile root, including while the board turns.
export function createTerrainDust(scene, { reducedMotion = false, glow } = {}) {
  const texture = new DynamicTexture('terrain-dust-grain', 64, scene, false);
  const context = texture.getContext(), pixels = context.createImageData(64, 64);
  const random = randomSource(7319), lobes = Array.from({ length: 9 }, () => ({
    x: 15 + random() * 34, y: 22 + random() * 20,
    rx: 7 + random() * 12, ry: 4 + random() * 8,
  }));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    let density = 0;
    for (const lobe of lobes) density += Math.exp(-2 * (((x - lobe.x) / lobe.rx) ** 2 + ((y - lobe.y) / lobe.ry) ** 2));
    const edge = Math.sin(Math.PI * x / 63) * Math.sin(Math.PI * y / 63);
    const i = (y * 64 + x) * 4;
    pixels.data.set([255, 255, 255, Math.min(235, density * 110) * edge * (0.62 + random() * 0.38)], i);
  }
  context.putImageData(pixels, 0, 0); texture.hasAlpha = true; texture.update();
  const material = new StandardMaterial('terrain-dust-material', scene);
  material.diffuseTexture = texture; material.useAlphaFromDiffuseTexture = true;
  material.disableLighting = true; material.emissiveColor.set(0.78, 0.65, 0.48);
  material.diffuseColor.set(0, 0, 0); material.specularColor.set(0, 0, 0);
  material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  material.allowShaderHotSwapping = false;
  const prototype = CreatePlane('terrain-dust-prototype', { size: 1 }, scene);
  prototype.material = material; prototype.billboardMode = Mesh.BILLBOARDMODE_ALL;
  // Warm the same translucent, non-uniformly scaled variant as live wisps.
  prototype.visibility = 0.5; prototype.scaling.set(0.20, 0.12, 1);
  prototype.isPickable = false; prototype.setEnabled(false); glow?.addExcludedMesh(prototype);
  const particles = new Set(); let disposed = false;
  const remove = particle => {
    particles.delete(particle); glow?.removeExcludedMesh(particle.mesh);
    particle.mesh.dispose(false, false);
    particle.anchor.dispose();
  };
  const clear = parent => {
    for (const particle of particles) if (!parent || particle.owner === parent) remove(particle);
  };
  return {
    async warm() {
      prototype.computeWorldMatrix(true);
      while (!disposed && !prototype.isReady(true)) await new Promise(resolve => setTimeout(resolve, 16));
    },
    emit(crack, stage, seed, now = performance.now()) {
      if (disposed || crack.isDisposed()) return;
      clear(crack.parent);
      const positions = crack.getVerticesData('position'), random = randomSource(seed + stage * 997);
      if (!positions?.length) return;
      const count = reducedMotion ? 5 : stage === 2 ? 16 : stage === 3 ? 10 : 11;
      for (let i = 0; i < count; i++) {
        const vertex = Math.floor(random() * (positions.length / 3)) * 3;
        // Billboard matrices discard parent orientation. Keep the translated
        // tile-local point in a separate anchor, with the billboard at its origin.
        const anchor = new TransformNode(`terrain-dust-anchor-${stage}-${i}`, scene);
        anchor.parent = crack.parent;
        const mesh = prototype.clone(`terrain-dust-${stage}-${i}`, anchor, true);
        mesh.setEnabled(true); mesh.visibility = 0; mesh.isPickable = false;
        mesh.metadata = { terrainDust: true, dustStage: stage, tileIndex: crack.metadata.tileIndex };
        glow?.addExcludedMesh(mesh);
        const x = positions[vertex] * crack.scaling.x + crack.position.x;
        const y = positions[vertex + 1] * crack.scaling.y + crack.position.y + 0.025;
        const z = positions[vertex + 2] * crack.scaling.z + crack.position.z;
        const size = (stage === 2 ? 0.20 : stage === 3 ? 0.16 : 0.18) + random() * 0.12;
        anchor.position.set(x, y, z); mesh.scaling.set(size * 0.65, size * 0.65 * 0.55, 1);
        mesh.computeWorldMatrix(true);
        particles.add({ mesh, anchor, owner: crack.parent, ready: mesh.isReady(true), requestedAt: now,
          x, y, z, size, stage, start: now + random() * 65,
          duration: reducedMotion ? 300 : 430 + random() * 180,
          dx: (random() - 0.5) * 0.10, dz: (random() - 0.5) * 0.10,
          rise: reducedMotion ? 0.035 : 0.07 + random() * 0.08 });
      }
    },
    update(now) {
      for (const particle of particles) {
        if (!particle.ready) {
          if (particle.mesh.isDisposed() || particle.owner?.isDisposed() || now - particle.requestedAt > 2000) { remove(particle); continue; }
          if (!particle.mesh.isReady(true)) continue;
          particle.ready = true; particle.start = Math.max(particle.start, now);
        }
        const t = (now - particle.start) / particle.duration;
        if (t >= 1 || particle.mesh.isDisposed() || particle.owner?.isDisposed()) { remove(particle); continue; }
        if (t < 0) continue;
        const spread = Math.sin(t * Math.PI / 2), size = particle.size * (0.65 + spread * 0.7);
        particle.anchor.position.set(particle.x + particle.dx * spread, particle.y + particle.rise * spread - (particle.stage === 3 ? 0.22 * t * t : 0), particle.z + particle.dz * spread);
        particle.mesh.scaling.set(size, size * (0.55 + 0.15 * t), 1);
        particle.mesh.visibility = Math.sin(Math.PI * t) ** 1.4 * (reducedMotion ? 0.45 : particle.stage === 3 ? 0.70 : 0.85);
      }
    },
    clear,
    dispose() {
      if (disposed) return;
      disposed = true; clear(); glow?.removeExcludedMesh(prototype);
      prototype.dispose(false, false); material.dispose(false, false); texture.dispose();
    },
  };
}
