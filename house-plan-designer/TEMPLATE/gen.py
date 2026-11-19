"""新户型工作区模板。

用法：把本目录复制成 house-plan-designer/<户型名>/，然后改这份 gen.py。

约定：
- 底图路径按脚本自身位置算，换机器不用改
- 输出默认写在本目录的 spec.json，也可以命令行传参覆盖
- 墙厚、坐标原点、尺寸链按新图重写
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

# 改成新户型图的路径（相对仓库根，或直接写绝对路径）
IMG = os.path.join(REPO, "floorplan-3d", "standard_78134483-5623-4d0d-96c8-83a77f8a8f42.jpeg")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "spec.json")

# 外墙厚 / 内墙厚，按图或常规取值
T = 240
t = 120

walls = []
rooms = []
furniture = []
structs = []

spec = dict(
    name="新户型",
    height=2800,
    heightFrom="estimated",
    phase="renovate",
    north=0,
    autoElec=True,
    style="modern",
    walls=walls,
    rooms=rooms,
    furniture=furniture,
    structs=structs,
    dims=[],
    comments=[],
    underlay=dict(image=IMG, mmPerPx=18.0, x=0, y=0),
)

json.dump(spec, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("walls", len(walls), "furniture", len(furniture))
