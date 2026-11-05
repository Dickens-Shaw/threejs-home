---
name: furnish-from-image
description: >-
  Fills huxing-pack furniture from pieces drawn on a floor plan, matching the
  floorplan-3d library. Use when a plan image shows furniture, or the user asks
  for 装修, 布置, or 按图摆家具. Every item must set roomId to a room in the
  same JSON. Does not draw new furniture types and does not edit the app.
---

# 按图写家具数据

户型几何已经在同一份 [huxing-pack](../huxing-pack/SKILL.md) 里。只补 `furniture`。不要改墙，不要改项目代码。

每一件必须有 `roomId`，值等于这份 JSON 里 `rooms[].id`。导入靠这个字段判断家具属于哪个房间，不靠坐标猜测。

`type`、`name`、`w`、`d` 用 huxing-pack 那张库表里的一行。宽度差一档时用库里的尺寸。库里没有的种类写进 `notes`，不要新造 `type`。新造型不在这份数据里解决。

`rot` 顺时针。0 时背面朝北。背面贴所靠墙的内皮，中心离内皮 `d / 2`。同一间里不要重叠。

用户只要户型时，`furniture` 保持 `[]`。
