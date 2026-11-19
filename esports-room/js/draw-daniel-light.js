// daniel-light 真形态：对照 2-white.png + 浅色房间规格
// L形白板桌 + 四细木腿椅 + 白布沙发浅蓝垫 + 菱形地毯。细腿是浅木不是铬。
(function(){
  function drawDanielLight(g, f, ctx){
    const {w, d, c, bz} = ctx;
    const {box, rbox, cyl, rod, tube, blob, ring, legs, fronts, vase, screenMat, glowMat, mat, fabric, woodM, ceramic, chrome, blackMetal, hwMat, glassMat, darker, rot} = ctx;
    const white = ceramic(), wood = woodM('#dcc09a'), black = blackMetal();
    const cloth = fabric(c), yDesk = .72, fat = .004;
    const coldScreen = screenMat('#e7eef2');
    const scr = (sw, sh, x, y, z) => {
      g.add(rbox(sw, sh, .02, white, x, y, z, .003));
      const face = box(sw-.024, sh-.03, .004, coldScreen, x, y+.005, z+.012);
      face.castShadow = false; face.userData.screen = true; g.add(face);
      g.add(cyl(.02,.024,.1,white,x,y-.12,z+.03,12), cyl(.09,.095,.014,white,x,yDesk-.005,z+.06,20));
    };
    switch (f.type){
      case 'gamedesk': case 'desk': {
        g.add(rbox(w,.03,d,white,0,yDesk,0,fat));
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>{
          g.add(rod([a*(w/2-.06),0,b*(d/2-.06)],[a*(w/2-.06),yDesk,b*(d/2-.06)],.014,wood,.02));
        });
        g.add(rbox(.4,.5,.36,white,-w/2+.25,0,bz+.25,fat));
        return true;
      }
      case 'ldesk': {
        const run = Math.min(.8,d*.55), ret = Math.min(.8,w*.45);
        g.add(rbox(w,.03,run,white,0,yDesk,bz+run/2,fat));
        g.add(rbox(ret,.03,d-run,white,-w/2+ret/2,yDesk,bz+run+(d-run)/2,fat));
        [[-w/2+.05,bz+.05],[w/2-.05,bz+.05],[w/2-.05,bz+run-.05],[-w/2+.05,d/2-.05],[-w/2+ret-.05,d/2-.05]]
          .forEach(([x,z])=>g.add(rod([x,0,z],[x,yDesk,z],.013,wood,.019)));
        g.add(rbox(.4,.55,.4,white,-w/2+.25,0,bz+.3,fat));
        g.add(rbox(.4,.65,.45,white,w/2-.25,0,bz+run+.2,fat));
        return true;
      }
      case 'gamechair': case 'chair': case 'officechair': {
        // 四细木腿 + 白布高背（浅色规格标志）
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>
          g.add(rod([a*(w/2-.12),0,b*(d/2-.12)],[a*(w/2-.1),.45,b*(d/2-.1)],.014,wood,.02)));
        g.add(rbox(w*.8,.06,d*.75,white,0,.4,0,.01));
        g.add(rbox(w*.78,.07,d*.7,cloth,0,.46,0,.025));
        g.add(rot(rbox(w*.66,.62,.08,cloth,0,.52,bz+.06,.03),-.12));
        return true;
      }
      case 'monitor': scr(Math.min(w*.9,.55),.32,0,yDesk+.12,bz+.05); return true;
      case 'ultrawide': scr(Math.min(w*.92,.85),.3,0,yDesk+.12,bz+.05); return true;
      case 'dualmon': {
        const sw = Math.min((w-.08)/2,.5);
        scr(sw,.3,-sw/2-.01,yDesk+.12,bz+.05); scr(sw,.3,sw/2+.01,yDesk+.12,bz+.05);
        return true;
      }
      case 'tv': {
        g.add(rbox(w,w*.56,.03,white,0,1.0,bz,.004));
        const face = box(w*.94,w*.5,.004,coldScreen,0,1.03,bz+.017);
        face.castShadow=false; g.add(face);
        g.add(box(.4,.03,.24,white,0,.8,0));
        return true;
      }
      case 'sofa': case 'armchair': {
        const n=(f.type==='armchair'||w<1.2)?1:2, cw=(w-.16)/n;
        legs(g,w,d,.12,wood,.05,.016);
        g.add(rbox(w,.14,d,cloth,0,.12,0,.025));
        g.add(rbox(w,.42,.14,cloth,0,.12,bz+.07,.03));
        for(let i=0;i<n;i++) g.add(rbox(cw-.03,.12,d*.62,cloth,-w/2+.08+cw*(i+.5),.26,.04,.04));
        g.add(rot(rbox(.4,.34,.1,fabric('#f7f4ee'),-w*.22,.42,bz+.24,.04),-.2));
        g.add(rot(rbox(.4,.34,.1,fabric('#f7f4ee'),w*.02,.42,bz+.24,.04),-.2));
        g.add(rot(rbox(.34,.3,.09,fabric('#9eb6e0'),w*.28,.4,bz+.24,.04),-.2,-.15));
        return true;
      }
      case 'beanbag': {
        // 浅色：白布矮豆
        g.add(blob(w*.32,.2,d*.3,cloth,0,.2,0,12));
        g.add(blob(w*.2,.12,d*.16,fabric('#f7f4ee'),0,.24,d*.1,10));
        return true;
      }
      case 'coffeetable': case 'sidetable': {
        const h=f.type==='sidetable'?.45:.35;
        g.add(rbox(w,.04,d,wood,0,h,0,.008));
        g.add(rbox(w*.9,h*.7,d*.8,wood,0,0,0,.006));
        g.add(cyl(.03,.04,.12,white,-w*.2,h+.04,0,12));
        g.add(box(.16,.02,.12,fabric('#e6dccc'),w*.1,h+.04,0));
        return true;
      }
      case 'rug': {
        g.add(rbox(w,.008,d,fabric('#e4ddd2'),0,0,0,.002));
        const nx=Math.max(3,Math.round(w/.3));
        for(let i=0;i<nx;i++) for(let j=0;j<2;j++){
          const dia=box(.09,.004,.09,mat('#2a2c30',{roughness:.9}),-w/2+w*(i+.5)/nx,.008,-d/4+d*j/2);
          dia.rotation.y=Math.PI/4; g.add(dia);
        }
        return true;
      }
      case 'plant': {
        g.add(cyl(.13,.11,.24,white,0,0,0,14));
        for(let k=0;k<6;k++){const a=k*1.05;const lf=box(.02,.5,.16,fabric('#8eae78'),Math.sin(a)*.1,.3,Math.cos(a)*.08);lf.rotation.set(.2,a,.4);g.add(lf);}
        return true;
      }
      case 'bookshelf': case 'wallshelf': {
        // 三层薄板壁架 + 立书 + 小绿植
        for(let i=0;i<3;i++) g.add(box(w,.03,Math.max(d,.18),wood,0,1.0+i*.3,0));
        for(let i=0;i<4;i++) g.add(box(.03,.2,.14,fabric('#e6dccc'),-w*.2+i*.06,1.33,0));
        g.add(cyl(.04,.05,.1,white,w*.2,1.63,0,10));
        g.add(blob(.06,.08,.06,fabric('#8eae78'),w*.2,1.78,0,8));
        return true;
      }
      case 'wardrobe': case 'cabinet': case 'shoecab': case 'figurecab': case 'drawerchest': case 'tvstand': {
        const h=f.type==='figurecab'?1.7:.8;
        g.add(rbox(w,h,d,white,0,0,0,fat));
        g.add(rbox(w+.02,.03,d+.02,white,0,h,0,.006));
        const n=Math.max(1,Math.round(w/.45));
        fronts(g,-w/2,.05,w,h-.1,d/2-.02,n,1,white,'edge');
        return true;
      }
      case 'pegboard': {
        g.add(box(w,.7,.025,wood,0,1.1,bz));
        for(let i=0;i<5;i++) for(let j=0;j<3;j++) g.add(cyl(.01,.01,.01,'#8a6a4a',-w/2+w*(i+.5)/5,1.05+j*.18,bz+.015,6));
        return true;
      }
      case 'acoustic': case 'painting': {
        g.add(rbox(w,.55,Math.max(d,.02),white,0,1.3,bz,.003));
        g.add(box(w*.8,.4,.006,fabric('#f3d7d2'),0,1.33,bz+.015));
        return true;
      }
      case 'curtain': {
        g.add(rod([-w/2,2.15,bz],[w/2,2.15,bz],.008,wood));
        for(let i=0;i<3;i++) g.add(rbox(w/3*.86,1.7,.015,white,-w/2+w/3*(i+.5),.4,bz,fat));
        return true;
      }
      case 'floorlamp': case 'desklamp': {
        g.add(cyl(.16,.18,.02,white,0,0,0,16));
        g.add(rod([0,0,0],[0,1.4,0],.012,wood,.016));
        g.add(cyl(.14,.18,.24,glowMat('#fff','#ffe9c4',.4),0,1.4,0,16));
        return true;
      }
      case 'piano': {
        g.add(rbox(w,.5,d*.4,wood,0,.5,0,.008));
        const keys=Math.max(8,Math.round(w/.045));
        for(let i=0;i<keys;i++) g.add(box((w*.86)/keys-.004,.02,.14,i%7===2||i%7===6?black:white,-w*.43+(w*.86)*(i+.5)/keys,.86,d*.1));
        return true;
      }
      case 'keyboard': {
        g.add(rbox(w,.02,d,white,0,yDesk,0,.003));
        for(let r=0;r<3;r++) for(let i=0;i<10;i++) g.add(box(.028,.008,d*.2,white,-w*.38+i*(w*.76/10),yDesk+.02,-d*.25+r*d*.25));
        return true;
      }
      case 'mouse': g.add(blob(.035,.025,.05,white,0,yDesk+.02,0,10)); return true;
      case 'mousepad': g.add(rbox(w,.005,d,fabric('#e7e4de'),0,yDesk,0,.001)); return true;
      case 'phone': {
        g.add(rbox(w,.01,d,black,0,yDesk,0,.002));
        const face=box(w*.8,.004,d*.7,coldScreen,0,yDesk+.01,0); face.castShadow=false; face.userData.screen=true; g.add(face);
        return true;
      }
      case 'penholder': g.add(cyl(w*.3,w*.28,.1,white,0,yDesk,0,10)); return true;
      case 'organizer': {
        g.add(rbox(w,.24,.08,white,0,yDesk,0,fat));
        g.add(box(.008,.18,.06,white,0,yDesk+.02,0));
        return true;
      }
      case 'deskset': {
        g.add(cyl(.025,.03,.14,glassMat||white,-w*.2,yDesk,0,10));
        g.add(cyl(.04,.035,.07,white,0,yDesk,0,10));
        g.add(rbox(.14,.015,.1,fabric('#9eb6e0'),w*.15,yDesk,0,.002));
        return true;
      }
      case 'slippers': {[-1,1].forEach(s=>g.add(rbox(w*.3,.035,d*.66,fabric('#c4a882'),s*w*.22,0,0,.008)));return true;}
      case 'underbox': {g.add(rbox(w,.14,d*.9,white,0,0,0,fat));g.add(box(w*.9,.015,.02,black,0,.14,0));return true;}
      case 'wallcloth': {g.add(rbox(w,.7,.012,white,0,1.2,bz,.002));return true;}
      case 'clock': {
        g.add(ring(.19,.012,wood,0,1.6,bz+.02));
        g.add(box(.012,.09,.006,black,0,1.6,bz+.03),box(.06,.012,.006,black,.02,1.6,bz+.03));
        return true;
      }
      case 'guitar': {
        g.add(blob(w*.3,.07,d*.32,wood,0,.2,0,8));
        g.add(rbox(.035,.85,.03,wood,0,.35,d*.1,.003));
        return true;
      }
      case 'stool': {
        g.add(box(w*.7,.06,d*.7,white,0,.42,0));
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>g.add(rod([a*w*.24,0,b*d*.24],[a*w*.22,.42,b*d*.22],.013,wood,.018)));
        return true;
      }
      case 'pctower': {g.add(rbox(w,.46,d,white,0,.02,0,fat));return true;}
      case 'console': {g.add(rbox(w,.05,d,fabric('#e7e4de'),0,yDesk,0,.004));return true;}
      case 'deskspeaker': {g.add(rbox(w,.14,d,white,0,yDesk,0,.004));g.add(cyl(.03,.03,.01,black,0,yDesk+.07,d/2,10));return true;}
      case 'micarm': case 'ledbar': {
        g.add(box(.05,.04,.05,white,-w*.3,yDesk,bz));
        g.add(tube([[-w*.3,yDesk,0],[0,yDesk+.3,0],[w*.2,yDesk+.36,0]],.008,white));
        return true;
      }
      case 'headset': {g.add(tube([[-w*.3,yDesk+.02,0],[0,yDesk+.14,0],[w*.3,yDesk+.02,0]],.008,white));return true;}
      case 'books': {for(let i=0;i<4;i++) g.add(box(.03,.2,.13,fabric('#e6dccc'),-.05+i*.04,yDesk,0));return true;}
      case 'camera': {g.add(rbox(w*.6,.05,d*.5,black,0,yDesk,0,.003));return true;}
      case 'controller': {g.add(rbox(w*.4,.02,d*.34,white,0,yDesk,0,.003));return true;}
      case 'bed': {
        g.add(rbox(w,.26,d-.06,white,0,.06,.02,.01));
        g.add(rbox(w,.9,.06,white,0,0,bz+.03,.008));
        g.add(rbox(w-.04,.18,d-.3,fabric('#fbfaf7'),0,.32,bz+.2,.05));
        g.add(rbox(w*.96,.2,d*.36,cloth,0,.33,d/2-.3,.035));
        return true;
      }
      case 'fishtank': case 'flowerbasket': case 'plush': case 'rock': case 'reed': case 'milktea': case 'egg': case 'cubes': case 'plaque': case 'shelfdecor': case 'controldeck': {
        if(f.type==='flowerbasket'){g.add(cyl(.09,.08,.12,white,0,0,0,10));g.add(blob(.05,.06,.05,fabric('#f3d7d2'),0,.18,0,8));return true;}
        if(f.type==='fishtank'){const t=rbox(w*.7,.26,d*.7,glassMat||white,0,.1,0,fat);t.castShadow=false;g.add(t);return true;}
        if(f.type==='plush'){g.add(blob(w*.3,.22,d*.3,fabric('#e6d3c4'),0,.22,0,10));return true;}
        if(f.type==='cubes'){[.0,.34,.66].forEach((t,i)=>g.add(rbox(.05,.05,.05,white,-w*.3+t*w,yDesk,0,.004)));return true;}
        if(f.type==='plaque'){g.add(box(w*.7,.3,.02,wood,0,1.3,bz));return true;}
        if(f.type==='shelfdecor'){g.add(cyl(.035,.04,.1,white,-.05,yDesk,0,10),box(.06,.04,.05,white,.05,yDesk,0));return true;}
        if(f.type==='controldeck'){g.add(rbox(w,.014,d,white,0,yDesk,0,.002));return true;}
        if(f.type==='milktea'){g.add(cyl(.035,.03,.09,white,0,yDesk,0,10));return true;}
        if(f.type==='egg'){g.add(blob(.035,.045,.035,white,0,yDesk+.045,0,10));return true;}
        if(f.type==='rock'){g.add(rbox(w*.4,.1,d*.3,fabric('#d9d0c4'),0,0,0,.006));return true;}
        if(f.type==='reed'){g.add(cyl(.07,.06,.1,white,0,0,0,8));g.add(blob(.05,.12,.05,fabric('#8eae78'),0,.2,0,8));return true;}
        return false;
      }
      case 'fridge': case 'aircon': case 'acwall': case 'purifier': case 'cylindricalaircon': case 'treadmill': {
        if(f.type==='acwall'){g.add(rbox(w,.2,.14,white,0,2.1,bz,.006));return true;}
        if(f.type==='cylindricalaircon'){g.add(cyl(w*.4,w*.38,1.6,white,0,0,0,14));return true;}
        if(f.type==='treadmill'){g.add(rbox(w,.07,d*.7,wood,0,.06,d*.06,fat));[-1,1].forEach(s=>g.add(box(.03,.9,.04,black,s*w*.32,.1,0)));return true;}
        const h=f.type==='fridge'?1.7:f.type==='aircon'?1.55:f.type==='purifier'?.6:1.0;
        g.add(rbox(w,h,d,white,0,0,0,fat));
        g.add(box(.008,h*.5,.008,hwMat(),w*.3,h*.25,d/2));
        return true;
      }
      default: return false;
    }
  }
  window.drawDanielLight = drawDanielLight;
})();
