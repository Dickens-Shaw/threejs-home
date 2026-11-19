// sooah 真形态：对照 3.png + 黏土房间规格
// 矮胖大圆角，桃木+浅粉，金属只留琴架椅轮一点灰亮。键盘浅紫，台灯浅蓝。
(function(){
  function drawSooah(g, f, ctx){
    const {w, d, c, bz, R} = ctx;
    const {box, rbox, cyl, rod, tube, blob, legs, fronts, vase, screenMat, glowMat, mat, fabric, woodM, ceramic, chrome, blackMetal, hwMat, glassMat, rot} = ctx;
    const wood = woodM('#e0b090'), pink = fabric(c), white = ceramic();
    const purple = fabric('#d7c2ee'), blue = fabric('#c9d7ea');
    const fat = .03, yDesk = .62;
    const paleScreen = screenMat('#f3d5e4');
    const scr = (sw, sh, x, y, z) => {
      g.add(rbox(sw, sh, .05, pink, x, y, z, .04));
      const face = box(sw*.82, sh*.74, .006, paleScreen, x, y+.02, z+.028);
      face.castShadow=false; face.userData.screen=true; g.add(face);
      g.add(rbox(.1,.12,.06,wood,x,y-.14,z-.02,.02), rbox(.3,.03,.2,wood,x,yDesk-.005,z+.04,.012));
    };
    switch (f.type){
      case 'gamedesk': case 'desk': {
        g.add(rbox(w,.07,d,wood,0,yDesk,0,.03));
        g.add(rbox(w*.9,.14,.04,wood,0,yDesk-.14,bz+.06,.02));
        [-1,1].forEach(s=>g.add(rbox(.09,yDesk,.09,wood,s*(w/2-.09),0,0,.025)));
        return true;
      }
      case 'ldesk': {
        const run=Math.min(.8,d*.55), ret=Math.min(.8,w*.42);
        g.add(rbox(w,.07,run,wood,0,yDesk,bz+run/2,.03));
        g.add(rbox(ret,.07,d-run,wood,-w/2+ret/2,yDesk,bz+run+(d-run)/2,.03));
        [[-w/2+.07,bz+.07],[w/2-.07,bz+.07],[-w/2+.07,d/2-.07],[-w/2+ret-.07,d/2-.07]].forEach(([x,z])=>g.add(rbox(.09,yDesk,.09,wood,x,0,z,.025)));
        return true;
      }
      case 'gamechair': case 'chair': case 'officechair': {
        // 圆座方背 + 白柱 + 白五星 + 黑轮
        g.add(rbox(w*.66,.12,d*.6,pink,0,.44,0,.05));
        g.add(rot(rbox(w*.54,.44,.1,pink,0,.54,bz+.12,.045),-.12));
        g.add(cyl(.045,.05,.2,white,0,.24,0,12));
        const rad=Math.min(w,d)*.32;
        for(let k=0;k<5;k++){const a=k*Math.PI*2/5,x=Math.sin(a)*rad,z=Math.cos(a)*rad;
          g.add(rbox(.16,.045,.07,white,x*.5,.045,z,.02),cyl(.026,.026,.032,blackMetal(),x,.015,z,10));}
        return true;
      }
      case 'monitor': scr(Math.min(w*.9,.5),.38,0,yDesk+.14,bz+.04); return true;
      case 'ultrawide': scr(Math.min(w*.92,.7),.36,0,yDesk+.14,bz+.04); return true;
      case 'dualmon': {
        const sw=Math.min((w-.1)/2,.42);
        scr(sw,.36,-sw/2-.01,yDesk+.14,bz+.04); scr(sw,.36,sw/2+.01,yDesk+.14,bz+.04);
        return true;
      }
      case 'tv': {
        g.add(rbox(w,w*.5,.06,pink,0,1.0,bz,.04));
        const face=box(w*.84,w*.4,.006,paleScreen,0,1.03,bz+.035);face.castShadow=false;g.add(face);
        g.add(rbox(.3,.2,.2,wood,0,.8,0,.04));
        return true;
      }
      case 'pctower': {
        g.add(rbox(w,.5,d,pink,0,.03,0,.05));
        g.add(rbox(w*.9,.42,.012,pink,0,.08,d/2+.002,.02));
        const pane=box(w*.7,.3,.006,glassMat||white,0,.16,d/2+.005);pane.castShadow=false;g.add(pane);
        for(let i=0;i<2;i++) g.add(cyl(.045,.045,.012,blackMetal(),0,.14+i*.13,d/2+.008,14));
        return true;
      }
      case 'sofa': case 'armchair': {
        const n=(f.type==='armchair'||w<1.1)?1:2, cw=(w-.2)/n;
        g.add(rbox(w,.16,d,pink,0,.1,0,.06));
        g.add(rbox(w,.4,.16,pink,0,.1,bz+.08,.06));
        [-1,1].forEach(s=>g.add(rbox(.14,.26,d*.9,pink,s*(w/2-.07),.1,0,.06)));
        for(let i=0;i<n;i++) g.add(rbox(cw-.06,.12,d*.52,fabric('#f6ebe6'),-w/2+.1+cw*(i+.5),.26,.05,.055));
        return true;
      }
      case 'beanbag': {
        // 黏土：浅粉圆饼矮豆
        g.add(blob(w*.34,.2,d*.32,pink,0,.2,0,14));
        g.add(blob(w*.2,.1,d*.16,fabric('#f6ebe6'),0,.26,d*.08,12));
        return true;
      }
      case 'bed': {
        g.add(rbox(w,.24,d-.06,wood,0,.08,.03,.05));
        g.add(rbox(w,.8,.07,wood,0,0,bz+.035,.03));
        g.add(rbox(w-.06,.16,d-.32,white,0,.32,bz+.2,.07));
        g.add(rbox(w*.9,.2,d*.34,pink,0,.33,d/2-.3,.08));
        return true;
      }
      case 'coffeetable': case 'sidetable': {
        const h=f.type==='sidetable'?.4:.32;
        g.add(rbox(w,.06,d,wood,0,h,0,.025));
        g.add(rbox(w*.7,h*.6,d*.7,wood,0,0,0,.02));
        return true;
      }
      case 'rug': {
        g.add(rbox(w,.02,d,pink,0,0,0,.05));
        g.add(rbox(w-.14,.008,d-.14,fabric('#f6ebe6'),0,.02,0,.03));
        return true;
      }
      case 'plant': case 'reed': {
        g.add(blob(.13,.11,.13,wood,0,.1,0,12));
        for(let k=0;k<5;k++){const a=k*1.26;g.add(blob(.05,.14,.03,fabric('#8eae78'),Math.sin(a)*.08,.36,Math.cos(a)*.05,8));}
        return true;
      }
      case 'bookshelf': case 'wallshelf': {
        // 厚板 + 托架
        g.add(rbox(w,.07,Math.max(d,.2),wood,0,1.25,0,.03));
        [-1,1].forEach(s=>g.add(rbox(.06,.14,.06,wood,s*(w/2-.1),1.1,0,.02)));
        for(let i=0;i<3;i++) g.add(rbox(.05,.16,.12,pink,-w*.2+i*.12,1.32,0,.015));
        return true;
      }
      case 'wardrobe': case 'cabinet': case 'shoecab': case 'figurecab': case 'drawerchest': case 'tvstand': {
        const h=f.type==='figurecab'?1.5:.62;
        g.add(rbox(w,h,d,pink,0,0,0,.05));
        g.add(rbox(w+.02,.05,d+.02,white,0,h,0,.02));
        const n=Math.max(1,Math.round(w/.4));
        for(let i=0;i<n;i++) g.add(box(w/n-.03,.012,.012,wood,-w/2+w/n*(i+.5),.4+i*0,d/2+.005));
        return true;
      }
      case 'pegboard': {
        g.add(rbox(w,.8,.06,wood,0,1.0,bz,.03));
        for(let i=0;i<5;i++) for(let j=0;j<3;j++) g.add(cyl(.02,.02,.03,wood,-w/2+w*(i+.5)/5,1.0+j*.18,bz+.04,10));
        g.add(rbox(w*.36,.05,.16,wood,-w*.18,1.1,bz+.12,.02));
        return true;
      }
      case 'acoustic': case 'painting': {
        g.add(rbox(w,.45,.04,wood,0,1.3,bz,.02));
        g.add(box(w*.8,.32,.01,white,0,1.32,bz+.025));
        return true;
      }
      case 'wallcloth': {g.add(rbox(w,.6,.02,fabric('#f6ebe6'),0,1.2,bz,.02));return true;}
      case 'curtain': {
        g.add(rod([-w/2,2.0,bz],[w/2,2.0,bz],.015,wood));
        for(let i=0;i<3;i++) g.add(rbox(w/3*.85,1.3,.05,fabric('#f6ebe6'),-w/2+w/3*(i+.5),.65,bz,.03));
        return true;
      }
      case 'clock': {
        g.add(cyl(.19,.19,.05,wood,0,1.55,bz,20));
        g.add(cyl(.05,.05,.055,white,0,1.55,bz+.005,16));
        g.add(box(.014,.09,.008,blackMetal(),0,1.55,bz+.035),box(.06,.014,.008,blackMetal(),.02,1.55,bz+.035));
        return true;
      }
      case 'guitar': {
        // sooah 全景无吉他，给一把矮胖黏土琴，保证切换不断层
        g.add(blob(w*.3,.07,d*.3,wood,0,.2,0,12));
        g.add(rbox(.05,.8,.04,wood,0,.35,d*.1,.02));
        return true;
      }
      case 'piano': {
        // 浅紫琴身 + 琴键 + 铬X架
        g.add(rbox(w,.16,d*.4,purple,0,.66,0,.04));
        const keys=Math.max(8,Math.round(w/.05));
        for(let i=0;i<keys;i++) g.add(box((w*.84)/keys-.005,.025,.13,i%7===2||i%7===6?blackMetal():white,-w*.42+(w*.84)*(i+.5)/keys,.82,d*.06));
        [-1,1].forEach(s=>g.add(rod([s*w*.3,0,-.05],[-s*w*.3,.66,.05],.014,chrome())));
        return true;
      }
      case 'stool': {
        g.add(cyl(w*.36,w*.34,.09,wood,0,.32,0,16));
        for(let k=0;k<3;k++){const a=k*2.09;g.add(rod([Math.sin(a)*w*.2,0,Math.cos(a)*w*.2],[Math.sin(a)*w*.12,.32,Math.cos(a)*w*.12],.028,wood,.032));}
        return true;
      }
      case 'fishtank': {
        const ball=blob(w*.3,w*.3,d*.3,glassMat||white,0,.32,0,20); ball.castShadow=false; g.add(ball);
        g.add(blob(w*.2,w*.2,d*.2,blue,0,.3,0,14));
        g.add(blob(.035,.025,.02,purple,.05,.32,.05,8));
        g.add(cyl(w*.24,w*.26,.05,wood,0,0,0,14));
        return true;
      }
      case 'flowerbasket': {
        g.add(cyl(.1,.085,.13,wood,0,0,0,12));
        g.add(blob(.055,.06,.055,pink,-.03,.2,0,8),blob(.045,.05,.045,fabric('#f6ebe6'),.04,.18,.02,8));
        return true;
      }
      case 'plush': {
        g.add(blob(w*.3,.26,d*.3,pink,0,.26,0,14));
        [-1,1].forEach(s=>g.add(blob(.06,.05,.06,fabric('#e05a6a'),s*w*.12,.06,.08,10)));
        g.add(blob(.09,.07,.02,white,0,.3,d*.24,12));
        return true;
      }
      case 'keyboard': {
        g.add(rbox(w,.03,d,purple,0,yDesk,0,.012));
        for(let r=0;r<3;r++) for(let i=0;i<8;i++) g.add(rbox(.028,.012,.02,white,-w*.36+i*(w*.72/8),yDesk+.03,-d*.25+r*d*.25,.004));
        return true;
      }
      case 'mouse': g.add(blob(.04,.028,.055,pink,0,yDesk+.028,0,10)); return true;
      case 'mousepad': g.add(rbox(w,.012,d,pink,0,yDesk,0,.008)); return true;
      case 'phone': {
        g.add(rbox(w,.02,d,pink,0,yDesk,0,.01));
        const face=box(w*.76,.006,d*.66,paleScreen,0,yDesk+.02,0);face.castShadow=false;face.userData.screen=true;g.add(face);
        return true;
      }
      case 'penholder': g.add(cyl(w*.28,w*.26,.1,white,0,yDesk,0,12)); return true;
      case 'organizer': {g.add(rbox(w,.2,.12,pink,0,yDesk,0,.025));return true;}
      case 'deskset': {
        g.add(cyl(.04,.035,.11,white,-w*.2,yDesk,0,12));
        g.add(blob(.03,.03,.03,mat('#6b4a35',{roughness:.8}),-w*.2,yDesk+.11,0,8));
        g.add(rbox(.14,.02,.1,purple,w*.12,yDesk,0,.008));
        return true;
      }
      case 'slippers': {[-1,1].forEach(s=>g.add(rbox(w*.3,.04,d*.66,pink,s*w*.22,0,0,.018)));return true;}
      case 'underbox': {g.add(rbox(w,.14,d,wood,0,0,0,.03));return true;}
      case 'plaque': {
        // 横杆 + 三块厚牌
        g.add(rod([-w*.4,1.35,bz],[w*.4,1.5,bz],.018,wood));
        for(let i=0;i<3;i++) g.add(rbox(w*.5,.14,.05,wood,0,1.02+i*.2,bz+.02,.03));
        return true;
      }
      case 'shelfdecor': {
        [.0,.12,.24].forEach((t,i)=>g.add(rbox(.07,.07,.07,i===1?purple:white,-w*.2+t,yDesk,0,.02)));
        return true;
      }
      case 'controldeck': {
        g.add(rbox(w,.03,d,purple,0,yDesk,0,.012));
        for(let i=0;i<4;i++) g.add(cyl(.012,.012,.01,blackMetal(),-w*.3+w*.6*(i+.5)/4,yDesk+.03,0,8));
        return true;
      }
      case 'books': {for(let i=0;i<3;i++) g.add(rbox(.06,.15,.12,i%2?white:pink,-.06+i*.07,yDesk,0,.012));return true;}
      case 'camera': {g.add(rbox(w*.6,.07,d*.5,pink,0,yDesk,0,.02));return true;}
      case 'controller': {g.add(rbox(w*.4,.04,d*.32,pink,0,yDesk,0,.015));[-1,1].forEach(s=>g.add(blob(.05,.03,.07,pink,s*w*.24,yDesk+.02,.03,8)));return true;}
      case 'desklamp': {
        // 浅蓝小台灯
        g.add(cyl(.07,.08,.03,white,0,yDesk,0,12));
        g.add(rod([0,yDesk,0],[0,yDesk+.2,0],.014,white));
        g.add(blob(.07,.06,.07,blue,0,yDesk+.26,0,12));
        const gl=blob(.03,.02,.03,glowMat('#fff','#ffb84a',1),0,yDesk+.24,.04,8);gl.castShadow=false;g.add(gl);
        return true;
      }
      case 'floorlamp': {
        g.add(cyl(.09,.1,.03,white,0,0,0,12));
        g.add(rod([0,0,0],[0,1.1,0],.016,white));
        g.add(blob(.1,.09,.1,blue,0,1.18,0,14));
        return true;
      }
      case 'micarm': {
        g.add(cyl(.04,.045,.04,white,-w*.2,yDesk,bz,10));
        g.add(tube([[-w*.2,yDesk+.02,bz],[0,yDesk+.18,0],[w*.1,yDesk+.14,.06]],.012,blackMetal()));
        g.add(blob(.035,.045,.035,blackMetal(),w*.1,yDesk+.14,.06,10));
        return true;
      }
      case 'headset': {
        g.add(tube([[-w*.28,yDesk+.02,0],[0,yDesk+.16,0],[w*.28,yDesk+.02,0]],.016,pink));
        [-1,1].forEach(s=>g.add(blob(.05,.06,.045,pink,s*w*.28,yDesk+.04,0,10)));
        return true;
      }
      case 'ledbar': {
        // 串灯：一根垂线 + 暖黄小球
        g.add(tube([[-w/2,2.0,bz],[0,1.85,bz],[w/2,2.0,bz]],.006,blackMetal()));
        for(let i=0;i<5;i++){const x=-w/2+w*(i+.5)/5;g.add(cyl(.004,.004,.06,blackMetal(),x,1.92,bz,6));
          const b=blob(.02,.025,.02,glowMat('#fff','#ffb84a',1),x,1.88,bz,8);b.castShadow=false;g.add(b);}
        return true;
      }
      case 'deskspeaker': {g.add(rbox(w,.13,d,purple,0,yDesk,0,.025));return true;}
      case 'console': {g.add(rbox(w,.06,d,purple,0,yDesk,0,.015));return true;}
      case 'milktea': {
        g.add(cyl(.04,.035,.1,white,0,yDesk,0,12));
        g.add(cyl(.045,.045,.02,wood,0,yDesk+.1,0,12));
        g.add(blob(.012,.012,.012,mat('#6b4a35',{roughness:.8}),0,yDesk+.05,.02,6));
        return true;
      }
      case 'egg': {g.add(blob(.035,.05,.035,white,0,yDesk+.05,0,12));g.add(cyl(.05,.055,.015,wood,0,yDesk,0,10));return true;}
      case 'cubes': {[.0,.12,.24].forEach((t,i)=>g.add(rbox(.06,.06,.06,i===1?purple:wood,-w*.2+t,yDesk,0,.018)));return true;}
      case 'rock': {g.add(blob(w*.22,.09,d*.16,fabric('#d9d0c4'),0,.07,0,10));return true;}
      case 'reed': {for(let k=0;k<3;k++) g.add(blob(.025,.13,.025,fabric('#8eae78'),-.04+k*.04,.16,0,8));return true;}
      case 'fridge': case 'aircon': case 'acwall': case 'purifier': case 'cylindricalaircon': case 'treadmill': {
        if(f.type==='acwall'){g.add(rbox(w,.18,.12,fabric('#f6ebe6'),0,2.1,bz,.03));return true;}
        if(f.type==='cylindricalaircon'){g.add(cyl(w*.36,w*.34,1.5,fabric('#f6ebe6'),0,0,0,16));return true;}
        if(f.type==='treadmill'){g.add(rbox(w,.07,d*.7,wood,0,.06,d*.05,.025));[-1,1].forEach(s=>g.add(rbox(.04,.8,.05,wood,s*w*.32,.06,0,.015)));return true;}
        const h=f.type==='fridge'?1.6:f.type==='aircon'?1.45:f.type==='purifier'?.55:1.0;
        g.add(rbox(w,h,d,fabric('#f6ebe6'),0,0,0,.04));
        return true;
      }
      default: return false;
    }
  }
  window.drawSooah = drawSooah;
})();
