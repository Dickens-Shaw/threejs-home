import * as THREE from "three";
import {
  componentsOf,
  decodePrimitive,
  decoderPromise,
  parseGlb,
} from "./analyze-components.mjs";

const file = process.argv[2];
const nearOnly = process.argv.includes("near");
const gaps = (process.argv[3] || "0.004,0.012,0.03,0.06")
  .split(",")
  .map(Number);

const SCREEN_BOXES = [
  {
    name: "Desktop_Screen",
    min: [24.377 - 0.223, 0.968 - 0.118, -1.548 - 0.012],
    max: [24.377 + 0.223, 0.968 + 0.118, -1.548 + 0.012],
  },
  {
    name: "iPhone_Screen",
    min: [23.994 - 0.07, 0.734 - 0.01, -1.338 - 0.09],
    max: [23.994 + 0.07, 0.734 + 0.01, -1.338 + 0.09],
  },
  {
    name: "Mac_Screen",
    min: [-1.05, 0.7, 0.5],
    max: [-0.65, 1.05, 0.9],
  },
  {
    name: "Computer_Screen",
    min: [-0.55, 0.75, 0.4],
    max: [-0.05, 1.2, 0.9],
  },
];

const TRANSFORMS = {
  iPhone_Screen: {
    position: [23.994, 0.734, -1.338],
    rotation: [0, -1.193, Math.PI / 2],
  },
  Desktop_Screen: {
    position: [24.377, 0.968, -1.548],
    rotation: [-Math.PI / 2, 0, 0],
  },
  Light_First_Baked: {
    position: [23.66, 1.452, -1.692],
    rotation: [-Math.PI / 2, 0, 0],
  },
  Mac_Screen: {
    position: [-0.861, 0.795, 0.684],
    rotation: [0, 0.523, 0],
  },
  Computer_Screen: {
    position: [-0.302, 0.935, 0.647],
    rotation: [0, -0.053, 0],
  },
  First_Baked: {
    position: [-0.231, -0.16, 0.652],
    rotation: [Math.PI, 0, Math.PI],
  },
  Second_Baked: {
    position: [0.053, -0.02, 0.341],
    rotation: [Math.PI, 0, Math.PI],
  },
  Floor_Vaccum_Third_Baked: {
    position: [1.371, -0.02, -0.354],
    rotation: [Math.PI, 0, Math.PI],
    scale: 1.015,
  },
  Third_Baked: {
    position: [-0.819, 0.726, 1.115],
    rotation: [Math.PI / 2, 0, 0.47],
  },
  Fan_Third_Baked: {
    position: [0.247, 0.931, 0.524],
    rotation: [Math.PI / 2, 0, 0.47],
  },
  Fourth_Baked: {
    position: [-0.356, -0.02, 1.362],
    rotation: [Math.PI, 0, Math.PI],
  },
  Chair_Top_Fourth_Baked: {
    position: [-0.373, 0.715, 1.304],
    rotation: [Math.PI, -0.121, Math.PI],
  },
  Light_Second_Baked: {
    position: [26.719, 1.498, 1.614],
    rotation: [0, 0, -Math.PI / 2],
  },
  Light_Third_Baked: {
    position: [24.79, -0.201, 0.173],
    rotation: [0, 0, 0],
  },
  Light_Fourth_Baked: {
    position: [26.632, -0.17, -1.134],
    rotation: [Math.PI, 0, Math.PI],
  },
};

const corner = new THREE.Vector3();

function matrixFor(name) {
  const transform = TRANSFORMS[name] || {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
  const scale = transform.scale ?? 1;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...transform.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation)),
    new THREE.Vector3(scale, scale, scale)
  );
}

function worldBox(min, max, matrix) {
  const box = new THREE.Box3();
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        box.expandByPoint(corner.set(x, y, z).applyMatrix4(matrix));
      }
    }
  }
  return box;
}

function gapBetween(a, b) {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}

function clusterBoxes(boxes, gap) {
  const count = boxes.length;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;

  function find(index) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }

  function union(a, b) {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  }

  const cellSize = Math.max(gap, 0.05);
  const grid = new Map();

  for (let i = 0; i < count; i++) {
    const box = boxes[i];
    const i0 = Math.floor((box.min.x - gap) / cellSize);
    const j0 = Math.floor((box.min.y - gap) / cellSize);
    const k0 = Math.floor((box.min.z - gap) / cellSize);
    const i1 = Math.floor((box.max.x + gap) / cellSize);
    const j1 = Math.floor((box.max.y + gap) / cellSize);
    const k1 = Math.floor((box.max.z + gap) / cellSize);
    const span = (i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1);
    if (span > 4000) continue;

    const seen = new Set();
    for (let ix = i0; ix <= i1; ix++) {
      for (let iy = j0; iy <= j1; iy++) {
        for (let iz = k0; iz <= k1; iz++) {
          const key = `${ix},${iy},${iz}`;
          const bucket = grid.get(key);
          if (!bucket) continue;
          for (const other of bucket) {
            if (seen.has(other)) continue;
            seen.add(other);
            if (gapBetween(box, boxes[other]) <= gap) union(i, other);
          }
        }
      }
    }

    for (let ix = i0; ix <= i1; ix++) {
      for (let iy = j0; iy <= j1; iy++) {
        for (let iz = k0; iz <= k1; iz++) {
          const key = `${ix},${iy},${iz}`;
          let bucket = grid.get(key);
          if (!bucket) {
            bucket = [];
            grid.set(key, bucket);
          }
          bucket.push(i);
        }
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    let group = groups.get(root);
    if (!group) {
      group = { tris: 0, members: 0, box: new THREE.Box3() };
      groups.set(root, group);
    }
    group.tris += boxes[i].tris;
    group.members += 1;
    group.box.union(boxes[i]);
  }

  return [...groups.values()].sort((a, b) => b.tris - a.tris);
}

function describe(box) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return `size=${size.toArray().map((v) => v.toFixed(2)).join(",")} center=${center
    .toArray()
    .map((v) => v.toFixed(2))
    .join(",")}`;
}

const draco = await decoderPromise;
const { json, bin } = parseGlb(file);
const decodedNodes = [];

if (nearOnly) {
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    const primitive = json.meshes[node.mesh].primitives[0];
    const decoded = decodePrimitive(draco, json, bin, primitive);
    const matrix = matrixFor(node.name);
    const position = decoded.position;
    console.log(`\n${node.name} points=${decoded.numPoints}`);
    for (const screen of SCREEN_BOXES) {
      const box = new THREE.Box3(
        new THREE.Vector3(...screen.min),
        new THREE.Vector3(...screen.max)
      );
      let nearest = Infinity;
      let count = 0;
      for (let i = 0; i < position.length; i += 3) {
        corner.set(position[i], position[i + 1], position[i + 2]).applyMatrix4(matrix);
        const distance = distanceToBox(corner, box);
        if (distance < nearest) nearest = distance;
        if (distance <= 0.2) count += 1;
      }
      console.log(
        `  ${screen.name}: nearest=${nearest.toFixed(4)} within20cm=${count}`
      );
    }
  }
  process.exit(0);
}

for (const node of json.nodes) {
  if (node.mesh === undefined) continue;
  const primitive = json.meshes[node.mesh].primitives[0];
  const decoded = decodePrimitive(draco, json, bin, primitive);
  const islands = componentsOf(decoded.index, decoded.position);
  const matrix = matrixFor(node.name);
  const boxes = islands.map((island) => {
    const box = worldBox(island.min, island.max, matrix);
    box.tris = island.tris;
    return box;
  });
  const whole = new THREE.Box3();
  boxes.forEach((box) => whole.union(box));
  decodedNodes.push({
    name: node.name,
    boxes,
    whole,
    tris: decoded.numFaces,
    decoded,
    translation: node.translation,
    rotation: node.rotation,
    scale: node.scale,
  });
  console.log(
    `${node.name}: islands=${boxes.length} tris=${decoded.numFaces} ${describe(whole)}`
  );
  console.log(
    `  gltf t=${JSON.stringify(node.translation)} r=${JSON.stringify(node.rotation)} s=${JSON.stringify(node.scale)}`
  );
}

const screens = decodedNodes.filter((node) => node.name.includes("Screen"));
const baked = decodedNodes.filter((node) => !node.name.includes("Screen"));

for (const screen of SCREEN_BOXES) {
  const screenBox = new THREE.Box3(
    new THREE.Vector3(...screen.min),
    new THREE.Vector3(...screen.max)
  );
  const volume = screenBox.clone();
  volume.min.x -= 0.08;
  volume.max.x += 0.08;
  volume.min.y -= 0.28;
  volume.max.y += 0.06;
  volume.min.z -= 0.18;
  volume.max.z += 0.18;
  const kept = [];
  let rejected = 0;
  for (const mesh of baked) {
    for (const island of mesh.boxes) {
      if (gapBetween(island, volume) > 0) continue;
      const size = island.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) > 0.75) {
        rejected += 1;
        continue;
      }
      kept.push(island);
    }
  }
  const keptBox = new THREE.Box3();
  let tris = 0;
  kept.forEach((island) => {
    keptBox.union(island);
    tris += island.tris;
  });
  console.log(
    `\nexternal ${screen.name}: kept=${kept.length} tris=${tris} rejectedLarge=${rejected} ${keptBox.isEmpty() ? "empty" : describe(keptBox)}`
  );
  kept
    .slice()
    .sort((a, b) => b.tris - a.tris)
    .slice(0, 8)
    .forEach((island) => console.log(`  tris=${island.tris} ${describe(island)}`));
}

function distanceToBox(point, box) {
  const dx = Math.max(0, box.min.x - point.x, point.x - box.max.x);
  const dy = Math.max(0, box.min.y - point.y, point.y - box.max.y);
  const dz = Math.max(0, box.min.z - point.z, point.z - box.max.z);
  return Math.hypot(dx, dy, dz);
}

for (const screen of screens) {
  for (const mesh of baked) {
    const matrix = matrixFor(mesh.name);
    const position = mesh.decoded.position;
    const bins = [0.02, 0.05, 0.1, 0.2, 0.4];
    const counts = bins.map(() => 0);
    let nearest = Infinity;
    let nearestAt = null;
    for (let i = 0; i < position.length; i += 9) {
      corner.set(position[i], position[i + 1], position[i + 2]).applyMatrix4(matrix);
      const distance = distanceToBox(corner, screen.whole);
      if (distance < nearest) {
        nearest = distance;
        nearestAt = corner.clone();
      }
      bins.forEach((limit, index) => {
        if (distance <= limit) counts[index] += 1;
      });
    }
    console.log(
      `samples near ${screen.name} from ${mesh.name}: nearest=${nearest.toFixed(4)} at ${nearestAt.toArray().map((v) => v.toFixed(3)).join(",")} counts=${counts.join(",")}`
    );
  }
}

function overlapsVolume(box, volume) {
  return gapBetween(box, volume) <= 0;
}

for (const screen of screens) {
  const volume = screen.whole.clone();
  volume.min.x -= 0.12;
  volume.max.x += 0.12;
  volume.min.y -= 0.35;
  volume.max.y += 0.08;
  volume.min.z -= 0.2;
  volume.max.z += 0.2;
  console.log(`\n== monitor volume ${screen.name} ${describe(volume)} ==`);
  const kept = [];
  const rejected = [];
  for (const mesh of baked) {
    for (const island of mesh.boxes) {
      if (!overlapsVolume(island, volume)) continue;
      const size = island.getSize(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z);
      if (max > 0.7) rejected.push(island);
      else kept.push(island);
    }
  }
  const keptBox = new THREE.Box3();
  let tris = 0;
  kept.forEach((island) => {
    keptBox.union(island);
    tris += island.tris;
  });
  console.log(
    `kept=${kept.length} tris=${tris} ${keptBox.isEmpty() ? "empty" : describe(keptBox)} rejectedLarge=${rejected.length}`
  );
  kept
    .slice()
    .sort((a, b) => b.tris - a.tris)
    .slice(0, 12)
    .forEach((island) => {
      console.log(`  tris=${String(island.tris).padStart(6)} ${describe(island)}`);
    });
}

for (const screen of screens) {
  console.log(`\n== shell around ${screen.name} ==`);
  for (const margin of [0.02, 0.04, 0.06, 0.1, 0.16, 0.25]) {
    const shell = screen.whole.clone().expandByScalar(margin);
    let tris = 0;
    let members = 0;
    const box = new THREE.Box3();
    for (const mesh of baked) {
      for (const island of mesh.boxes) {
        if (gapBetween(island, shell) > 0) continue;
        tris += island.tris;
        members += 1;
        box.union(island);
      }
    }
    console.log(
      `  margin=${margin.toFixed(2)} members=${String(members).padStart(5)} tris=${String(tris).padStart(7)} ${box.isEmpty() ? "empty" : describe(box)}`
    );
  }
}

for (const gap of gaps.filter((gap) => Number.isFinite(gap))) {
  console.log(`\n== gap ${gap}m ==`);
  for (const mesh of baked) {
    const clusters = clusterBoxes(mesh.boxes, gap);
    const substantial = clusters.filter((cluster) => {
      const size = cluster.box.getSize(new THREE.Vector3());
      return Math.max(size.x, size.y, size.z) >= 0.08 || cluster.tris >= 80;
    });
    console.log(
      `${mesh.name}: clusters=${clusters.length} substantial=${substantial.length}`
    );
    for (const cluster of substantial.slice(0, 8)) {
      console.log(
        `  members=${String(cluster.members).padStart(5)} tris=${String(cluster.tris).padStart(7)} ${describe(cluster.box)}`
      );
    }

    for (const screen of screens) {
      const screenBox = screen.whole.clone();
      const hits = clusters
        .filter((cluster) => gapBetween(cluster.box, screenBox) <= gap)
        .sort((a, b) => gapBetween(a.box, screenBox) - gapBetween(b.box, screenBox));
      const nearest = clusters
        .map((cluster) => ({ cluster, distance: gapBetween(cluster.box, screenBox) }))
        .sort((a, b) => a.distance - b.distance)[0];
      console.log(
        `  near ${screen.name}: hits=${hits.length} nearest=${nearest.distance.toFixed(3)}m ${describe(nearest.cluster.box)} tris=${nearest.cluster.tris} members=${nearest.cluster.members}`
      );
    }
  }
}
