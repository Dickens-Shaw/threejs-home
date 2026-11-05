import * as THREE from "three";

export const LIST_CELL = 2.4;
export const LIST_FIT = 1.7;

const _size = new THREE.Vector3();

export function measureObject(object) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const homeCenter = new THREE.Vector3();

  if (box.isEmpty()) {
    size.set(0.2, 0.2, 0.2);
    object.getWorldPosition(homeCenter);
  } else {
    box.getSize(size);
    box.getCenter(homeCenter);
  }

  const origin = object.getWorldPosition(new THREE.Vector3());

  return {
    size,
    max: Math.max(size.x, size.y, size.z),
    homeCenter,
    centerOffset: homeCenter.clone().sub(origin),
  };
}

// Structural shells stay put. The reference is the compact room that holds the
// furniture, preferring a shell named First. A backdrop several times larger
// than the furniture cluster is not the reference.
export function pickReference(entries) {
  const shells = entries.filter((entry) => entry.part.anchor);
  if (!shells.length) return null;

  const cluster = new THREE.Box3();
  for (const entry of entries) {
    if (entry.part.anchor) continue;
    const half = entry.size.clone().multiplyScalar(0.5);
    cluster.expandByPoint(entry.homeCenter.clone().sub(half));
    cluster.expandByPoint(entry.homeCenter.clone().add(half));
  }

  const clusterMax = cluster.isEmpty()
    ? 0
    : Math.max(cluster.getSize(_size).x, _size.y, _size.z);
  const limit = Math.max(clusterMax * 3, 6);
  const compact = shells.filter((shell) => shell.max <= limit);
  const pool = compact.length ? compact : shells.slice().sort((a, b) => a.max - b.max);

  if (compact.length) {
    return (
      pool.find((shell) => shell.part.id.endsWith("-first")) ||
      pool.slice().sort((a, b) => a.max - b.max)[0]
    );
  }

  return pool[0];
}

export function buildThemeLayout(entries) {
  const reference = pickReference(entries);
  const focus = reference ? reference.homeCenter.clone() : new THREE.Vector3();
  const roomRadius = reference ? reference.max * 0.5 : 2;
  const push = Math.max(roomRadius * 0.95, 0.8);
  const lift = Math.max(roomRadius * 0.18, 0.15);
  const movable = [];

  entries.forEach((entry, index) => {
    entry.explodePosition = entry.homePosition.clone();
    entry.explodedCenter = entry.homeCenter.clone();
    if (entry.part.anchor) return;

    const direction = entry.homeCenter.clone().sub(focus);
    direction.y *= 0.2;

    if (direction.lengthSq() < 1e-4) {
      const angle = (index / Math.max(entries.length, 1)) * Math.PI * 2;
      direction.set(Math.cos(angle), 0.15, Math.sin(angle));
    }

    direction.normalize();
    entry.explodedCenter = entry.homeCenter
      .clone()
      .addScaledVector(direction, push);
    entry.explodedCenter.y = Math.max(
      entry.explodedCenter.y + lift,
      entry.homeCenter.y
    );
    entry.explodeRadius = Math.min(
      Math.max(entry.max * 0.28, 0.08),
      roomRadius * 0.28
    );
    movable.push(entry);
  });

  for (let iteration = 0; iteration < 24; iteration += 1) {
    for (let i = 0; i < movable.length; i += 1) {
      for (let j = i + 1; j < movable.length; j += 1) {
        const a = movable[i];
        const b = movable[j];
        const diff = b.explodedCenter.clone().sub(a.explodedCenter);
        let distance = diff.length();
        const minDistance = a.explodeRadius + b.explodeRadius + 0.08;

        if (distance >= minDistance) continue;

        if (distance < 1e-5) {
          diff.set(((i * 3) % 5) - 2, 0.35, ((j * 5) % 5) - 2);
          distance = diff.length();
        }

        diff.multiplyScalar(1 / distance);
        const gap = (minDistance - distance) * 0.5;
        a.explodedCenter.addScaledVector(diff, -gap);
        b.explodedCenter.addScaledVector(diff, gap);
        a.explodedCenter.y = Math.max(a.explodedCenter.y, a.homeCenter.y);
        b.explodedCenter.y = Math.max(b.explodedCenter.y, b.homeCenter.y);
      }
    }
  }

  for (const entry of movable) {
    entry.explodePosition = entry.explodedCenter.clone().sub(entry.centerOffset);
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const rows = Math.ceil(entries.length / columns);
  const originX = -((columns - 1) * LIST_CELL) / 2;
  const originZ = -((rows - 1) * LIST_CELL) / 2;
  const listY = Math.max(reference ? reference.homeCenter.y : 1.2, 0.8);

  entries.forEach((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const fitted = LIST_FIT / Math.max(entry.max, 0.001);
    const targetCenter = new THREE.Vector3(
      originX + column * LIST_CELL,
      listY,
      originZ + row * LIST_CELL
    );

    entry.listScale = entry.homeScale.clone().multiplyScalar(fitted);
    entry.listPosition = targetCenter.sub(
      entry.centerOffset.clone().multiplyScalar(fitted)
    );
  });

  return { reference, columns, rows, listY, push, lift };
}

export function explodeBounds(entries, referenceId) {
  const box = new THREE.Box3();

  for (const entry of entries) {
    if (entry.part.anchor && entry.part.id !== referenceId) continue;
    const half = entry.size.clone().multiplyScalar(0.5);
    box.expandByPoint(entry.explodedCenter.clone().sub(half));
    box.expandByPoint(entry.explodedCenter.clone().add(half));
  }

  if (!box.isEmpty()) return box;

  for (const entry of entries) {
    const half = entry.size.clone().multiplyScalar(0.5);
    box.expandByPoint(entry.homeCenter.clone().sub(half));
    box.expandByPoint(entry.homeCenter.clone().add(half));
  }

  return box;
}

export function listBounds(columns, rows, listY) {
  const width = (columns - 1) * LIST_CELL + LIST_FIT;
  const depth = (rows - 1) * LIST_CELL + LIST_FIT;

  return new THREE.Box3(
    new THREE.Vector3(-width / 2, listY - LIST_FIT / 2, -depth / 2),
    new THREE.Vector3(width / 2, listY + LIST_FIT / 2, depth / 2)
  );
}

export function frameBounds(box, quaternion, viewport) {
  const center = box.getCenter(new THREE.Vector3());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const delta = new THREE.Vector3(x, y, z).sub(center);
        const px = delta.dot(right);
        const py = delta.dot(up);
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
    }
  }

  const width = Math.max(maxX - minX, 0.4);
  const height = Math.max(maxY - minY, 0.4);
  const zoom = Math.min(
    viewport.width / (width * 1.18),
    viewport.height / (height * 1.18)
  );
  const position = center.clone().addScaledVector(forward, -40);

  return {
    position,
    zoom: THREE.MathUtils.clamp(zoom, 12, 900),
  };
}
