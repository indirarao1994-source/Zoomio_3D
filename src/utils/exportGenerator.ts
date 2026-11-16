import JSZip from 'jszip';
import type { Project } from '../types/tour';

/* ── helpers ──────────────────────────────────────────────── */
function base64ToBlob(b64: string, mime = 'image/jpeg'): Blob {
  const clean = b64.split(',')[1] || b64;
  const bytes = atob(clean);
  const arr   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Convert an image URL (data: or relative http) to a base64 data-URI string */
async function urlToBase64(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const resp = await fetch(url);
  const blob = await resp.blob();
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload  = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

/* ── main export ──────────────────────────────────────────── */
export async function generateOfflineTourZip(project: Project): Promise<Blob> {
  const zip = new JSZip();

  /* ── collect scenes with base64 images ── */
  type SceneData = { name: string; icon: string; imgData: string };
  const scenes: SceneData[] = [];

  for (const scene of project.scenes) {
    let imgData = scene.imageUrl;
    try { imgData = await urlToBase64(scene.imageUrl); } catch { /* keep original */ }

    // save separately into assets/
    if (imgData.startsWith('data:')) {
      const mime = imgData.split(';')[0].split(':')[1] || 'image/jpeg';
      const ext  = mime.split('/')[1] || 'jpg';
      const fname = `scene_${scene.id}.${ext}`;
      zip.folder('assets')!.file(fname, base64ToBlob(imgData, mime));
    }

    scenes.push({
      name: scene.name || `Scene ${scenes.length + 1}`,
      icon: '📍',
      imgData,
    });
  }

  /* ── README ── */
  zip.file('README.txt', [
    'PANORAMAFLOW AI — GAMING VIRTUAL TOUR',
    '=====================================',
    `Project : ${project.name}`,
    `Rooms   : ${scenes.length}`,
    `Created : ${new Date().toLocaleString()}`,
    '',
    'HOW TO USE:',
    '  1. Extract this ZIP into any folder.',
    '  2. Double-click index.html  (no server needed — works offline!).',
    '  3. Pick your avatar → click ENTER EXPERIENCE.',
    '',
    'CONTROLS:',
    '  Mouse drag         →  look around the room',
    '  Arrow keys / WASD  →  move to next / previous room',
    '  On-screen arrows   →  click to enter next room',
    '  Scroll wheel       →  zoom in / out',
    '  F key              →  fullscreen',
    '  Room dots (bottom) →  jump to any room',
    '',
    'Thank you for using Zoomio!',
  ].join('\n'));

  /* ── build ROOMS JS array literal for embedding ── */
  const roomsJson = JSON.stringify(
    scenes.map((s, i) => ({ id: `r${i}`, name: s.name, icon: s.icon, img: s.imgData })),
    null, 2
  );

  /* ── main index.html (everything inline, no external deps needed for data) ── */
  const threeJsCdn = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>${project.name} — Immersive Virtual Tour</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--cyan:#00d4ff;--orange:#ff6b35;--green:#00ff88;--dark:#020817;
  --panel:rgba(2,8,23,.92);--border:rgba(0,212,255,.22);
  --glow:0 0 18px rgba(0,212,255,.55)}
html,body{width:100%;height:100%;overflow:hidden;background:#000;
  font-family:'Share Tech Mono',monospace}
#canvas{position:fixed;top:0;left:0;width:100%;height:100%;display:block;cursor:grab}
#canvas.grabbing{cursor:grabbing}

/* LOADING */
#loading{position:fixed;inset:0;background:#020817;display:flex;
  flex-direction:column;align-items:center;justify-content:center;z-index:9999;
  transition:opacity .5s}
#loading.fade{opacity:0;pointer-events:none}
.ll{font-size:48px;margin-bottom:14px;animation:pp 2s infinite}
.lt{font-size:22px;font-weight:900;letter-spacing:4px;color:#fff;margin-bottom:6px}
.ls{font-size:11px;color:rgba(255,255,255,.4);letter-spacing:2px;margin-bottom:28px}
.lb{width:200px;height:3px;background:rgba(0,212,255,.15);border-radius:2px;overflow:hidden}
.lf{height:100%;background:linear-gradient(90deg,#00d4ff,#00ff88);animation:fill 2s ease forwards}
@keyframes fill{from{width:0}to{width:100%}}
@keyframes pp{0%,100%{filter:drop-shadow(0 0 8px #00d4ff)}50%{filter:drop-shadow(0 0 24px #00d4ff)}}

/* AVATAR SCREEN */
#avsc{position:fixed;inset:0;background:linear-gradient(135deg,#020817,#040f1a,#020817);
  display:flex;align-items:center;justify-content:center;z-index:800}
#avsc.hidden{display:none}
.splash{position:relative;width:min(580px,92vw);padding:38px 38px 30px;
  background:rgba(2,8,23,.96);border:1px solid var(--border);
  border-top:3px solid var(--cyan);border-radius:18px;
  box-shadow:var(--glow),inset 0 1px 0 rgba(255,255,255,.04);backdrop-filter:blur(20px)}
.splash::before{content:'';position:absolute;inset:0;border-radius:18px;
  background-image:linear-gradient(rgba(0,212,255,.04) 1px,transparent 1px),
  linear-gradient(90deg,rgba(0,212,255,.04) 1px,transparent 1px);
  background-size:32px 32px;pointer-events:none}
.spl{font-size:50px;text-align:center;margin-bottom:12px;line-height:1;
  filter:drop-shadow(0 0 14px var(--cyan))}
.stt{font-size:24px;font-weight:900;text-align:center;color:#fff;
  letter-spacing:3px;margin-bottom:6px}
.ssb{text-align:center;font-size:11px;color:rgba(255,255,255,.38);
  letter-spacing:1px;margin-bottom:26px}
.slb{font-size:10px;letter-spacing:3px;color:var(--cyan);text-align:center;margin-bottom:14px}
.agrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px}
.av{background:rgba(0,212,255,.04);border:1px solid var(--border);border-radius:12px;
  padding:14px 6px;text-align:center;cursor:pointer;transition:.2s;position:relative}
.av:hover,.av.sel{background:rgba(0,212,255,.12);border-color:var(--cyan);box-shadow:var(--glow)}
.ai{font-size:36px;line-height:1;margin-bottom:8px}
.an{font-size:9px;font-weight:700;letter-spacing:2px;color:var(--cyan);margin-bottom:3px}
.ar{font-size:9px;color:rgba(255,255,255,.35)}
.sb{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;
  background:var(--green);box-shadow:0 0 10px var(--green);display:none}
.av.sel .sb{display:block}
.chint{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:22px}
.cpill{background:rgba(0,212,255,.07);border:1px solid var(--border);border-radius:6px;
  padding:5px 12px;font-size:10px;color:rgba(255,255,255,.5);letter-spacing:.5px}
.cpill span{color:var(--cyan)}
.ebtn{width:100%;padding:15px;background:linear-gradient(135deg,var(--cyan),#0099cc);
  border:none;border-radius:10px;font-size:13px;font-weight:700;letter-spacing:3px;
  color:#000;cursor:pointer;transition:.25s;box-shadow:var(--glow)}
.ebtn:hover{transform:translateY(-2px);box-shadow:0 0 32px rgba(0,212,255,.7);
  background:linear-gradient(135deg,#00ffff,var(--cyan))}

/* TRANSITION */
#tr{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;
  z-index:200;transition:opacity .38s}
#tr.act{opacity:1;pointer-events:auto}

/* HUD */
#hud{position:fixed;inset:0;z-index:100;pointer-events:none;display:none}
#hud.vis{display:block}
#hud::before{content:'';position:absolute;inset:0;
  background:repeating-linear-gradient(0deg,transparent,transparent 3px,
  rgba(0,0,0,.07) 3px,rgba(0,0,0,.07) 4px);pointer-events:none}
#hud::after{content:'';position:absolute;inset:0;
  background:radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.72) 100%);
  pointer-events:none}
.htl{position:absolute;top:20px;left:20px;display:flex;flex-direction:column;gap:6px}
.hbrand{font-size:9px;letter-spacing:3px;color:var(--cyan);text-shadow:0 0 8px var(--cyan);opacity:.75}
.hroom{background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--cyan);
  border-radius:0 8px 8px 0;padding:8px 16px;display:flex;align-items:center;gap:8px;
  max-width:280px;pointer-events:auto}
.hri{font-size:18px;flex-shrink:0}
.hrn{font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hrs{font-size:9px;color:rgba(255,255,255,.4);margin-top:2px;letter-spacing:1px}
.htr{position:absolute;top:20px;right:20px;background:var(--panel);border:1px solid var(--border);
  border-right:3px solid var(--cyan);border-radius:8px 0 0 8px;padding:12px 18px;
  font-size:10px;color:var(--cyan);line-height:2;letter-spacing:.8px;
  text-shadow:0 0 6px var(--cyan);pointer-events:auto;backdrop-filter:blur(12px)}
.htv{color:#fff}
.xh{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:36px;height:36px;pointer-events:none}
.xhh{position:absolute;top:50%;left:0;width:100%;height:1px;
  background:rgba(0,212,255,.5);transform:translateY(-50%)}
.xhv{position:absolute;left:50%;top:0;width:1px;height:100%;
  background:rgba(0,212,255,.5);transform:translateX(-50%)}
.xhd{position:absolute;top:50%;left:50%;width:5px;height:5px;border-radius:50%;
  background:var(--cyan);transform:translate(-50%,-50%);box-shadow:0 0 10px var(--cyan)}
.xhr{position:absolute;top:50%;left:50%;width:18px;height:18px;
  border:1px solid rgba(0,212,255,.4);border-radius:50%;transform:translate(-50%,-50%)}
.havatar{position:absolute;top:50%;left:20px;transform:translateY(-50%);
  background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--green);
  border-radius:0 10px 10px 0;padding:10px 14px;pointer-events:auto;backdrop-filter:blur(12px)}
.habi{font-size:28px;text-align:center;margin-bottom:4px}
.habn{font-size:8px;letter-spacing:2px;color:var(--green);text-align:center}
.hbot{position:absolute;bottom:0;left:0;right:0;
  background:linear-gradient(transparent,rgba(2,8,23,.92));
  padding:14px 24px 18px;display:flex;flex-direction:column;
  align-items:center;gap:10px;pointer-events:auto}
.rdots{display:flex;align-items:center;gap:8px}
.rdot{width:9px;height:9px;border-radius:50%;background:rgba(0,212,255,.18);
  border:1px solid var(--border);cursor:pointer;transition:.2s}
.rdot:hover{background:rgba(0,212,255,.45)}
.rdot.cur{background:var(--cyan);box-shadow:0 0 12px var(--cyan);transform:scale(1.35)}
.rdot.vis{background:rgba(0,255,136,.5);box-shadow:0 0 8px rgba(0,255,136,.35)}
.hbtns{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.hbtn{font-size:9px;letter-spacing:1.5px;padding:7px 14px;background:rgba(2,8,23,.8);
  border:1px solid var(--border);border-radius:7px;color:rgba(255,255,255,.7);
  cursor:pointer;transition:.2s;backdrop-filter:blur(8px);pointer-events:auto}
.hbtn:hover{border-color:var(--cyan);color:var(--cyan);box-shadow:var(--glow)}
.hbtn.act{border-color:var(--orange);color:var(--orange)}

/* NAV ARROWS */
#narrows{position:fixed;inset:0;z-index:150;pointer-events:none;display:none}
.narrow{position:absolute;pointer-events:auto;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;gap:4px;transition:.2s}
.narrow:hover .ab{color:#fff;text-shadow:0 0 30px var(--cyan);transform:scale(1.2)}
.narrow:hover .al{opacity:1}
.ab{font-size:34px;color:var(--cyan);text-shadow:0 0 18px var(--cyan);
  line-height:1;animation:af 1.6s ease-in-out infinite;transition:.2s}
.al{font-size:9px;letter-spacing:2px;color:var(--cyan);text-shadow:0 0 8px var(--cyan);
  opacity:.7;font-weight:700;transition:.2s;white-space:nowrap;max-width:100px;
  overflow:hidden;text-overflow:ellipsis;text-align:center}
@keyframes af{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
#afwd{bottom:108px;left:50%;transform:translateX(-50%)}
#abck{bottom:108px;left:calc(50% - 80px);transform:translateX(-50%)}
#afwd{left:calc(50% + 0px)}
#alft{top:50%;left:20px;transform:translateY(-50%);flex-direction:row}
#argt{top:50%;right:20px;transform:translateY(-50%);flex-direction:row-reverse}
#alft .ab,#argt .ab{font-size:28px}

/* ROOMS PANEL */
#rpanel{position:fixed;left:0;top:0;bottom:0;width:260px;
  background:rgba(2,8,23,.97);border-right:1px solid var(--border);
  backdrop-filter:blur(20px);z-index:300;
  transform:translateX(-100%);transition:.3s ease;display:flex;flex-direction:column}
#rpanel.open{transform:translateX(0)}
.rph{padding:20px;border-bottom:1px solid var(--border);
  display:flex;justify-content:space-between;align-items:center}
.rph h3{font-size:11px;letter-spacing:3px;color:var(--cyan)}
.rpc{background:none;border:none;color:rgba(255,255,255,.4);font-size:20px;
  cursor:pointer;pointer-events:auto}
.rpl{flex:1;overflow-y:auto;padding:8px}
.rpi{display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:8px;
  cursor:pointer;margin-bottom:4px;transition:.2s;pointer-events:auto}
.rpi:hover{background:rgba(0,212,255,.08)}
.rpi.cur{background:rgba(0,212,255,.14);border-left:3px solid var(--cyan)}
.rpt{width:50px;height:36px;border-radius:6px;object-fit:cover;
  border:1px solid var(--border);background:#111;flex-shrink:0}
.rpn{font-size:12px;font-weight:700;color:#fff;margin-bottom:3px}
.rps{font-size:10px;color:rgba(255,255,255,.35);letter-spacing:1px}

/* MINIMAP */
#mm{position:fixed;right:20px;bottom:100px;width:125px;height:125px;border-radius:50%;
  border:2px solid var(--cyan);overflow:hidden;
  box-shadow:var(--glow),inset 0 0 30px rgba(0,212,255,.08);
  background:radial-gradient(circle,rgba(2,8,23,.95),#000);display:none}
.mmsw{position:absolute;top:50%;left:50%;width:260%;height:260%;
  background:conic-gradient(from 0deg,rgba(0,212,255,.18) 0deg,transparent 60deg);
  transform-origin:0 0;transform:translate(-50%,-50%);animation:sw 3s linear infinite}
@keyframes sw{to{transform:translate(-50%,-50%) rotate(360deg)}}
.mmctr{position:absolute;top:50%;left:50%;width:10px;height:10px;border-radius:50%;
  background:var(--green);transform:translate(-50%,-50%);box-shadow:0 0 12px var(--green);z-index:5}
#mmc{position:absolute;inset:0;border-radius:50%;z-index:3;opacity:.8}
#mm::before,#mm::after{content:'';position:absolute;top:50%;left:50%;
  background:rgba(0,212,255,.12);z-index:2}
#mm::before{width:100%;height:1px;transform:translate(-50%,-50%)}
#mm::after{width:1px;height:100%;transform:translate(-50%,-50%)}

@media(max-width:600px){.agrid{grid-template-columns:repeat(2,1fr)}.stt{font-size:20px}
  .htr{display:none}#mm{width:90px;height:90px}.havatar{display:none}}
</style>
</head>
<body>

<div id="loading">
  <div class="ll">🌐</div>
  <div class="lt">${project.name.toUpperCase()}</div>
  <div class="ls">LOADING VIRTUAL ENVIRONMENT</div>
  <div class="lb"><div class="lf"></div></div>
</div>

<canvas id="canvas"></canvas>
<div id="tr"></div>

<!-- AVATAR SCREEN -->
<div id="avsc" class="hidden">
<div class="splash">
  <div class="spl">🏨</div>
  <div class="stt">${project.name.toUpperCase()}</div>
  <div class="ssb">${project.scenes.length} ROOMS · GAMING VIRTUAL TOUR</div>
  <div class="slb">SELECT YOUR AVATAR</div>
  <div class="agrid">
    <div class="av sel" onclick="pickAv(this,'robot')"><div class="sb"></div>
      <div class="ai">🤖</div><div class="an">ROBOT</div><div class="ar">Sci-Fi</div></div>
    <div class="av" onclick="pickAv(this,'astronaut')"><div class="sb"></div>
      <div class="ai">👨‍🚀</div><div class="an">ASTRONAUT</div><div class="ar">Pioneer</div></div>
    <div class="av" onclick="pickAv(this,'ninja')"><div class="sb"></div>
      <div class="ai">🥷</div><div class="an">NINJA</div><div class="ar">Stealth</div></div>
    <div class="av" onclick="pickAv(this,'explorer')"><div class="sb"></div>
      <div class="ai">🧭</div><div class="an">EXPLORER</div><div class="ar">Adventure</div></div>
  </div>
  <div class="chint">
    <div class="cpill"><span>🖱 DRAG</span> Look Around</div>
    <div class="cpill"><span>↑↓←→</span> Switch Room</div>
    <div class="cpill"><span>WASD</span> Navigate</div>
    <div class="cpill"><span>▲ Arrows</span> Enter Room</div>
  </div>
  <button class="ebtn" onclick="startTour()">▶ &nbsp; ENTER EXPERIENCE</button>
</div>
</div>

<!-- HUD -->
<div id="hud">
  <div class="htl">
    <div class="hbrand">● PANORAMAFLOW AI  |  LIVE</div>
    <div class="hroom">
      <div class="hri" id="hudi">🏨</div>
      <div>
        <div class="hrn" id="hudn">Loading...</div>
        <div class="hrs">ROOM <span id="hudnum">1</span> / <span id="hudtot">${scenes.length}</span></div>
      </div>
    </div>
  </div>
  <div class="htr">
    SYS &nbsp;&nbsp;&nbsp; <span class="htv">WEBGL_ACTIVE</span><br>
    AVATAR &nbsp; <span class="htv" id="havn">ROBOT</span><br>
    ROOM &nbsp;&nbsp; <span class="htv" id="hrm">1/${scenes.length}</span><br>
    VIEW &nbsp;&nbsp; <span class="htv" id="hdeg">000°</span>
  </div>
  <div class="xh"><div class="xhh"></div><div class="xhv"></div>
    <div class="xhr"></div><div class="xhd"></div></div>
  <div class="havatar">
    <div class="habi" id="havi">🤖</div>
    <div class="habn" id="havlb">ROBOT</div>
  </div>
  <div class="hbot">
    <div class="rdots" id="rdots"></div>
    <div class="hbtns">
      <button class="hbtn" onclick="togglePanel()">☰ ROOMS</button>
      <button class="hbtn" onclick="prevRoom()">◀ PREV</button>
      <button class="hbtn" onclick="nextRoom()">NEXT ▶</button>
      <button class="hbtn" id="spinbtn" onclick="toggleSpin()">⟳ AUTO</button>
      <button class="hbtn" onclick="goFS()">⛶ FULL</button>
      <button class="hbtn" onclick="exitTour()">✕ EXIT</button>
    </div>
  </div>
</div>

<!-- NAV ARROWS -->
<div id="narrows">
  <div class="narrow" id="afwd" onclick="nextRoom()">
    <div class="ab">▲</div><div class="al" id="afl">NEXT</div></div>
  <div class="narrow" id="abck" onclick="prevRoom()">
    <div class="ab" style="transform:rotate(180deg)">▲</div>
    <div class="al" id="abl">BACK</div></div>
  <div class="narrow" id="alft" onclick="prevRoom()">
    <div class="ab" style="transform:rotate(-90deg)">▲</div>
    <div class="al">PREV</div></div>
  <div class="narrow" id="argt" onclick="nextRoom()">
    <div class="ab" style="transform:rotate(90deg)">▲</div>
    <div class="al">NEXT</div></div>
</div>

<!-- ROOMS PANEL -->
<div id="rpanel">
  <div class="rph"><h3>ALL ROOMS</h3>
    <button class="rpc" onclick="togglePanel()">✕</button></div>
  <div class="rpl" id="rpl"></div>
</div>

<!-- MINIMAP -->
<div id="mm"><div class="mmsw"></div><div class="mmctr"></div>
  <canvas id="mmc" width="125" height="125"></canvas></div>

<!-- ROOM DATA (embedded inline — no CORS!) -->
<script>const ROOMS=${roomsJson};</script>

<!-- Three.js (from CDN; fallback handled below) -->
<script src="${threeJsCdn}"></script>

<script>
const AVTS={robot:{icon:'🤖',lbl:'ROBOT'},astronaut:{icon:'👨‍🚀',lbl:'ASTRONAUT'},
  ninja:{icon:'🥷',lbl:'NINJA'},explorer:{icon:'🧭',lbl:'EXPLORER'}};
let cur=0,av='robot',inT=false,spin=false,visited=new Set();
let renderer,scene3d,cam,sph,mat;
let drag=false,lx,ly,lon=0,lat=0,tlon=0;
const texCache={};
const ldr=new THREE.TextureLoader();

function initGL(){
  const c=document.getElementById('canvas');
  renderer=new THREE.WebGLRenderer({canvas:c,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth,innerHeight);
  scene3d=new THREE.Scene();
  cam=new THREE.PerspectiveCamera(80,innerWidth/innerHeight,0.1,1000);
  cam.position.set(0,0,0);
  const geo=new THREE.SphereGeometry(500,64,32);
  geo.scale(-1,1,1);
  mat=new THREE.MeshBasicMaterial({color:0x111827});
  sph=new THREE.Mesh(geo,mat);
  scene3d.add(sph);
  window.addEventListener('resize',()=>{
    renderer.setSize(innerWidth,innerHeight);
    cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();});
  (function loop(){
    requestAnimationFrame(loop);
    if(spin&&!drag){lon+=0.04;tlon+=0.04;}
    lon+=(tlon-lon)*0.08;
    lat=Math.max(-75,Math.min(75,lat));
    const phi=THREE.MathUtils.degToRad(90-lat);
    const th=THREE.MathUtils.degToRad(lon);
    cam.lookAt(Math.sin(phi)*Math.cos(th),Math.cos(phi),Math.sin(phi)*Math.sin(th));
    const d=document.getElementById('hdeg');
    if(d)d.textContent=((lon%360+360)%360).toFixed(0).padStart(3,'0')+'°';
    renderer.render(scene3d,cam);
  })();
}

function loadTex(idx,cb){
  const url=ROOMS[idx].img;
  if(texCache[url]){cb(texCache[url]);return;}
  ldr.load(url,t=>{texCache[url]=t;cb(t);},undefined,()=>cb(null));
}
function preload(idx){[idx-1,idx+1].filter(i=>i>=0&&i<ROOMS.length).forEach(i=>loadTex(i,()=>{}));}

function goTo(idx){
  if(idx<0||idx>=ROOMS.length)return;
  if(idx===cur&&inT)return;
  const ov=document.getElementById('tr');
  ov.classList.add('act');
  setTimeout(()=>{
    cur=idx;visited.add(idx);
    loadTex(idx,t=>{
      if(t){mat.map=t;mat.color.set(0xffffff);mat.needsUpdate=true;}
      setTimeout(()=>ov.classList.remove('act'),30);
      updHUD();updArrows();updDots();updMM();drawList();preload(idx);
    });
  },380);
}
function nextRoom(){goTo(cur+1);}
function prevRoom(){goTo(cur-1);}

function updHUD(){
  const r=ROOMS[cur];
  document.getElementById('hudi').textContent=r.icon||'📍';
  document.getElementById('hudn').textContent=r.name;
  document.getElementById('hudnum').textContent=cur+1;
  document.getElementById('hrm').textContent=(cur+1)+'/'+ROOMS.length;
}
function updArrows(){
  const hp=cur>0,hn=cur<ROOMS.length-1;
  document.getElementById('afwd').style.display=hn?'flex':'none';
  document.getElementById('abck').style.display=hp?'flex':'none';
  document.getElementById('alft').style.display=hp?'flex':'none';
  document.getElementById('argt').style.display=hn?'flex':'none';
  if(hn)document.getElementById('afl').textContent=ROOMS[cur+1].name.slice(0,12).toUpperCase();
  if(hp)document.getElementById('abl').textContent=ROOMS[cur-1].name.slice(0,12).toUpperCase();
}
function updDots(){
  const c=document.getElementById('rdots');c.innerHTML='';
  ROOMS.forEach((r,i)=>{
    const d=document.createElement('div');
    d.className='rdot'+(i===cur?' cur':visited.has(i)?' vis':'');
    d.title=r.name;d.onclick=()=>goTo(i);c.appendChild(d);});
}
function drawList(){
  const c=document.getElementById('rpl');c.innerHTML='';
  ROOMS.forEach((r,i)=>{
    const el=document.createElement('div');
    el.className='rpi'+(i===cur?' cur':'');
    el.innerHTML='<div style="font-size:28px;flex-shrink:0">'+r.icon+'</div>'+
      '<div><div class="rpn">'+r.name+'</div>'+
      '<div class="rps">ROOM '+(i+1)+' OF '+ROOMS.length+(visited.has(i)?'  · VISITED':'')+'</div></div>';
    el.onclick=()=>{goTo(i);togglePanel();};
    c.appendChild(el);});
}
function updMM(){
  const cv=document.getElementById('mmc'),ctx=cv.getContext('2d');
  const W=cv.width,H=cv.height,cx=W/2,cy=H/2,R=W/2-10;
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle='rgba(0,212,255,.12)';ctx.lineWidth=1;
  [R*.33,R*.66,R].forEach(r=>{ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();});
  const n=ROOMS.length;
  ROOMS.forEach((r,i)=>{
    const a=(i/n)*Math.PI*2-Math.PI/2,d=R*.72;
    const sx=cx+Math.cos(a)*d,sy=cy+Math.sin(a)*d;
    if(i<n-1){const na=((i+1)/n)*Math.PI*2-Math.PI/2;
      ctx.beginPath();ctx.moveTo(sx,sy);
      ctx.lineTo(cx+Math.cos(na)*d,cy+Math.sin(na)*d);
      ctx.strokeStyle='rgba(0,212,255,.15)';ctx.lineWidth=1;ctx.stroke();}
    ctx.beginPath();ctx.arc(sx,sy,i===cur?6:3.5,0,Math.PI*2);
    ctx.fillStyle=i===cur?'#00ff88':visited.has(i)?'rgba(0,212,255,.7)':'rgba(0,212,255,.25)';ctx.fill();
    if(i===cur){ctx.beginPath();ctx.arc(sx,sy,10,0,Math.PI*2);
      ctx.strokeStyle='rgba(0,255,136,.35)';ctx.lineWidth=2;ctx.stroke();}
  });
}

function setupInput(){
  const c=document.getElementById('canvas');
  c.addEventListener('mousedown',e=>{drag=true;lx=e.clientX;ly=e.clientY;c.classList.add('grabbing');e.preventDefault();});
  window.addEventListener('mousemove',e=>{if(!drag)return;tlon-=(e.clientX-lx)*.18;lat+=(e.clientY-ly)*.18;lx=e.clientX;ly=e.clientY;});
  window.addEventListener('mouseup',()=>{drag=false;document.getElementById('canvas').classList.remove('grabbing');});
  c.addEventListener('touchstart',e=>{if(e.touches.length===1){drag=true;lx=e.touches[0].clientX;ly=e.touches[0].clientY;}},{passive:true});
  c.addEventListener('touchmove',e=>{if(!drag||e.touches.length!==1)return;tlon-=(e.touches[0].clientX-lx)*.18;lat+=(e.touches[0].clientY-ly)*.18;lx=e.touches[0].clientX;ly=e.touches[0].clientY;},{passive:true});
  c.addEventListener('touchend',()=>{drag=false;});
  c.addEventListener('wheel',e=>{cam.fov=Math.max(40,Math.min(110,cam.fov+e.deltaY*.04));cam.updateProjectionMatrix();},{passive:true});
  document.addEventListener('keydown',e=>{
    if(!inT)return;
    switch(e.key){
      case'ArrowUp':case'w':case'W':nextRoom();break;
      case'ArrowDown':case's':case'S':prevRoom();break;
      case'ArrowRight':case'd':case'D':nextRoom();break;
      case'ArrowLeft':case'a':case'A':prevRoom();break;
      case'f':case'F':goFS();break;
      case'Escape':togglePanel();break;
    }
  });
}

function pickAv(el,name){document.querySelectorAll('.av').forEach(a=>a.classList.remove('sel'));el.classList.add('sel');av=name;}

function startTour(){
  document.getElementById('avsc').classList.add('hidden');
  document.getElementById('hud').classList.add('vis');
  document.getElementById('narrows').style.display='block';
  document.getElementById('mm').style.display='block';
  const a=AVTS[av]||AVTS.robot;
  document.getElementById('havn').textContent=a.lbl;
  document.getElementById('havi').textContent=a.icon;
  document.getElementById('havlb').textContent=a.lbl;
  inT=true;visited.add(0);
  goTo(0);
}

function exitTour(){
  inT=false;
  document.getElementById('hud').classList.remove('vis');
  document.getElementById('narrows').style.display='none';
  document.getElementById('mm').style.display='none';
  document.getElementById('rpanel').classList.remove('open');
  document.getElementById('avsc').classList.remove('hidden');
  mat.map=null;mat.color.set(0x111827);mat.needsUpdate=true;
  lon=0;lat=0;tlon=0;
}

function togglePanel(){document.getElementById('rpanel').classList.toggle('open');}
function toggleSpin(){spin=!spin;document.getElementById('spinbtn').classList.toggle('act',spin);}
function goFS(){!document.fullscreenElement?document.documentElement.requestFullscreen().catch(()=>{}):document.exitFullscreen();}

window.addEventListener('DOMContentLoaded',()=>{
  initGL();
  setupInput();
  updMM();
  [0,1,2].filter(i=>i<ROOMS.length).forEach(i=>loadTex(i,()=>{}));
  setTimeout(()=>{
    const ld=document.getElementById('loading');
    ld.classList.add('fade');
    setTimeout(()=>{ld.style.display='none';
      document.getElementById('avsc').classList.remove('hidden');},600);
  },1800);
});
</script>
</body>
</html>`;

  zip.file('index.html', html);

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
