// Rounded fragments are morphological openings of sampled solids. Unlike a
// normal offset on an existing triangle mesh, erosion removes narrow tips and
// dilation reconstructs an actual rounded surface around the surviving core.
const FAR = 1e20;

// Exact squared Euclidean distance transform: the lower envelope of one-
// dimensional parabolas, applied along the three grid axes. Coordinates are in
// grid units here so all distances remain exact integer squares.
function squaredDistances(mask, nx, ny, nz, target) {
  const count = nx * ny * nz, values = new Float64Array(count);
  for (let i = 0; i < count; i++) values[i] = Boolean(mask[i]) === target ? 0 : FAR;
  const length = Math.max(nx, ny, nz), line = new Float64Array(length);
  const envelope = new Int32Array(length), boundary = new Float64Array(length + 1);
  const transform = (start, stride, size) => {
    for (let q = 0; q < size; q++) line[q] = values[start + q * stride];
    let last = -1;
    for (let q = 0; q < size; q++) {
      if (line[q] >= FAR) continue;
      let crossing = -Infinity;
      while (last >= 0) {
        const p = envelope[last];
        crossing = ((line[q] + q * q) - (line[p] + p * p)) / (2 * (q - p));
        if (crossing > boundary[last]) break;
        last--;
      }
      last++;
      envelope[last] = q;
      boundary[last] = last ? crossing : -Infinity;
      boundary[last + 1] = Infinity;
    }
    if (last < 0) return;
    let at = 0;
    for (let q = 0; q < size; q++) {
      while (at < last && boundary[at + 1] < q) at++;
      const p = envelope[at];
      values[start + q * stride] = (q - p) * (q - p) + line[p];
    }
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) transform(nx * (y + ny * z), 1, nx);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) transform(x + nx * ny * z, nx, ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) transform(x + nx * y, nx * ny, nz);
  return values;
}

function keepLargestCore(core, nx, ny, nz) {
  const queue = new Int32Array(core.length), layer = nx * ny;
  let largest = new Int32Array(0), components = 0, occupied = 0;
  for (let start = 0; start < core.length; start++) {
    if (core[start] !== 1) continue;
    components++;
    let head = 0, tail = 1;
    queue[0] = start; core[start] = 2;
    while (head < tail) {
      const id = queue[head++], x = id % nx, y = Math.floor(id / nx) % ny, z = Math.floor(id / layer);
      const visit = (next) => {
        if (core[next] === 1) { core[next] = 2; queue[tail++] = next; }
      };
      if (x) visit(id - 1);
      if (x + 1 < nx) visit(id + 1);
      if (y) visit(id - nx);
      if (y + 1 < ny) visit(id + nx);
      if (z) visit(id - layer);
      if (z + 1 < nz) visit(id + layer);
    }
    occupied += tail;
    if (tail > largest.length) largest = queue.slice(0, tail);
  }
  core.fill(0);
  for (const id of largest) core[id] = 1;
  return {coreOccupied: largest.length, componentsDiscarded: Math.max(0, components - 1), coreVoxelsDiscarded: occupied - largest.length};
}

function onGridBoundary(x, y, z, nx, ny, nz) {
  return x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1;
}

// All cubes use the same body diagonal. Adjacent cubes therefore agree on the
// diagonal of their shared face, avoiding the ambiguous faces of marching cubes.
const TETRAHEDRA = [[0,5,1,6], [0,1,2,6], [0,2,3,6], [0,3,7,6], [0,7,4,6], [0,4,5,6]];

function extractSurface(field, nx, ny, nz, origin, axes) {
  const positions = [], normals = [], indices = [], edgeVertices = new Map();
  const count = field.length, layer = nx * ny;
  const offsets = [0, 1, 1 + nx, nx, layer, layer + 1, layer + nx + 1, layer + nx];
  const gradient = (id) => {
    const x = id % nx, y = Math.floor(id / nx) % ny, z = Math.floor(id / layer);
    return [
      (field[id + (x + 1 < nx ? 1 : 0)] - field[id - (x ? 1 : 0)]) / (axes[0][Math.min(x + 1, nx - 1)] - axes[0][Math.max(x - 1, 0)]),
      (field[id + (y + 1 < ny ? nx : 0)] - field[id - (y ? nx : 0)]) / (axes[1][Math.min(y + 1, ny - 1)] - axes[1][Math.max(y - 1, 0)]),
      (field[id + (z + 1 < nz ? layer : 0)] - field[id - (z ? layer : 0)]) / (axes[2][Math.min(z + 1, nz - 1)] - axes[2][Math.max(z - 1, 0)]),
    ];
  };
  const vertex = (a, b) => {
    const key = a < b ? a * count + b : b * count + a;
    const existing = edgeVertices.get(key);
    if (existing !== undefined) return existing;
    const t = field[a] / (field[a] - field[b]);
    const ax = a % nx, ay = Math.floor(a / nx) % ny, az = Math.floor(a / layer);
    const bx = b % nx, by = Math.floor(b / nx) % ny, bz = Math.floor(b / layer);
    const id = positions.length / 3;
    positions.push(origin[0] + axes[0][ax] + (axes[0][bx] - axes[0][ax]) * t, origin[1] + axes[1][ay] + (axes[1][by] - axes[1][ay]) * t, origin[2] + axes[2][az] + (axes[2][bz] - axes[2][az]) * t);
    const ga = gradient(a), gb = gradient(b), normal = ga.map((value, j) => value + (gb[j] - value) * t);
    const length = Math.hypot(...normal);
    if (length < 1e-12) throw new Error('Rounded solid has an undefined surface normal.');
    normals.push(normal[0] / length, normal[1] / length, normal[2] / length);
    edgeVertices.set(key, id);
    return id;
  };
  const triangle = (a, b, c, outward) => {
    const ai = a * 3, bi = b * 3, ci = c * 3;
    const ab = [positions[bi] - positions[ai], positions[bi + 1] - positions[ai + 1], positions[bi + 2] - positions[ai + 2]];
    const ac = [positions[ci] - positions[ai], positions[ci + 1] - positions[ai + 1], positions[ci + 2] - positions[ai + 2]];
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const facing = cross.reduce((sum, value, j) => sum + value * outward[j], 0);
    // Babylon's front-face convention has an inward geometric cross product;
    // the stored vertex normals still point out of the solid.
    if (facing > 0) indices.push(a, c, b); else indices.push(a, b, c);
  };
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const start = x + nx * (y + ny * z), corners = offsets.map(offset => start + offset);
    let insideCount = 0;
    for (const id of corners) if (field[id] < 0) insideCount++;
    if (!insideCount || insideCount === 8) continue;
    for (const tetra of TETRAHEDRA) {
      const inside = [], outside = [];
      for (const corner of tetra) (field[corners[corner]] < 0 ? inside : outside).push(corners[corner]);
      if (!inside.length || inside.length === 4) continue;
      // The scalar field is linear inside a tetrahedron. The vector between its
      // inside/outside centroids gives an unambiguous orientation even where
      // smoothed shading normals differ from the small triangle's exact normal.
      const outward = [0, 0, 0];
      for (const [ids, sign] of [[inside, -1], [outside, 1]]) for (const id of ids) {
        outward[0] += sign * axes[0][id % nx] / ids.length;
        outward[1] += sign * axes[1][Math.floor(id / nx) % ny] / ids.length;
        outward[2] += sign * axes[2][Math.floor(id / layer)] / ids.length;
      }
      if (inside.length === 1 || outside.length === 1) {
        const single = inside.length === 1 ? inside[0] : outside[0], others = inside.length === 1 ? outside : inside;
        triangle(vertex(single, others[0]), vertex(single, others[1]), vertex(single, others[2]), outward);
      } else {
        const ac = vertex(inside[0], outside[0]), ad = vertex(inside[0], outside[1]);
        const bc = vertex(inside[1], outside[0]), bd = vertex(inside[1], outside[1]);
        triangle(ac, ad, bc, outward); triangle(ad, bd, bc, outward);
      }
    }
  }
  return {positions, indices, normals};
}

/**
 * Morphologically round a closed sampled solid without dependencies or GPU work.
 * Occupancy describes GRID NODES, indexed x + nx * (y + ny * z), not cell centers.
 * Caller supplies empty padding of at least radius + 2*spacing around the source.
 * Output coordinates include origin; index winding is Babylon clockwise and
 * normals are outward. The input array is never modified.
 */
export function roundVoxelSolid({occupancy, nx, ny, nz, origin = [0, 0, 0], spacing, radius, surfaceStride = 2}) {
  const started = performance.now();
  if (![nx, ny, nz].every(value => Number.isInteger(value) && value >= 3)) throw new RangeError('Rounded solid grid dimensions must be integers of at least three.');
  const count = nx * ny * nz;
  if (!Number.isSafeInteger(count * count) || occupancy?.length !== count) throw new RangeError('Rounded solid occupancy must match the grid dimensions.');
  if (!(spacing > 0 && Number.isFinite(spacing) && radius >= spacing && Number.isFinite(radius))) throw new RangeError('Rounded solid radius must be finite and at least one grid spacing.');
  if (!Number.isInteger(surfaceStride) || surfaceStride < 1 || surfaceStride > 2) throw new RangeError('Rounded solid surface stride must be one or two.');
  if (origin.length !== 3 || !origin.every(Number.isFinite)) throw new RangeError('Rounded solid origin must have three finite coordinates.');
  let originalOccupied = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const id = x + nx * (y + ny * z);
    if (!occupancy[id]) continue;
    originalOccupied++;
    if (onGridBoundary(x, y, z, nx, ny, nz)) throw new RangeError('Rounded solid requires empty grid padding around the source.');
  }
  if (!originalOccupied) throw new RangeError('Rounded solid occupancy is empty.');
  const radiusSquared = (radius / spacing) ** 2;
  let distances = squaredDistances(occupancy, nx, ny, nz, false);
  const core = new Uint8Array(count);
  for (let i = 0; i < count; i++) if (occupancy[i] && distances[i] > radiusSquared) core[i] = 1;
  const componentStats = keepLargestCore(core, nx, ny, nz);
  if (!componentStats.coreOccupied) throw new RangeError('Rounded solid has no core at the requested radius.');
  distances = squaredDistances(core, nx, ny, nz, true);
  // Squared EDT samples are integers. Keep the extraction level a small distance
  // below integer values, preventing zero samples and degenerate tetrahedra.
  // This changes the physical radius by less than .052*spacing, inward only.
  let isoSquared = radiusSquared;
  const fractional = isoSquared - Math.floor(isoSquared);
  if (fractional < 0.05) isoSquared = Math.floor(isoSquared) - 0.05;
  else if (fractional > 0.95) isoSquared = Math.floor(isoSquared) + 0.95;
  const effectiveRadius = Math.sqrt(isoSquared) * spacing;
  let roundOccupied = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const id = x + nx * (y + ny * z);
    distances[id] = Math.sqrt(distances[id]) * spacing - effectiveRadius;
    if (distances[id] < 0) {
      roundOccupied++;
      if (!occupancy[id]) throw new Error('Rounded solid escaped its original sampled volume.');
      if (onGridBoundary(x, y, z, nx, ny, nz)) throw new RangeError('Rounded solid reaches the grid boundary; increase padding.');
    }
  }
  const morphologyMs = performance.now() - started;
  // Morphology retains the original resolution. Only the continuous distance
  // field is sampled more sparsely for rendering. Include each final node even
  // when the last interval is shorter, so no boundary cell is dropped.
  const samples = [nx, ny, nz].map(size => {
    const result = [];
    for (let i = 0; i < size - 1; i += surfaceStride) result.push(i);
    result.push(size - 1); return result;
  });
  const [sx, sy, sz] = samples.map(values => values.length);
  let surfaceField = distances;
  if (surfaceStride !== 1) {
    surfaceField = new Float64Array(sx * sy * sz);
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      surfaceField[x + sx * (y + sy * z)] = distances[samples[0][x] + nx * (samples[1][y] + ny * samples[2][z])];
    }
  }
  const surface = extractSurface(surfaceField, sx, sy, sz, origin, samples.map(axis => axis.map(index => index * spacing)));
  if (!surface.indices.length) throw new Error('Rounded solid produced no surface.');
  return {...surface, stats: {
    originalOccupied, ...componentStats, roundOccupied,
    gridPoints: count, vertices: surface.positions.length / 3, triangles: surface.indices.length / 3,
    spacing, surfaceStride, surfaceSpacing: spacing * surfaceStride, surfaceDimensions: [sx, sy, sz],
    radius, effectiveRadius, winding: 'clockwise', morphologyMs, totalMs: performance.now() - started,
  }};
}
