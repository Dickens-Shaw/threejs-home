import fs from "fs";
import path from "path";
import vm from "vm";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const wrapperPath = path.resolve(
  "node_modules/three/examples/jsm/libs/draco/draco_wasm_wrapper.js"
);
const sandbox = {
  console,
  WebAssembly,
  process,
  Buffer,
  TextDecoder,
  TextEncoder,
  setTimeout,
  clearTimeout,
  performance,
  URL,
  require: createRequire(wrapperPath),
  __dirname: path.dirname(wrapperPath),
  __filename: wrapperPath,
};
sandbox.global = sandbox;
sandbox.self = sandbox;
sandbox.module = { exports: {} };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(fs.readFileSync(wrapperPath, "utf8"), sandbox, {
  filename: wrapperPath,
});
const DracoDecoderModule = sandbox.module.exports;

const wasmPath = path.resolve(
  "node_modules/three/examples/jsm/libs/draco/draco_decoder.wasm"
);

const decoderPromise = DracoDecoderModule({
  wasmBinary: fs.readFileSync(wasmPath),
});

function parseGlb(file) {
  const data = fs.readFileSync(file);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8"));
  const binHeader = 20 + jsonLength;
  const binLength = data.readUInt32LE(binHeader);
  const bin = data.subarray(binHeader + 8, binHeader + 8 + binLength);
  return { json, bin };
}

const COMPONENT_ARRAY = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};

const DRACO_TYPE = {
  5120: "DT_INT8",
  5121: "DT_UINT8",
  5122: "DT_INT16",
  5123: "DT_UINT16",
  5125: "DT_UINT32",
  5126: "DT_FLOAT32",
};

const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readDracoAttribute(draco, decoder, mesh, uniqueId, componentType, itemSize) {
  const attribute = decoder.GetAttributeByUniqueId(mesh, uniqueId);
  const ArrayType = COMPONENT_ARRAY[componentType];
  const count = mesh.num_points() * itemSize;
  const bytes = count * ArrayType.BYTES_PER_ELEMENT;
  const ptr = draco._malloc(bytes);
  decoder.GetAttributeDataArrayForAllPoints(
    mesh,
    attribute,
    draco[DRACO_TYPE[componentType]],
    bytes,
    ptr
  );
  const array = new ArrayType(draco.HEAPF32.buffer, ptr, count).slice();
  draco._free(ptr);
  return array;
}

function decodePrimitive(draco, json, bin, primitive, extras = []) {
  const dracoExt = primitive.extensions.KHR_draco_mesh_compression;
  const view = json.bufferViews[dracoExt.bufferView];
  const start = view.byteOffset || 0;
  const bytes = new Int8Array(bin.subarray(start, start + view.byteLength));

  const decoder = new draco.Decoder();
  const mesh = new draco.Mesh();
  const status = decoder.DecodeArrayToMesh(bytes, bytes.byteLength, mesh);
  if (!status.ok() || mesh.ptr === 0) {
    throw new Error(status.error_msg());
  }

  const numFaces = mesh.num_faces();
  const numIndices = numFaces * 3;
  const indexBytes = numIndices * 4;
  const indexPtr = draco._malloc(indexBytes);
  decoder.GetTrianglesUInt32Array(mesh, indexBytes, indexPtr);
  const index = new Uint32Array(draco.HEAPF32.buffer, indexPtr, numIndices).slice();
  draco._free(indexPtr);

  const posAttr = decoder.GetAttributeByUniqueId(mesh, dracoExt.attributes.POSITION);
  const numPoints = mesh.num_points();
  const posValues = numPoints * 3;
  const posBytes = posValues * 4;
  const posPtr = draco._malloc(posBytes);
  decoder.GetAttributeDataArrayForAllPoints(
    mesh,
    posAttr,
    draco.DT_FLOAT32,
    posBytes,
    posPtr
  );
  const position = new Float32Array(draco.HEAPF32.buffer, posPtr, posValues).slice();
  draco._free(posPtr);

  const attributes = {};
  for (const name of extras) {
    const accessor = json.accessors[primitive.attributes[name]];
    attributes[name] = {
      array: readDracoAttribute(
        draco,
        decoder,
        mesh,
        dracoExt.attributes[name],
        accessor.componentType,
        TYPE_SIZE[accessor.type]
      ),
      itemSize: TYPE_SIZE[accessor.type],
      normalized: Boolean(accessor.normalized),
    };
  }

  draco.destroy(mesh);
  draco.destroy(decoder);
  return { index, position, numFaces, numPoints, attributes };
}

class UnionFind {
  constructor(n) {
    this.parent = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }

  find(x) {
    const parent = this.parent;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  union(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a !== b) this.parent[b] = a;
  }
}

function componentsOf(index, position) {
  const pointCount = position.length / 3;
  const uf = new UnionFind(pointCount);
  const triCount = index.length / 3;
  for (let i = 0; i < triCount; i++) {
    const a = index[i * 3];
    const b = index[i * 3 + 1];
    const c = index[i * 3 + 2];
    uf.union(a, b);
    uf.union(b, c);
  }

  const stats = new Map();
  for (let i = 0; i < triCount; i++) {
    const root = uf.find(index[i * 3]);
    let stat = stats.get(root);
    if (!stat) {
      stat = {
        tris: 0,
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
      };
      stats.set(root, stat);
    }
    stat.tris += 1;
  }

  for (let i = 0; i < pointCount; i++) {
    const root = uf.find(i);
    const stat = stats.get(root);
    if (!stat) continue;
    const x = position[i * 3];
    const y = position[i * 3 + 1];
    const z = position[i * 3 + 2];
    if (x < stat.min[0]) stat.min[0] = x;
    if (y < stat.min[1]) stat.min[1] = y;
    if (z < stat.min[2]) stat.min[2] = z;
    if (x > stat.max[0]) stat.max[0] = x;
    if (y > stat.max[1]) stat.max[1] = y;
    if (z > stat.max[2]) stat.max[2] = z;
  }

  return [...stats.values()].sort((a, b) => b.tris - a.tris);
}

export {
  decoderPromise,
  parseGlb,
  decodePrimitive,
  componentsOf,
};

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
const file = process.argv[2];
const draco = await decoderPromise;
const { json, bin } = parseGlb(file);

for (const node of json.nodes) {
  if (node.mesh === undefined) continue;
  const mesh = json.meshes[node.mesh];
  const primitive = mesh.primitives[0];
  const decoded = decodePrimitive(draco, json, bin, primitive);
  const parts = componentsOf(decoded.index, decoded.position);
  console.log(
    `\n${node.name}: points=${decoded.numPoints} faces=${decoded.numFaces} islands=${parts.length}`
  );
  for (const part of parts.slice(0, 15)) {
    const size = part.max.map((value, i) => (value - part.min[i]).toFixed(3));
    console.log(
      `  tris=${String(part.tris).padStart(7)} size=${size.join(",")} min=${part.min
        .map((v) => v.toFixed(2))
        .join(",")}`
    );
  }
  if (parts.length > 15) {
    const tiny = parts.filter((part) => part.tris < 30).length;
    console.log(`  ... ${parts.length - 15} more, under 30 tris: ${tiny}`);
  }
}
}
