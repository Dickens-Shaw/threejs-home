// bruno 真形态库：对照 docs/research/4.png + my-room-in-3d/docs/房间规格.md
// 低模、薄板、小倒角。木=浅橡哑光，布=深灰无织纹，陶瓷=白，黑金属=近黑，屏幕=暖橙只给桌面屏。
// 由 view3d.js buildFurniture 按风格分发调用：drawBruno(g, f, ctx)，ctx 含 w/d/c/bz/R + 全部几何小工具。
// 布局只定 id/位置，形态全在这里。
(function(){
  function drawBruno(g, f, ctx){
    const {w, d, c, bz, R} = ctx;
    const {box, rbox, cyl, lathe, rod, tube, blob, ring, shell, legs, fronts, vase, tableLamp, plate,
      mat, fabric, woodM, ceramic, chrome, blackMetal, hwMat, mirror, screenMat, glowMat,
      darker, lighter, glassMat, rot} = ctx;
    const wood = woodM('#d8c2a2'), white = ceramic(), black = mat('#1c1c1e', {roughness:.42, metalness:.45});
    const cloth = fabric(c), darkCloth = fabric('#4a4e54');
    const orangeScreen = screenMat('#e07a2f');
    const yDesk = .74, fat = .008, seg = 6;
    const scr = (sw, sh, x, y, z) => {
      const fr = rbox(sw, sh, .02, black, x, y, z, .004);
      const face = box(sw*.86, sh*.78, .004, orangeScreen, x, y+.005, z+.012);
      face.castShadow = false; face.userData.screen = true; g.add(fr, face);
    };
    switch (f.type){
      case 'gamedesk': case 'desk': {
        g.add(rbox(w, .035, d, wood, 0, yDesk, 0, fat));
        g.add(rbox(Math.min(.42, w*.3), yDesk, d*.86, white, -w/2+Math.min(.21, w*.15), 0, 0, fat));
        for (let i=0;i<3;i++) g.add(box(Math.min(.34, w*.24), .008, .008, black, -w/2+Math.min(.21, w*.15), .18+i*(yDesk/3.4), d/2-.015));
        g.add(box(Math.max(.08, w-.5), .05, .05, black, .2, 0, 0));
        g.add(rbox(Math.min(.44, w*.4), .014, d*.26, black, 0, yDesk+.035, d*.06, .003));
        return true;
      }
      case 'ldesk': {
        const run = Math.min(.75, d*.52), ret = Math.min(.75, w*.42);
        g.add(rbox(w, .035, run, wood, 0, yDesk, bz+run/2, fat));
        g.add(rbox(ret, .035, d-run+.02, wood, -w/2+ret/2, yDesk, bz+run+(d-run)/2, fat));
        const ins = Math.min(.08, w*.12, d*.12);
        [[-w/2+ins,bz+ins],[w/2-ins,bz+ins],[w/2-ins,bz+run-ins],[-w/2+ins,d/2-ins],[-w/2+ret-ins,d/2-ins]]
          .forEach(([x,z]) => g.add(box(.04, yDesk, .04, black, x, 0, z)));
        g.add(rbox(Math.min(.4, ret*.85), yDesk*.68, .34, white, -w/2+ret*.45, 0, bz+run*.45, fat));
        return true;
      }
      case 'gamechair': case 'chair': case 'officechair': {
        const rad = Math.min(w,d)*.36;
        for (let k=0;k<5;k++){
          const a = k*Math.PI*2/5, x = Math.sin(a)*rad, z = Math.cos(a)*rad;
          g.add(rod([0,.09,0],[x,.04,z],.013,black,.01), cyl(.026,.026,.028,'#111',x,.014,z,8));
        }
        g.add(cyl(.032,.038,.14,black,0,.09,0,10));
        g.add(rbox(w*.7,.07,d*.64,darkCloth,0,.42,.03,.015));
        g.add(rot(rbox(w*.58,.52,.07,darkCloth,0,.5,bz*.2,.014),-.16));
        g.add(rot(rbox(w*.26,.09,.06,darkCloth,0,.88,bz*.15,.015),-.16));
        [-1,1].forEach(s => g.add(box(.028,.15,.07,black,s*w*.35,.46,.04)));
        return true;
      }
      case 'monitor': scr(Math.min(w*.9,.62),.36,0,yDesk+.1,bz+.06); backStand(); return true;
      case 'ultrawide': scr(Math.min(w*.92,.9),.32,0,yDesk+.1,bz+.06); backStand(); return true;
      case 'dualmon': {
        const sw = Math.min((w-.08)/2,.56);
        scr(sw,.36,-sw/2-.015,yDesk+.1,bz+.06); scr(sw,.36,sw/2+.015,yDesk+.1,bz+.06);
        backStand(); return true;
      }
      case 'tv': {
        const th = w*.56;
        g.add(rbox(w,th,.025,black,0,1.05,bz,fat));
        const face = box(w*.9,th*.8,.004,screenMat('#20242a'),0,1.05+th*.05,bz+.015);
        face.castShadow = false; g.add(face);
        g.add(box(.5,.04,.3,black,0,.78,0));
        return true;
      }
      case 'pctower': {
        g.add(rbox(w,.48,d,wood,0,.02,0,fat));
        for (let i=0;i<3;i++) g.add(box(.05,.05,.012,black,0,.12+i*.1,d/2+.002));
        return true;
      }
      case 'console': {
        g.add(rbox(w,.05,d,black,0,yDesk,0,.006));
        g.add(box(w*.4,.008,.008,'#2a2a2c',-w*.06,yDesk+.05,d/2-.004));
        return true;
      }
      case 'deskspeaker': {
        g.add(rbox(w,.15,d,black,0,yDesk,0,.006));
        const dr = cyl(Math.min(w,d)*.26,Math.min(w,d)*.26,.012,'#101010',0,yDesk+.07,d/2,12);
        dr.rotation.x = Math.PI/2; g.add(dr);
        return true;
      }
      case 'micarm': case 'ledbar': {
        // 补光灯：桌面夹座 + 两节黑臂 + 白椭圆灯头（bruno 标志件）
        g.add(box(.07,.05,.06,black,-w*.28,yDesk,bz+.06));
        g.add(tube([[-w*.28,yDesk+.02,bz+.06],[-.05,yDesk+.24,0],[.08,yDesk+.3,.06]],.011,black));
        g.add(blob(.085,.045,.1,white,.1,yDesk+.32,.08,10));
        const gl = blob(.05,.02,.06,glowMat('#fff','#ffe2b0',1),.1,yDesk+.32,.13,10);
        gl.castShadow = false; g.add(gl);
        return true;
      }
      case 'headset': {
        const y = yDesk+.02;
        g.add(tube([[-w*.3,y+.02,0],[0,y+.12,0],[w*.3,y+.02,0]],.007,black));
        [-1,1].forEach(s => g.add(rbox(.05,.07,.045,black,s*w*.3,y-.02,0,.01)));
        return true;
      }
      case 'floorlamp': {
        g.add(tube([[0,yDesk,0],[.1,yDesk+.28,.04],[.03,yDesk+.44,.07]],.011,black));
        g.add(blob(.07,.04,.1,white,.03,yDesk+.46,.09,10));
        return true;
      }
      case 'desklamp': {
        g.add(tube([[-w*.1,yDesk,0],[.05,yDesk+.22,.04],[.12,yDesk+.38,.08]],.01,black));
        g.add(blob(.08,.035,.1,white,.14,yDesk+.4,.1,10));
        return true;
      }
      case 'sofa': case 'armchair': {
        const n = (f.type==='armchair'||w<1.2)?1:2, lh=.05, cw=(w-.24)/n;
        g.add(rbox(w*.94,lh,d*.94,black,0,0,0,.008));
        g.add(rbox(w,.2,d,darkCloth,0,lh,0,.012));
        g.add(rbox(w,.44,.15,darkCloth,0,lh,bz+.075,.015));
        [-1,1].forEach(s => g.add(rbox(.12,.3,d*.9,darkCloth,s*(w/2-.06),lh,0,.015)));
        for (let i=0;i<n;i++) g.add(rbox(cw*.88,.09,d*.5,darkCloth,-w/2+.12+cw*(i+.5),lh+.2,.05,.02));
        return true;
      }
      case 'beanbag': {
        // bruno 豆形身体：深灰竖豆 + 浅灰脸
        g.add(blob(w*.32,.34,d*.3,darkCloth,0,.34,0,10));
        g.add(blob(w*.2,.22,d*.08,fabric('#d5d5d8'),0,.36,d*.2,10));
        [-1,1].forEach(s => g.add(blob(.035,.16,.035,darkCloth,s*w*.2,.1,.02,8)));
        return true;
      }
      case 'cornersofa': {
        const k = Math.min(.95,d*.56,w*.4), b=.2, lh=.05;
        g.add(rbox(w,.18,k,darkCloth,0,lh,bz+k/2,.012), rbox(k,.18,d-k,darkCloth,-w/2+k/2,lh,bz+k+(d-k)/2,.012));
        g.add(rbox(w,.5,b,darkCloth,0,lh,bz+b/2,.015), rbox(b,.5,d,darkCloth,-w/2+b/2,lh,0,.015));
        return true;
      }
      case 'bed': {
        g.add(box(w-.1,.07,d-.12,'#4a3e33',0,0,.03));
        g.add(rbox(w,.24,d-.06,wood,0,.07,.03,.012));
        g.add(rbox(w,1.02,.06,wood,0,0,bz+.03,.008));
        g.add(rbox(w-.04,.2,d-.3,white,0,.31,bz+.2,.05));
        g.add(rbox(w*.96,.24,d*.4,darkCloth,0,.32,d/2-.32,.04));
        return true;
      }
      case 'coffeetable': case 'sidetable': {
        const h = f.type==='sidetable'?.45:.36;
        g.add(rbox(w,.045,d,white,0,h,0,.008));
        g.add(rbox(w*.86,h,.04,wood,0,0,d*.2,.006), rbox(w*.86,.03,d*.8,wood,0,.04,0,.006));
        return true;
      }
      case 'rug': {
        g.add(rbox(w,.008,d,fabric('#cfc8be'),0,0,0,.003));
        g.add(rbox(w-.16,.003,d-.16,fabric('#b7b1a6'),0,.008,0,.002));
        return true;
      }
      case 'plant': {
        g.add(cyl(.12,.1,.2,mat('#3d342c',{roughness:.7}),0,0,0,8));
        for (let k=0;k<5;k++){
          const a = k*1.2;
          const leaf = box(.02,.34,.22,fabric('#3f6b45'),Math.sin(a)*.08,.24,Math.cos(a)*.06);
          leaf.rotation.set(0,a,.5); g.add(leaf);
        }
        return true;
      }
      case 'bookshelf': {
        const h = 1.9;
        [-1,1].forEach(s => g.add(box(.03,h,d,wood,s*(w/2-.015),0,0)));
        for (let i=0;i<4;i++) g.add(box(w-.04,.025,d*.9,wood,0,.15+i*((h-.3)/3.4),0));
        g.add(rbox(w*.66,.5,d*.86,white,0,0,0,.008));
        g.add(box(.2,.028,.2,fabric('#e07a2f'),w*.1,.62,0), box(.16,.028,.16,fabric('#9eb6e0'),-w*.12,1.1,0));
        return true;
      }
      case 'wardrobe': case 'cabinet': case 'shoecab': case 'figurecab': case 'drawerchest': case 'tvstand': {
        const h = f.type==='figurecab'?1.7:(f.type==='wardrobe'?.85:.8);
        const body = (f.type==='figurecab'||f.type==='tvstand')?wood:white;
        g.add(rbox(w,h,d,body,0,0,0,fat));
        if (f.type==='figurecab'){
          const pane = box(w*.78,h*.66,.006,glassMat||mat('#d5e7ef',{transparent:true,opacity:.3,roughness:.05}),0,h*.14,d/2);
          pane.castShadow = false; g.add(pane);
          g.add(box(w*.7,.012,d*.7,wood,0,.3,.01));
        } else {
          const n = Math.max(1,Math.round(w/.5));
          fronts(g,-w/2,.06,w,h-.08,d/2-.02,n,1,body,'edge');
        }
        if (f.type==='tvstand') g.add(box(Math.min(.5,w*.3),.1,.2,black,-w*.24,.82,0));
        return true;
      }
      case 'pegboard': {
        g.add(box(w,.9,.03,wood,0,1.05,bz));
        for (let i=0;i<6;i++) for (let j=0;j<4;j++) g.add(cyl(.012,.012,.012,'#8a6a4a',-w/2+w*(i+.5)/6,1.0+j*.2,-.01,6));
        g.add(box(w*.4,.28,.14,white,-w*.2,1.1,.06));
        return true;
      }
      case 'acoustic': {
        g.add(box(w,.7,.03,fabric('#e7a0c4'),0,1.05,bz));
        const n = Math.max(4,Math.round(w/.12));
        for (let i=0;i<n;i++) g.add(box(w/n*.4,.6,.045,wood,-w/2+w/n*(i+.5),1.08,0));
        return true;
      }
      case 'curtain': {
        g.add(rod([-w/2,2.15,bz],[w/2,2.15,bz],.01,black));
        for (let i=0;i<2;i++) g.add(rbox(w/2*.86,1.7,.02,fabric('#9eb6e0'),-w/4+w/2*i,.4,bz,fat));
        return true;
      }
      case 'guitar': {
        g.add(blob(w*.36,.08,d*.4,black,0,.2,d*.05,6));
        g.add(rbox(.035,.85,.03,wood,0,.35,bz+d*.15,.004));
        g.add(cyl(.04,.04,.012,white,0,.24,d*.2,8));
        return true;
      }
      case 'stool': {
        g.add(box(w*.72,.08,d*.72,wood,0,.4,0));
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b]) => g.add(box(.045,.4,.045,black,a*w*.24,0,b*d*.24)));
        return true;
      }
      case 'piano': {
        g.add(rbox(w,.12,d*.45,black,0,.72,bz+d*.05,fat));
        [-1,1].forEach(s => g.add(box(.05,.72,d*.5,black,s*(w/2-.04),0,0)));
        const keys = Math.max(8,Math.round(w/.04));
        for (let i=0;i<keys;i++) g.add(box((w*.8)/keys-.004,.02,d*.16,i%7===2||i%7===6?black:white,-w*.4+(w*.8)*(i+.5)/keys,.84,d*.02));
        return true;
      }
      case 'keyboard': {
        g.add(rbox(w,.018,d,black,0,yDesk,0,.004));
        for (let r=0;r<3;r++) for (let i=0;i<10;i++)
          g.add(rbox(.03,.007,d*.12,mat('#2a2a2c',{roughness:.5}),-w*.4+i*(w*.8/10),yDesk+.018,-d*.22+r*d*.22,.001));
        return true;
      }
      case 'mouse': g.add(rbox(w*.7,.035,d*.8,black,0,yDesk,0,.006)); return true;
      case 'mousepad': g.add(rbox(w,.006,d,fabric('#2a2c30'),0,yDesk,0,.002)); return true;
      case 'phone': {
        g.add(rbox(w,.008,d,black,0,yDesk,0,.002));
        const face = box(w*.7,.003,d*.6,screenMat('#e07a2f'),0,yDesk+.008,0);
        face.castShadow = false; face.userData.screen = true; g.add(face);
        return true;
      }
      case 'penholder': {
        g.add(cyl(w*.3,w*.28,.09,white,0,yDesk,0,8));
        for (let i=0;i<3;i++){ const a=i*2.1; g.add(rod([Math.sin(a)*.015,yDesk+.04,Math.cos(a)*.015],[Math.sin(a)*.02,yDesk+.18,Math.cos(a)*.012],.003,black)); }
        return true;
      }
      case 'organizer': {
        g.add(rbox(w,.2,d,white,0,yDesk,0,fat));
        g.add(box(.008,.16,d*.8,wood,0,yDesk+.02,0));
        return true;
      }
      case 'deskset': {
        g.add(box(w*.16,.16,d*.16,white,-w*.22,yDesk,0), box(w*.14,.08,d*.14,fabric('#e07a2f'),w*.05,yDesk+.012,-.02));
        return true;
      }
      case 'slippers': {
        [-1,1].forEach(s => g.add(rbox(w*.3,.03,d*.66,fabric('#d9d4d0'),s*w*.22,0,0,.006)));
        return true;
      }
      case 'underbox': {
        g.add(rbox(w,.12,d,wood,0,0,0,fat));
        g.add(box(w,.012,.02,black,0,.1,d/2));
        return true;
      }
      case 'painting': {
        g.add(rbox(w,.6,Math.max(d,.02),wood,0,1.3,bz,.004));
        g.add(box(w*.76,.44,.006,fabric('#e7a0c4'),0,1.34,bz+d*.05));
        return true;
      }
      case 'wallcloth': {
        g.add(rbox(w,.9,.012,fabric('#9eb6e0'),0,1.15,bz,.003));
        return true;
      }
      case 'wallshelf': {
        g.add(box(w,.04,Math.max(d,.16),wood,0,1.4,0));
        g.add(box(w*.4,.28,Math.max(d,.14),white,-w*.22,1.12,0));
        g.add(cyl(.03,.035,.1,white,.1,1.44,.02,8));
        return true;
      }
      case 'clock': {
        const disc = cyl(.2,.2,.018,black,0,1.6,bz,12);
        disc.rotation.x = Math.PI/2; g.add(disc);
        g.add(box(.012,.1,.008,white,0,1.6,bz+.02), box(.07,.012,.008,white,.02,1.6,bz+.02));
        return true;
      }
      case 'books': {
        const cols = ['#b88a6a','#6f8f8a','#d9c08c','#a8675e'];
        for (let i=0;i<4;i++) g.add(box(.024,.2,d*.7,mat(cols[i],{roughness:.8}),-.05+i*.035,yDesk,0));
        return true;
      }
      case 'camera': {
        g.add(rbox(w*.7,.05,d*.6,black,0,yDesk,0,.004));
        const lens = cyl(w*.15,w*.15,.03,black,w*.12,yDesk+.03,d*.14,8);
        lens.rotation.x = Math.PI/2; g.add(lens);
        return true;
      }
      case 'controller': {
        g.add(rbox(w*.44,.02,d*.38,black,0,yDesk,0,.004));
        [-1,1].forEach(s => g.add(blob(w*.15,.016,d*.26,black,s*w*.27,yDesk+.015,d*.05,6)));
        return true;
      }
      case 'fishtank': {
        g.add(box(.04,.28,.04,wood,-w*.28,.3,-d*.28), box(.04,.28,.04,wood,w*.28,.3,d*.28), box(.04,.28,.04,wood,-w*.28,.3,d*.28), box(.04,.28,.04,wood,w*.28,.3,-d*.28));
        g.add(rbox(w*.8,.04,d*.8,wood,0,.3,0,fat));
        const tank = rbox(w*.7,.26,d*.7,mat('#d5e7ef',{transparent:true,opacity:.35,roughness:.05}),0,.34,0,fat);
        tank.castShadow = false; g.add(tank);
        return true;
      }
      case 'flowerbasket': {
        g.add(cyl(w*.26,w*.22,.08,wood,0,0,0,8));
        g.add(blob(.05,.05,.05,fabric('#e7a0c4'),-.03,.15,0,6), blob(.04,.04,.04,fabric('#f0c56a'),.04,.13,.02,6));
        return true;
      }
      case 'plush': {
        g.add(blob(w*.36,.26,d*.36,fabric('#cfc8be'),0,.26,0,8));
        g.add(blob(w*.07,.14,.05,fabric('#d9d4d0'),w*.27,.18,d*.1,6));
        return true;
      }
      case 'rock': {
        g.add(rbox(w*.5,.12,d*.4,fabric('#cfc8be'),-.05,0,0,.008), rbox(w*.28,.08,d*.28,fabric('#b7b1a6'),w*.18,0,.04,.006));
        return true;
      }
      case 'reed': {
        g.add(cyl(w*.2,w*.16,.08,mat('#3d342c',{roughness:.7}),0,0,0,8));
        for (let k=0;k<4;k++){ const a=k*1.57; const lf=box(.015,.28,.08,fabric('#3f6b45'),Math.sin(a)*.04,.12,Math.cos(a)*.03); lf.rotation.set(0,a,.4); g.add(lf); }
        return true;
      }
      case 'milktea': {
        g.add(box(w*.55,.1,d*.55,white,0,yDesk,0), box(w*.4,.02,d*.4,black,0,yDesk+.1,0));
        return true;
      }
      case 'egg': g.add(rbox(w*.55,.07,d*.6,white,0,yDesk,0,.008)); return true;
      case 'cubes': {
        const cols = [fabric('#e7a0c4'),fabric('#9eb6e0'),fabric('#e07a2f')];
        [.0,.34,.66].forEach((t,i) => g.add(rbox(.042,.042,.042,cols[i],-w*.3+t*w,yDesk,0,.004)));
        return true;
      }
      case 'plaque': {
        g.add(rbox(w*.7,.045,.03,white,w*.15,1.32,bz,.004));
        g.add(rod([-w*.15,1.15,bz],[w*.15,1.55,bz],.01,wood));
        return true;
      }
      case 'shelfdecor': {
        g.add(box(.05,.08,.05,fabric('#e07a2f'),-.05,yDesk,0), box(.06,.04,.05,white,.05,yDesk,0));
        return true;
      }
      case 'controldeck': {
        g.add(rbox(w,.014,d,white,0,yDesk,0,.003));
        for (let i=0;i<4;i++) g.add(cyl(.008,.008,.006,black,-w*.3+w*.6*(i+.5)/4,yDesk+.014,0,6));
        return true;
      }
      case 'fridge': case 'aircon': case 'acwall': case 'purifier': case 'cylindricalaircon': case 'treadmill': {
        // bruno 全景里不出场，按规格给低模白盒体 + 黑缝，保持配色不断层
        if (f.type==='treadmill'){
          g.add(rbox(w,.08,d*.72,wood,0,.08,d*.08,fat));
          g.add(box(w*.7,.012,d*.5,black,0,.16,d*.1));
          [-1,1].forEach(s => g.add(box(.03,.9,.04,black,s*w*.32,.1,bz+.08)));
          return true;
        }
        if (f.type==='cylindricalaircon'){ g.add(cyl(w*.4,w*.38,1.6,white,0,0,0,8)); return true; }
        if (f.type==='acwall'){ g.add(rbox(w,.16,Math.max(d,.12),white,0,2.15,bz,.008)); return true; }
        const h = f.type==='fridge'?1.7:f.type==='aircon'?1.55:f.type==='purifier'?.62:1.05;
        g.add(rbox(w,h,d,white,0,0,0,fat));
        g.add(box(w*.8,.008,.008,black,0,h*.66,d/2));
        return true;
      }
      default: return false;
    }
    function backStand(){
      g.add(box(.028,.1,.028,black,0,yDesk,bz+.09));
      g.add(cyl(.07,.075,.014,black,0,yDesk-.01,bz+.12,10));
    }
  }
  window.drawBruno = drawBruno;
})();
