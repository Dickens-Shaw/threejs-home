import * as THREE from "three";
import { composeMatrix } from "../src/Experience/parts/splitGeometry.js";
import {
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";

const corner = new THREE.Vector3();

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

function islandsOf(index, position) {
  const triangleCount = index.length / 3;
  const parent = new Uint32Array(position.length / 3);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;
  const find = (vertex) => {
    let root = vertex;
    while (parent[root] !== root) root = parent[root];
    let cursor = vertex;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const a = find(index[offset]);
    const b = find(index[offset + 1]);
    if (a !== b) parent[b] = a;
    const root = find(index[offset]);
    const c = find(index[offset + 2]);
    if (root !== c) parent[c] = root;
  }
  const islands = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const root = find(index[offset]);
    let island = islands.get(root);
    if (!island) {
      island = {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
        tris: 0,
      };
      islands.set(root, island);
    }
    island.tris += 1;
    for (let k = 0; k < 3; k += 1) {
      const vertex = index[offset + k] * 3;
      const x = position[vertex];
      const y = position[vertex + 1];
      const z = position[vertex + 2];
      if (x < island.min[0]) island.min[0] = x;
      if (y < island.min[1]) island.min[1] = y;
      if (z < island.min[2]) island.min[2] = z;
      if (x > island.max[0]) island.max[0] = x;
      if (y > island.max[1]) island.max[1] = y;
      if (z > island.max[2]) island.max[2] = z;
    }
  }
  return islands;
}

const hosts = [
  ["D1", "public/models/Dark Room/Dark_First.glb", "First_Baked", [-0.231, -0.16, 0.652], [Math.PI, 0, Math.PI]],
  ["D3", "public/models/Dark Room/Dark_Third.glb", "Third_Baked", [-0.819, 0.726, 1.115], [Math.PI / 2, 0, 0.47]],
  ["D4", "public/models/Dark Room/Dark_Fourth.glb", "Fourth_Baked", [-0.356, -0.02, 1.362], [Math.PI, 0, Math.PI]],
];

const draco = await decoderPromise;
const rows = [];
for (const [id, file, nodeName, position, rotation] of hosts) {
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((item) => item.name === nodeName);
  const decoded = decodePrimitive(draco, json, bin, json.meshes[node.mesh].primitives[0]);
  const matrix = composeMatrix(position, rotation);
  for (const island of islandsOf(decoded.index, decoded.position).values()) {
    if (island.tris < 40) continue;
    const box = worldBox(island.min, island.max, matrix);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim < 0.45 || maxDim > 3.2) continue;
    if (center.x < -2.2 || center.x > 2.4 || center.z < -2.2 || center.z > 2.2) continue;
    rows.push({ id, tris: island.tris, center, size, maxDim });
  }
}
rows.sort((a, b) => b.tris - a.tris);
for (const row of rows.slice(0, 60)) {
  console.log(
    row.id,
    row.center.toArray().map((value) => value.toFixed(2)).join(" "),
    row.size.toArray().map((value) => value.toFixed(2)).join("x"),
    "t=" + row.tris,
  );
}
console.log("count", rows.length);
