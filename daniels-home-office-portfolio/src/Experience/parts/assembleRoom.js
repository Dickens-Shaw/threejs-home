import { composeMatrix } from "./splitGeometry.js";
import { extractMesh } from "./splitObjects.js";
import { OBJECT_VOLUMES } from "./objectVolumes.js";
import { labelClusters } from "./objectLabels.js";
import { ensurePart } from "./catalog.js";

const cache = new Map();

function register(theme, object) {
  ensurePart({
    id: object.id,
    theme,
    label: object.label,
    kind: object.kind,
    file: object.file,
    chunk: object.chunk,
  });
}

export function assembleRoom(theme, meshes) {
  const key = `${theme}:${meshes.map((mesh) => mesh.geometry.uuid).join("|")}`;
  const cached = cache.get(key);
  if (cached) {
    cached.objects.forEach((object) => register(theme, object));
    return cached;
  }

  const shells = [];
  const pending = [];

  for (const mesh of meshes) {
    const matrix = composeMatrix(mesh.position, mesh.rotation);
    const split = extractMesh(mesh.geometry, matrix, OBJECT_VOLUMES[theme]);
    if (!split) continue;
    const sum = split.claimedTriangles + split.restTriangles;
    if (sum !== split.sourceTriangles) {
      console.warn(`${mesh.shellId} lost faces`, split.sourceTriangles, sum);
    }

    if (split.rest) {
      shells.push({
        id: mesh.shellId,
        geometry: split.rest,
        material: mesh.material,
        position: mesh.position,
        rotation: mesh.rotation,
      });
    }

    for (const object of split.objects) {
      pending.push({
        ...object,
        file: mesh.file,
        chunk: mesh.chunk,
        mesh: {
          geometry: object.geometry,
          material: mesh.material,
          position: mesh.position,
          rotation: mesh.rotation,
          triangles: object.triangles,
        },
      });
    }
  }

  labelClusters(theme, pending);

  const grouped = new Map();
  for (const object of pending) {
    let group = grouped.get(object.id);
    if (!group) {
      group = {
        id: object.id,
        label: object.label,
        kind: object.kind,
        file: object.file,
        chunk: object.chunk,
        triangles: 0,
        meshes: [],
      };
      grouped.set(object.id, group);
    }
    group.triangles += object.triangles;
    group.meshes.push(object.mesh);
    if (object.triangles > (group.leadTriangles || 0)) {
      group.file = object.file;
      group.chunk = object.chunk;
      group.leadTriangles = object.triangles;
    }
  }

  const objects = [...grouped.values()];
  objects.forEach((object) => register(theme, object));
  const result = { shells, objects };
  cache.set(key, result);
  return result;
}
