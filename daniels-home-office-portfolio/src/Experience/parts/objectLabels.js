const POINTS = [
  { theme: "dark", label: "金属钟", kind: "摆件", at: [-1.06, 1.83, -1.42], radius: 0.22 },
  { theme: "dark", id: "dark-laptop", label: "笔记本", kind: "家具", at: [-0.81, 0.79, 0.78], radius: 0.2 },
  { theme: "dark", id: "dark-monitor", label: "显示器", kind: "家具", at: [-0.31, 0.79, 0.57], radius: 0.2 },
  { theme: "dark", id: "dark-monitor", label: "显示器", kind: "家具", at: [0.01, 0.93, 0.68], radius: 0.16 },
  { theme: "dark", id: "dark-monitor", label: "显示器", kind: "家具", at: [-0.62, 0.93, 0.65], radius: 0.16 },
  { theme: "dark", label: "风扇座", kind: "家具", at: [0.26, 0.84, 0.49], radius: 0.18 },
  { theme: "dark", label: "墙面画", kind: "装饰", at: [1.11, 1.74, -1.5], radius: 0.25 },
  { theme: "dark", label: "角落植物", kind: "植物", at: [0.79, 0.43, -1.16], radius: 0.35 },
  { theme: "dark", label: "鼠标垫", kind: "摆件", at: [-0.51, 0.69, 0.58], radius: 0.16 },
  { theme: "dark", label: "鼠标垫", kind: "摆件", at: [-0.11, 0.69, 0.61], radius: 0.16 },
  { theme: "dark", label: "显示器边框", kind: "家具", at: [0.01, 0.93, 0.68], radius: 0.16 },
  { theme: "dark", label: "显示器边框", kind: "家具", at: [-0.62, 0.93, 0.65], radius: 0.16 },
  { theme: "light", label: "键盘", kind: "摆件", at: [24.95, 0.75, -1.5], radius: 0.16 },
  { theme: "light", label: "鼠标", kind: "摆件", at: [24.75, 0.78, -1.44], radius: 0.12 },
  { theme: "light", label: "大幅挂画", kind: "装饰", at: [23.4, 2.08, -1.65], radius: 0.2 },
  { theme: "light", label: "挂画", kind: "装饰", at: [23.67, 2.06, -1.64], radius: 0.16 },
  { theme: "light", label: "小画", kind: "装饰", at: [23.74, 1.79, -1.63], radius: 0.14 },
  { theme: "light", label: "桌面收纳", kind: "摆件", at: [25.27, 0.86, -1.54], radius: 0.16 },
  { theme: "light", label: "笔筒", kind: "摆件", at: [23.99, 0.8, -1.56], radius: 0.12 },
];

function fallback(theme, center) {
  const [x, y, z] = center;

  if (theme === "dark") {
    if (x > 1.45) {
      if (y > 1.65) return ["上层摆件", "摆件"];
      if (y > 0.95) return ["中层摆件", "摆件"];
      return ["下层摆件", "摆件"];
    }
    if (y > 1.4 && x < -0.7) return ["墙面装饰", "装饰"];
    if (y > 0.65 && z > 0.3 && z < 1.15 && x < 0.7) return ["桌面物件", "摆件"];
    if (y < 0.45) return ["地面物件", "家具"];
    return ["房间物件", "摆件"];
  }

  if (y > 1.45 && z < -1.35 && x < 24.6) return ["墙面装饰", "装饰"];
  if (y > 1.05 && x > 25.8) return ["架上摆件", "摆件"];
  if (y > 0.65 && y < 1.15 && z < -1.15 && x < 25.7) return ["桌面物件", "摆件"];
  if (y < 0.45) return ["地面物件", "家具"];
  return ["房间物件", "摆件"];
}

export function labelClusters(theme, objects) {
  const used = new Set();
  const counts = new Map();
  const ids = new Set(objects.map((object) => object.id).filter(Boolean));
  const ordered = objects
    .map((object, index) => ({ object, index }))
    .sort((a, b) => b.object.triangles - a.object.triangles);

  for (const { object } of ordered) {
    if (object.id) continue;
    let best = null;
    let bestDistance = Infinity;
    for (const point of POINTS) {
      if (point.theme !== theme || used.has(point)) continue;
      const distance = Math.hypot(
        object.center[0] - point.at[0],
        object.center[1] - point.at[1],
        object.center[2] - point.at[2]
      );
      if (distance <= point.radius && distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }

    let label;
    let kind;
    if (best) {
      used.add(best);
      label = best.label;
      kind = best.kind;
      if (best.id) {
        object.id = best.id;
        object.label = label;
        object.kind = kind;
        continue;
      }
    } else {
      [label, kind] = fallback(theme, object.center);
    }

    const count = (counts.get(label) || 0) + 1;
    counts.set(label, count);
    object.label = count > 1 ? `${label} ${count}` : label;
    object.kind = kind;
    let id = `${theme}-${object.center.map((value) => value.toFixed(1)).join("-")}`;
    while (ids.has(id)) id = `${id}-b`;
    ids.add(id);
    object.id = id;
  }
}
