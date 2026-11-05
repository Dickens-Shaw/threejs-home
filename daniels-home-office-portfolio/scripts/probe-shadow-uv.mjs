import * as THREE from "three";
import {
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";
import { composeMatrix } from "../src/Experience/parts/splitGeometry.js";

const rects = {
  "public/models/Light Room/Light_First.glb": {
    node: "Light_First_Baked",
    position: [23.66, 1.452, -1.692],
    rotation: [-Math.PI / 2, 0, 0],
    boxes: [
      [0.3618, 0.8047, 0.3828, 0.8325],
      [0.2549, 0.8003, 0.2661, 0.8223],
      [0.2163, 0.7964, 0.2319, 0.812],
      [0.4424, 0.8423, 0.4521, 0.8521],
      [0.2764, 0.7974, 0.3389, 0.8237],
      [0.1953, 0.8257, 0.2261, 0.8677],
    ],
  },
  "public/models/Light Room/Light_Second.glb": {
    node: "Light_Second_Baked",
    position: [26.719, 1.498, 1.614],
    rotation: [0, 0, -Math.PI / 2],
    boxes: [
      [0.1641, 0.6655, 0.1792, 0.6748],
      [0.1646, 0.6479, 0.1851, 0.6626],
      [0.1899, 0.6499, 0.2002, 0.666],
    ],
  },
};

function inside(u, v, box, pad = 0.004) {
  return u >= box[0] - pad && u <= box[2] + pad && v >= box[1] - pad && v <= box[3] + pad;
}

const draco = await decoderPromise;
const point = new THREE.Vector3();

for (const [file, spec] of Object.entries(rects)) {
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((entry) => entry.name === spec.node);
  const primitive = json.meshes[node.mesh].primitives[0];
  const decoded = decodePrimitive(draco, json, bin, primitive, ["TEXCOORD_0"]);
  const matrix = composeMatrix(spec.position, spec.rotation);
  const uv = decoded.attributes.TEXCOORD_0.array;
  const position = decoded.position;
  const index = decoded.index;

  const rows = [];
  for (let triangle = 0; triangle < index.length; triangle += 3) {
    const ids = [index[triangle], index[triangle + 1], index[triangle + 2]];
    const verts = ids.map((id) =>
      point
        .set(position[id * 3], position[id * 3 + 1], position[id * 3 + 2])
        .applyMatrix4(matrix)
        .clone()
    );
    const centroid = verts[0].clone().add(verts[1]).add(verts[2]).multiplyScalar(1 / 3);
    if (centroid.y < 0.7 || centroid.y > 0.78) continue;
    if (centroid.x < 24.15 || centroid.x > 24.7) continue;
    if (centroid.z < -1.8 || centroid.z > -1.35) continue;
    const min = verts.reduce((a, v) => a.min(v), verts[0].clone());
    const max = verts.reduce((a, v) => a.max(v), verts[0].clone());
    const u = ids.reduce((sum, id) => sum + uv[id * 2], 0) / 3;
    const v = ids.reduce((sum, id) => sum + uv[id * 2 + 1], 0) / 3;
    rows.push({
      center: centroid.toArray().map((n) => Number(n.toFixed(3))),
      size: max
        .sub(min)
        .toArray()
        .map((n) => Number(n.toFixed(3))),
      uv: [Number(u.toFixed(4)), Number(v.toFixed(4))],
    });
  }
  rows.sort((a, b) => a.center[0] - b.center[0]);
  console.log(`\n${spec.node} candidates ${rows.length}`);
  for (const row of rows.slice(0, 25)) console.log(JSON.stringify(row));

  spec.boxes.forEach((box, boxIndex) => {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    let triangles = 0;
    for (let triangle = 0; triangle < index.length; triangle += 3) {
      const ids = [index[triangle], index[triangle + 1], index[triangle + 2]];
      const hits = ids.filter((id) => inside(uv[id * 2], uv[id * 2 + 1], box)).length;
      if (hits < 2) continue;
      triangles += 1;
      for (const id of ids) {
        point
          .set(position[id * 3], position[id * 3 + 1], position[id * 3 + 2])
          .applyMatrix4(matrix);
        min.min(point);
        max.max(point);
      }
    }
    const size = max.clone().sub(min);
    console.log(
      `${spec.node} #${boxIndex} tris=${triangles} size=${size
        .toArray()
        .map((value) => value.toFixed(3))
        .join(",")} min=${min
        .toArray()
        .map((value) => value.toFixed(3))
        .join(",")}`
    );
  });
}
