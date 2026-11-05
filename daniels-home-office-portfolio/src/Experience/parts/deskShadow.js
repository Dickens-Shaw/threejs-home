import * as THREE from "three";
import { composeMatrix } from "./splitGeometry.js";

export const DESK_POSITION = [23.66, 1.452, -1.692];
export const DESK_ROTATION = [-Math.PI / 2, 0, 0];

// Measured on the desk texture: the monitor's contact shadow, plus the
// dark fringe around it so the patch includes the whole mark.
const SHADOW_UV = {
  minU: 0.29553 - 0.0022,
  maxU: 0.31946 + 0.0022,
  minV: 0.8468 - 0.0022,
  maxV: 0.86926 + 0.0022,
};

const LIFT = 0.0012;

function pointOnTriangle(geometry, u, v) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!index || !position || !uv) return null;

  const point = new THREE.Vector3();
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
    point.addScaledVector(new THREE.Vector3().fromBufferAttribute(position, ids[1]), w1);
    point.addScaledVector(new THREE.Vector3().fromBufferAttribute(position, ids[2]), w2);
    return point;
  }

  return null;
}

export function shadowQuadGeometry(geometry) {
  const corners = [
    [SHADOW_UV.minU, SHADOW_UV.minV],
    [SHADOW_UV.maxU, SHADOW_UV.minV],
    [SHADOW_UV.maxU, SHADOW_UV.maxV],
    [SHADOW_UV.minU, SHADOW_UV.maxV],
  ];
  const positions = [];
  corners.forEach(([u, v]) => {
    const point = pointOnTriangle(geometry, u, v);
    if (!point) return;
    positions.push(point.x, point.y, point.z + LIFT);
  });
  if (positions.length !== 12) return null;

  const quad = new THREE.BufferGeometry();
  quad.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  quad.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      corners.flatMap(([u, v]) => [u, v]),
      2
    )
  );
  quad.setIndex([0, 1, 2, 0, 2, 3]);

  const matrix = composeMatrix(DESK_POSITION, DESK_ROTATION);
  const edgeA = new THREE.Vector3(positions[3], positions[4], positions[5]).sub(
    new THREE.Vector3(positions[0], positions[1], positions[2])
  );
  const edgeB = new THREE.Vector3(positions[6], positions[7], positions[8]).sub(
    new THREE.Vector3(positions[0], positions[1], positions[2])
  );
  const normal = edgeA.cross(edgeB).transformDirection(matrix);
  if (normal.y < 0) quad.setIndex([0, 2, 1, 0, 3, 2]);
  quad.computeVertexNormals();
  quad.computeBoundingSphere();
  return quad;
}

function paintRect(image, source) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);

  const x0 = Math.max(0, Math.floor(SHADOW_UV.minU * canvas.width));
  const y0 = Math.max(0, Math.floor(SHADOW_UV.minV * canvas.height));
  const x1 = Math.min(canvas.width, Math.ceil(SHADOW_UV.maxU * canvas.width));
  const y1 = Math.min(canvas.height, Math.ceil(SHADOW_UV.maxV * canvas.height));
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;

  const outside = (x, y) => {
    const clampedX = Math.max(0, Math.min(canvas.width - 1, x));
    const clampedY = Math.max(0, Math.min(canvas.height - 1, y));
    const offset = (clampedY * canvas.width + clampedX) * 4;
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  };

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const left = x - x0;
      const right = x1 - 1 - x;
      const up = y - y0;
      const down = y1 - 1 - y;
      const nearest = Math.min(left, right, up, down);
      let sample;
      if (nearest === left) sample = outside(x0 - 2, y);
      else if (nearest === right) sample = outside(x1 + 1, y);
      else if (nearest === up) sample = outside(x, y0 - 2);
      else sample = outside(x, y1 + 1);
      const offset = (y * canvas.width + x) * 4;
      data[offset] = sample[0];
      data[offset + 1] = sample[1];
      data[offset + 2] = sample[2];
      data[offset + 3] = sample[3];
    }
  }

  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = source.colorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.anisotropy = source.anisotropy;
  texture.needsUpdate = true;
  return texture;
}

const cache = new Map();

export function createDeskShadow(geometry, sourceMap) {
  const cached = cache.get(geometry.uuid);
  if (cached) return cached;

  const quad = shadowQuadGeometry(geometry);
  const cleanedMap =
    quad && sourceMap?.image && typeof document !== "undefined"
      ? paintRect(sourceMap.image, sourceMap)
      : null;
  const result = { geometry: quad, cleanedMap, sourceMap };
  cache.set(geometry.uuid, result);
  return result;
}
