import { createNineSliceBlock } from './terrain.js';
export { createNineSliceBlock, nineSliceAxis } from './terrain.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Culling/ray.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
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

const SIZE = 5;
const TURF_HEIGHT = 0.245;
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

function grassHemOffset(seed, x, z) {
  return (noise(seed * 3.7 + x * 4.3, z * 4.3 + 19.3) - 0.5) * 0.055;
}

// Authored stone UVs and mesh-local height remain attached through rotation and drops.
class SharedEarthBlend extends MaterialPluginBase {
  constructor(material, earthTexture, fillTransparentStone = false) {
    super(material, 'SharedEarthBlend', 190, {}, true, true);
    this.earthTexture = earthTexture;
    this.fillTransparentStone = fillTransparentStone;
    this.doNotSerialize = true;
  }
  getClassName() { return 'SharedEarthBlend'; }
  isReadyForSubMesh() { return this.earthTexture.isReady(); }
  getAttributes(attributes) { attributes.push('terrainStoneUV', 'terrainBottomLight'); }
  getSamplers(samplers) { samplers.push('terrainEarthSampler'); }
  bindForSubMesh(uniformBuffer) { uniformBuffer.setTexture('terrainEarthSampler', this.earthTexture); }
  getActiveTextures(textures) { textures.push(this.earthTexture); }
  hasTexture(value) { return value === this.earthTexture; }
  getCustomCode(shaderType) {
    if (shaderType === 'vertex') return {
      CUSTOM_VERTEX_DEFINITIONS: `
        attribute vec2 terrainStoneUV;
        attribute float terrainBottomLight;
        varying vec2 vTerrainStoneUV;
        varying float vTerrainBottomLight;
        varying vec3 vTerrainLocalPosition;
      `,
      CUSTOM_VERTEX_MAIN_END: `
        vTerrainStoneUV = terrainStoneUV;
        vTerrainBottomLight = terrainBottomLight;
        vTerrainLocalPosition = positionUpdated;
      `,
    };
    if (shaderType !== 'fragment') return null;
    return {
      // Always register this hook, including during MaterialPluginBase construction.
      CUSTOM_FRAGMENT_UPDATE_ALPHA: this.fillTransparentStone ? `
        if (baseColor.a < 0.98) {
          vec4 originalStone = baseColor;
          vec4 filledStone = baseColor;
          // Only transparent source pixels need a colour. Search nearby original
          // opaque pixels; never resize, mirror or repeat the existing stone art.
          vec2 stoneTexel = vec2(1.0 / 2172.0, 1.0 / 724.0);
          for (int ring = 1; ring <= 12; ring++) {
            if (filledStone.a < 0.98) {
              vec2 radius = stoneTexel * (float(ring) * 7.0);
              vec4 above = texture2D(diffuseSampler, vDiffuseUV + vec2(0.0, radius.y));
              vec4 left = texture2D(diffuseSampler, vDiffuseUV - vec2(radius.x, 0.0));
              vec4 right = texture2D(diffuseSampler, vDiffuseUV + vec2(radius.x, 0.0));
              filledStone = above.a >= 0.98 ? above : left.a >= 0.98 ? left : right;
            }
          }
          baseColor.rgb = mix(filledStone.rgb, originalStone.rgb, smoothstep(0.0, 0.98, originalStone.a));
          baseColor.a = 1.0;
        }
      ` : '',
      CUSTOM_FRAGMENT_DEFINITIONS: `
        uniform sampler2D terrainEarthSampler;
        varying vec2 vTerrainStoneUV;
        varying float vTerrainBottomLight;
        varying vec3 vTerrainLocalPosition;
      `,
      CUSTOM_FRAGMENT_BEFORE_FOG: `
        float edgeNoise = sin(vTerrainLocalPosition.x * 23.0 + sin(vTerrainLocalPosition.z * 17.0)) * 0.018;
        float seamMix = (1.0 - smoothstep(-0.005, 0.14 + edgeNoise, vTerrainLocalPosition.y))
          * smoothstep(-0.22, -0.08, vTerrainLocalPosition.y);
        if (seamMix > 0.001) {
          // Match the accepted front's short moss-to-stone transition. This is
          // local height, so the authored stone stays attached to moving blocks.
          float seamV = clamp(0.49 + (vTerrainLocalPosition.y + 0.045) * 0.20, 0.43, 0.525);
          vec3 stoneColour = texture2D(terrainEarthSampler, vec2(vTerrainStoneUV.x, seamV)).rgb;
          float stoneLight = 0.80 + 0.18 * max(dot(normalize(normalW), normalize(vec3(-0.8, 1.4, -0.55))), 0.0);
          color.rgb = mix(color.rgb, stoneColour * stoneLight * vec3(1.02, 1.0, 0.95), seamMix);
        }
        // Soft cloud bounce reaches only the authored underside, fading out at
        // its shared rim; side lighting and draw calls stay unchanged.
        color.rgb += texture2D(terrainEarthSampler, vTerrainStoneUV).rgb * (0.14 * vTerrainBottomLight);
      `,
    };
  }
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

export async function createWorld(canvas, { state, onTileClick, onHover, onViewState, reducedMotion = false, labelsRoot }) {
  const engine = new Engine(canvas, true, { alpha: true, stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.ambientColor = hex('#8b8295');
  scene.imageProcessingConfiguration.contrast = 1.06;
  scene.imageProcessingConfiguration.exposure = 1.0;
  const camera = new ArcRotateCamera('battle-camera', -Math.PI / 2, 0.94, 10.9, new Vector3(0, 0.30, 0), scene);
  camera.mode = Camera.PERSPECTIVE_CAMERA;
  camera.fov = 0.56; camera.minZ = 0.1; camera.maxZ = 80;
  const artUrl = (name) => `${import.meta.env.BASE_URL}textures/${name}`;
  canvas.style.backgroundImage = `linear-gradient(rgba(27,24,39,.12),rgba(35,25,35,.22)), url("${artUrl('sunset-clouds.png')}")`;
  canvas.style.backgroundSize = 'cover'; canvas.style.backgroundPosition = 'center';
  const ambient = new HemisphericLight('cloud-light', new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.57; ambient.diffuse = hex('#e2e1e5'); ambient.groundColor = hex('#4e455a');
  const sun = new DirectionalLight('sunlight', new Vector3(0.8, -1.4, 0.55), scene);
  sun.position = new Vector3(-8, 14, -5.5); sun.diffuse = hex('#ffe8c8'); sun.intensity = 1.12;
  sun.shadowMinZ = 0.1; sun.shadowMaxZ = 40;
  const shadows = new ShadowGenerator(window.innerWidth > 760 ? 2048 : 1024, sun);
  shadows.usePercentageCloserFiltering = true; shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.002; shadows.normalBias = 0.02; shadows.darkness = 0.25;
  const glow = new GlowLayer('battle-light', scene, { mainTextureFixedSize: 512, blurKernelSize: 32 });
  glow.intensity = 0.55;
  const material = (name, color, emission) => {
    const m = new StandardMaterial(name, scene); m.diffuseColor = hex(color);
    m.specularColor.set(0.025, 0.022, 0.018);
    if (emission) m.emissiveColor = hex(emission);
    return m;
  };
  const loadArt = (name, alpha = false) => new Promise((resolve) => {
    let art;
    art = new Texture(artUrl(name), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE,
      () => { art.hasAlpha = alpha; art.anisotropicFilteringLevel = 8; resolve(art); },
      () => { art?.dispose(); resolve(null); });
  });
  const [mossArt, heroArt, enemyArt, heroAttackArt, soilArt, earthFrontArt] = await Promise.all([
    loadArt('grass-stylized-v6.png'), loadArt('hero-knight.png', true), loadArt('shade-enemy.png', true), loadArt('hero-attack.png', true),
    loadArt('soil-stylized-v2.png'),
    loadArt('earth-front-grassy-v4.png', true),
  ]);
  const blendEarth = (mat, fillTransparentStone = false) => { if (earthFrontArt) new SharedEarthBlend(mat, earthFrontArt, fillTransparentStone); };
  const topsoil = material('closed-original-stone', '#c7ccb3');
  topsoil.diffuseTexture = earthFrontArt || soilArt || texture(scene, 'fallback-stone', 256, (ctx, size) => paintGround(ctx, size, 3, true));
  topsoil.useAlphaFromDiffuseTexture = false;
  topsoil.transparencyMode = StandardMaterial.MATERIAL_OPAQUE;
  topsoil.specularColor.set(0, 0, 0);
  topsoil.emissiveColor.set(0.045, 0.05, 0.025);
  blendEarth(topsoil, true);
  const soilFill = new DirectionalLight('front-soil-fill', new Vector3(0.15, -0.20, 1), scene);
  soilFill.diffuse = hex('#e8dfd1'); soilFill.specular.set(0, 0, 0); soilFill.intensity = 0.44;
  // Keep diffuse below the shader's lighting clamp so the three turf tones remain distinct.
  const grassTints = ['#74857f', '#7b8c86', '#819089', '#91947e', '#9d9d85', '#a3a18b', '#adb5b4', '#b1b8b8', '#b7bdbc'];
  const groundMaterials = grassTints.map((tint, i) => {
    const m = material(`moss-block-${i}`, tint);
    m.specularColor.set(0, 0, 0);
    m.diffuseTexture = mossArt || texture(scene, `fallback-moss-${i}`, 256, (ctx, size) => paintGround(ctx, size, i));
    const fills = [[0.014, 0.017, 0.012], [0.042, 0.036, 0.022], [0.095, 0.090, 0.068]];
    m.emissiveColor.set(...fills[Math.floor(i / 3)]);
    blendEarth(m);
    const combined = new MultiMaterial(`ground-and-stone-${i}`, scene);
    combined.subMaterials = [m, topsoil]; return combined;
  });
  const contactMaterial = material('contact-shadow', '#211f21', '#211f21');
  contactMaterial.disableLighting = true; contactMaterial.alpha = 0.6;
  contactMaterial.diffuseTexture = texture(scene, 'contact-falloff', 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#ffffffdd'); g.addColorStop(0.4, '#ffffff88'); g.addColorStop(1, '#ffffff00');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  contactMaterial.diffuseTexture.hasAlpha = true; contactMaterial.useAlphaFromDiffuseTexture = true;
  contactMaterial.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  const ringHero = material('hero-ground-light', '#d7bf72', '#7e7041');
  const ringEnemy = material('enemy-ground-light', '#cf7165', '#843d3a');
  const STEP = 1.16, DROP_HEIGHT = -1.2;
  const boardRoot = new TransformNode('board-view-transform', scene);
  let boardPreviewSize = null, previewTerrain = null, rotation = 0, dropMode = false, viewBusy = false;
  const flatCoord = (index, size = SIZE) => new Vector3((index % size - (size - 1) / 2) * STEP, 0, ((size - 1) / 2 - Math.floor(index / size)) * STEP);
  const screenUp = new Vector3(0, Math.sin(camera.beta), Math.cos(camera.beta));
  const screenRight = new Vector3(1, 0, 0);
  const localDirection = (direction) => Vector3.TransformNormal(direction, Matrix.RotationY(-boardRoot.rotation.y));
  const localScreenUp = () => localDirection(screenUp);
  const localScreenRight = () => localDirection(screenRight);
  const worldPoint = (position) => Vector3.TransformCoordinates(position, boardRoot.computeWorldMatrix(true));
  const buildTerrain = (boardSize, label) => {
    const root = new TransformNode('terrain-' + label, scene); root.parent = boardRoot;
    const groundTiles = [], tileRoots = [], heights = new Array(boardSize * boardSize).fill(0), details = [];
    const scatterMaterials = ['#bcb493', '#969b70', '#64704c'].map((color, i) => {
      const mat = material('turf-fragments-' + label + '-' + i, color); mat.specularColor.set(0, 0, 0); return mat;
    });
    for (let i = 0; i < boardSize * boardSize; i++) {
      const tileRoot = new TransformNode('tile-height-' + label + '-' + i, scene);
      tileRoot.parent = root; tileRoot.position.copyFrom(flatCoord(i, boardSize)); tileRoots.push(tileRoot);
      const tile = createNineSliceBlock(scene, i, false);
      tile.parent = tileRoot; tile.scaling.set(STEP, 1, STEP);
      tile.material = groundMaterials[(i * 7 + Math.floor(i / boardSize) * 2) % groundMaterials.length];
      tile.receiveShadows = true; shadows.addShadowCaster(tile); glow.addExcludedMesh(tile);
      tile.metadata = { ...tile.metadata, tileIndex: i }; groundTiles.push(tile); soilFill.includedOnlyMeshes.push(tile);
      const scatter = scatterMaterials.map((mat) => ({ positions: [], indices: [], mat }));
      const r = randomSource(1701 + i * 83), count = Math.floor(r() ** 1.3 * 31);
      const clusters = Array.from({ length: 3 }, () => [(r() - 0.5) * 0.64, (r() - 0.5) * 0.64]);
      for (let fragment = 0; fragment < count; fragment++) {
        const group = r() < 0.17 ? 2 : r() < 0.55 ? 0 : 1, batch = scatter[group];
        const cluster = clusters[Math.floor(r() * clusters.length)];
        const x = clamp(cluster[0] + (r() - 0.5) * 0.23, -0.35, 0.35), z = clamp(cluster[1] + (r() - 0.5) * 0.23, -0.35, 0.35);
        const radius = group === 2 ? 0.020 + r() * 0.018 : 0.010 + r() * 0.015;
        const sides = 3 + Math.floor(r() * 3), first = batch.positions.length / 3, turn = r() * Math.PI * 2;
        batch.positions.push(x, TURF_HEIGHT + 0.0025, z);
        for (let point = 0; point < sides; point++) {
          const angle = turn + point / sides * Math.PI * 2, size = radius * (0.65 + r() * 0.35);
          batch.positions.push(x + Math.cos(angle) * size, TURF_HEIGHT + 0.001, z + Math.sin(angle) * size * (0.45 + r() * 0.45));
        }
        for (let point = 0; point < sides; point++) batch.indices.push(first, first + point + 1, first + (point + 1) % sides + 1);
      }
      scatter.forEach(({ positions, indices, mat }, group) => {
        if (!indices.length) return;
        const mesh = new Mesh('turf-fragments-' + label + '-' + i + '-' + group, scene), data = new VertexData(), normals = [];
        VertexData.ComputeNormals(positions, indices, normals); Object.assign(data, { positions, indices, normals }); data.applyToMesh(mesh);
        mesh.parent = tileRoot; mesh.material = mat; mesh.isPickable = false; glow.addExcludedMesh(mesh); details.push(mesh);
      });
    }
    return {
      root, groundTiles, tileRoots, heights, size: boardSize,
      dispose() {
        const removed = new Set([...groundTiles, ...details]);
        soilFill.includedOnlyMeshes = soilFill.includedOnlyMeshes.filter((mesh) => !removed.has(mesh));
        removed.forEach((mesh) => { shadows.removeShadowCaster(mesh, false); glow.removeExcludedMesh(mesh); mesh.dispose(false, false); });
        scatterMaterials.forEach((mat) => mat.dispose(false, false)); root.dispose();
      },
    };
  };
  const battleTerrain = buildTerrain(SIZE, 'battle');
  const { groundTiles } = battleTerrain;
  const activeTerrain = () => previewTerrain || battleTerrain;
  const coord = (index) => flatCoord(index).add(new Vector3(0, battleTerrain.heights[index] || 0, 0));
  const viewCoord = (index) => flatCoord(index, activeTerrain().size).add(new Vector3(0, activeTerrain().heights[index] || 0, 0));
  const makeOverlayMaterial = (name, color, alpha) => {
    const m = material(name, color, color); m.disableLighting = true; m.alpha = alpha;
    m.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND; m.backFaceCulling = false; return m;
  };
  const telegraphMat = makeOverlayMaterial('enemy-intent-tiles', '#cf5b51', 0.28);
  const targetMat = makeOverlayMaterial('valid-target-tiles', '#69a9d7', 0.13);
  const previewGoodMat = makeOverlayMaterial('attack-area-tiles', '#ebc46b', 0.36);
  const previewBadMat = makeOverlayMaterial('invalid-area-tiles', '#d6675d', 0.34);
  const turfOverlay = (name, index, lift) => {
    const tile = groundTiles[index], top = tile.subMeshes[0];
    const positions = tile.getVerticesData('position').slice(0, top.verticesCount * 3);
    const normals = tile.getVerticesData('normal').slice(0, top.verticesCount * 3);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += normals[i] * lift / tile.scaling.x;
      positions[i + 1] += normals[i + 1] * lift;
      positions[i + 2] += normals[i + 2] * lift / tile.scaling.z;
    }
    const data = new VertexData();
    data.positions = positions;
    data.indices = tile.getIndices().slice(0, top.indexCount);
    data.normals = normals;
    const mesh = new Mesh(name, scene); data.applyToMesh(mesh);
    mesh.parent = boardRoot; mesh.position.copyFrom(coord(index)); mesh.scaling.copyFrom(tile.scaling);
    mesh.isPickable = false; glow.addExcludedMesh(mesh); return mesh;
  };
  const turfOutline = (index, lift = 0.009) => {
    const tile = groundTiles[index], positions = tile.getVerticesData('position'), points = [];
    const outline = tile.metadata.nineSlice.outline;
    // Use the 9-slice cap boundary, never the obsolete circular fan vertex ordering.
    for (let i = 0; i <= outline.length; i++) {
      const vertex = outline[i % outline.length];
      points.push(new Vector3(positions[vertex * 3] * STEP, positions[vertex * 3 + 1] + lift, positions[vertex * 3 + 2] * STEP));
    }
    return points;
  };
  const overlays = Array.from({ length: 25 }, (_, index) => {
    const make = (name, mat, lift) => {
      const plane = turfOverlay(`${name}-${index}`, index, lift);
      plane.material = mat; plane.isPickable = false; plane.setEnabled(false); glow.addExcludedMesh(plane); return plane;
    };
    const p = coord(index);
    const border = CreateLines(`range-outline-${index}`, { points: turfOutline(index) }, scene);
    border.parent = boardRoot;
    border.position.copyFrom(p); border.color = hex('#9fc5de'); border.alpha = 0.6; border.isPickable = false; border.setEnabled(false);
    const dangerBorder = CreateLines(`danger-outline-${index}`, { points: turfOutline(index, 0.011) }, scene);
    dangerBorder.parent = boardRoot;
    dangerBorder.position.copyFrom(p); dangerBorder.color = hex('#ff9782'); dangerBorder.alpha = 1; dangerBorder.isPickable = false; dangerBorder.setEnabled(false);
    return { telegraph: make('intent', telegraphMat, 0.005), target: make('target', targetMat, 0.008), preview: make('preview', previewGoodMat, 0.011), border, dangerBorder };
  });
  const focus = CreateLines('keyboard-pointer-focus', { points: turfOutline(0, 0.015) }, scene);
  focus.parent = boardRoot;
  focus.color = hex('#fff1c5'); focus.isPickable = false; focus.setEnabled(false);
  let hovered = null, keyboardFocus = null;
  const setFocus = (index) => {
    if (boardPreviewSize !== null && !dropMode) { focus.setEnabled(false); return; }
    keyboardFocus = Number.isInteger(index) && index >= 0 && index < activeTerrain().size ** 2 ? index : null;
    const active = keyboardFocus ?? hovered;
    focus.setEnabled(active !== null); if (active !== null) focus.position.copyFrom(viewCoord(active));
  };
  const showTargeting = (preview) => {
    if (boardPreviewSize !== null || dropMode) preview = null;
    const targets = new Set(preview?.targets || []), tiles = new Set(preview?.tiles || []);
    overlays.forEach((overlay, index) => {
      overlay.target.setEnabled(targets.has(index)); overlay.border.setEnabled(targets.has(index));
      overlay.preview.setEnabled(tiles.has(index)); overlay.preview.material = preview?.valid === false ? previewBadMat : previewGoodMat;
    });
  };

  let ownLabelsRoot = false;
  if (!labelsRoot) {
    labelsRoot = document.createElement('div'); canvas.parentElement.append(labelsRoot); ownLabelsRoot = true;
    Object.assign(labelsRoot.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '3' });
  }
  const actors = new Map(), labelElements = new Set(), effectMeshes = new Set();
  let latestState = state, disposed = false, busy = false;
  const fallbackActor = (enemy) => texture(scene, enemy ? 'fallback-enemy' : 'fallback-hero', { width: 256, height: 384 }, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const body = ctx.createLinearGradient(0, 0, w, h); body.addColorStop(0, enemy ? '#a197bd' : '#eee2b8'); body.addColorStop(1, enemy ? '#241e37' : '#3b4e6e');
    ctx.fillStyle = enemy ? '#48354d' : '#455f88'; ctx.beginPath(); ctx.moveTo(w * .5, h * .2); ctx.lineTo(w * .1, h * .9); ctx.lineTo(w * .8, h * .93); ctx.closePath(); ctx.fill();
    ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(w * .38, h * .3); ctx.lineTo(w * .66, h * .28); ctx.lineTo(w * .73, h * .59); ctx.lineTo(w * .62, h * .67); ctx.lineTo(w * .68, h * .91); ctx.lineTo(w * .54, h * .93); ctx.lineTo(w * .48, h * .68); ctx.lineTo(w * .37, h * .94); ctx.lineTo(w * .24, h * .9); ctx.lineTo(w * .34, h * .58); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w * .49, h * .22, w * .11, h * .10, -.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = enemy ? '#bb9fb0' : '#f1d88f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(w * .66, h * .55); ctx.lineTo(w * .89, h * .16); ctx.stroke();
  });
  const heroTexture = heroArt || fallbackActor(false), enemyTexture = enemyArt || fallbackActor(true);
  heroTexture.hasAlpha = true; enemyTexture.hasAlpha = true;
  const spriteAspect = (tex) => { const s = tex.getSize(); return s.width / s.height; };
  const projected = (position) => {
    const viewport = camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    // WebGL viewports start at the bottom; DOM labels start at the top.
    viewport.y = canvas.clientHeight - viewport.y - viewport.height;
    return Vector3.Project(worldPoint(position), Matrix.IdentityReadOnly, scene.getTransformMatrix(), viewport);
  };
  const updateActorLabel = (actor) => {
    const unit = actor.data;
    actor.hpText.textContent = `${Math.max(0, unit.hp)} / ${unit.maxHp}`;
    actor.hpFill.style.width = `${clamp(unit.hp / unit.maxHp) * 100}%`;
    actor.shield.textContent = unit.block > 0 ? `방어 ${unit.block}` : '';
    actor.intent.textContent = unit.id === 'hero' ? '빛의 기사' : unit.intent?.type === 'attack' ? `공격 ${unit.intent.damage}` : '이동';
    actor.label.hidden = unit.hp <= 0;
  };
  const makeActor = (unit) => {
    const isHero = unit.id === 'hero', root = new TransformNode(`actor-${unit.id}`, scene);
    root.parent = boardRoot;
    const height = isHero ? 1.66 : unit.kind === 'brute' ? 1.65 : unit.kind === 'archer' ? 1.42 : 1.52;
    const tex = isHero ? heroTexture : enemyTexture;
    const tint = isHero ? hex('#ffffff') : unit.kind === 'brute' ? hex('#eed0bc') : unit.kind === 'archer' ? hex('#d1d1e3') : hex('#c4bedf');
    const mat = material(`sprite-${unit.id}`, '#ffffff'); mat.disableLighting = true; mat.emissiveColor = tint.clone();
    mat.diffuseTexture = tex; mat.useAlphaFromDiffuseTexture = true; mat.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
    mat.alphaCutOff = 0.5; mat.backFaceCulling = false;
    const sprite = CreatePlane(`unit-${unit.id}`, { width: height * spriteAspect(tex), height }, scene);
    sprite.parent = root; sprite.material = mat; sprite.billboardMode = Mesh.BILLBOARDMODE_ALL;
    sprite.position.copyFrom(screenUp.scale(height / 2).add(new Vector3(0, TURF_HEIGHT, 0)));
    sprite.metadata = { tileIndex: unit.tile, actorId: unit.id }; shadows.addShadowCaster(sprite); glow.addExcludedMesh(sprite);
    const contact = CreatePlane(`unit-shadow-${unit.id}`, { width: 0.95, height: 0.70 }, scene);
    contact.parent = root; contact.rotation.x = Math.PI / 2; contact.position.y = TURF_HEIGHT + 0.006; contact.material = contactMaterial; contact.isPickable = false; glow.addExcludedMesh(contact);
    const ring = CreateTorus(`unit-ring-${unit.id}`, { diameter: 0.88, thickness: 0.035, tessellation: 32 }, scene);
    ring.parent = root; ring.position.y = TURF_HEIGHT + 0.018; ring.material = isHero ? ringHero : ringEnemy; ring.isPickable = false;
    const label = document.createElement('div'); label.className = 'battle-unit-label';
    Object.assign(label.style, { position: 'absolute', width: '82px', transform: 'translate(-50%,-100%)', pointerEvents: 'none', textAlign: 'center', color: '#f7edda', font: '12px/1.3 "Malgun Gothic",sans-serif', filter: 'drop-shadow(0 2px 3px #17131bdd)' });
    label.setAttribute('aria-label', `${unit.name || (isHero ? '빛의 기사' : '그늘')} 체력`);
    const intent = document.createElement('div');
    Object.assign(intent.style, { display: 'inline-block', padding: '2px 7px', marginBottom: '3px', borderRadius: '3px', fontSize: '12px', background: isHero ? '#273f51ee' : '#642f33ee', border: `1px solid ${isHero ? '#a5bcc8' : '#bf746b'}88` });
    const hpTrack = document.createElement('div'); Object.assign(hpTrack.style, { position: 'relative', height: '15px', background: '#261b20e6', border: '1px solid #d6b98599', borderRadius: '2px', overflow: 'hidden' });
    const hpFill = document.createElement('div'); Object.assign(hpFill.style, { position: 'absolute', inset: '0 auto 0 0', background: isHero ? '#6f9a91' : '#ba5b55' });
    const hpText = document.createElement('span'); Object.assign(hpText.style, { position: 'relative', fontSize: '11px', lineHeight: '13px', display: 'block' });
    hpTrack.append(hpFill, hpText);
    const shield = document.createElement('div'); Object.assign(shield.style, { color: '#a9d5e8', fontSize: '11px', marginTop: '2px' });
    const leader = document.createElement('div');
    Object.assign(leader.style, { position: 'absolute', height: '1px', background: '#e9dbc29c', transformOrigin: '0 50%', pointerEvents: 'none' });
    leader.hidden = true; label.style.zIndex = '1';
    label.append(intent, hpTrack, shield); labelsRoot.append(leader, label); labelElements.add(label); labelElements.add(leader);
    const actor = { root, sprite, mat, tint, height, poseHeight: height, poseOffsetX: 0, label, leader, labelOffset: 0, intent, hpText, hpFill, shield, baseTexture: tex, data: { ...unit } };
    actors.set(unit.id, actor); return actor;
  };
  const updateActorBillboard = (actor) => {
    actor.sprite.position.copyFrom(localScreenUp().scale(actor.poseHeight / 2).add(localScreenRight().scale(actor.poseOffsetX)).add(new Vector3(0, TURF_HEIGHT, 0)));
  };
  const sync = (nextState) => {
    if (disposed) return;
    latestState = nextState;
    const units = [nextState.hero, ...nextState.enemies];
    units.forEach((unit) => {
      const actor = actors.get(unit.id) || makeActor(unit);
      actor.data = { ...unit }; actor.root.position.copyFrom(coord(unit.tile)); actor.root.scaling.setAll(1);
      actor.sprite.metadata.tileIndex = unit.tile; actor.mat.alpha = 1; actor.mat.emissiveColor.copyFrom(actor.tint);
      actor.sprite.scaling.setAll(1); actor.poseHeight = actor.height; actor.poseOffsetX = 0; updateActorBillboard(actor); actor.mat.diffuseTexture = actor.baseTexture;
      actor.root.setEnabled(boardPreviewSize === null && unit.hp > 0); updateActorLabel(actor);
    });
    const threatened = new Set(nextState.enemies.filter((e) => e.hp > 0 && e.intent?.type === 'attack').flatMap((e) => e.intent.tiles || []));
    overlays.forEach((overlay, i) => { const visible = boardPreviewSize === null && !dropMode && threatened.has(i); overlay.telegraph.setEnabled(visible); overlay.dangerBorder.setEnabled(visible); });
    showTargeting(null);
  };

  const animations = new Set();
  const animate = (duration, update) => new Promise((resolve) => {
    if (disposed) { resolve(); return; }
    const job = { started: performance.now(), duration: reducedMotion ? Math.min(duration, 140) : duration, update, resolve };
    animations.add(job);
  });
  const ease = (t) => 1 - (1 - t) ** 3;
  const disposeEffect = (mesh) => { effectMeshes.delete(mesh); if (!mesh.isDisposed()) mesh.dispose(); };
  const effectMaterial = (name, color, alpha = 1) => {
    const m = material(name, color, color); m.disableLighting = true; m.alpha = alpha; m.backFaceCulling = false;
    m.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND; return m;
  };
  const energyArc = (center, color, radius = 0.85, arc = Math.PI * 1.25) => {
    const mesh = new Mesh('sword-light-arc', scene), data = new VertexData(), p = [], n = [], ids = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, angle = -Math.PI * 0.8 + t * arc;
      for (const r of [radius, radius - Math.sin(t * Math.PI) * 0.13]) {
        const point = center.add(localScreenRight().scale(Math.cos(angle) * r)).add(localScreenUp().scale(Math.sin(angle) * r));
        p.push(point.x, point.y, point.z);
      }
      if (i < 24) { const a = i * 2; ids.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    VertexData.ComputeNormals(p, ids, n); Object.assign(data, { positions: p, indices: ids, normals: n }); data.applyToMesh(mesh);
    mesh.parent = boardRoot; mesh.material = effectMaterial('slash-light', color); mesh.isPickable = false; effectMeshes.add(mesh); return mesh;
  };
  const beam = (from, to, color, width = 0.045) => {
    const direction = to.subtract(from).normalize(), side = Vector3.Cross(direction, localDirection(camera.position).subtract(from)).normalize().scale(width);
    const corners = [from.add(side), from.subtract(side), to.subtract(side), to.add(side)];
    const p = corners.flatMap((v) => [v.x, v.y, v.z]), ids = [0, 1, 2, 0, 2, 3], n = [];
    VertexData.ComputeNormals(p, ids, n);
    const mesh = new Mesh('attack-light-beam', scene), data = new VertexData(); Object.assign(data, { positions: p, indices: ids, normals: n }); data.applyToMesh(mesh);
    mesh.parent = boardRoot; mesh.material = effectMaterial('beam-light', color); mesh.isPickable = false; effectMeshes.add(mesh); return mesh;
  };
  const floatingText = (actor, text, color) => {
    const element = document.createElement('span'); element.textContent = text;
    Object.assign(element.style, { position: 'absolute', color, font: '700 24px/1 Georgia,"Malgun Gothic",serif', textShadow: '0 2px 2px #19151c,0 0 10px #19151c', transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: '3', whiteSpace: 'nowrap' });
    labelsRoot.append(element); labelElements.add(element);
    void animate(650, (t) => {
      const anchor = actor.root.position.add(localScreenUp().scale(actor.height * 0.8)).add(new Vector3(0, TURF_HEIGHT + 0.04, 0));
      const point = projected(anchor); element.style.left = `${point.x}px`; element.style.top = `${point.y - (reducedMotion ? 0 : t * 30)}px`;
      element.style.opacity = String(1 - Math.max(0, t - 0.5) * 2);
    }).then(() => { element.remove(); labelElements.delete(element); });
  };
  const animateAttack = async (event) => {
    const actor = actors.get(event.actorId); if (!actor || !actor.root.isEnabled()) return;
    const targetIndex = Number.isInteger(event.to) ? event.to : event.tiles?.[0];
    if (!Number.isInteger(targetIndex)) return;
    const origin = actor.root.position.clone(), target = coord(targetIndex), direction = target.subtract(origin); direction.y = 0;
    if (direction.lengthSquared() > 0.001) direction.normalize();
    const color = event.actorId === 'hero' ? '#ffe4a3' : '#f18b79';
    const center = target.add(new Vector3(0, 0.65, 0));
    const useBeam = /pierce|beam|ray|lance|bolt|arrow|line|radiant/i.test(event.cardId || '') || actor.data.kind === 'archer';
    if (event.actorId === 'hero' && heroAttackArt) {
      actor.mat.diffuseTexture = heroAttackArt;
      const attackHeight = actor.height * 0.81;
      const facesLeft = Vector3.Dot(direction, localScreenRight()) < -0.05;
      actor.sprite.scaling.set((facesLeft ? -1 : 1) * spriteAspect(heroAttackArt) / spriteAspect(actor.baseTexture) * 0.81, 0.81, 1);
      actor.poseHeight = attackHeight; actor.poseOffsetX = facesLeft ? -0.20 : 0.20; updateActorBillboard(actor);
    }
    const effects = event.cardId === 'cross'
      ? (event.tiles || [targetIndex]).map((i) => { const p = coord(i).add(new Vector3(0, TURF_HEIGHT + 0.02, 0)); return beam(p.add(new Vector3(0, 2.1, 0)), p, '#d9c1ff', 0.055); })
      : [event.cardId === 'nova' ? energyArc(center, color, 1.18, Math.PI * 2)
        : useBeam ? beam(origin.add(new Vector3(0, 0.95, 0)), center, color) : energyArc(center, color)];
    const pulses = (event.tiles || [targetIndex]).filter((i) => Number.isInteger(i) && i >= 0 && i < 25).map((i) => {
      const pulse = turfOverlay('struck-ground', i, 0.014);
      pulse.material = effectMaterial('impact-floor', color, 0.4); pulse.isPickable = false; effectMeshes.add(pulse); return pulse;
    });
    await animate(420, (t) => {
      if (!reducedMotion) {
        const lunge = Math.sin(t * Math.PI) * 0.34; actor.root.position.copyFrom(origin.add(direction.scale(lunge)));
        actor.root.position.y = origin.y + Math.sin(t * Math.PI) * 0.08;
      }
      effects.forEach((fx) => { fx.material.alpha = Math.sin(t * Math.PI); }); pulses.forEach((p) => { p.material.alpha = Math.sin(t * Math.PI) * 0.42; });
    });
    actor.root.position.copyFrom(origin);
    actor.sprite.scaling.setAll(1); actor.poseHeight = actor.height; actor.poseOffsetX = 0; updateActorBillboard(actor); actor.mat.diffuseTexture = actor.baseTexture;
    [...effects, ...pulses].forEach((mesh) => { mesh.material.dispose(); disposeEffect(mesh); });
  };
  const runEvent = async (event) => {
    if (disposed) return;
    if (event.type === 'attack') { await animateAttack(event); return; }
    const actor = actors.get(event.actorId || event.targetId);
    if (!actor) return;
    if (event.type === 'move') {
      const from = actor.root.position.clone(), to = coord(event.to);
      await animate(360, (t) => { actor.root.position.copyFrom(Vector3.Lerp(from, to, ease(t))); if (!reducedMotion) actor.root.position.y += Math.sin(t * Math.PI) * 0.14; });
      actor.data.tile = event.to; actor.sprite.metadata.tileIndex = event.to; actor.root.position.copyFrom(to);
    } else if (event.type === 'hit') {
      const origin = actor.root.position.clone();
      actor.data.block = Math.max(0, (actor.data.block || 0) - (event.blocked || 0));
      actor.data.hp = Math.max(0, actor.data.hp - (event.amount || 0)); updateActorLabel(actor);
      floatingText(actor, event.amount > 0 ? `−${event.amount}` : `방어 ${event.blocked || 0}`, event.amount > 0 ? '#fff0d2' : '#abdfff');
      await animate(190, (t) => {
        if (!reducedMotion) actor.root.position.x = origin.x + Math.sin(t * Math.PI * 5) * 0.09 * (1 - t);
        actor.mat.emissiveColor.copyFrom(Color3.Lerp(hex('#ff8e72'), actor.tint, t));
      });
      actor.root.position.copyFrom(origin); actor.mat.emissiveColor.copyFrom(actor.tint);
    } else if (event.type === 'block') {
      actor.data.block += event.amount || 0; updateActorLabel(actor); floatingText(actor, `방어 +${event.amount}`, '#b9e7ff');
      const fx = energyArc(actor.root.position.add(new Vector3(0, 0.8, 0)), '#a4d9ff', 0.75, Math.PI * 2);
      await animate(260, (t) => { fx.material.alpha = Math.sin(Math.PI * t); }); fx.material.dispose(); disposeEffect(fx);
    } else if (event.type === 'death') {
      actor.label.hidden = true;
      actor.mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
      const deathHeight = actor.root.position.y;
      await animate(300, (t) => { actor.mat.alpha = 1 - t; if (!reducedMotion) actor.root.position.y = deathHeight - t * 0.2; });
      actor.root.setEnabled(false); actor.mat.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
    }
  };
  const playEvents = async (events, nextState) => {
    if (disposed || busy || viewBusy || dropMode) return;
    if (boardPreviewSize !== null) { if (nextState) sync(nextState); return; }
    busy = true; notifyViewState(); showTargeting(null);
    try { for (const event of events || []) { if (disposed) break; await runEvent(event); } }
    finally { busy = false; if (!disposed && nextState) sync(nextState); notifyViewState(); }
  };

  const getBoardViewState = () => ({
    rotation: ((Math.round(rotation) % 360) + 360) % 360,
    dropMode, droppedTiles: activeTerrain().heights.flatMap((height, index) => height < -0.01 ? [index] : []),
    busy: busy || viewBusy, previewSize: boardPreviewSize,
  });
  const notifyViewState = () => { if (!disposed) onViewState?.(getBoardViewState()); };
  const updateTileHeight = (terrain, index, height) => {
    terrain.heights[index] = height; terrain.tileRoots[index].position.y = height;
    if (terrain === battleTerrain) {
      Object.values(overlays[index]).forEach((mesh) => { mesh.position.y = height; });
      actors.forEach((actor) => { if (actor.data.tile === index) actor.root.position.y = height; });
    }
    const focused = keyboardFocus ?? hovered;
    if (terrain === activeTerrain() && focused === index) focus.position.copyFrom(viewCoord(index));
  };
  const rotateBoard = async (degrees) => {
    if (disposed || busy || viewBusy) return false;
    if (!Number.isFinite(degrees)) throw new TypeError('Rotation must be a finite number of degrees.');
    viewBusy = true; down = null; notifyViewState();
    const start = rotation;
    try {
      await animate(560, (t) => {
        rotation = start + degrees * ease(t); boardRoot.rotation.y = rotation * Math.PI / 180;
        resize();
      });
      rotation = ((start + degrees) % 360 + 360) % 360; boardRoot.rotation.y = rotation * Math.PI / 180;
    } finally { viewBusy = false; if (!disposed) { resize(); notifyViewState(); } }
    return !disposed;
  };
  const setTileDropMode = (enabled) => {
    if (disposed || busy || viewBusy) return false;
    dropMode = Boolean(enabled); down = null; hovered = null;
    showTargeting(null); sync(latestState); setFocus(keyboardFocus); notifyViewState();
    return true;
  };
  const toggleTileDrop = async (index) => {
    if (disposed || busy || viewBusy || !dropMode) return false;
    const terrain = activeTerrain();
    if (!Number.isInteger(index) || index < 0 || index >= terrain.heights.length) return false;
    const start = terrain.heights[index], target = start < -0.01 ? 0 : DROP_HEIGHT;
    viewBusy = true; down = null; keyboardFocus = index; notifyViewState();
    try {
      await animate(460, (t) => { updateTileHeight(terrain, index, start + (target - start) * ease(t)); resize(); });
      updateTileHeight(terrain, index, target);
    } finally { viewBusy = false; if (!disposed) { setFocus(index); resize(); notifyViewState(); } }
    return !disposed;
  };
  const resetBoardView = async () => {
    if (disposed || busy || viewBusy) return false;
    const terrain = activeTerrain(), heights = [...terrain.heights];
    const start = rotation > 180 ? rotation - 360 : rotation;
    viewBusy = true; dropMode = false; down = null; hovered = null; notifyViewState();
    try {
      await animate(460, (t) => {
        const progress = ease(t); rotation = start * (1 - progress); boardRoot.rotation.y = rotation * Math.PI / 180;
        heights.forEach((height, i) => updateTileHeight(terrain, i, height * (1 - progress))); resize();
      });
      rotation = 0; boardRoot.rotation.y = 0;
      terrain.heights.forEach((_, i) => updateTileHeight(terrain, i, 0));
    } finally { viewBusy = false; if (!disposed) { sync(latestState); setFocus(keyboardFocus); resize(); notifyViewState(); } }
    return !disposed;
  };
  const moveFocusTile = (index, key) => {
    const direction = { ArrowLeft: new Vector3(-1, 0, 0), ArrowRight: new Vector3(1, 0, 0), ArrowUp: new Vector3(0, 0, 1), ArrowDown: new Vector3(0, 0, -1) }[key];
    const size = activeTerrain().size;
    if (!Number.isInteger(index) || index < 0 || index >= size * size) index = Math.floor(size * size / 2);
    if (!direction) return index;
    const local = localDirection(direction);
    const dx = Math.abs(local.x) >= Math.abs(local.z) ? Math.sign(local.x) : 0;
    const dr = dx === 0 ? -Math.sign(local.z) : 0;
    return clamp(Math.floor(index / size) + dr, 0, size - 1) * size + clamp(index % size + dx, 0, size - 1);
  };

  const getTileAt = (event) => {
    if (viewBusy || (boardPreviewSize !== null && !dropMode)) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const viewport = camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    const top = canvas.clientHeight - viewport.y - viewport.height;
    if (x < viewport.x || x > viewport.x + viewport.width || y < top || y > top + viewport.height) return null;
    const pick = scene.pick(x, y, (mesh) => Number.isInteger(mesh.metadata?.tileIndex) && mesh.isEnabled());
    return pick?.hit ? pick.pickedMesh.metadata.tileIndex : null;
  };
  const pointerMove = (event) => {
    if (viewBusy || (boardPreviewSize !== null && !dropMode)) return;
    const index = getTileAt(event); if (index !== hovered) { hovered = index; if (!dropMode) onHover?.(index); }
    const active = index ?? keyboardFocus; focus.setEnabled(active !== null); if (active !== null) focus.position.copyFrom(viewCoord(active));
    canvas.style.cursor = index === null || busy || viewBusy ? 'default' : 'pointer';
  };
  const pointerLeave = () => { hovered = null; if (boardPreviewSize === null && !dropMode && !viewBusy) onHover?.(null); setFocus(keyboardFocus); };
  let down = null;
  const pointerDown = (event) => { if ((boardPreviewSize === null || dropMode) && event.button === 0 && !busy && !viewBusy) down = { x: event.clientX, y: event.clientY, index: getTileAt(event) }; };
  const pointerUp = (event) => {
    if (!down || busy || viewBusy || (boardPreviewSize !== null && !dropMode)) { down = null; return; }
    const index = getTileAt(event);
    if (index !== null && index === down.index && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 12) {
      if (dropMode) void toggleTileDrop(index); else onTileClick?.(index);
    }
    down = null;
  };
  const pointerCancel = () => { down = null; };
  canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerleave', pointerLeave);
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerCancel);
  const resize = () => {
    if (disposed) return;
    engine.resize(); const width = canvas.clientWidth || 1, height = canvas.clientHeight || 1;
    const mobile = width <= 760, short = height < 600;
    const dropDepth = -Math.min(0, ...activeTerrain().heights);
    const yawFit = 1 + (Math.abs(Math.cos(boardRoot.rotation.y)) + Math.abs(Math.sin(boardRoot.rotation.y)) - 1) * 0.85;
    if (boardPreviewSize !== null) {
      const top = short ? 135 : mobile ? 150 : 140, bottom = 40;
      const usable = Math.max(130, height - top - bottom), aspect = width / usable;
      camera.viewport.x = 0; camera.viewport.width = 1;
      camera.viewport.y = bottom / height; camera.viewport.height = usable / height;
      camera.setTarget(new Vector3(0, -0.12 - dropDepth * 0.30, 0)); camera.alpha = -Math.PI / 2; camera.beta = 0.94;
      const span = boardPreviewSize * STEP, focal = 2 * Math.tan(camera.fov / 2);
      const baseRadius = Math.max(3.8, 1.3 + (span + 0.70) / (focal * aspect), 1.1 + (span * Math.cos(camera.beta) + 1.05) / focal) + (boardPreviewSize - 1) * 0.50;
      camera.radius = baseRadius * yawFit + dropDepth * 0.95;
      return;
    }
    const top = mobile ? (short ? 95 : 150) : (short ? 80 : 100);
    const tablet = width > 760 && width <= 1000 && height >= 600;
    const bottom = mobile ? (short ? 205 : 280) : tablet ? 300 : (short ? 170 : 245);
    const usable = Math.max(150, height - top - bottom);
    camera.viewport.x = 0; camera.viewport.width = 1;
    const soilClearance = height >= 600 ? 45 : 0;
    camera.viewport.y = (bottom + soilClearance) / height; camera.viewport.height = usable / height;
    // Long focal length keeps the rear row a little narrower, without diamond rotation.
    const aspect = width / usable;
    camera.setTarget(new Vector3(0, 0.30 - dropDepth * 0.30, 0)); camera.alpha = -Math.PI / 2; camera.beta = 0.94;
    camera.radius = Math.max(mobile ? 12.3 : 10.9, 1.9 + 6.65 / (2 * Math.tan(camera.fov / 2) * aspect)) * yawFit + dropDepth * 0.95;
    actors.forEach((actor) => { actor.label.style.width = mobile ? '72px' : '82px'; });
  };
  let savedBattleCamera = null, savedLabelVisibility = '';
  const setBoardPreview = (size) => {
    if (disposed || busy || viewBusy) return false;
    if (size !== null && (!Number.isInteger(size) || size < 1 || size > 5)) throw new RangeError('Board preview size must be 1 through 5, or null.');
    if (size === boardPreviewSize) return true;
    rotation = 0; boardRoot.rotation.y = 0; dropMode = false; keyboardFocus = null; hovered = null; down = null;
    battleTerrain.heights.forEach((_, i) => updateTileHeight(battleTerrain, i, 0));
    if (size === null) {
      previewTerrain?.dispose(); previewTerrain = null; boardPreviewSize = null;
      battleTerrain.root.setEnabled(true);
      labelsRoot.style.visibility = savedLabelVisibility;
      if (savedBattleCamera) {
        camera.setTarget(savedBattleCamera.target); camera.alpha = savedBattleCamera.alpha; camera.beta = savedBattleCamera.beta;
      }
      effectMeshes.forEach((mesh) => mesh.setEnabled(true));
      sync(latestState); setFocus(keyboardFocus); resize(); notifyViewState();
      return true;
    }
    const nextTerrain = buildTerrain(size, `preview-${size}`);
    if (boardPreviewSize === null) {
      savedBattleCamera = { alpha: camera.alpha, beta: camera.beta, target: camera.target.clone() };
      savedLabelVisibility = labelsRoot.style.visibility;
    }
    previewTerrain?.dispose(); previewTerrain = nextTerrain; boardPreviewSize = size;
    battleTerrain.root.setEnabled(false); labelsRoot.style.visibility = 'hidden';
    actors.forEach((actor) => { actor.root.setEnabled(false); actor.leader.hidden = true; });
    overlays.forEach((overlay) => Object.values(overlay).forEach((mesh) => mesh.setEnabled(false)));
    effectMeshes.forEach((mesh) => mesh.setEnabled(false));
    hovered = null; down = null; focus.setEnabled(false); canvas.style.cursor = 'default';
    resize(); notifyViewState();
    return true;
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  sync(state); resize();
  const render = () => {
    if (disposed || document.hidden) return;
    const now = performance.now();
    animations.forEach((job) => {
      const t = clamp((now - job.started) / job.duration); job.update(t);
      if (t >= 1) { animations.delete(job); job.resolve(); }
    });
    actors.forEach(updateActorBillboard);
    scene.render();
    if (boardPreviewSize !== null) return;
    const placed = [];
    const visibleActors = [...actors.values()].filter((actor) => {
      if (!actor.root.isEnabled() || actor.label.hidden) { actor.leader.hidden = true; return false; }
      return true;
    }).map((actor) => ({ actor, p: projected(actor.root.position.add(localScreenUp().scale(actor.height + 0.09)).add(new Vector3(0, TURF_HEIGHT, 0))) }))
      .sort((a, b) => a.p.y - b.p.y);
    visibleActors.forEach(({ actor, p }) => {
      if (p.z < 0 || p.z > 1) { actor.label.style.display = 'none'; actor.leader.hidden = true; return; }
      actor.label.style.display = '';
      const width = canvas.clientWidth <= 760 ? 72 : 82, height = actor.label.offsetHeight || 43;
      let chosen = null;
      for (const dy of [0, -height - 7]) {
        for (const dx of [actor.labelOffset, 0, width + 9, -width - 9, 2 * width + 12, -2 * width - 12]) {
          const x = clamp(p.x + dx, width / 2 + 6, canvas.clientWidth - width / 2 - 6), y = p.y + dy;
          const box = { left: x - width / 2, right: x + width / 2, top: y - height, bottom: y };
          const overlaps = placed.some((r) => box.left < r.right + 5 && box.right > r.left - 5 && box.top < r.bottom + 5 && box.bottom > r.top - 5);
          if (!overlaps) { chosen = { x, y, box }; break; }
        }
        if (chosen) break;
      }
      chosen ||= { x: p.x, y: p.y, box: { left: p.x - width / 2, right: p.x + width / 2, top: p.y - height, bottom: p.y } };
      placed.push(chosen.box); actor.labelOffset = chosen.x - p.x;
      actor.label.style.left = `${chosen.x}px`; actor.label.style.top = `${chosen.y}px`;
      const offset = chosen.x - p.x;
      actor.leader.hidden = Math.abs(offset) < 5 && Math.abs(chosen.y - p.y) < 5;
      if (!actor.leader.hidden) {
        const endX = chosen.x - Math.sign(offset) * (width / 2 - 3), endY = chosen.y - 5;
        const dx = endX - p.x, dy = endY - p.y;
        actor.leader.style.left = `${p.x}px`; actor.leader.style.top = `${p.y}px`;
        actor.leader.style.width = `${Math.hypot(dx, dy)}px`; actor.leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      }
    });
  };
  engine.runRenderLoop(render);
  return {
    sync, showTargeting, setFocus, playEvents, resize, setBoardPreview,
    rotateBoard, setTileDropMode, toggleTileDrop, resetBoardView, getBoardViewState, moveFocusTile,
    dispose() {
      disposed = true; observer.disconnect(); engine.stopRenderLoop(render);
      previewTerrain?.dispose(); previewTerrain = null;
      labelsRoot.style.visibility = savedLabelVisibility;
      animations.forEach((job) => job.resolve()); animations.clear();
      canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerleave', pointerLeave);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel);
      labelElements.forEach((element) => element.remove()); if (ownLabelsRoot) labelsRoot.remove();
      scene.dispose(); engine.dispose();
    },
  };
}
