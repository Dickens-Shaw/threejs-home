/* ======================= 多语言（中文 / English，默认中文） ======================= */
const LANG_KEY = 'huxing-lang';
const LANGS = ['zh', 'zht', 'en'];             // 简体 / 繁體（台湾用字）/ English
let LANG = (() => { try { const l = localStorage.getItem(LANG_KEY); return LANGS.includes(l) ? l : 'zh'; } catch(e) { return 'zh'; } })();
// 简 → 繁：先按词替换一字多义的字，再逐字查表（表由 OpenCC s2tw 按本页用到的字生成）
const S2T_PHRASES = [['布置','佈置'],['布局','佈局'],['台面','檯面'],['复制','複製'],['全部折叠','全部折疊'],['全部展开','全部展開'],['搜索家具','搜尋家具'],['没有匹配的家具','沒有相符的家具'],['自定义','自訂']];
const S2T = new Map(('与與两兩个個为為书書于於仅僅从從价價会會传傳体體余餘侧側倾傾储儲儿兒关關内內写寫净淨准準击擊则則刚剛删刪制製办辦动動势勢区區单單占佔卧臥卫衛厅廳历歷压壓厨廚双雙发發变變叶葉后後吗嗎听聽启啟哑啞围圍图圖圆圓场場坐座块塊垫墊墙牆处處备備复復头頭妆妝婴嬰实實宽寬对對导導层層屉屜属屬岛島带帶干乾并並库庫应應开開当當径徑态態总總悬懸懒懶户戶护護拟擬择擇挂掛挡擋挤擠损損换換据據摆擺摇搖撑撐数數无無时時显顯暂暫机機杂雜杆桿条條来來松鬆构構柜櫃标標栈棧栏欄样樣梁樑棱稜椭橢横橫橱櫥气氣没沒注註浅淺测測浏瀏游遊滚滾满滿灯燈灵靈点點热熱状狀独獨环環现現电電画畫监監盖蓋盘盤砖磚确確离離积積称稱竖豎筑築签籤类類约約级級线線结結绕繞绘繪给給统統继繼绿綠缀綴编編缝縫缩縮网網联聯脚腳获獲虚虛装裝见見视視览覽触觸计計认認让讓议議记記设設识識译譯该該语語请請读讀调調负負败敗质質贴貼赶趕转轉轮輪软軟轴軸轻輕载載较較辅輔辑輯边邊过過这這进進远遠适適选選邻鄰里裡针針钢鋼钮鈕铰鉸铺鋪销銷锁鎖键鍵镜鏡长長门門闭閉闲閒间間阅閱阳陽阴陰阶階随隨隐隱静靜页頁顶頂项項顺順颜顏飘飄飞飛马馬鸟鳥齐齊龙龍').match(/../gu).map(p => [...p]));
const s2t = s => S2T_PHRASES.reduce((a, [f, t]) => a.replaceAll(f, t), s).replace(/[\u3400-\u9fff]/g, c => S2T.get(c) || c);
const tr = (zh, en) => LANG === 'en' ? en : LANG === 'zht' ? s2t(zh) : zh;
// 内置的房间 / 材料 / 家具名称存的是中文；英文界面下显示译名，用户自己改过的名称原样显示
const NAMES_EN = {
  '主卧室':'Master Bedroom', '主卫浴':'Master Bath', '小孩房':"Kids' Room", '客卫浴':'Guest Bath', '洗衣阳台':'Laundry Balcony',
  '子女房':"Children's Room", '厨房':'Kitchen', '餐厅':'Dining', '过道':'Hallway', '客厅':'Living Room', '休闲阳台':'Leisure Balcony',
  '主卧飘窗':'Master Bay Window', '子女房飘窗':"Children's Bay Window", '飘窗':'Bay Window',
  '未命名':'Untitled', '未命名户型':'Untitled plan', '三室两厅两卫':'3BR 2LR 2BA',
  '三室一厅一卫':'3BR 1LR 1BA', '卧室A':'Bedroom A', '卧室B':'Bedroom B', '卧室C':'Bedroom C',
  '橡木地板':'Oak Flooring', '胡桃木地板':'Walnut Flooring', '800 地砖':'800 Tile', '600 地砖':'600 Tile', '大理石':'Marble',
  '300 防滑砖':'300 Anti-slip Tile', '水磨石':'Terrazzo', '满铺地毯':'Wall-to-wall Carpet',
  '卧室':'Bedroom', '餐厨':'Dining & Kitchen', '卫浴':'Bathroom', '家电':'Appliances', '书房 · 休闲':'Study & Leisure', '自定义':'Custom',
  '双人床 1.8m':'Double Bed 1.8m', '双人床 1.5m':'Double Bed 1.5m', '双人床':'Double Bed', '单人床':'Single Bed', '婴儿床':'Crib',
  '床头柜':'Nightstand', '衣柜':'Wardrobe', '小衣柜':'Small Wardrobe', '梳妆台':'Dresser', '书桌':'Desk', '椅子':'Chair',
  '书架':'Bookshelf', '飘窗垫':'Bay Cushion', '三人沙发':'3-Seat Sofa', '双人沙发':'Loveseat', '转角沙发':'Corner Sofa',
  '单人沙发':'Armchair', '懒人沙发':'Beanbag', '茶几':'Coffee Table', '边几':'Side Table', '电视柜':'TV Stand', '地毯':'Rug',
  '鞋柜':'Shoe Cabinet', '玄关柜':'Entry Cabinet', '通顶鞋柜':'Tall Shoe Cabinet', '落地灯':'Floor Lamp', '绿植':'Plant', '大绿植':'Large Plant',
  '餐桌':'Dining Table', '六人餐桌':'6-Seat Dining Table', '圆桌':'Round Table', '餐椅':'Dining Chair', '岛台':'Kitchen Island',
  '吧椅':'Bar Stool', '橱柜台面':'Kitchen Counter', '燃气灶':'Gas Stove', '水槽':'Sink', '冰箱':'Fridge', '餐边柜':'Sideboard',
  '马桶':'Toilet', '浴室柜':'Vanity', '双盆浴室柜':'Double Vanity', '淋浴房':'Shower', '淋浴区':'Shower Area', '浴缸':'Bathtub',
  '洗衣机':'Washer', '洗衣池':'Laundry Sink', '电热水器':'Water Heater', '储物柜':'Storage Cabinet', '65 寸电视':'65" TV',
  '55 寸电视':'55" TV', '对开门冰箱':'French-door Fridge', '柜机空调':'Floor AC', '挂机空调':'Wall AC', '洗碗机':'Dishwasher',
  '蒸烤箱高柜':'Oven Tower', '烘干机':'Dryer', '空气净化器':'Air Purifier', '长书桌':'Long Desk', '办公椅':'Office Chair',
  '大书架':'Large Bookshelf', '立式钢琴':'Upright Piano', '跑步机':'Treadmill', '阅读椅':'Reading Chair', '茶桌':'Tea Table', '休闲椅':'Lounge Chair',
};
const nm = s => LANG === 'en' ? (NAMES_EN[s] ?? s) : LANG === 'zht' ? s2t(s) : s;
// 静态文案：元素上写 data-en / data-en-title，中文原文首次切换时存进 dataset
function applyStaticLang(){
  document.documentElement.lang = {zh:'zh-CN', zht:'zh-TW', en:'en'}[LANG];
  document.title = tr('户型装修设计', 'Floor Plan Designer');
  document.querySelectorAll('[data-en]').forEach(el => { el.dataset.zh ??= el.textContent; el.textContent = tr(el.dataset.zh, el.dataset.en); });
  document.querySelectorAll('[data-en-title]').forEach(el => { el.dataset.zhTitle ??= el.title; el.title = tr(el.dataset.zhTitle, el.dataset.enTitle); });
  document.querySelectorAll('#langSel [data-lang], #homeLang [data-lang]').forEach(b => { const on = b.dataset.lang === LANG; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
}

/* ============================================================
 *  户型数据（单位 mm，原点 = 左侧外墙内皮 / 顶部外墙内皮）
 *  所有数值均按原始户型图尺寸标注推算：
 *  上：1580/240/2760/240/1540/240/3670 = 10270
 *  下：2180/240/2160/240/5450/240/1340 = 11850
 *  左：3370/1580/240/2770/240/2360 = 10560
 *  右：3370/240/2760/240/3950 = 10560
 * ============================================================ */
// 墙体：[x0,y0,x1,y1,类型]  b=承重(黑) e=外墙 n=可拆非承重 low=矮墙
const SEED_WALLS = [
  // 顶部外墙
  [1580,-240,2120,0,'b'],[1580,0,1820,300,'b'],[2120,-240,4580,0,'e'],[4580,-240,5140,0,'e'],
  [5760,-240,6050,0,'e'],[6050,-240,6600,0,'b'],[6360,0,6600,300,'b'],[6600,-240,9960,0,'e'],
  [9960,-240,10510,0,'b'],[10270,0,10510,300,'b'],
  // 右侧外墙
  [10270,300,10510,800,'e'],[10270,2600,10510,3090,'e'],[10270,3090,10510,4260,'b'],
  [10270,5740,10510,6370,'b'],[9960,6370,10510,6610,'b'],[10270,6610,10510,7400,'b'],
  [10270,9770,10510,10560,'b'],[9960,10560,10510,10800,'b'],
  // 底部 / 阳台
  [4580,10560,9960,10800,'e'],[10510,10560,12090,10800,'e'],[11850,9960,12090,10560,'e'],
  // 客厅左墙（入户门两侧）
  [4580,9200,4820,10560,'e'],[4580,7960,4820,8310,'e'],
  // 餐厅 / 厨房外墙
  [3620,7960,4580,8200,'e'],[2180,7960,3620,8200,'b'],[2180,7590,2420,7960,'b'],[2180,7400,2420,7590,'n'],
  [-240,7960,2180,8200,'e'],[-240,3610,0,7960,'e'],
  // 洗衣阳台
  [0,4950,200,5190,'n'],[200,4950,1275,5190,'low'],[1580,3370,2420,3825,'b'],
  [2180,4430,2420,5796,'n'],[2090,4950,2180,5190,'n'],
  // 客卫
  [2420,4950,4580,5190,'n'],[4580,3280,4820,4075,'n'],[4580,4860,4820,5190,'n'],[2420,3370,4580,3610,'n'],
  // 小孩房 / 主卫
  [4580,0,4820,2400,'n'],[4820,2080,6360,2320,'n'],[6360,300,6600,1198,'n'],[6360,1983,6600,2400,'n'],
  // 过道 / 主卧 / 子女房
  [6083,3370,6600,3707,'b'],[6360,3280,6600,3370,'n'],[6600,3370,9960,3610,'n'],[9960,3370,10270,3610,'b'],
  [6083,4600,6323,6610,'n'],[6323,6370,9960,6610,'n'],
];
// 窗
const SEED_WINS = [
  [5140,-240,5760,0],[1580,300,1820,3370],[-240,3370,1580,3610],[2180,3825,2420,4430],
  [10510,6370,12090,6610],[11850,6610,12090,9960],
  // 飘窗（主卧 / 子女房）
  [10510,660,11130,760],[11030,760,11130,2650],[10510,2650,11130,2750],
  [10510,4110,11130,4210],[11030,4210,11130,5785],[10510,5785,11130,5885],
];
// 平开门：洞口、铰点、关闭方向、开启方向、门宽
const SEED_DOORS = [
  {name:'小孩房门',rect:[4580,2400,4820,3280],h:[4580,3280],c:[0,-1],o:[-1,0],len:880},
  {name:'主卧门',rect:[6360,2400,6600,3280],h:[6600,3280],c:[0,-1],o:[1,0],len:880},
  {name:'主卫门',rect:[6360,1198,6600,1983],h:[6360,1198],c:[0,1],o:[-1,0],len:785},
  {name:'客卫门',rect:[4580,4075,4820,4860],h:[4580,4860],c:[0,-1],o:[-1,0],len:785},
  {name:'子女房门',rect:[6083,3707,6323,4600],h:[6323,4600],c:[0,-1],o:[1,0],len:893},
  {name:'入户门',rect:[4580,8310,4820,9200],h:[4820,9200],c:[0,-1],o:[1,0],len:890,entry:true},
];
// 推拉门
const SEED_SLIDES = [
  {rect:[10270,7400,10510,9770],v:true},
  {rect:[1275,4950,2090,5190],v:false},
];
const R = (x0,y0,x1,y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const SEED_ROOMS = [
  {id:'master', name:'主卧室', poly:R(6600,0,10270,3370), mat:'wood', at:[8435,2420]},
  {id:'mbath', name:'主卫浴', poly:R(4820,0,6360,2080), mat:'antislip', at:[5980,1780]},
  {id:'kid', name:'小孩房', poly:R(1820,0,4580,3370), mat:'wood', at:[3380,2330]},
  {id:'gbath', name:'客卫浴', poly:R(2420,3610,4580,4950), mat:'antislip', at:[3760,4620]},
  {id:'laundry', name:'洗衣阳台', poly:R(0,3610,2180,4950), mat:'antislip', at:[1250,4330]},
  {id:'child', name:'子女房', poly:R(6323,3610,10270,6370), mat:'wood', at:[8850,4850]},
  {id:'kitchen', name:'厨房', poly:R(0,5190,2180,7960), mat:'tile600', at:[1300,6500]},
  {id:'dining', name:'餐厅', poly:[[2420,5190],[4820,5190],[4820,7960],[2420,7960],[2420,7400],[2180,7400],[2180,5796],[2420,5796]], mat:'tile800', at:[3900,5520]},
  {id:'hall', name:'过道', poly:[[4820,2320],[6360,2320],[6360,3370],[6083,3370],[6083,6610],[4820,6610]], mat:'tile800', at:[5450,4450]},
  {id:'living', name:'客厅', poly:R(4820,6610,10270,10560), mat:'tile800', at:[7600,7560]},
  {id:'balcony', name:'休闲阳台', poly:R(10510,6610,11850,10560), mat:'walnut', at:[11180,9450]},
  {id:'bay1', name:'主卧飘窗', poly:[[10270,800],[10510,800],[10510,760],[11030,760],[11030,2650],[10510,2650],[10510,2600],[10270,2600]], mat:'marble', counted:false},
  {id:'bay2', name:'子女房飘窗', poly:[[10270,4260],[10510,4260],[10510,4210],[11030,4210],[11030,5785],[10510,5785],[10510,5740],[10270,5740]], mat:'marble', counted:false},
];
const MATS = {
  wood:    {name:'橡木地板', price:320, sw:'#d8b88a'},
  walnut:  {name:'胡桃木地板', price:380, sw:'#9b7250'},
  tile800: {name:'800 地砖', price:220, sw:'#ebe6dc'},
  tile600: {name:'600 地砖', price:160, sw:'#dfe3e1'},
  marble:  {name:'大理石', price:650, sw:'#f1eee8'},
  antislip:{name:'300 防滑砖', price:140, sw:'#d3d8d4'},
  terrazzo:{name:'水磨石', price:280, sw:'#e6dfd3'},
  carpet:  {name:'满铺地毯', price:200, sw:'#c9c3d3'},
};
// 家具库：[类型, 名称, 宽, 深, 颜色]
const LIB = [
  {cat:'卧室', items:[
    ['bed','双人床 1.8m',1800,2000,'#c9d6df'],['bed','双人床 1.5m',1500,2000,'#d8c7dc'],['bed','单人床',1200,2000,'#e8d5b5'],
    ['crib','婴儿床',1250,700,'#efe3d0'],['nightstand','床头柜',450,400,'#e8dccb'],['wardrobe','衣柜',2000,600,'#efe6d8'],
    ['wardrobe','小衣柜',1200,550,'#efe6d8'],['dresser','梳妆台',1000,450,'#efe6d8'],['desk','书桌',1200,600,'#e2cfb4'],
    ['chair','椅子',450,480,'#cfc6b8'],['bookshelf','书架',800,300,'#e2cfb4'],['baycushion','飘窗垫',520,1800,'#e7dccd']]},
  {cat:'客厅', items:[
    ['sofa','三人沙发',2400,900,'#b7c4b0'],['sofa','双人沙发',1700,880,'#c3cbd6'],['cornersofa','转角沙发',2800,1700,'#b7c4b0'],
    ['armchair','单人沙发',850,850,'#d6b99a'],['beanbag','懒人沙发',800,800,'#e0b98f'],['coffeetable','茶几',1300,650,'#e8dccb'],
    ['nesttable','大小圆茶几',1190,640,'#e9e5de'],
    ['sidetable','边几',500,500,'#d9c3a3'],['tvstand','电视柜',2400,400,'#e2cfb4'],['rug','地毯',2400,1700,'#d9cbb8'],
    ['shoecab','鞋柜',1000,350,'#efe6d8'],['shoecab','玄关柜',1400,380,'#e6dccc'],['shoecol','通顶鞋柜',800,320,'#eef1f3'],['floorlamp','落地灯',450,450,'#3d3a34'],
    ['plant','绿植',500,500,'#a9c39b'],['plant','大绿植',700,700,'#9dbb8c']]},
  {cat:'餐厨', items:[
    ['table','餐桌',1400,800,'#e2cfb4'],['table','六人餐桌',1800,900,'#d8c2a2'],['roundtable','圆桌',1000,1000,'#e2cfb4'],
    ['chair','餐椅',450,480,'#cfc6b8'],['island','岛台',1800,900,'#e9e5de'],['barstool','吧椅',420,420,'#6b5d4c'],
    ['counter','橱柜台面',1600,600,'#e9e5de'],['stove','燃气灶',750,450,'#dcdcdc'],['ksink','水槽',800,450,'#e1e6ea'],
    ['fridge','冰箱',700,700,'#dfe4e8'],['cabinet','餐边柜',1600,400,'#efe6d8'],['winecab','酒柜',1600,400,'#e6dccc']]},
  {cat:'卫浴', items:[
    ['toilet','马桶',400,700,'#ffffff'],['vanity','浴室柜',800,500,'#eef1f3'],['vanity','双盆浴室柜',1200,500,'#eef1f3'],
    ['shower','淋浴房',900,900,'#e4edf2'],['bathtub','浴缸',1600,750,'#eef3f6'],['washer','洗衣机',600,600,'#e6ebee'],
    ['waterheater','电热水器',800,450,'#f4f4f2'],['gasheater','燃气热水器',335,163,'#e6dccc'],['cabinet','储物柜',1000,400,'#efe6d8']]},
  {cat:'家电', items:[
    ['tv','65 寸电视',1450,80,'#1d1d1f'],['tv','55 寸电视',1230,80,'#1d1d1f'],['fridge','对开门冰箱',910,700,'#c9ced3'],
    ['aircon','柜机空调',500,380,'#f6f7f8'],['acwall','挂机空调',900,250,'#f6f7f8'],['dishwasher','洗碗机',600,600,'#c9ced3'],
    ['ovencol','蒸烤箱高柜',600,600,'#efe6d8'],['dryer','烘干机',600,600,'#e6ebee'],['purifier','空气净化器',400,300,'#f4f4f2']]},
  {cat:'书房 · 休闲', items:[
    ['desk','长书桌',1600,700,'#d8c2a2'],['officechair','办公椅',620,620,'#4a4f55'],['bookshelf','大书架',1600,350,'#e2cfb4'],
    ['piano','立式钢琴',1500,600,'#1f1d1b'],['treadmill','跑步机',800,1800,'#3a3a3c'],['armchair','阅读椅',750,800,'#c9a98a']]},
];
const typeColor = t => { for (const c of LIB) for (const i of c.items) if (i[0]===t) return i[4]; return '#eee'; };

let _n = 1;
const uid = () => 'f' + Date.now().toString(36) + (_n++);
const wid = () => 'w' + Date.now().toString(36) + (_n++);
const oid = () => 'o' + Date.now().toString(36) + (_n++);
const pid = () => 'p' + Date.now().toString(36) + (_n++);
const rid = () => 'r' + Date.now().toString(36) + (_n++);
const F = (type,name,cx,cy,w,d,rot=0,color) => ({id:uid(),type,name,cx,cy,w,d,rot,color:color||typeColor(type)});

function defaultFurniture(){ return [
  // 主卧
  F('bed','双人床',8300,1000,1800,2000,0,'#c9d6df'), F('nightstand','床头柜',7150,220,450,400), F('nightstand','床头柜',9450,220,450,400),
  F('wardrobe','衣柜',8800,3070,2400,600,180), F('baycushion','飘窗垫',10770,1705,520,1800),
  // 主卫
  F('shower','淋浴房',5270,450,900,900), F('toilet','马桶',5170,1500,400,700,270), F('vanity','浴室柜',6110,700,800,500,90),
  // 小孩房
  F('bed','单人床',2420,1000,1200,2000,0,'#e8d5b5'), F('desk','书桌',2120,2700,1200,600,270), F('chair','椅子',2700,2700,450,480,90),
  F('wardrobe','衣柜',4280,1000,1600,600,90), F('bookshelf','书架',3500,150,800,300),
  // 客卫
  F('shower','淋浴区',2870,4280,900,1340), F('toilet','马桶',3560,3960,400,700), F('vanity','浴室柜',4150,3850,700,480),
  // 洗衣阳台
  F('washer','洗衣机',300,3960,600,600,270), F('vanity','洗衣池',250,4600,600,500,270),
  // 厨房
  F('counter','橱柜台面',300,6575,2770,600,270), F('counter','橱柜台面',1390,7660,1580,600,180),
  F('stove','燃气灶',300,6200,750,450,270), F('ksink','水槽',1400,7680,800,450,180),
  // 餐厅
  F('fridge','冰箱',2770,5540,700,700), F('table','餐桌',3600,6650,1400,800,90),
  F('chair','餐椅',2940,6320,450,480,270), F('chair','餐椅',2940,6980,450,480,270),
  F('chair','餐椅',4260,6320,450,480,90), F('chair','餐椅',4260,6980,450,480,90),
  F('cabinet','餐边柜',3500,7785,1600,350,180),
  // 客厅
  F('rug','地毯',7600,8950,2600,1800), F('tvstand','电视柜',7600,6810,2400,400), F('sofa','三人沙发',7600,10110,3000,900,180),
  F('coffeetable','茶几',7600,8900,1300,650), F('armchair','单人沙发',9500,8900,850,850,90),
  F('shoecab','鞋柜',4995,9900,1000,350,270), F('plant','绿植',9950,10250,500,500), F('plant','绿植',5250,7050,500,500),
  // 子女房
  F('bed','双人床',7323,5500,1500,2000,270,'#d8c7dc'), F('wardrobe','衣柜',8500,3910,2000,600),
  F('desk','书桌',9500,6070,1200,600,180), F('chair','椅子',9500,5480,450,480), F('baycushion','飘窗垫',10770,4997,520,1575),
  // 休闲阳台
  F('roundtable','茶桌',11180,8200,600,600), F('armchair','休闲椅',11180,7520,750,750,0,'#d6b99a'),
  F('armchair','休闲椅',11180,8880,750,750,180,'#d6b99a'), F('plant','绿植',11550,10250,500,500),
];}

function wallLen(w){
  return Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
}
function wallQuad(w){
  const ax = w.a[0], ay = w.a[1], bx = w.b[0], by = w.b[1];
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, t = w.thick / 2;
  const px = -dy / L * t, py = dx / L * t;
  return [[ax + px, ay + py], [bx + px, by + py], [bx - px, by - py], [ax - px, ay - py]];
}
function polyArea(poly){
  let a = 0;
  for (let i = 0; i < poly.length; i++){
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
function rectToWall(rect, i){
  const [x0, y0, x1, y1, type] = rect;
  const ww = x1 - x0, hh = y1 - y0;
  if (ww >= hh) return {id:'w' + i, a:[x0, (y0 + y1) / 2], b:[x1, (y0 + y1) / 2], thick:hh, type};
  return {id:'w' + i, a:[(x0 + x1) / 2, y0], b:[(x0 + x1) / 2, y1], thick:ww, type};
}

const keyOf = (x, y) => Math.round(x) + ',' + Math.round(y);

function pointOnSeg(p, a, b){
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  if (L2 < 1) return false;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  if (t <= 0.001 || t >= 0.999) return false;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) < 1.2;
}
function segCross(a, b, c, d){
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-6) return null;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) return {x:a.x + t * rx, y:a.y + t * ry};
  return null;
}

function extractFaces(walls, opts){
  const keepHull = !!(opts && opts.keepHull);
  const src = walls.filter(w => wallLen(w) > 2).map(w => ({
    a:{x:w.a[0], y:w.a[1]}, b:{x:w.b[0], y:w.b[1]}, thick:w.thick || 240, bayId:w.bayId || null,
  }));
  const cuts = src.map(() => []);
  for (let i = 0; i < src.length; i++) for (let j = i + 1; j < src.length; j++){
    const A = src[i], B = src[j];
    const hit = segCross(A.a, A.b, B.a, B.b);
    if (hit){ cuts[i].push(hit); cuts[j].push(hit); }
    for (const p of [A.a, A.b]) if (pointOnSeg(p, B.a, B.b)) cuts[j].push(p);
    for (const p of [B.a, B.b]) if (pointOnSeg(p, A.a, A.b)) cuts[i].push(p);
  }
  const segs = [];
  src.forEach((s, i) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, L2 = dx * dx + dy * dy;
    const ts = [0, 1];
    for (const p of cuts[i]){
      const t = ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / L2;
      if (t > 0.001 && t < 0.999) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    let prev = 0;
    for (const t of ts){
      if (t - prev < 0.0008) { prev = t; continue; }
      const a = {x:s.a.x + prev * dx, y:s.a.y + prev * dy}, b = {x:s.a.x + t * dx, y:s.a.y + t * dy};
      if (Math.hypot(b.x - a.x, b.y - a.y) > 2) segs.push({a, b, thick:s.thick, bayId:s.bayId});
      prev = t;
    }
  });
  const pts = new Map();
  const at = p => {
    const k = keyOf(p.x, p.y);
    if (!pts.has(k)) pts.set(k, {x:p.x, y:p.y});
    return k;
  };
  const adj = new Map();
  const link = (u, v, thick, bayId) => {
    if (u === v) return;
    if (!adj.has(u)) adj.set(u, []);
    if (adj.get(u).some(e => e.key === v)) return;
    const p = pts.get(u), q = pts.get(v);
    adj.get(u).push({key:v, ang:Math.atan2(q.y - p.y, q.x - p.x), thick, bayId});
  };
  for (const s of segs){
    const u = at(s.a), v = at(s.b);
    link(u, v, s.thick, s.bayId); link(v, u, s.thick, s.bayId);
  }
  for (const outs of adj.values()) outs.sort((a, b) => a.ang - b.ang);
  const used = new Set();
  const faces = [];
  for (const [uk, outs] of adj) for (const e0 of outs){
    const start = uk + '>' + e0.key;
    if (used.has(start)) continue;
    const poly = [], thicks = [], bays = [];
    let u = uk, v = e0.key, guard = 0, closed = false;
    while (guard++ < 4000){
      const dk = u + '>' + v;
      if (used.has(dk) && dk !== start) break;
      used.add(dk);
      poly.push(pts.get(u));
      const edge = adj.get(u).find(x => x.key === v);
      thicks.push(edge.thick); bays.push(edge.bayId);
      const around = adj.get(v);
      const back = around.findIndex(x => x.key === u);
      if (back < 0) break;
      const nxt = around[(back - 1 + around.length) % around.length];
      u = v; v = nxt.key;
      if (u + '>' + v === start){ closed = true; break; }
    }
    if (!closed || poly.length < 3) continue;
    faces.push({poly, thicks, bays});
  }
  const seen = new Set(), uniq = [];
  for (const f of faces){
    const s = f.poly.map(p => Math.round(p.x) + ',' + Math.round(p.y));
    const rot = arr => { let k = 0; for (let i = 1; i < arr.length; i++) if (arr[i] < arr[k]) k = i; return arr.slice(k).concat(arr.slice(0, k)).join(';'); };
    const rev = [...s].reverse();
    const ck = [rot(s), rot(rev)].sort()[0];
    if (seen.has(ck)) continue;
    seen.add(ck); uniq.push(f);
  }
  const withArea = uniq.map(f => ({...f, area:polyArea(f.poly.map(p => [p.x, p.y]))}));
  if (!keepHull && withArea.length >= 2){
    const max = Math.max(...withArea.map(f => f.area));
    const rest = withArea.reduce((s, f) => s + f.area, 0) - max;
    if (max >= rest * 0.98){
      const i = withArea.findIndex(f => f.area === max);
      withArea.splice(i, 1);
    }
  }
  return withArea.filter(f => f.area > 0.3e6);
}

function centroid(poly){
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < poly.length; i++){
    const p = poly[i], q = poly[(i + 1) % poly.length], c = p[0] * q[1] - q[0] * p[1];
    a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1) return {x:poly.reduce((s, p) => s + p[0], 0) / poly.length, y:poly.reduce((s, p) => s + p[1], 0) / poly.length};
  return {x:x / (3 * a), y:y / (3 * a)};
}
function lineHit(A, B){
  const den = A.dx * B.dy - A.dy * B.dx;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((B.px - A.px) * B.dy - (B.py - A.py) * B.dx) / den;
  return [A.px + t * A.dx, A.py + t * A.dy];
}
function dropSpurs(face){
  let poly = face.poly.slice(), thicks = face.thicks.slice(), bays = face.bays.slice(), guard = 0;
  while (poly.length >= 4 && guard++ < 30){
    let hit = -1;
    for (let i = 0; i < poly.length; i++){
      const prev = poly[(i + poly.length - 1) % poly.length], next = poly[(i + 1) % poly.length];
      if (Math.hypot(prev.x - next.x, prev.y - next.y) < 1.5){ hit = i; break; }
    }
    if (hit < 0) break;
    const n = poly.length, ip = (hit + n - 1) % n, inx = (hit + 1) % n;
    thicks[ip] = thicks[inx]; bays[ip] = bays[inx];
    for (const k of [hit, inx].sort((a, b) => b - a)){ poly.splice(k, 1); thicks.splice(k, 1); bays.splice(k, 1); }
  }
  return poly.length >= 3 ? {poly, thicks, bays} : face;
}
function simplifyFace(face){
  const n = face.poly.length, keep = [];
  for (let i = 0; i < n; i++){
    const a = face.poly[(i + n - 1) % n], b = face.poly[i], c = face.poly[(i + 1) % n];
    const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - b.x, by = c.y - b.y;
    const cross = Math.abs(ax * by - ay * bx);
    const len = Math.hypot(ax, ay) * Math.hypot(bx, by);
    const prev = (i + n - 1) % n;
    const sameThick = Math.abs((face.thicks[prev] || 0) - (face.thicks[i] || 0)) < 1;
    const sameBay = (face.bays[prev] || null) === (face.bays[i] || null);
    if (sameThick && sameBay && ax * bx + ay * by > 0 && cross < len * 1e-3 + 1) continue;
    keep.push(i);
  }
  if (keep.length < 3) return face;
  return {poly:keep.map(i => face.poly[i]), thicks:keep.map(i => face.thicks[i]), bays:keep.map(i => face.bays[i])};
}
function insetFace(face){
  face = simplifyFace(dropSpurs(face));
  const raw = face.poly.map(p => [p.x, p.y]);
  const c = centroid(raw);
  const lines = raw.map((a, i) => {
    const b = raw[(i + 1) % raw.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if ((c.x - mx) * nx + (c.y - my) * ny < 0){ nx = -nx; ny = -ny; }
    const o = (face.thicks[i] || 240) / 2;
    return {px:a[0] + nx * o, py:a[1] + ny * o, dx, dy};
  });
  const out = [];
  for (let i = 0; i < lines.length; i++){
    const hit = lineHit(lines[i], lines[(i + 1) % lines.length]);
    if (!hit) return raw;
    out.push(hit);
  }
  if (polyArea(out) < polyArea(raw) * 0.15) return raw;
  return out;
}
function pip(poly, x, y){
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inn = !inn;
  }
  return inn;
}
function computeRooms(walls, oldRooms = []){
  const faces = extractFaces(walls).map(f => {
    const poly = insetFace(f);
    const bayLen = f.bays.reduce((s, b, i) => s + (b ? Math.hypot(f.poly[(i + 1) % f.poly.length].x - f.poly[i].x, f.poly[(i + 1) % f.poly.length].y - f.poly[i].y) : 0), 0);
    const per = f.poly.reduce((s, p, i) => { const q = f.poly[(i + 1) % f.poly.length]; return s + Math.hypot(q.x - p.x, q.y - p.y); }, 0);
    const c = centroid(poly);
    return {poly, bay:per > 0 && bayLen / per > 0.45, cx:c.x, cy:c.y, area:polyArea(poly)};
  }).filter(f => f.area > 0.3e6).sort((a, b) => b.area - a.area);
  const used = new Set();
  return faces.map(f => {
    const bay = f.bay;
    let best = null, bestA = Infinity;
    for (const o of oldRooms){
      if (used.has(o.id)) continue;
      if ((o.counted === false) !== bay) continue;
      if (pip(o.poly, f.cx, f.cy)){
        const A = polyArea(o.poly);
        if (A < bestA){ bestA = A; best = o; }
      }
    }
    if (best) used.add(best.id);
    return {
      id: best ? best.id : rid(),
      name: best ? best.name : (bay ? '飘窗' : '未命名'),
      mat: best ? best.mat : (bay ? 'marble' : 'tile800'),
      poly: f.poly.map(p => [Math.round(p[0]), Math.round(p[1])]),
      at: [Math.round(f.cx), Math.round(f.cy)],
      counted: bay ? false : true,
    };
  });
}

function wallAabb(w){
  const q = wallQuad(w), xs = q.map(p => p[0]), ys = q.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function wallById(id){ return state.walls.find(w => w.id === id); }
function sliceWall(w, t0, t1){
  const L = wallLen(w) || 1, ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
  return {...w, a:[w.a[0] + ux * t0, w.a[1] + uy * t0], b:[w.a[0] + ux * t1, w.a[1] + uy * t1]};
}
function alongWall(w, t){
  const L = wallLen(w) || 1, ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
  return {x:w.a[0] + ux * t, y:w.a[1] + uy * t, ux, uy, L};
}
function projectT(x, y, w){
  const L = wallLen(w) || 1;
  const t = ((x - w.a[0]) * (w.b[0] - w.a[0]) + (y - w.a[1]) * (w.b[1] - w.a[1])) / L;
  return Math.max(0, Math.min(L, t));
}
function distToSeg(x, y, a, b){
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  if (L2 < 1) return Math.hypot(x - a[0], y - a[1]);
  let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
function solidSpans(w){
  const L = wallLen(w);
  const holes = state.openings.filter(o => o.wallId === w.id).slice().sort((a, b) => a.t - b.t);
  const spans = [];
  let t = 0;
  for (const h of holes){
    const a = Math.max(0, h.t), b = Math.min(L, h.t + h.len);
    if (b <= a) continue;
    if (a > t + 1) spans.push([t, a]);
    t = Math.max(t, b);
  }
  if (L > t + 1) spans.push([t, L]);
  return {holes, spans, L};
}
function openingFrame(op, w){
  const L = wallLen(w) || 1;
  const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
  const swing = op.swing || 1, hingeEnd = op.hinge === 'end';
  const tH = hingeEnd ? op.t + op.len : op.t;
  const sl = sliceWall(w, op.t, op.t + op.len), q = wallQuad(sl);
  const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
  return {
    h:[w.a[0] + ux * tH, w.a[1] + uy * tH],
    c:[ux * (hingeEnd ? -1 : 1), uy * (hingeEnd ? -1 : 1)],
    o:[uy * swing, -ux * swing],
    len:op.len, quad:q,
    rect:[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}
function entryDoor(){
  const op = (state.openings || []).find(o => o.kind === 'door' && o.entry);
  if (!op) return null;
  if (!op.wallId) return op;
  const w = wallById(op.wallId);
  return w ? Object.assign({}, op, openingFrame(op, w)) : null;
}
function buildingCenter(){
  let x = 0, y = 0, n = 0;
  for (const w of state.walls){ x += w.a[0] + w.b[0]; y += w.a[1] + w.b[1]; n += 2; }
  return n ? {x:x / n, y:y / n} : {x:0, y:0};
}
// 外轮廓面上的尺寸：分段跟着外墙折线，总长再向外一道。手写 dims / 原图尺寸优先。
function outerFace(walls){
  const faces = extractFaces(walls, {keepHull:true});
  if (faces.length < 2) return null;
  let max = faces[0], rest = 0;
  for (const f of faces){ if (f.area > max.area) max = f; rest += f.area; }
  rest -= max.area;
  if (max.area + 1 < rest * 0.98) return null;
  return max;
}
function uniqSorted(vals){
  const a = vals.filter(v => isFinite(v)).sort((p, q) => p - q), out = [];
  for (const v of a) if (!out.length || v - out[out.length - 1] > 1) out.push(v);
  return out;
}
function axisEdges(poly){
  const h = [], v = [];
  for (let i = 0; i < poly.length; i++){
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 2) continue;
    if (Math.abs(a.y - b.y) <= 2) h.push({y:(a.y + b.y) / 2, x0:Math.min(a.x, b.x), x1:Math.max(a.x, b.x)});
    else if (Math.abs(a.x - b.x) <= 2) v.push({x:(a.x + b.x) / 2, y0:Math.min(a.y, b.y), y1:Math.max(a.y, b.y)});
  }
  return {h, v};
}
function extremeAlong(edges, at, max, horizontal){
  let v = max ? -Infinity : Infinity, hit = false;
  for (const e of edges){
    const lo = horizontal ? e.x0 : e.y0, hi = horizontal ? e.x1 : e.y1, cross = horizontal ? e.y : e.x;
    if (at <= lo + 0.5 || at >= hi - 0.5) continue;
    v = max ? Math.max(v, cross) : Math.min(v, cross);
    hit = true;
  }
  return hit ? v : null;
}
function profileBreaks(coords, sample){
  const c = uniqSorted(coords);
  if (c.length < 2) return c;
  const marks = [c[0], c[c.length - 1]];
  let prev = null;
  for (let i = 0; i < c.length - 1; i++){
    const v = sample((c[i] + c[i + 1]) / 2);
    if (v == null){ prev = null; continue; }
    if (prev != null && Math.abs(v - prev) > 3) marks.push(c[i]);
    prev = v;
  }
  return marks;
}
function onSilhouette(points, sample, alongOf, crossOf){
  const extra = [];
  for (const p of points){
    const along = alongOf(p), cross = crossOf(p);
    const hits = [sample(along - 2), sample(along + 2)];
    if (hits.some(v => v != null && Math.abs(v - cross) <= 3)) extra.push(along);
  }
  return extra;
}
function addProfile(out, horiz, innerAt, outward, breaks){
  const seq = uniqSorted(breaks.map(v => Math.round(v)));
  if (seq.length < 2) return;
  const segs = [];
  for (let i = 0; i < seq.length - 1; i++) if (seq[i + 1] > seq[i]) segs.push(seq[i + 1] - seq[i]);
  if (!segs.length) return;
  out.push({horiz, at:Math.round(innerAt), start:seq[0], segs});
  if (segs.length > 1) out.push({horiz, at:Math.round(innerAt + outward * 520), start:seq[0], segs:[segs.reduce((s, v) => s + v, 0)]});
}
function wallOuterBox(walls){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of walls){
    if (!(wallLen(w) > 2)) continue;
    for (const p of wallQuad({...w, thick:w.thick || 200})){
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
  }
  return isFinite(x0) ? {x0, y0, x1, y1} : null;
}
function shellDims(walls){
  const list = (walls || []).filter(w => wallLen(w) > 2);
  const box = wallOuterBox(list);
  if (!box) return [];
  const face = outerFace(list);
  const poly = face ? face.poly : null;
  if (!poly || poly.length < 3){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const w of list){ x0 = Math.min(x0, w.a[0], w.b[0]); y0 = Math.min(y0, w.a[1], w.b[1]); x1 = Math.max(x1, w.a[0], w.b[0]); y1 = Math.max(y1, w.a[1], w.b[1]); }
    if (!(x1 > x0 && y1 > y0)) return [];
    return [
      {horiz:true, at:Math.round(box.y0 - 780), start:Math.round(x0), segs:[Math.round(x1 - x0)]},
      {horiz:true, at:Math.round(box.y1 + 780), start:Math.round(x0), segs:[Math.round(x1 - x0)]},
      {horiz:false, at:Math.round(box.x0 - 780), start:Math.round(y0), segs:[Math.round(y1 - y0)]},
      {horiz:false, at:Math.round(box.x1 + 780), start:Math.round(y0), segs:[Math.round(y1 - y0)]},
    ];
  }
  const {h, v} = axisEdges(poly);
  const topAt = x => extremeAlong(h, x, false, true);
  const botAt = x => extremeAlong(h, x, true, true);
  const leftAt = y => extremeAlong(v, y, false, false);
  const rightAt = y => extremeAlong(v, y, true, false);
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  const top = uniqSorted(profileBreaks(xs, topAt).concat(onSilhouette(poly, topAt, p => p.x, p => p.y)));
  const bot = uniqSorted(profileBreaks(xs, botAt).concat(onSilhouette(poly, botAt, p => p.x, p => p.y)));
  const left = uniqSorted(profileBreaks(ys, leftAt).concat(onSilhouette(poly, leftAt, p => p.y, p => p.x)));
  const right = uniqSorted(profileBreaks(ys, rightAt).concat(onSilhouette(poly, rightAt, p => p.y, p => p.x)));
  const out = [];
  const GAP = 780;
  addProfile(out, true, box.y0 - GAP, -1, top);
  addProfile(out, true, box.y1 + GAP, 1, bot);
  addProfile(out, false, box.x0 - GAP, -1, left);
  addProfile(out, false, box.x1 + GAP, 1, right);
  return out;
}
function planDimChains(plan){
  if (plan.dims && plan.dims.length) return plan.dims;
  if (plan.presetDims) return null;
  return shellDims(plan.walls || []);
}
function fitBounds(plan){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const w of plan.walls || []) for (const p of wallQuad(w)) add(p[0], p[1]);
  for (const o of plan.openings || []) if (o.rect){ add(o.rect[0], o.rect[1]); add(o.rect[2], o.rect[3]); }
  for (const d of planDimChains(plan) || []){
    let cursor = d.start;
    const pts = [cursor];
    for (const v of d.segs || []){ cursor += v; pts.push(cursor); }
    for (const p of pts) d.horiz ? add(p, d.at) : add(d.at, p);
  }
  if (!isFinite(x0)){ plan.bounds = {x:-800, y:-800, w:11600, h:9600}; return; }
  const pad = 800;
  plan.bounds = {x:x0 - pad, y:y0 - pad, w:(x1 - x0) + pad * 2, h:(y1 - y0) + pad * 2};
}
function bayFrame(b){
  const host = wallById(b.wallId);
  if (!host) return null;
  const p0 = alongWall(host, b.t), p1 = alongWall(host, b.t + b.len);
  const mid = {x:(p0.x + p1.x) / 2, y:(p0.y + p1.y) / 2}, c = buildingCenter();
  let nx = p0.uy, ny = -p0.ux;
  if ((c.x - mid.x) * nx + (c.y - mid.y) * ny > 0){ nx = -nx; ny = -ny; }
  const depth = b.depth || 620;
  return {host, p0, p1, nx, ny, depth, q0:[p0.x + nx * depth, p0.y + ny * depth], q1:[p1.x + nx * depth, p1.y + ny * depth]};
}
function bayAt(x, y){
  return (state.bays || []).find(b => {
    const fr = bayFrame(b);
    return fr && pip([[fr.p0.x, fr.p0.y], fr.q0, fr.q1, [fr.p1.x, fr.p1.y]], x, y);
  });
}
function bayPieces(host, b){
  const fr = bayFrame(b);
  if (!fr) return {walls:[], openings:[]};
  const {p0, p1, q0, q1} = fr;
  return {
    walls:[
      {id:b.id + 's0', a:[p0.x, p0.y], b:q0, thick:100, type:'e', bayId:b.id},
      {id:b.id + 's1', a:[p1.x, p1.y], b:q1, thick:100, type:'e', bayId:b.id},
      {id:b.id + 'f', a:q0, b:q1, thick:100, type:'e', bayId:b.id},
    ],
    openings:[
      {id:b.id + 'h', kind:'hole', wallId:host.id, t:b.t, len:b.len, head:2400, bayId:b.id},
      {id:b.id + 'win', kind:'win', wallId:b.id + 'f', t:80, len:Math.max(200, b.len - 160), sill:450, head:2400, bayId:b.id},
    ],
  };
}
function refreshBays(){
  const keepW = state.walls.filter(w => !w.bayId);
  const keepO = state.openings.filter(o => !o.bayId);
  state.bays = (state.bays || []).filter(b => keepW.some(w => w.id === b.wallId));
  const pieces = [], opens = [], keepB = [];
  for (const b of state.bays){
    const host = keepW.find(w => w.id === b.wallId);
    const L = wallLen(host);
    b.len = Math.min(b.len, L - 60);
    if (b.len < 500) continue;
    b.t = Math.max(30, Math.min(b.t, L - b.len - 30));
    const built = bayPieces(host, b);
    pieces.push(...built.walls); opens.push(...built.openings); keepB.push(b);
  }
  state.bays = keepB;
  state.walls = keepW.concat(pieces);
  state.openings = keepO.concat(opens);
}
function clampOpenings(){
  state.openings = state.openings.filter(o => !o.wallId || o.bayId || wallById(o.wallId));
  for (const o of state.openings){
    if (!o.wallId || o.bayId) continue;
    const L = wallLen(wallById(o.wallId));
    o.len = Math.max(200, Math.min(o.len, L - 20));
    o.t = Math.max(10, Math.min(o.t, L - o.len - 10));
  }
}
function applyPlan(p){
  state = p;
  WALLS = p.walls;
  const free = (p.openings || []).filter(o => !o.wallId);
  WINS = free.filter(o => o.kind === 'win');
  DOORS = free.filter(o => o.kind === 'door');
  SLIDES = free.filter(o => o.kind === 'slide');
  ROOMS = p.shellRooms || [];
  BOUNDS = p.bounds;
  p.rooms = p.rooms || {};
  for (const r of ROOMS){
    if (!p.rooms[r.id]) p.rooms[r.id] = {name:r.name, mat:r.mat || 'tile800'};
    if (!MATS[p.rooms[r.id].mat]) p.rooms[r.id].mat = 'tile800';
  }
  if (library){
    const i = library.plans.findIndex(x => x.id === p.id);
    if (i >= 0){ library.plans[i] = p; library.activeId = p.id; }
    else if (library.rooms){
      const r = library.rooms.findIndex(x => x.id === p.id);
      if (r >= 0) library.rooms[r] = p;
    }
  }
}
function touchShell(){
  refreshBays();
  clampOpenings();
  state.presetDims = false;
  state.dims = [];
  state.roomsLocked = false;
  try {
    const old = (state.shellRooms || []).map(r => ({
      id:r.id, name:state.rooms[r.id]?.name || r.name, mat:state.rooms[r.id]?.mat || r.mat,
      poly:r.poly, at:r.at, counted:r.counted,
    }));
    const next = computeRooms(state.walls, old);
    state.shellRooms = next;
    const keep = new Set(next.map(r => r.id));
    for (const r of next) if (!state.rooms[r.id]) state.rooms[r.id] = {name:r.name, mat:r.mat};
    for (const id of Object.keys(state.rooms)) if (!keep.has(id)) delete state.rooms[id];
  } catch(err){
    console.error(err);
    toast(tr('房间轮廓没有算出来，墙体修改已保留', 'Could not recompute rooms; the wall change was kept'));
  }
  fitBounds(state);
  applyPlan(state);
}
function seedPlan(){
  const walls = SEED_WALLS.map(rectToWall);
  const openings = [];
  SEED_WINS.forEach((rect, i) => {
    const sill = i === 0 ? 1400 : i >= 6 ? 450 : 900;
    openings.push({id:'win' + i, kind:'win', rect:rect.slice(), sill, head:2400});
  });
  SEED_DOORS.forEach((d, i) => openings.push({
    id:'door' + i, kind:'door', name:d.name, rect:d.rect.slice(), h:d.h.slice(), c:d.c.slice(), o:d.o.slice(),
    len:d.len, entry:!!d.entry, head:2100,
  }));
  SEED_SLIDES.forEach((s, i) => openings.push({id:'slide' + i, kind:'slide', rect:s.rect.slice(), v:!!s.v, head:s.v ? 2400 : 2100}));
  const shellRooms = SEED_ROOMS.map(r => ({id:r.id, name:r.name, poly:r.poly.map(p => p.slice()), mat:r.mat, at:r.at ? r.at.slice() : undefined, counted:r.counted}));
  const rooms = {};
  shellRooms.forEach(r => rooms[r.id] = {name:r.name, mat:r.mat});
  return {
    id:'seed', name:'三室两厅两卫', walls, openings, bays:[],
    lintels:[{rect:[10270, 800, 10510, 2600], head:2400}, {rect:[10270, 4260, 10510, 5740], head:2400}],
    shellRooms, rooms, furniture:defaultFurniture(), demolished:[], measures:[],
    bounds:{x:-1850, y:-1750, w:15600, h:14100}, roomsLocked:true, presetDims:true,
  };
}
function mergeLegacy(plan){
  try {
    const old = JSON.parse(localStorage.getItem('huxing-design-v1'));
    if (!old || !Array.isArray(old.furniture)) return;
    plan.furniture = old.furniture;
    plan.demolished = Array.isArray(old.demolished) ? old.demolished : [];
    plan.measures = Array.isArray(old.measures) ? old.measures : [];
    if (old.rooms) for (const id of Object.keys(plan.rooms)){
      if (old.rooms[id]) plan.rooms[id] = {name:old.rooms[id].name || plan.rooms[id].name, mat:old.rooms[id].mat || plan.rooms[id].mat};
    }
  } catch(e) {}
}
function normalizePlan(s){
  s.walls = s.walls || []; s.openings = s.openings || []; s.bays = s.bays || []; s.lintels = s.lintels || [];
  s.shellRooms = s.shellRooms || []; s.rooms = s.rooms || {}; s.furniture = s.furniture || [];
  s.demolished = s.demolished || []; s.measures = s.measures || [];
  if (s.roomsLocked == null) s.roomsLocked = false;
  if (s.presetDims == null) s.presetDims = false;
  if (!Array.isArray(s.dims)) s.dims = [];
  if (!s.name) s.name = '未命名户型';
  if (!s.id) s.id = pid();
  if (!s.shellRooms.length && s.walls.length){
    s.shellRooms = computeRooms(s.walls, []);
    for (const r of s.shellRooms) if (!s.rooms[r.id]) s.rooms[r.id] = {name:r.name, mat:r.mat};
  }
  if (!s.bounds || !s.presetDims) fitBounds(s);
  return s;
}
function beikePlan(){
  // 墙中线跟图纸轴线走，厚度 200。上边 2135 / 2450 / 1906 / 1285，
  // 右边 2235 / 457 / 3246 / 2795 / 1357，都落在实际墙上。
  // 卧室 C 西墙与厨房东墙同一条线；卧室 B 西墙与卫生间西墙同一条线；
  // 卫生间南墙与卧室 A 南墙对齐，入户台阶在 A 的西墙，台阶以南是客厅；
  // 起居北墙与卧室 B 北墙同一条线；卧室 A 比 B 再向东凸出 1285。
  // 原图左边 2259+616+5338+2119=10332，右边合计 10090，两边差 242，
  // 且 616 与右边的 457 不是同一道坎，左边尺寸线改成实际墙距。
  // 原图下边 1921、3015 与上边轴线差约一堵墙，2536 与卧室 A 的中线宽度一致，下边按对齐后的墙距标注。
  const T = 200, h = T / 2;
  const xL = 0, xCw = 2135, xCe = 4585, xBw = 3462, xAw = 5240, xBe = 6491, xAe = 7776;
  const yCn = 0, yN = 2235, yCs = 2692, yBs = 5938, yBtn = 7030, yAs = 8733, yKn = 7971, yS = 10090;
  const walls = [
    {id:'bkW', a:[xL, yN], b:[xL, yS], thick:T, type:'e'},
    {id:'bkN', a:[xL, yN], b:[xCw, yN], thick:T, type:'e'},
    {id:'bkCn', a:[xCw, yCn], b:[xCe, yCn], thick:T, type:'e'},
    {id:'bkCw', a:[xCw, yCn], b:[xCw, yCs], thick:T, type:'e'},
    {id:'bkCe', a:[xCe, yCn], b:[xCe, yCs], thick:T, type:'e'},
    {id:'bkCs', a:[xCw, yCs], b:[xCe, yCs], thick:T, type:'n'},
    {id:'bkBn', a:[xCe, yN], b:[xBe, yN], thick:T, type:'e'},
    {id:'bkBe', a:[xBe, yN], b:[xBe, yBs], thick:T, type:'e'},
    {id:'bkBs', a:[xBw, yBs], b:[xBe, yBs], thick:T, type:'n'},
    {id:'bkAn', a:[xBe, yBs], b:[xAe, yBs], thick:T, type:'e'},
    {id:'bkBw', a:[xBw, yCs], b:[xBw, yBs], thick:T, type:'n'},
    {id:'bkAw', a:[xAw, yBs], b:[xAw, yAs], thick:T, type:'n'},
    {id:'bkAe', a:[xAe, yBs], b:[xAe, yAs], thick:T, type:'e'},
    {id:'bkAs', a:[xAw, yAs], b:[xAe, yAs], thick:T, type:'e'},
    {id:'bkTs', a:[xBw, yAs], b:[xAw, yAs], thick:T, type:'n'},
    {id:'bkStep', a:[xAw, yAs], b:[xAw, yS], thick:T, type:'e'},
    {id:'bkS', a:[xL, yS], b:[xAw, yS], thick:T, type:'e'},
    {id:'bkBtn', a:[xBw, yBtn], b:[xAw, yBtn], thick:T, type:'n'},
    {id:'bkTw', a:[xBw, yBtn], b:[xBw, yAs], thick:T, type:'n'},
    {id:'bkKn', a:[xL, yKn], b:[xCw, yKn], thick:T, type:'n'},
    {id:'bkKe', a:[xCw, yKn], b:[xCw, yS], thick:T, type:'n'},
  ];
  const openings = [
    {id:'bkWinC', kind:'win', wallId:'bkCn', t:300, len:1800, sill:900, head:2400},
    {id:'bkWinL', kind:'win', wallId:'bkW', t:1500, len:1800, sill:900, head:2400},
    {id:'bkWinB', kind:'win', wallId:'bkBe', t:280, len:1500, sill:900, head:2400},
    {id:'bkWinA', kind:'win', wallId:'bkAe', t:500, len:1500, sill:900, head:2400},
    {id:'bkDoorC', kind:'door', wallId:'bkCs', t:250, len:900, head:2100, swing:-1, hinge:'start'},
    {id:'bkDoorB', kind:'door', wallId:'bkBw', t:2140, len:900, head:2100, swing:1, hinge:'end'},
    {id:'bkDoorA', kind:'door', wallId:'bkAw', t:180, len:800, head:2100, swing:-1, hinge:'start'},
    {id:'bkDoorT', kind:'door', wallId:'bkBtn', t:350, len:750, head:2100, swing:-1, hinge:'start'},
    {id:'bkDoorK', kind:'door', wallId:'bkKn', t:1100, len:800, head:2100, swing:-1, hinge:'start'},
    {id:'bkEntry', kind:'door', wallId:'bkS', t:2700, len:900, head:2100, swing:1, hinge:'start', entry:true},
  ];
  const R = (x0,y0,x1,y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  const shellRooms = [
    {id:'bkC', name:'卧室C', poly:R(xCw+h, yCn+h, xCe-h, yCs-h), mat:'wood', at:[3360,1340]},
    {id:'bkB', name:'卧室B', poly:[[xCe+h,yN+h],[xBe-h,yN+h],[xBe-h,yBs-h],[xBw+h,yBs-h],[xBw+h,yCs+h],[xCe+h,yCs+h]], mat:'wood', at:[5400,4200]},
    {id:'bkA', name:'卧室A', poly:R(xAw+h, yBs+h, xAe-h, yAs-h), mat:'wood', at:[6508,7335]},
    {id:'bkT', name:'卫生间', poly:R(xBw+h, yBtn+h, xAw-h, yAs-h), mat:'antislip', at:[4350,7900]},
    {id:'bkK', name:'厨房', poly:R(xL+h, yKn+h, xCw-h, yS-h), mat:'tile600', at:[1100,9100]},
    {id:'bkL', name:'客厅', poly:[
      [xL+h,yN+h],[xCw-h,yN+h],[xCw-h,yCs+h],[xBw-h,yCs+h],[xBw-h,yBs+h],[xAw-h,yBs+h],
      [xAw-h,yBtn-h],[xBw-h,yBtn-h],[xBw-h,yAs+h],[xAw-h,yAs+h],[xAw-h,yS-h],[xCw+h,yS-h],[xCw+h,yKn-h],[xL+h,yKn-h],
    ], mat:'wood', at:[1700,4800]},
  ];
  const rooms = {};
  shellRooms.forEach(r => rooms[r.id] = {name:r.name, mat:r.mat});
  const furniture = [
    F('bed','单人床',3360,1500,1200,2000,0),
    F('bed','双人床',5100,4300,1800,2000,0),
    F('wardrobe','衣柜',5540,2900,1600,560,0),
    F('bed','双人床',6500,7600,1500,2000,0),
    F('sofa','三人沙发',1400,4600,2200,900,0),
    F('table','茶几',1500,5400,1100,600,0),
    F('tv','65 寸电视',900,3600,1450,80,0),
    F('counter','橱柜台面',450,8800,700,1400,0),
    F('stove','燃气灶',450,8400,450,700,90),
    F('fridge','冰箱',1550,9400,700,700,0),
    F('toilet','马桶',4000,8000,400,700,180),
    F('vanity','浴室柜',4000,7500,800,500,0),
  ];
  const dims = [
    {horiz:true, at:yCn - 820, start:xL, segs:[xCw - xL, xCe - xCw, xBe - xCe, xAe - xBe]},
    {horiz:true, at:yS + 820, start:xL, segs:[xCw - xL, xAw - xCw, xAe - xAw]},
    {horiz:false, at:xL - 820, start:yCn, segs:[yN - yCn, yCs - yN, yKn - yCs, yS - yKn]},
    {horiz:false, at:xAe + 820, start:yCn, segs:[yN - yCn, yCs - yN, yBs - yCs, yAs - yBs, yS - yAs]},
  ];
  const plan = {
    id:'beike-3br', name:'三室一厅一卫', rev:3, walls, openings, bays:[], lintels:[],
    shellRooms, rooms, furniture, demolished:[], measures:[], dims, roomsLocked:true, presetDims:false,
  };
  fitBounds(plan);
  return plan;
}
function loadLibrary(){
  let lib = null;
  try {
    const raw = JSON.parse(localStorage.getItem('huxing-plans-v2'));
    if (raw && Array.isArray(raw.plans) && raw.plans.length && raw.plans.every(p => Array.isArray(p.walls))){
      raw.plans.forEach(normalizePlan);
      lib = raw;
    }
  } catch(e) {}
  if (!lib){
    const seed = seedPlan();
    mergeLegacy(seed);
    lib = {activeId:seed.id, plans:[seed]};
  }
  const bi = lib.plans.findIndex(p => p.id === 'beike-3br');
  if (bi < 0){
    const plan = beikePlan();
    lib.plans.push(plan);
    lib.activeId = plan.id;
  } else if ((lib.plans[bi].rev || 0) < 3){
    lib.plans[bi] = beikePlan();
  }
  if (!Array.isArray(lib.rooms)) lib.rooms = lib.plans.map(p => roomFromPlan(p));
  lib.rooms.forEach(normalizePlan);
  return lib;
}
function roomFromPlan(plan){
  const room = JSON.parse(JSON.stringify(plan));
  room.id = pid();
  room.sourceId = plan.id;
  (room.furniture || []).forEach(f => f.id = uid());
  return room;
}
function packNum(v){
  const n = typeof v === 'string' ? Number(v.trim()) : Number(v);
  return Number.isFinite(n) ? n : null;
}
function packPt(v){
  if (!Array.isArray(v) || v.length < 2) return null;
  const x = packNum(v[0]), y = packNum(v[1]);
  if (x == null || y == null) return null;
  return [Math.round(x), Math.round(y)];
}
function libItems(type){
  const out = [];
  for (const c of LIB) for (const it of c.items) if (it[0] === type) out.push(it);
  return out;
}
function pickLibItem(type, name, w){
  const items = libItems(type);
  if (!items.length) return null;
  if (name){ const exact = items.find(it => it[1] === name); if (exact) return exact; }
  if (w != null) return items.slice().sort((a, b) => Math.abs(a[2] - w) - Math.abs(b[2] - w))[0];
  return items[0];
}
function roomContaining(x, y){
  let best = null, bestA = Infinity;
  for (const r of state.shellRooms || []){
    if (!r.poly || !pip(r.poly, x, y)) continue;
    const A = polyArea(r.poly);
    if (A < bestA){ bestA = A; best = r; }
  }
  return best;
}
function markFurnitureRoom(f){
  if (!f) return f;
  const hit = roomContaining(f.cx, f.cy);
  if (hit) f.roomId = hit.id;
  return f;
}
// 识图代理交来的 huxing-pack。家具靠 roomId 对应 rooms[].id，户型本身不带家具。
function importHuxingPack(raw){
  if (!raw || raw.kind !== 'huxing-pack') throw new Error(tr('不是 huxing-pack', 'Not an huxing-pack'));
  if (raw.version !== 1) throw new Error(tr('只认 version 1', 'Only version 1 is supported'));
  if (!Array.isArray(raw.walls) || raw.walls.length < 3) throw new Error(tr('至少要有三面墙', 'At least three walls are required'));
  const warnings = [];
  const seenW = new Set();
  const walls = [];
  raw.walls.forEach((w, i) => {
    const a = packPt(w && w.a), b = packPt(w && w.b);
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])){ warnings.push('有一面墙没有端点'); return; }
    let id = w.id != null ? String(w.id) : 'w' + (i + 1);
    if (seenW.has(id)) id = id + '_' + (i + 1);
    seenW.add(id);
    const thick = packNum(w.thick);
    walls.push({
      id, a, b,
      thick: thick == null ? 200 : Math.max(80, Math.min(600, Math.round(thick))),
      type: ['e', 'n', 'b', 'low'].includes(w.type) ? w.type : 'n',
    });
  });
  if (walls.length < 3) throw new Error(tr('有效墙少于三面', 'Fewer than three usable walls'));
  const openings = [];
  let entryUsed = false;
  (raw.openings || []).forEach((o, i) => {
    if (!o || !seenW.has(String(o.wallId))){ warnings.push('有一处门窗找不到墙'); return; }
    const kind = ['win', 'door', 'slide', 'hole'].includes(o.kind) ? o.kind : null;
    if (!kind){ warnings.push('有一处门窗类型不对'); return; }
    const t = packNum(o.t), len = packNum(o.len);
    if (t == null || len == null){ warnings.push('有一处门窗缺少位置或宽度'); return; }
    const op = {
      id: o.id != null ? String(o.id) : 'o' + (i + 1), kind, wallId: String(o.wallId),
      t: Math.round(t), len: Math.round(len),
      head: packNum(o.head) || (kind === 'door' || kind === 'slide' ? 2100 : 2400),
    };
    if (kind === 'win') op.sill = packNum(o.sill) == null ? 900 : packNum(o.sill);
    if (kind === 'door'){
      op.hinge = o.hinge === 'end' ? 'end' : 'start';
      op.swing = Number(o.swing) === -1 ? -1 : 1;
      if (o.entry && !entryUsed){ op.entry = true; entryUsed = true; }
    }
    openings.push(op);
  });
  const bays = [];
  (raw.bays || []).forEach((b, i) => {
    if (!b || !seenW.has(String(b.wallId))){ warnings.push('有一处飘窗找不到墙'); return; }
    const t = packNum(b.t), len = packNum(b.len);
    if (t == null || len == null){ warnings.push('有一处飘窗缺少位置或宽度'); return; }
    const depth = packNum(b.depth);
    bays.push({id: b.id != null ? String(b.id) : 'bay' + (i + 1), wallId: String(b.wallId), t: Math.round(t), len: Math.round(len), depth: depth == null ? 620 : depth});
  });
  const declared = [];
  const seenR = new Set();
  (raw.rooms || []).forEach((r, i) => {
    const at = packPt(r && r.at);
    if (!r || !at){ warnings.push('有一个房间缺少 at'); return; }
    let id = r.id != null ? String(r.id) : 'r' + (i + 1);
    if (seenR.has(id)) id = id + '_' + (i + 1);
    seenR.add(id);
    if (r.mat && !MATS[r.mat]) warnings.push(`房间「${r.name || id}」的材料已改成默认地面`);
    declared.push({
      id, name: String(r.name || '未命名').slice(0, 40), at,
      mat: MATS[r.mat] ? r.mat : '',
      counted: r.counted === false || r.name === '飘窗' ? false : true,
    });
  });
  const dims = (Array.isArray(raw.dims) ? raw.dims : []).filter(d => d && (d.horiz === true || d.horiz === false) && packNum(d.at) != null && packNum(d.start) != null && Array.isArray(d.segs) && d.segs.length && d.segs.every(n => packNum(n) > 0)).map(d => ({
    horiz: !!d.horiz, at: Math.round(packNum(d.at)), start: Math.round(packNum(d.start)), segs: d.segs.map(n => Math.round(packNum(n))),
  }));
  const plan = {
    id: pid(), name: String(raw.name || '导入户型').slice(0, 40),
    walls, openings, bays, lintels: [], shellRooms: [], rooms: {}, furniture: [],
    demolished: [], measures: [], dims, roomsLocked: false, presetDims: false,
  };
  const prev = state;
  state = plan;
  let furniture = [];
  try {
    refreshBays();
    clampOpenings();
    const faces = computeRooms(plan.walls, []);
    for (const room of declared){
      const hits = faces.filter(f => !f._taken && pip(f.poly, room.at[0], room.at[1]));
      if (!hits.length){ warnings.push(`房间「${room.name}」的 at 没有落在房间里`); continue; }
      hits.sort((a, b) => a.area - b.area);
      const face = hits[0];
      face._taken = room.id;
      face.id = room.id;
      face.name = room.name;
      face.mat = room.mat || (face.counted === false ? 'marble' : 'tile800');
    }
    faces.forEach(f => { delete f._taken; });
    plan.shellRooms = faces;
    faces.forEach(r => plan.rooms[r.id] = {name: r.name, mat: r.mat});
    (raw.furniture || []).forEach(item => {
      const label = item && (item.name || item.type) || '家具';
      if (!item || item.roomId == null || item.roomId === ''){ warnings.push(`「${label}」没有 roomId`); return; }
      const key = String(item.roomId);
      const room = declared.find(r => r.id === key || r.name === key);
      const face = room && faces.find(r => r.id === room.id);
      if (!face){ warnings.push(`「${label}」的房间 ${key} 对不上`); return; }
      const spec = pickLibItem(item.type, item.name, packNum(item.w));
      if (!spec){ warnings.push(`库里没有「${label}」`); return; }
      const cx = packNum(item.cx), cy = packNum(item.cy);
      if (cx == null || cy == null){ warnings.push(`「${spec[1]}」没有坐标`); return; }
      if (item.name && item.name !== spec[1]) warnings.push(`「${item.name}」已对上库里的「${spec[1]}」`);
      furniture.push({
        id: uid(), type: spec[0], name: spec[1], cx: Math.round(cx), cy: Math.round(cy),
        w: spec[2], d: spec[3], rot: packNum(item.rot) || 0, color: spec[4], roomId: face.id,
      });
    });
    fitBounds(plan);
  } finally {
    state = prev;
  }
  plan.furniture = [];
  return {plan, furniture, warnings};
}
function starterPlan(){
  const walls = [
    {id:'nw', a:[0, 0], b:[10000, 0], thick:240, type:'e'},
    {id:'ne', a:[10000, 0], b:[10000, 8000], thick:240, type:'e'},
    {id:'se', a:[10000, 8000], b:[0, 8000], thick:240, type:'e'},
    {id:'sw', a:[0, 8000], b:[0, 0], thick:240, type:'e'},
  ];
  const shellRooms = computeRooms(walls, []).map(r => ({...r, name:'未命名', mat:'tile800', counted:true}));
  const rooms = {};
  shellRooms.forEach(r => rooms[r.id] = {name:r.name, mat:r.mat});
  const plan = {id:pid(), name:'', walls, openings:[], bays:[], lintels:[], shellRooms, rooms, furniture:[], demolished:[], measures:[], roomsLocked:false, presetDims:false};
  fitBounds(plan);
  return plan;
}
function geomSelfCheck(){
  const rect = [
    {id:'a', a:[0, 0], b:[10000, 0], thick:240, type:'e'},
    {id:'b', a:[10000, 0], b:[10000, 8000], thick:240, type:'e'},
    {id:'c', a:[10000, 8000], b:[0, 8000], thick:240, type:'e'},
    {id:'d', a:[0, 8000], b:[0, 0], thick:240, type:'e'},
  ];
  const rooms = computeRooms(rect, []);
  if (rooms.length !== 1) throw new Error('rect rooms ' + rooms.length);
  if (Math.abs(polyArea(rooms[0].poly) - (10000 - 240) * (8000 - 240)) > 50000) throw new Error('area');
  const L = rect.concat([{id:'m', a:[5000, 0], b:[5000, 4000], thick:240, type:'n'}, {id:'n', a:[5000, 4000], b:[10000, 4000], thick:240, type:'n'}]);
  if (computeRooms(L, []).length !== 2) throw new Error('L rooms');
  if (Math.abs(polyArea(wallQuad({a:[0, 0], b:[3000, 4000], thick:200})) - 5000 * 200) > 1) throw new Error('quad');
  const plain = polyArea(rooms[0].poly);
  const bayWalls = rect.concat([
    {id:'s0', a:[4100, 8000], b:[4100, 8620], thick:100, type:'e', bayId:'B'},
    {id:'s1', a:[5900, 8000], b:[5900, 8620], thick:100, type:'e', bayId:'B'},
    {id:'f', a:[4100, 8620], b:[5900, 8620], thick:100, type:'e', bayId:'B'},
  ]);
  const bayRooms = computeRooms(bayWalls, []);
  const bayNet = bayRooms.filter(r => r.counted !== false).reduce((s, r) => s + polyArea(r.poly), 0);
  if (!bayRooms.some(r => r.counted === false)) throw new Error('bay face');
  if (Math.abs(bayNet - plain) > 50000) throw new Error('bay net ' + bayNet);
  const part = computeRooms(rect.concat([{id:'m', a:[0, 4000], b:[10000, 4000], thick:240, type:'n'}]), []);
  if (part.length !== 2) throw new Error('part ' + part.length);
  if (part.some(r => { const a = polyArea(r.poly); return a < 30e6 || a > 42e6; })) throw new Error('part area');
  SEED_WALLS.forEach((r, i) => {
    const corners = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    const quad = wallQuad(rectToWall(r, i));
    for (const c of corners) if (!quad.some(p => Math.abs(p[0] - c[0]) < 0.02 && Math.abs(p[1] - c[1]) < 0.02)) throw new Error('seed corner ' + c);
  });
  const rectDims = shellDims(rect);
  const rectTop = rectDims.find(d => d.horiz && d.at < 0 && d.segs.length === 1);
  if (!rectTop || rectTop.start !== 0 || rectTop.segs[0] !== 10000) throw new Error('rect top ' + JSON.stringify(rectTop));
  if (rectDims.filter(d => d.horiz).length !== 2) throw new Error('rect overall');
  const parted = rect.concat([{id:'m', a:[5000, 0], b:[5000, 4000], thick:240, type:'n'}]);
  const partTop = shellDims(parted).find(d => d.horiz && d.at < 0 && d.segs.length > 1);
  if (!partTop || partTop.segs.join() !== '5000,5000') throw new Error('part top ' + JSON.stringify(partTop));
  const bk = shellDims(beikePlan().walls);
  const bkTop = bk.filter(d => d.horiz && d.at < 0).sort((a, b) => b.at - a.at)[0];
  const bkBot = bk.filter(d => d.horiz && d.at > 5000).sort((a, b) => a.at - b.at)[0];
  const bkLeft = bk.filter(d => !d.horiz && d.at < 0).sort((a, b) => b.at - a.at)[0];
  if (!bkTop || bkTop.segs.join() !== '2135,2450,1906,1285') throw new Error('bk top ' + JSON.stringify(bkTop));
  if (!bkBot || bkBot.segs.join() !== '2135,3105,2536') throw new Error('bk bot ' + JSON.stringify(bkBot));
  if (!bkLeft || bkLeft.segs.join() !== '2235,5736,2119') throw new Error('bk left ' + JSON.stringify(bkLeft));
}
function thumbSVG(plan, withFurn){
  const b = plan.bounds || {x:0, y:0, w:1000, h:1000};
  const rooms = (plan.shellRooms || []).map(r => {
    const mat = plan.rooms?.[r.id]?.mat || r.mat || 'tile800';
    return `<polygon points="${r.poly.map(p => p.join(',')).join(' ')}" fill="${(MATS[mat] || MATS.tile800).sw}"/>`;
  }).join('');
  const furn = withFurn ? (plan.furniture || []).map(f =>
    `<g transform="translate(${f.cx} ${f.cy}) rotate(${f.rot || 0})">${furnSVG(f.type, f.w, f.d, f.color || '#eee', f.parts)}</g>`
  ).join('') : '';
  const walls = (plan.walls || []).map(w => `<polygon points="${wallQuad(w).map(p => p.join(',')).join(' ')}" fill="#8f897d"/>`).join('');
  return `<svg viewBox="${b.x} ${b.y} ${b.w} ${b.h}" preserveAspectRatio="xMidYMid meet">${rooms}${furn}${walls}</svg>`;
}
function renderPlanList(){
  $('#planList').innerHTML = library.plans.map(p => `<div class="plan-card${p.id === library.activeId ? ' on' : ''}" data-plan="${p.id}">
      ${thumbSVG(p)}<span class="nm">${esc(nm(p.name || '未命名户型'))}</span>
      <div class="row">
        <button class="btn" data-act="edit">${tr('编辑', 'Edit')}</button>
        <button class="btn" data-act="copy">${tr('复制', 'Duplicate')}</button>
        <button class="btn danger" data-act="del">${tr('删除', 'Delete')}</button>
      </div></div>`).join('');
  $('#planList').querySelectorAll('.plan-card').forEach(card => card.onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act, id = card.dataset.plan;
    if (act === 'edit') beginEdit(id);
    else if (act === 'copy') copyPlan(id);
    else if (act === 'del') deletePlan(id);
    else switchPlan(id);
  });
}
function showPlans(){ if (editing) return; renderPlanList(); $('#planModal').hidden = false; }
function hidePlans(){ $('#planModal').hidden = true; }
function docDigest(p){
  return JSON.stringify({
    name:p.name || '', walls:p.walls, openings:p.openings, bays:p.bays, lintels:p.lintels,
    shellRooms:p.shellRooms, rooms:p.rooms, furniture:p.furniture,
    demolished:p.demolished, measures:p.measures, dims:p.dims, presetDims:!!p.presetDims,
  });
}
function armSession(){
  sessionFull = JSON.parse(JSON.stringify(state));
  sessionDigest = docDigest(state);
  if (typeof syncSaveBtn === 'function') syncSaveBtn();
}
function sessionDirty(){
  return !!sessionDigest && !!state && docDigest(state) !== sessionDigest;
}
function restoreSession(){
  if (!sessionFull) return;
  const back = JSON.parse(JSON.stringify(sessionFull));
  if (editing){
    const i = library.plans.findIndex(x => x.id === back.id);
    if (i >= 0) library.plans[i] = back;
    else library.plans.push(back);
  } else {
    library.rooms = library.rooms || [];
    const i = library.rooms.findIndex(x => x.id === back.id);
    if (i >= 0) library.rooms[i] = back;
    else library.rooms.push(back);
  }
  undoStack.length = redoStack.length = 0;
  ui.sel = null;
  applyPlan(back);
}
function leaveEditorChrome(){
  editing = false;
  document.body.classList.remove('editing');
  $('.app').classList.toggle('hide-lib', !!panes.hideLib);
  if (typeof syncPaneBtns === 'function') syncPaneBtns();
  if (typeof syncTip === 'function') syncTip();
  syncSaveBtn();
}
function enterEditor(){
  editing = true;
  undoStack.length = redoStack.length = 0;
  ui.sel = null;
  document.body.classList.add('editing');
  $('.app').classList.toggle('hide-lib', !!panes.hideLib);
  if (typeof syncPaneBtns === 'function') syncPaneBtns();
  if (typeof syncTip === 'function') syncTip();
  hidePlans();
  if (typeof isPreview === 'function' && isPreview()) setView('2d');
  if (typeof is3D === 'function' && is3D()) setView('2d');
  setTool('wall');
  renderAll();
  armSession();
}
function beginEdit(id){
  const p = library.plans.find(x => x.id === id);
  if (!p) return;
  if (state.id !== id){ undoStack.length = redoStack.length = 0; ui.sel = null; applyPlan(p); }
  fitView();
  enterEditor();
}
function beginNew(){
  const p = starterPlan();
  library.plans.push(p);
  applyPlan(p);
  fitView();
  enterEditor();
}
let nameTarget = 'plan';
function openNameDlg(kind){
  nameTarget = kind;
  const room = kind === 'room';
  $('#nameForm h3').textContent = room ? tr('房间名字', 'Room name') : tr('户型名字', 'Floor plan name');
  $('#planNameInput').value = state.name || (room ? tr('未命名房间', 'Untitled room') : tr('未命名户型', 'Untitled plan'));
  $('#nameDlg').hidden = false;
  setTimeout(() => $('#planNameInput').focus(), 30);
}
function confirmSavePlan(){
  const name = $('#planNameInput').value.trim();
  if (!name) return toast(nameTarget === 'room' ? tr('请填写房间名字', 'Enter a room name') : tr('请填写户型名字', 'Enter a floor plan name'));
  state.name = name;
  $('#nameDlg').hidden = true;
  finishSaved();
}
function copyName(name){
  const base = name || tr('未命名户型', 'Untitled plan');
  const label = n => LANG === 'en' ? `${base} copy${n ? ' ' + n : ''}` : `${base} 副本${n ? ' ' + n : ''}`;
  const names = new Set(library.plans.map(p => p.name));
  if (!names.has(label())) return label();
  for (let i = 2; i < 80; i++) if (!names.has(label(i))) return label(i);
  return label(Date.now() % 1000);
}
function copyPlan(id){
  const p = library.plans.find(x => x.id === id);
  if (!p) return;
  const c = JSON.parse(JSON.stringify(p));
  c.id = pid(); c.name = copyName(p.name);
  c.furniture.forEach(f => f.id = uid());
  library.plans.push(c);
  save(); renderPlanList();
  toast(tr(`已复制为「${c.name}」`, `Copied as "${c.name}"`));
}
function deletePlan(id){
  if (library.plans.length <= 1) return toast(tr('至少保留一份户型', 'Keep at least one floor plan'));
  const p = library.plans.find(x => x.id === id);
  if (!p || !confirm(tr(`删除「${p.name}」？此操作不能撤销。`, `Delete "${p.name}"? This cannot be undone.`))) return;
  const i = library.plans.findIndex(x => x.id === id);
  library.plans.splice(i, 1);
  if (library.activeId === id){
    const n = library.plans[Math.max(0, i - 1)];
    undoStack.length = redoStack.length = 0; ui.sel = null;
    applyPlan(n); renderAll(); fitView();
  }
  save(); renderPlanList();
}
function switchPlan(id){
  if (editing) return;
  const p = library.plans.find(x => x.id === id);
  if (!p) return;
  hidePlans();
  if (id === state.id) return;
  undoStack.length = redoStack.length = 0; ui.sel = null;
  applyPlan(p); save(); renderAll(); fitView();
  toast(tr(`已切换到「${nm(p.name)}」`, `Switched to "${nm(p.name)}"`));
}
function removeWallData(id){
  const w = state.walls.find(x => x.id === id);
  if (!w) return;
  if (w.bayId) state.bays = state.bays.filter(b => b.id !== w.bayId);
  else {
    state.bays = state.bays.filter(b => b.wallId !== id);
    state.walls = state.walls.filter(x => x.id !== id);
    state.openings = state.openings.filter(o => o.wallId !== id);
    state.demolished = state.demolished.filter(d => d !== id);
  }
}
function removeOpeningData(id){
  const o = state.openings.find(x => x.id === id);
  if (!o) return;
  if (o.bayId) state.bays = state.bays.filter(b => b.id !== o.bayId);
  else state.openings = state.openings.filter(x => x.id !== id);
}
function nearestWall(x, y){
  let best = null;
  for (const w of state.walls){
    if (state.demolished.includes(w.id)) continue;
    const d = distToSeg(x, y, w.a, w.b), limit = Math.max(w.thick / 2 + 120, 220);
    if (d <= limit && (!best || d < best.d)) best = {wall:w, d, t:projectT(x, y, w), len:wallLen(w)};
  }
  return best;
}
function snapWallPoint(p, shift, origin, ignoreId){
  let best = null, bd = 160;
  for (const w of state.walls){
    if (w.id === ignoreId || w.bayId) continue;
    for (const q of [w.a, w.b]){
      const d = Math.hypot(q[0] - p.x, q[1] - p.y);
      if (d < bd){ bd = d; best = {x:q[0], y:q[1]}; }
    }
  }
  if (best) return best;
  let x = Math.round(p.x / 10) * 10, y = Math.round(p.y / 10) * 10;
  if (origin && !shift){
    if (Math.abs(x - origin.x) >= Math.abs(y - origin.y)) y = origin.y;
    else x = origin.x;
  }
  return {x, y};
}
function openingFits(wallId, t, len, ignore){
  const w = wallById(wallId);
  if (!w || len < 200 || t < 10 || t + len > wallLen(w) - 10) return false;
  return !state.openings.some(o => o.wallId === wallId && o.id !== ignore && t < o.t + o.len - 5 && t + len > o.t + 5);
}
function inwardSwing(w, t){
  const p = alongWall(w, t), c = buildingCenter(), lx = p.uy, ly = -p.ux;
  return (c.x - p.x) * lx + (c.y - p.y) * ly >= 0 ? 1 : -1;
}
function placeOpening(kind, x, y){
  const hit = nearestWall(x, y);
  if (!hit) return toast(tr('请点在墙线上', 'Click a wall'));
  if (kind === 'bay'){
    if (hit.wall.type !== 'e' && hit.wall.type !== 'b') return toast(tr('飘窗要放在外墙或承重墙上', 'Bay windows sit on an exterior or bearing wall'));
    if (hit.wall.bayId) return toast(tr('这里已经是飘窗', 'This is already a bay window'));
    const len = Math.min(1800, hit.len - 80);
    if (len < 600) return toast(tr('这面墙太短，放不下飘窗', 'This wall is too short for a bay window'));
    const t = Math.max(40, Math.min(hit.len - len - 40, hit.t - len / 2));
    if (!openingFits(hit.wall.id, t, len)) return toast(tr('和已有门窗重叠了', 'It overlaps an existing opening'));
    const id = oid();
    mutate(() => { state.bays.push({id, wallId:hit.wall.id, t, len, depth:620}); touchShell(); ui.sel = {kind:'bay', id}; });
    toast(tr('已加飘窗', 'Bay window added'));
    return;
  }
  const want = kind === 'door' ? 880 : kind === 'slide' ? 1600 : 1500;
  const len = Math.min(want, hit.len - 80);
  if (len < 400) return toast(tr('这面墙太短', 'This wall is too short'));
  const t = Math.max(30, Math.min(hit.len - len - 30, hit.t - len / 2));
  if (!openingFits(hit.wall.id, t, len)) return toast(tr('和已有门窗重叠了', 'It overlaps an existing opening'));
  const op = {id:oid(), kind:kind === 'win' ? 'win' : kind === 'door' ? 'door' : 'slide', wallId:hit.wall.id, t, len};
  if (op.kind === 'win'){ op.sill = 900; op.head = 2400; }
  else if (op.kind === 'door'){ op.head = 2100; op.swing = inwardSwing(hit.wall, t + len / 2); op.hinge = 'start'; op.entry = false; }
  else op.head = hit.wall.type === 'e' ? 2400 : 2100;
  mutate(() => { state.openings.push(op); touchShell(); ui.sel = {kind:'open', id:op.id}; });
}
function wallPanel(w){
  const types = [['b', '承重', 'Bearing'], ['e', '外墙', 'Exterior'], ['n', '非承重', 'Partition'], ['low', '矮墙', 'Half wall']];
  const opts = types.map(([k, zh, en]) => `<option value="${k}" ${w.type === k ? 'selected' : ''}>${tr(zh, en)}</option>`).join('');
  return `<section><h3>${w.bayId ? tr('飘窗', 'Bay window') : tr('墙体', 'Wall')}</h3>
    <div class="form">
      <label>${tr('类型', 'Type')}<select id="wType" ${w.bayId ? 'disabled' : ''}>${opts}</select></label>
      <label>${tr('厚度', 'Thickness')} (mm)<input type="number" id="wThick" min="80" max="600" step="10" value="${Math.round(w.thick)}" ${w.bayId ? 'disabled' : ''}></label>
    </div>
    <div class="muted" style="margin-top:8px">${tr('长度', 'Length')} ${Math.round(wallLen(w))} mm</div>
    <div class="actions"><button class="btn danger" id="wDel">${w.bayId ? tr('删除飘窗', 'Delete bay') : tr('删除墙体', 'Delete wall')}</button></div>
    ${w.bayId ? '' : `<p class="muted">${tr('拖动两端圆点改墙。按住 Shift 可走斜线。编辑里可以直接删除墙体。', 'Drag either endpoint. Hold Shift for a sloped wall. Walls can be deleted while editing.')}</p>`}
  </section>`;
}
function bindWallPanel(w){
  if (!w.bayId){
    $('#wType').onchange = e => mutate(() => { const g = wallById(w.id); if (g) g.type = e.target.value; });
    $('#wThick').onchange = e => {
      const v = Math.max(80, Math.min(600, Math.round(+e.target.value || w.thick)));
      mutate(() => { const g = wallById(w.id); if (g){ g.thick = v; touchShell(); } });
    };
  }
  $('#wDel').onclick = () => { ui.sel = {kind:'wall', id:w.id}; deleteSel(); };
}
function bayById(id){ return (state.bays || []).find(b => b.id === id); }
function spanFree(wallId, t, len, ignore){
  const w = wallById(wallId);
  if (!w || len < 200 || t < 10 || t + len > wallLen(w) - 10) return false;
  const skip = new Set(ignore || []);
  return !state.openings.some(o => o.wallId === wallId && !skip.has(o.id) && t < o.t + o.len - 5 && t + len > o.t + 5);
}
function setBayGeom(b, t, len, depth){
  const host = wallById(b.wallId);
  if (!host) return false;
  const L = wallLen(host);
  len = Math.max(500, Math.min(Math.round(len), L - 60));
  t = Math.max(30, Math.min(Math.round(t), L - len - 30));
  depth = Math.max(300, Math.min(1500, Math.round(depth)));
  if (!spanFree(host.id, t, len, [b.id + 'h'])) return false;
  b.t = t; b.len = len; b.depth = depth;
  return true;
}
function bayPanel(b){
  return `<section><h3>${tr('飘窗', 'Bay window')}</h3>
    <div class="form">
      <label>${tr('宽度', 'Width')} (mm)<input type="number" id="bLen" min="500" step="10" value="${Math.round(b.len)}"></label>
      <label>${tr('进深', 'Depth')} (mm)<input type="number" id="bDepth" min="300" max="1500" step="10" value="${Math.round(b.depth || 620)}"></label>
      <label>${tr('沿墙起点', 'Offset')} (mm)<input type="number" id="bT" min="30" step="10" value="${Math.round(b.t)}"></label>
    </div>
    <div class="actions"><button class="btn danger" id="bDel">${tr('删除飘窗', 'Delete bay')}</button></div>
    <p class="muted">${tr('拖两端圆点改宽度和位置，拖外侧方块改进深。', 'Drag either end to change width and position. Drag the outer square to change the depth.')}</p>
  </section>`;
}
function bindBayPanel(b){
  const apply = () => {
    const cur = bayById(b.id); if (!cur) return;
    const before = snap();
    if (!setBayGeom(cur, +$('#bT').value, +$('#bLen').value, +$('#bDepth').value))
      return toast(tr('这个尺寸和旁边的门窗重叠，或超出了墙', 'That size overlaps a neighboring opening, or runs off the wall'));
    touchShell(); commit(before); renderAll();
  };
  ['bLen', 'bDepth', 'bT'].forEach(id => { const el = $('#' + id); if (el) el.onchange = apply; });
  $('#bDel').onclick = () => { ui.sel = {kind:'bay', id:b.id}; deleteSel(); };
}
function moveOpenEnd(o, end, p){
  const w = wallById(o.wallId); if (!w) return;
  let t = Math.round(projectT(p.x, p.y, w) / 10) * 10;
  const minLen = 300, L = wallLen(w), endT = o.t + o.len;
  const nt = end === 'start' ? Math.max(10, Math.min(t, endT - minLen)) : o.t;
  const far = end === 'start' ? endT : Math.min(L - 10, Math.max(t, o.t + minLen));
  const nlen = far - nt;
  if (nlen < minLen || !openingFits(w.id, nt, nlen, o.id)) return;
  o.t = nt; o.len = nlen;
  renderOpenings(); renderSel();
}
function moveBayEnd(b, end, p){
  const fr = bayFrame(b); if (!fr) return;
  let t = Math.round(projectT(p.x, p.y, fr.host) / 10) * 10;
  const endT = b.t + b.len;
  const nt = end === 'start' ? t : b.t;
  const far = end === 'start' ? endT : t;
  if (far - nt < 500 || !setBayGeom(b, nt, far - nt, b.depth || 620)) return;
  refreshBays(); WALLS = state.walls;
  renderWalls(); renderOpenings(); renderSel();
}
function moveBayDepth(b, p){
  const fr = bayFrame(b); if (!fr) return;
  const depth = Math.round(((p.x - fr.p0.x) * fr.nx + (p.y - fr.p0.y) * fr.ny) / 10) * 10;
  if (!setBayGeom(b, b.t, b.len, depth)) return;
  refreshBays(); WALLS = state.walls;
  renderWalls(); renderOpenings(); renderSel();
}
function openPanel(o){
  if (o.bayId) return bayPanel(bayById(o.bayId) || {id:o.bayId, len:0, t:0, depth:620});
  const kindName = {win:tr('窗', 'Window'), door:tr('门', 'Door'), slide:tr('推拉门', 'Sliding door'), hole:tr('洞口', 'Opening')}[o.kind] || o.kind;
  return `<section><h3>${kindName}</h3>
    <div class="form">
      <label>${tr('宽度', 'Width')} (mm)<input type="number" id="oLen" min="300" step="10" value="${Math.round(o.len)}"></label>
      ${o.kind === 'win' ? `<label>${tr('窗台', 'Sill')} (mm)<input type="number" id="oSill" min="0" max="2200" step="10" value="${o.sill || 900}"></label>` : ''}
      <label>${tr('顶高', 'Head')} (mm)<input type="number" id="oHead" min="1600" max="2800" step="10" value="${o.head || 2100}"></label>
      ${o.kind === 'door' ? `<label class="full">${tr('入户门', 'Entry door')}<input type="checkbox" id="oEntry" ${o.entry ? 'checked' : ''}></label>` : ''}
    </div>
    <div class="actions">
      ${o.kind === 'door' ? `<button class="btn" id="oSwing">${tr('换开启侧', 'Flip swing')}</button><button class="btn" id="oHinge">${tr('换铰链', 'Flip hinge')}</button>` : ''}
      <button class="btn danger" id="oDel">${tr('删除', 'Delete')}</button>
    </div>
    ${o.wallId ? `<p class="muted">${tr('拖两端圆点，沿这面墙改位置和长短。', 'Drag either end along the wall to move it or change its length.')}</p>` : ''}</section>`;
}
function bindOpenPanel(o){
  if (o.bayId){ const b = bayById(o.bayId); if (b) bindBayPanel(b); return; }
  const upd = fn => mutate(() => { const g = state.openings.find(x => x.id === o.id); if (g) fn(g); });
  if (!o.bayId && $('#oLen')) $('#oLen').onchange = e => {
    const len = Math.max(300, Math.round(+e.target.value || o.len));
    const t = o.t + o.len / 2 - len / 2;
    if (o.wallId && !openingFits(o.wallId, Math.max(10, t), len, o.id)) return toast(tr('这个宽度和旁边的门窗重叠', 'That width overlaps a neighboring opening'));
    upd(g => { g.len = len; g.t = Math.max(10, t); touchShell(); });
  };
  if ($('#oSill')) $('#oSill').onchange = e => upd(g => g.sill = Math.max(0, Math.min(2200, Math.round(+e.target.value || 0))));
  if ($('#oHead')) $('#oHead').onchange = e => upd(g => g.head = Math.max(1600, Math.min(2800, Math.round(+e.target.value || 2100))));
  if ($('#oEntry')) $('#oEntry').onchange = e => mutate(() => state.openings.forEach(g => { if (g.kind === 'door') g.entry = e.target.checked && g.id === o.id; }));
  if ($('#oSwing')) $('#oSwing').onclick = () => upd(g => g.swing = -(g.swing || 1));
  if ($('#oHinge')) $('#oHinge').onclick = () => upd(g => g.hinge = g.hinge === 'end' ? 'start' : 'end');
  $('#oDel').onclick = () => { ui.sel = {kind:'open', id:o.id}; deleteSel(); };
}

const PX_MM = 25.4 / 96;                       // 1 CSS px = 0.2646 mm
const COARSE = matchMedia('(pointer:coarse)').matches;   // iPad / 手机等触屏为主的设备
const TAP = COARSE ? 9 : 4;                    // 手指按下后移动超过该像素才算拖动
const narrow = () => matchMedia('(max-width:1100px)').matches;
const $ = s => document.querySelector(s);
const svg = $('#plan');
const LIB_KEY = 'huxing-plans-v2';

let library, editing = false, sessionFull = null, sessionDigest = null;
let WALLS, WINS, DOORS, SLIDES, ROOMS, BOUNDS, state;

/* ======================= 状态 / 历史 / 存储 ======================= */
const ui = {tool:'select', sel:null, mA:null, mCur:null, wallA:null, wallB:null,
  layers:{dims:true, labels:true, furn:true, grid:false, bearing:false, wallSnap:true}};
let studioFurn = null;
let view = {x0:0, y0:0, s:.06};
const undoStack = [], redoStack = [];

function save(){
  if (editing) return;
  // 房间里的修改先留在内存，等「保存」或直接返回时再写入；「不保存」才能退回去
  if (typeof decorInside !== 'undefined' && decorInside && sessionDigest) return;
  try { localStorage.setItem(LIB_KEY, JSON.stringify({activeId:library.activeId, plans:library.plans, rooms:library.rooms || []})); } catch(e) {}
}
const snap = () => JSON.stringify(state);
function commit(before){ undoStack.push(before); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; save(); }
function mutate(fn){ const b = snap(); fn(); commit(b); renderAll(); }
function adopt(next){ normalizePlan(next); applyPlan(next); validateSel(); }
function undo(){
  if (!undoStack.length) return toast(tr('没有可撤销的操作', 'Nothing to undo'));
  redoStack.push(snap()); adopt(JSON.parse(undoStack.pop())); save(); renderAll();
}
function redo(){
  if (!redoStack.length) return;
  undoStack.push(snap()); adopt(JSON.parse(redoStack.pop())); save(); renderAll();
}
function validateSel(){
  if (ui.sel?.kind === 'furn' && !getF(ui.sel.id)) ui.sel = null;
  if (ui.sel?.kind === 'wall' && !WALLS.some(w => w.id === ui.sel.id)) ui.sel = null;
  if (ui.sel?.kind === 'open' && !state.openings.some(o => o.id === ui.sel.id)) ui.sel = null;
  if (ui.sel?.kind === 'room' && !ROOMS.some(r => r.id === ui.sel.id)) ui.sel = null;
  if (ui.sel?.kind === 'bay' && !bayById(ui.sel.id)) ui.sel = null;
  if (editing && ui.sel?.kind === 'furn') ui.sel = null;
}
const getF = id => state.furniture.find(f => f.id === id);

function initLibrary(){
  library = loadLibrary();
  const p = library.plans.find(x => x.id === library.activeId) || library.plans[0];
  applyPlan(p);
  save();
  try { geomSelfCheck(); }
  catch(err){ console.error(err); setTimeout(() => toast(tr('户型几何自检未通过', 'Floor-plan geometry check failed')), 500); }
}
initLibrary();

$('#openPlans').onclick = showPlans;
$('#planClose').onclick = hidePlans;
$('#planAdd').onclick = beginNew;
$('#planModal').onclick = e => { if (e.target === $('#planModal')) hidePlans(); };
$('#nameCancel').onclick = () => { $('#nameDlg').hidden = true; if (typeof cancelSaved === 'function') cancelSaved(); };
$('#nameForm').onsubmit = e => { e.preventDefault(); confirmSavePlan(); };



/* ======================= 几何工具 ======================= */
const area = poly => Math.abs(poly.reduce((a,p,i) => { const q = poly[(i+1)%poly.length]; return a + p[0]*q[1] - q[0]*p[1]; }, 0)) / 2 / 1e6;
const perim = poly => poly.reduce((a,p,i) => { const q = poly[(i+1)%poly.length]; return a + Math.hypot(q[0]-p[0], q[1]-p[1]); }, 0) / 1000;
const bbox = poly => { const xs = poly.map(p=>p[0]), ys = poly.map(p=>p[1]); return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]; };
function aabb(f){ const a = f.rot*Math.PI/180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); return {hw:f.w/2*c + f.d/2*s, hh:f.w/2*s + f.d/2*c}; }
const fmt = (n, d=2) => n.toFixed(d);
const norm = a => ((Math.round(a) % 360) + 360) % 360;
function snapRects(){
  const rects = [];
  for (const w of WALLS){
    if (state.demolished.includes(w.id)) continue;
    if (Math.abs(w.a[0] - w.b[0]) < 0.5 || Math.abs(w.a[1] - w.b[1]) < 0.5) rects.push(wallAabb(w));
  }
  for (const win of WINS) rects.push(win.rect);
  for (const op of state.openings){
    if (!op.wallId || op.kind === 'hole' || op.kind === 'door' || op.kind === 'slide') continue;
    const w = wallById(op.wallId);
    if (w && !state.demolished.includes(w.id)) rects.push(wallAabb(sliceWall(w, op.t, op.t + op.len)));
  }
  return rects;
}

/* ======================= 颜色 / 材质图案 ======================= */
function hex2rgb(h){ h = h.replace('#',''); if (h.length===3) h = h.split('').map(c=>c+c).join(''); const n = parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function shade(h,k){ const f = v => Math.max(0,Math.min(255,Math.round(k>1 ? v+(255-v)*(k-1)*2 : v*k))); return '#'+hex2rgb(h).map(v=>f(v).toString(16).padStart(2,'0')).join(''); }

function buildDefs(){
  const plank = (id,base,line) => `<pattern id="m-${id}" patternUnits="userSpaceOnUse" width="1800" height="360">
      <rect width="1800" height="360" fill="${base}"/>
      <path d="M0 0H1800M0 180H1800M1200 0V180M600 180V360" stroke="${line}" stroke-width="10"/>
      <path d="M100 70Q500 60 900 85T1700 75M200 260Q700 250 1100 275T1750 262" stroke="${line}" stroke-width="5" fill="none" opacity=".45"/></pattern>`;
  const tile = (id,size,base,line) => `<pattern id="m-${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="${base}"/><path d="M0 0H${size}M0 0V${size}" stroke="${line}" stroke-width="10"/></pattern>`;
  $('#defs').innerHTML =
    plank('wood','#dcc09a','#bf9d70') + plank('walnut','#a57c56','#80593a') +
    tile('tile800',800,'#ece7de','#d3cabb') + tile('tile600',600,'#e2e6e3','#c4cbc6') + tile('antislip',300,'#d6dbd7','#b3bab4') +
    `<pattern id="m-marble" patternUnits="userSpaceOnUse" width="1200" height="1200">
      <rect width="1200" height="1200" fill="#f3f0ea"/><path d="M0 0H1200M0 0V1200" stroke="#dcd5c8" stroke-width="10"/>
      <path d="M-50 300C250 260 380 520 700 470S1100 640 1260 600M200 1200C300 950 520 980 640 820" stroke="#d6cfc2" stroke-width="12" fill="none"/></pattern>
    <pattern id="m-terrazzo" patternUnits="userSpaceOnUse" width="500" height="500">
      <rect width="500" height="500" fill="#e8e1d5"/>
      <circle cx="60" cy="80" r="22" fill="#b9a58c"/><circle cx="310" cy="140" r="16" fill="#8fa3a0"/><circle cx="190" cy="330" r="26" fill="#c9b7a2"/>
      <circle cx="420" cy="400" r="18" fill="#a88f76"/><circle cx="90" cy="440" r="12" fill="#8fa3a0"/><circle cx="440" cy="40" r="10" fill="#b9a58c"/></pattern>
    <pattern id="m-carpet" patternUnits="userSpaceOnUse" width="120" height="120">
      <rect width="120" height="120" fill="#c9c3d3"/><circle cx="30" cy="30" r="8" fill="#bab3c6"/><circle cx="90" cy="90" r="8" fill="#bab3c6"/></pattern>
    <pattern id="grid" patternUnits="userSpaceOnUse" width="1000" height="1000">
      <path d="M500 0V1000M0 500H1000" stroke="#e5dfd3" stroke-width="8"/><path d="M0 0V1000M0 0H1000" stroke="#d8d0c1" stroke-width="14"/></pattern>`;
}
