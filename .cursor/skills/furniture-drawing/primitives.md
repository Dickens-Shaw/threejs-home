# 图例与模型零件

文件：`floorplan-3d/index.html`。平面图例在经典脚本，三维在后面的 module 脚本。改类型时两处都要改。

## 平面

```
ST  = stroke #3d3a34, 1px, non-scaling-stroke
rc(x,y,w,h,fill,extra)   矩形，宽高小于 0 时画成 0
ec(cx,cy,rx,ry,fill,extra)
ln(x1,y1,x2,y2,extra)
pa(d,fill,extra)
DASH = stroke-dasharray 4 3
shade(hex,k)   k<1 变暗，k>1 向白靠拢
```

局部盒子从 `(-w/2,-d/2)` 起，宽 `w`、深 `d`。函数签名 `furnSVG(t,w,d,c)`，`c` 是主色。

## 三维

`w`、`d` 已是米。`bz = -d/2` 是背面。`box` / `rbox` / `cyl` 的 y 是底面，零件向上长。`blob` 和 `ring` 的 y 是中心。

| 函数 | 用途 |
| --- | --- |
| `box(w,h,d,mat,x,y,z)` | 硬板、踢脚、缝 |
| `rbox(...,r)` | 软包、圆角台面。`r` 会自动小于半条边 |
| `cyl(rt,rb,h,mat,x,y,z,seg)` | 旋钮、盆、柱 |
| `lathe([[r,h],...], mat, x,y,z, seg)` | 自下而上的旋转体：盆、灯、花瓶、桌脚 |
| `rod(a,b,r0,mat,r1)` | 两点圆杆。`r0` 在 a 端，收分腿用细的底 |
| `tube(pts,r,mat)` | 龙头、灯臂、扶手 |
| `blob(rx,ry,rz,mat,x,y,z)` | 靠垫、叶片、豆袋 |
| `shell(w,d,h,t,r,mat,x,y,z)` | 中空圆角框：浴缸、水槽沿 |
| `legs(g,w,d,h,mat,inset,r)` | 四角收分腿 |
| `fronts(g,x0,y0,w,h,z,nx,ny,mat,hd,hy)` | 列×行门板。`hd` 为 `bar` / `knob` / `edge` / `none` |
| `pull` / `knob` | 一般不要直接用，交给 `fronts` |
| `vase(g,x,y,z,r,h,color,R,flowers)` | 花瓶。`R` 是 `rng(...)` |
| `tableLamp(g,x,y,z,scale)` | 台灯 |
| `plate(g,r,x,y,z)` | 盘子 |

材质角色：

| 角色 | 调用 | 看起来 |
| --- | --- | --- |
| 布 | `fabric(c)` | 主色，粗糙 0.96 |
| 木 | `woodM(c)` | 粗糙 0.55 |
| 陶瓷 | `ceramic()` | `#fbfbf9`，很光滑 |
| 铬 | `chrome()` | 龙头、旋钮 |
| 拉手 | `hwMat()` | 暖灰金属 |
| 黑金属 | `blackMetal()` | 桌架、椅脚 |
| 镜 | `mirror()` | 冷灰，低粗糙 |
| 屏幕 | `screenMat(微光)` | 近黑，带一点发光 |
| 灯 | `glowMat()` | 暖白罩 |

`darker(hex,k)`、`lighter(hex,k)` 只用于同一主色的框架和内板。环境反射由 `mat()` 决定：金属或粗糙度低于 0.4 才挂环境贴图。

玻璃和窗框用模块里已经创建的 `glassMat`、`frameMat`。

随机只允许：

```
const R = rng(Math.round(f.w*7 + f.d*13 + f.cx + f.cy));
```

这是 `buildFurniture` 开头的那一个。不要用 `Math.random()`。

## 和库条目的关系

`F(type,name,cx,cy,w,d,rot,color)` 生成摆进户型的记录。库本身不调用它。缩略图用同一 `furnSVG`，四周留 `max(w,d)*0.08` 的空白。

宽深可以在属性面板里改。分支里的个数、门宽、软包条数要随 `w` 和 `d` 变，不能写死成库里的默认尺寸。高度除外，高度是这套模型的常数。
