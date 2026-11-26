import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Culling/ray.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import { Layer } from '@babylonjs/core/Layers/layer.js';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
// Register the WebGL shaders before first render, including on static Pages hosts.
import '@babylonjs/core/Shaders/default.vertex.js';
import '@babylonjs/core/Shaders/default.fragment.js';
import '@babylonjs/core/Shaders/layer.vertex.js';
import '@babylonjs/core/Shaders/layer.fragment.js';
import '@babylonjs/core/Shaders/color.vertex.js';
import '@babylonjs/core/Shaders/color.fragment.js';
import '@babylonjs/core/Shaders/shadowMap.vertex.js';
import '@babylonjs/core/Shaders/shadowMap.fragment.js';
import '@babylonjs/core/Shaders/glowMapGeneration.vertex.js';
import '@babylonjs/core/Shaders/glowMapGeneration.fragment.js';
import '@babylonjs/core/Shaders/glowMapMerge.vertex.js';
import '@babylonjs/core/Shaders/glowMapMerge.fragment.js';
import '@babylonjs/core/Shaders/kernelBlur.vertex.js';
import '@babylonjs/core/Shaders/kernelBlur.fragment.js';
import '@babylonjs/core/Shaders/glowBlurPostProcess.fragment.js';
import '@babylonjs/core/Shaders/pass.fragment.js';
import '@babylonjs/core/Shaders/passCube.fragment.js';
import '@babylonjs/core/Shaders/postprocess.vertex.js';

const SIZE = 10;
const hex = (value) => Color3.FromHexString(value);
const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));

function randomSource(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(x, y) {
  const hash = (a, b) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const xi = Math.floor(x), yi = Math.floor(y);
  let u = x - xi, v = y - yi;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

function fractal(x, y) {
  return noise(x, y) * 0.54 + noise(x * 2.03 + 11, y * 2.03) * 0.27
    + noise(x * 4.1, y * 4.1 + 17) * 0.13 + noise(x * 8.3, y * 8.3) * 0.06;
}

function texture(scene, name, size, paint) {
  const result = new DynamicTexture(name, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  paint(result.getContext(), result.getSize().width, result.getSize().height);
  result.update(false);
  return result;
}

function paintSky(ctx, width, height) {
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x / width, py = y / height;
      const warp = fractal(px * 4 + 21, py * 5 + 8);
      const cloud = fractal(px * 5.7 + warp * 2.3, py * 7.5 + warp * 1.7);
      const ridge = clamp((cloud - 0.34) * 3.4);
      const side = fractal(px * 5.7 + warp * 2.3 + 0.025, py * 7.5 + warp * 1.7 - 0.04);
      const rim = clamp((side - cloud) * 15 + 0.48);
      const sun = Math.exp(-((px - 0.75) ** 2 * 11 + (py - 0.23) ** 2 * 8));
      const sky = [117 + py * 103 + sun * 24, 105 + py * 44 + sun * 35, 149 - py * 22 + sun * 4];
      const tint = [141 + rim * 98 + sun * 10, 115 + rim * 48 + sun * 13, 147 - rim * 28];
      const haze = clamp((py - 0.65) * 0.9);
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const col = sky[c] * (1 - ridge) + tint[c] * ridge;
        img.data[i + c] = col * (1 - haze) + [244, 177, 143][c] * haze;
      }
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const glow = ctx.createRadialGradient(width * 0.75, height * 0.23, 0, width * 0.75, height * 0.23, width * 0.36);
  glow.addColorStop(0, '#ffe5b856'); glow.addColorStop(0.4, '#ffd5a91a'); glow.addColorStop(1, '#ffd5a900');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
}

function paintGround(ctx, size, variant, rock = false) {
  const rng = randomSource(2451 + variant * 37);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fractal(x / 33 + variant * 4, y / 33 + 7);
      const grain = (rng() - 0.5) * (rock ? 35 : 42);
      const p = (y * size + x) * 4;
      const edge = Math.min(x, y, size - x, size - y);
      const shade = rock ? 1 : 0.74 + Math.min(edge / 12, 1) * 0.26;
      const base = rock ? [94 + n * 72, 77 + n * 57, 66 + n * 54]
        : [58 + n * 96 + variant * 3, 71 + n * 87 + variant * 2, 35 + n * 42];
      for (let c = 0; c < 3; c++) img.data[p + c] = (base[c] + grain) * shade;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (!rock) {
    for (let i = 0; i < 180; i++) {
      const x = 7 + rng() * (size - 14), y = 7 + rng() * (size - 14);
      ctx.fillStyle = rng() > 0.5 ? '#c2ba7b70' : '#314d2a75';
      ctx.fillRect(x, y, 0.5 + rng() * 2, 1 + rng() * 3);
    }
    ctx.strokeStyle = '#ded09a38'; ctx.lineWidth = 1.5;
    ctx.strokeRect(3.5, 3.5, size - 7, size - 7);
  } else {
    for (let i = 0; i < 12; i++) {
      ctx.beginPath(); ctx.moveTo(0, rng() * size);
      ctx.lineTo(size * 0.5, rng() * size); ctx.lineTo(size, rng() * size);
      ctx.strokeStyle = '#332e2725'; ctx.lineWidth = 1 + rng() * 2; ctx.stroke();
    }
  }
}

function beveledTile(scene) {
  const mesh = new Mesh('moss-tile-template', scene);
  const positions = [], indices = [], uvs = [];
  const outline = [[-0.455, -0.49], [0.455, -0.49], [0.49, -0.455], [0.49, 0.455],
    [0.455, 0.49], [-0.455, 0.49], [-0.49, 0.455], [-0.49, -0.455]];
  for (const [x, z] of outline) { positions.push(x * 0.95, 0.16, z * 0.95); uvs.push(x + 0.5, z + 0.5); }
  for (let i = 1; i < 7; i++) indices.push(0, i, i + 1);
  const topIndexCount = indices.length;
  for (const [scale, y] of [[0.95, 0.16], [1, 0.125], [1, -0.08], [0.96, -0.13]]) {
    for (let j = 0; j <= 8; j++) {
      const [x, z] = outline[j % 8]; positions.push(x * scale, y, z * scale); uvs.push(j / 2, (y + 0.2) * 2);
    }
  }
  for (let ring = 0; ring < 3; ring++) {
    for (let j = 0; j < 8; j++) {
      const a = 8 + ring * 9 + j, b = a + 1;
      indices.push(a, b + 9, b, a, a + 9, b + 9);
    }
  }
  const normals = []; VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData(); Object.assign(data, { positions, indices, normals, uvs }); data.applyToMesh(mesh);
  mesh.convertToFlatShadedMesh();
  mesh.releaseSubMeshes();
  // Flat shading uses unindexed draws, so both vertex and index ranges must split.
  new SubMesh(0, 0, topIndexCount, 0, topIndexCount, mesh);
  new SubMesh(1, topIndexCount, mesh.getTotalVertices() - topIndexCount, topIndexCount, indices.length - topIndexCount, mesh);
  return mesh;
}

function paintPine(ctx, width, height) {
  const r = randomSource(998);
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  ctx.fillStyle = '#68422c'; ctx.fillRect(cx - width * 0.025, height * 0.18, width * 0.05, height * 0.78);
  for (let tier = 0; tier < 33; tier++) {
    const y = height * (0.13 + tier * 0.023);
    const span = width * (0.03 + tier * 0.012) * (0.8 + r() * 0.2);
    for (let s = -1; s <= 1; s += 2) {
      for (let branch = 0; branch < 8; branch++) {
        const endX = cx + s * span * (0.5 + r() * 0.5), endY = y + height * (0.02 + r() * 0.035);
        ctx.strokeStyle = ['#284b27', '#3e602c', '#5b7938', '#83914a'][Math.floor(r() * 4)];
        ctx.lineWidth = 1.5 + r() * 2.5;
        ctx.beginPath(); ctx.moveTo(cx + (r() - 0.5) * 10, y - 8); ctx.lineTo(endX, endY); ctx.stroke();
        for (let n = 0; n < 8; n++) {
          const t = n / 8, nx = cx + (endX - cx) * t, ny = y - 8 + (endY - y + 8) * t;
          ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx + s * (3 + r() * 6), ny - 5 - r() * 11); ctx.stroke();
        }
      }
    }
  }
}

export async function createWorld(canvas, { tiles, onTileClick, onHover, reducedMotion = false }) {
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.61, 0.49, 0.62, 1);
  scene.ambientColor = hex('#bba5b0');
  scene.imageProcessingConfiguration.contrast = 1.08;
  scene.imageProcessingConfiguration.exposure = 1.03;
  const camera = new ArcRotateCamera('island-camera', -Math.PI / 2 + 0.12, 0.70, 23, new Vector3(0, -0.15, 0), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1; camera.maxZ = 100;
  const sky = new Layer('painted-sunset', null, scene, true);
  sky.texture = texture(scene, 'sunset-clouds', { width: 1024, height: 768 }, paintSky);
  const ambient = new HemisphericLight('sky-light', new Vector3(-0.2, 1, -0.2), scene);
  ambient.intensity = 0.7; ambient.diffuse = hex('#f5dfcc'); ambient.groundColor = hex('#635671');
  const sun = new DirectionalLight('late-afternoon-sun', new Vector3(-0.65, -1.4, -0.7), scene);
  sun.position = new Vector3(7, 14, 6); sun.diffuse = hex('#ffe1b7'); sun.intensity = 1.15;
  sun.shadowMinZ = 0.1; sun.shadowMaxZ = 45;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true; shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
  shadows.bias = 0.002; shadows.normalBias = 0.025; shadows.darkness = 0.2;
  shadows.getShadowMap().refreshRate = 0;
  const glow = new GlowLayer('warm-lantern-bloom', scene, { mainTextureFixedSize: 512, blurKernelSize: 32 });
  glow.intensity = 0.45;

  const material = (name, color, emission) => {
    const m = new StandardMaterial(name, scene); m.diffuseColor = hex(color);
    m.specularColor = new Color3(0.06, 0.05, 0.035);
    if (emission) m.emissiveColor = hex(emission);
    return m;
  };
  const groundMaterials = Array.from({ length: 6 }, (_, i) => {
    const m = material(`moss-${i}`, '#ffffff');
    const tone = 0.78 + i * 0.044;
    m.diffuseColor.set(tone * 0.99, tone, tone * 0.95);
    m.diffuseTexture = texture(scene, `moss-grain-${i}`, 256, (ctx, size) => paintGround(ctx, size, i));
    return m;
  });
  const stone = material('weathered-rock', '#d8bba4');
  stone.diffuseTexture = texture(scene, 'rock-strata', 256, (ctx, size) => paintGround(ctx, size, 3, true));
  const darkStone = material('rock-shadow', '#715b65');
  const moss = material('edge-moss', '#53613a');
  moss.backFaceCulling = false;
  const bark = material('cedar-bark', '#6f4930');
  const foliage = [material('pine-deep', '#294f32'), material('pine-mid', '#456b36'), material('pine-lit', '#698742')];
  const gold = material('aged-brass', '#c59549'); gold.specularColor = hex('#7b5c39');
  const ivory = material('shrine-limestone', '#cfba91');
  const darkMetal = material('lantern-iron', '#554344');
  const warmGlass = material('lantern-light', '#ffd892', '#ffbe55');
  const flowerMaterials = [material('flower-cream', '#f6daa3'), material('flower-blush', '#e7a6a5'), material('flower-center', '#cc8d38')];
  const pebbleMat = material('weathered-pebbles', '#b0a18b');
  pebbleMat.specularColor.set(0.025, 0.022, 0.018);
  const tileMaterials = groundMaterials.map((ground, i) => {
    const m = new MultiMaterial(`grass-and-cut-stone-${i}`, scene);
    m.subMaterials = [ground, stone]; return m;
  });
  const pineMaterial = material('painted-pine', '#ffffff', '#ffffff');
  pineMaterial.disableLighting = true;
  pineMaterial.diffuseTexture = texture(scene, 'fallback-pine', { width: 256, height: 384 }, paintPine);
  pineMaterial.diffuseTexture.hasAlpha = true;
  pineMaterial.useAlphaFromDiffuseTexture = true;
  pineMaterial.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
  pineMaterial.alphaCutOff = 0.32; pineMaterial.backFaceCulling = false;
  const contactMaterial = material('soft-contact-shadow', '#302b20', '#302b20');
  contactMaterial.disableLighting = true; contactMaterial.alpha = 0.42;
  contactMaterial.diffuseTexture = texture(scene, 'contact-shadow', 64, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, '#ffffffcc'); gradient.addColorStop(0.4, '#ffffff66'); gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  });
  contactMaterial.diffuseTexture.hasAlpha = true; contactMaterial.useAlphaFromDiffuseTexture = true;
  contactMaterial.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  const loadArt = (name, alpha = false) => new Promise((resolve) => {
    let art;
    art = new Texture(`${import.meta.env.BASE_URL}textures/${name}`, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE,
      () => { art.hasAlpha = alpha; art.anisotropicFilteringLevel = 8; resolve(art); },
      () => { art?.dispose(); resolve(null); });
  });
  const [mossArt, cliffArt, pineArt, skyArt] = await Promise.all([
    loadArt('moss-ground.png'), loadArt('rock-cliff.png'), loadArt('pine-tree.png', true), loadArt('sunset-clouds.png'),
  ]);
  if (mossArt) groundMaterials.forEach((m) => { m.diffuseTexture.dispose(); m.diffuseTexture = mossArt; });
  if (cliffArt) { stone.diffuseTexture.dispose(); stone.diffuseTexture = cliffArt; darkStone.diffuseTexture = cliffArt; pebbleMat.diffuseTexture = cliffArt; }
  if (pineArt) { pineMaterial.diffuseTexture.dispose(); pineMaterial.diffuseTexture = pineArt; }
  if (skyArt) { sky.texture.dispose(); sky.texture = skyArt; }
  const rng = randomSource(1087);
  const decorations = new Map();
  const groundTiles = [];
  const casterMeshes = new Set();
  const cast = (mesh) => { shadows.addShadowCaster(mesh); casterMeshes.add(mesh); };
  const coord = (i) => new Vector3(i % SIZE - 4.5, 0, Math.floor(i / SIZE) - 4.5);
  const register = (mesh, mat, parent, x = 0, y = 0, z = 0) => {
    mesh.material = mat; mesh.parent = parent; mesh.position.set(x, y, z); mesh.isPickable = false; return mesh;
  };

  // The jagged, tapered rock body is one mesh, with a separate moss lip above it.
  const perimeter = [];
  for (let x = -5; x < 5; x++) perimeter.push([x, -5]);
  for (let z = -5; z < 5; z++) perimeter.push([5, z]);
  for (let x = 5; x > -5; x--) perimeter.push([x, 5]);
  for (let z = 5; z > -5; z--) perimeter.push([-5, z]);
  const pos = [], idx = [], uv = [];
  for (let ring = 0; ring < 4; ring++) {
    perimeter.forEach(([x, z], i) => {
      const jitter = ring ? (rng() - 0.5) * 0.42 : 0;
      const scale = [1, 0.99, 0.90, 0.65][ring];
      pos.push(x * scale + jitter, [-0.12, -0.65, -1.15, -1.8][ring] - rng() * (ring * 0.13), z * scale + jitter);
      uv.push(i / 5, ring * 0.7);
    });
  }
  for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 40; i++) {
    const a = ring * 40 + i, b = ring * 40 + (i + 1) % 40;
    idx.push(a, a + 40, b + 40, a, b + 40, b);
  }
  const body = new Mesh('floating-rock-strata', scene);
  const bodyData = new VertexData(); const bodyNormals = [];
  VertexData.ComputeNormals(pos, idx, bodyNormals); Object.assign(bodyData, { positions: pos, indices: idx, normals: bodyNormals, uvs: uv });
  bodyData.applyToMesh(body); body.convertToFlatShadedMesh(); body.material = stone; body.isPickable = false;
  const bottom = CreateCylinder('island-heart', { diameterTop: 8, diameterBottom: 3.5, height: 1.35, tessellation: 7 }, scene);
  bottom.position.y = -1.65; bottom.material = darkStone; bottom.scaling.z = 0.88; bottom.isPickable = false;

  const edgeBits = [];
  perimeter.forEach(([x, z], i) => {
    if (i % 2 === 0) {
      const crag = CreateCylinder(`stone-tooth-${i}`, { diameterTop: 0.78, diameterBottom: 0.25, height: 0.7 + rng() * 0.8, tessellation: 5 }, scene);
      crag.position.set(x * 0.97, -0.92 - rng() * 0.25, z * 0.97); crag.rotation.y = rng() * 6;
      crag.material = stone; edgeBits.push(crag);
    }
  });
  const crags = Mesh.MergeMeshes(edgeBits, true, true); if (crags) crags.isPickable = false;
  // Tapered grass blades form a broken organic edge, without round moss blobs.
  const grassPositions = [], grassIndices = [], grassColors = [];
  for (let i = 0; i < 150; i++) {
    const edge = Math.floor(rng() * 4), edgeAlong = (rng() - 0.5) * 9.7;
    const edgeAcross = 4.88 + (rng() - 0.5) * 0.12;
    const x = edge < 2 ? edgeAlong : edgeAcross * (edge === 2 ? 1 : -1);
    const z = edge < 2 ? edgeAcross * (edge === 0 ? 1 : -1) : edgeAlong;
    for (let blade = 0; blade < 4; blade++) {
      const angle = rng() * Math.PI * 2, w = 0.012 + rng() * 0.012, height = 0.06 + rng() * 0.15;
      const dx = Math.cos(angle) * w, dz = Math.sin(angle) * w;
      const first = grassPositions.length / 3;
      grassPositions.push(x - dx, 0.155, z - dz, x + dx, 0.155, z + dz, x + dx * 3, 0.155 + height, z + dz * 3);
      grassIndices.push(first, first + 1, first + 2);
      const tint = 0.78 + rng() * 0.25;
      for (let v = 0; v < 3; v++) grassColors.push(tint, tint, tint * 0.85, 1);
    }
  }
  const grass = new Mesh('living-grass-edge', scene), grassData = new VertexData(), grassNormals = [];
  VertexData.ComputeNormals(grassPositions, grassIndices, grassNormals);
  Object.assign(grassData, { positions: grassPositions, indices: grassIndices, normals: grassNormals, colors: grassColors });
  grassData.applyToMesh(grass); grass.material = moss; grass.isPickable = false;

  const tileTemplate = beveledTile(scene);
  for (let i = 0; i < 100; i++) {
    const tile = i === 0 ? tileTemplate : tileTemplate.clone(`ground-${i}`);
    tile.material = tileMaterials[Math.floor(rng() * 6)]; tile.position = coord(i);
    tile.rotation.y = Math.floor(rng() * 4) * Math.PI / 2;
    tile.receiveShadows = true; tile.metadata = { tileIndex: i }; groundTiles.push(tile);
  }

  function finishDecoration(root, pieces, index) {
    const byMaterial = new Map();
    pieces.forEach((mesh) => {
      const group = byMaterial.get(mesh.material) || []; group.push(mesh); byMaterial.set(mesh.material, group);
    });
    // Merge components by material so a flower bed does not become dozens of draws.
    byMaterial.forEach((parts) => {
      parts.forEach((p) => p.computeWorldMatrix(true));
      const merged = Mesh.MergeMeshes(parts, true, true);
      if (!merged) return;
      merged.parent = root; merged.position.set(0, 0, 0);
      merged.isPickable = true; merged.metadata = { tileIndex: index }; merged.receiveShadows = true; cast(merged);
    });
    root.position = coord(index); decorations.set(index, root);
  }

  function buildDecoration(index, type) {
    const old = decorations.get(index);
    if (old) {
      old.getChildMeshes().forEach((mesh) => { shadows.removeShadowCaster(mesh); glow.removeExcludedMesh(mesh); casterMeshes.delete(mesh); });
      old.dispose(false, false); decorations.delete(index);
    }
    if (type === 'empty') return;
    const root = new TransformNode(`${type}-${index}`, scene), pieces = [];
    const r = randomSource(index * 91 + 31);
    // Pieces are authored in world-local coordinates before being merged into a tile root.
    const add = (mesh, mat, x, y, z) => { register(mesh, mat, null, x, y, z); pieces.push(mesh); return mesh; };
    if (type === 'tree') {
      const height = 1.48 + r() * 0.24;
      const pine = CreatePlane('needle-pine', { width: height * 1145 / 1374, height }, scene);
      pine.material = pineMaterial; pine.parent = root;
      pine.billboardMode = Mesh.BILLBOARDMODE_ALL;
      // Offset along the camera's up vector: the sprite's bottom stays on its tile.
      pine.position.set(-Math.cos(camera.alpha) * Math.cos(camera.beta) * height / 2,
        0.16 + Math.sin(camera.beta) * height / 2, -Math.sin(camera.alpha) * Math.cos(camera.beta) * height / 2);
      pine.metadata = { tileIndex: index }; cast(pine); glow.addExcludedMesh(pine);
      const contact = CreatePlane('pine-contact', { width: 0.73, height: 0.58 }, scene);
      contact.parent = root; contact.rotation.x = Math.PI / 2; contact.position.y = 0.169;
      contact.material = contactMaterial; contact.isPickable = false; glow.addExcludedMesh(contact);
      root.position = coord(index); decorations.set(index, root);
      return;
    } else if (type === 'flower') {
      for (let j = 0; j < 5; j++) {
        const x = (r() - 0.5) * 0.6, z = (r() - 0.5) * 0.6, h = 0.28 + r() * 0.2;
        add(CreateCylinder('flower-stem', { diameter: 0.026, height: h, tessellation: 4 }, scene), foliage[1], x, 0.16 + h / 2, z);
        for (let p = 0; p < 5; p++) {
          const angle = p / 5 * Math.PI * 2;
          const petal = add(CreateSphere('flower-petal', { diameter: 0.13, segments: 4 }, scene), flowerMaterials[j % 2], x + Math.cos(angle) * 0.07, h + 0.16, z + Math.sin(angle) * 0.07);
          petal.scaling.set(1, 0.36, 1);
        }
        add(CreateSphere('pollen', { diameter: 0.07, segments: 4 }, scene), flowerMaterials[2], x, h + 0.19, z);
      }
    } else if (type === 'lantern') {
      add(CreateCylinder('lamp-foot', { diameterTop: 0.35, diameterBottom: 0.42, height: 0.13, tessellation: 8 }, scene), ivory, 0, 0.21, 0);
      add(CreateCylinder('lamp-pole', { diameter: 0.07, height: 0.55, tessellation: 6 }, scene), darkMetal, 0, 0.52, 0);
      add(CreateCylinder('lamp-bowl', { diameterTop: 0.35, diameterBottom: 0.2, height: 0.1, tessellation: 6 }, scene), gold, 0, 0.81, 0);
      add(CreateCylinder('lamp-flame', { diameterTop: 0.19, diameterBottom: 0.25, height: 0.3, tessellation: 6 }, scene), warmGlass, 0, 0.99, 0);
      for (let j = 0; j < 4; j++) {
        const a = j * Math.PI / 2 + Math.PI / 4;
        add(CreateCylinder('lamp-frame', { diameter: 0.025, height: 0.33, tessellation: 4 }, scene), darkMetal, Math.cos(a) * 0.16, 0.99, Math.sin(a) * 0.16);
      }
      add(CreateCylinder('lamp-roof', { diameterTop: 0.08, diameterBottom: 0.43, height: 0.18, tessellation: 6 }, scene), gold, 0, 1.22, 0);
      add(CreateSphere('lamp-finial', { diameter: 0.08, segments: 6 }, scene), gold, 0, 1.35, 0);
    } else if (type === 'rock') {
      for (let j = 0; j < 3; j++) {
        const boulder = add(CreateSphere('quartz-boulder', { diameter: 0.31 + r() * 0.15, segments: 4 }, scene), j === 0 ? stone : pebbleMat, (r() - 0.5) * 0.45, 0.23 + r() * 0.06, (r() - 0.5) * 0.45);
        boulder.scaling.set(1.12 + r() * 0.3, 0.65 + r() * 0.35, 0.7 + r() * 0.5);
        boulder.rotation.set(r(), r(), r()); boulder.convertToFlatShadedMesh();
      }
    } else if (type === 'shrine') {
      for (let j = 0; j < 3; j++) {
        add(CreateCylinder('altar-step', { diameter: 1.0 - j * 0.18, height: 0.13, tessellation: 8 }, scene), ivory, 0, 0.21 + j * 0.13, 0);
      }
      add(CreateCylinder('altar-plinth', { diameterTop: 0.29, diameterBottom: 0.43, height: 0.56, tessellation: 8 }, scene), ivory, 0, 0.77, 0);
      add(CreateCylinder('altar-cap', { diameterTop: 0.51, diameterBottom: 0.35, height: 0.12, tessellation: 8 }, scene), gold, 0, 1.10, 0);
      const halo = add(CreateTorus('sun-ring', { diameter: 0.82, thickness: 0.045, tessellation: 32 }, scene), gold, 0, 1.63, 0);
      halo.rotation.x = Math.PI / 2; halo.rotation.y = -0.3;
      add(CreateSphere('seed-of-light', { diameter: 0.36, segments: 12 }, scene), warmGlass, 0, 1.63, 0);
      for (let j = 0; j < 8; j++) {
        const a = j * Math.PI / 4;
        const ray = add(CreateBox('sun-ray', { width: 0.055, height: j % 2 ? 0.10 : 0.18, depth: 0.05 }, scene), gold, Math.sin(a) * 0.54, 1.63 + Math.cos(a) * 0.54, 0);
        ray.rotation.z = -a;
      }
    }
    finishDecoration(root, pieces, index);
  }
  tiles.forEach((tile, index) => buildDecoration(index, tile.type));

  const borderPoints = [new Vector3(-0.46, 0.185, -0.46), new Vector3(0.46, 0.185, -0.46), new Vector3(0.46, 0.185, 0.46), new Vector3(-0.46, 0.185, 0.46), new Vector3(-0.46, 0.185, -0.46)];
  const focusBorder = CreateLines('selected-ground-outline', { points: borderPoints }, scene);
  focusBorder.color = hex('#fff0b0'); focusBorder.isPickable = false; focusBorder.setEnabled(false);
  const highlightMaterial = material('tile-hover', '#ffe6a0', '#6f5422'); highlightMaterial.alpha = 0.18;
  const focusFill = CreateBox('selected-ground-wash', { width: 0.92, depth: 0.92, height: 0.015 }, scene);
  focusFill.material = highlightMaterial; focusFill.isPickable = false; focusFill.setEnabled(false);
  let focused = null, keyboardFocus = null, hovered = null, tool = 'tree';
  const showFocus = (index) => {
    focused = Number.isInteger(index) && index >= 0 && index < 100 ? index : null;
    focusBorder.setEnabled(focused !== null); focusFill.setEnabled(focused !== null);
    if (focused !== null) {
      const p = coord(focused); focusBorder.position.copyFrom(p); focusFill.position.set(p.x, 0.181, p.z);
      focusBorder.color = tool === 'erase' ? hex('#ffb5a1') : hex('#fff0b0');
    }
  };
  const getTileAt = (event) => {
    const rect = canvas.getBoundingClientRect();
    const pick = scene.pick(event.clientX - rect.left, event.clientY - rect.top, (mesh) => Number.isInteger(mesh.metadata?.tileIndex));
    return pick?.hit ? pick.pickedMesh.metadata.tileIndex : null;
  };
  const pointerMove = (event) => {
    const index = getTileAt(event);
    if (index !== hovered) { hovered = index; onHover?.(index); }
    showFocus(index ?? keyboardFocus); canvas.style.cursor = index === null ? 'default' : 'pointer';
  };
  const pointerLeave = () => { hovered = null; onHover?.(null); showFocus(keyboardFocus); };
  let down = null;
  const pointerDown = (event) => { if (event.button === 0) down = { x: event.clientX, y: event.clientY, index: getTileAt(event) }; };
  const pointerUp = (event) => {
    if (!down) return;
    const index = getTileAt(event);
    if (index !== null && index === down.index && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 12) onTileClick?.(index);
    down = null;
  };
  const pointerCancel = () => { down = null; };
  canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerleave', pointerLeave);
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerCancel);

  const dustMaterial = material('sun-dust', '#fff2bc', '#f5ce74');
  const moteTemplate = CreateSphere('light-mote-0', { diameter: 0.036, segments: 4 }, scene);
  moteTemplate.material = dustMaterial; moteTemplate.isPickable = false;
  const motes = [];
  for (let i = 0; i < 32; i++) {
    const mesh = i === 0 ? moteTemplate : moteTemplate.createInstance(`light-mote-${i}`);
    mesh.isPickable = false;
    const seed = { x: (rng() - 0.5) * 12, y: 0.5 + rng() * 3.3, z: (rng() - 0.5) * 11, phase: rng() * Math.PI * 2 };
    mesh.position.set(seed.x, seed.y, seed.z); motes.push({ mesh, ...seed });
  }
  let radiance = 0, burst = 0, disposed = false;
  const resize = () => {
    if (disposed) return;
    engine.resize();
    const width = canvas.clientWidth || 1, height = canvas.clientHeight || 1, aspect = width / height;
    let halfHeight = aspect < 0.85 ? 7.2 / aspect : aspect < 1.3 ? 8.5 : 7.2;
    const tabletSidebar = width > 760 && width <= 1000 && height > 520;
    const shortLandscape = width >= 761 && height <= 520;
    if (tabletSidebar) {
      // Keep every tile outside the sidebar even on tall, narrow tablets.
      const availableBoardWidth = width - 270;
      halfHeight = Math.max(halfHeight, height * 11.4 / (2 * availableBoardWidth));
    }
    if (shortLandscape) halfHeight = Math.max(halfHeight, 8.4);
    const halfWidth = halfHeight * aspect;
    const shiftX = shortLandscape ? 1.7 : tabletSidebar ? -113 * (2 * halfHeight / height) : width > 1000 ? -1.05 : 0;
    const shiftY = width < 700 ? 0.6 : 0.25;
    camera.orthoLeft = -halfWidth + shiftX; camera.orthoRight = halfWidth + shiftX;
    camera.orthoTop = halfHeight + shiftY; camera.orthoBottom = -halfHeight + shiftY;
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const start = performance.now();
  const render = () => {
    if (document.hidden || disposed) return;
    const t = (performance.now() - start) / 1000;
    if (!reducedMotion) {
      motes.forEach((m, i) => {
        m.mesh.position.x = m.x + Math.sin(t * 0.11 + m.phase) * 0.22;
        m.mesh.position.y = m.y + Math.sin(t * 0.32 + m.phase) * 0.24;
        const scale = 0.5 + (Math.sin(t * 1.1 + m.phase) + 1) * 0.5 + burst * (i % 3 === 0 ? 2 : 0);
        m.mesh.scaling.setAll(scale);
      });
      burst *= 0.985;
    }
    scene.render();
  };
  engine.runRenderLoop(render);
  const refreshShadow = () => shadows.getShadowMap()?.resetRefreshCounter();
  refreshShadow();

  return {
    updateTile(index, type) {
      if (!Number.isInteger(index) || index < 0 || index >= 100) return;
      buildDecoration(index, type); refreshShadow();
    },
    setSelectedTool(nextTool) { tool = nextTool; showFocus(focused); },
    setFocus(index) { keyboardFocus = index; showFocus(index ?? hovered); },
    setRadiance(value) {
      radiance = clamp(value);
      sun.intensity = 1.15 + radiance * 0.22;
      glow.intensity = 0.45 + radiance * 0.35;
      warmGlass.emissiveColor = new Color3(1, 0.58 + radiance * 0.1, 0.17 + radiance * 0.08);
    },
    celebrate() { burst = reducedMotion ? 0 : 1; },
    resize,
    dispose() {
      disposed = true; observer.disconnect(); engine.stopRenderLoop(render);
      canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerleave', pointerLeave);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel);
      scene.dispose(); engine.dispose();
    },
  };
}
