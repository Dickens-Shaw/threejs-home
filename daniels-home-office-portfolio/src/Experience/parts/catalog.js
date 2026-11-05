export const PARTS = [
  {
    id: "dark-mac-screen",
    theme: "dark",
    label: "Mac 屏幕",
    kind: "屏幕",
    file: "Dark_First.glb",
    chunk: "first",
  },
  {
    id: "dark-computer-screen",
    theme: "dark",
    label: "电脑屏幕",
    kind: "屏幕",
    file: "Dark_First.glb",
    chunk: "first",
  },
  {
    id: "dark-first",
    theme: "dark",
    label: "第一块地面",
    kind: "地面",
    file: "Dark_First.glb",
    chunk: "first",
    anchor: true,
  },
  {
    id: "dark-second",
    theme: "dark",
    label: "第二块结构",
    kind: "结构",
    file: "Dark_Second.glb",
    chunk: "second",
    anchor: true,
  },
  {
    id: "dark-vacuum",
    theme: "dark",
    label: "吸尘器",
    kind: "家具",
    file: "Dark_Third.glb",
    chunk: "third",
  },
  {
    id: "dark-third",
    theme: "dark",
    label: "第三块结构",
    kind: "结构",
    file: "Dark_Third.glb",
    chunk: "third",
    anchor: true,
  },
  {
    id: "dark-fan",
    theme: "dark",
    label: "风扇",
    kind: "家具",
    file: "Dark_Third.glb",
    chunk: "third",
  },
  {
    id: "dark-fourth",
    theme: "dark",
    label: "第四块结构",
    kind: "结构",
    file: "Dark_Fourth.glb",
    chunk: "fourth",
    anchor: true,
  },
  {
    id: "dark-chair",
    theme: "dark",
    label: "椅背",
    kind: "家具",
    file: "Dark_Fourth.glb",
    chunk: "fourth",
  },
  {
    id: "light-iphone-screen",
    theme: "light",
    label: "iPhone 屏幕",
    kind: "屏幕",
    file: "Light_First.glb",
    chunk: "first",
  },
  {
    id: "light-computer",
    theme: "light",
    label: "电脑",
    kind: "家具",
    file: "显示器 + 屏幕",
    chunk: "other",
  },
  {
    id: "light-first",
    theme: "light",
    label: "第一块结构",
    kind: "结构",
    file: "Light_First.glb",
    chunk: "first",
    anchor: true,
  },
  {
    id: "light-second",
    theme: "light",
    label: "第二块结构",
    kind: "结构",
    file: "Light_Second.glb",
    chunk: "second",
    anchor: true,
  },
  {
    id: "light-third",
    theme: "light",
    label: "第三块结构",
    kind: "结构",
    file: "Light_Third.glb",
    chunk: "third",
    anchor: true,
  },
  {
    id: "light-fourth",
    theme: "light",
    label: "第四块地面",
    kind: "地面",
    file: "Light_Fourth.glb",
    chunk: "fourth",
    anchor: true,
  },
];

export const CHUNKS = [
  { id: "first", title: "第一块" },
  { id: "second", title: "第二块" },
  { id: "third", title: "第三块" },
  { id: "fourth", title: "第四块" },
  { id: "other", title: "其他" },
];

export function partsByTheme(theme) {
  return PARTS.filter((part) => part.theme === theme);
}

export function detailLine(part, triangles) {
  const faces =
    typeof triangles === "number"
      ? `${triangles.toLocaleString("en-US")} 面`
      : "";

  return [part.kind, part.anchor ? "不位移" : "", part.file, faces]
    .filter(Boolean)
    .join(" · ");
}
