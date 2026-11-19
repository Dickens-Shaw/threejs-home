# house-plan-designer

一套户型一个子目录，互不覆盖。

| 目录 | 户型 | 状态 |
| --- | --- | --- |
| [`beike-3br/`](beike-3br/) | 贝壳「三室一厅一卫」 | 已完成，有 `check.html` 可直接打开 |
| [`standard-78134483/`](standard-78134483/) | `standard_78134483-5623-4d0d-96c8-83a77f8a8f42.jpeg` | 骨架就绪，`gen.py` 待写 |
| [`TEMPLATE/`](TEMPLATE/) | 新户型模板 | 复制成新目录再填 |

每个目录里的文件：

| 文件 | 作用 |
| --- | --- |
| `gen.py` | 按户型图的尺寸链写出 spec |
| `spec.json` | HouseSpec |
| `check.html` | 注入模板后的设计器 |
| `analysis/`、`analysis2/` | 识图草稿 |
| `check/` | 结构自查报告 |
| `qa/`、`qa-furn/`、`qa-walk/` | 界面验收和导出文件 |
| `audit/` | 墙体对账 |
| `.build_walls.json` | 记录上次构建的墙数，比上次少会警告 |

生成流程：

```bash
cd house-plan-designer/<户型名>
python gen.py spec.json
python ../../.cursor/skills/house-plan-designer/scripts/build.py spec.json -o check.html
node ../../.cursor/skills/house-plan-designer/scripts/check.mjs check.html check
node ../../.cursor/skills/house-plan-designer/scripts/qa.mjs check.html qa --lite --quick
```

`gen.py` 里的底图和输出路径按脚本自身位置算（`os.path.dirname(__file__)`），换机器不用改。

`index.html` 指向 `beike-3br/check.html`。
