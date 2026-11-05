import * as THREE from "three";

const corner = new THREE.Vector3();

export function composeMatrix(position, rotation, scale = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(scale, scale, scale)
  );
}

export function geometryBounds(geometry, matrix) {
  const box = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute("position")
  );
  if (matrix) box.applyMatrix4(matrix);
  return box;
}

// The monitor stand touches the desk, so connectivity pulls the whole desktop
// into one cluster. Keep only islands that sit inside this padded screen box
// and are smaller than a piece of furniture.
export function screenVolume(screenGeometry, screenMatrix) {
  const box = geometryBounds(screenGeometry, screenMatrix);
  box.min.x -= 0.08;
  box.max.x += 0.08;
  box.min.y -= 0.28;
  box.max.y += 0.06;
  box.min.z -= 0.18;
  box.max.z += 0.18;
  return box;
}

function boundsFromIndex(geometry) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const box = new THREE.Box3();

  for (let i = 0; i < index.count; i++) {
    corner.fromBufferAttribute(position, index.getX(i));
    box.expandByPoint(corner);
  }

  return box;
}

export function geometryWithIndex(source, indexArray) {
  const geometry = new THREE.BufferGeometry();

  for (const name of Object.keys(source.attributes)) {
    geometry.setAttribute(name, source.getAttribute(name));
  }

  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  geometry.boundingBox = boundsFromIndex(geometry);
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(
    new THREE.Sphere()
  );
  return geometry;
}

function worldSize(min, max, matrix) {
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

export function splitMeshByVolume(geometry, matrix, volume, maxSize = 0.75) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index || !position) return null;

  const source = index.array;
  const triangleCount = source.length / 3;
  const vertexCount = position.count;
  const parent = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;

  const find = (vertex) => {
    while (parent[vertex] !== vertex) {
      parent[vertex] = parent[parent[vertex]];
      vertex = parent[vertex];
    }
    return vertex;
  };

  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = source[triangle * 3];
    const b = source[triangle * 3 + 1];
    const c = source[triangle * 3 + 2];
    union(a, b);
    union(b, c);
  }

  const islands = new Map();
  const include = (island, vertex) => {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    if (x < island.min[0]) island.min[0] = x;
    if (y < island.min[1]) island.min[1] = y;
    if (z < island.min[2]) island.min[2] = z;
    if (x > island.max[0]) island.max[0] = x;
    if (y > island.max[1]) island.max[1] = y;
    if (z > island.max[2]) island.max[2] = z;
  };

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const root = find(source[triangle * 3]);
    let island = islands.get(root);
    if (!island) {
      island = {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
        keep: false,
      };
      islands.set(root, island);
    }
    include(island, source[triangle * 3]);
    include(island, source[triangle * 3 + 1]);
    include(island, source[triangle * 3 + 2]);
  }

  for (const island of islands.values()) {
    const box = worldSize(island.min, island.max, matrix);
    const size = box.getSize(corner);
    island.keep =
      Math.max(size.x, size.y, size.z) <= maxSize && box.intersectsBox(volume);
  }

  let monitorTriangles = 0;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    if (islands.get(find(source[triangle * 3])).keep) monitorTriangles += 1;
  }

  const monitor = new Uint32Array(monitorTriangles * 3);
  const rest = new Uint32Array((triangleCount - monitorTriangles) * 3);
  let monitorCursor = 0;
  let restCursor = 0;

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const keep = islands.get(find(source[triangle * 3])).keep;
    const target = keep ? monitor : rest;
    let cursor = keep ? monitorCursor : restCursor;
    target[cursor] = source[triangle * 3];
    target[cursor + 1] = source[triangle * 3 + 1];
    target[cursor + 2] = source[triangle * 3 + 2];
    if (keep) monitorCursor += 3;
    else restCursor += 3;
  }

  return { monitor, rest, monitorTriangles };
}
