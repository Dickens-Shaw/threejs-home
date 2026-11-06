import * as THREE from "three";

const LIFT = 0.0012;
const THRESHOLD = 55;
const SET_INDEX = { First: 1, Second: 2, Third: 3, Fourth: 4 };

const corner = new THREE.Vector3();
const world = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const local = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const faceNormal = new THREE.Vector3();
const samplePoint = new THREE.Vector3();

const MARKS = [
  {
    id: "chair-floor",
    caster: "Chair_Fourth",
    receivers: ["First"],
    facing: "y",
    sign: 1,
    min: [-1.85, 0.42, -2.9],
    max: [0.3, 0.7, -0.75],
    maxSize: [1.15, 0.1, 1.15],
    minSpan: 0.1,
  },
  {
    id: "rug-floor",
    caster: "Rug_Third",
    receivers: ["First"],
    facing: "y",
    sign: 1,
    min: [0.4, 0.42, -1.65],
    max: [2.5, 0.7, 1.65],
    maxSize: [2.15, 0.12, 2.9],
    minSpan: 0.4,
  },
  {
    id: "computer-wall",
    caster: "Computer_Fourth",
    receivers: ["First"],
    facing: "z",
    sign: 1,
    min: [-3.4, 3.05, -4.35],
    max: [-1.15, 4.8, -3.7],
    maxSize: [1.85, 1.55, 0.2],
    minSpan: 0.15,
    threshold: 40,
  },
  {
    id: "cabinet-floor",
    caster: "Cabinet_Fourth",
    receivers: ["First"],
    facing: "y",
    sign: 1,
    min: [-3.35, 0.42, 0.25],
    max: [-1.45, 0.72, 2.05],
    maxSize: [1.5, 0.1, 1.6],
    minSpan: 0.2,
  },
  {
    id: "computer-desk",
    caster: "Computer_Fourth",
    receivers: ["Desk_Fourth_Body"],
    facing: "y",
    sign: 1,
    min: [-3.35, 2.95, -4.05],
    max: [-1.15, 3.55, -2.3],
    maxSize: [1.7, 0.12, 1.3],
    minSpan: 0.1,
    threshold: 40,
  },
  {
    id: "keyboard-desk",
    caster: "Keyboard_Fourth",
    receivers: ["Desk_Fourth_Body"],
    facing: "y",
    sign: 1,
    min: [-2.25, 2.95, -2.25],
    max: [-1.3, 3.5, -0.9],
    maxSize: [1.1, 0.15, 1.5],
    minSpan: 0.2,
  },
  {
    id: "shelf-wall",
    caster: "Shelf_First",
    receivers: ["First"],
    facing: "z",
    sign: 1,
    min: [-3.45, 5.15, -4.65],
    max: [-0.4, 6.25, -3.55],
    maxSize: [2.9, 0.5, 0.35],
    minSpan: 0.4,
  },
];

function rockMarks(root) {
  const marks = [];
  root.traverse((child) => {
    if (!child.isMesh || !/^Rock_\d+_Third/.test(child.name)) return;
    const box = new THREE.Box3().setFromObject(child);
    if (box.isEmpty()) return;
    const spanX = box.max.x - box.min.x;
    const spanZ = box.max.z - box.min.z;
    marks.push({
      id: `${child.name}-water`,
      caster: child.name,
      receivers: ["Third"],
      facing: "y",
      sign: 1,
      min: [box.min.x - 0.35, -1.05, box.min.z - 0.35],
      max: [box.max.x + 0.35, -0.65, box.max.z + 0.35],
      maxSize: [Math.min(spanX + 0.35, 1.15), 0.2, Math.min(spanZ + 0.35, 1.15)],
      minSpan: 0.08,
    });
  });
  return marks;
}

export function shadowMarks(root) {
  return MARKS.concat(rockMarks(root));
}

function textureKeyOf(mesh) {
  if (mesh.userData.sourceShell) return mesh.userData.sourceShell;
  if (SET_INDEX[mesh.name]) return mesh.name;
  return null;
}

function overlaps(spec, boxMin, boxMax) {
  return boxMax[0] >= spec.min[0] && boxMin[0] <= spec.max[0]
    && boxMax[1] >= spec.min[1] && boxMin[1] <= spec.max[1]
    && boxMax[2] >= spec.min[2] && boxMin[2] <= spec.max[2];
}

function inside(spec, point) {
  return point.x >= spec.min[0] && point.x <= spec.max[0]
    && point.y >= spec.min[1] && point.y <= spec.max[1]
    && point.z >= spec.min[2] && point.z <= spec.max[2];
}

export function collectShadowSamples(geometry, matrixWorld, spec, sample) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const collected = {
    dark: [],
    visited: 0,
    buckets: { 40: 0, 55: 0, 70: 0, 90: 0, 120: 0 },
    darkest: null,
  };
  if (!index || !position || !uv) return collected;

  const axis = spec.facing === "y" ? "y" : "z";
  const threshold = spec.threshold || THRESHOLD;
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const ids = [index.getX(triangle), index.getX(triangle + 1), index.getX(triangle + 2)];
    for (let cornerIndex = 0; cornerIndex < 3; cornerIndex += 1) {
      local[cornerIndex].fromBufferAttribute(position, ids[cornerIndex]);
      world[cornerIndex].copy(local[cornerIndex]).applyMatrix4(matrixWorld);
    }
    const boxMin = [
      Math.min(world[0].x, world[1].x, world[2].x),
      Math.min(world[0].y, world[1].y, world[2].y),
      Math.min(world[0].z, world[1].z, world[2].z),
    ];
    const boxMax = [
      Math.max(world[0].x, world[1].x, world[2].x),
      Math.max(world[0].y, world[1].y, world[2].y),
      Math.max(world[0].z, world[1].z, world[2].z),
    ];
    if (!overlaps(spec, boxMin, boxMax)) continue;

    faceNormal.copy(world[1]).sub(world[0]).cross(corner.copy(world[2]).sub(world[0]));
    if (faceNormal.lengthSq() < 1e-10) continue;
    faceNormal.normalize();
    if (faceNormal[axis] * spec.sign < 0.72) continue;

    const longest = Math.max(
      world[0].distanceTo(world[1]),
      world[1].distanceTo(world[2]),
      world[2].distanceTo(world[0])
    );
    const steps = Math.min(160, Math.max(1, Math.ceil(longest / 0.03)));
    const uvAt = ids.map((id) => [uv.getX(id), uv.getY(id)]);
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps - i; j += 1) {
        const w0 = i / steps;
        const w1 = j / steps;
        const w2 = 1 - w0 - w1;
        samplePoint.copy(world[0]).multiplyScalar(w0).addScaledVector(world[1], w1).addScaledVector(world[2], w2);
        if (!inside(spec, samplePoint)) continue;
        const u = uvAt[0][0] * w0 + uvAt[1][0] * w1 + uvAt[2][0] * w2;
        const v = uvAt[0][1] * w0 + uvAt[1][1] * w1 + uvAt[2][1] * w2;
        const pixel = sample(u, v);
        if (!pixel) continue;
        collected.visited += 1;
        const sum = pixel[0] + pixel[1] + pixel[2];
        if (!collected.darkest || sum < collected.darkest.sum) {
          collected.darkest = {
            rgb: [pixel[0], pixel[1], pixel[2]],
            u,
            v,
            x: samplePoint.x,
            y: samplePoint.y,
            z: samplePoint.z,
            sum,
          };
        }
        const maxChannel = Math.max(pixel[0], pixel[1], pixel[2]);
        if (maxChannel < 120) collected.buckets[120] += 1;
        if (maxChannel < 90) collected.buckets[90] += 1;
        if (maxChannel < 70) collected.buckets[70] += 1;
        if (maxChannel < 55) collected.buckets[55] += 1;
        if (maxChannel < 40) collected.buckets[40] += 1;
        if (pixel[0] < threshold && pixel[1] < threshold && pixel[2] < threshold) {
          collected.dark.push({ x: samplePoint.x, y: samplePoint.y, z: samplePoint.z, u, v });
        }
      }
    }
  }
  return collected;
}

function clusterSamples(samples, facing) {
  const cell = 0.04;
  const uvCell = 0.005;
  const buckets = new Map();
  samples.forEach((entry, index) => {
    const ix = Math.floor(entry.x / cell);
    const iy = Math.floor((facing === "y" ? entry.z : entry.y) / cell);
    const iu = Math.floor(entry.u / uvCell);
    const iv = Math.floor(entry.v / uvCell);
    const key = `${ix},${iy},${iu},${iv}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { ix, iy, iu, iv, key, indices: [] };
      buckets.set(key, bucket);
    }
    bucket.indices.push(index);
  });

  const parent = new Map();
  buckets.forEach((bucket) => parent.set(bucket.key, bucket.key));
  const find = (key) => {
    let cursor = key;
    while (parent.get(cursor) !== cursor) {
      parent.set(cursor, parent.get(parent.get(cursor)));
      cursor = parent.get(cursor);
    }
    return cursor;
  };
  const unite = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  buckets.forEach((bucket) => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let du = -1; du <= 1; du += 1) {
          for (let dv = -1; dv <= 1; dv += 1) {
            const other = buckets.get(`${bucket.ix + dx},${bucket.iy + dy},${bucket.iu + du},${bucket.iv + dv}`);
            if (other) unite(bucket.key, other.key);
          }
        }
      }
    }
  });

  const groups = new Map();
  buckets.forEach((bucket) => {
    const root = find(bucket.key);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    bucket.indices.forEach((index) => group.push(samples[index]));
  });
  return [...groups.values()];
}

function measureGroup(samples) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  let sumU = 0;
  let sumV = 0;
  samples.forEach((entry) => {
    minX = Math.min(minX, entry.x);
    minY = Math.min(minY, entry.y);
    minZ = Math.min(minZ, entry.z);
    maxX = Math.max(maxX, entry.x);
    maxY = Math.max(maxY, entry.y);
    maxZ = Math.max(maxZ, entry.z);
    minU = Math.min(minU, entry.u);
    minV = Math.min(minV, entry.v);
    maxU = Math.max(maxU, entry.u);
    maxV = Math.max(maxV, entry.v);
    sumU += entry.u;
    sumV += entry.v;
  });
  const avgU = sumU / samples.length;
  const avgV = sumV / samples.length;
  let seed = samples[0];
  let seedDistance = Infinity;
  samples.forEach((entry) => {
    const distance = (entry.u - avgU) ** 2 + (entry.v - avgV) ** 2;
    if (distance < seedDistance) {
      seedDistance = distance;
      seed = entry;
    }
  });
  return {
    count: samples.length,
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    uv: { minU, maxU, minV, maxV },
    seed,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}

function fits(size, maxSize) {
  return size[0] <= maxSize[0] && size[1] <= maxSize[1] && size[2] <= maxSize[2];
}

function padRect(uv, amount) {
  return {
    minU: Math.max(0, uv.minU - amount),
    maxU: Math.min(1, uv.maxU + amount),
    minV: Math.max(0, uv.minV - amount),
    maxV: Math.min(1, uv.maxV + amount),
  };
}

function borderScore(sample, rect, threshold) {
  const step = 0.0004;
  let count = 0;
  let dark = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  const visit = (u, v) => {
    const pixel = sample(u, v);
    if (!pixel) return;
    count += 1;
    red += pixel[0];
    green += pixel[1];
    blue += pixel[2];
    if (pixel[0] < threshold && pixel[1] < threshold && pixel[2] < threshold) dark += 1;
  };
  for (let u = rect.minU; u <= rect.maxU; u += step) {
    visit(u, rect.minV);
    visit(u, rect.maxV);
  }
  for (let v = rect.minV; v <= rect.maxV; v += step) {
    visit(rect.minU, v);
    visit(rect.maxU, v);
  }
  return {
    ratio: count ? dark / count : 1,
    average: count ? [red / count, green / count, blue / count] : [0, 0, 0],
  };
}

function insideBounds(point, matrixWorld, bounds) {
  if (!bounds) return true;
  corner.copy(point).applyMatrix4(matrixWorld);
  const pad = 0.28;
  return corner.x >= bounds.minX - pad && corner.x <= bounds.maxX + pad
    && corner.y >= bounds.minY - pad && corner.y <= bounds.maxY + pad
    && corner.z >= bounds.minZ - pad && corner.z <= bounds.maxZ + pad;
}

function pointOnTriangle(geometry, u, v, matrixWorld, bounds) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!index || !position || !uv) return null;
  const point = new THREE.Vector3();
  const bPoint = new THREE.Vector3();
  const cPoint = new THREE.Vector3();
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const ids = [index.getX(triangle), index.getX(triangle + 1), index.getX(triangle + 2)];
    const a = [uv.getX(ids[0]), uv.getY(ids[0])];
    const b = [uv.getX(ids[1]), uv.getY(ids[1])];
    const c = [uv.getX(ids[2]), uv.getY(ids[2])];
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-8) continue;
    const w0 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / denominator;
    const w1 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / denominator;
    const w2 = 1 - w0 - w1;
    if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
    point.fromBufferAttribute(position, ids[0]).multiplyScalar(w0);
    point.addScaledVector(bPoint.fromBufferAttribute(position, ids[1]), w1);
    point.addScaledVector(cPoint.fromBufferAttribute(position, ids[2]), w2);
    if (!insideBounds(point, matrixWorld, bounds)) continue;
    return point;
  }
  return null;
}

function pointForCorner(geometry, u, v, rect, matrixWorld, bounds) {
  const direct = pointOnTriangle(geometry, u, v, matrixWorld, bounds);
  if (direct) return direct;
  const centerU = (rect.minU + rect.maxU) * 0.5;
  const centerV = (rect.minV + rect.maxV) * 0.5;
  for (const toward of [0.2, 0.45, 0.7]) {
    const hit = pointOnTriangle(
      geometry,
      u + (centerU - u) * toward,
      v + (centerV - v) * toward,
      matrixWorld,
      bounds
    );
    if (hit) return hit;
  }
  return null;
}


function shadowQuad(geometry, rect, matrixWorld, spec, bounds) {
  const corners = [
    [rect.minU, rect.minV],
    [rect.maxU, rect.minV],
    [rect.maxU, rect.maxV],
    [rect.minU, rect.maxV],
  ];
  const points = corners.map(([u, v]) => pointForCorner(geometry, u, v, rect, matrixWorld, bounds));
  if (points.some((point) => !point)) return null;

  const edgeA = points[1].clone().sub(points[0]);
  const edgeB = points[2].clone().sub(points[0]);
  const localNormal = edgeA.cross(edgeB);
  if (localNormal.lengthSq() < 1e-12) return null;
  localNormal.normalize();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  const worldNormal = localNormal.clone().applyMatrix3(normalMatrix).normalize();
  const axis = spec.facing === "y" ? "y" : "z";
  const facingValue = worldNormal[axis] * spec.sign;
  const lift = localNormal.multiplyScalar(facingValue >= 0 ? LIFT : -LIFT);
  const positions = [];
  points.forEach((point) => {
    point.add(lift);
    positions.push(point.x, point.y, point.z);
  });

  const quad = new THREE.BufferGeometry();
  quad.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  quad.setAttribute("uv", new THREE.Float32BufferAttribute(corners.flat(), 2));
  quad.setIndex(facingValue >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  quad.computeVertexNormals();
  quad.computeBoundingSphere();
  return quad;
}


function quadWorldSize(quad, matrixWorld) {
  const position = quad.getAttribute("position");
  const box = new THREE.Box3();
  for (let index = 0; index < position.count; index += 1) {
    box.expandByPoint(corner.fromBufferAttribute(position, index).applyMatrix4(matrixWorld));
  }
  return box.getSize(new THREE.Vector3());
}

function quadWorldNormal(quad, matrixWorld) {
  const position = quad.getAttribute("position");
  const index = quad.getIndex();
  const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(0)).applyMatrix4(matrixWorld);
  const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(1)).applyMatrix4(matrixWorld);
  const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(2)).applyMatrix4(matrixWorld);
  return b.sub(a).cross(c.sub(a)).normalize();
}

function floodRect(sample, seedU, seedV, threshold) {
  const step = 0.0018;
  const limit = 0.1;
  const seen = new Set();
  const queue = [[seedU, seedV]];
  let minU = seedU;
  let maxU = seedU;
  let minV = seedV;
  let maxV = seedV;
  let count = 0;
  while (queue.length && count < 6000) {
    const [u, v] = queue.pop();
    if (Math.abs(u - seedU) > limit || Math.abs(v - seedV) > limit) continue;
    const key = `${Math.round(u / step)},${Math.round(v / step)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pixel = sample(u, v);
    if (!pixel || pixel[0] >= threshold || pixel[1] >= threshold || pixel[2] >= threshold) continue;
    count += 1;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
    queue.push([u + step, v], [u - step, v], [u, v + step], [u, v - step]);
  }
  if (count < 20) return null;
  return { minU, maxU, minV, maxV };
}

function trimSparse(sample, rect, threshold) {
  const step = 0.0025;
  const darkAt = (u, v) => {
    const pixel = sample(u, v);
    return Boolean(pixel && pixel[0] < threshold && pixel[1] < threshold && pixel[2] < threshold);
  };
  const columns = [];
  for (let u = rect.minU; u <= rect.maxU + 1e-6; u += step) {
    let count = 0;
    let dark = 0;
    for (let v = rect.minV; v <= rect.maxV + 1e-6; v += step) {
      count += 1;
      if (darkAt(u, v)) dark += 1;
    }
    columns.push({ at: u, ratio: count ? dark / count : 0 });
  }
  const rows = [];
  for (let v = rect.minV; v <= rect.maxV + 1e-6; v += step) {
    let count = 0;
    let dark = 0;
    for (let u = rect.minU; u <= rect.maxU + 1e-6; u += step) {
      count += 1;
      if (darkAt(u, v)) dark += 1;
    }
    rows.push({ at: v, ratio: count ? dark / count : 0 });
  }
  const spanOf = (entries) => {
    let start = 0;
    let end = entries.length - 1;
    while (start < end && entries[start].ratio < 0.4) start += 1;
    while (end > start && entries[end].ratio < 0.4) end -= 1;
    if (entries[start].ratio < 0.4) return null;
    return [entries[start].at, entries[end].at];
  };
  const uSpan = spanOf(columns);
  const vSpan = spanOf(rows);
  if (!uSpan || !vSpan || uSpan[1] - uSpan[0] < 0.004 || vSpan[1] - vSpan[0] < 0.004) return rect;
  return { minU: uSpan[0], maxU: uSpan[1], minV: vSpan[0], maxV: vSpan[1] };
}

function uvSpanOk(rect) {
  const du = rect.maxU - rect.minU;
  const dv = rect.maxV - rect.minV;
  return du >= 0.004 && dv >= 0.004 && du <= 0.16 && dv <= 0.16;
}

function sideDark(sample, rect, threshold) {
  const step = 0.0016;
  const score = (u, v) => {
    const pixel = sample(u, v);
    return pixel && pixel[0] < threshold && pixel[1] < threshold && pixel[2] < threshold;
  };
  const ratios = [];
  const sweep = (horizontal, edge) => {
    let count = 0;
    let dark = 0;
    if (horizontal) {
      for (let u = rect.minU; u <= rect.maxU; u += step) {
        count += 1;
        if (score(u, edge)) dark += 1;
      }
    } else {
      for (let v = rect.minV; v <= rect.maxV; v += step) {
        count += 1;
        if (score(edge, v)) dark += 1;
      }
    }
    ratios.push(count ? dark / count : 1);
  };
  sweep(false, rect.minU);
  sweep(false, rect.maxU);
  sweep(true, rect.minV);
  sweep(true, rect.maxV);
  return ratios;
}

function fillScore(sample, rect, threshold) {
  const steps = 14;
  const du = rect.maxU - rect.minU;
  const dv = rect.maxV - rect.minV;
  if (du <= 0 || dv <= 0) return 0;
  let count = 0;
  let dark = 0;
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const pixel = sample(rect.minU + du * (i / steps), rect.minV + dv * (j / steps));
      if (!pixel) continue;
      count += 1;
      if (pixel[0] < threshold && pixel[1] < threshold && pixel[2] < threshold) dark += 1;
    }
  }
  return count ? dark / count : 0;
}

function rectMostlyInside(rect, existing) {
  const width = rect.maxU - rect.minU;
  const height = rect.maxV - rect.minV;
  if (width <= 0 || height <= 0) return true;
  const overlap = Math.max(0, Math.min(rect.maxU, existing.maxU) - Math.max(rect.minU, existing.minU))
    * Math.max(0, Math.min(rect.maxV, existing.maxV) - Math.max(rect.minV, existing.minV));
  return overlap / (width * height) > 0.65;
}

function chooseCards(geometry, matrixWorld, spec, sample) {
  const collected = collectShadowSamples(geometry, matrixWorld, spec, sample);
  const groups = clusterSamples(collected.dark, spec.facing).map(measureGroup).sort((a, b) => b.count - a.count);
  const threshold = spec.threshold || THRESHOLD;
  const cards = [];
  const attempts = [];
  groups.forEach((group) => {
    const span = Math.max(...group.size);
    const label = `${group.count}:${group.size.map((value) => value.toFixed(2)).join(",")}`;
    if (group.count < 8 || span < spec.minSpan) {
      if (attempts.length < 4) attempts.push(`${label} small`);
      return;
    }
    if (!fits(group.size, spec.maxSize)) {
      if (attempts.length < 6) attempts.push(`${label} big`);
      return;
    }
    if (!uvSpanOk(group.uv)) {
      const du = group.uv.maxU - group.uv.minU;
      const dv = group.uv.maxV - group.uv.minV;
      if (attempts.length < 8) attempts.push(`${label} uv ${du.toFixed(3)}x${dv.toFixed(3)}`);
      return;
    }
    const fill = fillScore(sample, group.uv, threshold);
    if (fill < 0.5) {
      if (attempts.length < 8) attempts.push(`${label} fill ${fill.toFixed(2)}`);
      return;
    }
    let rect = null;
    let border = null;
    for (const amount of [0.0022, 0.004]) {
      const candidate = padRect(group.uv, amount);
      if (!uvSpanOk(candidate)) break;
      const score = borderScore(sample, candidate, threshold);
      rect = candidate;
      border = score;
      if (score.ratio <= 0.08) break;
    }
    let flooded = false;
    if (!rect || border.ratio > 0.15) {
      const grown = floodRect(sample, group.seed.u, group.seed.v, threshold);
      const candidates = grown ? [trimSparse(sample, grown, threshold), grown] : [];
      for (const core of candidates) {
        const padded = padRect(core, 0.0022);
        if (!uvSpanOk(padded)) continue;
        const score = borderScore(sample, padded, threshold);
        const cleanSides = sideDark(sample, padded, threshold).filter((ratio) => ratio <= 0.2).length;
        if ((score.ratio <= 0.12 || cleanSides >= 2) && fillScore(sample, core, threshold) >= 0.55) {
          rect = padded;
          border = score;
          flooded = true;
          break;
        }
      }
    }
    if (!flooded && (!rect || border.ratio > 0.15)) {
      const du = (rect || group.uv).maxU - (rect || group.uv).minU;
      const dv = (rect || group.uv).maxV - (rect || group.uv).minV;
      attempts.push(`${label} border ${border ? border.ratio.toFixed(2) : "na"} uv ${du.toFixed(3)}x${dv.toFixed(3)}`);
      return;
    }
    if (cards.some((card) => rectMostlyInside(rect, card.rect))) {
      attempts.push(`${label} overlap`);
      return;
    }
    const locateBounds = flooded
      ? {
          minX: group.bounds.minX - 0.55,
          maxX: group.bounds.maxX + 0.55,
          minY: group.bounds.minY - 0.55,
          maxY: group.bounds.maxY + 0.55,
          minZ: group.bounds.minZ - 0.25,
          maxZ: group.bounds.maxZ + 0.25,
        }
      : group.bounds;
    const quad = shadowQuad(geometry, rect, matrixWorld, spec, locateBounds);
    if (!quad) {
      attempts.push(`${label} locate-miss`);
      return;
    }
    const size = quadWorldSize(quad, matrixWorld);
    const slack = flooded ? 0.35 : 0.28;
    const short = spec.facing === "y"
      ? group.size[0] - size.x > slack || group.size[2] - size.z > slack
      : group.size[0] - size.x > slack || group.size[1] - size.y > slack;
    if (short) {
      quad.dispose();
      attempts.push(`${label} short ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`);
      return;
    }
    const grow = flooded ? 0.95 : 0.25;
    if (
      size.x > group.size[0] + grow
      || size.y > group.size[1] + grow
      || size.z > group.size[2] + grow
    ) {
      quad.dispose();
      attempts.push(`${label} grew ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`);
      return;
    }
    const allowed = spec.maxSize.map((value) => value * 1.25 + 0.04);
    if (size.x > allowed[0] || size.y > allowed[1] || size.z > allowed[2]) {
      quad.dispose();
      attempts.push(`${label} quad-size ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`);
      return;
    }
    const long = spec.facing === "y" ? Math.max(size.x, size.z) : Math.max(size.x, size.y);
    const perMeter = Math.max(rect.maxU - rect.minU, rect.maxV - rect.minV) / Math.max(long, 0.05);
    if (perMeter > 0.35 || perMeter < 0.012) {
      quad.dispose();
      attempts.push(`${label} density ${perMeter.toFixed(3)}`);
      return;
    }
    const normal = quadWorldNormal(quad, matrixWorld);
    if (spec.id === "computer-wall" && (group.bounds.minX + group.bounds.maxX) * 0.5 > -1.6) {
      quad.dispose();
      attempts.push(`${label} off-case`);
      return;
    }
    const axis = spec.facing === "y" ? "y" : "z";
    if (Math.abs(normal[axis]) < 0.85) {
      quad.dispose();
      attempts.push(`${label} tilt ${normal.x.toFixed(2)},${normal.y.toFixed(2)},${normal.z.toFixed(2)}`);
      return;
    }
    attempts.push(`${label} ok ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)} n ${normal.x.toFixed(2)},${normal.y.toFixed(2)},${normal.z.toFixed(2)}`);
    cards.push({ rect, quad, size, normal, border, count: group.count });
  });
  return {
    cards,
    collected,
    attempts,
    reason: collected.visited === 0 ? "no-surface" : cards.length ? "accept" : "reject",
  };
}

export function buildContactShadowPlans(root, sampleFor, marks = shadowMarks(root), poses = null) {
  root.updateMatrixWorld(true);
  const plans = [];
  const notes = [];
  marks.forEach((mark) => {
    let best = null;
    mark.receivers.forEach((name) => {
      const mesh = root.getObjectByName(name);
      const key = mesh ? textureKeyOf(mesh) : null;
      const sample = key ? sampleFor(key) : null;
      if (!mesh || !sample) {
        notes.push({ id: mark.id, receiver: name, reason: "no-receiver", attempts: [] });
        return;
      }
      const matrix = poses?.get(mesh)?.matrixWorld || mesh.matrixWorld;
      let chosen = chooseCards(mesh.geometry, matrix, mark, sample);
      if (chosen.reason === "no-surface") {
        chosen = chooseCards(mesh.geometry, matrix, { ...mark, sign: -mark.sign }, sample);
      }
      const note = {
        id: mark.id,
        receiver: name,
        reason: chosen.cards.length ? `accept ${chosen.cards.length}` : chosen.reason,
        visited: chosen.collected.visited,
        buckets: chosen.collected.buckets,
        darkest: chosen.collected.darkest,
        attempts: chosen.attempts.slice(0, 5),
      };
      notes.push(note);
      const score = chosen.cards.reduce((sum, card) => sum + card.count, 0);
      if (!chosen.cards.length || (best && score <= best.score)) {
        chosen.cards.forEach((card) => card.quad.dispose());
        return;
      }
      if (best) best.cards.forEach((card) => card.quad.dispose());
      best = { mark, mesh, key, cards: chosen.cards, score };
    });
    best?.cards.forEach((card, index) => {
      plans.push({
        id: best.cards.length > 1 ? `${best.mark.id}-${index + 1}` : best.mark.id,
        caster: best.mark.caster,
        receiver: best.mesh,
        textureKey: best.key,
        quad: card.quad,
        rect: card.rect,
      });
    });
  });
  return { plans, notes };
}

function imageOf(texture) {
  return new Promise((resolve) => {
    const image = texture?.image;
    if (!image) {
      resolve(null);
      return;
    }
    if (image.complete && image.naturalWidth > 0) {
      resolve(image);
      return;
    }
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => resolve(null), { once: true });
  });
}

function readImage(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, context, pixels, width: canvas.width, height: canvas.height };
}

function samplerFromImage(image) {
  const { pixels, width, height } = readImage(image);
  const data = pixels.data;
  return (u, v) => {
    const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
    const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
    const offset = (y * width + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
}

function paintRects(image, source, rects) {
  const { canvas, context, pixels, width, height } = readImage(image);
  const original = pixels.data.slice();
  const data = pixels.data;
  const read = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const offset = (y * width + x) * 4;
    return [original[offset], original[offset + 1], original[offset + 2], original[offset + 3]];
  };
  const light = (pixel) => pixel && Math.max(pixel[0], pixel[1], pixel[2]) >= 70;
  const seek = (x, y, dx, dy) => {
    for (let distance = 1; distance <= 16; distance += 1) {
      const pixel = read(x + dx * distance, y + dy * distance);
      if (light(pixel)) return pixel;
    }
    return null;
  };

  rects.forEach((rect) => {
    const x0 = Math.max(0, Math.floor(rect.minU * width));
    const y0 = Math.max(0, Math.floor(rect.minV * height));
    const x1 = Math.min(width, Math.ceil(rect.maxU * width));
    const y1 = Math.min(height, Math.ceil(rect.maxV * height));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const options = [
          [x - x0, -1, 0, x0 - 1, y],
          [x1 - 1 - x, 1, 0, x1, y],
          [y - y0, 0, -1, x, y0 - 1],
          [y1 - 1 - y, 0, 1, x, y1],
        ].sort((a, b) => a[0] - b[0]);
        let sample = null;
        for (let option = 0; option < options.length && !sample; option += 1) {
          sample = seek(options[option][3], options[option][4], options[option][1], options[option][2]);
        }
        if (!sample) continue;
        const offset = (y * width + x) * 4;
        data[offset] = sample[0];
        data[offset + 1] = sample[1];
        data[offset + 2] = sample[2];
        data[offset + 3] = sample[3];
      }
    }
  });

  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = source.colorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.minFilter = source.minFilter;
  texture.magFilter = source.magFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function snapshot(object, store) {
  if (!object || store.has(object)) return;
  object.updateMatrixWorld(true);
  store.set(object, {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
    matrixWorld: object.matrixWorld.clone(),
  });
}

function placeCard(card, receiver, caster, poses) {
  const receiverWorld = poses.get(receiver).matrixWorld;
  card.matrix.copy(receiverWorld);
  card.matrix.decompose(card.position, card.quaternion, card.scale);
  card.matrixWorldNeedsUpdate = true;

  const pose = poses.get(caster);
  const saved = {
    position: caster.position.clone(),
    quaternion: caster.quaternion.clone(),
    scale: caster.scale.clone(),
  };
  caster.position.copy(pose.position);
  caster.quaternion.copy(pose.quaternion);
  caster.scale.copy(pose.scale);
  caster.updateMatrixWorld(true);
  caster.attach(card);
  caster.position.copy(saved.position);
  caster.quaternion.copy(saved.quaternion);
  caster.scale.copy(saved.scale);
  caster.updateMatrixWorld(true);
}

export function attachContactShadows({ root, textures, materials }) {
  root.updateMatrixWorld(true);
  const poses = new Map();
  const marks = shadowMarks(root);
  marks.forEach((mark) => {
    snapshot(root.getObjectByName(mark.caster), poses);
    mark.receivers.forEach((name) => snapshot(root.getObjectByName(name), poses));
  });

  const keys = ["First", "Third", "Fourth"];
  return Promise.all(keys.map(async (key) => {
    const day = await imageOf(textures.day[key]);
    const night = await imageOf(textures.night[key]);
    return [key, day, night];
  })).then((loaded) => {
    const images = {};
    const sources = {};
    loaded.forEach(([key, day, night]) => {
      if (!day || !night) return;
      images[key] = { day, night };
      sources[key] = { day: textures.day[key], night: textures.night[key] };
    });
    const sampleFor = (key) => (images[key] ? samplerFromImage(images[key].day) : null);
    const { plans } = buildContactShadowPlans(root, sampleFor, marks, poses);

    const cardMaterials = new Map();
    const materialFor = (key) => {
      let material = cardMaterials.get(key);
      if (material) return material;
      material = materials[key].clone();
      material.uniforms.uMixRatio = materials[key].uniforms.uMixRatio;
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      material.polygonOffsetUnits = -2;
      cardMaterials.set(key, material);
      return material;
    };
    plans.forEach((plan) => materialFor(plan.textureKey));

    const rects = new Map();
    plans.forEach((plan) => {
      if (!rects.has(plan.textureKey)) rects.set(plan.textureKey, []);
      rects.get(plan.textureKey).push(plan.rect);
    });
    rects.forEach((list, key) => {
      const index = SET_INDEX[key];
      materials[key].uniforms[`uDayTexture${index}`].value = paintRects(images[key].day, sources[key].day, list);
      materials[key].uniforms[`uNightTexture${index}`].value = paintRects(images[key].night, sources[key].night, list);
    });

    plans.forEach((plan) => {
      const caster = root.getObjectByName(plan.caster);
      if (!caster || !poses.has(caster) || !poses.has(plan.receiver)) {
        plan.quad.dispose();
        return;
      }
      const card = new THREE.Mesh(plan.quad, materialFor(plan.textureKey));
      card.name = `${plan.id}_Shadow`;
      card.userData.contactShadow = true;
      card.raycast = () => {};
      placeCard(card, plan.receiver, caster, poses);
    });
    return plans.length;
  });
}
