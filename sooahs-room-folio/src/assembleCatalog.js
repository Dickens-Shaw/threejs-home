import * as THREE from "three";

const corner = new THREE.Vector3();
const islandBox = new THREE.Box3();
const islandSize = new THREE.Vector3();

// Volumes are world-space boxes measured from the assembled room.
// An island joins an object only when its center sits in that box and its own
// longest edge stays under the cap. Walls, floor planks, the roof and the
// water ring are larger than these caps, so they stay in the shell.
const SPECS = [
  {
    name: "Clock_First",
    shell: "First",
    box: [-3.45, -3.05, 5.95, 6.85, -1.2, -0.3],
    maxEdge: 0.9,
    limit: [0.4, 0.9, 0.9],
    members: (name) => name.includes("Hour_Hand") || name.includes("Minute_Hand"),
  },
  {
    name: "Pegboard_First",
    shell: "First",
    box: [-3.45, -2.65, 3.85, 6.4, -0.2, 1.9],
    maxEdge: 2.5,
    limit: [1.0, 2.5, 2.1],
  },
  {
    name: "Window_First",
    shell: "First",
    box: [-0.4, 2.5, 3.12, 6.7, -4.95, -3.9],
    maxEdge: 2.6,
    limit: [2.85, 3.65, 1.35],
  },
  {
    name: "Shelf_First",
    shell: "First",
    box: [-3.35, -0.55, 5.35, 6.4, -4.55, -3.6],
    maxEdge: 2.7,
    limit: [2.9, 1.15, 1.1],
  },
  {
    name: "String_Lights_Fourth",
    shell: "First",
    wire: true,
    limit: [4.2, 1.0, 4.2],
    members: (name) => name.includes("Bulb_"),
  },
  {
    name: "Keyboard_Fourth",
    shell: "Fourth",
    box: [-2.2, -1.35, 3.05, 3.35, -2.2, -0.95],
    maxEdge: 1.2,
    limit: [1.0, 0.25, 1.4],
    members: (name) => /Keyboard_\d+/.test(name),
  },
  {
    name: "Monitor_Fourth",
    shell: "Fourth",
    box: [-3.15, -2.55, 3.55, 5.3, -2.75, -0.25],
    maxEdge: 2.2,
    stand: true,
    limit: [1.05, 2.5, 3.6],
    members: (name) => name === "Screen",
  },
  {
    name: "Computer_Fourth",
    shell: "Fourth",
    box: [-3.25, -1.35, 3.15, 4.65, -4.1, -3.0],
    maxEdge: 1.55,
    panel: true,
    base: true,
    limit: [2.3, 1.9, 1.55],
    members: (name) => name.startsWith("Computer_"),
  },
  {
    name: "Chair_Fourth",
    shell: "Fourth",
    box: [-1.75, 0.15, 0.45, 1.9, -2.75, -0.9],
    maxEdge: 0.9,
    limit: [1.8, 1.5, 1.8],
    members: (name) => name.includes("Chair_Top"),
  },
  {
    name: "Cabinet_Fourth",
    shell: "Fourth",
    box: [-3.25, -1.6, 0.45, 2.42, 0.35, 1.95],
    maxEdge: 1.8,
    limit: [1.7, 2.15, 1.7],
  },
  {
    name: "Stool_Fourth",
    shell: "Fourth",
    box: [-1.45, 0.05, 0.45, 1.35, 0.35, 1.85],
    maxEdge: 1.15,
    limit: [1.6, 1.0, 1.6],
  },
  {
    name: "Desk_Fourth",
    shell: "Fourth",
    box: [-3.35, -1.05, 2.95, 3.6, -3.45, 0.35],
    maxEdge: 2.9,
    flat: 0.35,
    rear: true,
    legBox: [-3.4, -1.5, 0.9, 3.75, -3.7, 0.75],
    limit: [2.4, 2.75, 4.85],
  },
  {
    name: "Name_Sign_Third",
    shell: "Third",
    box: [-0.3, 0.42, 3.3, 3.95, -4.55, -4.05],
    maxEdge: 0.6,
    limit: [0.8, 0.7, 0.5],
    members: (name) => name.includes("Name_Letter") || name.includes("Name_Platform"),
  },
  {
    name: "Rug_Third",
    shell: "Third",
    rug: true,
    limit: [2.2, 0.15, 3.0],
  },
  {
    name: "Fish_Bowl",
    members: (name) => name.startsWith("Fish_Bowl") || name.includes("Fish_Fourth"),
  },
];

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

function centerInside(box, bounds) {
  const x = (bounds.min.x + bounds.max.x) * 0.5;
  const y = (bounds.min.y + bounds.max.y) * 0.5;
  const z = (bounds.min.z + bounds.max.z) * 0.5;
  return x >= box[0] && x <= box[1] && y >= box[2] && y <= box[3] && z >= box[4] && z <= box[5];
}

function matches(spec, bounds, size) {
  const edge = Math.max(size.x, size.y, size.z);
  const minEdge = Math.min(size.x, size.y, size.z);
  if (spec.rug) {
    const x = (bounds.min.x + bounds.max.x) * 0.5;
    const y = (bounds.min.y + bounds.max.y) * 0.5;
    const z = (bounds.min.z + bounds.max.z) * 0.5;
    return y >= 0.52 && y <= 0.7 && x >= 0.55 && x <= 2.35 && z >= -1.45 && z <= 1.45 && size.y <= 0.12 && edge <= 2.65;
  }
  if (spec.wire) {
    const y = (bounds.min.y + bounds.max.y) * 0.5;
    const x = (bounds.min.x + bounds.max.x) * 0.5;
    const z = (bounds.min.z + bounds.max.z) * 0.5;
    const alongWall = y >= 5.1 && y <= 5.95 && x <= -2.15 && z <= 0.6;
    const strand = minEdge <= 0.05 && edge >= 0.12 && edge <= 3.2;
    const note = edge <= 0.22 && minEdge >= 0.015 && edge >= 0.05;
    return alongWall && (strand || note);
  }
  if (spec.panel && minEdge <= 0.22 && edge >= 0.12 && edge <= 2.1) {
    const x = (bounds.min.x + bounds.max.x) * 0.5;
    const y = (bounds.min.y + bounds.max.y) * 0.5;
    const z = (bounds.min.z + bounds.max.z) * 0.5;
    const inCase = x >= -3.35 && x <= -1.2 && y >= 3.05 && y <= 4.85 && z >= -4.2 && z <= -3.05;
    const deskSheet = size.y <= 0.06 && y < 3.45 && z > -3.75;
    if (inCase && !deskSheet) return true;
  }
  if (spec.base && edge <= 0.4 && edge >= 0.08) {
    const x = (bounds.min.x + bounds.max.x) * 0.5;
    const y = (bounds.min.y + bounds.max.y) * 0.5;
    const z = (bounds.min.z + bounds.max.z) * 0.5;
    if (x >= -3.15 && x <= -1.4 && y >= 3.3 && y <= 3.85 && z >= -3.05 && z <= -2.45) return true;
  }
  if (spec.stand && size.x <= 0.5 && size.y >= 0.9 && size.y <= 1.4 && size.z >= 1.4 && size.z <= 2.1) {
    const x = (bounds.min.x + bounds.max.x) * 0.5;
    const y = (bounds.min.y + bounds.max.y) * 0.5;
    const z = (bounds.min.z + bounds.max.z) * 0.5;
    if (x >= -3.4 && x <= -2.7 && y >= 3.15 && y <= 3.95 && z >= -3.3 && z <= -2.3) return true;
  }
  if (spec.box && edge <= spec.maxEdge && (!spec.thinX || size.x <= spec.thinX)) {
    if ((!spec.flat || size.y <= spec.flat) && centerInside(spec.box, bounds)) return true;
  }
  if (spec.rear && size.y <= 0.08 && edge >= 0.3 && edge <= 2.2) {
    const x = (bounds.min.x + bounds.max.x) * 0.5;
    const y = (bounds.min.y + bounds.max.y) * 0.5;
    const z = (bounds.min.z + bounds.max.z) * 0.5;
    if (x >= -3.4 && x <= -1.1 && y >= 3.1 && y <= 3.45 && z >= -4.05 && z <= -3.15) return true;
  }
  if (!spec.legBox) return false;
  const column = size.y >= 0.45 && size.y <= 2.3 && size.x <= 0.7 && size.z <= 0.8 && edge <= 2.4;
  const apron = size.y >= 0.35 && size.y <= 0.8 && size.x <= 0.45 && size.z <= 0.65;
  return (column || apron) && centerInside(spec.legBox, bounds);
}

function withinLimit(spec, size) {
  if (!spec.limit) return true;
  return size.x <= spec.limit[0] && size.y <= spec.limit[1] && size.z <= spec.limit[2];
}

function collectIslands(geometry, matrix) {
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
    union(source[triangle * 3], source[triangle * 3 + 1]);
    union(source[triangle * 3 + 1], source[triangle * 3 + 2]);
  }

  const islands = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = find(source[triangle * 3]);
    let island = islands.get(root);
    if (!island) {
      island = {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
        claim: null,
        triangles: 0,
      };
      islands.set(root, island);
    }
    island.triangles += 1;
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

  for (const island of islands.values()) {
    worldBoxFromLocal(island.min, island.max, matrix, islandBox);
    island.worldMin = islandBox.min.clone();
    island.worldMax = islandBox.max.clone();
    islandBox.getSize(islandSize);
    island.edge = Math.max(islandSize.x, islandSize.y, islandSize.z);
    island.size = islandSize.clone();
  }

  return { islands, find, source, triangleCount };
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
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  geometry.setIndex(new THREE.BufferAttribute(newIndex, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function unionWorld(islands) {
  const box = new THREE.Box3();
  islands.forEach((island) => {
    box.expandByPoint(island.worldMin);
    box.expandByPoint(island.worldMax);
  });
  return box;
}

function attachPart(group, object) {
  group.attach(object);
  if (object.userData.initialPosition) object.userData.initialPosition.copy(object.position);
  const hitbox = object.userData.hitbox;
  if (!hitbox) return;
  group.attach(hitbox);
  group.userData.boundHitboxes.push(hitbox);
}

export function assembleCatalog(root) {
  root.updateMatrixWorld(true);
  const shells = new Map();
  const loose = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (SPECS.some((spec) => spec.shell === child.name)) shells.set(child.name, child);
    else loose.push(child);
  });

  const claimedMembers = new Map(SPECS.map((spec) => [spec.name, []]));
  loose.forEach((mesh) => {
    const spec = SPECS.find((item) => item.members?.(mesh.name));
    if (spec) claimedMembers.get(spec.name).push(mesh);
  });

  const groups = [];
  const consumed = new Set();
  const report = [];

  const shellPlans = new Map();
  shells.forEach((shell, name) => {
    const collected = collectIslands(shell.geometry, shell.matrixWorld);
    if (!collected) return;
    const specs = SPECS.filter((spec) => spec.shell === name);
    for (const island of collected.islands.values()) {
      const spec = specs.find((item) => matches(item, new THREE.Box3(island.worldMin, island.worldMax), island.size));
      if (spec) island.claim = spec.name;
    }
    specs.forEach((spec) => {
      const chosen = [...collected.islands.values()].filter((island) => island.claim === spec.name);
      if (chosen.length === 0) return;
      const box = unionWorld(chosen);
      const size = box.getSize(new THREE.Vector3());
      if (withinLimit(spec, size)) return;
      chosen.forEach((island) => {
        island.claim = null;
      });
      report.push({
        name: spec.name,
        accepted: false,
        triangles: chosen.reduce((sum, island) => sum + island.triangles, 0),
        size: [size.x, size.y, size.z],
      });
    });
    shellPlans.set(name, collected);
  });

  shellPlans.forEach((collected, name) => {
    const shell = shells.get(name);
    const buckets = new Map();
    let restTriangles = 0;
    for (let triangle = 0; triangle < collected.triangleCount; triangle += 1) {
      const claim = collected.islands.get(collected.find(collected.source[triangle * 3])).claim;
      if (!claim) {
        restTriangles += 1;
        continue;
      }
      let bucket = buckets.get(claim);
      if (!bucket) {
        bucket = [];
        buckets.set(claim, bucket);
      }
      bucket.push(triangle);
    }

    const geometries = new Map();
    buckets.forEach((triangles, claim) => {
      const indexArray = new Uint32Array(triangles.length * 3);
      triangles.forEach((triangle, cursor) => {
        indexArray[cursor * 3] = collected.source[triangle * 3];
        indexArray[cursor * 3 + 1] = collected.source[triangle * 3 + 1];
        indexArray[cursor * 3 + 2] = collected.source[triangle * 3 + 2];
      });
      geometries.set(claim, { geometry: compactGeometry(shell.geometry, indexArray), triangles: triangles.length });
    });

    const rest = new Uint32Array(restTriangles * 3);
    let cursor = 0;
    for (let triangle = 0; triangle < collected.triangleCount; triangle += 1) {
      const claim = collected.islands.get(collected.find(collected.source[triangle * 3])).claim;
      if (claim) continue;
      rest[cursor] = collected.source[triangle * 3];
      rest[cursor + 1] = collected.source[triangle * 3 + 1];
      rest[cursor + 2] = collected.source[triangle * 3 + 2];
      cursor += 3;
    }
    const restGeometry = restTriangles > 0 ? compactGeometry(shell.geometry, rest) : new THREE.BufferGeometry();
    const extracted = [...geometries.values()].reduce((sum, item) => sum + item.triangles, 0);
    if (extracted + restTriangles !== collected.triangleCount) {
      geometries.forEach((item) => item.geometry.dispose());
      restGeometry.dispose();
      return;
    }
    shell.geometry.dispose();
    shell.geometry = restGeometry;
    shellPlans.get(name).geometries = geometries;
  });

  SPECS.forEach((spec) => {
    const members = claimedMembers.get(spec.name);
    const extracted = shellPlans.get(spec.shell)?.geometries?.get(spec.name);
    if (!extracted && members.length === 0) return;

    const group = new THREE.Group();
    group.name = spec.name;
    group.userData.boundHitboxes = [];
    const parent = members[0]?.parent || shells.get(spec.shell)?.parent || root;
    parent.add(group);

    if (extracted) {
      const shell = shells.get(spec.shell);
      const body = new THREE.Mesh(extracted.geometry, shell.material);
      body.name = `${spec.name}_Body`;
      body.userData.sourceShell = spec.shell;
      body.userData.extractedTriangles = extracted.triangles;
      body.position.copy(shell.position);
      body.quaternion.copy(shell.quaternion);
      body.scale.copy(shell.scale);
      group.attach(body);
    }

    members.forEach((mesh) => {
      attachPart(group, mesh);
      consumed.add(mesh);
    });
    groups.push(group);

    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    report.push({
      name: spec.name,
      accepted: true,
      triangles: extracted?.triangles || 0,
      members: members.length,
      size: [size.x, size.y, size.z],
    });
  });

  return { groups, consumed, report };
}
