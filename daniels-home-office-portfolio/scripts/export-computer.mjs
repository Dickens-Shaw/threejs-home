import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { execFileSync } from "child_process";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import {
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";
import {
  DESKTOP_POSITION,
  DESKTOP_ROTATION,
  SECOND_POSITION,
  SECOND_ROTATION,
  buildLightComputer,
} from "../src/Experience/parts/lightComputer.js";

class FileReaderPolyfill {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), row + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function installCanvasPolyfill() {
  globalThis.FileReader = FileReaderPolyfill;
  globalThis.ImageData = class ImageData {
    constructor(data, width, height = data.length / 4 / width) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
  globalThis.document = {
    createElement() {
      const canvas = {
        width: 1,
        height: 1,
        image: null,
        getContext() {
          return {
            translate() {},
            scale() {},
            fillRect() {},
            putImageData(image) {
              canvas.image = image;
            },
            getImageData() {
              return canvas.image;
            },
          };
        },
        toBlob(callback) {
          const image = canvas.image;
          const png = encodePNG(image.width, image.height, image.data);
          callback(new Blob([png], { type: "image/png" }));
        },
      };
      return canvas;
    },
  };
}

function parsePPM(buffer) {
  const tokens = [];
  let cursor = 2;
  while (tokens.length < 3) {
    while (buffer[cursor] <= 32) cursor += 1;
    if (buffer[cursor] === 35) {
      while (buffer[cursor] !== 10) cursor += 1;
      continue;
    }
    const start = cursor;
    while (buffer[cursor] > 32) cursor += 1;
    tokens.push(buffer.toString("ascii", start, cursor));
  }
  if (buffer[cursor] <= 32) cursor += 1;
  const width = Number(tokens[0]);
  const height = Number(tokens[1]);
  const rgb = buffer.subarray(cursor, cursor + width * height * 3);
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0, target = 0; pixel < rgb.length; pixel += 3, target += 4) {
    data[target] = rgb[pixel];
    data[target + 1] = rgb[pixel + 1];
    data[target + 2] = rgb[pixel + 2];
    data[target + 3] = 255;
  }
  return { width, height, data };
}

function loadTexture(glb) {
  const { json, bin } = parseGlb(glb);
  const view = json.bufferViews[json.images[0].bufferView];
  const start = view.byteOffset || 0;
  const webp = bin.subarray(start, start + view.byteLength);
  const webpPath = path.join(os.tmpdir(), "light-second-baked.webp");
  const ppmPath = path.join(os.tmpdir(), "light-second-baked.ppm");
  fs.writeFileSync(webpPath, webp);
  execFileSync("dwebp", [webpPath, "-ppm", "-o", ppmPath]);
  const image = parsePPM(fs.readFileSync(ppmPath));
  const texture = new THREE.DataTexture(image.data, image.width, image.height);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.name = "light_second_texture";
  return texture;
}

function geometryFromDecoded(decoded) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(decoded.position, 3)
  );
  geometry.setIndex(new THREE.BufferAttribute(decoded.index, 1));
  for (const [name, attribute] of Object.entries(decoded.attributes)) {
    const attributeName = name === "TEXCOORD_0" ? "uv" : name.toLowerCase();
    geometry.setAttribute(
      attributeName,
      new THREE.BufferAttribute(
        attribute.array,
        attribute.itemSize,
        attribute.normalized
      )
    );
  }
  return geometry;
}

function compactGeometry(source) {
  const index = source.getIndex();
  const remap = new Map();
  const compacted = new Uint32Array(index.count);
  let unique = 0;
  for (let i = 0; i < index.count; i++) {
    const oldIndex = index.getX(i);
    let next = remap.get(oldIndex);
    if (next === undefined) {
      next = unique;
      unique += 1;
      remap.set(oldIndex, next);
    }
    compacted[i] = next;
  }

  const geometry = new THREE.BufferGeometry();
  for (const name of Object.keys(source.attributes)) {
    const attribute = source.getAttribute(name);
    const array = new attribute.array.constructor(unique * attribute.itemSize);
    for (const [oldIndex, next] of remap) {
      for (let channel = 0; channel < attribute.itemSize; channel++) {
        array[next * attribute.itemSize + channel] =
          attribute.array[oldIndex * attribute.itemSize + channel];
      }
    }
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized)
    );
  }
  geometry.setIndex(new THREE.BufferAttribute(compacted, 1));
  return geometry;
}

function loadGeometry(draco, file, nodeName) {
  const { json, bin } = parseGlb(file);
  const node = json.nodes.find((entry) => entry.name === nodeName);
  const primitive = json.meshes[node.mesh].primitives[0];
  return geometryFromDecoded(
    decodePrimitive(draco, json, bin, primitive, ["NORMAL", "TEXCOORD_0"])
  );
}

installCanvasPolyfill();
const draco = await decoderPromise;
const baked = loadGeometry(
  draco,
  "public/models/Light Room/Light_Second.glb",
  "Light_Second_Baked"
);
const screen = loadGeometry(
  draco,
  "public/models/Light Room/Light_First.glb",
  "Desktop_Screen"
);
const pieces = buildLightComputer(baked, screen);
const shellGeometry = compactGeometry(pieces.monitor);

const shellMaterial = new THREE.MeshBasicMaterial({
  map: loadTexture("public/models/Light Room/Light_Second.glb"),
  side: THREE.DoubleSide,
});
const screenMaterial = new THREE.MeshBasicMaterial({ color: "#1a1a1a" });

const computer = new THREE.Group();
computer.name = "LightComputer";

const shell = new THREE.Mesh(shellGeometry, shellMaterial);
shell.name = "MonitorShell";
shell.position.set(...SECOND_POSITION);
shell.rotation.set(...SECOND_ROTATION);

const display = new THREE.Mesh(screen, screenMaterial);
display.name = "DesktopScreen";
display.position.set(...DESKTOP_POSITION);
display.rotation.set(...DESKTOP_ROTATION);

computer.add(shell, display);

const exporter = new GLTFExporter();
const glb = await new Promise((resolve, reject) => {
  exporter.parse(
    computer,
    resolve,
    reject,
    { binary: true, trs: true, onlyVisible: true }
  );
});

const output = "public/models/assembled/light-computer.glb";
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.from(glb));
swapWebpImage(output, "public/models/Light Room/Light_Second.glb");
console.log(
  `${output} ${(fs.statSync(output).size / 1024).toFixed(0)} KB, shell tris ${shellGeometry.getIndex().count / 3}`
);

function swapWebpImage(glbPath, sourceGlbPath) {
  const source = parseGlb(sourceGlbPath);
  const sourceView = source.json.bufferViews[source.json.images[0].bufferView];
  const sourceStart = sourceView.byteOffset || 0;
  const webp = Buffer.from(
    source.bin.subarray(sourceStart, sourceStart + sourceView.byteLength)
  );

  const data = fs.readFileSync(glbPath);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8"));
  const binHeader = 20 + jsonLength;
  const binLength = data.readUInt32LE(binHeader);
  const bin = data.subarray(binHeader + 8, binHeader + 8 + binLength);
  const imageView = json.images[0].bufferView;
  const parts = [];
  let offset = 0;

  json.bufferViews.forEach((view, index) => {
    const bytes =
      index === imageView
        ? webp
        : bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const padding = (4 - (offset % 4)) % 4;
    if (padding) parts.push(Buffer.alloc(padding));
    offset += padding;
    view.byteOffset = offset;
    view.byteLength = bytes.length;
    parts.push(bytes);
    offset += bytes.length;
  });

  const binPadding = (4 - (offset % 4)) % 4;
  const binary = Buffer.concat([...parts, Buffer.alloc(binPadding)]);
  json.buffers[0].byteLength = binary.length;
  json.images[0].mimeType = "image/webp";
  json.images[0].name = "light_second_texture.webp";
  delete json.textures[0].source;
  json.textures[0].extensions = { EXT_texture_webp: { source: 0 } };
  json.extensionsUsed = Array.from(
    new Set([...(json.extensionsUsed || []), "EXT_texture_webp"])
  );
  json.extensionsRequired = Array.from(
    new Set([...(json.extensionsRequired || []), "EXT_texture_webp"])
  );

  const jsonBuffer = Buffer.from(JSON.stringify(json));
  const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
  const paddedJson = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)]);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + paddedJson.length + 8 + binary.length;
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonChunk = Buffer.alloc(8);
  jsonChunk.writeUInt32LE(paddedJson.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  const binChunk = Buffer.alloc(8);
  binChunk.writeUInt32LE(binary.length, 0);
  binChunk.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(
    glbPath,
    Buffer.concat([header, jsonChunk, paddedJson, binChunk, binary])
  );
}
