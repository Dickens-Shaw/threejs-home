# 五风格真形态验收台账（布局一份 + 五套真几何）

布局只定 `id/type/cx/cy/w/d/rot`（`esports-room/js/plan.js` LIB），形态各在各库：
`station` 走 `view3d.js` 旧 68 case 精细 switch；`bruno/daniel-light/daniel-dark/sooah` 各走 `js/draw-*.js`。
冒烟：四套库对 LIB 全量家具 type 逐个调用返回 true（69 个家具 type，`node --check` 全过）。

## 形态对照（按参考图）

| type | bruno（4.png 低模） | daniel-light（2-white.png 浅色） | daniel-dark（2.png 深色） | sooah（3.png 黏土） |
|---|---|---|---|---|
| gamedesk/desk | 浅橡薄台 + 白抽屉柜 + 黑踢脚 | 白薄板 + 四细木腿 + 白柜 | 近黑薄板 + 黑方腿 + 横档 | 厚桃木板 + 方木腿 + 前挡板 |
| ldesk | 同上 L 形 + 白柜 | 白 L 形 + 双白柜 | 黑 L 形 + 黑方腿 | 厚板 L 形 + 方木腿 |
| gamechair | 深灰五爪 + 高背头枕 | 白布高背 + 四细木腿 | 海军蓝 + 铬五星脚 | 浅粉圆座方背 + 白柱白爪黑轮 |
| monitor/ultrawide/dualmon | 暖橙屏 + 黑细颈扁座 | 冷白屏白框白圆座 | 曲面冷白屏黑座 | 浅粉厚框 + 木短座 |
| tv | 近黑薄屏 + 黑座 | 白框冷白屏 | 近黑屏 | 浅粉厚框 + 木座 |
| sofa/armchair/beanbag | 深灰方软包 + 黑底 | 白布 + 白细木腿 + 白垫浅蓝垫 | 海军蓝 + 黑底短脚 | 浅粉矮胖 + 米白垫 |
| bed | 浅橡床头 + 白垫深灰尾巾 | 白床箱床头 + 白垫 | 黑床箱 + 暖木床头 | 桃木床头 + 白垫粉尾 |
| coffeetable/sidetable | 白台 + 木框底 | 浅木厚盒 + 白瓶书 | 黑薄板细腿 + 陶罐 | 桃木厚板矮柜 |
| rug | 米灰双层 | 米灰 + 黑菱形贴图 | 橙灰米白大格 | 浅粉圆角 + 米白内层 |
| plant/reed | 深盆 + 5 裂叶 / 小盆4叶 | 白盆高叶 / 同左 | 陶盆密叶 | 木钵肉叶 |
| bookshelf/wallshelf | 高架 + 白箱 + 橙/蓝块 | 三层壁板 + 立书绿植 | 通高暖木格 + 暖光点/陶罐玻璃罩 | 厚板 + 托架 + 粉盒 |
| cabinet/wardrobe/figurecab/drawerchest/tvstand | 白柜 + 暗槽门 / 木电视柜 / 玻璃手办格 | 白柜 + 白顶 + 暗槽 | 左黑门右暖木屉 | 浅粉矮胖柜 + 白顶木拉手 |
| pegboard | 浅橡板 + 孔 + 白盒 | 浅木板 + 孔 | 暖木板 + 密孔 | 厚板 + 大圆孔 + 小层板 |
| acoustic/painting | 粉板 + 木条 / 粉画 | 白框粉黄画 | 黑框浅灰画 | 木框白心 |
| curtain/wallcloth | 蓝双幅 / 浅蓝布 | 白三幅 / 白布 | 近黑四幅 | 米白三幅厚布 |
| clock | 黑盘白针 | 木环 | 黑线框环 + 辐条 | 桃木厚盘白心黑针 |
| guitar | 黑身木颈 | 木身 | 黑身木颈 | 矮胖木琴（占位不断层） |
| books | 4 色立书 | 白书 | 暖木书 | 粉白叠书 |
| keyboard | 黑底黑键 | 白底白键 | 黑底深键 | 浅紫底白键 |
| mouse/mousepad | 黑鼠 / 深灰垫 | 白圆鼠 / 浅灰垫 | 黑鼠 / 近黑垫 | 粉圆鼠 / 粉垫 |
| phone | 黑机橙屏 | 黑机冷白屏 | 黑机冷白屏 | 粉机浅粉屏 |
| pctower/console | 木塔黑灯 / 黑机 | 白塔 / 浅灰机 | 黑塔冷光条 / 黑机 | 粉箱玻璃侧黑风扇 / 紫机 |
| deskspeaker/micarm/headset/ledbar/desklamp/floorlamp/controldeck | 黑箱 / 黑臂白椭圆灯头 / 头梁耳罩 / 串灯 | 白箱 / 白臂 / 白梁 / 白杆暖罩 | 黑箱 / 黑臂圆头 / 黑梁 / 三脚暖罩 | 紫箱 / 白座黑臂麦 / 粉梁粉罩 / 串灯暖球 / 浅蓝小灯 |
| penholder/organizer/deskset/underbox/slippers | 白筒黑笔 / 白格 / 白盒橙块 / 木盒 / 灰拖 | 白筒 / 白格册 / 玻璃细瓶陶杯蓝盘 / 白盒黑顶 / 褐拖 | 黑筒 / 黑格 / 米盒 / 黑盒 / 黑拖 | 白筒 / 粉格 / 白杯木盖紫盘 / 木盒 / 粉拖 |
| camera/controller | 黑机短镜 / 黑柄 | 黑机 / 白柄 | 黑机 / 黑柄 | 粉机 / 粉柄摇杆 |
| fishtank/flowerbasket/plush/rock/milktea/egg/cubes/plaque/shelfdecor | 木框玻璃缸 / 木篮粉花 / 灰豆白脸 / 灰石 / 白杯黑顶 / 白蛋 / 粉蓝橙块 / 白牌木杆 / 橙块白盒 | 白缸 / 白篮 / 白豆 / 浅石 / 白杯 / 白蛋 / 白块 / 木牌 / 白瓶盒 | 黑缸 / 陶罐 / 蓝豆 / 深石 / 黑杯 / 米蛋 / 黑块 / 黑牌 / 木盒陶罐 | 玻璃球蓝水紫鱼木座 / 木篮粉花 / 粉豆红脚白脸 / 浅石 / 白杯木盖深点 / 白蛋木托 / 木紫块 / 横杆三牌 / 白紫块 |
| fridge/aircon/acwall/cylindricalaircon/purifier | 白盒黑缝 | 白盒金属把 | 黑盒 | 米白圆角盒 |
| piano/treadmill | 黑立式黑白键 / 木跑台黑扶手 | 木琴 / 木跑台 | 黑琴 / 黑跑台 | 浅紫琴铬X架 / 木跑台 |
| stool | 黑方腿木面 | 白面细木腿 | 黑面黑腿 | 桃木圆面三腿 |

## 底线

- station 并排与现状肉眼无差（旧 switch 未动）。
- 四套达到 station 同等零件密度：桌有柜/档，椅有轮/腿，架有格/门/饰，屏有框/颈/座且 `userData.screen=true` 可换画。
