import {
  composeMatrix,
  geometryWithIndex,
  screenVolume,
  splitMeshByVolume,
} from "./splitGeometry.js";

export const DESKTOP_POSITION = [24.377, 0.968, -1.548];
export const DESKTOP_ROTATION = [-Math.PI / 2, 0, 0];
export const SECOND_POSITION = [26.719, 1.498, 1.614];
export const SECOND_ROTATION = [0, 0, -Math.PI / 2];

const cache = new Map();

export function buildLightComputer(bakedGeometry, screenGeometry) {
  const cached = cache.get(bakedGeometry.uuid);
  if (cached) return cached;

  const bakedMatrix = composeMatrix(SECOND_POSITION, SECOND_ROTATION);
  const screenMatrix = composeMatrix(DESKTOP_POSITION, DESKTOP_ROTATION);
  const volume = screenVolume(screenGeometry, screenMatrix);
  const split = splitMeshByVolume(bakedGeometry, bakedMatrix, volume, 0.75);

  const result = {
    monitor: geometryWithIndex(bakedGeometry, split.monitor),
    rest: geometryWithIndex(bakedGeometry, split.rest),
    monitorTriangles: split.monitorTriangles,
  };
  cache.set(bakedGeometry.uuid, result);
  return result;
}
