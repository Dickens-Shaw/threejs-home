import * as THREE from "three";
import {
  composeMatrix,
  geometryBounds,
  geometryWithIndex,
  screenVolume,
  splitMeshByVolume,
} from "../src/Experience/parts/splitGeometry.js";
import {
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";

function geometryFrom(decoded) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(decoded.position, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(decoded.index, 1));
  return geometry;
}

const draco = await decoderPromise;
const cache = new Map();

async function load(file, nodeName) {
  const key = `${file}:${nodeName}`;
  if (cache.has(key)) return cache.get(key);
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((item) => item.name === nodeName);
  const decoded = decodePrimitive(
    draco,
    json,
    bin,
    json.meshes[node.mesh].primitives[0],
  );
  const geometry = geometryFrom(decoded);
  cache.set(key, geometry);
  return geometry;
}

function sizeOf(geometry, position, rotation) {
  const box = geometryBounds(geometry, composeMatrix(position, rotation));
  const size = box.getSize(new THREE.Vector3());
  return size.toArray().map((value) => value.toFixed(3)).join(" x ");
}

function tightVolume(geometry, matrix, pad) {
  const box = geometryBounds(geometry, matrix);
  box.min.addScalar(-pad);
  box.max.addScalar(pad);
  return box;
}

const seeds = [
  {
    name: "dark-mac",
    file: "public/models/Dark Room/Dark_First.glb",
    node: "Mac_Screen",
    position: [-0.861, 0.795, 0.684],
    rotation: [0, 0.523, 0],
  },
  {
    name: "dark-computer",
    file: "public/models/Dark Room/Dark_First.glb",
    node: "Computer_Screen",
    position: [-0.302, 0.935, 0.647],
    rotation: [0, -0.053, 0],
  },
  {
    name: "light-iphone",
    file: "public/models/Light Room/Light_First.glb",
    node: "iPhone_Screen",
    position: [23.994, 0.734, -1.338],
    rotation: [0, -1.193, Math.PI / 2],
  },
  {
    name: "dark-chair",
    file: "public/models/Dark Room/Dark_Fourth.glb",
    node: "Chair_Top_Fourth_Baked",
    position: [-0.373, 0.715, 1.304],
    rotation: [Math.PI, -0.121, Math.PI],
  },
];

const hosts = [
  ["public/models/Dark Room/Dark_First.glb", "First_Baked", [-0.231, -0.16, 0.652], [Math.PI, 0, Math.PI]],
  ["public/models/Dark Room/Dark_Second.glb", "Second_Baked", [0.053, -0.02, 0.341], [Math.PI, 0, Math.PI]],
  ["public/models/Dark Room/Dark_Third.glb", "Third_Baked", [-0.819, 0.726, 1.115], [Math.PI / 2, 0, 0.47]],
  ["public/models/Dark Room/Dark_Fourth.glb", "Fourth_Baked", [-0.356, -0.02, 1.362], [Math.PI, 0, Math.PI]],
  ["public/models/Light Room/Light_First.glb", "Light_First_Baked", [23.66, 1.452, -1.692], [-Math.PI / 2, 0, 0]],
  ["public/models/Light Room/Light_Second.glb", "Light_Second_Baked", [26.719, 1.498, 1.614], [0, 0, -Math.PI / 2]],
  ["public/models/Light Room/Light_Third.glb", "Light_Third_Baked", [24.79, -0.201, 0.173], [0, 0, 0]],
];

for (const seed of seeds) {
  const geometry = await load(seed.file, seed.node);
  console.log(
    `\n${seed.name} own size ${sizeOf(geometry, seed.position, seed.rotation)}`,
  );
  const matrix = composeMatrix(seed.position, seed.rotation);
  const volumes = [
    ["screen", screenVolume(geometry, matrix)],
    ["tight", tightVolume(geometry, matrix, 0.06)],
  ];
  for (const [file, node, position, rotation] of hosts) {
    const baked = await load(file, node);
    const bakedMatrix = composeMatrix(position, rotation);
    for (const [label, volume] of volumes) {
      const split = splitMeshByVolume(baked, bakedMatrix, volume, 0.75);
      if (!split?.monitorTriangles) continue;
      const piece = geometryWithIndex(baked, split.monitor);
      const box = piece.boundingBox.clone().applyMatrix4(bakedMatrix);
      const size = box.getSize(new THREE.Vector3());
      console.log(
        `  ${label} ${node} tris=${split.monitorTriangles} size=${size
          .toArray()
          .map((value) => value.toFixed(3))
          .join(" x ")}`,
      );
    }
  }
}
