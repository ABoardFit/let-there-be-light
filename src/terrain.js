import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const TURF_HEIGHT = 0.245;
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

function grassHemOffset(seed, x, z) {
  return (noise(seed * 3.7 + x * 4.3, z * 4.3 + 19.3) - 0.5) * 0.055;
}

// Geometry and source UV each preserve their end caps; only the central interval stretches.
export function nineSliceAxis(value, halfExtent, capWidth, uvStart, uvEnd, uvCap) {
  const low = -halfExtent, high = halfExtent;
  if (value <= low + capWidth) return uvStart + (value - low) / capWidth * uvCap;
  if (value >= high - capWidth) return uvEnd - (high - value) / capWidth * uvCap;
  return uvStart + uvCap + (value - low - capWidth) / (2 * (halfExtent - capWidth)) * (uvEnd - uvStart - 2 * uvCap);
}

// Read-only alpha analysis of the original artwork: U=.04 + i*.005. A 17-pixel
// median and 21-pixel triangular filter remove tiny roots while retaining clods.
// These samples shape geometry; they never stretch or remap the source RGB.
const sourceClodContour = [0.43274,0.42476,0.42464,0.42168,0.42345,0.41896,0.40176,0.38821,0.38087,0.36608,0.35098,0.34444,0.34454,0.34988,0.36156,0.36956,0.37058,0.37039,0.38066,0.39036,0.39272,0.40352,0.41217,0.40987,0.39961,0.38471,0.36908,0.36228,0.36268,0.3639,0.35843,0.35324,0.34294,0.33465,0.33376,0.33173,0.33149,0.33194,0.33634,0.34311,0.35344,0.3616,0.36456,0.36329,0.35842,0.3565,0.35856,0.36632,0.38042,0.39083,0.39562,0.39288,0.3849,0.37606,0.37092,0.36231,0.33747,0.3234,0.31376,0.30981,0.31165,0.31828,0.33004,0.3392,0.34422,0.35375,0.36123,0.35964,0.3594,0.36114,0.35431,0.34236,0.33567,0.33451,0.33711,0.3425,0.35332,0.36586,0.36949,0.36582,0.37551,0.37061,0.35778,0.3507,0.34682,0.33863,0.33381,0.33438,0.33883,0.34605,0.36009,0.36835,0.36638,0.36267,0.36376,0.36676,0.36348,0.3575,0.35792,0.36597,0.3789,0.38501,0.3822,0.38497,0.38281,0.3687,0.35651,0.34897,0.34703,0.35061,0.35593,0.35555,0.34173,0.33083,0.33147,0.33759,0.34711,0.36059,0.36369,0.38209,0.39442,0.40052,0.40936,0.41543,0.41277,0.40059,0.3859,0.37939,0.37942,0.37784,0.36966,0.35966,0.34618,0.33681,0.33473,0.33524,0.33019,0.3279,0.33404,0.34658,0.35647,0.35351,0.34092,0.33032,0.32655,0.33009,0.33993,0.36065,0.36821,0.36756,0.37138,0.38119,0.3894,0.39304,0.38753,0.37996,0.3783,0.37352,0.35954,0.34682,0.34212,0.3417,0.3452,0.351,0.36019,0.36388,0.35985,0.36021,0.36276,0.35893,0.35418,0.35703,0.36513,0.3743,0.37925,0.37794,0.37818,0.38594,0.39833,0.40529,0.4032,0.39394,0.39801,0.40597,0.42143];
const clodContourV = (u) => {
  const at = clamp((u - 0.04) / 0.005, 0, sourceClodContour.length - 1), i = Math.floor(at);
  return sourceClodContour[i] + (sourceClodContour[Math.min(i + 1, sourceClodContour.length - 1)] - sourceClodContour[i]) * (at - i);
};

export function createNineSliceBlock(scene, seed = 0, frontArt = false, { width = 0.999, depth = 0.999, capWidth = 0.055, capDepth = capWidth } = {}) {
  if (width <= capWidth * 2 || depth <= capDepth * 2 || Math.min(capWidth, capDepth) <= 0) throw new RangeError('Nine-slice caps must fit inside the block.');
  const mesh = new Mesh('nine-slice-earth-block-' + seed, scene), r = randomSource(701 + seed * 47);
  const uvRandom = randomSource(113 + seed * 61), uvTurn = Math.floor(uvRandom() * 4);
  const uvSpan = 0.43, uvOffsetU = uvRandom() * (1 - uvSpan), uvOffsetV = uvRandom() * (1 - uvSpan), uvCap = 0.065;
  const halfX = width / 2, halfZ = depth / 2, coreX = halfX - capWidth, coreZ = halfZ - capDepth;
  const curveDrop = 0.055, edgeHeight = TURF_HEIGHT - curveDrop, grassBottom = -0.045, segments = 8, wrapSegments = 2, sideSegments = 32;
  const positions = [], indices = [], uvs = [], normals = [], welded = new Map(), patches = [];
  const curveBoundary = new Set(), soilBoundary = new Set();
  let patchVertices;
  const vertex = (x, y, z, logicalX, logicalZ, nx, ny, nz) => {
    y += grassHemOffset(seed, x, z) * clamp((edgeHeight - y) / (edgeHeight - grassBottom));
    let u = nineSliceAxis(logicalX, halfX, capWidth, 0, uvSpan, uvCap), v = nineSliceAxis(logicalZ, halfZ, capDepth, 0, uvSpan, uvCap);
    [u, v] = uvTurn === 0 ? [u, v] : uvTurn === 1 ? [uvSpan - v, u] : uvTurn === 2 ? [uvSpan - u, uvSpan - v] : [v, uvSpan - u];
    u += uvOffsetU; v += uvOffsetV;
    const key = [x, y, z, u, v].map((value) => value.toFixed(10)).join(',');
    let id = welded.get(key);
    if (id === undefined) {
      id = positions.length / 3; welded.set(key, id);
      const length = Math.hypot(nx, ny, nz);
      positions.push(x, y, z); uvs.push(u, v); normals.push(nx / length, ny / length, nz / length);
    }
    patchVertices.add(id); return id;
  };
  const triangle = (a, b, c) => {
    const p = (i) => Vector3.FromArray(positions, i * 3);
    const cross = Vector3.Cross(p(b).subtract(p(a)), p(c).subtract(p(a)));
    if (cross.lengthSquared() < 1e-18) return;
    const expected = Vector3.FromArray(normals, a * 3).add(Vector3.FromArray(normals, b * 3)).add(Vector3.FromArray(normals, c * 3));
    if (Vector3.Dot(cross, expected) > 0) indices.push(a, c, b); else indices.push(a, b, c);
  };
  const quad = (a, b, c, d) => { triangle(a, b, c); triangle(a, c, d); };
  const patch = (row, col, kind, build) => {
    patchVertices = new Set(); const indexStart = indices.length;
    build(); patches.push({ row, col, kind, indexStart, indexCount: indices.length - indexStart, vertexIndices: [...patchVertices] });
  };
  patch(1, 1, 'center', () => {
    const center = vertex(0, TURF_HEIGHT, 0, 0, 0, 0, 1, 0), boundary = [];
    for (let side = 0; side < 4; side++) for (let step = 0; step < sideSegments; step++) {
      const t = -1 + 2 * step / sideSegments;
      const [x, z] = side === 0 ? [t * coreX, -coreZ] : side === 1 ? [coreX, t * coreZ] : side === 2 ? [-t * coreX, coreZ] : [-coreX, -t * coreZ];
      boundary.push(vertex(x, TURF_HEIGHT, z, x, z, 0, 1, 0));
    }
    boundary.forEach((id, i) => triangle(center, id, boundary[(i + 1) % boundary.length]));
  });
  const section = (level) => {
    if (level <= segments) {
      const angle = level / segments * Math.PI / 2;
      return { radial: Math.sin(angle), logical: level / segments, y: TURF_HEIGHT - curveDrop * (1 - Math.cos(angle)), sin: Math.sin(angle), cos: Math.cos(angle), inset: 0, wrap: 0 };
    }
    const t = (level - segments) / wrapSegments, drop = (edgeHeight - grassBottom) * t;
    return { radial: 1, logical: 1, y: edgeHeight - drop, sin: 1, cos: 0, inset: 0, wrap: drop };
  };
  for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
    patch(axis === 'z' ? (sign < 0 ? 0 : 2) : 1, axis === 'x' ? (sign < 0 ? 0 : 2) : 1, 'edge', () => {
      const rows = [];
      for (let level = 0; level <= segments + wrapSegments; level++) {
        const q = section(level), ids = [];
        for (let step = 0; step <= sideSegments; step++) {
          const end = -1 + 2 * step / sideSegments;
          const x = axis === 'x' ? sign * (coreX + capWidth * q.radial - q.inset) : end * coreX;
          const z = axis === 'z' ? sign * (coreZ + capDepth * q.radial - q.inset) : end * coreZ;
          const lx = axis === 'x' ? sign * (coreX + capWidth * q.logical + q.wrap) : x;
          const lz = axis === 'z' ? sign * (coreZ + capDepth * q.logical + q.wrap) : z;
          const id = vertex(x, q.y, z, lx, lz, axis === 'x' ? sign * q.sin / capWidth : 0, q.cos / curveDrop, axis === 'z' ? sign * q.sin / capDepth : 0);
          if (level === segments) curveBoundary.add(id);
          if (level === segments + wrapSegments) soilBoundary.add(id);
          ids.push(id);
        }
        rows.push(ids);
        if (level) for (let step = 1; step <= sideSegments; step++) quad(rows[level - 1][step - 1], rows[level - 1][step], ids[step], ids[step - 1]);
      }
    });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    patch(sz < 0 ? 0 : 2, sx < 0 ? 0 : 2, 'corner', () => {
      const rows = [];
      for (let level = 0; level <= segments + wrapSegments; level++) {
        const q = section(level), ids = [];
        for (let arc = 0; arc <= segments; arc++) {
          const angle = arc / segments * Math.PI / 2, cx = Math.cos(angle), cz = Math.sin(angle);
          const x = sx * (coreX + (capWidth * q.radial - q.inset) * cx), z = sz * (coreZ + (capDepth * q.radial - q.inset) * cz);
          const lx = sx * (coreX + (capWidth * q.logical + q.wrap) * cx), lz = sz * (coreZ + (capDepth * q.logical + q.wrap) * cz);
          const id = vertex(x, q.y, z, lx, lz, sx * q.sin * cx / capWidth, q.cos / curveDrop, sz * q.sin * cz / capDepth);
          if (level === segments) curveBoundary.add(id);
          if (level === segments + wrapSegments) soilBoundary.add(id);
          ids.push(id);
          if (level && arc) quad(rows[level - 1][arc - 1], rows[level - 1][arc], ids[arc], ids[arc - 1]);
        }
        rows.push(ids);
      }
    });
  }
  const byAngle = (a, b) => Math.atan2(positions[a * 3 + 2], positions[a * 3]) - Math.atan2(positions[b * 3 + 2], positions[b * 3]);
  const outline = [...curveBoundary].sort(byAngle), bodyOutline = [...soilBoundary].sort(byAngle);
  let topVertexCount = positions.length / 3;
  const topIndexCount = indices.length, topNormals = [...normals];
  const bodyDepth = 0.72 + r() * 0.14, artHeight = bodyDepth * 0.80, n = bodyOutline.length;
  const soilTop = grassBottom;
  // A UV seam needs duplicated vertices, but its positions are identical. All
  // geometry, including the grass/stone join and underside, is spatially welded.
  const seam = bodyOutline.reduce((best, id, i) => {
    const angle = Math.atan2(positions[id * 3 + 2], positions[id * 3]);
    const prior = bodyOutline[best];
    return Math.abs(angle + Math.PI * 0.75) < Math.abs(Math.atan2(positions[prior * 3 + 2], positions[prior * 3]) + Math.PI * 0.75) ? i : best;
  }, 0);
  // Change which original quarter faces the viewer, without mirroring, adding
  // face seams, or changing any spatial vertex. Neighbours show different clods.
  const stoneQuarterTurn = ((seed % 4) + 4) % 4;
  const sourceSeam = (seam + stoneQuarterTurn * n / 4) % n;
  const perimeter = [...bodyOutline.slice(sourceSeam), ...bodyOutline.slice(0, sourceSeam)];
  const distances = [0];
  for (let j = 1; j <= n; j++) {
    const a = perimeter[j - 1], b = perimeter[j % n];
    distances.push(distances[j - 1] + Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 2] - positions[b * 3 + 2]));
  }
  const stoneTopV = 0.53, stoneBottomV = 0.32;
  // Match source pixels per world unit in both axes. The board scales X/Z by
  // 1.16 but leaves Y unchanged; a fixed .76 strip squeezed clods horizontally.
  const stoneUSpan = (stoneTopV - stoneBottomV) * 724 / artHeight * distances[n] * 1.16 / 2172;
  const stoneUStart = 0.04 + r() * Math.max(0.01, 0.92 - stoneUSpan);
  const sourceU = distances.map((distance) => stoneUStart + stoneUSpan * distance / distances[n]);
  const terrainStoneUV = [];
  const seamAngle = Math.atan2(positions[perimeter[0] * 3 + 2], positions[perimeter[0] * 3]);
  const angles = perimeter.map((id) => (Math.atan2(positions[id * 3 + 2], positions[id * 3]) - seamAngle + Math.PI * 2) % (Math.PI * 2));
  angles.push(Math.PI * 2);
  for (let id = 0; id < topVertexCount; id++) {
    const angle = (Math.atan2(positions[id * 3 + 2], positions[id * 3]) - seamAngle + Math.PI * 2) % (Math.PI * 2);
    let j = 0; while (j < n - 1 && angle > angles[j + 1]) j++;
    const t = (angle - angles[j]) / (angles[j + 1] - angles[j]);
    const hemY = positions[perimeter[j] * 3 + 1] + (positions[perimeter[(j + 1) % n] * 3 + 1] - positions[perimeter[j] * 3 + 1]) * t;
    const sourceV = stoneTopV + clamp((positions[id * 3 + 1] - hemY) * (stoneTopV - stoneBottomV) / artHeight, 0, 0.13);
    terrainStoneUV.push(sourceU[j] + (sourceU[j + 1] - sourceU[j]) * t, sourceV);
  }
  // The grass UV seam and the stone atlas seam are different. Duplicate only
  // the crossing rim vertices so a narrow corner never interpolates the entire
  // atlas strip. The shader wraps this unwrapped coordinate after interpolation.
  const duplicated = new Map();
  for (let i = 0; i < topIndexCount; i += 3) {
    const ids = indices.slice(i, i + 3), us = ids.map(id => terrainStoneUV[id * 2]);
    if (Math.max(...us) - Math.min(...us) < stoneUSpan * 0.5) continue;
    for (let j = 0; j < 3; j++) {
      const id = ids[j];
      if (terrainStoneUV[id * 2] >= stoneUStart + stoneUSpan * 0.5) continue;
      let copy = duplicated.get(id);
      if (copy === undefined) {
        copy = positions.length / 3; duplicated.set(id, copy);
        positions.push(...positions.slice(id * 3, id * 3 + 3));
        normals.push(...normals.slice(id * 3, id * 3 + 3));
        topNormals.push(...topNormals.slice(id * 3, id * 3 + 3));
        uvs.push(...uvs.slice(id * 2, id * 2 + 2));
        terrainStoneUV.push(terrainStoneUV[id * 2] + stoneUSpan, terrainStoneUV[id * 2 + 1]);
      }
      indices[i + j] = copy;
      const owner = patches.find(patch => i >= patch.indexStart && i < patch.indexStart + patch.indexCount);
      if (owner && !owner.vertexIndices.includes(copy)) owner.vertexIndices.push(copy);
    }
  }
  topVertexCount = positions.length / 3;
  const wallCoordinate = (value, halfExtent, cap, blend) => {
    const radius = cap + (Math.min(cap, 0.012) - cap) * blend, core = halfExtent - cap;
    const absolute = Math.abs(value), newCore = halfExtent - radius;
    // Keep the main wall fixed in place. Rescaling its entire width made every
    // stone crack bend together where the upper transition ended.
    if (absolute <= core) {
      const t = clamp((absolute - (core - 0.10)) / 0.10);
      return Math.sign(value) * (absolute + (newCore - core) * t * t * (3 - 2 * t));
    }
    return Math.sign(value) * (newCore + radius * (absolute - core) / cap);
  };
  const lowerPoints = perimeter.map((id) => [wallCoordinate(positions[id * 3], halfX, capWidth, 1), wallCoordinate(positions[id * 3 + 2], halfZ, capDepth, 1)]);
  const lowerDistances = [0];
  for (let j = 1; j <= n; j++) lowerDistances.push(lowerDistances[j - 1] + Math.hypot(lowerPoints[j % n][0] - lowerPoints[j - 1][0], lowerPoints[j % n][1] - lowerPoints[j - 1][1]));
  const rawContour = sourceU.slice(0, n).map(clodContourV);
  rawContour[0] = Math.max(rawContour[0], clodContourV(sourceU[n]));
  // Smooth in physical distance, including compressed corners and the UV seam.
  // The resulting broad lobes move the bottom geometry, not the artwork scale.
  const contourV = rawContour.map((_, j) => {
    let sum = 0, weights = 0;
    for (let k = 0; k < n; k++) {
      const distance = Math.abs(lowerDistances[j] - lowerDistances[k]);
      const cyclic = Math.min(distance, lowerDistances[n] - distance);
      if (cyclic > 0.055) continue;
      const segmentWidth = (lowerDistances[k + 1] - lowerDistances[k] + (k ? lowerDistances[k] - lowerDistances[k - 1] : lowerDistances[n] - lowerDistances[n - 1])) / 2;
      const weight = (1 - cyclic / 0.055) * segmentWidth;
      sum += rawContour[k] * weight; weights += weight;
    }
    return sum / weights + 0.002;
  });
  const rawBottomHeights = perimeter.map((id, j) => positions[id * 3 + 1] - (stoneTopV - contourV[j]) / (stoneTopV - stoneBottomV) * artHeight);
  // Keep the source clod's full vertical contour, including at corners. Raising
  // corner heights shaved the ends flat; round the lower footprint instead.
  const bottomHeights = rawBottomHeights;
  const solidDepth = grassBottom - Math.min(...bottomHeights);
  const rimRadius = Math.min(0.045, halfX * 0.10, halfZ * 0.10);
  const rings = [];
  for (const t of [0, 0.10, 0.22, 0.48, 0.74, 1]) rings.push({ t, scale: 1, rim: 0 });
  for (let level = 1; level <= 5; level++) {
    const angle = level / 5 * Math.PI / 2;
    rings.push({ t: 1, scale: 1 - rimRadius / Math.min(halfX, halfZ) * (1 - Math.cos(angle)), rim: Math.sin(angle) });
  }
  const stoneRings = [];
  for (const [ringIndex, ring] of rings.entries()) {
    const ids = [];
    for (let j = 0; j <= n; j++) {
      const id = perimeter[j % n], x = positions[id * 3], z = positions[id * 3 + 2], topY = positions[id * 3 + 1];
      // Keep neighbouring walls flush. The rounded turf corner transitions into
      // a smaller stone corner without reducing the side's full half-extent.
      const transition = clamp(ring.t / 0.22), lowerRound = clamp((ring.t - 0.74) / 0.26);
      const cornerBlend = transition * transition * (3 - 2 * transition)
        * (1 - 0.88 * lowerRound * lowerRound * (3 - 2 * lowerRound));
      const wallX = wallCoordinate(x, halfX, capWidth, cornerBlend), wallZ = wallCoordinate(z, halfZ, capDepth, cornerBlend);
      const bottomY = bottomHeights[j % n];
      const y = topY + ring.t * (bottomY + rimRadius - topY) - rimRadius * ring.rim;
      ids.push(positions.length / 3);
      positions.push(wallX * ring.scale, y, wallZ * ring.scale);
      const uvT = (topY - y) / artHeight;
      uvs.push(sourceU[j], stoneTopV + (stoneBottomV - stoneTopV) * uvT);
    }
    stoneRings.push(ids);
    if (ringIndex) for (let j = 0; j < n; j++) {
      const a = stoneRings[ringIndex - 1][j], b = stoneRings[ringIndex - 1][j + 1], c = ids[j + 1], d = ids[j];
      indices.push(a, c, b, a, d, c);
    }
  }
  // A fully opaque square of the original stone art (alpha >= 250 in the source)
  // avoids dragging transparent silhouette colours across the underside.
  const bottomIndexStart = indices.length, bottomRing = stoneRings.at(-1), bottomIds = [];
  const bottomUv = (x, z) => [(694 + 97 * (x / width + 0.5)) / 2172, 1 - (461 - 97 * (z / depth + 0.5)) / 724];
  for (let j = 0; j < n; j++) {
    const id = bottomRing[j], x = positions[id * 3], y = positions[id * 3 + 1], z = positions[id * 3 + 2];
    bottomIds.push(positions.length / 3); positions.push(x, y, z); uvs.push(...bottomUv(x, z));
  }
  // Absorb the irregular rim only near the edge. Carrying its angular height
  // differences all the way to the centre creates radial folds even with rings.
  const undersideRings = [bottomIds];
  const centerY = Math.min(...bottomIds.map((id) => positions[id * 3 + 1])) - 0.075;
  const bowlY = (x, z) => centerY + 0.055 * ((x / halfX) ** 2 + (z / halfZ) ** 2);
  for (let level = 1; level < 20; level++) {
    const t = level / 20, radius = 1 - t, fade = clamp(t / 0.35);
    const heightWeight = 1 - fade * fade * (3 - 2 * fade), ids = [];
    for (let j = 0; j < n; j++) {
      const edge = bottomIds[j], x = positions[edge * 3] * radius, z = positions[edge * 3 + 2] * radius;
      let edgeDelta = 0, totalWeight = 0;
      const blurRadius = 0.22 * fade;
      for (let k = 0; k < n; k++) {
        const distance = Math.abs(lowerDistances[j] - lowerDistances[k]);
        const cyclic = Math.min(distance, lowerDistances[n] - distance);
        if (cyclic > blurRadius) continue;
        const id = bottomIds[k], weight = (1 - cyclic / blurRadius) ** 2;
        edgeDelta += (positions[id * 3 + 1] - bowlY(positions[id * 3], positions[id * 3 + 2])) * weight;
        totalWeight += weight;
      }
      const y = bowlY(x, z) + edgeDelta / totalWeight * heightWeight;
      ids.push(positions.length / 3); positions.push(x, y, z); uvs.push(...bottomUv(x, z));
    }
    const outer = undersideRings.at(-1);
    for (let j = 0; j < n; j++) {
      const next = (j + 1) % n;
      indices.push(outer[j], ids[next], outer[next], outer[j], ids[j], ids[next]);
    }
    undersideRings.push(ids);
  }
  const bottomCenter = positions.length / 3;
  positions.push(0, centerY, 0); uvs.push(...bottomUv(0, 0));
  const inner = undersideRings.at(-1);
  for (let j = 0; j < n; j++) indices.push(bottomCenter, inner[(j + 1) % n], inner[j]);
  VertexData.ComputeNormals(positions, indices, normals);
  // Average the normals at UV seams without changing the surface or the top's
  // analytic cap normals. This avoids hard corner lines on the rounded rim.
  const normalGroups = new Map();
  for (let id = topVertexCount; id < positions.length / 3; id++) {
    const key = positions.slice(id * 3, id * 3 + 3).map((value) => value.toFixed(8)).join(',');
    if (!normalGroups.has(key)) normalGroups.set(key, []);
    normalGroups.get(key).push(id);
  }
  for (const ids of normalGroups.values()) {
    const normal = ids.reduce((sum, id) => sum.add(Vector3.FromArray(normals, id * 3)), Vector3.Zero()).normalize();
    for (const id of ids) normals.splice(id * 3, 3, normal.x, normal.y, normal.z);
  }
  for (let i = 0; i < topNormals.length; i++) normals[i] = topNormals[i];
  terrainStoneUV.push(...uvs.slice(topVertexCount * 2));
  const terrainBottomLight = new Array(positions.length / 3).fill(0);
  for (let level = 1; level < undersideRings.length; level++) {
    const t = clamp(level / 5), amount = t * t * (3 - 2 * t);
    for (const id of undersideRings[level]) terrainBottomLight[id] = amount;
  }
  terrainBottomLight[bottomCenter] = 1;
  const colors = new Array(positions.length / 3 * 4).fill(1);
  for (let id = 0; id < topVertexCount; id++) {
    const nx = normals[id * 3], ny = normals[id * 3 + 1], nz = normals[id * 3 + 2], horizontal = Math.hypot(nx, nz);
    const facing = horizontal > 0.001 ? clamp((-nx * 0.8 - nz * 0.55) / (horizontal * Math.hypot(0.8, 0.55))) ** 1.3 : 0;
    const bend = 1 - ny;
    colors[id * 4] = 1 - bend * (0.28 - facing * 0.22);
    colors[id * 4 + 1] = 1 - bend * (0.28 - facing * 0.14);
    colors[id * 4 + 2] = 1 - bend * (0.28 + facing * 0.08);
  }
  const data = new VertexData(); Object.assign(data, { positions, indices, normals, uvs, colors }); data.applyToMesh(mesh);
  mesh.setVerticesData('terrainStoneUV', terrainStoneUV, false, 2);
  mesh.setVerticesData('terrainBottomLight', terrainBottomLight, false, 1);
  mesh.releaseSubMeshes();
  new SubMesh(0, 0, topVertexCount, 0, topIndexCount, mesh);
  new SubMesh(1, topVertexCount, positions.length / 3 - topVertexCount, topIndexCount, indices.length - topIndexCount, mesh);
  mesh.metadata = { nineSlice: { width, depth, capWidth, capDepth, uvCap, edgeHeight, grassBottom, soilTop, topVertexCount, outline, bodyOutline, patches, bodyDepth, artHeight, solidDepth, curveSegments: segments, stoneRings, bottomIndexStart, bottomIds, undersideRings, stoneUStart, stoneUSpan, stoneTopV, stoneBottomV, stoneQuarterTurn, rimRadius } };
  return mesh;
}

