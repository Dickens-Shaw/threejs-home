import * as THREE from "three";
import {
  componentsOf,
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";

const corner = new THREE.Vector3();
const center = new THREE.Vector3();

function compose(position, rotation, scale = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(scale, scale, scale),
  );
}

function worldOf(min, max, matrix) {
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

const hosts = [
  ["D1", "public/models/Dark Room/Dark_First.glb", "First_Baked", [-0.231, -0.16, 0.652], [Math.PI, 0, Math.PI]],
  ["D2", "public/models/Dark Room/Dark_Second.glb", "Second_Baked", [0.053, -0.02, 0.341], [Math.PI, 0, Math.PI]],
  ["D3", "public/models/Dark Room/Dark_Third.glb", "Third_Baked", [-0.819, 0.726, 1.115], [Math.PI / 2, 0, 0.47]],
  ["D4", "public/models/Dark Room/Dark_Fourth.glb", "Fourth_Baked", [-0.356, -0.02, 1.362], [Math.PI, 0, Math.PI]],
  ["L1", "public/models/Light Room/Light_First.glb", "Light_First_Baked", [23.66, 1.452, -1.692], [-Math.PI / 2, 0, 0]],
  ["L2", "public/models/Light Room/Light_Second.glb", "Light_Second_Baked", [26.719, 1.498, 1.614], [0, 0, -Math.PI / 2]],
  ["L3", "public/models/Light Room/Light_Third.glb", "Light_Third_Baked", [24.79, -0.201, 0.173], [0, 0, 0]],
];

const volumes = [
  ["d-clock", [-1.85, -1.15, 1.45, 2.15, -1.9, -0.9], 0.45],
  ["d-pictures", [-1.9, -1.2, 0.85, 1.55, -1.7, -0.9], 0.4],
  ["d-lamp", [-1.95, -1.2, 0.0, 1.5, -1.6, -0.7], 0.55],
  ["d-sofa", [-1.7, -0.4, 0.15, 0.7, -0.2, 1.2], 1.4],
  ["d-monitor-stand", [-0.5, -0.1, 0.68, 0.92, 0.45, 0.85], 0.35],
  ["d-desk", [-1.15, 0.55, 0.68, 0.82, 0.15, 1.15], 1.5],
  ["d-shelf-top", [1.45, 2.15, 1.85, 2.2, -1.5, 1.8], 0.4],
  ["d-shelf-mid", [1.45, 2.15, 0.9, 1.7, -1.5, 1.8], 0.45],
  ["d-cabinets", [1.4, 2.2, 0.05, 0.55, -0.4, 1.9], 1.2],
];

const draco = await decoderPromise;
const islands = [];

for (const [id, file, nodeName, position, rotation] of hosts) {
  if (!id.startsWith(process.argv[2] || "D")) continue;
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((item) => item.name === nodeName);
  const decoded = decodePrimitive(draco, json, bin, json.meshes[node.mesh].primitives[0]);
  const parts = componentsOf(decoded.index, decoded.position);
  const matrix = compose(position, rotation);
  for (const island of parts) {
    if (island.tris < 8) continue;
    const box = worldOf(island.min, island.max, matrix);
    const size = box.getSize(corner);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 2.2) continue;
    box.getCenter(center);
    islands.push({
      id,
      tris: island.tris,
      maxDim,
      c: center.toArray(),
      box: box.clone(),
    });
  }
  console.log(id, "islands", islands.length);
}

if (process.argv[3] === "cluster") {
  const gap = Number(process.argv[4] || 0.012);
  const cap = Number(process.argv[5] || 0.55);
  const cell = 0.15;
  const grid = new Map();
  const usable = islands.filter((island) => island.maxDim <= 0.4 && island.tris >= 12);
  usable.forEach((island, index) => {
    island.index = index;
    const key = [Math.floor(island.c[0] / cell), Math.floor(island.c[1] / cell), Math.floor(island.c[2] / cell)].join(",");
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(index);
  });
  const parent = usable.map((_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  const near = (box, other) =>
    box.max.x + gap >= other.min.x && other.max.x + gap >= box.min.x
    && box.max.y + gap >= other.min.y && other.max.y + gap >= box.min.y
    && box.max.z + gap >= other.min.z && other.max.z + gap >= box.min.z;
  for (const island of usable) {
    const [ix, iy, iz] = island.c.map((value) => Math.floor(value / cell));
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const list = grid.get([ix + dx, iy + dy, iz + dz].join(","));
          if (!list) continue;
          for (const otherIndex of list) {
            if (otherIndex <= island.index) continue;
            if (near(island.box, usable[otherIndex].box)) unite(island.index, otherIndex);
          }
        }
      }
    }
  }
  const groups = new Map();
  for (let index = 0; index < usable.length; index += 1) {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(usable[index]);
  }
  const clusters = [];
  for (const group of groups.values()) {
    const box = new THREE.Box3();
    let tris = 0;
    for (const island of group) {
      box.union(island.box);
      tris += island.tris;
    }
    const size = box.getSize(corner);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > cap || tris < 80 || group.length < 2) continue;
    box.getCenter(center);
    clusters.push({ tris, n: group.length, size: size.toArray(), c: center.toArray() });
  }
  clusters.sort((a, b) => b.tris - a.tris);
  console.log("clusters", clusters.length);
  for (const cluster of clusters.slice(0, 80)) {
    console.log(
      cluster.c.map((n) => n.toFixed(2)).join(" "),
      cluster.size.map((n) => n.toFixed(2)).join("x"),
      "t=" + cluster.tris,
      "n=" + cluster.n,
    );
  }
}

if (process.argv[3] === "slice") {
  const [x0, x1, y0, y1, z0, z1] = process.argv[4].split(",").map(Number);
  const bins = new Map();
  for (const island of islands) {
    const [x, y, z] = island.c;
    if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1 || island.maxDim > 0.45) continue;
    const key = [(Math.round(z / 0.12) * 0.12).toFixed(2), (Math.round(y / 0.12) * 0.12).toFixed(2)].join(" ");
    const entry = bins.get(key) || { tris: 0, n: 0 };
    entry.tris += island.tris;
    entry.n += 1;
    bins.set(key, entry);
  }
  for (const [key, entry] of [...bins.entries()].sort()) {
    if (entry.tris < 40) continue;
    console.log(`  z,y ${key} t=${entry.tris} n=${entry.n}`);
  }
}

for (const [name, [x0, x1, y0, y1, z0, z1], maxSize] of volumes) {
  const chosen = islands.filter((island) => {
    const [x, y, z] = island.c;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1 && island.maxDim <= maxSize;
  });
  const box = new THREE.Box3();
  let tris = 0;
  const by = {};
  for (const island of chosen) {
    box.union(island.box);
    tris += island.tris;
    by[island.id] = (by[island.id] || 0) + island.tris;
  }
  const size = box.isEmpty() ? null : box.getSize(corner).toArray().map((n) => n.toFixed(2)).join("x");
  console.log(`${name} tris=${tris} n=${chosen.length} size=${size || "-"} ${JSON.stringify(by)}`);
}
