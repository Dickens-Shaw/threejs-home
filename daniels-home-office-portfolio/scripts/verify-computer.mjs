import * as THREE from "three";
import {
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";
import { buildLightComputer } from "../src/Experience/parts/lightComputer.js";
import {
  SECOND_POSITION,
  SECOND_ROTATION,
  DESKTOP_POSITION,
  DESKTOP_ROTATION,
} from "../src/Experience/parts/lightComputer.js";
import { composeMatrix, geometryBounds } from "../src/Experience/parts/splitGeometry.js";

function geometryFromDecoded(decoded) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(decoded.position, 3)
  );
  geometry.setIndex(new THREE.BufferAttribute(decoded.index, 1));
  return geometry;
}

const draco = await decoderPromise;

function loadMesh(file, name) {
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((entry) => entry.name === name);
  const primitive = json.meshes[node.mesh].primitives[0];
  return geometryFromDecoded(decodePrimitive(draco, json, bin, primitive));
}

const baked = loadMesh(
  "public/models/Light Room/Light_Second.glb",
  "Light_Second_Baked"
);
const screen = loadMesh(
  "public/models/Light Room/Light_First.glb",
  "Desktop_Screen"
);
const pieces = buildLightComputer(baked, screen);
const monitorBox = pieces.monitor.boundingBox
  .clone()
  .applyMatrix4(composeMatrix(SECOND_POSITION, SECOND_ROTATION));
const screenBox = geometryBounds(
  screen,
  composeMatrix(DESKTOP_POSITION, DESKTOP_ROTATION)
);
const computerBox = monitorBox.clone().union(screenBox);
const size = computerBox.getSize(new THREE.Vector3());

console.log(
  JSON.stringify(
    {
      monitorTriangles: pieces.monitorTriangles,
      restTriangles: pieces.rest.getIndex().count / 3,
      sourceTriangles: baked.getIndex().count / 3,
      computerSize: size.toArray().map((value) => Number(value.toFixed(3))),
      computerCenter: computerBox
        .getCenter(new THREE.Vector3())
        .toArray()
        .map((value) => Number(value.toFixed(3))),
      screenInside:
        monitorBox.intersectsBox(screenBox) || computerBox.containsBox(screenBox),
    },
    null,
    2
  )
);
