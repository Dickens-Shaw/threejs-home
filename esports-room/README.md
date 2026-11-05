# 电竞屋搭建

在浏览器里摆一间电竞屋：平面图、三维鸟瞰和漫游。编辑器来自同仓库的 [floorplan-3d](../floorplan-3d/)，这一份只做电竞屋，不改住宅户型。

三间预设：紧凑单人、标准电竞房、客厅电竞角。显示器、音箱、麦克风和灯带按桌面高度来画，叠在桌子上。存档键是 `esports-plans-v1`。模型是程序画的，没有实拍，也没有品牌标志。尺寸来源见 [docs/research/xiaoheihe-esports-room.md](../docs/research/xiaoheihe-esports-room.md)。

```bash
cd esports-room
python3 -m http.server 8000
```

打开 `http://localhost:8000/`。三维通过 jsDelivr 加载 Three.js r160，第一次进入三维需要联网。

许可沿用上游 MIT：Copyright (c) 2026 wuyi。原文在 [LICENSE](LICENSE)。
