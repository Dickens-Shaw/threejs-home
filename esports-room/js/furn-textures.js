// 程序化贴图：按 (role, skinId) 缓存，零外部资源。
// 木纹 / 布纹 / 黏土噪点 / 拉丝金属 / 屏幕渐变，全部 Canvas 生成。
(function(){
  const cache = new Map();
  function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function cnv(w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function tex(c, srgb = true){
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  function woodCanvas(base, dark, light, R){
    const [c, g] = cnv(512, 256);
    g.fillStyle = base; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 46; i++){
      const y = R() * 256;
      g.strokeStyle = i % 3 ? dark : light;
      g.globalAlpha = .12 + R() * .22;
      g.lineWidth = .8 + R() * 2.2;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * .02 + i) * 3 + (R() - .5) * 4);
      g.stroke();
    }
    g.globalAlpha = 1;
    return c;
  }
  function clothCanvas(R){
    const [c, g] = cnv(256, 256);
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 2) for (let x = 0; x < 256; x += 2){
      const v = 118 + Math.round((R() - .5) * 36) + ((x + y) % 4 === 0 ? 10 : -10);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 2, 2);
    }
    return c;
  }
  function clayCanvas(R){
    const [c, g] = cnv(256, 256);
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5200; i++){
      const v = 120 + Math.round((R() - .5) * 26);
      g.fillStyle = `rgba(${v},${v},${v},.5)`;
      g.fillRect(R() * 256, R() * 256, 1.6, 1.6);
    }
    return c;
  }
  function metalCanvas(R){
    const [c, g] = cnv(256, 256);
    g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 220; i++){
      const x = R() * 256;
      g.strokeStyle = R() < .5 ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.16)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke();
    }
    return c;
  }
  function glowCanvas(inner, outer){
    const [c, g] = cnv(128, 128);
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return c;
  }
  // role: 木 / 布 / 陶瓷 / 铬 / 黑金属 / 拉手 / 镜 / 玻璃 / 屏幕 / 灯
  window.furnTexture = function(role, skinId){
    const skin = (typeof roomSkin === 'function' ? roomSkin(skinId) : null) || {};
    const k = (skin.tex || {});
    const key = role + '|' + (skinId || 'station');
    if (cache.has(key)) return cache.get(key);
    const R = rng(key.length * 131 + 7);
    let out = null;
    const amt = (role === '木' ? (k.wood ?? 1) : role === '布' ? (k.cloth ?? 0) : (role === '铬' || role === '黑金属' || role === '拉手') ? (k.metal ?? .5) : role === '陶瓷' ? (k.clay ?? 0) : 0);
    if (amt <= 0.01 && role !== '屏幕' && role !== '灯'){ cache.set(key, null); return null; }
    if (role === '木'){
      const base = (skin.palette || {})['木'] || '#d8c2a2';
      out = { map: tex(woodCanvas(base, 'rgba(90,60,35,.55)', 'rgba(255,245,230,.5)', R)) };
      out.map.repeat.set(.6, .6);
    } else if (role === '布'){
      out = { bumpMap: tex(clothCanvas(R), false) };
      out.bumpScale = .6 * amt + .1;
    } else if (role === '陶瓷' && (k.clay ?? 0) > .01){
      out = { bumpMap: tex(clayCanvas(R), false) };
      out.bumpScale = .35 * (k.clay ?? 1);
    } else if (role === '铬' || role === '黑金属' || role === '拉手'){
      out = { roughnessMap: tex(metalCanvas(R), false) };
    } else if (role === '屏幕'){
      const sc = (skin.palette || {})['屏幕'] || '#163044';
      out = { map: tex(glowCanvas('#ffffff', sc)) };
    } else if (role === '灯'){
      const lc = (skin.palette || {})['灯'] || '#ffdca0';
      out = { map: tex(glowCanvas('#fffdf4', lc)) };
    }
    cache.set(key, out);
    return out;
  };
  // 把贴图挂到材质上（复用时只挂一次）
  window.applyFurnTexture = function(material, role, skinId){
    if (!material || !material.isMaterial) return material;
    const t = window.furnTexture(role, skinId);
    if (!t) return material;
    if (t.map && !material.userData.furnMap){ material.map = t.map; material.userData.furnMap = 1; material.needsUpdate = true; }
    if (t.bumpMap && !material.userData.furnBump){ material.bumpMap = t.bumpMap; material.bumpScale = t.bumpScale || .3; material.userData.furnBump = 1; material.needsUpdate = true; }
    if (t.roughnessMap && !material.userData.furnRough){ material.roughnessMap = t.roughnessMap; material.userData.furnRough = 1; material.needsUpdate = true; }
    return material;
  };
})();
