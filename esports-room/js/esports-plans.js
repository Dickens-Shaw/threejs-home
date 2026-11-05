// 电竞屋三间预设。尺寸对照见 docs/research/xiaoheihe-esports-room.md。外墙是中线，厚 200。家具尺寸用常见零售毫米：
// 27 寸 16:9 屏约 600 宽，34 寸 21:9 约 800 宽，桌面 1600×750，中塔机箱 240×480。
// 这些是品类常规值，不是从某一条帖子描出来的。屏幕、音箱、麦克风、灯带按桌面高度来画，叠在桌子上。

function esportsCorners(f){
  const r = (f.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [[-f.w / 2, -f.d / 2], [f.w / 2, -f.d / 2], [f.w / 2, f.d / 2], [-f.w / 2, f.d / 2]].map(([lx, ly]) => [
    f.cx + lx * c + ly * s,
    f.cy - lx * s + ly * c,
  ]);
}
function esportsAabb(f){
  const cs = esportsCorners(f), xs = cs.map(p => p[0]), ys = cs.map(p => p[1]);
  return {x0:Math.min(...xs), y0:Math.min(...ys), x1:Math.max(...xs), y1:Math.max(...ys)};
}
function esportsOverlap(a, b){
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
function esportsBack(f){
  const r = (f.rot || 0) * Math.PI / 180, ly = -f.d / 2;
  return [f.cx + ly * Math.sin(r), f.cy + ly * Math.cos(r)];
}
function esportsCheck(plan){
  const poly = plan.shellRooms[0].poly;
  const box = {
    x0:Math.min(...poly.map(p => p[0])), y0:Math.min(...poly.map(p => p[1])),
    x1:Math.max(...poly.map(p => p[0])), y1:Math.max(...poly.map(p => p[1])),
  };
  const bad = [];
  for (const f of plan.furniture){
    if (!esportsCorners(f).every(([x, y]) => x >= box.x0 - 2 && x <= box.x1 + 2 && y >= box.y0 - 2 && y <= box.y1 + 2))
      bad.push(f.name + ' 伸出房间');
  }
  const hug = new Set(['gamedesk', 'figurecab', 'tv', 'acoustic', 'pegboard', 'curtain']);
  for (const f of plan.furniture){
    if (!hug.has(f.type)) continue;
    const [x, y] = esportsBack(f);
    const dist = Math.min(Math.abs(x - box.x0), Math.abs(x - box.x1), Math.abs(y - box.y0), Math.abs(y - box.y1));
    if (dist > 40) bad.push(f.name + ' 没有靠墙');
  }
  for (const o of plan.openings){
    const w = plan.walls.find(x => x.id === o.wallId);
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (o.t < 30 || o.t + o.len > L - 30) bad.push(o.id + ' 门窗出墙');
  }
  const floor = new Set(['gamechair', 'pctower', 'figurecab', 'sofa', 'beanbag', 'coffeetable', 'plant', 'console', 'tv', 'armchair', 'sidetable', 'floorlamp']);
  const bodies = plan.furniture.filter(f => floor.has(f.type));
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++){
    if (esportsOverlap(esportsAabb(bodies[i]), esportsAabb(bodies[j])) > 5000)
      bad.push(bodies[i].name + ' 和 ' + bodies[j].name + ' 叠在一起');
  }
  const desks = plan.furniture.filter(f => f.type === 'gamedesk' || f.type === 'ldesk');
  for (const desk of desks) for (const f of plan.furniture){
    if (f.type !== 'gamechair' && f.type !== 'pctower' && f.type !== 'figurecab' && f.type !== 'sofa') continue;
    if (esportsOverlap(esportsAabb(desk), esportsAabb(f)) > 1000) bad.push(desk.name + ' 挡住了 ' + f.name);
  }
  if (bad.length) throw new Error(plan.name + '：' + bad.join('；'));
}
function esportsRoom(spec){
  const id = spec.id, name = spec.name, x1 = spec.x1, y1 = spec.y1, T = 200, h = T / 2;
  const mat = spec.mat || 'carpet';
  const walls = [
    {id:id + 'N', a:[0, 0], b:[x1, 0], thick:T, type:'e'},
    {id:id + 'E', a:[x1, 0], b:[x1, y1], thick:T, type:'e'},
    {id:id + 'S', a:[x1, y1], b:[0, y1], thick:T, type:'e'},
    {id:id + 'W', a:[0, y1], b:[0, 0], thick:T, type:'e'},
  ];
  const openings = [
    {id:id + 'win', kind:'win', wallId:id + 'N', t:spec.winT, len:spec.winLen, sill:1000, head:2400},
    {id:id + 'door', kind:'door', name:'房门', wallId:id + 'S', t:spec.doorT || 220, len:spec.doorLen || 860, head:2100, swing:-1, hinge:'start', entry:true},
  ];
  let n = 1;
  const P = (type, label, cx, cy, w, d, rot, color) => ({id:id + '-' + (n++), type, name:label, cx, cy, w, d, rot:rot || 0, color});
  const poly = [[h, h], [x1 - h, h], [x1 - h, y1 - h], [h, y1 - h]];
  const plan = {
    id, name, walls, openings, bays:[], lintels:[],
    shellRooms:[{id:id + 'room', name, poly, mat, at:[Math.round(x1 / 2), Math.round(y1 / 2)]}],
    rooms:{[id + 'room']:{name, mat}},
    furniture:spec.place(P), demolished:[], measures:[],
    dims:[{horiz:true, at:-760, start:0, segs:[x1]}, {horiz:false, at:-760, start:0, segs:[y1]}],
    roomsLocked:true, presetDims:true,
  };
  esportsCheck(plan);
  return plan;
}
function esportsCompact(){
  const desk = '#34383f', chair = '#3a3f46', screen = '#1d1d1f', wood = '#d8c2a2';
  return esportsRoom({
    id:'es-compact', name:'紧凑单人电竞房', x1:3800, y1:3200, winT:1100, winLen:1600,
    place(P){
      return [
        P('gamedesk', '电竞桌', 1900, 475, 1600, 750, 0, desk),
        P('monitor', '27 寸显示器', 1900, 250, 620, 240, 0, screen),
        P('deskspeaker', '桌面音箱', 1320, 260, 180, 160, 0, '#2b2b2d'),
        P('deskspeaker', '桌面音箱', 2480, 260, 180, 160, 0, '#2b2b2d'),
        P('micarm', '麦克风悬臂', 1280, 640, 420, 360, 0, '#3a3d42'),
        P('headset', '耳机支架', 2500, 640, 180, 180, 0, desk),
        P('ledbar', '灯带', 1900, 180, 1400, 50, 0, screen),
        P('curtain', '遮光帘', 1900, 145, 1700, 80, 0, '#3d3a34'),
        P('gamechair', '电竞椅', 1900, 1280, 680, 700, 180, chair),
        P('rug', '电竞地毯', 1900, 1450, 1400, 1100, 0, '#4a4f55'),
        P('pctower', '机箱', 2920, 360, 240, 480, 0, '#2c3036'),
        P('figurecab', '手办柜', 300, 2000, 900, 400, 90, '#24282e'),
        P('pegboard', '洞洞板', 3680, 1300, 1000, 40, 270, wood),
        P('acoustic', '吸音板', 560, 130, 900, 60, 0, '#4a4f55'),
        P('plant', '绿植', 450, 2850, 450, 450, 0, '#a9c39b'),
      ];
    },
  });
}
function esportsStudio(){
  const desk = '#34383f', chair = '#3a3f46', screen = '#1d1d1f', wood = '#d8c2a2';
  return esportsRoom({
    id:'es-studio', name:'标准电竞房', x1:4600, y1:4200, winT:400, winLen:1600,
    place(P){
      return [
        P('gamedesk', '电竞桌', 1200, 475, 1800, 750, 0, desk),
        P('dualmon', '双屏', 1150, 260, 1240, 250, 0, screen),
        P('deskspeaker', '桌面音箱', 430, 230, 180, 160, 0, '#2b2b2d'),
        P('deskspeaker', '桌面音箱', 1950, 230, 180, 160, 0, '#2b2b2d'),
        P('micarm', '麦克风悬臂', 1000, 640, 420, 360, 0, '#3a3d42'),
        P('headset', '耳机支架', 1750, 640, 180, 180, 0, desk),
        P('ledbar', '灯带', 1200, 180, 1500, 50, 0, screen),
        P('curtain', '遮光帘', 1200, 145, 1700, 80, 0, '#3d3a34'),
        P('gamechair', '电竞椅', 1200, 1280, 680, 700, 180, chair),
        P('pctower', '机箱', 2350, 360, 240, 480, 0, '#2c3036'),
        P('figurecab', '手办柜', 300, 2700, 900, 400, 90, '#24282e'),
        P('acoustic', '吸音板', 3000, 130, 1200, 60, 0, '#4a4f55'),
        P('pegboard', '洞洞板', 1800, 4080, 1100, 40, 180, wood),
        P('tv', '55 寸电视', 4460, 2000, 1230, 80, 270, screen),
        P('sofa', '双人沙发', 2070, 2000, 2100, 900, 90, '#4a4f55'),
        P('coffeetable', '茶几', 3200, 2000, 1000, 520, 0, wood),
        P('rug', '电竞地毯', 3000, 2000, 2400, 1600, 0, '#4a4f55'),
        P('console', '游戏主机', 4200, 2000, 400, 280, 270, screen),
        P('beanbag', '懒人沙发', 3000, 3400, 780, 780, 0, '#6b5d4c'),
        P('plant', '绿植', 500, 3850, 480, 480, 0, '#a9c39b'),
      ];
    },
  });
}
function esportsLounge(){
  const desk = '#34383f', chair = '#3a3f46', screen = '#1d1d1f', wood = '#d8c2a2';
  return esportsRoom({
    id:'es-lounge', name:'客厅电竞角', x1:5400, y1:4400, winT:500, winLen:1600, mat:'wood',
    place(P){
      return [
        P('gamedesk', '电竞桌', 1300, 475, 1600, 750, 0, desk),
        P('ultrawide', '34 寸带鱼屏', 1300, 250, 900, 250, 0, screen),
        P('deskspeaker', '桌面音箱', 620, 250, 180, 160, 0, '#2b2b2d'),
        P('deskspeaker', '桌面音箱', 1980, 250, 180, 160, 0, '#2b2b2d'),
        P('micarm', '麦克风悬臂', 780, 640, 420, 360, 0, '#3a3d42'),
        P('headset', '耳机支架', 1850, 620, 180, 180, 0, desk),
        P('ledbar', '灯带', 1300, 175, 1200, 50, 0, screen),
        P('curtain', '遮光帘', 1300, 145, 1600, 80, 0, '#3d3a34'),
        P('gamechair', '电竞椅', 1300, 1250, 680, 700, 180, chair),
        P('pctower', '机箱', 2300, 380, 240, 480, 0, '#2c3036'),
        P('pegboard', '洞洞板', 120, 1000, 800, 40, 90, wood),
        P('figurecab', '手办柜', 300, 2500, 900, 400, 90, '#24282e'),
        P('acoustic', '吸音板', 2800, 130, 1000, 60, 0, '#4a4f55'),
        P('tv', '65 寸电视', 5260, 2600, 1450, 80, 270, screen),
        P('sofa', '三人沙发', 2470, 2600, 2400, 900, 90, '#4a4f55'),
        P('coffeetable', '茶几', 3700, 2600, 1200, 600, 0, wood),
        P('rug', '电竞地毯', 3400, 2600, 2600, 1800, 0, '#4a4f55'),
        P('console', '游戏主机', 4900, 2600, 400, 280, 270, screen),
        P('beanbag', '懒人沙发', 1400, 3600, 800, 800, 0, '#6b5d4c'),
        P('plant', '绿植', 3900, 4000, 500, 500, 0, '#a9c39b'),
      ];
    },
  });
}
function esportsLibrary(){
  const plans = [esportsCompact(), esportsStudio(), esportsLounge()];
  return {activeId:plans[0].id, plans};
}
