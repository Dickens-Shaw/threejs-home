# 户型与装修设计

本仓库放了可以在浏览器里打开的户型工具，来源不同，互不替代。

| 目录 | 是什么 | 来源 |
| --- | --- | --- |
| [`floorplan-3d/`](floorplan-3d/) | 可继续修改的户型编辑器：SVG 平面、Three.js 三维、房间装修、家具预览 | 基于 [wy51ai/floorplan-3d](https://github.com/wy51ai/floorplan-3d) |
| [`esports-room/`](esports-room/) | 电竞屋搭建：三间预设房间和桌面设备，平面与三维同一套编辑器 | 从 `floorplan-3d` 分出来的独立页面 |
| [`house-plan-designer/`](house-plan-designer/) | 由户型图生成的单文件装修设计器，以及这次生成用的 spec、脚本和验收记录 | 基于本仓库的 [house-plan-designer skill](.cursor/skills/house-plan-designer/SKILL.md) |

`demo/` 是单独的智能客厅演示，不属于上面两套。

## 来源声明

**`floorplan-3d` 基于 [https://github.com/wy51ai/floorplan-3d](https://github.com/wy51ai/floorplan-3d)。**

上游是纯前端户型装修工具，MIT 许可，Copyright (c) 2026 wuyi。上游仓库把应用放在一个 `index.html` 里。本目录在此基础上拆成 `index.html` 与 `js/`（`plan.js`、`editor.js`、`view3d.js`、`furniture.js`、`pack-prompt.js`、`furn-prompt.js`），并增加户型库、户型编辑 / 房间装修 / 家具预览三种会话，以及用 JSON 导入识图结果的协议。功能说明仍见 [floorplan-3d/README.md](floorplan-3d/README.md) 与 [floorplan-3d/README.en.md](floorplan-3d/README.en.md)。许可原文在 [floorplan-3d/LICENSE](floorplan-3d/LICENSE)。

**`house-plan-designer` 基于本仓库的 skill：`.cursor/skills/house-plan-designer`。**

这个 skill 按 [SKILL.md](.cursor/skills/house-plan-designer/SKILL.md) 工作：读户型图或 CAD，写出 HouseSpec，再用 `scripts/build.py` 把 spec 注入 `assets/template.html`，得到双击可开的单文件 HTML。本目录里的 `spec.json`、`gen.py`、`check.html`、`analysis/`、`check/`、`qa/`、`audit/` 都是按这条流程，为贝壳「三室一厅一卫」户型图生成的结果。`floorplan-3d/三室一厅-装修设计器.html` 与 `house-plan-designer/check.html` 是同一次注入的产物，属于设计器，不属于 wy51ai 的编辑器源码。

该 skill 自身（含模板和脚本）来自 [ZWD11/house-plan-designer](https://github.com/ZWD11/house-plan-designer)，MIT 许可，Copyright (c) 2026 ZWD11。skill 说明见 [.cursor/skills/house-plan-designer/README.md](.cursor/skills/house-plan-designer/README.md)，许可原文在 [.cursor/skills/house-plan-designer/LICENSE](.cursor/skills/house-plan-designer/LICENSE)。模板由上游设计器打包而来；按 skill 的约定，不在本仓库里改 `assets/template.html`。设计器功能有变时，在上游项目执行 `npm run skill:sync`，再同步到本 skill。

## floorplan-3d

在浏览器里画墙、放门窗和飘窗、摆家具，再切到三维鸟瞰或漫游。数据单位是毫米，墙记录中线，保存在浏览器 `localStorage`。

```bash
cd floorplan-3d
npm install
npm run dev
```

打开 `http://localhost:5183`。改 `js/` 或页面后浏览器会自动刷新。三维用依赖里的 Three.js r160。

主要文件：

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面、样式、脚本入口 |
| `js/plan.js` | 户型数据、房间算法、撤销与本地存储 |
| `js/editor.js` | 平面交互、户型库、导入导出 |
| `js/view3d.js` | Three.js 场景、漫游、家具网格 |
| `js/furniture.js` | 家具的二维图例 |
| `js/pack-prompt.js` | 让外部模型输出 `huxing-pack` JSON 的提示词 |
| `js/furn-prompt.js` | 自定义家具零件的提示词 |

改交互和模型，改 `js/`。户型可以在界面里画，也可以按 `pack-prompt.js` 的格式导入 JSON。

## esports-room

电竞屋单独放在 [`esports-room/`](esports-room/)，不进住宅户型编辑器。三间预设是紧凑单人、标准电竞房、客厅电竞角。显示器、音箱、麦克风和灯带按桌面高度来画，叠在桌子上。存档键是 `esports-plans-v1`，和户型编辑器分开。模型是程序画的。

```bash
cd esports-room
npm install
npm run dev
```

打开 `http://localhost:5184`。改 `js/` 或页面后浏览器会自动刷新。和户型编辑器可以同时开着。

## house-plan-designer

打开 [`house-plan-designer/check.html`](house-plan-designer/check.html) 即可使用已生成的「三室一厅一卫」设计器。文件内嵌户型、底图和三维运行时，离线可用。界面包含二维平面、分屏、三维漫游，以及布置、水电、顶面、铺装、拆改图层，并可导出报价、DXF 和施工图。

重新生成这一份 HTML：

```bash
python .cursor/skills/house-plan-designer/scripts/build.py \
  house-plan-designer/spec.json \
  -o house-plan-designer/check.html
```

几何和尺寸自查、全功能验收：

```bash
node .cursor/skills/house-plan-designer/scripts/check.mjs \
  house-plan-designer/check.html house-plan-designer/check

node .cursor/skills/house-plan-designer/scripts/qa.mjs \
  house-plan-designer/check.html house-plan-designer/qa --lite --quick
```

skill 的 Python 依赖：`numpy`、`pillow`、`opencv-python`、`pymupdf`、`ezdxf`、`pypdf`。验收脚本在 skill 的 `scripts/` 下执行 `npm install`（只安装 `puppeteer-core`），浏览器由 `scripts/browser.mjs` 查找本机 Chrome / Edge / Chromium。

换一张图时，按 skill 重写 spec 和生成脚本，不要手改 `check.html`，也不要改模板。HouseSpec 字段见 [.cursor/skills/house-plan-designer/reference/spec-format.md](.cursor/skills/house-plan-designer/reference/spec-format.md)。

本目录里和这次户型有关的文件：

| 文件 | 作用 |
| --- | --- |
| `gen.py` | 按贝壳户型图的尺寸链写出 spec |
| `spec.json` | HouseSpec |
| `check.html` | 注入模板后的设计器 |
| `analysis/`、`analysis2/` | 识图草稿 |
| `check/` | 结构自查报告 |
| `qa/`、`qa-furn/`、`qa-walk/` | 界面验收和导出文件 |
| `audit/` | 墙体对账 |

## 许可

两套代码分别遵守各自上游的 MIT 许可。再分发时保留对应的版权与许可声明。

- `floorplan-3d/` 与从中分出的 `esports-room/`：Copyright (c) 2026 wuyi。[floorplan-3d/LICENSE](floorplan-3d/LICENSE)、[esports-room/LICENSE](esports-room/LICENSE)。上游仓库 [wy51ai/floorplan-3d](https://github.com/wy51ai/floorplan-3d)。
- `.cursor/skills/house-plan-designer/` 以及由它生成的 `house-plan-designer/check.html`、`floorplan-3d/三室一厅-装修设计器.html`：Copyright (c) 2026 ZWD11。[.cursor/skills/house-plan-designer/LICENSE](.cursor/skills/house-plan-designer/LICENSE)。上游仓库 [ZWD11/house-plan-designer](https://github.com/ZWD11/house-plan-designer)。
