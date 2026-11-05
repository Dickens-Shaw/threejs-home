/* ======================= 渲染 ======================= */
const NOLABEL = ['plant','floorlamp','sidetable','barstool','beanbag'];
function renderRooms(){
  let s = '';
  ROOMS.forEach(r => s += `<polygon class="room" data-room="${r.id}" points="${r.poly.map(p=>p.join(',')).join(' ')}" fill="url(#m-${state.rooms[r.id].mat})"/>`);
  const sill = ([a,b,c,d]) => `<rect x="${a}" y="${b}" width="${c-a}" height="${d-b}" fill="#e2dacb" stroke="#b9b0a0" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  DOORS.forEach(d => s += sill(d.rect)); SLIDES.forEach(d => s += sill(d.rect));
  $('#gRooms').innerHTML = s;
}

function renderFurn(){
  const g = $('#gFurn');
  g.setAttribute('display', !editing && ui.layers.furn ? 'inline' : 'none');
  g.innerHTML = state.furniture.map(f => {
    const fs = Math.max(80, Math.min(170, Math.min(f.w,f.d)*.2));
    const label = Math.min(f.w,f.d) >= 380 && !NOLABEL.includes(f.type)
      ? `<text transform="rotate(${-f.rot})" font-size="${fs}" text-anchor="middle" dominant-baseline="central" fill="#4a443c" opacity=".8" pointer-events="none">${esc(nm(f.name))}</text>` : '';
    return `<g class="furn" data-fid="${f.id}" transform="translate(${f.cx} ${f.cy}) rotate(${f.rot})">${furnSVG(f.type,f.w,f.d,f.color,f.parts)}${label}</g>`;
  }).join('');
}

function renderWalls(){
  $('#gWalls').innerHTML = WALLS.map(w => {
    const dem = state.demolished.includes(w.id), k = w.type;
    let fill = k==='b' ? (ui.layers.bearing ? '#b8412c' : '#26241f') : k==='low' ? '#e9e3d8' : k==='e' ? '#8f897d' : '#a7a195';
    let ex = k==='low' ? 'stroke="#8f897d" stroke-width="1" vector-effect="non-scaling-stroke"' : '';
    if (dem){ fill = 'rgba(198,91,58,.12)'; ex = 'stroke="#c65b3a" stroke-width="1.2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"'; }
    return `<polygon class="wall" data-wall="${w.id}" points="${wallQuad(w).map(p=>p.join(',')).join(' ')}" fill="${fill}" ${ex}/>`;
  }).join('');
}

function doorLeafSVG(d){
  const [hx, hy] = d.h, L = d.len, T = 40;
  const ox = hx + d.o[0] * L, oy = hy + d.o[1] * L, cx = hx + d.c[0] * L, cy = hy + d.c[1] * L;
  const sweep = d.o[0] * d.c[1] - d.o[1] * d.c[0] > 0 ? 1 : 0;
  const col = d.entry ? '#b5653a' : '#3d3a34';
  const DS = 'stroke="#3d3a34" stroke-width="1" vector-effect="non-scaling-stroke"';
  return `<polygon points="${hx},${hy} ${ox},${oy} ${ox + d.c[0] * T},${oy + d.c[1] * T} ${hx + d.c[0] * T},${hy + d.c[1] * T}" fill="#fff" stroke="${col}" stroke-width="${d.entry ? 1.8 : 1}" vector-effect="non-scaling-stroke"/>
    <path d="M${ox} ${oy}A${L} ${L} 0 0 ${sweep} ${cx} ${cy}" fill="none" ${DS} stroke-dasharray="5 3" opacity=".7"/>`;
}
function glassBands(q){
  const WS = 'stroke="#4f7394" stroke-width="1" vector-effect="non-scaling-stroke"';
  let s = `<polygon points="${q.map(p => p.join(',')).join(' ')}" fill="#f7fbfd" ${WS}/>`;
  [1/3, 2/3].forEach(t => {
    const a = [q[0][0] + (q[3][0] - q[0][0]) * t, q[0][1] + (q[3][1] - q[0][1]) * t];
    const b = [q[1][0] + (q[2][0] - q[1][0]) * t, q[1][1] + (q[2][1] - q[1][1]) * t];
    s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" ${WS}/>`;
  });
  return s;
}
function renderOpenings(){
  const WS = 'stroke="#4f7394" stroke-width="1" vector-effect="non-scaling-stroke"';
  const DS = 'stroke="#3d3a34" stroke-width="1" vector-effect="non-scaling-stroke"';
  let s = '';
  const wrap = (id, body) => `<g class="opening" data-open="${id}">${body}</g>`;
  WINS.forEach(win => {
    const [x0, y0, x1, y1] = win.rect, w = x1 - x0, h = y1 - y0;
    let body = `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#f7fbfd" ${WS}/>`;
    if (w >= h) [1/3, 2/3].forEach(t => body += `<line x1="${x0}" y1="${y0 + h * t}" x2="${x1}" y2="${y0 + h * t}" ${WS}/>`);
    else [1/3, 2/3].forEach(t => body += `<line x1="${x0 + w * t}" y1="${y0}" x2="${x0 + w * t}" y2="${y1}" ${WS}/>`);
    s += wrap(win.id, body);
  });
  DOORS.forEach(d => s += wrap(d.id, doorLeafSVG(d)));
  SLIDES.forEach(sl => {
    const [x0, y0, x1, y1] = sl.rect, v = sl.v;
    const body = v
      ? `<rect x="${(x0 + x1) / 2 - 45}" y="${y0}" width="40" height="${(y1 - y0) * .55}" fill="#fff" ${DS}/><rect x="${(x0 + x1) / 2 + 5}" y="${y1 - (y1 - y0) * .55}" width="40" height="${(y1 - y0) * .55}" fill="#fff" ${DS}/>`
      : `<rect x="${x0}" y="${(y0 + y1) / 2 - 45}" width="${(x1 - x0) * .55}" height="40" fill="#fff" ${DS}/><rect x="${x1 - (x1 - x0) * .55}" y="${(y0 + y1) / 2 + 5}" width="${(x1 - x0) * .55}" height="40" fill="#fff" ${DS}/>`;
    s += wrap(sl.id, body);
  });
  for (const op of state.openings){
    if (!op.wallId) continue;
    const host = wallById(op.wallId);
    if (!host || state.demolished.includes(host.id)) continue;
    const q = wallQuad(sliceWall(host, op.t, op.t + op.len));
    const pts = q.map(p => p.join(',')).join(' ');
    let body = '';
    if (op.kind === 'win') body = glassBands(q);
    else if (op.kind === 'hole') body = `<polygon points="${pts}" fill="#e7e0d4" stroke="#b9b0a0" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    else if (op.kind === 'door') body = `<polygon points="${pts}" fill="#e2dacb" stroke="#b9b0a0" stroke-width="1" vector-effect="non-scaling-stroke"/>` + doorLeafSVG(Object.assign({entry:op.entry, len:op.len}, openingFrame(op, host)));
    else if (op.kind === 'slide'){
      const slc = sliceWall(host, op.t, op.t + op.len), L = wallLen(slc) || 1;
      const ux = (slc.b[0] - slc.a[0]) / L, uy = (slc.b[1] - slc.a[1]) / L, nx = -uy, ny = ux;
      const leaf = (t0, t1, off) => {
        const A = [slc.a[0] + ux * t0 + nx * off, slc.a[1] + uy * t0 + ny * off];
        const B = [slc.a[0] + ux * t1 + nx * off, slc.a[1] + uy * t1 + ny * off];
        return `<polygon points="${[A, B, [B[0] + nx * 40, B[1] + ny * 40], [A[0] + nx * 40, A[1] + ny * 40]].map(p => p.join(',')).join(' ')}" fill="#fff" ${DS}/>`;
      };
      body = `<polygon points="${pts}" fill="#e2dacb"/>` + leaf(0, L * .55, -45) + leaf(L * .45, L, 5);
    }
    if (body) s += wrap(op.id, body);
  }
  const door = entryDoor();
  if (door){
    const [x0, y0, x1, y1] = door.rect, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ox = door.o[0], oy = door.o[1];
    const xA = cx - ox * 1400, yA = cy - oy * 1400, xB = cx - ox * 280, yB = cy - oy * 280, px = -oy, py = ox;
    s += `<path d="M${xA} ${yA}L${xB} ${yB}M${xB - ox * 150 + px * 150} ${yB - oy * 150 + py * 150}L${xB} ${yB}L${xB - ox * 150 - px * 150} ${yB - oy * 150 - py * 150}" fill="none" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>
      <text x="${xA}" y="${yA - 160}" font-size="200" fill="#b5653a" pointer-events="none">${tr('入户', 'Entry')}</text>`;
  }
  $('#gOpen').innerHTML = s;
}

function renderLabels(){
  const g = $('#gLabels');
  g.setAttribute('display', ui.layers.labels ? 'inline' : 'none');
  g.innerHTML = ROOMS.filter(r => r.at).map(r => {
    const [x,y] = r.at, halo = 'stroke="#fbf9f4" stroke-width="45" paint-order="stroke" stroke-linejoin="round"';
    return `<text x="${x}" y="${y}" font-size="250" font-weight="600" text-anchor="middle" fill="#2b2824" ${halo}>${esc(nm(state.rooms[r.id].name))}</text>
      <text x="${x}" y="${y+260}" font-size="175" text-anchor="middle" fill="#7d7366" ${halo}>${fmt(area(r.poly))} m²</text>`;
  }).join('');
}

function renderDims(){
  const DC = '#7d7160', LS = `stroke="${DC}" stroke-width="1" vector-effect="non-scaling-stroke"`, TK = `stroke="${DC}" stroke-width="2" vector-effect="non-scaling-stroke"`;
  const txt = (x,y,v,rot) => `<text x="${x}" y="${y}" font-size="${v<400?140:200}" text-anchor="middle" fill="${DC}" ${rot?`transform="rotate(-90 ${x} ${y})"`:''}>${v}</text>`;
  const chain = (horiz, at, start, segs) => {
    const pts = [start]; segs.forEach(v => pts.push(pts[pts.length-1]+v));
    let s = horiz ? `<line x1="${pts[0]}" y1="${at}" x2="${pts.at(-1)}" y2="${at}" ${LS}/>` : `<line x1="${at}" y1="${pts[0]}" x2="${at}" y2="${pts.at(-1)}" ${LS}/>`;
    pts.forEach(p => s += horiz
      ? `<line x1="${p}" y1="${at-170}" x2="${p}" y2="${at+170}" ${LS}/><line x1="${p-80}" y1="${at+80}" x2="${p+80}" y2="${at-80}" ${TK}/>`
      : `<line x1="${at-170}" y1="${p}" x2="${at+170}" y2="${p}" ${LS}/><line x1="${at-80}" y1="${p+80}" x2="${at+80}" y2="${p-80}" ${TK}/>`);
    segs.forEach((v,i) => { const mid = (pts[i]+pts[i+1])/2; s += horiz ? txt(mid, at-70, v) : txt(at-70, mid, v, true); });
    return s;
  };
  const g = $('#gDims');
  const custom = planDimChains(state);
  if (!custom && !state.presetDims){ g.innerHTML = ''; g.setAttribute('display', ui.layers.dims ? 'inline' : 'none'); return; }
  g.innerHTML = custom
    ? custom.map(d => chain(!!d.horiz, d.at, d.start, d.segs)).join('')
    : chain(true,-750,0,[1580,240,2760,240,1540,240,3670]) + chain(true,-1250,0,[10270]) +
      chain(true,11350,0,[2180,240,2160,240,5450,240,1340]) + chain(true,11850,0,[11850]) +
      chain(false,-800,0,[3370,1580,240,2770,240,2360]) + chain(false,-1300,0,[10560]) +
      chain(false,12750,0,[3370,240,2760,240,3950]) + chain(false,13250,0,[10560]);
  g.setAttribute('display', ui.layers.dims ? 'inline' : 'none');
}

function renderGrid(){
  $('#gGrid').innerHTML = `<rect x="-20000" y="-20000" width="55000" height="55000" fill="${ui.layers.grid ? 'url(#grid)' : 'transparent'}" data-bg="1"/>`;
}

function renderMeasure(){
  const k = 1/view.s, fs = 12*k;
  const one = (a,b,tmp) => {
    const L = Math.hypot(b.x-a.x, b.y-a.y); if (L < 1) return '';
    let ang = Math.atan2(b.y-a.y, b.x-a.x)*180/Math.PI; if (ang > 90 || ang < -90) ang += 180;
    const mx = (a.x+b.x)/2, my = (a.y+b.y)/2, nx = -(b.y-a.y)/L*5*k, ny = (b.x-a.x)/L*5*k;
    const col = tmp ? '#2f5d62' : '#b5653a', S = `stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"`;
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${S}/>
      <line x1="${a.x-nx}" y1="${a.y-ny}" x2="${a.x+nx}" y2="${a.y+ny}" ${S}/><line x1="${b.x-nx}" y1="${b.y-ny}" x2="${b.x+nx}" y2="${b.y+ny}" ${S}/>
      <text x="${mx}" y="${my-5*k}" font-size="${fs}" text-anchor="middle" fill="${col}" font-weight="600" transform="rotate(${ang} ${mx} ${my})"
        stroke="#fff" stroke-width="${3.5*k}" paint-order="stroke">${Math.round(L)} mm</text>`;
  };
  let s = state.measures.map(m => one(m.a,m.b)).join('');
  if (ui.mA && ui.mCur) s += one(ui.mA, ui.mCur, true);
  if (ui.mA) s += `<circle cx="${ui.mA.x}" cy="${ui.mA.y}" r="${3*k}" fill="#2f5d62"/>`;
  $('#gMeasure').innerHTML = s;
}

function renderSel(){
  const k = 1/view.s; let s = '';
  const knob = (x, y, handle, end) => {
    const hit = (COARSE ? 18 : 8) * k, tag = end ? ` data-end="${end}"` : '';
    return `<circle data-handle="${handle}"${tag} cx="${x}" cy="${y}" r="${hit}" fill="transparent"/><circle data-handle="${handle}"${tag} cx="${x}" cy="${y}" r="${6 * k}" fill="#fff" stroke="#b5653a" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  };
  if (ui.sel?.kind === 'furn' && !editing){
    const f = getF(ui.sel.id);
    if (f){
      // 触屏上手柄更大、离家具更远，并各带一圈透明的大热区
      const p = 5*k, A = 'stroke="#b5653a" vector-effect="non-scaling-stroke"', hs = COARSE ? 1.7 : 1, ro = (COARSE ? 40 : 26)*k, hit = (COARSE ? 24 : 11)*k;
      const sx = f.w/2+p, sy = f.d/2+p;
      s += `<g transform="translate(${f.cx} ${f.cy}) rotate(${f.rot})">
        <rect x="${-f.w/2-p}" y="${-f.d/2-p}" width="${f.w+2*p}" height="${f.d+2*p}" fill="none" ${A} stroke-width="1.5" stroke-dasharray="5 3" pointer-events="none"/>
        <line x1="0" y1="${-f.d/2-p}" x2="0" y2="${-f.d/2-ro}" ${A} stroke-width="1" pointer-events="none"/>
        <circle data-handle="rot" cx="0" cy="${-f.d/2-ro}" r="${hit}" fill="transparent"/>
        <circle data-handle="rot" cx="0" cy="${-f.d/2-ro}" r="${6*hs*k}" fill="#fff" ${A} stroke-width="1.5"><title>${tr('拖动旋转（Shift 自由角度）','Drag to rotate (Shift for free angle)')}</title></circle>
        <circle data-handle="size" cx="${sx}" cy="${sy}" r="${hit}" fill="transparent"/>
        <rect data-handle="size" x="${sx-5*hs*k}" y="${sy-5*hs*k}" width="${10*hs*k}" height="${10*hs*k}" fill="#b5653a"><title>${tr('拖动调整尺寸','Drag to resize')}</title></rect></g>`;
      const {hh} = aabb(f);
      s += `<text x="${f.cx}" y="${f.cy+hh+24*k}" font-size="${12*k}" text-anchor="middle" fill="#b5653a" font-weight="600" pointer-events="none"
        stroke="#fff" stroke-width="${3*k}" paint-order="stroke">${f.w} × ${f.d}</text>`;
    }
  } else if (ui.sel?.kind === 'room'){
    const r = ROOMS.find(r => r.id === ui.sel.id);
    if (r) s += `<polygon points="${r.poly.map(p=>p.join(',')).join(' ')}" fill="rgba(181,101,58,.08)" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  } else if (ui.sel?.kind === 'wall' || ui.sel?.kind === 'open'){
    const w = ui.sel.kind === 'wall' ? WALLS.find(w => w.id === ui.sel.id) : wallById(state.openings.find(o => o.id === ui.sel.id)?.wallId);
    const op = ui.sel.kind === 'open' ? state.openings.find(o => o.id === ui.sel.id) : null;
    const q = w ? (op && op.wallId ? wallQuad(sliceWall(w, op.t, op.t + op.len)) : wallQuad(w)) : null;
    if (q) s += `<polygon points="${q.map(p=>p.join(',')).join(' ')}" fill="rgba(181,101,58,.18)" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    if (w && ui.sel.kind === 'wall' && editing && !w.bayId){
      for (const end of ['a', 'b']) s += knob(w[end][0], w[end][1], 'wend', end);
    }
    if (editing && op && w && op.wallId && !op.bayId){
      const a = alongWall(w, op.t), b = alongWall(w, op.t + op.len);
      s += knob(a.x, a.y, 'oend', 'start') + knob(b.x, b.y, 'oend', 'end');
    }
  } else if (ui.sel?.kind === 'bay' && editing){
    const fr = bayFrame(bayById(ui.sel.id) || {});
    if (fr){
      const hit = (COARSE ? 18 : 8) * k, mx = (fr.q0[0] + fr.q1[0]) / 2, my = (fr.q0[1] + fr.q1[1]) / 2;
      s += `<polygon points="${fr.p0.x},${fr.p0.y} ${fr.q0[0]},${fr.q0[1]} ${fr.q1[0]},${fr.q1[1]} ${fr.p1.x},${fr.p1.y}" fill="rgba(181,101,58,.12)" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
      s += `<line x1="${fr.q0[0]}" y1="${fr.q0[1]}" x2="${fr.q1[0]}" y2="${fr.q1[1]}" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
      s += knob(fr.p0.x, fr.p0.y, 'bend', 'start') + knob(fr.p1.x, fr.p1.y, 'bend', 'end');
      s += `<rect data-handle="bdepth" x="${mx - hit}" y="${my - hit}" width="${hit * 2}" height="${hit * 2}" fill="transparent"/>
        <rect data-handle="bdepth" x="${mx - 6 * k}" y="${my - 6 * k}" width="${12 * k}" height="${12 * k}" fill="#b5653a"/>`;
    }
  }
  if (ui.wallA && ui.wallB){
    const q = wallQuad({a:[ui.wallA.x, ui.wallA.y], b:[ui.wallB.x, ui.wallB.y], thick:240});
    s += `<polygon points="${q.map(p=>p.join(',')).join(' ')}" fill="rgba(181,101,58,.35)" stroke="#b5653a" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  }
  $('#gSel').innerHTML = s;
}

function renderAll(){
  validateSel();
  renderGrid(); renderRooms(); renderFurn(); renderWalls(); renderOpenings(); renderDims(); renderLabels(); renderMeasure(); renderSel(); renderPanel(); updateHeader();
  window.View3D?.sync();
}

function updateHeader(){
  const tot = ROOMS.filter(r => r.counted !== false).reduce((a,r) => a + area(r.poly), 0);
  const scaleNote = state.presetDims ? tr(' · 原图比例 1:60', ' · Original scale 1:60') : '';
  $('#planTitle').textContent = nm(state.name || '未命名户型');
  $('#subtitle').textContent = tr(`套内使用面积约 ${fmt(tot)} m² · 尺寸单位 mm`, `Net floor area ≈ ${fmt(tot)} m² · Units: mm`) + scaleNote;
  syncSaveBtn();
  $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length;
  $('#undo').style.opacity = undoStack.length ? 1 : .4; $('#redo').style.opacity = redoStack.length ? 1 : .4;
}

/* ======================= 右侧面板 ======================= */
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function renderPanel(){
  renderFab();
  const p = $('#panel');
  if (typeof isPreview === 'function' && isPreview()){
    if (studioFurn){ p.innerHTML = furnPanel(studioFurn); bindFurnPanel(studioFurn); return; }
    p.innerHTML = `<section><h3>${tr('家具预览', 'Furniture preview')}</h3><p class="muted">${tr('从左侧点一件家具。这里只看这一件，不会放进户型。', 'Pick a piece on the left. Only this piece is shown, and it is not added to the plan.')}</p></section>`;
    return;
  }
  if (ui.sel?.kind === 'furn'){ const f = getF(ui.sel.id); if (f){ p.innerHTML = furnPanel(f); bindFurnPanel(f); return; } }
  if (ui.sel?.kind === 'bay'){ const b = bayById(ui.sel.id); if (b){ p.innerHTML = bayPanel(b); bindBayPanel(b); return; } }
  if (ui.sel?.kind === 'wall'){ const w = WALLS.find(w => w.id === ui.sel.id); if (w){ if (w.bayId && bayById(w.bayId)){ p.innerHTML = bayPanel(bayById(w.bayId)); bindBayPanel(bayById(w.bayId)); return; } p.innerHTML = wallPanel(w); bindWallPanel(w); return; } }
  if (ui.sel?.kind === 'open'){ const o = state.openings.find(o => o.id === ui.sel.id); if (o){ p.innerHTML = openPanel(o); bindOpenPanel(o); return; } }
  if (ui.sel?.kind === 'room'){ const r = ROOMS.find(r => r.id === ui.sel.id); if (r){ p.innerHTML = roomPanel(r); bindRoomPanel(); return; } }
  p.innerHTML = overviewPanel(); bindOverview();
}

function overviewPanel(){
  const rows = ROOMS.map(r => {
    const st = state.rooms[r.id];
    return `<tr class="click" data-room="${r.id}"><td><span class="sw" style="background:${MATS[st.mat].sw}"></span>${esc(nm(st.name))}${r.counted===false?' <span class="muted">*</span>':''}</td>
      <td class="r">${fmt(area(r.poly))} m²</td></tr>`;
  }).join('');
  const tot = ROOMS.filter(r => r.counted !== false).reduce((a,r) => a + area(r.poly), 0);
  const byMat = {};
  ROOMS.forEach(r => { const m = state.rooms[r.id].mat; byMat[m] = (byMat[m]||0) + area(r.poly); });
  let cost = 0;
  const matRows = Object.entries(byMat).map(([m,a]) => { const c = a*MATS[m].price*1.05; cost += c;
    return `<tr><td><span class="sw" style="background:${MATS[m].sw}"></span>${nm(MATS[m].name)}</td><td class="r">${fmt(a,1)} m²</td><td class="r">¥${Math.round(c).toLocaleString()}</td></tr>`; }).join('');
  const demLen = state.demolished.reduce((a, id) => { const w = WALLS.find(w => w.id === id); return a + (w ? wallLen(w) : 0); }, 0) / 1000;
  return `
  <section><h3>${tr('房间面积','Room Areas')} <small>${tr('点击查看 / 更换地面','Click to view / change flooring')}</small></h3>
    <table>${rows}</table>
    <div class="total"><span>${tr('套内使用面积','Net floor area')}</span><b>${fmt(tot)} m²</b></div>
    <div class="muted" style="font-size:11px;margin-top:4px">${tr('* 飘窗不计入使用面积；面积按墙体内净尺寸计算','* Bay windows are excluded; areas use net inner wall dimensions')}</div></section>
  <section><h3>${tr('地面材料估算','Flooring Estimate')} <small>${tr('含 5% 损耗','incl. 5% waste')}</small></h3>
    <table>${matRows}</table>
    <div class="total"><span>${tr('地面材料合计','Flooring total')}</span><b>¥${Math.round(cost).toLocaleString()}</b></div></section>
  <section><h3>${tr('方案统计','Plan Stats')}</h3>
    <div class="stats">${editing ? '' : `<div><small>${tr('家具数量','Furniture')}</small><span class="big">${state.furniture.length}</span></div>`}
      <div><small>${tr('拆除墙体','Walls removed')}</small><span class="big">${fmt(demLen,1)}</span> m</div></div>
    <div class="actions"><button class="btn" id="clearMeasure">${tr('清除测量','Clear measures')} (${state.measures.length})</button>
      ${editing ? '' : `<button class="btn danger" id="clearFurn">${tr('清空布置','Clear layout')}</button>`}</div></section>
  ${COARSE ? (editing ? tr(`<section><h3>触屏操作</h3><div class="kbd">
    <kbd>绘制</kbd><span>点一项，再到图上拖墙或点墙放门窗</span>
    <kbd>单指拖动</kbd><span>空白处平移画面</span><kbd>双指</kbd><span>捏合缩放、拖动平移</span>
    <kbd>选择</kbd><span>点已有墙、门、窗，拖两端圆点改长短</span>
    <kbd>测量</kbd><span>按住拖出一条线，或依次点两点</span>
  </div></section>`, `<section><h3>Touch Controls</h3><div class="kbd">
    <kbd>Draw</kbd><span>Pick a tool, then drag a wall or tap a wall for an opening</span>
    <kbd>1-finger drag</kbd><span>Pan on empty space</span><kbd>2 fingers</kbd><span>Pinch to zoom, drag to pan</span>
    <kbd>Select</kbd><span>Tap a wall, door or window; drag the end dots to resize</span>
    <kbd>Measure</kbd><span>Hold and drag a line, or tap two points</span>
  </div></section>`) : tr(`<section><h3>触屏操作</h3><div class="kbd">
    <kbd>单指拖动</kbd><span>空白处平移画面</span><kbd>双指</kbd><span>捏合缩放、拖动平移</span>
    <kbd>家具库</kbd><span>点一下放到画面中央，或按住向右拖到指定位置</span>
    <kbd>点家具</kbd><span>选中后拖动移动；拖顶部圆点旋转、右下方块改尺寸</span>
    <kbd>工具条</kbd><span>选中后底部可旋转 / 复制 / 删除</span>
    <kbd>测量</kbd><span>按住拖出一条线，或依次点两点</span>
    <kbd>3D 漫游</kbd><span>左下摇杆移动，拖动屏幕转向，点门开关</span>
  </div></section>`, `<section><h3>Touch Controls</h3><div class="kbd">
    <kbd>1-finger drag</kbd><span>Pan on empty space</span><kbd>2 fingers</kbd><span>Pinch to zoom, drag to pan</span>
    <kbd>Library</kbd><span>Tap to place at center, or hold and drag right to a spot</span>
    <kbd>Tap item</kbd><span>Drag to move; top dot rotates, bottom-right square resizes</span>
    <kbd>Toolbar</kbd><span>Bottom bar can rotate / duplicate / delete</span>
    <kbd>Measure</kbd><span>Hold and drag a line, or tap two points</span>
    <kbd>3D walk</kbd><span>Joystick moves, drag to look, tap doors to open</span>
  </div></section>`)) : ''}
  ${editing ? tr(`<section><h3>键盘快捷键</h3><div class="kbd">
    <kbd>拖拽</kbd><span>拖出墙段（Shift 画斜墙）</span><kbd>V</kbd><span>选择已有墙门窗</span><kbd>M</kbd><span>测量（Shift 水平/垂直）</span>
    <kbd>Delete</kbd><span>删除墙或门窗</span><kbd>⌘/Ctrl Z</kbd><span>撤销</span><kbd>⌘/Ctrl Shift Z</kbd><span>重做</span>
    <kbd>F</kbd><span>适应窗口</span><kbd>Esc</kbd><span>取消绘制</span><kbd>[</kbd><span>收起绘制</span>
  </div></section>`, `<section><h3>Keyboard Shortcuts</h3><div class="kbd">
    <kbd>Drag</kbd><span>Drag a wall (Shift for a slope)</span><kbd>V</kbd><span>Select a wall or opening</span><kbd>M</kbd><span>Measure (Shift: horizontal/vertical)</span>
    <kbd>Delete</kbd><span>Delete a wall or opening</span><kbd>⌘/Ctrl Z</kbd><span>Undo</span><kbd>⌘/Ctrl Shift Z</kbd><span>Redo</span>
    <kbd>F</kbd><span>Fit to window</span><kbd>Esc</kbd><span>Cancel drawing</span><kbd>[</kbd><span>Hide draw tools</span>
  </div></section>`) : tr(`<section><h3>键盘快捷键</h3><div class="kbd">
    <kbd>拖拽</kbd><span>左侧家具拖入平面图</span><kbd>V</kbd><span>选择 / 移动</span><kbd>M</kbd><span>测量（Shift 水平/垂直）</span>
    <kbd>R</kbd><span>旋转 90°（Shift 反向）</span><kbd>方向键</kbd><span>微调 10mm（Shift 100mm）</span>
    <kbd>⌘/Ctrl D</kbd><span>复制</span><kbd>Delete</kbd><span>删除</span><kbd>⌘/Ctrl Z</kbd><span>撤销</span><kbd>T</kbd><span>切换 2D / 3D</span><kbd>F</kbd><span>适应窗口</span><kbd>Esc</kbd><span>取消选择</span>
  </div></section>`, `<section><h3>Keyboard Shortcuts</h3><div class="kbd">
    <kbd>Drag</kbd><span>Drag furniture onto the plan</span><kbd>V</kbd><span>Select / move</span><kbd>M</kbd><span>Measure (Shift: horizontal/vertical)</span>
    <kbd>R</kbd><span>Rotate 90° (Shift reverses)</span><kbd>Arrows</kbd><span>Nudge 10mm (Shift 100mm)</span>
    <kbd>⌘/Ctrl D</kbd><span>Duplicate</span><kbd>Delete</kbd><span>Delete</span><kbd>⌘/Ctrl Z</kbd><span>Undo</span><kbd>T</kbd><span>Toggle 2D / 3D</span><kbd>F</kbd><span>Fit to window</span><kbd>Esc</kbd><span>Deselect</span>
  </div></section>`)}`;
}
function bindOverview(){
  document.querySelectorAll('#panel tr[data-room]').forEach(tr => tr.onclick = () => { select({kind:'room', id:tr.dataset.room}); if (is3D()) window.View3D.flyToRoom(tr.dataset.room); });
  $('#clearMeasure').onclick = () => state.measures.length && mutate(() => state.measures = []);
  if ($('#clearFurn')) $('#clearFurn').onclick = clearLayout;
}

// 底部浮动工具条：触屏没有键盘，旋转 / 复制 / 删除都放在这里
function renderFab(){
  const fab = $('#fab');
  if (typeof isPreview === 'function' && isPreview()){ fab.classList.remove('show'); return; }
  const f = ui.sel?.kind === 'furn' && getF(ui.sel.id), r = ui.sel?.kind === 'room' && ROOMS.find(r => r.id === ui.sel.id);
  const shell = ui.sel?.kind === 'wall' || ui.sel?.kind === 'open' || ui.sel?.kind === 'bay';
  if (!f && !r && !shell){ fab.classList.remove('show'); return; }
  fab.innerHTML = f
    ? `<span class="name">${esc(nm(f.name))}</span><button class="btn" data-a="rotL">↺</button><button class="btn" data-a="rotR">↻ ${tr('旋转','Rotate')}</button>
       <button class="btn" data-a="dup">${tr('复制','Duplicate')}</button><button class="btn danger" data-a="del">${tr('删除','Delete')}</button><span class="sep"></span>
       <button class="btn narrow-only" data-a="prop">${tr('属性','Properties')}</button><button class="btn" data-a="done">${tr('完成','Done')}</button>`
    : shell
    ? `<span class="name">${ui.sel.kind === 'bay' ? tr('飘窗', 'Bay window') : ui.sel.kind === 'wall' ? tr('墙体', 'Wall') : tr('门窗', 'Opening')}</span><button class="btn danger" data-a="del">${tr('删除', 'Delete')}</button><button class="btn narrow-only" data-a="prop">${tr('属性', 'Properties')}</button><button class="btn" data-a="done">${tr('完成', 'Done')}</button>`
    : `<span class="name">${esc(nm(state.rooms[r.id].name))}</span><button class="btn narrow-only" data-a="prop">${tr('地面 / 属性','Floor / Properties')}</button><button class="btn" data-a="done">${tr('完成','Done')}</button>`;
  fab.classList.add('show');
  fab.querySelectorAll('[data-a]').forEach(b => b.onclick = () => ({
    rotL:() => rotateSel(-90), rotR:() => rotateSel(90), dup:duplicateSel, del:deleteSel,
    prop:() => drawer('panel', true), done:() => { select(null); closeDrawers(); },
  })[b.dataset.a]());
}

function clearLayout(){
  const n = state.furniture.length;
  if (!n) return toast(tr('当前没有布置任何家具', 'There is no furniture to clear'));
  if (!confirm(tr(`确定清空全部 ${n} 件家具 / 家电吗？\n墙体、地面材料和测量线会保留，可点「撤销」恢复。`, `Remove all ${n} furniture / appliance items?\nWalls, flooring and measurements are kept. You can Undo this.`))) return;
  ui.sel = null; mutate(() => state.furniture = []);
  toast(tr('已清空布置，可点「撤销」恢复', 'Layout cleared — Undo to restore'));
}

/* 侧栏开合：which = 'lib' | 'panel' | null，open 不传则切换。
 * 宽屏：侧栏在布局中收起 / 展开（记住选择）；窄屏：侧栏是浮层抽屉，一次只开一个，which = null 表示全部关闭 */
const PANES = 'huxing-panes';
const panes = (() => { try { return JSON.parse(localStorage.getItem(PANES)) || {}; } catch(e) { return {}; } })();
function drawer(which, open){
  const app = $('.app'), els = {lib:$('aside.lib'), panel:$('aside.right')}, n = narrow();
  if (n){
    Object.entries(els).forEach(([k, el]) => el.classList.toggle('open', k === which && (open ?? !el.classList.contains('open'))));
  } else {
    Object.values(els).forEach(el => el.classList.remove('open'));
    if (which){
      const k = which === 'lib' ? 'hideLib' : 'hidePanel';
      panes[k] = open === undefined ? !panes[k] : !open;
      try { localStorage.setItem(PANES, JSON.stringify(panes)); } catch(e) {}
    }
  }
  app.classList.toggle('hide-lib', !!panes.hideLib); app.classList.toggle('hide-panel', !!panes.hidePanel);
  syncPaneBtns();
}
function syncPaneBtns(){
  const els = {lib:$('aside.lib'), panel:$('aside.right')}, n = narrow();
  const vis = k => n ? els[k].classList.contains('open') : !panes[k === 'lib' ? 'hideLib' : 'hidePanel'];
  const drawing = document.body.classList.contains('editing');
  $('#tgLib').textContent = drawing ? tr('绘制', 'Draw') : tr('家具库', 'Library');
  $('#tgLib').classList.toggle('on', vis('lib')); $('#tgPanel').classList.toggle('on', vis('panel'));
  $('#tgLib').title = drawing
    ? (vis('lib') ? tr('收起绘制 ( [ )', 'Hide draw tools ( [ )') : tr('展开绘制 ( [ )', 'Show draw tools ( [ )'))
    : (vis('lib') ? tr('收起家具库 ( [ )', 'Hide library ( [ )') : tr('展开家具库 ( [ )', 'Show library ( [ )'));
  $('#tgPanel').title = vis('panel') ? tr('收起属性面板 ( ] )', 'Hide properties ( ] )') : tr('展开属性面板 ( ] )', 'Show properties ( ] )');
  $('#stage').classList.toggle('drawer-panel', n && vis('panel'));   // 属性抽屉盖住画面时让出底部工具条
}
function closeDrawers(){ if (narrow()) drawer(null); }

function roomPanel(r){
  const st = state.rooms[r.id], a = area(r.poly), [x0,y0,x1,y1] = bbox(r.poly);
  const inside = editing ? [] : state.furniture.filter(f => f.roomId ? f.roomId === r.id : (f.cx > x0 && f.cx < x1 && f.cy > y0 && f.cy < y1));
  const mats = Object.entries(MATS).map(([k,m]) => `<button class="mat ${k===st.mat?'on':''}" data-mat="${k}"><i style="background:${m.sw}"></i><span>${nm(m.name)}<small>¥${m.price}/m²</small></span></button>`).join('');
  const furn = editing ? '' : `<section><h3>${tr('房间内家具','Furniture in room')} <small>${tr(`${inside.length} 件`, `${inside.length} items`)}</small></h3>
    <table>${inside.map(f => `<tr class="click" data-fid="${f.id}"><td>${esc(nm(f.name))}</td><td class="r muted">${f.w}×${f.d}</td></tr>`).join('') || `<tr><td class="muted">${tr('暂无','None')}</td></tr>`}</table></section>`;
  return `<section><h3>${tr('房间','Room')}</h3>
    <div class="form"><label class="full">${tr('名称','Name')}<input id="rName" value="${esc(nm(st.name))}"></label></div>
    <div class="stats" style="margin-top:10px">
      <div><small>${tr('使用面积','Floor area')}</small><span class="big">${fmt(a)}</span> m²</div>
      <div><small>${tr('周长','Perimeter')}</small><span class="big">${fmt(perim(r.poly),1)}</span> m</div>
      <div><small>${tr('开间','Width')}</small><span class="big">${x1-x0}</span> mm</div>
      <div><small>${tr('进深','Depth')}</small><span class="big">${y1-y0}</span> mm</div></div>
    <div class="muted">${tr(`墙面面积（层高 2.8m，未扣门窗）约 ${fmt(perim(r.poly)*2.8,1)} m²`, `Wall area (2.8m ceiling, openings not deducted) ≈ ${fmt(perim(r.poly)*2.8,1)} m²`)}</div></section>
  <section><h3>${tr('地面材料','Flooring')}</h3><div class="mats">${mats}</div>
    <div class="total"><span>${tr('材料估价','Estimated cost')}</span><b>¥${Math.round(a*MATS[st.mat].price*1.05).toLocaleString()}</b></div></section>
  ${furn}
  <div class="actions"><button class="btn" id="back">${tr('← 返回总览','← Back to overview')}</button></div>`;
}
function bindRoomPanel(){
  const id = ui.sel.id;
  $('#rName').onchange = e => mutate(() => state.rooms[id].name = e.target.value.trim() || state.rooms[id].name);
  document.querySelectorAll('#panel [data-mat]').forEach(b => b.onclick = () => mutate(() => state.rooms[id].mat = b.dataset.mat));
  document.querySelectorAll('#panel tr[data-fid]').forEach(tr => tr.onclick = () => select({kind:'furn', id:tr.dataset.fid}));
  $('#back').onclick = () => select(null);
}

function furnPanel(f){
  const preview = String(f.id).startsWith('studio:');
  const room = !preview && f.roomId && (state.shellRooms || []).find(r => r.id === f.roomId);
  const roomLine = room ? `<div class="muted" style="margin-top:8px">${tr('所在房间', 'Room')} ${esc(nm(state.rooms[room.id]?.name || room.name))}</div>` : '';
  return `<section><h3>${preview ? tr('预览', 'Preview') : tr('家具属性','Furniture')}</h3>
    <div class="form">
      <label class="full">${tr('名称','Name')}<input id="fName" value="${esc(nm(f.name))}"></label>
      <label>${tr('宽','Width')} (mm)<input type="number" id="fW" value="${f.w}" min="50" step="10"></label>
      <label>${tr('深','Depth')} (mm)<input type="number" id="fD" value="${f.d}" min="50" step="10"></label>
      ${preview ? '' : `<label>${tr('中心','Center')} X (mm)<input type="number" id="fX" value="${Math.round(f.cx)}" step="10"></label>
      <label>${tr('中心','Center')} Y (mm)<input type="number" id="fY" value="${Math.round(f.cy)}" step="10"></label>`}
      <label>${tr('旋转','Rotation')} (°)<input type="number" id="fR" value="${f.rot}" step="15"></label>
      <label>${tr('颜色','Color')}<input type="color" id="fC" value="${f.color}"></label>
    </div>
    <div class="muted" style="margin-top:8px">${tr('占地面积','Footprint')} ${fmt(f.w*f.d/1e6)} m²</div>
    ${roomLine}
    <div class="actions">
      <button class="btn" id="aRot">${tr('旋转 90°','Rotate 90°')}</button>
      ${preview ? `<button class="btn" id="aDel">${tr('清除预览','Clear preview')}</button>` : `<button class="btn" id="aDup">${tr('复制','Duplicate')}</button>
      <button class="btn" id="aTop">${tr('置于顶层','Bring to front')}</button><button class="btn" id="aBot">${tr('置于底层','Send to back')}</button>
      <button class="btn danger" id="aDel">${tr('删除','Delete')}</button>`}
      <button class="btn" id="back">${tr('← 返回','← Back')}</button>
    </div></section>
  <section class="muted" style="font-size:12px">${preview
    ? tr('只改中间这件预览，不会放进户型。', 'Edits apply to this preview only and are not added to the plan.')
    : tr('拖动家具移动；拖动上方圆点旋转；拖动右下角方块调整尺寸。开启「贴墙吸附」后靠近墙面会自动贴齐。', 'Drag to move; drag the top dot to rotate; drag the bottom-right square to resize. With "Wall snap" on, items snap flush to nearby walls.')}</section>`;
}
function bindFurnPanel(f){
  const preview = String(f.id).startsWith('studio:');
  const upd = (fn) => {
    if (preview){ fn(studioFurn); renderPanel(); window.View3D?.sync(); return; }
    mutate(() => { const g = getF(f.id); if (g) fn(g); });
  };
  const num = (id, fn) => $(id).onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(g => fn(g, v)); };
  $('#fName').onchange = e => upd(g => g.name = e.target.value.trim() || g.name);
  num('#fW', (g,v) => g.w = Math.max(50, Math.round(v)));
  num('#fD', (g,v) => g.d = Math.max(50, Math.round(v)));
  if (!preview){ num('#fX', (g,v) => { g.cx = v; markFurnitureRoom(g); }); num('#fY', (g,v) => { g.cy = v; markFurnitureRoom(g); }); }
  num('#fR', (g,v) => g.rot = norm(v));
  $('#fC').onchange = e => upd(g => g.color = e.target.value);
  if (preview){
    $('#aRot').onclick = () => upd(g => g.rot = norm(g.rot + 90));
    $('#aDel').onclick = () => { studioFurn = null; renderPanel(); window.View3D?.sync(); };
    $('#back').onclick = () => { studioFurn = null; renderPanel(); window.View3D?.sync(); };
    return;
  }
  $('#aRot').onclick = () => rotateSel(90);
  $('#aDup').onclick = duplicateSel;
  $('#aDel').onclick = deleteSel;
  $('#aTop').onclick = () => mutate(() => { const i = state.furniture.findIndex(g => g.id===f.id); state.furniture.push(...state.furniture.splice(i,1)); });
  $('#aBot').onclick = () => mutate(() => { const i = state.furniture.findIndex(g => g.id===f.id); state.furniture.unshift(...state.furniture.splice(i,1)); });
  $('#back').onclick = () => select(null);
}

/* ======================= 操作 ======================= */
function asBay(sel){
  if (!sel) return sel;
  if (sel.kind === 'wall'){ const w = wallById(sel.id); if (w?.bayId) return {kind:'bay', id:w.bayId}; }
  if (sel.kind === 'open'){ const o = state.openings.find(x => x.id === sel.id); if (o?.bayId) return {kind:'bay', id:o.bayId}; }
  if (sel.kind === 'room' && editing){
    const r = ROOMS.find(x => x.id === sel.id);
    if (r?.counted === false && r.at){ const b = bayAt(r.at[0], r.at[1]); if (b) return {kind:'bay', id:b.id}; }
  }
  return sel;
}
function select(sel){
  ui.sel = asBay(sel);
  if (editing && ui.sel?.kind === 'furn') ui.sel = null;
  renderSel(); renderPanel();
  if (typeof isPreview === 'function' && isPreview()) window.View3D?.sync();
}
function rotateSel(d){ if (ui.sel?.kind==='furn') mutate(() => { const f = getF(ui.sel.id); f.rot = norm(f.rot + d); }); }
function deleteSel(){
  if (ui.sel?.kind === 'furn'){ const id = ui.sel.id; ui.sel = null; mutate(() => state.furniture = state.furniture.filter(f => f.id !== id)); }
  else if (ui.sel?.kind === 'wall'){ const id = ui.sel.id; ui.sel = null; mutate(() => { removeWallData(id); touchShell(); }); }
  else if (ui.sel?.kind === 'open'){ const id = ui.sel.id; ui.sel = null; mutate(() => { removeOpeningData(id); touchShell(); }); }
  else if (ui.sel?.kind === 'bay'){ const id = ui.sel.id; ui.sel = null; mutate(() => { state.bays = (state.bays || []).filter(b => b.id !== id); touchShell(); }); }
}
function duplicateSel(){
  if (ui.sel?.kind !== 'furn') return;
  const f = getF(ui.sel.id), n = {...f, id:uid(), cx:f.cx+200, cy:f.cy+200};
  markFurnitureRoom(n);
  ui.sel = {kind:'furn', id:n.id}; mutate(() => state.furniture.push(n));
}
// 新放下的家具若压在墙 / 窗上，沿穿透较浅的方向推出来，刚好贴墙
function pushOut(f){
  for (let n = 0; n < 4; n++){
    let moved = false;
    for (const r of snapRects()){
      const {hw, hh} = aabb(f), ox = Math.min(f.cx+hw, r[2]) - Math.max(f.cx-hw, r[0]), oy = Math.min(f.cy+hh, r[3]) - Math.max(f.cy-hh, r[1]);
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) f.cx = f.cx < (r[0]+r[2])/2 ? r[0]-hw : r[2]+hw;
      else f.cy = f.cy < (r[1]+r[3])/2 ? r[1]-hh : r[3]+hh;
      moved = true;
    }
    if (!moved) return;
  }
}
function addItem(it, x, y){
  const [type,name,w,d,color] = it, f = F(type,name,Math.round(x/10)*10,Math.round(y/10)*10,w,d,0,color);
  if (Array.isArray(it[5]) && it[5].length) f.parts = it[5];
  pushOut(f);
  markFurnitureRoom(f);
  ui.sel = {kind:'furn', id:f.id};
  mutate(() => type==='rug' ? state.furniture.unshift(f) : state.furniture.push(f));
  toast(tr(`已添加「${name}」${w}×${d}`, `Added "${nm(name)}" ${w}×${d}`));
}
function toggleWall(id){
  const w = WALLS.find(w => w.id === id);
  if (!w) return;
  if (w.type === 'b') return toast(tr('承重墙（黑色）不可拆除', 'Load-bearing walls (black) cannot be removed'));
  if (w.type === 'e') return toast(tr('外墙属于建筑外围护结构，不建议拆除', 'Exterior walls are part of the building envelope and should not be removed'));
  const on = state.demolished.includes(id);
  mutate(() => state.demolished = on ? state.demolished.filter(x => x !== id) : [...state.demolished, id]);
  toast(on ? tr('已恢复墙体', 'Wall restored') : tr(`已标记拆除 ${Math.round(wallLen(w))} mm 墙体`, `Marked ${Math.round(wallLen(w))} mm of wall for removal`));
}

function setTool(t){
  if (t === 'demolish') t = 'select';
  ui.tool = t; ui.mA = null; ui.mCur = null;
  svg.setAttribute('class', 'tool-' + t);
  document.querySelectorAll('#drawLib [data-tool], #roomTools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  syncModeHint();
  renderMeasure();
}
function syncModeHint(){
  const hints = {select:'',
    measure:COARSE ? tr('按住拖出测量线，或依次点两点 · 靠近墙面自动吸附 · 点「选择」退出', 'Hold and drag a line, or tap two points · snaps to walls · tap "Select" to exit')
      : tr('点击两点（或按住拖动）测量距离 · 靠近墙面自动吸附 · Shift 锁定水平/垂直 · Esc 取消', 'Click two points (or drag) to measure · snaps to walls · Shift locks horizontal/vertical · Esc cancels'),
    demolish:tr('点击灰色非承重墙标记拆除，再次点击恢复 · 黑色承重墙不可拆', 'Click a grey non-bearing wall to remove it, click again to restore · black bearing walls cannot be removed'),
    wall:tr('拖出墙段。默认水平或垂直，按住 Shift 画斜墙，端点会吸到已有墙端', 'Drag a wall. Horizontal or vertical by default; hold Shift for a sloped wall. Ends snap to existing corners'),
    win:tr('点在墙上开窗', 'Click a wall to place a window'),
    door:tr('点在墙上开门，可在右侧改开启方向和入户', 'Click a wall to place a door. Swing and entry are in the side panel'),
    slide:tr('点在墙上放推拉门', 'Click a wall to place a sliding door'),
    bay:tr('点在外墙或承重墙上加飘窗', 'Click an exterior or bearing wall to add a bay window')};
  const h = $('#modehint'); h.textContent = hints[ui.tool]; h.classList.toggle('show', !!hints[ui.tool]);
}

/* ======================= 视图 ======================= */
function applyView(){
  const W = svg.clientWidth, H = svg.clientHeight;
  svg.setAttribute('viewBox', `${view.x0} ${view.y0} ${W/view.s} ${H/view.s}`);
  const ratio = 1/(view.s*PX_MM);
  $('#ratio').textContent = '1:' + Math.round(ratio);
  const nice = [100,200,500,1000,2000,5000].find(v => v*view.s >= 60) || 5000;
  $('#sbBar').style.width = nice*view.s + 'px';
  $('#sbText').textContent = nice >= 1000 ? `${nice/1000} m` : `${nice} mm`;
  renderSel(); renderMeasure();
}
function fitView(){
  const W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H) return;
  view.s = Math.min(W/BOUNDS.w, H/BOUNDS.h);
  view.x0 = BOUNDS.x - (W/view.s - BOUNDS.w)/2; view.y0 = BOUNDS.y - (H/view.s - BOUNDS.h)/2;
  applyView();
}
function zoomAt(ns, mx, my){
  ns = Math.max(.012, Math.min(2, ns));
  const px = view.x0 + mx/view.s, py = view.y0 + my/view.s;
  view.s = ns; view.x0 = px - mx/ns; view.y0 = py - my/ns; applyView();
}
const zoomCenter = k => zoomAt(view.s*k, svg.clientWidth/2, svg.clientHeight/2);
const setRatio = r => zoomAt(1/(r*PX_MM), svg.clientWidth/2, svg.clientHeight/2);

function toMM(e){
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

/* ======================= 吸附 ======================= */
const grid = () => 10;
function snapMove(f, cx, cy){
  let nx = Math.round(cx/grid())*grid(), ny = Math.round(cy/grid())*grid();
  if (!ui.layers.wallSnap) return [nx, ny];
  const {hw, hh} = aabb(f), tol = 10/view.s;
  let bx = tol, by = tol;
  for (const r of snapRects()){
    if (!(r[3] < cy-hh-tol || r[1] > cy+hh+tol)) for (const ex of [r[0], r[2]]) for (const c of [ex+hw, ex-hw]) if (Math.abs(c-cx) < bx){ bx = Math.abs(c-cx); nx = c; }
    if (!(r[2] < cx-hw-tol || r[0] > cx+hw+tol)) for (const ey of [r[1], r[3]]) for (const c of [ey+hh, ey-hh]) if (Math.abs(c-cy) < by){ by = Math.abs(c-cy); ny = c; }
  }
  return [nx, ny];
}
function snapPoint(p, shift){
  let x = Math.round(p.x/10)*10, y = Math.round(p.y/10)*10;
  const tol = 8/view.s; let bx = tol, by = tol;
  for (const r of snapRects()){
    for (const ex of [r[0], r[2]]) if (Math.abs(ex-p.x) < bx){ bx = Math.abs(ex-p.x); x = ex; }
    for (const ey of [r[1], r[3]]) if (Math.abs(ey-p.y) < by){ by = Math.abs(ey-p.y); y = ey; }
  }
  if (shift && ui.mA){ if (Math.abs(x-ui.mA.x) > Math.abs(y-ui.mA.y)) y = ui.mA.y; else x = ui.mA.x; }
  return {x, y};
}

/* ======================= 指针交互 ======================= */
let drag = null, pinch = null;
const touches = new Map();                     // 当前按在平面图上的手指
const svgXY = (x, y) => { const r = svg.getBoundingClientRect(); return [x - r.left, y - r.top]; };
function pinchInfo(){
  const [a, b] = [...touches.values()];
  return {d:Math.max(1, Math.hypot(b.x-a.x, b.y-a.y)), c:svgXY((a.x+b.x)/2, (a.y+b.y)/2)};
}
// 结束当前拖动：移动过的家具记入撤销栈
function endDrag(cancel){
  const d = drag; drag = null; svg.classList.remove('panning');
  if (!d) return;
  if (d.kind === 'measure'){
    if (cancel){ ui.mA = ui.mCur = null; renderMeasure(); return; }
    if (d.moved && ui.mA && ui.mCur && Math.hypot(ui.mCur.x-ui.mA.x, ui.mCur.y-ui.mA.y) > 20){
      const a = ui.mA, b = ui.mCur; ui.mA = ui.mCur = null; mutate(() => state.measures.push({a, b}));
    }
    renderMeasure(); return;                   // 没拖动：保留起点，等第二次点击
  }
  if (d.kind === 'pan'){
    if (!cancel && !d.moved && ui.tool === 'select') select(d.room ? {kind:'room', id:d.room} : null);
    return;
  }
  if (d.kind === 'wall'){
    const a = d.a, b = ui.wallB;
    ui.wallA = ui.wallB = null;
    if (!cancel && b && Math.hypot(b.x - a.x, b.y - a.y) >= 80){
      mutate(() => {
        state.walls.push({id:wid(), a:[Math.round(a.x), Math.round(a.y)], b:[Math.round(b.x), Math.round(b.y)], thick:240, type:'n'});
        touchShell();
      });
    } else renderSel();
    return;
  }
  if (d.kind === 'wend' || d.kind === 'oend' || d.kind === 'bend' || d.kind === 'bdepth'){
    if (cancel || !d.moved){ adopt(JSON.parse(d.before)); renderAll(); return; }
    touchShell(); commit(d.before); renderAll(); return;
  }
  if (d.moved){
    if (d.id){ const f = getF(d.id); if (f) markFurnitureRoom(f); }
    commit(d.before); renderAll();
  }
}

svg.addEventListener('pointerdown', e => {
  if (e.button === 1 || e.button === 2) return;
  closeDrawers(); $('details.menu').open = false;
  if (e.pointerType !== 'mouse'){
    touches.set(e.pointerId, {x:e.clientX, y:e.clientY});
    svg.setPointerCapture(e.pointerId);
    if (touches.size >= 2){                    // 第二根手指落下：取消单指操作，进入双指缩放 / 平移
      endDrag(drag && ['measure', 'pan', 'wall', 'wend', 'oend', 'bend', 'bdepth'].includes(drag.kind));
      const {d, c} = pinchInfo();
      pinch = {d, c, s:view.s, px:view.x0 + c[0]/view.s, py:view.y0 + c[1]/view.s};
      return;
    }
  }
  if (pinch) return;
  const p = toMM(e), t = e.target;
  if (ui.tool === 'measure'){
    const q = snapPoint(p, e.shiftKey);
    if (!ui.mA){ ui.mA = q; ui.mCur = q; drag = {kind:'measure', sx:e.clientX, sy:e.clientY, moved:false}; svg.setPointerCapture(e.pointerId); }
    else { const a = ui.mA; ui.mA = null; ui.mCur = null; if (Math.hypot(q.x-a.x, q.y-a.y) > 20) mutate(() => state.measures.push({a, b:q})); }
    renderMeasure(); return;
  }
  const h = t.closest('[data-handle]');
  if (ui.tool === 'wall'){
    const q = snapWallPoint(p, e.shiftKey, null);
    ui.wallA = q; ui.wallB = q;
    drag = {kind:'wall', a:q, sx:e.clientX, sy:e.clientY, moved:false};
  } else if (ui.tool === 'win' || ui.tool === 'door' || ui.tool === 'slide' || ui.tool === 'bay'){
    placeOpening(ui.tool, p.x, p.y); return;
  } else if (h && ui.sel?.kind === 'furn'){
    drag = {kind:h.dataset.handle, id:ui.sel.id, sx:e.clientX, sy:e.clientY, before:snap(), moved:false};
  } else if (h && h.dataset.handle === 'wend' && ui.sel?.kind === 'wall'){
    drag = {kind:'wend', id:ui.sel.id, end:h.dataset.end, sx:e.clientX, sy:e.clientY, before:snap(), moved:false};
  } else if (h && editing && (h.dataset.handle === 'oend' || h.dataset.handle === 'bend' || h.dataset.handle === 'bdepth')){
    drag = {kind:h.dataset.handle, id:ui.sel.id, end:h.dataset.end, sx:e.clientX, sy:e.clientY, before:snap(), moved:false};
  } else if (ui.tool === 'demolish' && t.closest('[data-wall]')){
    toggleWall(t.closest('[data-wall]').dataset.wall); return;
  } else if (editing && ui.tool === 'select' && t.closest('[data-open]')){
    select({kind:'open', id:t.closest('[data-open]').dataset.open}); return;
  } else if (editing && ui.tool === 'select' && t.closest('[data-wall]')){
    select({kind:'wall', id:t.closest('[data-wall]').dataset.wall}); return;
  } else if (ui.tool === 'select' && t.closest('[data-fid]')){
    const f = getF(t.closest('[data-fid]').dataset.fid);
    if (ui.sel?.id !== f.id) select({kind:'furn', id:f.id});
    drag = {kind:'move', id:f.id, sx:e.clientX, sy:e.clientY, ox:p.x-f.cx, oy:p.y-f.cy, before:snap(), moved:false};
  } else {
    const room = t.closest('[data-room]');
    drag = {kind:'pan', sx:e.clientX, sy:e.clientY, x0:view.x0, y0:view.y0, room:room && room.dataset.room, moved:false};
  }
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (pinch){
    if (touches.size < 2) return;
    const {d, c} = pinchInfo(), ns = Math.max(.012, Math.min(2, pinch.s * d / pinch.d));
    view.s = ns; view.x0 = pinch.px - c[0]/ns; view.y0 = pinch.py - c[1]/ns; applyView();
    return;
  }
  const p = toMM(e);
  $('#cx').textContent = Math.round(p.x) + ' mm'; $('#cy').textContent = Math.round(p.y) + ' mm';
  if (!drag){
    const room = e.target.closest && e.target.closest('[data-room]');
    $('#hover').innerHTML = room ? `<b>${esc(state.rooms[room.dataset.room].name)}</b> ${fmt(area(ROOMS.find(r=>r.id===room.dataset.room).poly))} m²` : '';
    if (ui.tool === 'measure' && ui.mA){ ui.mCur = snapPoint(p, e.shiftKey); renderMeasure(); }
    return;
  }
  const far = Math.hypot(e.clientX-drag.sx, e.clientY-drag.sy) >= TAP;
  if (drag.kind === 'measure'){
    if (far) drag.moved = true;
    ui.mCur = snapPoint(p, e.shiftKey); renderMeasure(); return;
  }
  if (drag.kind === 'pan'){
    if (!drag.moved && !far) return;
    drag.moved = true; svg.classList.add('panning');
    view.x0 = drag.x0 - (e.clientX-drag.sx)/view.s; view.y0 = drag.y0 - (e.clientY-drag.sy)/view.s; applyView(); return;
  }
  if (drag.kind === 'wall'){
    drag.moved = true;
    ui.wallB = snapWallPoint(p, e.shiftKey, drag.a);
    renderSel(); return;
  }
  if (drag.kind === 'wend'){
    if (!drag.moved && !far) return;
    drag.moved = true;
    const w = wallById(drag.id); if (!w) return;
    const other = drag.end === 'a' ? {x:w.b[0], y:w.b[1]} : {x:w.a[0], y:w.a[1]};
    const q = snapWallPoint(p, e.shiftKey, other, w.id);
    w[drag.end][0] = q.x; w[drag.end][1] = q.y;
    renderWalls(); renderOpenings(); renderSel(); return;
  }
  if (drag.kind === 'oend' || drag.kind === 'bend' || drag.kind === 'bdepth'){
    if (!drag.moved && !far) return;
    drag.moved = true;
    if (drag.kind === 'oend'){ const o = state.openings.find(o => o.id === drag.id); if (o) moveOpenEnd(o, drag.end, p); }
    else { const b = bayById(drag.id); if (b) drag.kind === 'bdepth' ? moveBayDepth(b, p) : moveBayEnd(b, drag.end, p); }
    return;
  }
  const f = getF(drag.id); if (!f) return;
  if (!drag.moved && !far) return;             // 轻点家具不应让它抖动一下
  drag.moved = true;
  if (drag.kind === 'move'){
    [f.cx, f.cy] = snapMove(f, p.x-drag.ox, p.y-drag.oy);
  } else if (drag.kind === 'rot'){
    let a = Math.atan2(p.y-f.cy, p.x-f.cx)*180/Math.PI + 90;
    f.rot = norm(e.shiftKey ? a : Math.round(a/15)*15);
  } else if (drag.kind === 'size'){
    const a = f.rot*Math.PI/180, c = Math.cos(a), s = Math.sin(a);
    const dx = p.x-f.cx, dy = p.y-f.cy, lx = dx*c + dy*s, ly = -dx*s + dy*c;
    const ax = -f.w/2, ay = -f.d/2;
    const nw = Math.max(100, Math.round((lx-ax)/10)*10), nd = Math.max(100, Math.round((ly-ay)/10)*10);
    const mx = ax + nw/2, my = ay + nd/2;
    f.cx += mx*c - my*s; f.cy += mx*s + my*c; f.w = nw; f.d = nd;
  }
  renderFurn(); renderSel();
});

function onPointerEnd(e){
  touches.delete(e.pointerId);
  if (pinch){ if (touches.size < 2) pinch = null; return; }   // 双指结束后，剩下的手指不再触发操作
  if (drag?.kind === 'wall' && e.type !== 'pointercancel'){
    const p = toMM(e);
    ui.wallB = snapWallPoint(p, e.shiftKey, drag.a);
    drag.moved = true;
  }
  endDrag(e.type === 'pointercancel');
}
svg.addEventListener('pointerup', onPointerEnd);
svg.addEventListener('pointercancel', onPointerEnd);
// 阻止 iPad Safari 把双指手势当成整页缩放
['gesturestart','gesturechange','gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault()));

svg.addEventListener('wheel', e => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomAt(view.s*Math.exp(-e.deltaY*(e.ctrlKey ? .01 : .0015)), e.clientX-r.left, e.clientY-r.top);
}, {passive:false});
svg.addEventListener('dblclick', e => { if (ui.tool==='select' && e.target.closest('[data-fid]')) rotateSel(90); });
svg.addEventListener('contextmenu', e => { if (ui.tool==='measure'){ e.preventDefault(); ui.mA = null; renderMeasure(); } });


/* ======================= 键盘 ======================= */
document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  if (e.key === 'Escape' && (!$('#nameDlg').hidden || !$('#planModal').hidden || !$('#roomPick').hidden || !$('#importDlg').hidden || !$('#furnAiDlg').hidden)){
    $('#nameDlg').hidden = true; hidePlans(); $('#roomPick').hidden = true; $('#importDlg').hidden = true; $('#furnAiDlg').hidden = true; return;
  }
  if (!$('#nameDlg').hidden || !$('#planModal').hidden || !$('#roomPick').hidden || !$('#importDlg').hidden || !$('#furnAiDlg').hidden) return;
  if (window.View3D?.walking()) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'z'){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y'){ e.preventDefault(); redo(); return; }
  if (mod && k === 'd'){ e.preventDefault(); if (!(typeof isPreview === 'function' && isPreview())) duplicateSel(); return; }
  if (mod) return;
  if (k === '[' || k === ']'){ drawer(k === '[' ? 'lib' : 'panel'); return; }
  if (k === 'f' && e.shiftKey){ toggleFullscreen(); return; }
  if (k === 't'){ if (tab === 'decor') setView(is3D() ? '2d' : '3d'); return; }
  else if ((is3D() || (typeof isPreview === 'function' && isPreview())) && ['v','m','f','+','=','-'].includes(k)) return;
  else if (k === 'v') setTool('select');
  else if (k === 'm') setTool('measure');
  else if (k === 'f') fitView();
  else if (k === 'r'){
    if (typeof isPreview === 'function' && isPreview()){ if (studioFurn){ studioFurn.rot = norm(studioFurn.rot + (e.shiftKey ? -90 : 90)); renderPanel(); window.View3D?.sync(); } }
    else rotateSel(e.shiftKey ? -90 : 90);
  }
  else if (k === 'delete' || k === 'backspace'){
    e.preventDefault();
    if (typeof isPreview === 'function' && isPreview()){ if (studioFurn){ studioFurn = null; renderPanel(); window.View3D?.sync(); } }
    else deleteSel();
  }
  else if (k === 'escape'){
    if (ui.wallA){ ui.wallA = ui.wallB = null; if (drag?.kind === 'wall') drag = null; renderSel(); }
    else if (ui.mA){ ui.mA = null; renderMeasure(); }
    else { if (ui.tool !== 'select') setTool('select'); select(null); }
  }
  else if (k.startsWith('arrow') && ui.sel?.kind === 'furn' && !(typeof isPreview === 'function' && isPreview())){
    e.preventDefault(); const st = e.shiftKey ? 100 : 10;
    mutate(() => { const f = getF(ui.sel.id); if (k==='arrowleft') f.cx -= st; if (k==='arrowright') f.cx += st; if (k==='arrowup') f.cy -= st; if (k==='arrowdown') f.cy += st; markFurnitureRoom(f); });
  }
  else if (k === '+' || k === '=') zoomCenter(1.25);
  else if (k === '-') zoomCenter(.8);
});

/* ======================= 家具库 ======================= */
let libQuery = '';
const libClosed = new Set();
function libItemText(it, cat){
  const name = it[1];
  return [name, nm(name), NAMES_EN[name] || '', cat, nm(cat), `${it[2]}×${it[3]}`, `${it[2]}x${it[3]}`].join(' ').toLowerCase();
}
function syncLibBar(){
  const input = $('#libSearch'), btn = $('#libFold');
  if (input){
    input.placeholder = tr('搜索家具', 'Search furniture');
    input.setAttribute('aria-label', input.placeholder);
  }
  if (!btn) return;
  const cats = [...document.querySelectorAll('#lib .lib-cat')].filter(s => !s.hidden);
  const allClosed = cats.length > 0 && cats.every(s => libClosed.has(+s.dataset.cat));
  const zh = allClosed ? '全部展开' : '全部折叠';
  const en = allClosed ? 'Expand all' : 'Collapse all';
  btn.textContent = tr(zh, en);
  btn.title = tr(allClosed ? '展开全部分组' : '折叠全部分组', allClosed ? 'Expand every group' : 'Collapse every group');
  btn.setAttribute('aria-pressed', allClosed ? 'true' : 'false');
}
function applyLibFilter(){
  const q = libQuery.trim().toLowerCase();
  let n = 0;
  document.querySelectorAll('#lib .lib-cat').forEach(sec => {
    const ci = +sec.dataset.cat;
    let shown = 0;
    sec.querySelectorAll('.item').forEach(el => {
      const ok = !q || libItemText(itemOf(el), LIB[ci].cat).includes(q);
      el.hidden = !ok;
      if (ok) shown++;
    });
    sec.hidden = shown === 0;
    sec.classList.toggle('closed', libClosed.has(ci));
    const head = sec.querySelector('.lib-cat-h');
    if (head) head.setAttribute('aria-expanded', libClosed.has(ci) ? 'false' : 'true');
    n += shown;
  });
  const empty = $('#lib .lib-empty');
  if (empty) empty.hidden = n > 0;
  syncLibBar();
}
function buildLib(){
  $('#lib').innerHTML = LIB.map((c,ci) => {
    if (c.cat === '自定义' && !c.items.length) return '';
    const custom = c.cat === '自定义';
    const items = c.items.map((it,ii) => {
      const [t,n,w,d,col] = it, pad = Math.max(w,d)*.08;
      const placeTitle = tr('点击添加，或拖到平面图中的指定位置', 'Click to add, or drag onto the plan');
      const previewTitle = tr('在预览中查看，不会放进户型', 'View in preview. It is not added to the plan');
      const del = custom ? `<button type="button" class="item-del" aria-label="${esc(tr('删除', 'Delete'))}" title="${esc(tr('从自定义删除', 'Remove from Custom'))}">×</button>` : '';
      return `<div class="item" data-key="${ci}:${ii}" title="${(typeof isPreview === 'function' && isPreview()) ? previewTitle : placeTitle}">
        ${del}<svg viewBox="${-w/2-pad} ${-d/2-pad} ${w+2*pad} ${d+2*pad}">${furnSVG(t,w,d,col,it[5])}</svg><b>${esc(nm(n))}</b><small>${w}×${d}</small></div>`;
    }).join('');
    return `<section class="lib-cat${libClosed.has(ci) ? ' closed' : ''}" data-cat="${ci}">
      <button type="button" class="lib-cat-h" aria-expanded="${libClosed.has(ci) ? 'false' : 'true'}"><span>${esc(nm(c.cat))}</span><i></i></button>
      <div class="lib-grid">${items}</div></section>`;
  }).join('') + `<p class="lib-empty" hidden>${esc(tr('没有匹配的家具', 'No matching furniture'))}</p><div class="hint"><span class="hint-plan">${tr(
    `家具按真实尺寸（mm）绘制。${COARSE ? '点一下放到画面中央，或按住向右拖到平面图 / 3D 地面上的指定位置（上下滑动为滚动列表）。' : '点击添加到画面中央，或直接拖到平面图 / 3D 地面上。'}添加后可在右侧修改宽深与颜色。`,
    `Furniture is drawn at real size (mm). ${COARSE ? 'Tap to place at the center, or hold and drag right onto the plan / 3D floor (swipe up/down to scroll).' : 'Click to add at the center, or drag onto the plan / 3D floor.'} Edit size and color in the right panel afterwards.`)}</span><span class="hint-preview">${tr('点一件在中间查看，不会放进户型。', 'Click a piece to view it here. It is not added to the plan.')}</span></div>`;
  document.querySelectorAll('#lib .item').forEach(el => el.addEventListener('pointerdown', e => {
    if (e.button || e.target.closest('.item-del')) return;
    libDrag = {el, id:e.pointerId, sx:e.clientX, sy:e.clientY, it:itemOf(el), ghost:null};
  }));
  document.querySelectorAll('#lib .item-del').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    e.preventDefault();
    deleteCustomFurn(itemOf(btn.closest('.item')));
  });
  document.querySelectorAll('#lib .lib-cat-h').forEach(btn => btn.onclick = () => {
    const ci = +btn.closest('.lib-cat').dataset.cat;
    if (libClosed.has(ci)) libClosed.delete(ci); else libClosed.add(ci);
    applyLibFilter();
  });
  applyLibFilter();
}
function toggleLibCats(){
  const cats = [...document.querySelectorAll('#lib .lib-cat')].filter(s => !s.hidden);
  const allClosed = cats.length > 0 && cats.every(s => libClosed.has(+s.dataset.cat));
  cats.forEach(s => allClosed ? libClosed.delete(+s.dataset.cat) : libClosed.add(+s.dataset.cat));
  applyLibFilter();
}
$('#libSearch').addEventListener('input', () => {
  const next = $('#libSearch').value;
  if (!libQuery.trim() && next.trim()) libClosed.clear();
  libQuery = next;
  applyLibFilter();
});
$('#libSearch').addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !libQuery) return;
  $('#libSearch').value = '';
  libQuery = '';
  applyLibFilter();
});
$('#libFold').onclick = toggleLibCats;
const itemOf = el => { const [ci, ii] = el.dataset.key.split(':').map(Number); return LIB[ci].items[ii]; };

const DRAW_TOOLS = [
  ['wall', '墙', 'Wall', '拖出墙段', 'Drag a wall', `<rect x="8" y="30" width="84" height="14" fill="#8f897d"/><circle cx="8" cy="37" r="3.5" fill="#b5653a"/><circle cx="92" cy="37" r="3.5" fill="#b5653a"/>`],
  ['win', '窗', 'Window', '点在墙上', 'Click a wall', `<rect x="6" y="28" width="18" height="16" fill="#8f897d"/><rect x="76" y="28" width="18" height="16" fill="#8f897d"/><rect x="24" y="28" width="52" height="16" fill="#f7fbfd" stroke="#4f7394" stroke-width="1.4"/><line x1="24" y1="33.3" x2="76" y2="33.3" stroke="#4f7394" stroke-width="1.1"/><line x1="24" y1="38.6" x2="76" y2="38.6" stroke="#4f7394" stroke-width="1.1"/>`],
  ['door', '门', 'Door', '点在墙上', 'Click a wall', `<rect x="6" y="42" width="16" height="12" fill="#8f897d"/><rect x="78" y="42" width="16" height="12" fill="#8f897d"/><rect x="22" y="44" width="56" height="8" fill="#e2dacb"/><path d="M22 44 V14" fill="none" stroke="#3d3a34" stroke-width="2"/><path d="M22 14 A 30 30 0 0 1 52 44" fill="none" stroke="#3d3a34" stroke-width="1.2" stroke-dasharray="3 2"/>`],
  ['slide', '推拉门', 'Sliding door', '点在墙上', 'Click a wall', `<rect x="8" y="30" width="84" height="16" fill="#e2dacb"/><rect x="12" y="22" width="44" height="9" fill="#fff" stroke="#3d3a34" stroke-width="1.2"/><rect x="44" y="45" width="44" height="9" fill="#fff" stroke="#3d3a34" stroke-width="1.2"/>`],
  ['bay', '飘窗', 'Bay window', '点在外墙', 'Click an exterior wall', `<rect x="8" y="46" width="84" height="12" fill="#8f897d"/><polygon points="30,46 30,20 70,20 70,46" fill="#efe6d8" stroke="#8f897d" stroke-width="1.2"/><rect x="34" y="20" width="32" height="8" fill="#f7fbfd" stroke="#4f7394" stroke-width="1.1"/>`],
];
function buildDrawLib(){
  $('#drawLib').innerHTML = `<h4>${tr('绘制', 'Draw')}</h4><div class="lib-grid">${DRAW_TOOLS.map(([tool, zh, en, hint, hintEn, svg]) =>
    `<div class="item${ui.tool === tool ? ' on' : ''}" data-tool="${tool}" title="${tr(hint, hintEn)}" role="button">
      <svg viewBox="0 0 100 72">${svg}</svg><b>${tr(zh, en)}</b><small>${tr(hint, hintEn)}</small></div>`).join('')}</div>
    <div class="hint">${tr('点一项再在平面图上画。墙可以拖出；窗、门、推拉门和飘窗点在墙上。', 'Pick a tool, then draw on the plan. Drag to make a wall; click a wall for windows, doors, sliders and bays.')}</div>`;
  $('#drawLib').querySelectorAll('[data-tool]').forEach(el => el.onclick = () => setTool(el.dataset.tool));
}

// 家具库拖放：用 pointer 事件实现（iPad 上 HTML5 拖放不可靠）。
// 列表设置了 touch-action:pan-y，竖向滑动交给浏览器滚动（会触发 pointercancel），横向拖动才开始拖放。
let libDrag = null;
// 屏幕坐标 → 户型坐标（mm）。2D 取平面图坐标，3D 取射线与地面的交点；s = 该处每 mm 的屏幕像素数
function dropPoint(x, y){
  const r = $('#stage').getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  if (document.elementFromPoint(x, y)?.closest('aside.open,#fab,#walkOverlay,#joy,#walkExit')) return null;
  if (is3D()) return window.View3D?.groundAt(x, y) || null;
  const p = toMM({clientX:x, clientY:y}); return {x:p.x, y:p.y, s:view.s};
}
addEventListener('pointermove', e => {
  if (!libDrag || e.pointerId !== libDrag.id) return;
  const {it} = libDrag;
  if (!libDrag.ghost){
    if (Math.hypot(e.clientX-libDrag.sx, e.clientY-libDrag.sy) < TAP) return;
    const g = libDrag.ghost = document.createElement('div'); g.id = 'ghost';
    g.innerHTML = `<svg viewBox="${-it[2]/2} ${-it[3]/2} ${it[2]} ${it[3]}">${furnSVG(it[0],it[2],it[3],it[4],it[5])}</svg>`;
    document.body.appendChild(g); libDrag.el.classList.add('dragging');
  }
  // 幽灵图按落点处的比例显示真实大小（3D 中近大远小）
  const g = libDrag.ghost, s = Math.max(dropPoint(e.clientX, e.clientY)?.s || (is3D() ? .05 : view.s), .02);
  Object.assign(g.style, {width:Math.max(28, it[2]*s)+'px', height:Math.max(20, it[3]*s)+'px', left:e.clientX+'px', top:e.clientY+'px'});
  const lib = $('aside.lib');
  if (narrow() && lib.classList.contains('open') && e.clientX > lib.getBoundingClientRect().right) drawer(null);   // 拖出抽屉后自动收起
});
function previewCatalog(it){
  const [type, name, w, d, color] = it;
  studioFurn = {id:`studio:${type}:${w}x${d}`, type, name, w, d, rot:0, color, cx:0, cy:0};
  if (Array.isArray(it[5]) && it[5].length) studioFurn.parts = it[5];
  renderPanel();
  window.View3D?.sync();
}
function endLibDrag(e, ok){
  if (!libDrag || e.pointerId !== libDrag.id) return;
  const d = libDrag; libDrag = null;
  d.el.classList.remove('dragging');
  if (typeof isPreview === 'function' && isPreview()){
    if (d.ghost) d.ghost.remove();
    if (!ok) return;
    previewCatalog(d.it);
    if (!d.ghost) closeDrawers();
    return;
  }
  if (d.ghost){
    d.ghost.remove();
    if (!ok) return;
    const p = dropPoint(e.clientX, e.clientY);
    if (p) addItem(d.it, p.x, p.y);
    else if (is3D() && e.clientX > $('#stage').getBoundingClientRect().left) toast(tr('请拖到地面上', 'Drop it on the floor'));
    return;
  }
  if (!ok) return;
  // 轻点：放到选中房间中心，否则放到画面中心（3D 取屏幕中心对应的地面位置）
  let p = null;
  if (ui.sel?.kind === 'room'){ const b = bbox(ROOMS.find(r => r.id===ui.sel.id).poly); p = {x:(b[0]+b[2])/2, y:(b[1]+b[3])/2}; }
  else if (is3D()){ const r = $('#stage').getBoundingClientRect(); p = window.View3D.groundAt(r.left + r.width/2, r.top + r.height/2); }
  if (!p) p = {x:view.x0 + svg.clientWidth/2/view.s, y:view.y0 + svg.clientHeight/2/view.s};
  addItem(d.it, p.x, p.y);
  closeDrawers();
}
addEventListener('pointerup', e => endLibDrag(e, true));
addEventListener('pointercancel', e => endLibDrag(e, false));

/* ======================= 导入导出 ======================= */
function download(name, blob){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportPNG(){
  if (is3D()) return window.View3D.shot();
  const clone = svg.cloneNode(true), W = 3200, H = Math.round(W*BOUNDS.h/BOUNDS.w);
  clone.setAttribute('viewBox', `${BOUNDS.x} ${BOUNDS.y} ${BOUNDS.w} ${BOUNDS.h}`);
  clone.setAttribute('width', W); clone.setAttribute('height', H);
  clone.querySelector('#gSel').innerHTML = '';
  clone.querySelector('#gGrid').innerHTML = `<rect x="-20000" y="-20000" width="55000" height="55000" fill="${ui.layers.grid?'url(#grid)':'#f7f4ee'}"/>`;
  const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
  Object.entries({x:-20000,y:-20000,width:55000,height:55000,fill:'#f7f4ee'}).forEach(([k,v]) => bg.setAttribute(k,v));
  clone.insertBefore(bg, clone.querySelector('#gGrid'));
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').drawImage(img, 0, 0, W, H);
    cv.toBlob(b => download(tr('户型装修方案', 'floor-plan-design') + '.png', b));
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
}

/* ======================= 杂项 ======================= */
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

/* ======================= 2D / 3D 切换 ======================= */
let viewMode = '2d', switching = false, tab = 'decor', decorInside = false;
const is3D = () => viewMode === '3d';
const isPreview = () => viewMode === 'preview';
function syncTip(){
  if (document.body.classList.contains('editing')){
    $('#tip').textContent = COARSE
      ? tr('点左侧工具再在图上画 · 单指拖动平移 · 双指缩放 · V 选择', 'Pick a tool on the left, then draw · 1 finger pans · pinch zooms · V selects')
      : tr('拖出墙段 · 点墙放门窗 · 滚轮缩放 · 拖动空白处平移 · V 选择', 'Drag a wall · click a wall for openings · scroll to zoom · drag empty space to pan · V selects');
    return;
  }
  $('#tip').textContent = TIPS()[viewMode] || TIPS()['2d'];
}
const TIPS = () => COARSE
  ? {'2d':tr('点或拖动家具库添加 · 单指拖动平移 · 双指缩放 · 选中家具后底部工具条可旋转 / 复制 / 删除', 'Tap or drag from the library · 1 finger pans · pinch zooms · bottom bar rotates / duplicates / deletes'),
     '3d':tr('单指旋转 · 双指缩放 / 平移 · 点家具或地面编辑 · 点门开关', '1 finger orbits · 2 fingers zoom / pan · tap furniture or floor to edit · tap doors to open'),
     'preview':tr('拖动旋转查看这件家具 · 左侧点一件换上看', 'Drag to orbit this piece · pick another from the library')}
  : {'2d':tr('拖动左侧家具到平面图 · 滚轮缩放 · 拖动空白处平移 · T 切换 3D', 'Drag furniture onto the plan · scroll to zoom · drag empty space to pan · T for 3D'),
     '3d':tr('3D 场景与平面方案实时同步 · 右侧面板修改会立即生效 · T 返回 2D', '3D stays in sync with the plan · panel edits apply instantly · T for 2D'),
     'preview':tr('拖动旋转查看这件家具 · 左侧点一件换上看 · 右侧改尺寸和颜色', 'Drag to orbit this piece · pick another from the library · edit size and color on the right')};
async function setView(m){
  if (m === viewMode || switching) return;
  if (m === '3d' && tab !== 'decor') return;
  if (m === 'preview' && tab !== 'preview') return;
  if (m === 'preview' && blockIfDirty(() => setView(m))) return;
  if (!window.View3D) return toast(tr('3D 引擎仍在加载或加载失败（需要联网加载 three.js）', '3D engine is still loading or failed to load (three.js needs a network connection)'));
  switching = true; document.body.classList.add('busy');
  const from = viewMode;
  viewMode = m;
  document.body.classList.toggle('m3d', m === '3d');
  document.body.classList.toggle('fpreview', m === 'preview');
  $('#furnPreview').classList.toggle('on', m === 'preview');
  try {
    if (from === '3d') await window.View3D.exit();
    if (from === 'preview') window.View3D.exitStudio();
    if (m === '3d'){ if (ui.tool !== 'select') setTool('select'); ui.mA = null; await window.View3D.enter(); }
    else if (m === 'preview'){ if (ui.tool !== 'select') setTool('select'); ui.mA = null; window.View3D.enterStudio(); }
    else applyView();
    syncTip();
    document.querySelectorAll('#lib .item').forEach(el => el.title = m === 'preview'
      ? tr('在预览中查看，不会放进户型', 'View in preview. It is not added to the plan')
      : tr('点击添加，或拖到平面图中的指定位置', 'Click to add, or drag onto the plan'));
    renderPanel();
  } finally {
    switching = false; document.body.classList.remove('busy');
  }
}
document.querySelectorAll('.menu-pop .btn').forEach(b => b.addEventListener('click', () => b.closest('details').open = false));
document.querySelectorAll('#viewSeg .btn').forEach(b => b.onclick = () => setView(b.dataset.view));
$('#furnPreview').onclick = () => setView(viewMode === 'preview' ? '2d' : 'preview');

document.querySelectorAll('#roomTools [data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
document.querySelectorAll('#layers .btn').forEach(b => b.onclick = () => {
  const k = b.dataset.layer; ui.layers[k] = !ui.layers[k]; b.classList.toggle('on', ui.layers[k]);
  if (k === 'dims') $('#gDims').setAttribute('display', ui.layers.dims ? 'inline' : 'none');
  else if (k !== 'wallSnap') renderAll();
});
$('#zoomIn').onclick = () => zoomCenter(1.25);
$('#zoomOut').onclick = () => zoomCenter(.8);
$('#fit').onclick = fitView;
$('#s60').onclick = () => { setRatio(60); toast(tr('已按 1:60 显示（与原始户型图同比例）', 'Showing at 1:60 (same scale as the original plan)')); };
$('#s100').onclick = () => setRatio(100);
$('#undo').onclick = undo; $('#redo').onclick = redo;
$('#clearAll').onclick = clearLayout;

/* 全屏：标准 API + Safari（iPad）的 webkit 前缀版本 */
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function toggleFullscreen(){
  const de = document.documentElement;
  if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else {
    const req = de.requestFullscreen || de.webkitRequestFullscreen;
    if (!req) return toast(tr('当前浏览器不支持网页全屏，可在 Safari 中「添加到主屏幕」后以全屏方式打开', 'Fullscreen is not supported here — in Safari, use "Add to Home Screen" to open it fullscreen'));
    Promise.resolve(req.call(de)).catch(() => toast(tr('无法进入全屏', 'Could not enter fullscreen')));
  }
}
function syncFullscreen(){
  const on = !!fsEl(), b = $('#fullscreen');
  b.textContent = on ? tr('退出全屏', 'Exit fullscreen') : tr('全屏', 'Fullscreen');
  b.title = (on ? tr('退出全屏', 'Exit fullscreen') : tr('全屏', 'Fullscreen')) + ' (Shift+F)';
}
$('#fullscreen').onclick = toggleFullscreen;
['fullscreenchange', 'webkitfullscreenchange'].forEach(t => document.addEventListener(t, syncFullscreen));
// 已从主屏幕以独立 App 方式打开时本就是全屏，隐藏按钮
if (navigator.standalone || matchMedia('(display-mode: standalone)').matches) $('#fullscreen').hidden = true;
$('#tgLib').onclick = () => drawer('lib');
$('#tgPanel').onclick = () => drawer('panel');
// 触屏上点菜单以外的地方收起「文件」菜单
document.addEventListener('pointerdown', e => { const m = $('details.menu'); if (m.open && !m.contains(e.target)) m.open = false; });
matchMedia('(max-width:1100px)').addEventListener('change', () => drawer(null));
drawer(null);                                  // 恢复上次的面板收起状态
$('#exportPng').onclick = exportPNG;
$('#exportJson').onclick = () => {
  const payload = JSON.parse(JSON.stringify(state));
  const custom = customBundleFor(payload.furniture);
  if (custom.length) payload.customFurniture = custom;
  download(tr('户型装修方案', 'floor-plan-design') + '.json', new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}));
};
$('#importJson').onclick = () => $('#fileIn').click();
$('#exportFurn').onclick = () => exportCustomFurn();
$('#importFurn').onclick = () => $('#furnLibFile').click();
$('#exportAll').onclick = exportLibraryBundle;
$('#importAll').onclick = () => $('#libFile').click();
function parsePackText(text){
  const t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fence ? fence[1] : t);
}
function commitPack(raw){
  if (blockIfDirty()) return false;
  const {plan, furniture, warnings} = importHuxingPack(raw);
  library.plans.push(plan);
  let roomNote = tr('，没有家具，未生成房间', ', no furniture so no room was created');
  if (furniture.length){
    const room = roomFromPlan(plan);
    room.furniture = furniture.map(f => ({...f, id:uid()}));
    room.name = plan.name;
    library.rooms = library.rooms || [];
    library.rooms.push(room);
    roomNote = tr(`，并生成房间，${furniture.length} 件家具`, `, plus a room with ${furniture.length} pieces`);
  }
  try { localStorage.setItem(LIB_KEY, JSON.stringify({activeId:library.activeId, plans:library.plans, rooms:library.rooms || []})); } catch(e) {}
  if (document.body.classList.contains('gate')) renderGate();
  const skip = warnings.length ? tr(`，${warnings.length} 条没有用上`, `, ${warnings.length} skipped`) : '';
  toast(tr(`已导入户型「${plan.name}」`, `Imported "${plan.name}"`) + roomNote + skip);
  if (warnings.length) console.warn(warnings.join('\n'));
  return true;
}
$('#fileIn').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(txt => {
    try {
      const s = JSON.parse(txt);
      if (s && s.kind === 'huxing-library'){ importLibraryBundle(s); return; }
      if (s && (s.kind === 'furniture-library' || s.kind === 'furniture-drawing' || Array.isArray(s))){
        const furnItems = customPayloadItems(s);
        if (furnItems){ toastCustomImport(mergeCustomRows(furnItems)); return; }
      }
      if (blockIfDirty()) return;
      if (s && s.kind === 'huxing-pack'){ commitPack(s); return; }
      const listed = Array.isArray(s.customFurniture) ? s.customFurniture : [];
      delete s.customFurniture;
      const b = snap();
      if (Array.isArray(s.walls)){ const next = normalizePlan(s); next.id = state.id; adopt(next); }
      else if (Array.isArray(s.furniture)){
        state.furniture = s.furniture;
        if (Array.isArray(s.demolished)) state.demolished = s.demolished;
        if (Array.isArray(s.measures)) state.measures = s.measures;
        if (s.rooms && typeof s.rooms === 'object') Object.assign(state.rooms, s.rooms);
        applyPlan(state);
      } else throw 0;
      ui.sel = null; commit(b); renderAll();
      toast(tr('方案已导入', 'Plan imported') + absorbCustomNote(listed, state.furniture));
    } catch(err){ toast(err && err.message ? err.message : tr('文件格式不正确', 'Invalid file format')); }
  });
  e.target.value = '';
};
$('#furnLibFile').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(txt => {
    try { toastCustomImport(mergeCustomRows(customFileItems(parsePackText(txt)))); }
    catch(err){ toast(tr('JSON 读不出来', 'Could not read the JSON')); }
  });
  e.target.value = '';
};
$('#libFile').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(txt => {
    try { importLibraryBundle(JSON.parse(txt)); }
    catch(err){ toast(tr('JSON 读不出来', 'Could not read the JSON')); }
  });
  e.target.value = '';
};
$('#reset').onclick = () => {
  if (blockIfDirty()) return;
  if (state.id !== 'seed'){
    if (!confirm(tr('清空这份户型的家具、拆改和测量？墙体保留，可撤销。', 'Clear furniture, demolition and measures on this plan? Walls stay. You can undo.'))) return;
    const b = snap(); state.furniture = []; state.demolished = []; state.measures = []; ui.sel = null; commit(b); renderAll(); return;
  }
  if (!confirm(tr('恢复为默认设计方案？（可撤销）', 'Reset to the default design? (undoable)'))) return;
  const b = snap(), fresh = seedPlan(); fresh.id = 'seed'; adopt(fresh); ui.sel = null; commit(b); renderAll();
};
// 横竖屏切换、表头换行等都会改变画布尺寸；尺寸从 0 恢复（如首次布局）时重新适应窗口
// 其余尺寸变化（收起 / 展开面板等）保持画面中心不动
let lastW = 0, lastH = 0;
new ResizeObserver(() => {
  const w = svg.clientWidth, h = svg.clientHeight; if (!w) return;
  if (!lastW) fitView();
  else { view.x0 -= (w - lastW)/2/view.s; view.y0 -= (h - lastH)/2/view.s; applyView(); }
  lastW = w; lastH = h;
}).observe(svg);

function paintTab(){
  document.body.classList.remove('tab-decor', 'tab-plan', 'tab-preview');
  document.body.classList.add('tab-' + tab);
  document.querySelectorAll('#tabs .tab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
  const room = tab !== 'plan';
  const exp = $('#exportJson'), imp = $('#importJson');
  if (exp && imp){
    exp.dataset.zh = room ? '导出房间 JSON' : '导出户型 JSON';
    exp.dataset.en = room ? 'Export room JSON' : 'Export plan JSON';
    exp.textContent = tr(exp.dataset.zh, exp.dataset.en);
    imp.dataset.zh = room ? '导入房间' : '导入户型';
    imp.dataset.en = room ? 'Import room' : 'Import plan';
    imp.textContent = tr(imp.dataset.zh, imp.dataset.en);
  }
}
function homePlanCards(list, kind){
  return list.map(p => `<div class="plan-card" data-plan="${p.id}">
      ${thumbSVG(p, kind === 'room')}<span class="nm">${esc(nm(p.name || (kind === 'room' ? '未命名房间' : '未命名户型')))}</span>
      ${kind === 'edit' ? `<div class="row"><button class="btn" data-act="copy">${tr('复制', 'Duplicate')}</button><button class="btn danger" data-act="del">${tr('删除', 'Delete')}</button></div>` : ''}
      ${kind === 'room' ? `<div class="row"><button class="btn" data-act="edit">${tr('编辑', 'Edit')}</button><button class="btn danger" data-act="del">${tr('删除', 'Delete')}</button></div>` : ''}
    </div>`).join('');
}
function deleteRoom(id){
  const room = (library.rooms || []).find(x => x.id === id);
  if (!room || !confirm(tr(`删除房间「${room.name || '未命名房间'}」？户型会保留。`, `Delete room "${room.name || 'Untitled room'}"? The floor plan stays.`))) return;
  library.rooms = library.rooms.filter(x => x.id !== id);
  if (state.id === id){
    undoStack.length = redoStack.length = 0; ui.sel = null;
    applyPlan(library.plans.find(x => x.id === library.activeId) || library.plans[0]);
  }
  save();
  renderGate();
}
function createRoom(planId){
  const src = library.plans.find(x => x.id === planId);
  if (!src) return;
  const room = roomFromPlan(src);
  library.rooms.push(room);
  save();
  $('#roomPick').hidden = true;
  enterDecorate(room.id);
}
function openRoomPick(){
  if (!library.plans.length) return toast(tr('请先在户型编辑里新增一份户型', 'Add a floor plan from Edit plan first'));
  const root = $('#roomPickList');
  root.innerHTML = homePlanCards(library.plans, 'pick');
  root.querySelectorAll('.plan-card').forEach(card => card.onclick = () => createRoom(card.dataset.plan));
  $('#roomPick').hidden = false;
}
function renderGate(){
  const plan = tab === 'plan';
  $('#gateTitle').textContent = plan ? tr('户型编辑', 'Edit plan') : tr('房间装修', 'Decoration');
  $('#gateHint').textContent = plan
    ? tr('点一份户型，进入墙、门、窗编辑', 'Open a plan to edit walls, doors and windows')
    : tr('点一个房间，进入布置', 'Open a room to furnish it');
  $('#homeNew').hidden = false;
  $('#homeNew').textContent = plan ? tr('新增户型', 'New plan') : tr('新增房间', 'New room');
  const root = $('#gateList');
  const list = plan ? library.plans : (library.rooms || []);
  root.innerHTML = list.length ? homePlanCards(list, plan ? 'edit' : 'room')
    : `<p class="hint">${tr('还没有房间。点「新增房间」，选择一份户型。', 'No rooms yet. Choose a floor plan with New room.')}</p>`;
  root.querySelectorAll('.plan-card').forEach(card => card.onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act, id = card.dataset.plan;
    if (act === 'copy'){ copyPlan(id); renderGate(); return; }
    if (act === 'del'){ plan ? deletePlan(id) : deleteRoom(id); renderGate(); return; }
    if (act === 'edit' || !plan) enterDecorate(id);
    else enterPlanEdit(id);
  });
}
async function showRoomList(){
  decorInside = false;
  tab = 'decor';
  paintTab();
  if (viewMode !== '2d') await setView('2d');
  document.body.classList.add('gate');
  renderGate();
  if (typeof syncSaveBtn === 'function') syncSaveBtn();
}
function showPlanList(){
  tab = 'plan';
  paintTab();
  document.body.classList.add('gate');
  renderGate();
  if (typeof syncSaveBtn === 'function') syncSaveBtn();
}
function enterDecorate(id){
  const p = (library.rooms || []).find(x => x.id === id);
  if (!p || editing) return;
  decorInside = true;
  tab = 'decor';
  paintTab();
  document.body.classList.remove('gate');
  void svg.clientWidth;
  if (id !== state.id){
    undoStack.length = redoStack.length = 0; ui.sel = null;
    applyPlan(p); save();
  }
  setTool('select');
  renderAll(); fitView();
  if (typeof armSession === 'function') armSession();
}
function enterPlanEdit(id){
  tab = 'plan';
  paintTab();
  document.body.classList.remove('gate');
  void svg.clientWidth;
  beginEdit(id);
}
let afterLeave = null;
function syncSaveBtn(){
  const btn = $('#saveDoc');
  if (!btn) return;
  const inside = (editing || decorInside) && !document.body.classList.contains('gate') && tab !== 'preview';
  btn.hidden = !(inside && sessionDirty());
  btn.textContent = tr(editing ? '保存户型' : '保存房间', editing ? 'Save plan' : 'Save room');
}
function exitSession(discard){
  if (discard) restoreSession();
  if (editing){
    leaveEditorChrome();
    undoStack.length = redoStack.length = 0;
    ui.sel = null;
    setTool('select');
  }
  decorInside = false;
  sessionFull = null;
  sessionDigest = null;
  save();
  syncSaveBtn();
}
async function goList(){
  if (viewMode !== '2d') await setView('2d');
  document.body.classList.add('gate');
  renderGate();
  syncSaveBtn();
}
function openLeaveDlg(next){
  afterLeave = next || null;
  $('#leaveTitle').textContent = tr('保存修改？', 'Save changes?');
  $('#leaveHint').textContent = editing
    ? tr('这个户型有未保存的修改。', 'This floor plan has unsaved changes.')
    : tr('这个房间有未保存的修改。', 'This room has unsaved changes.');
  $('#leaveDlg').hidden = false;
}
function blockIfDirty(next){
  if (!((editing || decorInside) && sessionDirty())) return false;
  openLeaveDlg(next || null);
  return true;
}
function finishSaved(){
  const next = afterLeave;
  afterLeave = null;
  exitSession(false);
  renderAll();
  if (next) next();
  else goList();
}
function cancelSaved(){ afterLeave = null; }
function settleLeave(discard){
  const next = afterLeave;
  afterLeave = null;
  $('#leaveDlg').hidden = true;
  exitSession(discard);
  if (next) next();
  else goList();
}
async function setTab(next){
  if (next === tab) return;
  if (next === 'preview' && !window.View3D) return toast(tr('三维场景还在加载', 'The 3D view is still loading'));
  if ((editing || decorInside) && sessionDirty()){ openLeaveDlg(() => setTab(next)); return; }
  if (editing || decorInside) exitSession(false);
  const prev = tab;
  tab = next;
  paintTab();
  if (next !== 'preview' && viewMode !== '2d') await setView('2d');
  if (next !== 'preview' && viewMode !== '2d'){ tab = prev; paintTab(); return; }
  if (next === 'preview'){
    document.body.classList.remove('gate');
    void $('#stage').clientWidth;
    if (viewMode !== 'preview') await setView('preview');
    if (viewMode !== 'preview'){ tab = prev; paintTab(); document.body.classList.toggle('gate', prev !== 'preview'); }
    return;
  }
  const inside = next === 'decor' ? decorInside : editing;
  document.body.classList.toggle('gate', !inside);
  if (!inside) renderGate();
  else { void svg.clientWidth; renderAll(); fitView(); }
}
async function backToList(){
  if (tab === 'preview') return;
  if ((editing || decorInside) && sessionDirty()){ openLeaveDlg(() => goList()); return; }
  if (editing || decorInside) exitSession(false);
  await goList();
}
function setLang(l){
  LANG = l; try { localStorage.setItem(LANG_KEY, l); } catch(e) {}
  applyStaticLang(); syncFullscreen(); syncModeHint(); syncPaneBtns();
  buildLib(); buildDrawLib(); renderOpenings(); renderAll();
  if (!$('#planModal').hidden) renderPlanList();
  if (document.body.classList.contains('gate')) renderGate();
  syncTip();
  window.View3D?.relang();
}
$('#langSel').onclick = e => { const l = e.target.closest('[data-lang]')?.dataset.lang; if (l && l !== LANG) setLang(l); };
$('#homeLang').onclick = e => { const l = e.target.closest('[data-lang]')?.dataset.lang; if (l && l !== LANG) setLang(l); };
$('#tabs').onclick = e => { const next = e.target.closest('.tab')?.dataset.tab; if (next) setTab(next); };
$('#homeBack').onclick = () => backToList();
$('#saveDoc').onclick = () => { afterLeave = () => goList(); openNameDlg(editing ? 'plan' : 'room'); };
$('#leaveSave').onclick = () => { $('#leaveDlg').hidden = true; if (!afterLeave) afterLeave = () => goList(); openNameDlg(editing ? 'plan' : 'room'); };
$('#leaveDiscard').onclick = () => settleLeave(true);
$('#leaveStay').onclick = () => { $('#leaveDlg').hidden = true; afterLeave = null; };
$('#leaveDlg').onclick = e => { if (e.target === $('#leaveDlg')){ $('#leaveDlg').hidden = true; afterLeave = null; } };
$('#homeNew').onclick = () => {
  if (tab === 'plan'){ document.body.classList.remove('gate'); void svg.clientWidth; beginNew(); }
  else openRoomPick();
};
function openPackImport(){
  if (blockIfDirty()) return;
  $('#packBox').value = '';
  $('#importDlg').hidden = false;
}
function copyText(text){
  const done = () => toast(tr('提示词已复制，去能看图的 AI 里粘贴', 'Prompt copied. Paste it into an AI that can see pictures'));
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch(e) { toast(tr('复制失败', 'Could not copy')); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(fallback);
  else fallback();
}
function copyPackPrompt(){
  copyText(typeof HUXING_PROMPT === 'string' ? HUXING_PROMPT : '');
}
function submitPackImport(e){
  if (e) e.preventDefault();
  let raw;
  try { raw = parsePackText($('#packBox').value); }
  catch(err){ toast(tr('JSON 读不出来', 'Could not read the JSON')); return; }
  try { if (commitPack(raw)) $('#importDlg').hidden = true; }
  catch(err){ toast(err && err.message ? err.message : tr('这份数据不能导入', 'This data cannot be imported')); }
}
$('#homeImport').onclick = openPackImport;
$('#copyPrompt').onclick = copyPackPrompt;
const FURN_EXTRA_KEY = 'huxing-furn-extra';
function libTypeCat(type){
  return LIB.find(c => c.cat !== '自定义' && c.items.some(it => it[0] === type));
}
function customCat(){
  let cat = LIB.find(c => c.cat === '自定义');
  if (!cat){ cat = {cat:'自定义', items:[]}; LIB.push(cat); }
  return cat;
}
function sameFurn(row, type, name, w, d, color){
  return row[0] === type && row[1] === name && row[2] === w && row[3] === d && (color == null || String(row[4]).toLowerCase() === String(color).toLowerCase());
}
function stockFurn(type, name, w, d){
  for (const c of LIB){
    if (c.cat === '自定义') continue;
    const it = c.items.find(row => sameFurn(row, type, name, w, d));
    if (it) return it;
  }
  return null;
}
function furnExtraRows(){
  try {
    const rows = JSON.parse(localStorage.getItem(FURN_EXTRA_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch(e) { return []; }
}
const CUSTOM_PRIMS = new Set(['box','rbox','cyl','lathe','rod','tube','blob','shell','legs','fronts','vase','tableLamp','plate']);
function parseCustomParts(list){
  if (!Array.isArray(list)) return [];
  const out = [];
  list.slice(0, 8).forEach(p => {
    if (!p || !CUSTOM_PRIMS.has(p.primitive)) return;
    const size = partNums(p.size);
    if (!size.length) return;
    const part = {name:String(p.name || '').slice(0, 40), role:String(p.role || ''), primitive:p.primitive, size, note:String(p.note || '').slice(0, 80)};
    const at = partAt(p);
    if (at) part.at = at.map(n => Math.round(n));
    out.push(part);
  });
  return out;
}
function customRowFromItem(it){
  const row = {type:it[0], name:it[1], w:it[2], d:it[3], color:it[4]};
  if (Array.isArray(it[5]) && it[5].length) row.parts = it[5];
  return row;
}
function saveCustomFurn(){
  const cat = LIB.find(c => c.cat === '自定义');
  const rows = cat ? cat.items.map(customRowFromItem) : [];
  try { localStorage.setItem(FURN_EXTRA_KEY, JSON.stringify(rows)); } catch(e) {}
}
function normalizeCustomRow(raw){
  if (!raw || typeof raw !== 'object') return null;
  const reuse = String(raw.reuse || '').trim();
  const type = (reuse || String(raw.type || '').trim()).slice(0, 40);
  const parts = reuse ? [] : parseCustomParts(raw.parts);
  if (!type || (!libTypeCat(type) && !parts.length)) return null;
  const w = Math.round(packNum(raw.w) || 0), d = Math.round(packNum(raw.d) || 0);
  if (w < 50 || d < 50 || w > 8000 || d > 8000) return null;
  const name = String(raw.name || '').trim().slice(0, 40) || type;
  const color = /^#[0-9a-fA-F]{6}$/.test(String(raw.color || '')) ? String(raw.color) : typeColor(type);
  return {type, name, w, d, color, parts};
}
function customPayloadItems(raw){
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'furniture-library' && Array.isArray(raw.items)) return raw.items;
  if (raw.kind === 'furniture-drawing') return [raw];
  if (Array.isArray(raw) && raw.length && raw.every(x => x && typeof x === 'object' && (x.kind === 'furniture-drawing' || x.kind === 'furniture-library' || (x.type && x.w && x.d)))){
    return raw.flatMap(x => x.kind === 'furniture-library' && Array.isArray(x.items) ? x.items : [x]);
  }
  return null;
}
function customFileItems(raw){
  const direct = customPayloadItems(raw);
  if (direct) return direct;
  if (raw && Array.isArray(raw.customFurniture)) return raw.customFurniture;
  return null;
}
function mergeCustomRows(list){
  const result = {added:0, updated:0, skipped:0};
  if (!Array.isArray(list)) return null;
  let cat = LIB.find(c => c.cat === '自定义');
  list.forEach(raw => {
    const row = normalizeCustomRow(raw);
    if (!row){ result.skipped++; return; }
    if (stockFurn(row.type, row.name, row.w, row.d)){ result.skipped++; return; }
    if (!cat) cat = customCat();
    const it = cat.items.find(x => sameFurn(x, row.type, row.name, row.w, row.d, row.color));
    if (!it){
      const next = [row.type, row.name, row.w, row.d, row.color];
      if (row.parts.length) next[5] = row.parts;
      cat.items.push(next);
      result.added++;
    } else if (row.parts.length && JSON.stringify(it[5] || []) !== JSON.stringify(row.parts)){
      it[5] = row.parts;
      result.updated++;
    } else result.skipped++;
  });
  if (result.added || result.updated){ saveCustomFurn(); buildLib(); }
  return result;
}
function toastCustomImport(result){
  if (!result){ toast(tr('这份不是自定义家具', 'This is not custom furniture')); return; }
  if (result.added || result.updated){
    const bits = [];
    if (result.added) bits.push(tr(`${result.added} 件新的`, `${result.added} new`));
    if (result.updated) bits.push(tr(`${result.updated} 件更新`, `${result.updated} updated`));
    toast(tr('已导入自定义家具：', 'Imported custom furniture: ') + bits.join(tr('，', ', ')));
    return;
  }
  toast(result.skipped ? tr('自定义里已经有这些家具', 'These pieces are already in Custom') : tr('这份数据里没有家具', 'This file has no furniture'));
}
function customMatch(row, f){
  return row[0] === f.type && row[1] === f.name && row[2] === f.w && row[3] === f.d;
}
function customBundleFor(furn){
  const cat = LIB.find(c => c.cat === '自定义');
  const out = [];
  const seen = new Set();
  const push = row => {
    if (!row) return;
    const key = [row.type, row.name, row.w, row.d, String(row.color || '').toLowerCase()].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };
  (furn || []).forEach(f => {
    if (!f) return;
    const it = cat && cat.items.find(row => customMatch(row, f));
    if (it) push(customRowFromItem(it));
    else if (Array.isArray(f.parts) && f.parts.length && !stockFurn(f.type, f.name, f.w, f.d)){
      push({type:f.type, name:f.name, w:f.w, d:f.d, color:f.color, parts:f.parts});
    }
  });
  return out;
}
function libraryBundle(){
  if (typeof saveCustomFurn === 'function') saveCustomFurn();
  const lib = JSON.parse(JSON.stringify({
    activeId: library.activeId,
    plans: library.plans,
    rooms: library.rooms || []
  }));
  if (state && state.id){
    const copy = JSON.parse(JSON.stringify(state));
    const pi = lib.plans.findIndex(p => p.id === copy.id);
    if (pi >= 0) lib.plans[pi] = copy;
    else {
      const ri = lib.rooms.findIndex(p => p.id === copy.id);
      if (ri >= 0) lib.rooms[ri] = copy;
    }
  }
  let furnExtra = [];
  try { furnExtra = JSON.parse(localStorage.getItem(FURN_EXTRA_KEY) || '[]'); } catch(e) {}
  let paneState = {};
  try { paneState = JSON.parse(localStorage.getItem(PANES) || '{}'); } catch(e) {}
  return {
    kind: 'huxing-library',
    version: 1,
    library: lib,
    furnExtra: Array.isArray(furnExtra) ? furnExtra : [],
    lang: typeof LANG === 'string' ? LANG : 'zh',
    panes: paneState && typeof paneState === 'object' ? paneState : {}
  };
}
function exportLibraryBundle(){
  const pack = libraryBundle();
  download(tr('户型全部数据', 'floor-plan-library') + '.json', new Blob([JSON.stringify(pack, null, 2)], {type:'application/json'}));
  const n = pack.library.plans.length, r = pack.library.rooms.length;
  toast(tr(`已导出 ${n} 份户型、${r} 个房间`, `Exported ${n} plans and ${r} rooms`));
}
function importLibraryBundle(raw){
  if (!raw || raw.kind !== 'huxing-library' || !raw.library || !Array.isArray(raw.library.plans) || !raw.library.plans.length)
    return toast(tr('这不是全部数据', 'This is not a full data file'));
  const n = raw.library.plans.length, r = (raw.library.rooms || []).length;
  if (!confirm(tr(`用这份数据覆盖当前浏览器里的全部户型和房间？共 ${n} 份户型、${r} 个房间。`, `Replace every plan and room in this browser? ${n} plans, ${r} rooms.`))) return;
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify({
      activeId: raw.library.activeId,
      plans: raw.library.plans,
      rooms: raw.library.rooms || []
    }));
    if (Array.isArray(raw.furnExtra)) localStorage.setItem(FURN_EXTRA_KEY, JSON.stringify(raw.furnExtra));
    if (typeof raw.lang === 'string' && raw.lang) localStorage.setItem(LANG_KEY, raw.lang);
    if (raw.panes && typeof raw.panes === 'object') localStorage.setItem(PANES, JSON.stringify(raw.panes));
  } catch(e) {
    return toast(tr('写入失败', 'Could not save the data'));
  }
  location.reload();
}
function exportCustomFurn(){
  const cat = LIB.find(c => c.cat === '自定义');
  const items = cat ? cat.items.map(customRowFromItem) : [];
  if (!items.length){ toast(tr('自定义里还没有家具', 'There is no custom furniture yet')); return; }
  download(tr('自定义家具', 'custom-furniture') + '.json', new Blob([JSON.stringify({kind:'furniture-library', version:1, items}, null, 2)], {type:'application/json'}));
}
function placedCustomRows(furn){
  const out = [];
  (furn || []).forEach(f => {
    if (!f || !Array.isArray(f.parts) || !f.parts.length || stockFurn(f.type, f.name, f.w, f.d)) return;
    out.push({type:f.type, name:f.name, w:f.w, d:f.d, color:f.color, parts:f.parts});
  });
  return out;
}
function absorbCustomNote(listed, furn){
  const has = row => (listed || []).some(x => x && x.type === row.type && x.name === row.name && x.w === row.w && x.d === row.d && String(x.color || '').toLowerCase() === String(row.color || '').toLowerCase());
  const rows = (listed || []).concat(placedCustomRows(furn).filter(row => !has(row)));
  if (!rows.length) return '';
  const result = mergeCustomRows(rows);
  const n = (result && result.added || 0) + (result && result.updated || 0);
  return n ? tr(`，自定义家具 ${n} 件`, `, ${n} custom pieces`) : '';
}
function mountFurnExtra(){
  try {
    if (localStorage.getItem(FURN_EXTRA_KEY) == null && typeof DEFAULT_FURN_EXTRA !== 'undefined' && Array.isArray(DEFAULT_FURN_EXTRA))
      localStorage.setItem(FURN_EXTRA_KEY, JSON.stringify(DEFAULT_FURN_EXTRA));
  } catch(e) {}
  furnExtraRows().forEach(r => {
    if (!r || stockFurn(r.type, r.name, r.w, r.d)) return;
    const parts = parseCustomParts(r.parts);
    if (!libTypeCat(r.type) && !parts.length) return;
    const cat = customCat();
    if (cat.items.some(it => sameFurn(it, r.type, r.name, r.w, r.d, r.color))) return;
    const row = [r.type, r.name, r.w, r.d, r.color];
    if (parts.length) row[5] = parts;
    cat.items.push(row);
  });
}
function deleteCustomFurn(it){
  const cat = LIB.find(c => c.cat === '自定义');
  if (!cat || !it) return;
  const i = cat.items.findIndex(row => sameFurn(row, it[0], it[1], it[2], it[3], it[4]));
  if (i < 0) return;
  cat.items.splice(i, 1);
  saveCustomFurn();
  if (studioFurn && studioFurn.type === it[0] && studioFurn.name === it[1] && studioFurn.w === it[2] && studioFurn.d === it[3]){
    studioFurn = null; renderPanel(); window.View3D?.sync();
  }
  buildLib();
  toast(tr(`已删除「${it[1]}」`, `Removed "${it[1]}"`));
}
function submitFurnDrawing(e){
  if (e) e.preventDefault();
  let raw;
  try { raw = parsePackText($('#furnBox').value); }
  catch(err){ toast(tr('JSON 读不出来', 'Could not read the JSON')); return; }
  if (!raw || raw.kind !== 'furniture-drawing'){
    toast(tr('这份不是家具造型', 'This is not a furniture drawing'));
    return;
  }
  const reuse = String(raw.reuse || '').trim();
  const type = (reuse || String(raw.type || '').trim()).slice(0, 40);
  const parts = reuse ? [] : parseCustomParts(raw.parts);
  const home = libTypeCat(type);
  if (!type || (!home && !parts.length)){
    toast(tr('这个造型库里还没有图例，请沿用已有类型，或写上 4 到 8 个零件', 'This shape is not in the library. Reuse a type, or include 4 to 8 parts'));
    return;
  }
  const w = Math.round(packNum(raw.w) || 0), d = Math.round(packNum(raw.d) || 0);
  if (w < 50 || d < 50 || w > 8000 || d > 8000){
    toast(tr('宽深不对', 'Width or depth is not usable'));
    return;
  }
  const name = String(raw.name || '').trim().slice(0, 40) || type;
  const color = /^#[0-9a-fA-F]{6}$/.test(String(raw.color || '')) ? String(raw.color) : typeColor(type);
  const stock = stockFurn(type, name, w, d);
  if (stock){
    previewCatalog(stock);
    $('#furnAiDlg').hidden = true;
    toast(tr(`家具库里已有「${name}」`, `"${name}" is already in the library`));
    return;
  }
  const cat = customCat();
  let it = cat.items.find(row => sameFurn(row, type, name, w, d, color));
  const fresh = !it;
  if (fresh){
    it = [type, name, w, d, color];
    if (parts.length) it[5] = parts;
    cat.items.push(it);
  } else if (parts.length){
    it[5] = parts;
  }
  if (fresh || parts.length){ saveCustomFurn(); buildLib(); }
  previewCatalog(it);
  $('#furnAiDlg').hidden = true;
  toast(fresh ? tr(`已加入自定义「${name}」`, `Added "${name}" to Custom`) : tr(parts.length ? `已更新「${name}」` : `自定义里已有「${name}」`, parts.length ? `Updated "${name}"` : `"${name}" is already in Custom`));
}
$('#furnAi').onclick = () => { $('#furnAiDlg').hidden = false; };
$('#copyFurnPrompt').onclick = () => copyText(typeof FURN_PROMPT === 'string' ? FURN_PROMPT : '');
$('#furnAiClose').onclick = () => { $('#furnAiDlg').hidden = true; };
$('#furnAiDlg').onclick = e => { if (e.target === $('#furnAiDlg')) $('#furnAiDlg').hidden = true; };
$('#furnAiForm').onsubmit = submitFurnDrawing;
$('#furnFileBtn').onclick = () => $('#furnFile').click();
$('#furnFile').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(txt => { $('#furnBox').value = txt; }).catch(() => toast(tr('文件读不出来', 'Could not read the file')));
  e.target.value = '';
};
$('#packCancel').onclick = () => { $('#importDlg').hidden = true; };
$('#importDlg').onclick = e => { if (e.target === $('#importDlg')) $('#importDlg').hidden = true; };
$('#importForm').onsubmit = submitPackImport;
$('#packFileBtn').onclick = () => $('#packFile').click();
$('#packFile').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(txt => { $('#packBox').value = txt; }).catch(() => toast(tr('文件读不出来', 'Could not read the file')));
  e.target.value = '';
};
$('#roomPickClose').onclick = () => { $('#roomPick').hidden = true; };
$('#roomPick').onclick = e => { if (e.target === $('#roomPick')) $('#roomPick').hidden = true; };

applyStaticLang(); syncFullscreen();
buildDefs(); mountFurnExtra(); buildLib(); buildDrawLib(); renderOpenings(); renderDims();
syncTip();
fitView(); renderAll(); paintTab(); renderGate();
