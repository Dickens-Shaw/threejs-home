import * as THREE from "three";
import { composeMatrix } from "../src/Experience/parts/splitGeometry.js";
import { extractMesh } from "../src/Experience/parts/splitObjects.js";
import { buildLightComputer } from "../src/Experience/parts/lightComputer.js";
import { OBJECT_VOLUMES } from "../src/Experience/parts/objectVolumes.js";
import { labelClusters } from "../src/Experience/parts/objectLabels.js";
import {
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";

const hosts = {
  dark: [
    ["dark-first", "public/models/Dark Room/Dark_First.glb", "First_Baked", [-0.231, -0.16, 0.652], [Math.PI, 0, Math.PI]],
    ["dark-second", "public/models/Dark Room/Dark_Second.glb", "Second_Baked", [0.053, -0.02, 0.341], [Math.PI, 0, Math.PI]],
    ["dark-third", "public/models/Dark Room/Dark_Third.glb", "Third_Baked", [-0.819, 0.726, 1.115], [Math.PI / 2, 0, 0.47]],
    ["dark-fourth", "public/models/Dark Room/Dark_Fourth.glb", "Fourth_Baked", [-0.356, -0.02, 1.362], [Math.PI, 0, Math.PI]],
  ],
  light: [
    ["light-first", "public/models/Light Room/Light_First.glb", "Light_First_Baked", [23.66, 1.452, -1.692], [-Math.PI / 2, 0, 0]],
    ["light-second", "public/models/Light Room/Light_Second.glb", "Light_Second_Baked", [26.719, 1.498, 1.614], [0, 0, -Math.PI / 2]],
    ["light-third", "public/models/Light Room/Light_Third.glb", "Light_Third_Baked", [24.79, -0.201, 0.173], [0, 0, 0]],
  ],
};

function geometryFrom(decoded) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(decoded.position, 3));
  geometry.setIndex(new THREE.BufferAttribute(decoded.index, 1));
  return geometry;
}

const draco = await decoderPromise;
const theme = process.argv[2] || "dark";
const loaded = new Map();

function load(file, nodeName) {
  const key = `${file}:${nodeName}`;
  if (loaded.has(key)) return loaded.get(key);
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((item) => item.name === nodeName);
  const geometry = geometryFrom(
    decodePrimitive(draco, json, bin, json.meshes[node.mesh].primitives[0]),
  );
  loaded.set(key, geometry);
  return geometry;
}

let claimed = 0;
let source = 0;
const rows = [];

for (const [id, file, nodeName, position, rotation] of hosts[theme]) {
  let geometry = load(file, nodeName);
  if (id === "light-second") {
    const screen = load("public/models/Light Room/Light_First.glb", "Desktop_Screen");
    geometry = buildLightComputer(geometry, screen).rest;
  }
  const started = performance.now();
  const split = extractMesh(geometry, composeMatrix(position, rotation), OBJECT_VOLUMES[theme]);
  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  const sum = split.claimedTriangles + split.restTriangles;
  console.log(
    `\n${id} ${split.sourceTriangles} = ${split.claimedTriangles} + ${split.restTriangles} (${sum === split.sourceTriangles ? "ok" : "LEAK"}) ${elapsed}s  objects ${split.objects.length}`,
  );
  source += split.sourceTriangles;
  claimed += split.claimedTriangles;
  for (const object of split.objects) {
    rows.push({ mesh: id, ...object });
  }
}

labelClusters(theme, rows);
rows.sort((a, b) => b.triangles - a.triangles);
for (const row of rows) {
  const name = row.label || "—";
  console.log(
    row.mesh.padEnd(12),
    name.padEnd(8),
    row.center.map((value) => value.toFixed(2)).join(" "),
    row.size.map((value) => value.toFixed(2)).join("x"),
    "t=" + row.triangles,
  );
}
console.log("claimed", claimed, "of", source);
