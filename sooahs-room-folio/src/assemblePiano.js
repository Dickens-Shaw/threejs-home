import * as THREE from "three";

const corner = new THREE.Vector3();
const islandBox = new THREE.Box3();
const islandSize = new THREE.Vector3();

function isPianoKey(name) {
  return name.includes("_Key_") && !name.includes("Keyboard");
}

function worldBoxFromLocal(min, max, matrix, target) {
  target.makeEmpty();
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        target.expandByPoint(corner.set(x, y, z).applyMatrix4(matrix));
      }
    }
  }
  return target;
}

function pianoVolume(keyBox) {
  const volume = keyBox.clone();
  volume.min.x -= 0.4;
  volume.max.x += 0.4;
  volume.min.y -= 0.3;
  volume.max.y += 0.12;
  volume.min.z -= 0.5;
  volume.max.z += 0.05;
  return volume;
}

function isAcrylicSheet(size) {
  const minEdge = Math.min(size.x, size.y, size.z);
  const maxEdge = Math.max(size.x, size.y, size.z);
  return minEdge < 0.06 && maxEdge > 1.2;
}

// The clear case is a set of tall flat sheets that touch the keyboard.
// The stand is the tube frame under the keys, so it is kept with the instrument.
function keepIsland(worldBox, volume, keyBox) {
  worldBox.getSize(islandSize);
  const keyWidth = keyBox.getSize(corner).x;
  const maxEdge = Math.max(islandSize.x, islandSize.y, islandSize.z);
  const instrument =
    worldBox.intersectsBox(volume) &&
    worldBox.min.y >= keyBox.min.y - 0.35 &&
    islandSize.y <= 0.8 &&
    maxEdge <= keyWidth + 0.8;
  if (instrument) return true;

  const centerX = (worldBox.min.x + worldBox.max.x) * 0.5;
  const centerY = (worldBox.min.y + worldBox.max.y) * 0.5;
  const centerZ = (worldBox.min.z + worldBox.max.z) * 0.5;
  return (
    centerX >= keyBox.min.x - 0.15 &&
    centerX <= keyBox.max.x + 0.15 &&
    centerZ >= keyBox.min.z - 0.65 &&
    centerZ <= keyBox.max.z + 0.35 &&
    centerY >= keyBox.min.y - 2.15 &&
    centerY <= keyBox.max.y &&
    worldBox.min.y >= keyBox.min.y - 2.2 &&
    maxEdge <= 1.6 &&
    !isAcrylicSheet(islandSize)
  );
}

export function splitPianoGeometry(geometry, matrix, keyBox) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index || !position) return null;

  const source = index.array;
  const triangleCount = source.length / 3;
  const parent = new Uint32Array(position.count);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;

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

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = source[triangle * 3];
    const b = source[triangle * 3 + 1];
    const c = source[triangle * 3 + 2];
    union(a, b);
    union(b, c);
  }

  const islands = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
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
    for (let cornerIndex = 0; cornerIndex < 3; cornerIndex += 1) {
      const vertex = source[triangle * 3 + cornerIndex];
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

  const volume = pianoVolume(keyBox);
  for (const island of islands.values()) {
    worldBoxFromLocal(island.min, island.max, matrix, islandBox);
    island.keep = keepIsland(islandBox, volume, keyBox);
  }

  let bodyTriangles = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (islands.get(find(source[triangle * 3])).keep) bodyTriangles += 1;
  }
  if (bodyTriangles === 0) return null;

  const body = new Uint32Array(bodyTriangles * 3);
  const rest = new Uint32Array((triangleCount - bodyTriangles) * 3);
  let bodyCursor = 0;
  let restCursor = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const keep = islands.get(find(source[triangle * 3])).keep;
    const target = keep ? body : rest;
    const cursor = keep ? bodyCursor : restCursor;
    target[cursor] = source[triangle * 3];
    target[cursor + 1] = source[triangle * 3 + 1];
    target[cursor + 2] = source[triangle * 3 + 2];
    if (keep) bodyCursor += 3;
    else restCursor += 3;
  }

  return { body, rest, bodyTriangles };
}

function compactGeometry(source, indexArray) {
  const remap = new Map();
  const newIndex = new Uint32Array(indexArray.length);
  let next = 0;
  for (let i = 0; i < indexArray.length; i += 1) {
    const previous = indexArray[i];
    let mapped = remap.get(previous);
    if (mapped === undefined) {
      mapped = next;
      next += 1;
      remap.set(previous, mapped);
    }
    newIndex[i] = mapped;
  }

  const geometry = new THREE.BufferGeometry();
  for (const name of Object.keys(source.attributes)) {
    const attribute = source.getAttribute(name);
    const array = new Float32Array(next * attribute.itemSize);
    for (const [previous, mapped] of remap) {
      for (let channel = 0; channel < attribute.itemSize; channel += 1) {
        array[mapped * attribute.itemSize + channel] = attribute.getComponent(previous, channel);
      }
    }
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized)
    );
  }
  geometry.setIndex(new THREE.BufferAttribute(newIndex, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function assemblePiano(root) {
  root.updateMatrixWorld(true);

  let shell = null;
  const keys = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (child.name === "Third") shell = child;
    else if (isPianoKey(child.name)) keys.push(child);
  });
  if (!shell || keys.length === 0) return null;

  const keyBox = new THREE.Box3();
  keys.forEach((key) => keyBox.expandByObject(key));
  if (keyBox.isEmpty()) return null;

  const split = splitPianoGeometry(shell.geometry, shell.matrixWorld, keyBox);
  if (!split) return null;

  const bodyGeometry = compactGeometry(shell.geometry, split.body);
  const restGeometry = compactGeometry(shell.geometry, split.rest);
  shell.geometry.dispose();
  shell.geometry = restGeometry;

  const group = new THREE.Group();
  group.name = "Piano_Third";
  shell.parent.add(group);

  const body = new THREE.Mesh(bodyGeometry, shell.material);
  body.name = "Piano_Body";
  body.position.copy(shell.position);
  body.quaternion.copy(shell.quaternion);
  body.scale.copy(shell.scale);
  group.attach(body);

  const boundHitboxes = [];
  keys.forEach((key) => {
    group.attach(key);
    const hitbox = key.userData.hitbox;
    if (!hitbox) return;
    group.attach(hitbox);
    boundHitboxes.push(hitbox);
  });
  group.userData.boundHitboxes = boundHitboxes;
  group.userData.pianoTriangles = split.bodyTriangles + keys.reduce((sum, key) => {
    const index = key.geometry?.getIndex();
    if (index) return sum + index.count / 3;
    const position = key.geometry?.getAttribute("position");
    return sum + (position ? position.count / 3 : 0);
  }, 0);

  return { group, keys: new Set(keys), bodyTriangles: split.bodyTriangles };
}
