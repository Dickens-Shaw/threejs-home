// 一套房间数据，每件家具五种画法。电竞黑用家具自己的颜色；其余四种只在三维预览里换外观。
// 浅色 / 深色来自 daniels-home-office-portfolio，低模来自 my-room-in-3d，黏土来自 sooahs-room-folio。
let previewStyle = 'station';
let styleDraw = null;
function setPreviewStyle(id){
  if (ROOM_STYLES[id]) previewStyle = id;
}
function setStyleDraw(id){ styleDraw = id && ROOM_STYLES[id] ? id : null; }
function activeStyleId(){ return styleDraw || previewStyle || 'station'; }
function stylePaint(type, saved){
  const id = activeStyleId();
  if (id === 'station') return saved || '#ddd';
  const look = ROOM_STYLES[id];
  return (look && look.colors && look.colors[type]) || saved || '#ddd';
}
const ROOM_STYLES = {
  station: {
    id:'station', name:'电竞黑',
    floor:'carpet', wall:'#f4f1eb', ceil:'#fbfaf7', frame:'#5d6166',
    bg:'#f7f4ee', ground:'#f2eee7', sun:1, hemi:1, exposure:1.05,
    round:1, screen:'#163044', wallRough:.92,
    walls:{},
    colors:{
      gamedesk:'#34383f', ldesk:'#34383f', gamechair:'#3a3f46', coffeetable:'#d8c2a2', sidetable:'#34383f',
      monitor:'#1d1d1f', ultrawide:'#1d1d1f', dualmon:'#1d1d1f', tv:'#1d1d1f',
      pctower:'#2c3036', console:'#1d1d1f', deskspeaker:'#2b2b2d', micarm:'#3a3d42', headset:'#34383f', ledbar:'#1d1d1f',
      figurecab:'#24282e', rug:'#4a4f55', plant:'#a9c39b', acoustic:'#4a4f55', pegboard:'#d8c2a2', curtain:'#3d3a34', beanbag:'#6b5d4c',
      sofa:'#4a4f55', bed:'#e8d5b5', bookshelf:'#d8c2a2', floorlamp:'#2a2c30', piano:'#1f1d1b',
    },
  },
  'daniel-light': {
    id:'daniel-light', name:'浅色书房',
    floor:'wood', wall:'#f7f6f3', ceil:'#fbfaf7', frame:'#d8c2a2',
    bg:'#eceae6', ground:'#e6e2da', sun:1.25, hemi:1.2, exposure:1.08,
    round:.55, screen:'#e7eef2', wallRough:.94,
    walls:{W:'#f3f1ee'},
    colors:{
      gamedesk:'#f4f1ea', ldesk:'#f7f4ee', gamechair:'#f3f0ea', coffeetable:'#d8c2a2', sidetable:'#f7f4ee',
      monitor:'#f4f1ea', ultrawide:'#f4f1ea', dualmon:'#f4f1ea', tv:'#f4f1ea',
      pctower:'#f4f1ea', console:'#e7e4de', deskspeaker:'#f4f1ea', micarm:'#c8c4bc', headset:'#f4f1ea', ledbar:'#f7f4ee',
      figurecab:'#f7f4ee', rug:'#e4ddd2', plant:'#8eae78', acoustic:'#f3d7d2', pegboard:'#d8c2a2', curtain:'#f7f4ee', beanbag:'#f3f0ea',
      sofa:'#f7f4ee', bed:'#f7f4ee', bookshelf:'#d8c2a2', floorlamp:'#f4f1ea', piano:'#d8c2a2',
    },
  },
  'daniel-dark': {
    id:'daniel-dark', name:'深色书房',
    floor:'walnut', wall:'#1c1b1a', ceil:'#141312', frame:'#8a8174',
    bg:'#121110', ground:'#1a1816', sun:.28, hemi:.42, exposure:1.15,
    round:.5, screen:'#d5e4ee', wallRough:.9,
    walls:{},
    colors:{
      gamedesk:'#1a1a1c', ldesk:'#1a1a1c', gamechair:'#243044', coffeetable:'#1a1a1c', sidetable:'#1a1a1c',
      monitor:'#161616', ultrawide:'#161616', dualmon:'#161616', tv:'#161616',
      pctower:'#1c1c1e', console:'#1c1c1e', deskspeaker:'#1c1c1e', micarm:'#1c1c1e', headset:'#1c1c1e', ledbar:'#c9a36a',
      figurecab:'#8d5a32', rug:'#c46a3a', plant:'#6e8f62', acoustic:'#2a2c30', pegboard:'#8d5a32', curtain:'#1c1b1a', beanbag:'#243044',
      sofa:'#243044', bed:'#243044', bookshelf:'#8d5a32', floorlamp:'#1c1c1e', piano:'#1a1a1c',
    },
  },
  bruno: {
    id:'bruno', name:'低模彩墙',
    floor:'wood', wall:'#f7f4ee', ceil:'#fbfaf7', frame:'#2a2c30',
    bg:'#efeae4', ground:'#e7dfd4', sun:.85, hemi:1.05, exposure:1.06,
    round:.8, screen:'#e07a2f', wallRough:.96,
    walls:{N:'#e7a0c4', W:'#9eb6e0'},
    colors:{
      gamedesk:'#d8c2a2', ldesk:'#d8c2a2', gamechair:'#2a2c30', coffeetable:'#f4f1ea', sidetable:'#d8c2a2',
      monitor:'#1c1c1e', ultrawide:'#1c1c1e', dualmon:'#1c1c1e', tv:'#1c1c1e',
      pctower:'#d8c2a2', console:'#1c1c1e', deskspeaker:'#1c1c1e', micarm:'#1c1c1e', headset:'#1c1c1e', ledbar:'#f4f1ea',
      figurecab:'#f4f1ea', rug:'#cfc8be', plant:'#6e8f62', acoustic:'#e7a0c4', pegboard:'#d8c2a2', curtain:'#9eb6e0', beanbag:'#d5d5d8',
      sofa:'#4a4e54', bed:'#d8c2a2', bookshelf:'#d8c2a2', floorlamp:'#1c1c1e', piano:'#1c1c1e',
    },
  },
  sooah: {
    id:'sooah', name:'黏土暖房',
    floor:'wood', wall:'#ead9d4', ceil:'#f6ebe6', frame:'#e0b090',
    bg:'#f3e6df', ground:'#ead8c8', sun:1.05, hemi:1.25, exposure:1.1,
    round:2.4, screen:'#f3d5e4', wallRough:1,
    walls:{},
    colors:{
      gamedesk:'#e0b090', ldesk:'#e0b090', gamechair:'#f0c3d0', coffeetable:'#e0b090', sidetable:'#f0c3d0',
      monitor:'#f0c3d0', ultrawide:'#f0c3d0', dualmon:'#f0c3d0', tv:'#f0c3d0',
      pctower:'#f0c3d0', console:'#d7c2ee', deskspeaker:'#d7c2ee', micarm:'#2a2c30', headset:'#d9d4d0', ledbar:'#f0c56a',
      figurecab:'#f0c3d0', rug:'#f0c3d0', plant:'#8eae78', acoustic:'#f0c3d0', pegboard:'#e8c4a4', curtain:'#f6ebe6', beanbag:'#f0c3d0',
      sofa:'#f0c3d0', bed:'#f6ebe6', bookshelf:'#e0b090', floorlamp:'#c9d7ea', piano:'#d7c2ee',
    },
  },
};
const STYLE_COLORS = {
  station: {
    keyboard:'#2b2b2d', mouse:'#e8e8ea', mousepad:'#2b2b2d', phone:'#1d1d1f', penholder:'#f4f1ea', organizer:'#2b2b2d', deskset:'#e8e8ea',
    slippers:'#6b5d4c', underbox:'#2b2b2d', painting:'#2b2b2d', wallcloth:'#3d3a34', wallshelf:'#d8c2a2', clock:'#1d1d1f', guitar:'#1f1d1b',
    books:'#c9b8a4', camera:'#1d1d1f', controller:'#1d1d1f', desklamp:'#2a2c30', stool:'#d8c2a2', fishtank:'#d5e7ef', flowerbasket:'#e0b090',
    plush:'#4a4f55', rock:'#8a8680', reed:'#7ea86a', milktea:'#f4f1ea', egg:'#f6ebe6', cubes:'#d8c2a2', plaque:'#d8c2a2', shelfdecor:'#d8c2a2',
    drawerchest:'#2b2b2d', tvstand:'#2b2b2d', controldeck:'#1d1d1f', fridge:'#dfe4e8', aircon:'#f6f7f8', purifier:'#f4f4f2',
  },
  'daniel-light': {
    keyboard:'#f7f4ee', mouse:'#f7f4ee', mousepad:'#e7e4de', phone:'#1d1d1f', penholder:'#f7f4ee', organizer:'#f7f4ee', deskset:'#f7f4ee',
    slippers:'#c4a882', underbox:'#f7f4ee', painting:'#f3d7d2', wallcloth:'#f7f4ee', wallshelf:'#d8c2a2', clock:'#d8c2a2', guitar:'#d8c2a2',
    books:'#e6dccc', camera:'#1d1d1f', controller:'#f4f1ea', desklamp:'#f7f4ee', stool:'#d8c2a2', fishtank:'#d5e7ef', flowerbasket:'#d8c2a2',
    plush:'#e6d3c4', rock:'#d9d0c4', reed:'#8eae78', milktea:'#f7f4ee', egg:'#f7f4ee', cubes:'#f7f4ee', plaque:'#d8c2a2', shelfdecor:'#f7f4ee',
    drawerchest:'#f7f4ee', tvstand:'#f7f4ee', controldeck:'#f7f4ee', fridge:'#f4f1ea', aircon:'#f7f4ee', purifier:'#f7f4ee',
  },
  'daniel-dark': {
    keyboard:'#1c1c1e', mouse:'#1c1c1e', mousepad:'#1c1c1e', phone:'#1c1c1e', penholder:'#1c1c1e', organizer:'#1c1c1e', deskset:'#cfc8be',
    slippers:'#1c1c1e', underbox:'#1c1c1e', painting:'#1c1c1e', wallcloth:'#1c1b1a', wallshelf:'#8d5a32', clock:'#c5c8cc', guitar:'#1a1a1c',
    books:'#8d5a32', camera:'#1c1c1e', controller:'#1c1c1e', desklamp:'#1c1c1e', stool:'#1c1c1e', fishtank:'#1c1c1e', flowerbasket:'#8d5a32',
    plush:'#243044', rock:'#3a3834', reed:'#6e8f62', milktea:'#1c1c1e', egg:'#cfc8be', cubes:'#1c1c1e', plaque:'#1c1c1e', shelfdecor:'#cfc8be',
    drawerchest:'#1c1c1e', tvstand:'#1c1c1e', controldeck:'#1c1c1e', fridge:'#1c1c1e', aircon:'#1c1c1e', purifier:'#1c1c1e',
  },
  bruno: {
    keyboard:'#1c1c1e', mouse:'#1c1c1e', mousepad:'#2a2c30', phone:'#1c1c1e', penholder:'#f4f1ea', organizer:'#f4f1ea', deskset:'#f4f1ea',
    slippers:'#d9d4d0', underbox:'#d8c2a2', painting:'#e7a0c4', wallcloth:'#9eb6e0', wallshelf:'#d8c2a2', clock:'#1c1c1e', guitar:'#1c1c1e',
    books:'#d8c2a2', camera:'#1c1c1e', controller:'#1c1c1e', desklamp:'#f4f1ea', stool:'#d8c2a2', fishtank:'#d5e7ef', flowerbasket:'#d8c2a2',
    plush:'#cfc8be', rock:'#b7b1a6', reed:'#6e8f62', milktea:'#f4f1ea', egg:'#f4f1ea', cubes:'#e07a2f', plaque:'#f4f1ea', shelfdecor:'#e07a2f',
    drawerchest:'#f4f1ea', tvstand:'#d8c2a2', controldeck:'#f4f1ea', fridge:'#f4f1ea', aircon:'#f4f1ea', purifier:'#f4f1ea',
  },
  sooah: {
    keyboard:'#d7c2ee', mouse:'#f0c3d0', mousepad:'#f0c3d0', phone:'#f0c3d0', penholder:'#f7f4ee', organizer:'#f0c3d0', deskset:'#f0c3d0',
    slippers:'#f0c3d0', underbox:'#e0b090', painting:'#e0b090', wallcloth:'#f6ebe6', wallshelf:'#e0b090', clock:'#e0b090', guitar:'#e0b090',
    books:'#f0c3d0', camera:'#f0c3d0', controller:'#f0c3d0', desklamp:'#c9d7ea', stool:'#e0b090', fishtank:'#d5e7ef', flowerbasket:'#e0b090',
    plush:'#f0c3d0', rock:'#d9d0c4', reed:'#8eae78', milktea:'#f0c3d0', egg:'#f6ebe6', cubes:'#e0b090', plaque:'#e0b090', shelfdecor:'#f0c3d0',
    drawerchest:'#f0c3d0', tvstand:'#e0b090', controldeck:'#d7c2ee', fridge:'#f6ebe6', aircon:'#f6ebe6', purifier:'#f0c3d0',
  },
};
Object.entries(STYLE_COLORS).forEach(([id, cols]) => Object.assign(ROOM_STYLES[id].colors, cols));
// 缺的 4 个 type 补齐（与 LIB 对齐）
Object.assign(ROOM_STYLES.station.colors, {cabinet:'#d8c2a2', acwall:'#f6f7f8', cylindricalaircon:'#ffffff', treadmill:'#3a3a3c'});
Object.assign(ROOM_STYLES['daniel-light'].colors, {cabinet:'#f7f4ee', acwall:'#f7f4ee', cylindricalaircon:'#f7f4ee', treadmill:'#d8c2a2'});
Object.assign(ROOM_STYLES['daniel-dark'].colors, {cabinet:'#1c1c1e', acwall:'#1c1c1e', cylindricalaircon:'#1c1c1e', treadmill:'#1a1a1c'});
Object.assign(ROOM_STYLES.bruno.colors, {cabinet:'#f4f1ea', acwall:'#f4f1ea', cylindricalaircon:'#f4f1ea', treadmill:'#d8c2a2'});
Object.assign(ROOM_STYLES.sooah.colors, {cabinet:'#f0c3d0', acwall:'#f6ebe6', cylindricalaircon:'#f6ebe6', treadmill:'#e0b090'});
// 五套皮：同一几何 + 换材质配色。palette 覆盖 10 个角色，round 控制倒角倍率，tex 控制程序纹理强度，light 控制灯光。
ROOM_STYLES.station.skin = {
  palette:{'木':'#d8c2a2', '布':'#4a4f55', '陶瓷':'#fbfbf9', '铬':'#eef0f2', '黑金属':'#2b2b2d', '拉手':'#b9b3a8', '镜':'#d5dde4', '玻璃':'#cfe6ef', '屏幕':'#163044', '灯':'#ffdca0'},
  prop:{roughWood:.55, roughCloth:.96, roughCeramic:.12, metalBlack:.6, glow:.5}, detail:1, tex:{wood:1, cloth:0, clay:0, metal:.5},
};
ROOM_STYLES['daniel-light'].skin = {
  palette:{'木':'#dcc09a', '布':'#f7f4ee', '陶瓷':'#fbfbf9', '铬':'#eef0f2', '黑金属':'#3a3a3c', '拉手':'#b9b3a8', '镜':'#e2e8ec', '玻璃':'#d5e7ef', '屏幕':'#e7eef2', '灯':'#ffdca0'},
  prop:{roughWood:.6, roughCloth:.94, roughCeramic:.15, metalBlack:.45, glow:.35}, detail:1, tex:{wood:1, cloth:.6, clay:0, metal:.3},
};
ROOM_STYLES['daniel-dark'].skin = {
  palette:{'木':'#8d5a32', '布':'#243044', '陶瓷':'#e8e2d6', '铬':'#d5d7db', '黑金属':'#1c1c1e', '拉手':'#8a8174', '镜':'#c5c8cc', '玻璃':'#9fb3c2', '屏幕':'#d5e4ee', '灯':'#e7b56a'},
  prop:{roughWood:.5, roughCloth:.92, roughCeramic:.2, metalBlack:.45, glow:1}, detail:1, tex:{wood:1, cloth:.4, clay:0, metal:.6},
};
ROOM_STYLES.bruno.skin = {
  palette:{'木':'#d8c2a2', '布':'#4a4e54', '陶瓷':'#f4f1ea', '铬':'#cfd2d4', '黑金属':'#1c1c1e', '拉手':'#8a8174', '镜':'#dfeaee', '玻璃':'#d5e7ef', '屏幕':'#e07a2f', '灯':'#fff4dc'},
  prop:{roughWood:.7, roughCloth:.9, roughCeramic:.35, metalBlack:.45, glow:.6}, detail:.55, tex:{wood:.25, cloth:0, clay:0, metal:.2},
};
ROOM_STYLES.sooah.skin = {
  palette:{'木':'#e0b090', '布':'#f0c3d0', '陶瓷':'#f6ebe6', '铬':'#e8e2d6', '黑金属':'#2a2c30', '拉手':'#c9a27a', '镜':'#ead8c8', '玻璃':'#d5e7ef', '屏幕':'#f3d5e4', '灯':'#ffb84a'},
  prop:{roughWood:.85, roughCloth:.9, roughCeramic:.5, metalBlack:0, glow:.8}, detail:.5, tex:{wood:0, cloth:.35, clay:1, metal:0},
};
function roomSkin(id){ return (roomStyle(id).skin) || ROOM_STYLES.station.skin; }
const BILL_ORDER = ['桌椅', '屏幕', '外设', '装饰', '坐卧', '家电', '休闲'];
const BILL_CAT = {
  gamedesk:'桌椅', ldesk:'桌椅', gamechair:'桌椅', coffeetable:'桌椅', sidetable:'桌椅', desk:'桌椅', chair:'桌椅', table:'桌椅', keyboard:'桌椅', stool:'桌椅', drawerchest:'桌椅',
  monitor:'屏幕', ultrawide:'屏幕', dualmon:'屏幕', tv:'屏幕', phone:'屏幕',
  pctower:'外设', console:'外设', deskspeaker:'外设', micarm:'外设', headset:'外设', ledbar:'外设', floorlamp:'外设', desklamp:'外设', mouse:'外设', mousepad:'外设', controldeck:'外设',
  figurecab:'装饰', cabinet:'装饰', rug:'装饰', plant:'装饰', acoustic:'装饰', pegboard:'装饰', curtain:'装饰', beanbag:'装饰', bookshelf:'装饰', tvstand:'装饰',
  penholder:'装饰', organizer:'装饰', deskset:'装饰', slippers:'装饰', underbox:'装饰', painting:'装饰', wallcloth:'装饰', wallshelf:'装饰',
  clock:'装饰', guitar:'装饰', books:'装饰', camera:'装饰', controller:'装饰', fishtank:'装饰', flowerbasket:'装饰', plush:'装饰',
  rock:'装饰', reed:'装饰', milktea:'装饰', egg:'装饰', cubes:'装饰', plaque:'装饰', shelfdecor:'装饰',
  sofa:'坐卧', bed:'坐卧', armchair:'坐卧',
  fridge:'家电', aircon:'家电', acwall:'家电', cylindricalaircon:'家电', purifier:'家电',
  piano:'休闲', treadmill:'休闲',
};
function roomStyle(id){
  return ROOM_STYLES[id] || ROOM_STYLES.station;
}
function billOf(furniture){
  const groups = {};
  BILL_ORDER.forEach(cat => { groups[cat] = []; });
  (furniture || []).forEach(f => {
    const cat = BILL_CAT[f.type] || '装饰';
    if (!groups[cat]) groups[cat] = [];
    const key = f.type + '|' + f.name + '|' + f.w + '|' + f.d;
    let row = groups[cat].find(r => r.key === key);
    if (!row){
      row = {key, type:f.type, name:f.name, w:f.w, d:f.d, color:f.color, n:0};
      groups[cat].push(row);
    }
    row.n++;
    row.color = f.color || row.color;
  });
  return BILL_ORDER.filter(cat => groups[cat] && groups[cat].length).map(cat => ({cat, rows:groups[cat]}));
}
