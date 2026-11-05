---
name: baked-object-assembly
description: >-
  Splits a baked Draco GLB diorama into one real object by collecting every
  surface that belongs to it, including contact shadows on other meshes, then
  reassembles those parts under one group while keeping each mesh transform.
  Use when the user asks to 拆分, 组装, 拆出显示器或家具, 阴影归属, 爆炸视图,
  or to extract a monitor body from a baked chunk and join it with its screen.
---

# 从烘焙大块拆出真实物体

一个真实物体等于它的全部面。面可以在大块里的岛上、在另一份小网格上，也可以是烘在别的表面上的接触阴影。组装之后，爆炸和列表移动整个物体；静止时每个面仍在原来的世界位置。

浅色房间的电脑是这套流程的完整例子：外壳从 `Light_Second_Baked` 拆出，屏幕是 `Desktop_Screen`，底座阴影在 `Light_First_Baked` 的桌面贴图上。实现在 `daniels-home-office-portfolio/src/Experience/parts/`。

## 先认物体

用户指的是房间里的一件东西，不是 GLB 节点名。先回答三件事：

1. 哪几份网格在世界空间里和这件东西重合。屏幕经常已经是独立小网格，外壳在另一块烘焙里。
2. 每个网格在场景里的位姿。用 JSX 写在模型上的 `position` / `rotation`，不要用 glTF 节点矩阵再叠一次。
3. 浅色房间的组偏移 `(24.79, 0, 0.173)` 和每个模型上的逆偏移抵消。JSX 局部位姿就是世界位姿。深色房间没有这层偏移。

电脑的对应关系：

| 部位 | 网格 | 位姿 |
| --- | --- | --- |
| 屏幕 | `Light_First.glb` / `Desktop_Screen` | `[24.377, 0.968, -1.548]`，绕 X 转 -90° |
| 外壳 | `Light_Second.glb` / `Light_Second_Baked` | `[26.719, 1.498, 1.614]`，绕 Z 转 -90° |
| 桌面（阴影的接收面） | `Light_First.glb` / `Light_First_Baked` | `[23.66, 1.452, -1.692]`，绕 X 转 -90° |

## 解码

这些 GLB 用 Draco。accessor 没有 `bufferView`，直接读 accessor 会 `KeyError`。用 three 自带的 `draco_wasm_wrapper.js` 加 `draco_decoder.wasm`。wrapper 不是普通 ESM，放进 `vm`，并提供 `require`、`__dirname`。

`new draco.Decoder()`，`DecodeArrayToMesh`，索引用 `GetTrianglesUInt32Array`，属性用 glTF 的 unique id：`GetAttributeByUniqueId`。现成入口是 `daniels-home-office-portfolio/scripts/analyze-components.mjs` 的 `decodePrimitive`。

## 大块拆成岛

对索引做并查集，共享顶点的三角形是一个岛。烘焙网格顶点没有焊在一起，`Light_Second_Baked` 有 55221 个岛、466371 个三角形，最大的岛只有约两千面。岛本身不是家具。

不要用间隙把岛再聚类。支架挨着桌面，4mm 间隙就会把整张桌子并进电脑。

用已知小部件当种子：

1. 把屏幕几何用它自己的矩阵变到世界空间，得到 AABB。
2. 按物体形状扩张。电脑是：X ±0.08m，下方 0.28m（含支架），上方 0.06m，Z ±0.18m。见 `screenVolume`。
3. 每个岛用 8 个角点变到同一空间。留下与这个体积相交、且最大边 ≤ 0.75m 的岛。更大的是桌面、墙或整段家具，留在大块里。
4. 抽出的索引和剩余索引分开。两边三角形数之和必须等于原来的面数。

电脑这次的结果：外壳 717 面，世界尺寸 `0.621 × 0.729 × 0.249`，中心 `(24.443, 1.089, -1.627)`。屏幕的盒子和它相交。其余 465654 面留在第二块结构里。

包围盒只按索引用到的顶点算。抽出的几何如果共享整块的 position，用全部顶点会得到整间房间的盒子，爆炸和选中框都会错。

深色房间用同一套体积去套 `Third_Baked` / `Fourth_Baked`，得到的是 0.69m 的薄板或 1.27m 的家具块，不是一台显示器。尺寸不对就停，不要组装。

## 阴影归谁

接触阴影是接收面贴图上的像素，不是外壳的三角形。归属按谁投下的：底座的影子属于电脑。它留在桌面上时，爆炸后桌面会剩一块黑印。

确认步骤：

1. 找出朝上的大平面。桌面是 `Light_First_Baked` 里两张三角形，世界 Y = 0.726，尺寸约 `2.1 × 0.57`，法线 Y ≈ 1。
2. 只在物体落点里采样烘焙图。电脑落点是 X `24.22–24.55`、Z `-1.72–-1.46`。近黑像素（R、G、B 都小于 55）连成一块才算。
3. 量世界尺寸。这块是 `0.142 × 0.133` m，正在底座正下方。暗区若有一两米，范围划大了，重划。
4. UV 与世界轴对齐。测得核心是 U `0.29553–0.31946`、V `0.84680–0.86926`。glTF 的 V=0 在图片顶部，用 `v * height` 采样，不要翻 V。
5. 黑边会虚开一圈。UV 每边再外扩 0.0022 后，矩形边上的暗像素应为 0，边缘平均色接近桌面 `(191, 177, 161)`。外扩后世界尺寸约 `0.168 × 0.159` m。

把这块做成卡片：

- 四个 UV 角用重心坐标插回桌面三角形的局部顶点。卡片用桌面的 `position` / `rotation`，这样静止时贴在原处。
- 桌面绕 X 转 -90°，局部 +Z 变成世界 +Y。沿局部 Z 抬 `0.0012`，避免和桌面叠在一起闪烁。法线必须朝世界 +Y。
- 卡片用原来的烘焙贴图，只靠这四个 UV 显示阴影。
- 桌面换一张涂掉该矩形的贴图：矩形内每个像素复制矩形外 2 像素处的颜色。电脑移走后，桌面不留黑印。
- `polygonOffset` 让卡片在静止时盖住补过的桌面。

卡片放进电脑这个 Part，和外壳、屏幕一起动。

## 组装

每个部分带着自己的位姿，放进同一个父级。父级本身不加变换。不要把子网格从父级拆下来再单独导出，世界变换会丢。

运行时组装留在场景里：屏幕继续播视频，外壳继续用烘焙材质。`light-computer` 这个 Part 包三块：

- 外壳：`Light_Second` 的位姿，材质是第二块烘焙
- 屏幕：`Desktop_Screen` 的位姿，视频材质
- 阴影卡片：桌面的位姿，第一块的原贴图

导出 GLB 时同样是一个 Group，两个（或三个）子节点各自有 translation / rotation。`GLTFExporter.parse` 用 `binary: true` 和 `trs: true`。Node 里没有 canvas，贴图会先变成巨大的 PNG。导出后把源 GLB 里的 WebP 换回 image buffer，`mimeType` 写 `image/webp`，纹理改走 `EXT_texture_webp`。电脑文件是 `public/models/assembled/light-computer.glb`，约 1.5MB，外壳 792 顶点、717 面，屏幕 5 顶点、3 面。场景仍用运行时组装，因为导出的屏幕没有视频。

## 做完核对

- 外壳面数 + 剩余面数 = 大块原来的面数。
- 外壳世界盒子是这件物体的尺寸，不是整块家具的尺寸。屏幕盒子和它相交。
- 阴影卡片世界 Y 比桌面高约 1mm，法线朝上，水平尺寸是十几厘米。
- 静止时卡片盖住桌面原位；爆炸时卡片、外壳、屏幕一起离开，桌面该处不再是黑的。
- 另一主题用同一体积切出来若超过约 0.75m，或是一张薄板，不要并进去。
