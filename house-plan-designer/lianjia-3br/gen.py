"""链家户型图 plan.png → HouseSpec。

三室两厅两卫。原点在阳台 B 西边、北侧卫生间北墙中线。
x 向东，y 向南。外墙厚 240，内墙厚 120，阳台栏板厚 80。
横向尺寸用顶部 1190/4327/2923/1507，卧室 A 西墙用底部 4930。
竖向用左侧 1296/3755/2947/2881/1186。
底部总宽比顶部多 60，东外墙跟顶部。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, "plan.png")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "spec.json")

T = 240
t = 120
rail = 80

# 墙中线。外轮廓中线落在尺寸刻度上，内墙中线按图上墙位。
xBal = 0
xWest = 1190
xCorW = 4910
xCorE = 6120
xBathW = 5517
xBathA = 7520
xKit = 8170
xBathE = 8440
xEast = 9947

yBathN = 0
yLiveN = 1296
yKitN = 2630
yDiv = 5051
yCorS = 6390
yBathAS = 6840
ySplit = 7998
ySouth = 10879
yBalS = 12065

walls = []


def H(y, x0, x1, thick, bearing, ops=None):
    w = dict(a=[x0, y], b=[x1, y], t=thick, bearing=bearing)
    if bearing:
        w["bearingFrom"] = "inferred"
    if ops:
        w["openings"] = ops
    walls.append(w)


def V(x, y0, y1, thick, bearing, ops=None):
    w = dict(a=[x, y0], b=[x, y1], t=thick, bearing=bearing)
    if bearing:
        w["bearingFrom"] = "inferred"
    if ops:
        w["openings"] = ops
    walls.append(w)


def door(a, b, hinge, into, entry=False, unsure=None):
    o = dict(type="door", **{"from": a, "to": b}, hinge=hinge, into=into)
    if entry:
        o["entry"] = True
    if unsure:
        o["unsure"] = unsure
    return o


def win(a, b):
    return dict(type="window", **{"from": a, "to": b}, sill=900, unsure="窗台高度图上没有，按 900 做的")


def glass(a, b):
    return dict(type="floorWindow", **{"from": a, "to": b}, sill=0, unsure="落地玻璃图上没标窗台，按落地做的")


# 北侧卫生间：凸出主楼北墙
H(yBathN, xBathW, xBathE, T, True)
V(xBathW, yBathN, yLiveN, T, True)
V(xBathE, yBathN, yLiveN, T, True)

# 主楼北墙。西段是客厅窗，中段是卫生间门，东段是入户
H(yLiveN, xBal, xWest, rail, False)
H(
    yLiveN,
    xWest,
    xEast,
    T,
    True,
    [
        win(1700, 3900),
        door(
            4300,
            5100,
            "from",
            [4700, 1900],
            True,
            "图上没有单独标入户门，放在客厅北外墙、卫生间西侧",
        ),
        door(7400, 8200, "to", [7800, 800], unsure="卫生间门朝向按门弧估计，朝卫生间里开"),
    ],
)

# 阳台 B：西、北、南是栏板，东侧是客厅西墙的落地玻璃
V(xBal, yLiveN, yDiv, rail, False)
H(yDiv, xBal, xWest, rail, False)
V(xWest, yLiveN, ySouth, T, True, [glass(1550, 4850)])

# 客厅 / 卧室分界。中间断开的是过道，过道北侧和餐厅是通的
H(yDiv, xWest, xCorW, t, False)
H(yDiv, xCorE, xEast, t, False)

# 厨房。门在北墙靠西
V(xKit, yKitN, yDiv, t, False)
H(yKitN, xKit, xEast, t, False, [door(8350, 9150, "to", [8700, 3200], unsure="厨房门按门弧估计，朝厨房里开")])

# 过道。北侧敞开通向餐厅。西门进卧室 C，东门进卧室 A，南门进卧室 B
V(xCorW, yDiv, ySplit, t, False, [door(5200, 6000, "from", [4500, 5600], unsure="卧室 C 的门朝卧室里开")])
V(xCorE, yDiv, ySouth, t, False, [door(5250, 6050, "to", [6700, 5650], unsure="过道东门朝卧室 A 开")])
H(yCorS, xCorW, xCorE, t, False, [door(5150, 5950, "to", [5500, 7000], unsure="过道南门朝卧室 B 开")])

# 卫生间 A。门在西墙，朝卧室 A 开
V(xBathA, yDiv, yBathAS, t, False, [door(5200, 6000, "from", [7000, 5600], unsure="卫生间 A 的门朝卧室 A 开")])
H(yBathAS, xBathA, xEast, t, False)

# 卧室 C / 卧室 B
H(ySplit, xWest, xCorW, t, False)

# 南外墙，卧室 A 一段是去阳台 A 的落地玻璃
H(ySouth, xWest, xEast, T, True, [glass(6400, 9600)])
V(xEast, yLiveN, ySouth, T, True, [win(1650, 2350), win(3200, 4600), win(10200, 10600)])

# 阳台 A
V(xCorE, ySouth, yBalS, rail, False)
V(xEast, ySouth, yBalS, rail, False)
H(yBalS, xCorE, xEast, rail, False)


def r(v):
    return int(round(v))


rooms = [
    dict(at=[3000, 3200], name="客厅", mat="oak", wallMat="latexWarm"),
    dict(at=[6800, 2800], name="餐厅", mat="oak", wallMat="latexWarm"),
    dict(at=[5500, 5700], name="过道", mat="oak", wallMat="latexWhite"),
    dict(at=[9000, 3900], name="厨房", mat="tile", wallMat="latexWhite"),
    dict(at=[7000, 700], name="卫生间", mat="bath", wallMat="tile"),
    dict(at=[8600, 6000], name="卫生间A", mat="bath", wallMat="tile"),
    dict(at=[3000, 6500], name="卧室C", mat="oak", wallMat="latexWarm"),
    dict(at=[3200, 9500], name="卧室B", mat="oak", wallMat="latexWarm"),
    dict(at=[8200, 9000], name="卧室A", mat="oak", wallMat="latexSage"),
    dict(at=[600, 3200], name="阳台B", mat="tile", wallMat="latexWhite"),
    dict(at=[8000, 11500], name="阳台A", mat="tile", wallMat="latexWhite"),
]

furniture = []


def F(key, x, y, rot=0, **k):
    item = dict(key=key, at=[r(x), r(y)], rot=rot)
    item.update(k)
    furniture.append(item)


# 客厅：沙发靠北墙偏西，给入户门让出通道。西墙是落地玻璃
F("sofa", 2800, 2100, 0)
F("coffeeTable", 2800, 3100, 0)
F("rug", 2800, 2700, 0, w=2000, d=1400)
F("acWall", 3000, 4860, 180)
F("curtain", 1560, 3200, 270, w=3500)

# 餐厅靠西放，东侧留出到厨房和过道的通道
F("diningTable", 5600, 2800, 0, w=1200, d=750)
F("chair", 5350, 2100, 0)
F("chair", 5850, 2100, 0)
F("chair", 5350, 3500, 180)
F("chair", 5850, 3500, 180)

# 厨房：橱柜靠南墙。水槽和灶台之间留 600
F(
    "counter",
    9030,
    4690,
    180,
    w=1580,
    kit={
        "shape": "I",
        "depth": 600,
        "sink": {"leg": 0, "at": 230, "w": 340},
        "hob": {"leg": 0, "at": 1220, "w": 400},
    },
)

# 北卫生间：马桶靠北墙西侧，浴室柜在东侧，门在南墙东段
F("toilet", 6400, 470, 0)
F("vanity", 7100, 370, 0, w=600)
F("bathHeater", 7000, 700, 0)

# 卫生间 A：马桶靠南墙，浴室柜靠东墙。门在西墙北段，朝外开
F("toilet", 8300, 6430, 180)
F("vanity", 9570, 6000, 90, w=700)
F("bathHeater", 8600, 6000, 0)

# 卧室 C：床头靠南墙，东门在北段
F("bed15", 3000, 6910, 180)
F("acWall", 1440, 6500, 270)

# 卧室 B：床头靠北墙，靠西放。床头柜在床的东侧，离开床沿
F("bed15", 3200, 9080, 0)
F("nightstand", 4500, 8300, 0)
F("acWall", 1440, 9200, 270)

# 卧室 A：床头靠卫生间 A 南墙。床头柜在床的西侧。南墙是去阳台的落地玻璃
F("bed15", 8500, 7920, 0)
F("nightstand", 7000, 7300, 0)
F("acWall", 9697, 8600, 90)
F("curtain", 8000, 10520, 180, w=3400)

# 阳台
F("plant", 600, 2500, 0)
F("plant", 8000, 11500, 0)

structs = [
    dict(kind="sewer", at=[6400, 470]),
    dict(kind="sewer", at=[8300, 6430]),
    dict(kind="drain", at=[7000, 700]),
    dict(kind="drain", at=[8600, 6000]),
    dict(kind="drain", at=[9400, 4500]),
]

# 底图像素 (220, 71) 对齐到毫米 (0, 0)。横向 9947 / 409px
scale = 9947 / (629 - 220)
spec = dict(
    name="三室两厅两卫",
    height=2800,
    heightFrom="estimated",
    phase="renovate",
    north=-45,
    autoElec=True,
    style="modern",
    walls=walls,
    rooms=rooms,
    furniture=furniture,
    structs=structs,
    dims=[
        dict(name="顶部分段", line="y=600", at=[600, 2500, 8000], **{"from": 0}, segs=[1190, 4327, 2923, 1507], ref="center"),
        dict(name="左侧分段", line="x=3000", at=[3000, 7000, 8000], **{"from": 0}, segs=[1296, 3755, 2947, 2881, 1186], ref="center"),
        dict(name="底部分段", line="y=8000", at=[2500, 8000], **{"from": 0}, segs=[1190, 4930, 3887], ref="center", tol=80),
    ],
    comments=[
        dict(at=[3000, 2000], text="指北针朝图纸左上，大约西北，按 -45 度。层高图上没有，按 2800"),
        dict(at=[4700, 1800], text="图上没标哪扇是入户门，暂放在客厅北外墙、卫生间西侧"),
        dict(at=[7000, 400], text="北卫生间净深只有一米出头，图上面积 4.3 ㎡更接近墙中线围合。门朝向是按门弧估的"),
        dict(at=[5500, 5600], text="过道北侧没有门，和餐厅是通的，模型里会并成一个空间"),
        dict(at=[8000, 11000], text="底部总宽比顶部多 60 毫米。东外墙按顶部 9947，底部最后一段 3887 会差这 60"),
        dict(at=[2000, 7000], text="左右两道竖向尺寸对不齐，墙按左侧 1296/3755/2947/2881/1186。右侧数字笔画和像素比例对不上"),
    ],
    underlay=dict(image=IMG, mmPerPx=round(scale, 4), x=round(-220 * scale), y=round(-71 * scale)),
)

json.dump(spec, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def free_ends(ws, tol=40):
    segs = []
    for w in ws:
        ax, ay = w["a"]
        bx, by = w["b"]
        if ay == by:
            segs.append(("H", ay, min(ax, bx), max(ax, bx)))
        else:
            segs.append(("V", ax, min(ay, by), max(ay, by)))

    def on_wall(x, y):
        for kind, c, a, b in segs:
            if kind == "H" and abs(y - c) <= tol and a - tol <= x <= b + tol:
                return True
            if kind == "V" and abs(x - c) <= tol and a - tol <= y <= b + tol:
                return True
        return False

    bad = []
    for w in ws:
        for p in (w["a"], w["b"]):
            hits = 0
            for kind, c, a, b in segs:
                if kind == "H" and abs(p[1] - c) <= tol and a - tol <= p[0] <= b + tol:
                    hits += 1
                if kind == "V" and abs(p[0] - c) <= tol and a - tol <= p[1] <= b + tol:
                    hits += 1
            if hits < 2:
                bad.append(p)
    return bad


print("walls", len(walls), "rooms", len(rooms), "furniture", len(furniture))
print("free", free_ends(walls))
print("scale", round(scale, 4))
