// daniel-dark 真形态：对照 2.png + 深色房间规格
// 黑金属桌+横档 + 曲面屏 + 铬五星脚 + 海军蓝布 + 通高暖木格架柜内暖光。
(function(){
  function drawDanielDark(g, f, ctx){
    const {w, d, c, bz} = ctx;
    const {box, rbox, cyl, rod, tube, blob, legs, fronts, screenMat, glowMat, mat, fabric, woodM, ceramic, chrome, blackMetal, hwMat, glassMat, darker, rot} = ctx;
    const wood = woodM('#8d5a32'), black = blackMetal(), silver = chrome();
    const navy = fabric(c), yDesk = .73, fat = .004;
    const coldScreen = screenMat('#d5e4ee');
    const scr = (sw, sh, x, y, z) => {
      const fr = rbox(sw, sh, .022, black, x, y, z, .004);
      const face = box(sw-.026, sh-.032, .004, coldScreen, x, y+.004, z+.013);
      face.castShadow=false; face.userData.screen=true; g.add(fr, face);
      g.add(box(.03,.09,.03,black,x,y-.12,z+.04), cyl(.09,.095,.014,black,x,yDesk-.005,z+.08,18));
    };
    switch (f.type){
      case 'gamedesk': case 'desk': {
        g.add(rbox(w,.028,d,mat('#1a1a1c',{roughness:.4,metalness:.3}),0,yDesk,0,fat));
        g.add(rbox(w*.5,.02,d*.7,mat('#1a1a1c',{roughness:.4,metalness:.3}),-.2,yDesk,bz*.3,.003));
        [-1,1].forEach(s=>g.add(box(.045,yDesk,.045,black,s*(w/2-.06),0,0)));
        g.add(box(w-.2,.045,.045,black,0,.18,0));
        return true;
      }
      case 'ldesk': {
        const run=Math.min(.8,d*.5), ret=Math.min(.8,w*.42);
        g.add(rbox(w,.028,run,black,0,yDesk,bz+run/2,fat));
        g.add(rbox(ret,.028,d-run,black,-w/2+ret/2,yDesk,bz+run+(d-run)/2,fat));
        [[-w/2+.05,bz+.05],[w/2-.05,bz+.05],[-w/2+.05,d/2-.05],[-w/2+ret-.05,d/2-.05]].forEach(([x,z])=>g.add(box(.045,yDesk,.045,black,x,0,z)));
        g.add(box(w-.15,.045,.045,black,0,.18,bz+run/2));
        return true;
      }
      case 'gamechair': case 'chair': case 'officechair': {
        const rad=Math.min(w,d)*.34;
        for(let k=0;k<5;k++){const a=k*Math.PI*2/5,x=Math.sin(a)*rad,z=Math.cos(a)*rad;
          g.add(rod([0,.1,0],[x,.05,z],.014,silver,.011),cyl(.028,.028,.03,silver,x,.015,z,10));}
        g.add(cyl(.03,.036,.16,black,0,.1,0,10));
        g.add(rbox(w*.68,.08,d*.6,navy,0,.42,.02,.02));
        g.add(rot(rbox(w*.56,.6,.08,navy,0,.5,bz+.14,.02),-.14));
        [-1,1].forEach(s=>g.add(box(.03,.16,.3,black,s*w*.34,.52,0)));
        return true;
      }
      case 'monitor': scr(Math.min(w*.9,.65),.36,0,yDesk+.12,bz+.05,true); return true;
      case 'ultrawide': scr(Math.min(w*.92,.88),.34,0,yDesk+.12,bz+.05,true); return true;
      case 'dualmon': {
        const sw=Math.min((w-.08)/2,.5);
        scr(sw,.34,-sw/2-.01,yDesk+.12,bz+.05); scr(sw,.34,sw/2+.01,yDesk+.12,bz+.05);
        return true;
      }
      case 'tv': {
        g.add(rbox(w,w*.56,.03,black,0,1.0,bz,.004));
        const face=box(w*.94,w*.5,.004,coldScreen,0,1.03,bz+.017); face.castShadow=false; g.add(face);
        return true;
      }
      case 'sofa': case 'armchair': {
        const n=(f.type==='armchair'||w<1.2)?1:2, cw=(w-.2)/n;
        g.add(rbox(w,.16,d*.9,black,0,.06,0,.006));
        [-1,1].forEach(s=>g.add(box(.05,.06,.05,black,s*(w/2-.08),0,s*(d/2-.08))));
        g.add(rbox(w,.34,.14,navy,0,.22,bz+.07,.035));
        for(let i=0;i<n;i++) g.add(rbox(cw-.04,.14,d*.6,navy,-w/2+.1+cw*(i+.5),.22,.06,.045));
        return true;
      }
      case 'beanbag': {
        // 深色：海军蓝矮豆
        g.add(blob(w*.32,.2,d*.3,navy,0,.2,0,10));
        return true;
      }
      case 'coffeetable': case 'sidetable': {
        const h=f.type==='sidetable'?.46:.4;
        g.add(rbox(w,.03,d,black,0,h,0,.004));
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>g.add(box(.035,h,.035,black,a*(w/2-.05),0,b*(d/2-.05))));
        g.add(cyl(.045,.05,.14,ceramic(),-w*.2,h,0,10));
        return true;
      }
      case 'rug': {
        g.add(rbox(w,.008,d,fabric('#2a2c30'),0,0,0,.002));
        g.add(rbox(w*.4,.004,d*.9,fabric('#c46a3a'),-w*.2,.008,0,.001));
        g.add(rbox(w*.24,.004,d*.5,fabric('#e4ddd2'),w*.1,.008,0,.001));
        return true;
      }
      case 'plant': {
        g.add(cyl(.16,.13,.3,ceramic(),0,0,0,12));
        for(let k=0;k<7;k++){const a=k*.9;const lf=box(.03,.6,.2,fabric('#6e8f62'),Math.sin(a)*.12,.36,Math.cos(a)*.1);lf.rotation.set(.25,a,.35);g.add(lf);}
        return true;
      }
      case 'bookshelf': {
        // 通高暖木格架 + 暖光点
        const h=2.5;
        [-1,1].forEach(s=>g.add(box(.035,h,d,wood,s*(w/2-.02),0,0)));
        for(let i=0;i<6;i++) g.add(box(w-.04,.03,d*.92,wood,0,.15+i*(h-.3)/5.4,0));
        for(let i=1;i<5;i++) g.add(box(.03,h-.3,d*.9,wood,-w/2+w*i/4,0.15,0));
        for(let i=0;i<3;i++){const gl=box(.04,.02,.04,glowMat('#fff','#e7b56a',1),-w*.2+i*w*.2,1.2+i*.4,0);gl.castShadow=false;g.add(gl);}
        g.add(box(.16,.2,.12,ceramic(),w*.2,.5,0));
        const gz=box(.14,.18,.1,glassMat||ceramic(),-w*.15,1.1,0); gz.castShadow=false; g.add(gz);
        return true;
      }
      case 'wardrobe': case 'cabinet': case 'shoecab': case 'figurecab': case 'drawerchest': case 'tvstand': {
        // 架下矮柜：左两扇近黑门 + 右暖木抽屉
        const h=.8;
        g.add(rbox(w,h,d,wood,0,0,0,fat));
        g.add(rbox(w*.55,h-.06,.02,black,-w*.2,.03,d/2-.02,.003));
        fronts(g,-w*.475,.06,w*.55,h-.1,d/2-.01,2,1,black,'bar');
        fronts(g,w*.05,.06,w*.4,h-.1,d/2-.01,1,3,wood,'edge');
        return true;
      }
      case 'pegboard': {
        g.add(box(w,1.0,.03,wood,0,1.0,bz));
        for(let i=0;i<6;i++) for(let j=0;j<4;j++) g.add(cyl(.012,.012,.012,'#5a3a22',-w/2+w*(i+.5)/6,1.0+j*.2,bz+.02,6));
        return true;
      }
      case 'acoustic': case 'painting': case 'wallcloth': {
        g.add(rbox(w,.5,.025,black,0,1.35,bz,.003));
        g.add(box(w*.86,.38,.006,fabric('#cfc8be'),0,1.37,bz+.015));
        return true;
      }
      case 'curtain': {
        g.add(rod([-w/2,2.2,bz],[w/2,2.2,bz],.009,black));
        for(let i=0;i<4;i++) g.add(box(w/4*.88,1.85,.014,fabric('#1c1b1a'),-w/2+w/4*(i+.5),.35,(i%2)*.012));
        return true;
      }
      case 'clock': {
        // 线框钟：细圆环 + 辐条（用 tube 走圆，避免经典脚本里直接用 THREE）
        const pts=[]; for(let k=0;k<=24;k++){const a=k/24*Math.PI*2;pts.push([Math.sin(a)*.2,1.6+Math.cos(a)*.2,bz+.02]);}
        g.add(tube(pts,.008,black));
        for(let k=0;k<4;k++){const a=k*Math.PI/4;g.add(rod([0,1.6,bz+.02],[Math.sin(a)*.19,1.6+Math.cos(a)*.19,bz+.02],.004,black));}
        g.add(box(.012,.08,.006,black,0,1.6,bz+.03));
        return true;
      }
      case 'wallshelf': {
        g.add(box(w,.035,Math.max(d,.16),wood,0,1.35,0));
        g.add(box(.16,.2,.12,ceramic(),-w*.2,1.0,0));
        return true;
      }
      case 'floorlamp': {
        [[1,0],[-.5,.87],[-.5,-.87]].forEach(([sx,sz])=>g.add(rod([0,.6,0],[sx*.32,0,sz*.32],.012,black)));
        g.add(rod([0,.6,0],[0,1.32,0],.012,black));
        g.add(cyl(.15,.18,.26,glowMat('#fff4e0','#e7b56a',.8),0,1.32,0,16));
        return true;
      }
      case 'desklamp': {
        g.add(cyl(.12,.13,.02,black,0,yDesk,0,12));
        g.add(tube([[0,yDesk,0],[0,yDesk+.3,0],[.12,yDesk+.4,.05]],.009,black));
        return true;
      }
      case 'piano': {
        g.add(rbox(w,.55,d*.45,black,0,.55,0,.006));
        const keys=Math.max(8,Math.round(w/.04));
        for(let i=0;i<keys;i++) g.add(box((w*.84)/keys-.004,.02,.15,i%7===2||i%7===6?black:ceramic(),-w*.42+(w*.84)*(i+.5)/keys,.92,d*.08));
        return true;
      }
      case 'keyboard': {
        g.add(rbox(w,.02,d,black,0,yDesk,0,.003));
        for(let r=0;r<3;r++) for(let i=0;i<10;i++) g.add(box(.028,.008,.02,mat('#2a2c30',{roughness:.5}),-w*.38+i*(w*.76/10),yDesk+.02,-d*.25+r*d*.25));
        return true;
      }
      case 'mouse': g.add(rbox(.06,.03,.1,black,0,yDesk,0,.008)); return true;
      case 'mousepad': g.add(rbox(w,.006,d,fabric('#1c1c1e'),0,yDesk,0,.001)); return true;
      case 'phone': {
        g.add(rbox(w,.01,d,black,0,yDesk,0,.002));
        const face=box(w*.8,.004,d*.7,coldScreen,0,yDesk+.01,0);face.castShadow=false;face.userData.screen=true;g.add(face);
        return true;
      }
      case 'penholder': g.add(cyl(w*.3,w*.28,.1,black,0,yDesk,0,10)); return true;
      case 'organizer': {g.add(rbox(w,.22,.1,black,0,yDesk,0,fat));return true;}
      case 'deskset': {g.add(box(w*.3,.06,d*.5,fabric('#cfc8be'),0,yDesk,0));return true;}
      case 'slippers': {[-1,1].forEach(s=>g.add(rbox(w*.3,.035,d*.66,fabric('#1c1c1e'),s*w*.22,0,0,.008)));return true;}
      case 'underbox': {g.add(rbox(w,.14,d,black,0,0,0,fat));return true;}
      case 'guitar': {
        g.add(blob(w*.3,.07,d*.3,black,0,.2,0,8));
        g.add(rbox(.035,.85,.03,wood,0,.35,d*.1,.003));
        return true;
      }
      case 'stool': case 'bed': case 'fishtank': case 'flowerbasket': case 'plush': case 'rock': case 'reed': case 'milktea': case 'egg': case 'cubes': case 'plaque': case 'shelfdecor': case 'controldeck': case 'books': case 'camera': case 'controller': {
        if(f.type==='stool'){g.add(box(.4,.05,.4,black,0,.42,0));[[ -1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>g.add(box(.035,.42,.035,black,a*.15,0,b*.15)));return true;}
        if(f.type==='bed'){g.add(rbox(w,.3,d-.06,black,0,.08,.02,.01));g.add(rbox(w,1.0,.06,wood,0,0,bz+.03,.008));g.add(rbox(w-.04,.18,d-.3,fabric('#1c1c1e'),0,.38,bz+.2,.05));return true;}
        if(f.type==='books'){for(let i=0;i<4;i++) g.add(box(.03,.2,.14,wood,-.05+i*.04,yDesk,0));return true;}
        if(f.type==='camera'){g.add(rbox(w*.6,.05,d*.5,black,0,yDesk,0,.003));return true;}
        if(f.type==='controller'){g.add(rbox(w*.4,.025,d*.34,black,0,yDesk,0,.004));return true;}
        if(f.type==='flowerbasket'){g.add(cyl(.09,.08,.14,ceramic(),0,0,0,10));return true;}
        if(f.type==='fishtank'){const t=rbox(w*.6,.24,d*.6,glassMat||black,0,.1,0,fat);t.castShadow=false;g.add(t);return true;}
        if(f.type==='plush'){g.add(blob(w*.28,.2,d*.28,navy,0,.2,0,10));return true;}
        if(f.type==='milktea'){g.add(cyl(.035,.03,.09,black,0,yDesk,0,10));return true;}
        if(f.type==='egg'){g.add(blob(.035,.045,.035,fabric('#cfc8be'),0,yDesk+.045,0,10));return true;}
        if(f.type==='cubes'){[.0,.34,.66].forEach((t,i)=>g.add(rbox(.05,.05,.05,black,-w*.3+t*w,yDesk,0,.003)));return true;}
        if(f.type==='plaque'){g.add(box(w*.6,.3,.02,black,0,1.3,bz));return true;}
        if(f.type==='shelfdecor'){g.add(box(.08,.12,.06,wood,-.04,yDesk,0),box(.05,.08,.05,ceramic(),.06,yDesk,0));return true;}
        if(f.type==='controldeck'){g.add(rbox(w,.014,d,black,0,yDesk,0,.002));for(let i=0;i<4;i++) g.add(cyl(.008,.008,.006,silver,-w*.3+w*.6*(i+.5)/4,yDesk+.014,0,6));return true;}
        if(f.type==='rock'){g.add(rbox(w*.36,.09,d*.26,fabric('#3a3834'),0,0,0,.005));return true;}
        if(f.type==='reed'){g.add(cyl(.06,.05,.14,black,0,0,0,8));g.add(blob(.04,.12,.04,fabric('#6e8f62'),0,.24,0,8));return true;}
        return false;
      }
      case 'pctower': {g.add(rbox(w,.48,d,black,0,.02,0,fat));g.add(box(.02,.3,.01,coldScreen,-w/2+.05,.12,d/2+.002));return true;}
      case 'console': {g.add(rbox(w,.06,d,black,0,yDesk,0,.004));return true;}
      case 'deskspeaker': {g.add(rbox(w,.15,d,black,0,yDesk,0,.004));return true;}
      case 'micarm': {
        g.add(cyl(.04,.045,.02,black,-w*.15,yDesk,bz+.05,12));
        g.add(tube([[-w*.15,yDesk,0],[0,yDesk+.3,0],[w*.15,yDesk+.2,d*.1]],.009,black));
        return true;
      }
      case 'headset': {g.add(tube([[-w*.3,yDesk+.02,0],[0,yDesk+.14,0],[w*.3,yDesk+.02,0]],.009,black));return true;}
      case 'ledbar': {const b=box(w,.012,.012,glowMat('#fff','#e7b56a',.9),0,1.6,bz);b.castShadow=false;g.add(b);return true;}
      case 'fridge': case 'aircon': case 'acwall': case 'purifier': case 'cylindricalaircon': case 'treadmill': {
        if(f.type==='acwall'){g.add(rbox(w,.2,.14,black,0,2.1,bz,.006));return true;}
        if(f.type==='cylindricalaircon'){g.add(cyl(w*.4,w*.38,1.6,black,0,0,0,14));return true;}
        if(f.type==='treadmill'){g.add(rbox(w,.08,d*.7,fabric('#1a1a1c'),0,.06,d*.05,fat));[-1,1].forEach(s=>g.add(box(.035,.95,.045,black,s*w*.32,.1,0)));return true;}
        const h=f.type==='fridge'?1.7:f.type==='aircon'?1.55:f.type==='purifier'?.6:1.0;
        g.add(rbox(w,h,d,black,0,0,0,fat));
        return true;
      }
      default: return false;
    }
  }
  window.drawDanielDark = drawDanielDark;
})();
