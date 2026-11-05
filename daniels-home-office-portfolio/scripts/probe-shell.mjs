import * as THREE from "three";
import {
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";
import {
  composeMatrix,
  screenVolume,
  splitMeshByVolume,
} from "../src/Experience/parts/splitGeometry.js";

function geometryFromDecoded(decoded) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(decoded.position, 3)
  );
  geometry.setIndex(new THREE.BufferAttribute(decoded.index, 1));
  return geometry;
}

const jobs = [
  {
    screenFile: "public/models/Dark Room/Dark_First.glb",
    screen: "Computer_Screen",
    screenPosition: [-0.302, 0.935, 0.647],
    screenRotation: [0, -0.053, 0],
    bakedFile: "public/models/Dark Room/Dark_Third.glb",
    baked: "Third_Baked",
    bakedPosition: [-0.819, 0.726, 1.115],
    bakedRotation: [Math.PI / 2, 0, 0.47],
  },
  {
    screenFile: "public/models/Dark Room/Dark_First.glb",
    screen: "Computer_Screen",
    screenPosition: [-0.302, 0.935, 0.647],
    screenRotation: [0, -0.053, 0],
    bakedFile: "public/models/Dark Room/Dark_Fourth.glb",
    baked: "Fourth_Baked",
    bakedPosition: [-0.356, -0.02, 1.362],
    bakedRotation: [Math.PI, 0, Math.PI],
  },
  {
    screenFile: "public/models/Dark Room/Dark_First.glb",
    screen: "Mac_Screen",
    screenPosition: [-0.861, 0.795, 0.684],
    screenRotation: [0, 0.523, 0],
    bakedFile: "public/models/Dark Room/Dark_Fourth.glb",
    baked: "Fourth_Baked",
    bakedPosition: [-0.356, -0.02, 1.362],
    bakedRotation: [Math.PI, 0, Math.PI],
  },
  {
    screenFile: "public/models/Dark Room/Dark_First.glb",
    screen: "Mac_Screen",
    screenPosition: [-0.861, 0.795, 0.684],
    screenRotation: [0, 0.523, 0],
    bakedFile: "public/models/Dark Room/Dark_Third.glb",
    baked: "Third_Baked",
    bakedPosition: [-0.819, 0.726, 1.115],
    bakedRotation: [Math.PI / 2, 0, 0.47],
  },
];

const draco = await decoderPromise;
const geometries = new Map();

function load(file, name) {
  const key = `${file}:${name}`;
  if (geometries.has(key)) return geometries.get(key);
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((entry) => entry.name === name);
  const primitive = json.meshes[node.mesh].primitives[0];
  const geometry = geometryFromDecoded(decodePrimitive(draco, json, bin, primitive));
  geometries.set(key, geometry);
  return geometry;
}

for (const job of jobs) {
  const screen = load(job.screenFile, job.screen);
  const baked = load(job.bakedFile, job.baked);
  const screenMatrix = composeMatrix(job.screenPosition, job.screenRotation);
  const bakedMatrix = composeMatrix(job.bakedPosition, job.bakedRotation);
  const volume = screenVolume(screen, screenMatrix);
  const split = splitMeshByVolume(baked, bakedMatrix, volume, 0.75);
  const shell = new THREE.BufferGeometry();
  shell.setAttribute("position", baked.getAttribute("position"));
  shell.setIndex(new THREE.BufferAttribute(split.monitor, 1));
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const index = shell.getIndex();
  const position = shell.getAttribute("position");
  for (let i = 0; i < index.count; i++) {
    box.expandByPoint(
      point.fromBufferAttribute(position, index.getX(i)).applyMatrix4(bakedMatrix)
    );
  }
  const size = box.getSize(new THREE.Vector3());
  console.log(
    `${job.screen} + ${job.baked}: tris=${split.monitorTriangles} size=${size
      .toArray()
      .map((value) => value.toFixed(2))
      .join(",")}`
  );
}
