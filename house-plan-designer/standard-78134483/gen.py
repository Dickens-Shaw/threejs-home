"""户型图 standard_78134483 → HouseSpec。

坐标：x 向东，y 向南。像素按图上尺寸链做分段线性映射（axismap），
不整图乘一个比例。外墙 240，隔墙 120。
水平链用顶部 2202/683/6313/5257/736/3047/2328/1150/1301/1480。
竖向以左侧 3693/591/3610/2625/3731 为骨，右侧短段对齐到同一原点。
层高、窗台高图上没有，按常规估。
"""
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".cursor", "skills", "house-plan-designer", "scripts")))
from axismap import Axis, chain

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
IMG = os.path.join(REPO, "floorplan-3d", "standard_78134483-5623-4d0d-96c8-83a77f8a8f42.jpeg")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "spec.json")

# 顶部尺寸线刻度（箭头尖）→ 累计毫米。原点 = 最西刻度
X = Axis(chain(
    [65, 140.5, 164.5, 385.5, 571.5, 599.5, 707.5, 792.5, 836.5, 883.5, 935],
    [2202, 683, 6313, 5257, 736, 3047, 2328, 1150, 1301, 1480],
))
# 只用左侧尺寸线。右侧厨房翼的总高和左侧差约 500，并进同一条轴会在中段倒退
Y = Axis(chain([122, 249.5, 273, 402, 504, 639], [3693, 591, 3610, 2625, 3731]))

T, t = 240, 120
S = 5  # 毫米取整，共用像素的端点才能接上


def Xpx(p):
    return int(X(p, S))


def Ypx(p):
    return int(Y(p, S))


walls = []


def H(y, x0, x1, thick, bearing, ops=None):
    w = dict(a=[Xpx(x0), Ypx(y)], b=[Xpx(x1), Ypx(y)], t=thick, bearing=bearing)
    if bearing:
        w["bearingFrom"] = "inferred"
    if ops:
        w["openings"] = ops
    walls.append(w)


def V(x, y0, y1, thick, bearing, ops=None):
    w = dict(a=[Xpx(x), Ypx(y0)], b=[Xpx(x), Ypx(y1)], t=thick, bearing=bearing)
    if bearing:
        w["bearingFrom"] = "inferred"
    if ops:
        w["openings"] = ops
    walls.append(w)


def door(a, b, hinge, into, entry=False, kind="door"):
    o = dict(type=kind, **{"from": a, "to": b}, hinge=hinge, into=into)
    if entry:
        o["entry"] = True
    return o


def win(a, b, kind="window"):
    return dict(type=kind, **{"from": a, "to": b}, sill=900, unsure="窗台高度图上没有，按 900")


# ---------- 外轮廓 ----------
# 客厅北墙、东墙收到门厅北墙
H(100, 160, 388, T, True, [win(Xpx(210), Xpx(340))])
V(388, 100, 185, T, True)
# 门厅北墙：中段是入户双开门（图上两扇弧线）
H(185, 388, 575, T, True, [door(Xpx(500), Xpx(548), "from", [Xpx(524), Ypx(230)], True, "double")])
# 厨房西墙，门开向厨房。东墙落到南墙，和阳台 B 分开
V(575, 148, 256, T, True, [door(Ypx(200), Ypx(235), "to", [Xpx(640), Ypx(218)])])
V(708, 148, 256, t, False)
# 厨房 / 保姆间 / 卫 A 北墙，再到阳台 B
H(148, 575, 835, T, True, [win(Xpx(620), Xpx(690))])
V(835, 148, 256, T, True)
H(200, 835, 943, T, True)
V(943, 200, 256, T, True)
# 厨房翼南墙。西端收到阳台 C
H(256, 530, 943, T, True)
# 阳台 C 东墙，南收到底下一排的北墙
V(600, 256, 646, T, True, [win(Ypx(580), Ypx(630), "floorWindow")])
# 南外墙收到东外墙
H(646, 82, 600, T, True, [win(Xpx(140), Xpx(220)), win(Xpx(500), Xpx(570))])
# 卧室 D 西墙
V(82, 504, 646, T, True, [win(Ypx(560), Ypx(620))])
# 卧室 A / 客厅西墙（阳台 A 以东的实墙），含通往阳台的推拉门
V(160, 100, 504, T, True, [dict(type="sliding", **{"from": Ypx(310), "to": Ypx(380)}, sill=0)])
# 西北凹角：客厅北墙没伸到阳台外皮
H(118, 136, 160, T, True)
V(136, 118, 268, T, True)

# 阳台 A（图上虚线，按栏板）。北栏收到客厅西墙
H(268, 60, 160, t, False)
V(60, 268, 405, t, False)
H(405, 60, 160, t, False)

# ---------- 内墙 ----------
# 客厅南 / 卧室 A 北，东端收到过道西墙。门开向卧室 A
H(405, 160, 341, t, False, [door(Xpx(300), Xpx(330), "to", [Xpx(315), Ypx(450)])])
# 过道西墙：卧室 A、衣帽间以东
V(341, 405, 548, t, False, [door(Ypx(415), Ypx(440), "to", [Xpx(370), Ypx(428)])])
# 衣帽间
V(280, 450, 504, t, False)
H(450, 280, 341, t, False, [door(Xpx(300), Xpx(330), "from", [Xpx(315), Ypx(470)])])
# 卧室 A、D 的南墙。卧室 D 西墙外皮在 x=82
H(504, 82, 341, t, False)
# 卧室 D 东墙，上段开门到过道，下段是卫生间 D 的西墙
V(275, 504, 646, t, False, [door(Ypx(515), Ypx(540), "to", [Xpx(250), Ypx(528)])])
# 底下一排的北墙：卫生间 D、C 的门，卧室 C 朝阳台 C 的推拉门
H(548, 275, 600, t, False, [
    door(Xpx(300), Xpx(330), "from", [Xpx(315), Ypx(520)]),
    door(Xpx(380), Xpx(415), "from", [Xpx(398), Ypx(520)]),
    dict(type="sliding", **{"from": Xpx(545), "to": Xpx(585)}, sill=0),
])
V(341, 548, 646, t, False)
V(436, 548, 646, t, False, [door(Ypx(580), Ypx(615), "from", [Xpx(400), Ypx(598)])])
# 卧室 B。西墙落到过道南墙，东墙是阳台 C 的西墙
H(325, 388, 530, t, False)
V(530, 256, 548, t, False, [dict(type="sliding", **{"from": Ypx(360), "to": Ypx(430)}, sill=0)])
V(388, 325, 548, t, False, [door(Ypx(420), Ypx(450), "from", [Xpx(360), Ypx(435)])])
H(467, 388, 530, t, False)
# 卫生间 B 西墙开门到过道，南端落在 y=548
V(460, 467, 548, t, False, [door(Ypx(490), Ypx(520), "from", [Xpx(420), Ypx(505)])])
# 保姆间 / 卫 A。东墙已经在外轮廓里落到南墙
V(792, 148, 200, t, False)
H(200, 708, 835, t, False, [
    door(Xpx(730), Xpx(765), "to", [Xpx(748), Ypx(230)]),
    door(Xpx(800), Xpx(825), "to", [Xpx(812), Ypx(230)]),
])

# 房间标签。点要落在围合区域里
rooms = [
    dict(at=[Xpx(270), Ypx(180)], name="客厅", mat="marble", wallMat="latexWhite"),
    dict(at=[Xpx(470), Ypx(240)], name="门厅", mat="marble", wallMat="latexWhite"),
    dict(at=[Xpx(650), Ypx(200)], name="厨房", mat="tile"),
    dict(at=[Xpx(750), Ypx(172)], name="保姆间", mat="oak", wallMat="latexWarm"),
    dict(at=[Xpx(812), Ypx(172)], name="卫A", mat="bath"),
    dict(at=[Xpx(890), Ypx(230)], name="阳台B", mat="deck"),
    dict(at=[Xpx(100), Ypx(340)], name="阳台A", mat="deck"),
    dict(at=[Xpx(220), Ypx(460)], name="卧室A", mat="oak", wallMat="latexWarm"),
    dict(at=[Xpx(312), Ypx(475)], name="衣帽间", mat="oak", wallMat="latexWarm"),
    dict(at=[Xpx(400), Ypx(490)], name="过道", mat="tile", wallMat="latexWhite"),
    dict(at=[Xpx(460), Ypx(390)], name="卧室B", mat="oak", wallMat="latexSage"),
    dict(at=[Xpx(490), Ypx(500)], name="卫生间B", mat="bath"),
    dict(at=[Xpx(565), Ypx(400)], name="阳台C", mat="deck"),
    dict(at=[Xpx(170), Ypx(580)], name="卧室D", mat="walnut", wallMat="latexSage"),
    dict(at=[Xpx(295), Ypx(600)], name="卫生间D", mat="bath"),
    dict(at=[Xpx(390), Ypx(610)], name="卫生间C", mat="bath"),
    dict(at=[Xpx(510), Ypx(590)], name="卧室C", mat="oak", wallMat="latexWarm"),
]

furniture = []


def F(key, x, y, rot=0, **k):
    furniture.append(dict(key=key, at=[Xpx(x), Ypx(y)], rot=rot, **k))


# 客厅：沙发靠北墙，电视靠东，餐桌在南
F("sofa", 270, 150, 0)
F("coffeeTable", 270, 200, 0)
F("rug", 270, 190, 0, w=2400, d=1600)
F("tvCabinet", 360, 220, 90, w=1800)
F("diningTable", 300, 280, 0, w=1600, d=900)
F("chair", 270, 260, 0)
F("chair", 330, 260, 0)
F("chair", 270, 305, 180)
F("chair", 330, 305, 180)
F("plant", 200, 160, 0)
F("curtain", 270, 112, 0, w=3200)

# 卧室 A：床头靠北墙
F("bed15", 220, 450, 0)
F("nightstand", 175, 430, 0)
F("nightstand", 265, 430, 0)
F("wardrobe", 200, 490, 180, w=1600)
F("acWall", 175, 420, 270)

# 卧室 B
F("bed15", 450, 370, 0)
F("nightstand", 410, 350, 0)
F("nightstand", 490, 350, 0)
F("wardrobe", 410, 440, 180, w=1400)
F("curtain", 545, 390, 90, w=1800)

# 卧室 C：床头靠南
F("bed15", 510, 610, 180)
F("nightstand", 470, 630, 180)
F("nightstand", 550, 630, 180)
F("curtain", 575, 580, 90, w=1600)

# 卧室 D：床头靠南，主卧
F("bed18", 165, 600, 180)
F("nightstand", 120, 625, 180)
F("nightstand", 215, 625, 180)
F("wardrobe", 140, 540, 0, w=1800)
F("curtain", 100, 580, 270, w=1600)
F("acWall", 230, 620, 90)

# 衣帽间
F("wardrobe", 312, 490, 0, w=1200)

# 门厅
F("shoeCabinet", 420, 210, 0, w=1200)

# 厨房：北墙一字柜
F("counter", 650, 165, 0, w=2400, kit={
    "shape": "I", "depth": 600,
    "sink": {"leg": 0, "at": 400, "w": 500},
    "hob": {"leg": 0, "at": 1600, "w": 750},
})

# 卫生间
F("toilet", 300, 620, 0)
F("vanity", 270, 630, 180, w=700)
F("shower", 320, 580, 0)
F("toilet", 400, 620, 180)
F("vanity", 370, 630, 180, w=600)
F("toilet", 500, 510, 90)
F("vanity", 470, 500, 270, w=600)
F("toilet", 812, 175, 180)
F("vanity", 800, 185, 180, w=500)

structs = [
    dict(kind="sewer", at=[Xpx(300), Ypx(620)]),
    dict(kind="drain", at=[Xpx(320), Ypx(590)]),
    dict(kind="sewer", at=[Xpx(400), Ypx(620)]),
    dict(kind="sewer", at=[Xpx(500), Ypx(510)]),
    dict(kind="sewer", at=[Xpx(812), Ypx(180)]),
    dict(kind="drain", at=[Xpx(660), Ypx(170)]),
]

# 底图：水平比例对齐顶部尺寸链。竖向和水平差约 2%，叠图会有轻微拉高
scale = 28.095
spec = dict(
    name="四室两厅四卫",
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
        dict(name="顶部分段", line="y=-2000", at=[2000, 8000, 16000, 22000], **{"from": 0},
             segs=[2202, 683, 6313, 5257, 736, 3047, 2328, 1150, 1301, 1480], ref="face", tol=80),
        dict(name="左侧分段", line="x=-800", at=[1000, 5000, 9000, 12000], **{"from": 0},
             segs=[3693, 591, 3610, 2625, 3731], ref="face", tol=80),
    ],
    comments=[
        dict(at=[Xpx(270), Ypx(160)], text="层高、窗台高图上没有。层高按 2800，普通窗台按 900"),
        dict(at=[Xpx(100), Ypx(330)], text="阳台 A 图上是虚线栏板。指北针朝图纸左上，大约西北，按 -45 度"),
        dict(at=[Xpx(520), Ypx(220)], text="入户门按门厅北墙那两道弧线做成双开门。门轴以弧线为准，拿不准的见批注"),
        dict(at=[Xpx(890), Ypx(210)], text="阳台 B 北侧有个小凹角，这里拉直成一道北墙。左右两道竖向尺寸总高差约 500，墙按左侧链建"),
    ],
    underlay=dict(image=IMG, mmPerPx=scale, x=round(-65 * scale), y=round(-122 * scale)),
)

json.dump(spec, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("walls", len(walls), "rooms", len(rooms), "furniture", len(furniture))
print("X0", Xpx(65), "Xend", Xpx(935), "Y0", Ypx(122), "Yend", Ypx(639))
