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
  ["public/models/Dark Room/Dark_First.glb", "First_Baked", [-0.231, -0.16, 0.652], [Math.PI, 0, Math.PI]],
  ["public/models/Dark Room/Dark_Second.glb", "Second_Baked", [0.053, -0.02, 0.341], [Math.PI, 0, Math.PI]],
  ["public/models/Dark Room/Dark_Third.glb", "Third_Baked", [-0.819, 0.726, 1.115], [Math.PI / 2, 0, 0.47]],
  ["public/models/Dark Room/Dark_Fourth.glb", "Fourth_Baked", [-0.356, -0.02, 1.362], [Math.PI, 0, Math.PI]],
  ["public/models/Light Room/Light_First.glb", "Light_First_Baked", [23.66, 1.452, -1.692], [-Math.PI / 2, 0, 0]],
  ["public/models/Light Room/Light_Second.glb", "Light_Second_Baked", [26.719, 1.498, 1.614], [0, 0, -Math.PI / 2]],
  ["public/models/Light Room/Light_Third.glb", "Light_Third_Baked", [24.79, -0.201, 0.173], [0, 0, 0]],
];

const draco = await decoderPromise;
const center = new THREE.Vector3();

for (const [file, nodeName, position, rotation] of jobs) {
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((item) => item.name === nodeName);
  const primitive = json.meshes[node.mesh].primitives[0];
  const decoded = decodePrimitive(draco, json, bin, primitive);
  const islands = componentsOf(decoded.index, decoded.position);
  const matrix = compose(position, rotation);
  const bins = new Map();

  for (const island of islands) {
    const box = worldBox(island.min, island.max, matrix);
    const size = box.getSize(corner);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 1.2 || island.tris < 40) continue;
    box.getCenter(center);
    const key = [center.x, center.y, center.z].map((value) => (Math.round(value / 0.35) * 0.35).toFixed(2)).join(",");
    const bin = bins.get(key) || { tris: 0, islands: 0, maxDim: 0 };
    bin.tris += island.tris;
    bin.islands += 1;
    bin.maxDim = Math.max(bin.maxDim, maxDim);
    bins.set(key, bin);
  }

  const rows = [...bins.entries()].sort((a, b) => b[1].tris - a[1].tris).slice(0, 18);
  console.log(`\n${nodeName} islands=${islands.length} compactBins=${bins.size}`);
  for (const [key, bin] of rows) {
    console.log(
      `  ${key}  tris=${String(bin.tris).padStart(6)} islands=${String(bin.islands).padStart(4)} max=${bin.maxDim.toFixed(2)}`,
    );
  }
}
