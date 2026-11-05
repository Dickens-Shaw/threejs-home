"""贝壳户型图 standard_1784555545922.jpeg → HouseSpec。

坐标：x 向东，y 向南，原点在卧室 C 北外墙外皮与客厅西外墙外皮的交点外推。
外墙厚 240，内墙厚 120。水平尺寸按顶部 2135/2450/1906/1285。
竖向按右侧 2235/579/3246/2795/1357（左侧总深多 120，见交付说明）。
"""
import json
import sys

IMG = "/Users/worker/Desktop/projects/threejs-home/floorplan-3d/standard_1784555545922.jpeg"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/Users/worker/Desktop/projects/threejs-home/floorplan-3d/beike-std/spec.json"

T = 240
t = 120


def axis(pairs):
    px = [p for p, _ in pairs]
    mm = [m for _, m in pairs]

    def f(p):
        if p <= px[0]:
            s = (mm[1] - mm[0]) / (px[1] - px[0])
            return mm[0] - (px[0] - p) * s
        if p >= px[-1]:
            s = (mm[-1] - mm[-2]) / (px[-1] - px[-2])
            return mm[-1] + (p - px[-1]) * s
        for i in range(1, len(px)):
            if px[i] >= p:
                u = (p - px[i - 1]) / (px[i] - px[i - 1])
                return mm[i - 1] + u * (mm[i] - mm[i - 1])
        return mm[-1]

    return f


# 锚点是墙面像素 → 标注毫米
X = axis([(287, 0), (400, 2135), (535, 4585), (642, 6491), (712, 7776)])
Y = axis([(102, 0), (217, 2235), (250, 2814), (422, 6060), (574, 8855), (648, 10212)])

def r(v):
    return int(round(v))


# 竖向墙中线
west = T // 2
c_west = 2135 + T // 2
c_east = 4585 + T // 2
b_east = 6491 - T // 2
a_east = 7776 - T // 2
part = r(X(479.5))
kit_e = r(X(413.5))
a_west = r(X(570))
# 入户凹角的外墙：西面与卧室 A 西墙西面齐平，厚 240，多出的厚度在室外
ret = (a_west - t // 2) + T // 2

# 横向墙中线
c_north = T // 2
main_n = 2235 + T // 2
c_south = 2814 + t // 2
b_south = 6060 - t // 2
a_north = 6060 - T // 2
a_south = 8855 - T // 2
south = 10212 - T // 2
bath_n = r(Y(476.5))
# 卫生间南墙北面与卧室 A 南墙内皮齐平
bath_s = (a_south - T // 2) + t // 2
kit_n = r(Y(527))

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


def door(a, b, hinge, into, entry=False):
    o = dict(type="door", **{"from": a, "to": b}, hinge=hinge, into=into)
    if entry:
        o["entry"] = True
    return o


def win(a, b):
    return dict(type="window", **{"from": a, "to": b}, sill=900, unsure="窗台高度图上没有，按 900 做的")


# 外轮廓
H(c_north, c_west, c_east, T, True, [win(2520, 4360)])
H(main_n, west, c_west, T, True, [win(280, 2080)])
H(main_n, c_east, b_east, T, True, [win(4840, 6240)])
V(west, main_n, south, T, True)
V(c_west, c_north, c_south, T, True)
V(c_east, c_north, c_south, T, True)
V(b_east, main_n, b_south, T, True)
H(a_north, b_east, a_east, T, True)
V(a_east, a_north, a_south, T, True, [win(6220, 8490)])
H(a_south, a_west, a_east, T, True)
V(ret, a_south, south, T, True)
H(south, west, ret, T, True, [door(3580, 4330, "to", [3900, 9600], True)])

# 内墙
H(c_south, c_west, c_east, t, False, [door(2500, 3250, "from", [2900, 3400])])
V(part, c_south, b_south, t, False)
H(b_south, part, b_east, t, False, [door(3860, 4610, "from", [4200, 5600])])
V(a_west, b_south, a_south, t, False, [door(6220, 7000, "from", [5800, 6600])])
H(bath_n, part, a_west, t, False, [door(4300, 5100, "to", [4700, 7600])])
V(part, bath_n, bath_s, t, False)
H(bath_s, part, a_west, t, False)
H(kit_n, west, kit_e, t, False)
V(kit_e, kit_n, south, t, False, [door(8720, 9520, "to", [1800, 9100])])

# 房间内框，家具靠这些放
c_x0, c_x1 = c_west + T // 2, c_east - T // 2
c_y0, c_y1 = c_north + T // 2, c_south - t // 2
b_x0, b_x1 = part + t // 2, b_east - T // 2
b_y0, b_y1 = main_n + T // 2, b_south - t // 2
a_x0, a_x1 = a_west + t // 2, a_east - T // 2
a_y0, a_y1 = a_north + T // 2, a_south - T // 2
k_x0, k_x1 = west + T // 2, kit_e - t // 2
k_y0, k_y1 = kit_n + t // 2, south - T // 2
u_x0, u_x1 = part + t // 2, a_west - t // 2
u_y0, u_y1 = bath_n + t // 2, bath_s - t // 2
liv_x0 = west + T // 2
liv_y0 = main_n + T // 2

rooms = [
    dict(at=[(c_x0 + c_x1) // 2, (c_y0 + c_y1) // 2], name="卧室C", mat="oak", wallMat="latexWarm"),
    dict(at=[(b_x0 + b_x1) // 2, (b_y0 + b_y1) // 2], name="卧室B", mat="oak", wallMat="latexWarm"),
    dict(at=[(a_x0 + a_x1) // 2, (a_y0 + a_y1) // 2], name="卧室A", mat="oak", wallMat="latexSage"),
    dict(at=[1800, 5600], name="客厅", mat="tile", wallMat="latexWhite"),
    dict(at=[(k_x0 + k_x1) // 2, (k_y0 + k_y1) // 2], name="厨房", mat="tile"),
    dict(at=[(u_x0 + u_x1) // 2, (u_y0 + u_y1) // 2], name="卫生间", mat="bath"),
]

furniture = []


def F(key, x, y, rot=0, **k):
    item = dict(key=key, at=[r(x), r(y)], rot=rot)
    item.update(k)
    furniture.append(item)


# 卧室 C：床靠北窗，留出窗帘。南门朝客厅开，床靠东，西侧留通道
F("bed12", 3900, 1540, 0, d=1760)
F("curtain", 3440, c_y0 + 90, 0, w=1900)
F("acWall", c_x1 - 130, 1700, 90)
F("rug", 3900, 2100, 0, w=1200, d=700)

# 卧室 B：床头靠西墙，北墙是窗。书桌靠东墙南段，避开床尾
F("bed15", b_x0 + 1025, 3720, 270)
F("desk", b_x1 - 320, 5300, 90, w=1000)
F("officeChair", b_x1 - 320 - 560, 5300, 270)
F("curtain", 5538, b_y0 + 90, 0, w=1420)
F("acWall", b_x1 - 130, 3600, 90)
F("rug", b_x0 + 1700, 3900, 0, w=1400, d=1000)

# 卧室 A：床头靠南墙，东墙是窗，西墙靠北是门。床缩短并靠东，躲开门扇和窗帘
F("bed12", 6520, 7860, 180, d=1500)
F("curtain", a_x1 - 90, 7355, 90, w=2300)
F("acWall", a_x0 + 130, 7800, 270)
F("rug", 6520, 7600, 0, w=1200, d=800)

# 客厅：沙发靠西墙朝东，电视柜靠卧室 B 西墙，餐桌在中南部
F("sofa", liv_x0 + 475, 4000, 270)
F("coffeeTable", 2500, 4000, 0)
F("rug", liv_x0 + 1100, 4000, 0, w=2200, d=1600)
F("tvCabinet", part - t // 2 - 200, 4500, 90, w=1000)
F("diningTable", 1750, 6800, 0, w=1400, d=800)
F("chair", 1450, 6800 - 560, 0)
F("chair", 2050, 6800 - 560, 0)
F("chair", 1450, 6800 + 560, 180)
F("chair", 2050, 6800 + 560, 180)
F("acWall", liv_x0 + 130, 4000, 270)
F("plant", 2800, 5200, 0)
F("shoeCabinet", 4700, south - T // 2 - 180, 180, w=700)

# 厨房：西墙橱柜。门在东墙，净宽放不下冰箱
F("counter", k_x0 + 300, (k_y0 + k_y1) // 2, 270, w=1700, kit={
    "shape": "I", "depth": 600,
    "sink": {"leg": 0, "at": 340, "w": 480},
    "hob": {"leg": 0, "at": 1380, "w": 520},
})

# 卫生间：马桶靠西南，躲开北门。热水器挂在西墙实墙段
F("toilet", 3900, 8200, 270)
F("vanity", 4700, u_y1 - 270, 180, w=700)
F("waterHeater", u_x0 + 225, 7900, 270)
F("bathHeater", (u_x0 + u_x1) // 2, (u_y0 + u_y1) // 2, 0)
F("towelWarmer", u_x0 + 70, 7900, 270)

structs = [
    dict(kind="sewer", at=[3900, 8200]),
    dict(kind="drain", at=[(u_x0 + u_x1) // 2, (u_y0 + u_y1) // 2]),
    dict(kind="drain", at=[k_x0 + 500, (k_y0 + k_y1) // 2]),
]

# 底图按外宽对齐。竖向标注比例和横向差约 2%，叠图会有轻微拉长
span_px = 712 - 287
scale = 7776 / span_px
spec = dict(
    name="三室一厅一卫",
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
        dict(name="顶部分段", line="y=1200", at=[800, 4000, 7500, 9600], **{"from": 0}, segs=[2135, 2450, 1906, 1285], ref="face"),
        dict(name="右侧分段", line="x=7000", at=[1800, 3500, 5500, 7800, 9500], **{"from": 0}, segs=[2235, 579, 3246, 2795, 1357], ref="face"),
        dict(name="左侧分段", line="x=1800", at=[800, 2600, 5000, 9000, 9900], **{"from": 0}, segs=[2259, 616, 5338, 2119], ref="face", tol=250),
        dict(name="底部分段", line="y=9800", at=[7500, 9800], **{"from": 240}, segs=[1921, 3015, 2536], ref="face", tol=180),
    ],
    comments=[
        dict(at=[3400, 1400], text="卧室 C 东侧图上有一节柜子。房间净宽约 2.2 米，按真实柜深放会挡住南门通道，这里只放了 1.2 米床"),
        dict(at=[5000, 4000], text="卧室 B 图上东侧是一组小桌椅，按书桌加椅子放。没有单独的大衣柜位置"),
        dict(at=[4500, 7800], text="卫生间图上只有马桶。补了浴室柜。净面积约 2.3 平方米，再加淋浴房会挡住门"),
        dict(at=[900, 9000], text="厨房净宽约 2.1 米，东门朝内开。按真实尺寸放不下冰箱，图上本来也没画"),
        dict(at=[7000, 2000], text="左右两道竖向尺寸总深差 120 毫米。墙按右侧 2235/579/3246/2795/1357 建"),
        dict(at=[2000, 2500], text="指北针朝图纸的左上，大约西北，按 -45 度。层高图上没有，按 2800"),
    ],
    underlay=dict(image=IMG, mmPerPx=round(scale, 4), x=round(-287 * scale), y=round(-102 * scale)),
)

json.dump(spec, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("walls", len(walls), "furniture", len(furniture))
print("C", c_x0, c_x1, c_y0, c_y1, "w", c_x1 - c_x0, "d", c_y1 - c_y0)
print("B", b_x0, b_x1, b_y0, b_y1, "w", b_x1 - b_x0, "d", b_y1 - b_y0)
print("A", a_x0, a_x1, a_y0, a_y1, "w", a_x1 - a_x0, "d", a_y1 - a_y0)
print("K", k_x0, k_x1, k_y0, k_y1, "w", k_x1 - k_x0, "d", k_y1 - k_y0)
print("U", u_x0, u_x1, u_y0, u_y1, "w", u_x1 - u_x0, "d", u_y1 - u_y0)
print("part", part, "kit_e", kit_e, "a_west", a_west, "ret", ret)
print("bath_n", bath_n, "bath_s", bath_s, "kit_n", kit_n)
print("south", south, "a_south", a_south, "b_south", b_south)
