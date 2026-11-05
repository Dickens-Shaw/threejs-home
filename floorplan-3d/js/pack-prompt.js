const HUXING_PROMPT = `请根据我上传的这张带家具的户型图，生成一份可导入的数据。只输出一个 json 代码块，不要解释，不要第二个 JSON。

单位是毫米。北在上方，y 向下增大。墙记录的是中线，不是外皮。原点放在最西、最北的外墙中线交点附近，坐标不要出现大段负数。

输出必须是这一份结构：

{
  "kind": "huxing-pack",
  "version": 1,
  "name": "三室一厅一卫",
  "walls": [
    {"id": "wN", "a": [0, 0], "b": [4000, 0], "thick": 200, "type": "e"}
  ],
  "openings": [
    {"id": "d1", "kind": "door", "wallId": "wS", "t": 1500, "len": 900, "head": 2100, "hinge": "start", "swing": 1, "entry": true}
  ],
  "bays": [
    {"id": "bay1", "wallId": "wN", "t": 800, "len": 1800, "depth": 620}
  ],
  "rooms": [
    {"id": "living", "name": "客厅", "mat": "wood", "at": [2000, 3500]}
  ],
  "dims": [],
  "furniture": [
    {"roomId": "living", "type": "sofa", "name": "三人沙发", "cx": 2000, "cy": 4200, "w": 2400, "d": 900, "rot": 0}
  ],
  "notes": ""
}

墙：每条是 {id, a:[x,y], b:[x,y], thick, type}。整张图先定一个厚度，这种住宅图用 200，除非图纸写了别的。type 外墙用 e，隔墙用 n；只有图纸标了承重才用 b，矮墙用 low。端点相接，偏差不超过 2。隔墙端点落在另一条墙的中线上。同一道墙只写一次。默认水平或垂直，只有图纸明显不正交时才写斜墙。

印刷尺寸和墙对不上时，保留必须共线的墙，改尺寸，不要把两套数平均。差多少写进 notes。例如一张图左边合计 10332、右边合计 10090，两边差 242，而且 616 和 457 不是同一道坎，这时用实际墙距，不照抄印刷数。下边尺寸如果和上边轴线差大约一堵墙，下边也改成对齐后的中线距。

门、窗、推拉门：{id, kind, wallId, t, len, head, sill, hinge, swing, entry}。t 是离 wall.a 的距离，len 是洞宽，两端至少留 10。窗 kind 为 win，head 为 2400；普通窗 sill 为 900，高窗约 1400，矮窗约 450。门 kind 为 door，宽约 750 到 900，head 为 2100；hinge 为 start 或 end；swing 为 1 或 -1，弧开向房间。整张图只有一樘 entry 为 true。推拉门 kind 为 slide，到顶时 head 为 2400，否则 2100。

飘窗：外墙上的玻璃凹室不要另画三面墙。写成 {id, wallId, t, len, depth}，depth 默认 620，len 至少 500。飘窗房间 counted 为 false。地面和卧室一样就跟着卧室，否则 mat 用 marble。

房间：{id, name, mat, at, counted}。at 是房间内部的一点，不要落在墙上。导入靠这一点把名字贴上房间。材料只许用这些值：木地板、卧室、起居用 wood；深色木用 walnut；客厅大砖用 tile800；厨房地砖用 tile600；卫生间和阳台湿区用 antislip；石材和飘窗用 marble；水磨石用 terrazzo；地毯用 carpet。湿区不要用 wood。没有把握用 tile800。面积按墙内皮算，飘窗不进套内。

尺寸：dims 默认空数组，导入后会按墙中线自己算。只有四边都已经改成中线距时才手写。一段链是 {horiz, at, start, segs}。horiz 为 true 时沿 x，为 false 时沿 y。start 是第一道刻度，落在墙中线上。segs 相加必须等于这条边的跨度，墙厚不要单独成段。at 是尺寸线在另一轴上的位置，放在房子外侧约 800。只标外轮廓，门窗洞宽不要写进尺寸。

家具：图上有家具就必须写入 furniture。每一件是 {roomId, type, name, cx, cy, w, d, rot}。roomId 必填，必须等于上面某个 rooms 的 id。一件家具属于哪个房间，只看 roomId，不看坐标。cx 和 cy 是平面中心。name、w、d 必须用下面库表里的某一行，不要按像素自造尺寸。rot 是顺时针角度；0 表示背面朝北。背面贴所靠墙的内皮，中心离内皮 d 的一半。同一间里两件不要重叠。库里没有的种类不要编 type，写进 notes，不要放进 furniture。

家具库，只能从这里选：

bed，双人床 1.8m，1800×2000
bed，双人床 1.5m，1500×2000
bed，单人床，1200×2000
crib，婴儿床，1250×700
nightstand，床头柜，450×400
wardrobe，衣柜，2000×600
wardrobe，小衣柜，1200×550
dresser，梳妆台，1000×450
desk，书桌，1200×600
chair，椅子，450×480
bookshelf，书架，800×300
baycushion，飘窗垫，520×1800
sofa，三人沙发，2400×900
sofa，双人沙发，1700×880
cornersofa，转角沙发，2800×1700
armchair，单人沙发，850×850
beanbag，懒人沙发，800×800
coffeetable，茶几，1300×650
nesttable，大小圆茶几，1190×640
sidetable，边几，500×500
tvstand，电视柜，2400×400
rug，地毯，2400×1700
shoecab，鞋柜，1000×350
shoecab，玄关柜，1400×380
shoecol，通顶鞋柜，800×320
floorlamp，落地灯，450×450
plant，绿植，500×500
plant，大绿植，700×700
table，餐桌，1400×800
table，六人餐桌，1800×900
roundtable，圆桌，1000×1000
chair，餐椅，450×480
island，岛台，1800×900
barstool，吧椅，420×420
counter，橱柜台面，1600×600
stove，燃气灶，750×450
ksink，水槽，800×450
fridge，冰箱，700×700
cabinet，餐边柜，1600×400
winecab，酒柜，1600×400
toilet，马桶，400×700
vanity，浴室柜，800×500
vanity，双盆浴室柜，1200×500
shower，淋浴房，900×900
bathtub，浴缸，1600×750
washer，洗衣机，600×600
waterheater，电热水器，800×450
gasheater，燃气热水器，335×163
cabinet，储物柜，1000×400
tv，65 寸电视，1450×80
tv，55 寸电视，1230×80
fridge，对开门冰箱，910×700
aircon，柜机空调，500×380
acwall，挂机空调，900×250
dishwasher，洗碗机，600×600
ovencol，蒸烤箱高柜，600×600
dryer，烘干机，600×600
purifier，空气净化器，400×300
desk，长书桌，1600×700
officechair，办公椅，620×620
bookshelf，大书架，1600×350
piano，立式钢琴，1500×600
treadmill，跑步机，800×1800
armchair，阅读椅，750×800

交出去之前自己核对：每条隔墙只出现一次，两端落在中线上；该共线的墙在同一条 x 或同一条 y；每个房间都有 at，点在房间里面；飘窗写在 bays 里，不是三面手画墙；有家具时，每件的 roomId 都等于某个 rooms 的 id。`;
