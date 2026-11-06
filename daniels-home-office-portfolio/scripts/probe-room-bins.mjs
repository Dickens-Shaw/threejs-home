import * as THREE from "three";
import {
  componentsOf,
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";

const corner = new THREE.Vector3();

function compose(position, rotation, scale = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(scale, scale, scale),
  );
}

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

const jobs = [
  ["D1", "public/models/Dark Room/Dark_First.glb", "First_Baked", [-0.231, -0.16, 0.652], [Math.PI, 0, Math.PI], [-2, 2.2, -2, 2.2]],
  ["D2", "public/models/Dark Room/Dark_Second.glb", "Second_Baked", [0.053, -0.02, 0.341], [Math.PI, 0, Math.PI], [-2, 2.2, -2, 2.2]],
  ["D3", "public/models/Dark Room/Dark_Third.glb", "Third_Baked", [-0.819, 0.726, 1.115], [Math.PI / 2, 0, 0.47], [-2, 2.2, -2, 2.2]],
  ["D4", "public/models/Dark Room/Dark_Fourth.glb", "Fourth_Baked", [-0.356, -0.02, 1.362], [Math.PI, 0, Math.PI], [-2, 2.2, -2, 2.2]],
  ["L1", "public/models/Light Room/Light_First.glb", "Light_First_Baked", [23.66, 1.452, -1.692], [-Math.PI / 2, 0, 0], [22.4, 27.4, -2.4, 2.2]],
  ["L2", "public/models/Light Room/Light_Second.glb", "Light_Second_Baked", [26.719, 1.498, 1.614], [0, 0, -Math.PI / 2], [22.4, 27.4, -2.4, 2.2]],
  ["L3", "public/models/Light Room/Light_Third.glb", "Light_Third_Baked", [24.79, -0.201, 0.173], [0, 0, 0], [22.4, 27.4, -2.4, 2.2]],
];

const draco = await decoderPromise;
const center = new THREE.Vector3();
const room = process.argv[2] || "D";

for (const [id, file, nodeName, position, rotation, span] of jobs) {
  if (!id.startsWith(room)) continue;
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((item) => item.name === nodeName);
  const decoded = decodePrimitive(draco, json, bin, json.meshes[node.mesh].primitives[0]);
  const islands = componentsOf(decoded.index, decoded.position);
  const matrix = compose(position, rotation);
  const bins = new Map();
  for (const island of islands) {
    if (island.tris < 12) continue;
    const box = worldBox(island.min, island.max, matrix);
    const size = box.getSize(corner);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 1.6) continue;
    box.getCenter(center);
    if (center.x < span[0] || center.x > span[1] || center.z < span[2] || center.z > span[3]) continue;
    const key = [
      (Math.round(center.x / 0.4) * 0.4).toFixed(1),
      (Math.round(center.y / 0.25) * 0.25).toFixed(2),
      (Math.round(center.z / 0.4) * 0.4).toFixed(1),
    ].join(" ");
    const entry = bins.get(key) || { tris: 0, n: 0, maxDim: 0 };
    entry.tris += island.tris;
    entry.n += 1;
    entry.maxDim = Math.max(entry.maxDim, maxDim);
    bins.set(key, entry);
  }
  console.log(`\n${id} ${nodeName}`);
  for (const [key, entry] of [...bins.entries()].sort((a, b) => b[1].tris - a[1].tris).slice(0, 40)) {
    if (entry.tris < 80) continue;
    console.log(`  ${key}  t=${String(entry.tris).padStart(6)} n=${String(entry.n).padStart(3)} m=${entry.maxDim.toFixed(2)}`);
  }
}
