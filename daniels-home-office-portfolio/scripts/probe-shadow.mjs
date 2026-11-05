import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import * as THREE from "three";
import {
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";
import { composeMatrix } from "../src/Experience/parts/splitGeometry.js";

function loadTexture(glbPath) {
  const { json, bin } = parseGlb(glbPath);
  const image = json.images?.[0];
  if (!image) return null;
  const view = json.bufferViews[image.bufferView];
  const start = view.byteOffset || 0;
  const webp = bin.subarray(start, start + view.byteLength);
  const webpPath = path.join(os.tmpdir(), `shadow-${path.basename(glbPath)}.webp`);
  const ppmPath = webpPath.replace(/\.webp$/, ".ppm");
  fs.writeFileSync(webpPath, webp);
  execFileSync("dwebp", [webpPath, "-ppm", "-o", ppmPath]);
  const buffer = fs.readFileSync(ppmPath);
  const tokens = [];
  let cursor = 2;
  while (tokens.length < 3) {
    while (buffer[cursor] <= 32) cursor += 1;
    if (buffer[cursor] === 35) {
      while (buffer[cursor] !== 10) cursor += 1;
      continue;
    }
    const tokenStart = cursor;
    while (buffer[cursor] > 32) cursor += 1;
    tokens.push(buffer.toString("ascii", tokenStart, cursor));
  }
  if (buffer[cursor] <= 32) cursor += 1;
  return {
    width: Number(tokens[0]),
    height: Number(tokens[1]),
    rgb: buffer.subarray(cursor),
  };
}

function sample(texture, u, v) {
  if (!texture) return null;
  const x = Math.min(texture.width - 1, Math.max(0, Math.floor(u * texture.width)));
  const y = Math.min(texture.height - 1, Math.max(0, Math.floor(v * texture.height)));
  const index = (y * texture.width + x) * 3;
  return [texture.rgb[index], texture.rgb[index + 1], texture.rgb[index + 2]];
}

function loadMesh(draco, file, nodeName, position, rotation) {
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((entry) => entry.name === nodeName);
  const primitive = json.meshes[node.mesh].primitives[0];
  const decoded = decodePrimitive(draco, json, bin, primitive, ["NORMAL", "TEXCOORD_0"]);
  return {
    decoded,
    matrix: composeMatrix(position, rotation),
    texture: loadTexture(file),
    name: nodeName,
  };
}

const draco = await decoderPromise;
const meshes = [
  loadMesh(
    draco,
    "public/models/Light Room/Light_First.glb",
    "Light_First_Baked",
    [23.66, 1.452, -1.692],
    [-Math.PI / 2, 0, 0]
  ),
  loadMesh(
    draco,
    "public/models/Light Room/Light_Second.glb",
    "Light_Second_Baked",
    [26.719, 1.498, 1.614],
    [0, 0, -Math.PI / 2]
  ),
];

const x0 = 24.05;
const x1 = 24.75;
const z0 = -1.9;
const z1 = -1.25;
const columns = 70;
const rows = 50;
const image = new Uint8Array(columns * rows * 3);
image.fill(30);
const hits = [];

for (const mesh of meshes) {
  const { decoded, matrix, texture, name } = mesh;
  const position = decoded.position;
  const normal = decoded.attributes.NORMAL.array;
  const uv = decoded.attributes.TEXCOORD_0.array;
  const index = decoded.index;
  const point = new THREE.Vector3();
  const n = new THREE.Vector3();
  let upTris = 0;

  for (let triangle = 0; triangle < index.length; triangle += 3) {
    const ids = [index[triangle], index[triangle + 1], index[triangle + 2]];
    const verts = ids.map((id) => {
      point.set(position[id * 3], position[id * 3 + 1], position[id * 3 + 2]).applyMatrix4(matrix);
      return point.clone();
    });
    const normals = ids.map((id) =>
      n.set(normal[id * 3], normal[id * 3 + 1], normal[id * 3 + 2]).transformDirection(matrix).clone()
    );
    const up = normals.filter((item) => item.y > 0.75).length >= 2;
    if (!up) continue;
    const centroid = verts[0].clone().add(verts[1]).add(verts[2]).multiplyScalar(1 / 3);
    if (centroid.y < 0.68 || centroid.y > 0.82) continue;
    if (centroid.x < x0 - 0.4 || centroid.x > x1 + 0.4) continue;
    if (centroid.z < z0 - 0.2 || centroid.z > z1 + 0.2) continue;
    upTris += 1;

    const uvs = ids.map((id) => [uv[id * 2], uv[id * 2 + 1]]);
    const samples = 6;
    for (let j = 0; j <= samples; j++) {
      for (let i = 0; i <= samples - j; i++) {
        const a = i / samples;
        const b = j / samples;
        const c = 1 - a - b;
        const world = verts[0].clone().multiplyScalar(a).addScaledVector(verts[1], b).addScaledVector(verts[2], c);
        if (world.x < x0 || world.x > x1 || world.z < z0 || world.z > z1) continue;
        const texel = sample(
          texture,
          uvs[0][0] * a + uvs[1][0] * b + uvs[2][0] * c,
          uvs[0][1] * a + uvs[1][1] * b + uvs[2][1] * c
        );
        const column = Math.floor(((world.x - x0) / (x1 - x0)) * (columns - 1));
        const row = Math.floor(((world.z - z0) / (z1 - z0)) * (rows - 1));
        const pixel = (row * columns + column) * 3;
        image[pixel] = texel[0];
        image[pixel + 1] = texel[1];
        image[pixel + 2] = texel[2];
      }
    }
  }
  hits.push({ name, upTris, texture: texture && `${texture.width}x${texture.height}` });
}

const darkest = [];
for (const mesh of meshes) {
  const { decoded, matrix, texture, name } = mesh;
  const position = decoded.position;
  const normal = decoded.attributes.NORMAL.array;
  const uv = decoded.attributes.TEXCOORD_0.array;
  const index = decoded.index;
  const point = new THREE.Vector3();
  const n = new THREE.Vector3();
  const flats = [];
  for (let triangle = 0; triangle < index.length; triangle += 3) {
    const ids = [index[triangle], index[triangle + 1], index[triangle + 2]];
    const verts = ids.map((id) =>
      point
        .set(position[id * 3], position[id * 3 + 1], position[id * 3 + 2])
        .applyMatrix4(matrix)
        .clone()
    );
    const min = verts.reduce((box, vert) => box.min(vert), verts[0].clone());
    const max = verts.reduce((box, vert) => box.max(vert), verts[0].clone());
    const size = max.clone().sub(min);
    if (size.y > 0.015 || Math.max(size.x, size.z) < 0.05) continue;
    if (min.y < 0.65 || max.y > 0.85) continue;
    if (max.x < 24.0 || min.x > 24.9 || max.z < -1.9 || min.z > -1.1) continue;
    const id = ids[0];
    n.set(normal[id * 3], normal[id * 3 + 1], normal[id * 3 + 2]).transformDirection(matrix);
    if (n.y > 0.8 && centroidWould(verts)) {
      const uvs = ids.map((vertex) => [uv[vertex * 2], uv[vertex * 2 + 1]]);
      const u = (uvs[0][0] + uvs[1][0] + uvs[2][0]) / 3;
      const v = (uvs[0][1] + uvs[1][1] + uvs[2][1]) / 3;
      const color = sample(texture, u, v);
      const luminance = color[0] + color[1] + color[2];
      if (luminance < 220) {
        const centroid = verts[0].clone().add(verts[1]).add(verts[2]).multiplyScalar(1 / 3);
        darkest.push({
          name,
          luminance,
          color,
          ny: Number(n.y.toFixed(2)),
          center: centroid.toArray().map((value) => Number(value.toFixed(3))),
          size: size.toArray().map((value) => Number(value.toFixed(3))),
        });
      }
    }
    const centroid = verts[0].clone().add(verts[1]).add(verts[2]).multiplyScalar(1 / 3);
    const u = (uv[ids[0] * 2] + uv[ids[1] * 2] + uv[ids[2] * 2]) / 3;
    const v = (uv[ids[0] * 2 + 1] + uv[ids[1] * 2 + 1] + uv[ids[2] * 2 + 1]) / 3;
    flats.push({
      size: size.toArray().map((value) => Number(value.toFixed(3))),
      y: Number(centroid.y.toFixed(3)),
      center: centroid.toArray().map((value) => Number(value.toFixed(3))),
      ny: Number(n.y.toFixed(3)),
      uv: [Number(u.toFixed(4)), Number(v.toFixed(4))],
      color: sample(texture, u, v),
      colorFlip: sample(texture, u, 1 - v),
    });
  }
  flats.sort((a, b) => Math.max(...b.size) - Math.max(...a.size));
  console.log(`\n${name} flat tris ${flats.length}`);
  for (const flat of flats.slice(0, 12)) console.log(JSON.stringify(flat));
}

let dark = 0;
let light = 0;
for (let i = 0; i < image.length; i += 3) {
  const luminance = image[i] + image[i + 1] + image[i + 2];
  if (luminance < 80) continue;
  if (luminance < 400) dark += 1;
  else light += 1;
}

const header = `P6\n${columns} ${rows}\n255\n`;
fs.writeFileSync("/tmp/desk-shadow.ppm", Buffer.concat([Buffer.from(header), Buffer.from(image)]));
console.log(JSON.stringify({ hits, dark, light, image: "/tmp/desk-shadow.ppm" }, null, 2));
