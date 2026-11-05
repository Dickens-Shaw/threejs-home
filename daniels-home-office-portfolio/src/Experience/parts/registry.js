const parts = new Map();

export function registerPart(id, object) {
  parts.set(id, object);
}

export function unregisterPart(id) {
  parts.delete(id);
}

export function getPart(id) {
  return parts.get(id);
}

export function hasPart(id) {
  return parts.has(id);
}
