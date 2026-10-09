(() => {
  'use strict';
  const LEVELS = [
    { id:'01-encore', name:'紫色安可', detail:'白 T 恤 · 紫色闪钻工装裤', radius:23, color:'#ac87df' },
    { id:'02-jersey', name:'蓝色球衣', detail:'天蓝球衣 · 银色闪钻', radius:31, color:'#70b9e6' },
    { id:'03-denim', name:'丹宁少女', detail:'棕色马甲 · 牛仔层叠裙', radius:40, color:'#9d9cce' },
    { id:'04-rock', name:'白色摇滚', detail:'白色工装 · 电吉他', radius:49, color:'#bdc6db' },
    { id:'05-camo', name:'迷彩酷野', detail:'闪钻迷彩 · 电吉他', radius:60, color:'#9fa873' },
    { id:'06-duchess', name:'白色女爵', detail:'白金刺绣 · 流苏肩章', radius:73, color:'#d4bd82' },
    { id:'07-glory', name:'黑金荣耀', detail:'黑金战袍 · 皇家刺绣', radius:88, color:'#c89754' },
    { id:'08-bride', name:'灰烬婚纱', detail:'不对称白纱 · 灰烬痕迹', radius:105, color:'#c6a8df' }
  ];
  const W=440, H=660, LEFT=12, RIGHT=428, FLOOR=632, LINE=126, STEP=1000/60;
  const $=id=>document.getElementById(id);
  const canvas=$('game-canvas'), ctx=canvas.getContext('2d');
  let canvasPixelRatio=0;
  const assets=window.GLORIA_ASSETS||{};
  const images=LEVELS.map(()=>new Image());
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store={
    read(key,fallback){try{const v=JSON.parse(localStorage.getItem('gloria-'+key));return v??fallback;}catch{return fallback;}},
    write(key,value){try{localStorage.setItem('gloria-'+key,JSON.stringify(value));}catch{/* Storage may be unavailable for local files. */}}
  };
  let best=Number(store.read('best',0))||0;
  const savedUnlocked=store.read('unlocked',[0]);
  let unlocked=new Set((Array.isArray(savedUnlocked)?savedUnlocked:[0]).filter(n=>Number.isInteger(n)&&n>=0&&n<8));
  unlocked.add(0);
  let engine, bodies=[], pendingMerges=new Map(), particles=[], labels=[];
  let ready=false, score=0, current=0, next=0, aim=W/2;
  let paused=false, over=false, won=false, celebrating=false, dropped=false;
  let simulationTime=0, dropReadyAt=0, dangerTime=0, lastMergeAt=-Infinity, combo=0;
  let lastFrame=0, accumulator=0, touchId=null, messageTimer;
  let soundOn=Boolean(store.read('sound',false)), audio;
  const modalPauseReasons=new Set();
  const soundNotes=[392,440,494,523.25,587.33,659.25,783.99,1046.5];

  function screenPixelRatio(){return Math.min(4,Math.max(1,window.devicePixelRatio||1));}
  function syncCanvasResolution(){
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const ratio=screenPixelRatio();
    const width=Math.round(rect.width*ratio),height=Math.round(rect.height*ratio);
    if(canvas.width!==width||canvas.height!==height){
      canvas.width=width;canvas.height=height;
    }
    // Physics and input stay in the original 440×660 world; pixels match the screen.
    ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    canvasPixelRatio=ratio;
  }
  syncCanvasResolution();
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(syncCanvasResolution).observe(canvas);
  addEventListener('resize',syncCanvasResolution,{passive:true});

  function source(i){return assets[LEVELS[i].id]||'assets/characters/'+LEVELS[i].id+'.png';}
  function announce(text){$('announcer').textContent=text;}
  function updateScore(){
    if(score>best){best=score;store.write('best',best);}
    for(const id of ['score','mobile-score'])$(id).textContent=score;
    for(const id of ['best','mobile-best'])$(id).textContent=best;
  }
  function updateCollection(){
    $('collection-count').textContent=unlocked.size+' / 8';
    document.querySelectorAll('.look-card').forEach((card,i)=>{
      card.classList.toggle('unlocked',unlocked.has(i));
      card.querySelector('.look-status').textContent=unlocked.has(i)?'✧':'·';
      card.setAttribute('aria-label',`${i+1} 级 ${LEVELS[i].name}${unlocked.has(i)?'，已解锁':''}，查看素材`);
    });
  }
  function buildCollection(){
    $('lookbook').innerHTML=LEVELS.map((l,i)=>`<button class="look-card ${i===7?'final':''}" data-level="${i}"><span class="look-index">${String(i+1).padStart(2,'0')}</span><span class="look-status">·</span><img src="${source(i)}" alt="${l.name} Q 版" draggable="false"><span class="look-name">${l.name}</span></button>`).join('');
    $('gallery-grid').innerHTML=LEVELS.map((l,i)=>`<article class="gallery-item" id="gallery-look-${i}"><img src="${source(i)}" alt="${l.name}大头小身子透明底 Q 版角色" loading="lazy"><h3>${String(i+1).padStart(2,'0')} · ${l.name}</h3><p>${l.detail}</p><a class="download-link" href="${source(i)}" download="${l.id}.png">下载透明 PNG</a></article>`).join('');
    document.querySelectorAll('[data-character]').forEach(img=>{img.src=source(Number(img.dataset.character));});
    updateCollection();
    document.querySelectorAll('.look-card').forEach(card=>card.addEventListener('click',()=>{
      openDialog('gallery-dialog');
      const target=$('gallery-look-'+card.dataset.level);
      target.scrollIntoView({block:'nearest',behavior:reduced?'auto':'smooth'});
    }));
  }
  function updateNext(){
    $('next-img').src=source(next);
    $('next-img').alt='下一位：'+LEVELS[next].name;
    $('next-name').textContent=LEVELS[next].name;
  }
  function chooseNext(){
    // A bag guarantees every initial drop is pairable while still feeling random.
    if(!dropBag.length){
      dropBag=[0,0,0,0,1,1,2,2];
      for(let i=dropBag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[dropBag[i],dropBag[j]]=[dropBag[j],dropBag[i]];}
    }
    return dropBag.pop();
  }
  let dropBag=[];
  function initializePhysics(){
    const {Engine,Bodies,Composite,Events}=Matter;
    engine=Engine.create({positionIterations:10,velocityIterations:8,enableSleeping:true});
    engine.gravity.y=1.3;
    Composite.add(engine.world,[
      Bodies.rectangle(LEFT-30,H/2,60,H+300,{isStatic:true,label:'wall',friction:.3}),
      Bodies.rectangle(RIGHT+30,H/2,60,H+300,{isStatic:true,label:'wall',friction:.3}),
      Bodies.rectangle(W/2,FLOOR+30,W+100,60,{isStatic:true,label:'floor',friction:.4})
    ]);
    const collect=event=>{
      for(const pair of event.pairs){
        const a=pair.bodyA, b=pair.bodyB;
        if(!a.plugin.gloria||!b.plugin.gloria)continue;
        const aa=a.plugin.gloria, bb=b.plugin.gloria;
        if(aa.level===bb.level&&aa.level<7){
          const key=a.id<b.id?a.id+':'+b.id:b.id+':'+a.id;
          pendingMerges.set(key,[a,b]);
        }
      }
    };
    Events.on(engine,'collisionStart collisionActive',collect);
  }
  function createBody(level,x,y,velocity={x:0,y:0}){
    const l=LEVELS[level];
    const body=Matter.Bodies.circle(x,y,l.radius,{restitution:.19,friction:.24,frictionStatic:.8,frictionAir:.006,density:.0018,slop:.2,sleepThreshold:90});
    body.plugin.gloria={level,born:simulationTime,overLine:0,merged:false};
    Matter.Body.setVelocity(body,velocity);
    // Circle collisions roll naturally. Keep the character art gently tilting for readability.
    Matter.Composite.add(engine.world,body);bodies.push(body);
    return body;
  }
  function mergePairs(){
    if(!pendingMerges.size)return;
    const pairs=[...pendingMerges.values()];pendingMerges.clear();
    const active=new Set(bodies);
    for(const [a,b] of pairs){
      if(!active.has(a)||!active.has(b))continue;
      const ga=a.plugin.gloria, gb=b.plugin.gloria;
      if(ga.merged||gb.merged||ga.level!==gb.level||ga.level>=7)continue;
      ga.merged=gb.merged=true;active.delete(a);active.delete(b);
      const level=ga.level+1, radius=LEVELS[level].radius;
      const x=Math.max(LEFT+radius,Math.min(RIGHT-radius,(a.position.x+b.position.x)/2));
      const y=Math.min(FLOOR-radius,(a.position.y+b.position.y)/2);
      const velocity={x:(a.velocity.x+b.velocity.x)*.25,y:Math.min(0,(a.velocity.y+b.velocity.y)*.25)-.55};
      Matter.Composite.remove(engine.world,[a,b]);
      bodies=bodies.filter(body=>body!==a&&body!==b);
      const merged=createBody(level,x,y,velocity);active.add(merged);
      combo=simulationTime-lastMergeAt<1300?combo+1:1;lastMergeAt=simulationTime;
      const points=2**(level+1);score+=points;updateScore();
      labels.push({x,y:y-radius*.3,text:'+'+points,life:950,total:950,color:LEVELS[level].color});
      burst(x,y,LEVELS[level].color,level>=6?24:12);
      playSound(level);
      if(!unlocked.has(level)){
        unlocked.add(level);store.write('unlocked',[...unlocked]);updateCollection();
        message('解锁 · '+LEVELS[level].name);announce('合成'+LEVELS[level].name+'，获得'+points+'分');
      }else if(combo>=3)message('✦ '+combo+' 连合成');
      if(level===7&&!won){
        won=true;celebrating=true;
        for(let k=0;k<6;k++)burst(50+Math.random()*340,80+Math.random()*350,['#d1afe9','#e8ba67','#8ccdec'][k%3],20);
        $('win-overlay').hidden=false;announce('恭喜合成灰烬婚纱，你就是那束光');
      }
    }
  }
  function hasPaused(){return paused||over||celebrating||modalPauseReasons.size>0;}
  function drop(){
    if(!ready||hasPaused()||simulationTime<dropReadyAt)return false;
    const radius=LEVELS[current].radius;
    aim=Math.max(LEFT+radius+1,Math.min(RIGHT-radius-1,aim));
    // Do not create an overlapping object in a crowded spawn area.
    if(bodies.some(b=>Math.hypot(b.position.x-aim,b.position.y-60)<radius+b.circleRadius-2)){
      message('换个空一点的位置吧');return false;
    }
    createBody(current,aim,60,{x:0,y:1.2});
    current=next;next=chooseNext();updateNext();
    dropReadyAt=simulationTime+470;
    dropped=true;$('empty-hint').hidden=true;
    playSound(-1);
    return true;
  }
  function reset(){
    if(!engine)return;
    for(const body of bodies)Matter.Composite.remove(engine.world,body);
    Matter.Engine.clear(engine);
    bodies=[];particles=[];labels=[];pendingMerges.clear();
    score=0;simulationTime=0;dangerTime=0;dropReadyAt=0;lastMergeAt=-Infinity;combo=0;
    over=false;paused=false;won=false;celebrating=false;dropped=false;dropBag=[];aim=W/2;
    current=0;next=0;updateNext();updateScore();
    $('empty-hint').hidden=false;
    for(const id of ['pause-overlay','over-overlay','win-overlay'])$(id).hidden=true;
    updatePauseButton();
    clearTimeout(messageTimer);$('stage-message').classList.remove('visible');
  }
  function updatePauseButton(){
    $('pause-btn').setAttribute('aria-label',paused?'继续游戏':'暂停游戏');
    $('pause-btn').title=paused?'继续游戏':'暂停游戏';
    $('pause-btn').innerHTML=paused?'<svg viewBox="0 0 24 24" fill="currentColor"><path d="m8 4 12 8-12 8Z"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 5v14M16 5v14"/></svg>';
  }
  function setPause(value){
    if(!ready||over||celebrating)return;
    paused=value;$('pause-overlay').hidden=!value;updatePauseButton();
    if(value&&audio)audio.suspend().catch(()=>{});
    else if(audio&&soundOn)audio.resume().catch(()=>{});
  }
  function checkDanger(dt){
    let endangered=false;
    for(const body of bodies){
      const g=body.plugin.gloria;
      // Newly falling or freshly merged characters receive a spawn grace period.
      const above=simulationTime-g.born>1600&&body.position.y-body.circleRadius<LINE;
      g.overLine=above?g.overLine+dt:0;
      if(above)endangered=true;
      if(g.overLine>=2000){
        over=true;$('over-overlay').hidden=false;$('final-score').textContent=score;
        announce('本场演出结束，得分'+score);break;
      }
    }
    dangerTime=endangered?dangerTime+dt:0;
  }
  function message(text){
    clearTimeout(messageTimer);$('stage-message').textContent=text;$('stage-message').classList.add('visible');
    messageTimer=setTimeout(()=>$('stage-message').classList.remove('visible'),1700);
  }
  function burst(x,y,color,count){
    if(reduced)return;
    for(let i=0;i<count;i++){
      const angle=Math.random()*Math.PI*2,speed=40+Math.random()*100;
      particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-35,size:2+Math.random()*4,life:600+Math.random()*400,total:1000,color,rotation:Math.random()*Math.PI});
    }
  }
  function effectStep(dt){
    for(const p of particles){p.life-=dt;p.x+=p.vx*dt/1000;p.y+=p.vy*dt/1000;p.vy+=130*dt/1000;}
    particles=particles.filter(p=>p.life>0);
    for(const label of labels){label.life-=dt;label.y-=25*dt/1000;}
    labels=labels.filter(label=>label.life>0);
  }
  function makeStar(x,y,r,color,opacity=1){
    ctx.save();ctx.globalAlpha=opacity;ctx.fillStyle=color;ctx.beginPath();
    ctx.moveTo(x,y-r);ctx.quadraticCurveTo(x+1,y-1,x+r,y);ctx.quadraticCurveTo(x+1,y+1,x,y+r);ctx.quadraticCurveTo(x-1,y+1,x-r,y);ctx.quadraticCurveTo(x-1,y-1,x,y-r);ctx.fill();ctx.restore();
  }
  function drawCharacter(level,x,y,r,angle=0,opacity=1,scale=1){
    const img=images[level];if(!img.complete||!img.naturalWidth)return;
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.globalAlpha=opacity;
    const edge=r*2.12*scale,ratio=img.naturalWidth/img.naturalHeight;
    const height=edge, width=edge*ratio;
    ctx.drawImage(img,-width/2,-height/2,width,height);ctx.restore();
  }
  function render(time){
    // Browser zoom or a different monitor can change density without a CSS resize.
    if(canvasPixelRatio!==screenPixelRatio())syncCanvasResolution();
    ctx.clearRect(0,0,W,H);
    // Small concert lights and a grounded floor, behind all gameplay sprites.
    const glow=ctx.createRadialGradient(W/2,602,12,W/2,602,230);
    glow.addColorStop(0,'#ceb7e838');glow.addColorStop(1,'#ceb7e800');ctx.fillStyle=glow;ctx.fillRect(0,380,W,280);
    ctx.fillStyle='#cfb9e822';ctx.beginPath();ctx.ellipse(W/2,640,175,18,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#d7c3e8';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(LEFT,FLOOR);ctx.lineTo(RIGHT,FLOOR);ctx.stroke();
    ctx.fillStyle='#b79bcd';ctx.font='9px "Segoe UI",sans-serif';ctx.textAlign='center';ctx.fillText('I A M G L O R I A',W/2,652);
    [[44,224,4],[383,196,5],[66,435,3],[375,486,4],[304,357,3],[112,317,2]].forEach(([x,y,s],i)=>makeStar(x,y,s,'#d3bdea',reduced?.4:.3+Math.sin(time/1200+i)*.15));
    const danger=dangerTime>0;
    ctx.save();ctx.setLineDash([5,6]);ctx.strokeStyle=danger?'#d985a5':'#d8c4e9';ctx.lineWidth=danger?1.7:1;
    ctx.beginPath();ctx.moveTo(25,LINE);ctx.lineTo(W-25,LINE);ctx.stroke();ctx.setLineDash([]);
    ctx.font='10px "Microsoft YaHei",sans-serif';ctx.textAlign='right';ctx.fillStyle=danger?'#c37292':'#c1a9d0';ctx.fillText(danger?'小心，舞台快满了':'警戒线',W-23,LINE-10);ctx.restore();
    if(danger){ctx.fillStyle='#e8b2c518';ctx.fillRect(0,LINE,W,20);}
    for(const body of bodies){
      const g=body.plugin.gloria;
      const age=simulationTime-g.born;
      const tilt=Math.sin(body.angle)*.28;
      const bounce=age<190&&!reduced?1+Math.sin(age/190*Math.PI)*.14:1;
      drawCharacter(g.level,body.position.x,body.position.y,body.circleRadius,tilt,1,bounce);
    }
    if(ready&&!over&&!celebrating){
      const r=LEVELS[current].radius;
      aim=Math.max(LEFT+r+1,Math.min(RIGHT-r-1,aim));
      if(!hasPaused()&&simulationTime>=dropReadyAt){
        let landing=FLOOR-r;
        for(const b of bodies){
          const dx=b.position.x-aim,sum=r+b.circleRadius;
          if(Math.abs(dx)<sum){const y=b.position.y-Math.sqrt(sum*sum-dx*dx);if(y>=60)landing=Math.min(landing,y);}
        }
        ctx.save();ctx.strokeStyle='#b89bd344';ctx.setLineDash([3,8]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(aim,60+r+9);ctx.lineTo(aim,Math.max(60+r,landing-r));ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='#b599d927';ctx.beginPath();ctx.ellipse(aim,Math.min(FLOOR,landing+r),r*.65,3,0,0,Math.PI*2);ctx.fill();ctx.restore();
      }
      drawCharacter(current,aim,60,r,0,simulationTime<dropReadyAt?.35:.9);
      ctx.fillStyle='#af93cb';ctx.beginPath();ctx.moveTo(aim-3,13);ctx.lineTo(aim+3,13);ctx.lineTo(aim,17);ctx.fill();
    }
    for(const p of particles)makeStar(p.x,p.y,p.size,p.color,Math.min(1,p.life/250));
    for(const label of labels){ctx.save();ctx.globalAlpha=Math.min(1,label.life/250);ctx.font='bold 20px "Segoe UI",sans-serif';ctx.textAlign='center';ctx.fillStyle=label.color;ctx.fillText(label.text,label.x,label.y);ctx.restore();}
  }
  function frame(time){
    if(!lastFrame)lastFrame=time;
    const dt=Math.min(80,time-lastFrame);lastFrame=time;
    if(ready&&!hasPaused()&&!document.hidden){
      accumulator+=dt;
      while(accumulator>=STEP){
        simulationTime+=STEP;Matter.Engine.update(engine,STEP);mergePairs();checkDanger(STEP);effectStep(STEP);accumulator-=STEP;
        if(hasPaused()){accumulator=0;break;}
      }
    }else accumulator=0;
    render(time);requestAnimationFrame(frame);
  }
  function ensureAudio(){
    if(!soundOn)return;
    try{if(!audio)audio=new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{/* The game remains usable without audio. */}
  }
  function playSound(level){
    if(!soundOn||!audio||audio.state!=='running')return;
    const start=audio.currentTime, duration=level<0?.08:.23;
    const frequency=level<0?260:soundNotes[level];
    [1,level<0?1:1.5].slice(0,level<0?1:2).forEach((ratio,i)=>{
      const oscillator=audio.createOscillator(),gain=audio.createGain();
      oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency*ratio,start+i*.045);
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.055,start+.01+i*.045);gain.gain.exponentialRampToValueAtTime(.001,start+duration+i*.045);
      oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(start+i*.045);oscillator.stop(start+duration+i*.045);
    });
  }
  function updateSoundButton(){
    $('sound-btn').setAttribute('aria-pressed',String(soundOn));$('sound-btn').setAttribute('aria-label',soundOn?'关闭音效':'开启音效');$('sound-btn').title=soundOn?'关闭音效':'开启音效';
    $('sound-path').setAttribute('d',soundOn?'M15 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14':'m16 9 5 6m0-6-5 6');
  }
  function openDialog(id){
    const dialog=$(id);if(dialog.open)return;
    modalPauseReasons.add(id);dialog.showModal();
  }
  function updateAim(event){
    const rect=canvas.getBoundingClientRect();aim=(event.clientX-rect.left)/rect.width*W;
  }
  canvas.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'||touchId===event.pointerId)updateAim(event);});
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0||!ready||hasPaused())return;
    ensureAudio();updateAim(event);canvas.focus({preventScroll:true});
    if(event.pointerType==='mouse')drop();
    else{touchId=event.pointerId;canvas.setPointerCapture(event.pointerId);}
  });
  canvas.addEventListener('pointerup',event=>{
    if(touchId===event.pointerId){updateAim(event);drop();touchId=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}
  });
  canvas.addEventListener('pointercancel',()=>{touchId=null;});
  document.addEventListener('keydown',event=>{
    if(event.target.matches('button,a,input,select,textarea')||document.querySelector('dialog[open]'))return;
    if(['ArrowLeft','ArrowRight',' ','Enter'].includes(event.key)){
      event.preventDefault();if(hasPaused())return;
      if(event.key==='ArrowLeft')aim-=14;if(event.key==='ArrowRight')aim+=14;
      if(!event.repeat&&(event.key===' '||event.key==='Enter')){ensureAudio();drop();}
    }else if(event.key.toLowerCase()==='p'&&!event.repeat)setPause(!paused);
  });
  document.addEventListener('visibilitychange',()=>{lastFrame=0;if(document.hidden&&ready&&!over&&!celebrating)setPause(true);});
  $('pause-btn').addEventListener('click',()=>setPause(!paused));
  $('resume-btn').addEventListener('click',()=>{setPause(false);canvas.focus({preventScroll:true});});
  $('restart-btn').addEventListener('click',()=>{if(!ready)return;if(!dropped||over)reset();else openDialog('restart-dialog');});
  $('confirm-restart').addEventListener('click',()=>{$('restart-dialog').close();reset();canvas.focus({preventScroll:true});});
  $('again-btn').addEventListener('click',()=>{reset();canvas.focus({preventScroll:true});});
  $('continue-btn').addEventListener('click',()=>{celebrating=false;$('win-overlay').hidden=true;canvas.focus({preventScroll:true});});
  $('sound-btn').addEventListener('click',()=>{soundOn=!soundOn;store.write('sound',soundOn);updateSoundButton();ensureAudio();if(!soundOn&&audio)audio.suspend().catch(()=>{});});
  $('help-btn').addEventListener('click',()=>openDialog('help-dialog'));
  $('gallery-btn').addEventListener('click',()=>openDialog('gallery-dialog'));
  document.querySelectorAll('dialog').forEach(dialog=>{
    dialog.addEventListener('close',()=>modalPauseReasons.delete(dialog.id));
    dialog.querySelectorAll('.dialog-dismiss,.modal-close').forEach(button=>button.addEventListener('click',()=>dialog.close()));
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  });
  if(matchMedia('(pointer:coarse)').matches){$('input-tip').textContent='拖动瞄准，松手投放';$('empty-hint').querySelector('p').textContent='拖动瞄准 · 松手投放';}
  async function loadImages(){
    $('retry-assets').hidden=true;
    try{
      if(!window.Matter)throw new Error('物理引擎尚未加载，请确认游戏文件完整。');
      await Promise.all(images.map((img,i)=>new Promise((resolve,reject)=>{
        img.onload=resolve;img.onerror=()=>reject(new Error('角色素材加载失败，请确认 assets 文件夹完整。'));img.src=source(i);
      })));
      if(!engine)initializePhysics();
      ready=true;$('loading').hidden=true;reset();
    }catch(error){$('loading').querySelector('p').textContent=error.message;$('retry-assets').hidden=false;}
  }
  $('retry-assets').addEventListener('click',loadImages);
  buildCollection();updateScore();updateSoundButton();requestAnimationFrame(frame);loadImages();
  // Optional structured browser actions share the normal gameplay state.
  if(document.modelContext?.registerTool){
    const lifecycle=new AbortController();
    const readState=()=>({ready,score,best,current:LEVELS[current].name,next:LEVELS[next].name,paused:hasPaused(),over,won,characters:bodies.length,canDrop:ready&&!hasPaused()&&simulationTime>=dropReadyAt});
    const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Unsupported registration leaves normal controls available. */}};
    register({name:'read_gloria_game',title:'查看合成游戏状态',description:'Read the current score, upcoming costumes, pause state and whether a character can be dropped.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>readState()});
    register({name:'drop_gloria_character',title:'投放一只小紫棋',description:'Drop the current character at a horizontal position from 0 (left) to 1 (right), using the same cooldown and pause rules as touch or mouse input.',inputSchema:{type:'object',properties:{position:{type:'number',minimum:0,maximum:1}},required:['position'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:input=>{
      if(!input||typeof input.position!=='number'||!Number.isFinite(input.position)||input.position<0||input.position>1||Object.keys(input).some(k=>k!=='position'))throw new Error('position must be a number between 0 and 1.');
      if(!ready||hasPaused()||simulationTime<dropReadyAt)throw new Error('The game is loading, paused, finished or waiting for the next drop.');
      const oldAim=aim;aim=input.position*W;
      if(!drop()){aim=oldAim;throw new Error('There is no room to drop at this position.');}
      return {dropped:true,...readState()};
    }});
    addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  }
  // A deterministic debug surface is opt-in and unavailable in the normal game.
  if(new URLSearchParams(location.search).has('debug')){
    window.__gloria={
      levels:LEVELS,drop,reset,createBody,engine:()=>engine,
      aim:x=>{aim=x;},current:level=>{current=level;},pause:setPause,
      snapshot:()=>({ready,score,best,current,next,paused,over,won,celebrating,simulationTime,dangerTime,unlocked:[...unlocked],bodies:bodies.map(b=>({id:b.id,level:b.plugin.gloria.level,x:b.position.x,y:b.position.y,r:b.circleRadius,born:b.plugin.gloria.born,overLine:b.plugin.gloria.overLine}))}),
      advance:count=>{for(let i=0;i<count&&!hasPaused();i++){simulationTime+=STEP;Matter.Engine.update(engine,STEP);mergePairs();checkDanger(STEP);effectStep(STEP);}},
      freeze:()=>{modalPauseReasons.add('test');},unfreeze:()=>{modalPauseReasons.delete('test');},
      age:ms=>{bodies.forEach(b=>{b.plugin.gloria.born=simulationTime-ms;});}
    };
  }
})();
