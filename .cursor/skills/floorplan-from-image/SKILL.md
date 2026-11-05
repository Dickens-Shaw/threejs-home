---
name: floorplan-from-image
description: >-
  Reads a floor-plan image and fills the geometry of a huxing-pack JSON:
  centerline walls, doors, windows, bay windows, rooms, floor materials, and
  perimeter dimensions. Use with 户型图, 平面图, 贝壳, 墙, 门窗, 飘窗, 地面材料,
  or 尺寸线. Output is imported by floorplan-3d; this skill does not edit the app.
---

# 从图纸写户型数据

按 [huxing-pack](../huxing-pack/SKILL.md) 交一份 JSON。不要改 `js/`，不要改用户给的原图。

墙、门、窗、飘窗、房间、地面、尺寸都写在那一份里。图上能认出家具、且用户没说只要户型时，`furniture` 也写上，每一件带 `roomId`。对不上家具库的放进 `notes`。

## 落笔前

忽略 logo、指北针、水印。先抄四边印刷尺寸，再标外墙、隔墙、门、窗、飘窗、房间名和地面。

印刷数和墙冲突时，保留共线，改尺寸，不要平均。三室一厅一卫的取舍见 [examples.md](examples.md)。

## 交出去之前

- 每条隔墙只出现一次，两端落在中线上。
- 该共线的墙在同一 x 或同一 y。
- 每个房间有 `at`，点在房间里面，不在墙上。
- 飘窗是 `bays` 里的一条，不是三面手画墙。`counted` 为 false。
- `dims` 留空，除非四边都已改成中线距。墙厚不要单独成段。
- 有家具时，`roomId` 等于某个 `rooms[].id`。
