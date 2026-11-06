import * as THREE from "three";
import { geometryWithIndex } from "./splitGeometry.js";

const corner = new THREE.Vector3();
const scratchSize = new THREE.Vector3();
const scratchCenter = new THREE.Vector3();

function worldBox(min, max, matrix) {
  const box = new THREE.Box3();
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        box.expandByPoint(corner.set(x, y, z).applyMatrix4(matrix));
      }
    }
  }
  return box;
}

function findRoot(parent, vertex) {
  let root = vertex;
  while (parent[root] !== root) root = parent[root];
  let cursor = vertex;
  while (parent[cursor] !== root) {
    const next = parent[cursor];
    parent[cursor] = root;
    cursor = next;
  }
  return root;
}

// Horizontal slabs belong to the desk or a shelf. A keyboard is thin as well,
// but it is smaller than a desktop, so it can still leave with the small objects.
function isBoard(center, size) {
  const x = center.x ?? center[0];
  const horizontal = Math.max(size.x, size.z);
  if (size.y < 0.12 && horizontal > 0.35) return true;
  return size.y < 0.09 && horizontal > 0.22 && x > 1.45 && x < 2.25;
}

function coveredBy(center, volumes) {
  const x = center.x ?? center[0];
  const y = center.y ?? center[1];
  const z = center.z ?? center[2];
  return volumes.some(
    (volume) =>
      volume.absorb &&
      x >= volume.min[0] &&
      x <= volume.max[0] &&
      y >= volume.min[1] &&
      y <= volume.max[1] &&
      z >= volume.min[2] &&
      z <= volume.max[2]
  );
}

function acceptCluster(center, size, triangles) {
  const maxDim = Math.max(size.x, size.y, size.z);
  const thin = [size.x, size.y, size.z].sort((a, b) => a - b);
  const y = center.y ?? center[1];
  const floorSheet = size.y < 0.045 && y < 0.22;
  return (
    triangles >= 500 &&
    maxDim >= 0.08 &&
    maxDim <= 0.7 &&
    !floorSheet &&
    !(thin[0] < 0.02 && thin[1] < 0.08) &&
    !isBoard(center, size)
  );
}

function buildIslands(geometry, matrix) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index || !position) return null;

  const source = index.array;
  const triangleCount = source.length / 3;
  const parent = new Uint32Array(position.count);
  for (let vertex = 0; vertex < parent.length; vertex += 1) parent[vertex] = vertex;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const a = findRoot(parent, source[offset]);
    const b = findRoot(parent, source[offset + 1]);
    if (a !== b) parent[b] = a;
    const root = findRoot(parent, source[offset]);
    const c = findRoot(parent, source[offset + 2]);
    if (root !== c) parent[c] = root;
  }

  const islands = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const root = findRoot(parent, source[offset]);
    let island = islands.get(root);
    if (!island) {
      island = {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
        tris: 0,
        claim: -1,
      };
      islands.set(root, island);
    }
    island.tris += 1;
    for (let cornerIndex = 0; cornerIndex < 3; cornerIndex += 1) {
      const vertex = source[offset + cornerIndex];
      const x = position.getX(vertex);
      const y = position.getY(vertex);
      const z = position.getZ(vertex);
      if (x < island.min[0]) island.min[0] = x;
      if (y < island.min[1]) island.min[1] = y;
      if (z < island.min[2]) island.min[2] = z;
      if (x > island.max[0]) island.max[0] = x;
      if (y > island.max[1]) island.max[1] = y;
      if (z > island.max[2]) island.max[2] = z;
    }
  }

  for (const island of islands.values()) {
    const box = worldBox(island.min, island.max, matrix);
    box.getSize(scratchSize);
    box.getCenter(scratchCenter);
    island.box = box;
    island.center = [scratchCenter.x, scratchCenter.y, scratchCenter.z];
    island.maxDim = Math.max(scratchSize.x, scratchSize.y, scratchSize.z);
  }

  return { source, triangleCount, parent, islands };
}

function clusterIslands(records) {
  const gap = 0.008;
  const cell = 0.15;
  const grid = new Map();
  records.forEach((island, index) => {
    const key = [
      Math.floor(island.center[0] / cell),
      Math.floor(island.center[1] / cell),
      Math.floor(island.center[2] / cell),
    ].join(",");
    const list = grid.get(key);
    if (list) list.push(index);
    else grid.set(key, [index]);
  });

  const parent = records.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };

  const near = (a, b) =>
    a.box.max.x + gap >= b.box.min.x &&
    b.box.max.x + gap >= a.box.min.x &&
    a.box.max.y + gap >= b.box.min.y &&
    b.box.max.y + gap >= a.box.min.y &&
    a.box.max.z + gap >= b.box.min.z &&
    b.box.max.z + gap >= a.box.min.z;

  for (let index = 0; index < records.length; index += 1) {
    const island = records[index];
    const ix = Math.floor(island.center[0] / cell);
    const iy = Math.floor(island.center[1] / cell);
    const iz = Math.floor(island.center[2] / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const list = grid.get([ix + dx, iy + dy, iz + dz].join(","));
          if (!list) continue;
          for (const otherIndex of list) {
            if (otherIndex <= index) continue;
            if (near(island, records[otherIndex])) {
              parent[find(otherIndex)] = find(index);
            }
          }
        }
      }
    }
  }

  const groups = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(records[index]);
    else groups.set(root, [records[index]]);
  }
  return [...groups.values()];
}

function boxVolume(volume) {
  return (
    (volume.max[0] - volume.min[0]) *
    (volume.max[1] - volume.min[1]) *
    (volume.max[2] - volume.min[2])
  );
}

function isFloorSheet(island) {
  island.box.getSize(scratchSize);
  return scratchSize.y < 0.045 && island.center[1] < 0.22;
}

function fitsVolume(island, volume) {
  if (island.maxDim > volume.maxIsland) return false;
  const [x, y, z] = island.center;
  if (
    x < volume.min[0] ||
    x > volume.max[0] ||
    y < volume.min[1] ||
    y > volume.max[1] ||
    z < volume.min[2] ||
    z > volume.max[2]
  ) {
    return false;
  }

  const sheet = isFloorSheet(island);
  if (sheet && volume.surface !== "floor" && volume.surface !== "table") return false;
  if (sheet && volume.surface === "table" && y < (volume.tableTop ?? 0.6)) return false;
  if (!sheet && volume.surface === "floor") return false;

  const pad = volume.pad ?? 0.08;
  const box = island.box;
  return (
    box.min.x >= volume.min[0] - pad &&
    box.max.x <= volume.max[0] + pad &&
    box.min.y >= volume.min[1] - pad &&
    box.max.y <= volume.max[1] + pad &&
    box.min.z >= volume.min[2] - pad &&
    box.max.z <= volume.max[2] + pad
  );
}

function containingVolume(island, volumes) {
  let best = null;
  let bestSize = Infinity;
  for (const volume of volumes) {
    if (!fitsVolume(island, volume)) continue;
    const size = boxVolume(volume);
    if (size < bestSize) {
      best = volume;
      bestSize = size;
    }
  }
  return best;
}

function emitPieces(geometry, source, triangleCount, parent, islands, objects) {
  const claimOf = new Int32Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    claimOf[triangle] = islands.get(findRoot(parent, source[triangle * 3])).claim;
  }

  const counts = new Int32Array(objects.length + 1);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const claim = claimOf[triangle];
    counts[claim === -1 ? objects.length : claim] += 1;
  }

  const buffers = Array.from(counts, (count) => new Uint32Array(count * 3));
  const cursors = new Int32Array(buffers.length);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const claim = claimOf[triangle];
    const slot = claim === -1 ? objects.length : claim;
    const buffer = buffers[slot];
    let cursor = cursors[slot];
    const offset = triangle * 3;
    buffer[cursor] = source[offset];
    buffer[cursor + 1] = source[offset + 1];
    buffer[cursor + 2] = source[offset + 2];
    cursors[slot] = cursor + 3;
  }

  return objects.map((object, index) => ({
    ...object,
    geometry: counts[index] ? geometryWithIndex(geometry, buffers[index]) : null,
    triangles: counts[index],
  })).concat([
    {
      geometry: counts[objects.length]
        ? geometryWithIndex(geometry, buffers[objects.length])
        : null,
      triangles: counts[objects.length],
    },
  ]);
}

// One baked mesh becomes separate objects plus the faces left on the shell.
// Islands closer than 8mm form an object only when that object stays under 0.7m.
// Furniture volumes then take what is left inside their own bounds.
export function extractMesh(geometry, matrix, volumes = []) {
  const built = buildIslands(geometry, matrix);
  if (!built) return null;
  const { source, triangleCount, parent, islands } = built;
  const records = [];
  for (const island of islands.values()) {
    if (island.maxDim <= 0.4 && island.tris >= 12) records.push(island);
  }

  const objects = [];
  for (const group of clusterIslands(records)) {
    const box = new THREE.Box3();
    let triangles = 0;
    for (const island of group) {
      box.union(island.box);
      triangles += island.tris;
    }
    box.getSize(scratchSize);
    box.getCenter(scratchCenter);
    if (!acceptCluster(scratchCenter, scratchSize, triangles)) continue;
    if (coveredBy(scratchCenter, volumes)) continue;
    const claimId = objects.length;
    for (const island of group) island.claim = claimId;
    objects.push({
      claimId,
      center: [scratchCenter.x, scratchCenter.y, scratchCenter.z],
      size: [scratchSize.x, scratchSize.y, scratchSize.z],
      triangles,
      fromVolume: false,
    });
  }

  const volumeClaims = new Map();
  for (const island of islands.values()) {
    if (island.claim !== -1) continue;
    const volume = containingVolume(island, volumes);
    if (!volume) continue;
    let claim = volumeClaims.get(volume.id);
    if (!claim) {
      claim = objects.length;
      volumeClaims.set(volume.id, claim);
      objects.push({
        claimId: claim,
        id: volume.id,
        label: volume.label,
        kind: volume.kind,
        center: [0, 0, 0],
        size: [0, 0, 0],
        triangles: 0,
        fromVolume: true,
        box: new THREE.Box3(),
      });
    }
    island.claim = claim;
    const object = objects[claim];
    object.triangles += island.tris;
    object.box.union(island.box);
  }

  for (const object of objects) {
    if (!object.fromVolume || object.triangles === 0) continue;
    object.box.getSize(scratchSize);
    object.box.getCenter(scratchCenter);
    object.center = [scratchCenter.x, scratchCenter.y, scratchCenter.z];
    object.size = [scratchSize.x, scratchSize.y, scratchSize.z];
  }

  const rejected = new Set();
  for (const object of objects) {
    if (!object.fromVolume) continue;
    const maxDim = Math.max(object.size[0], object.size[1], object.size[2]);
    if (object.triangles < 400 || maxDim < 0.3) rejected.add(object.claimId);
  }
  if (rejected.size) {
    for (const island of islands.values()) {
      if (rejected.has(island.claim)) island.claim = -1;
    }
  }

  const pieces = emitPieces(geometry, source, triangleCount, parent, islands, objects);
  const rest = pieces[objects.length];
  const packed = pieces
    .slice(0, objects.length)
    .filter((object) => object.geometry && !rejected.has(object.claimId));
  const claimedTriangles = packed.reduce((sum, object) => sum + object.triangles, 0);

  return {
    objects: packed,
    rest: rest.geometry,
    restTriangles: rest.triangles,
    sourceTriangles: triangleCount,
    claimedTriangles,
  };
}
