// קוד משותף לעמודי הניסוי של החלון הצף: ציור הדפית על canvas, הזרמה לווידאו,
// כפתורי Picture-in-Picture, טבלת יכולות ויומן. נתוני דוגמה בלבד (LY347).
(function(){
const root = document.documentElement;
const $ = s => document.querySelector(s);

const BRIEF = {flight:'LY347/10', route:'LLBG → LSZH', reg:'4XEKI', type:'737-800', date:'10/11/26', ofp:'OFP 11/0/1',
  std:'06:30', sta:'11:00', ete:'04:15', tf:'10,805', tow:'72.2', bfPlan:'14.2'};
const DEFAULTS = {bf:'14.2', cab:['דייל 1'], ck:['טייס 1'], cg:'21.8', sob:'155', n1:'96.3', v1:'140', vr:'141', v2:'147'};
const LAYOUTS = {
  full: {w:600, h:760, label:'מלאה, לאורך'},
  c34:  {w:600, h:800, label:'מצומצמת 3:4'},
  c11:  {w:720, h:720, label:'מצומצמת, ריבוע'},
  c43:  {w:800, h:600, label:'מצומצמת 4:3'},
  c169: {w:960, h:540, label:'מצומצמת 16:9'},
};
const FONT = '-apple-system, system-ui, "Segoe UI", Arial, sans-serif';

function makeLog(el){
  return m => { const t = new Date().toISOString().slice(11,19); el.textContent += `${t} ${m}\n`; };
}
function css(name){ return getComputedStyle(root).getPropertyValue(name).trim(); }
function colors(){ return {sheet:css('--sheet'),card:css('--card'),fld:css('--fld'),tx:css('--tx'),tx2:css('--tx2'),bx:css('--bx'),ac:css('--ac')}; }

function painter(ctx){
  return {
    rr(x,y,w,h,r,fill,stroke){
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x,y,w,h,r); else ctx.rect(x,y,w,h);
      if (fill){ ctx.fillStyle = fill; ctx.fill(); }
      if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
    },
    txt(s,x,y,size,color,opt={}){
      ctx.font = `${opt.w||400} ${size}px ${FONT}`; ctx.fillStyle = color;
      ctx.direction = opt.rtl ? 'rtl' : 'ltr'; ctx.textAlign = opt.align || 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(s,x,y);
    },
  };
}
const val = s => (s && String(s).trim()) || '—';
const clock = () => new Date().toTimeString().slice(0,8);

// הדפית המלאה, לפי העיצוב שאושר (5.1.1).
function drawFull(ctx, W, H, d, c){
  const {rr, txt} = painter(ctx), M = 24, G = 12, IW = W - 2*M;
  rr(0,0,W,H,0,c.sheet);
  txt(BRIEF.flight, M, 52, 30, c.tx, {w:600});
  txt(`${BRIEF.route} · ${BRIEF.reg} · ${BRIEF.type}`, M, 80, 17, c.tx2);
  txt(BRIEF.date, W-M, 44, 15, c.tx2, {align:'right'});
  txt(BRIEF.ofp, W-M, 66, 15, c.tx2, {align:'right'});
  let y = 112;
  const section = t => { txt(t, W-M, y, 15, c.tx2, {rtl:true, align:'right'}); y += 10; };
  function cells(spec, h=72){
    const total = spec.reduce((a,s)=>a+(s.f||1),0), unit = (IW - G*(spec.length-1)) / total; let x = M;
    spec.forEach(s => {
      const w = unit*(s.f||1); rr(x,y,w,h,10,c.card);
      if (s.heb) txt(s.l, x+w-12, y+22, 14, c.tx2, {rtl:true, align:'right'}); else txt(s.l, x+12, y+22, 14, c.tx2);
      if (s.lines) s.lines.forEach((n,k) => txt(n, x+w-12, y+48+k*24, 19, c.tx, {rtl:true, align:'right'}));
      else { if (s.inp) rr(x+10, y+30, w-20, 34, 7, c.fld, c.bx); txt(s.v, x+20, y+55, 21, s.col||c.tx); }
      x += w + G;
    });
    y += h + 22;
  }
  const bf = val(d.bf);
  section('זמנים'); cells([{l:'STD – STA',v:`${BRIEF.std} – ${BRIEF.sta}`,f:2},{l:'ETE',v:BRIEF.ete}]);
  section('דלק ומשקל'); cells([{l:'T.F',v:BRIEF.tf},{l:'T.O.W',v:BRIEF.tow},{l:`B.F (${BRIEF.bfPlan})`,v:bf,inp:1,col: bf!==BRIEF.bfPlan?c.ac:c.tx}]);
  const cab = (d.cab||[]).filter(Boolean), ck = (d.ck||[]).filter(Boolean), rows = Math.max(1, cab.length, ck.length);
  section('צוות'); cells([{l:'קבינה',heb:1,lines:cab},{l:'קוקפיט',heb:1,lines:ck}], 34 + rows*24);
  section('Loadsheet'); cells([{l:'CG (MACTOW)',v:val(d.cg),inp:1},{l:'SOB',v:val(d.sob),inp:1}]);
  section('OPT'); cells([{l:'N1',v:val(d.n1),inp:1},{l:'V1',v:val(d.v1),inp:1},{l:'VR',v:val(d.vr),inp:1},{l:'V2',v:val(d.v2),inp:1}]);
  txt('כלי עזר בלבד', W-M, H-20, 13, c.tx2, {rtl:true, align:'right'});
  txt('frame ' + clock(), M, H-20, 13, c.tx2);
}

// דפית מצומצמת לחלון הצף: רק הערכים, באותיות גדולות, בלי צוות ובלי כותרות.
function drawCompact(ctx, W, H, d, c){
  const {rr, txt} = painter(ctx);
  const M = Math.round(Math.min(W,H) * 0.045), G = Math.round(M * 0.5);
  rr(0,0,W,H,0,c.sheet);
  const bf = val(d.bf);
  const rows = [
    [{l:'STD',v:BRIEF.std},{l:'STA',v:BRIEF.sta},{l:'ETE',v:BRIEF.ete}],
    [{l:'T.F',v:BRIEF.tf},{l:'T.O.W',v:BRIEF.tow},{l:'B.F',v:bf,col: bf!==BRIEF.bfPlan?c.ac:c.tx}],
    [{l:'MACTOW',v:val(d.cg)},{l:'SOB',v:val(d.sob)}],
    [{l:'N1',v:val(d.n1)},{l:'V1',v:val(d.v1)},{l:'VR',v:val(d.vr)},{l:'V2',v:val(d.v2)}],
  ];
  const foot = Math.max(14, Math.round(H * 0.03));
  const headH = Math.round((H - 2*M - foot) * 0.14);
  const rowH = (H - 2*M - foot - headH - G*rows.length) / rows.length;
  const IW = W - 2*M;
  const hs = Math.round(Math.min(headH * 0.62, W * 0.055));
  txt(BRIEF.flight, M, M + hs, hs, c.tx, {w:600});
  txt(BRIEF.route, W-M, M + hs, Math.round(hs*0.8), c.tx2, {align:'right'});
  let y = M + headH + G;
  rows.forEach(r => {
    const w = (IW - G*3) / 4;
    const ls = Math.round(Math.min(rowH * 0.24, w * 0.14));
    const vs = Math.round(Math.min(rowH * 0.5, w * 0.27));
    r.forEach((cell, i) => {
      const x = M + i*(w+G);
      rr(x, y, w, rowH, Math.round(rowH*0.12), c.card);
      txt(cell.l, x + ls*0.6, y + ls*1.25, ls, c.tx2);
      txt(cell.v, x + ls*0.6, y + rowH - (rowH - ls*1.25 - vs)/2 - vs*0.12, vs, cell.col||c.tx);
    });
    y += rowH + G;
  });
  txt('כלי עזר בלבד', W-M, H - M*0.5, foot, c.tx2, {rtl:true, align:'right'});
  txt('frame ' + clock(), M, H - M*0.5, foot, c.tx2);
}

function drawSheet(cv, layoutKey, d){
  const L = LAYOUTS[layoutKey] || LAYOUTS.full;
  if (cv.width !== L.w) cv.width = L.w;
  if (cv.height !== L.h) cv.height = L.h;
  const ctx = cv.getContext('2d'), c = colors();
  ctx.clearRect(0,0,L.w,L.h);
  (layoutKey === 'full' ? drawFull : drawCompact)(ctx, L.w, L.h, d, c);
}

// כפתורי בחירת פריסה. מחזיר את הפריסה הנוכחית דרך getLayout.
function layoutButtons(el, initial, onChange){
  let cur = initial;
  el.innerHTML = Object.entries(LAYOUTS).map(([k,L]) => `<button data-k="${k}">${L.label}</button>`).join('');
  const mark = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('pri', b.dataset.k === cur));
  el.querySelectorAll('button').forEach(b => b.onclick = () => { cur = b.dataset.k; mark(); onChange(cur); });
  mark();
  return () => cur;
}

// הזרמת ה-canvas לווידאו וכפתורי החלון הצף.
function pip({cv, vid, log, redraw}){
  let stream = null;
  function start(){
    if (stream) return;
    if (!cv.captureStream){ log('captureStream לא נתמך'); return; }
    try {
      stream = cv.captureStream(10);
      vid.srcObject = stream;
      const p = vid.play(); if (p) p.then(() => log('video playing')).catch(e => log('video.play failed: ' + e.name + ': ' + e.message));
    } catch(e){ log('captureStream error: ' + e.name + ': ' + e.message); }
  }
  function restart(){
    const inPip = document.pictureInPictureElement === vid;
    const done = inPip ? document.exitPictureInPicture().catch(()=>{}) : Promise.resolve();
    return done.then(() => {
      if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
      redraw(); start();
      if (inPip) log('החלון הצף נסגר בגלל שינוי פריסה. פתח אותו שוב.');
    });
  }
  vid.addEventListener('resize', () => log(`video ${vid.videoWidth}×${vid.videoHeight}`));
  vid.addEventListener('enterpictureinpicture', e => log('נכנס לחלון צף' + (e.pictureInPictureWindow ? ` (${e.pictureInPictureWindow.width}×${e.pictureInPictureWindow.height})` : '')));
  vid.addEventListener('leavepictureinpicture', () => log('יצא מחלון צף'));
  vid.addEventListener('webkitpresentationmodechanged', () => log('presentation mode: ' + vid.webkitPresentationMode));
  function openStd(){
    start();
    if (!document.pictureInPictureEnabled || !vid.requestPictureInPicture){ log('requestPictureInPicture לא זמין, נסה את השיטה החלופית'); return; }
    vid.requestPictureInPicture()
      .then(w => { log('requestPictureInPicture הצליח' + (w ? ` (${w.width}×${w.height})` : '')); if (w) w.addEventListener('resize', () => log(`גודל החלון הצף ${w.width}×${w.height}`)); })
      .catch(e => log('requestPictureInPicture נכשל: ' + e.name + ': ' + e.message));
  }
  function openWk(){
    start();
    if (!vid.webkitSupportsPresentationMode || !vid.webkitSupportsPresentationMode('picture-in-picture')){ log('webkit PiP לא נתמך'); return; }
    try { vid.webkitSetPresentationMode('picture-in-picture'); log('webkitSetPresentationMode נשלח'); } catch(e){ log('webkit PiP נכשל: ' + e.name + ': ' + e.message); }
  }
  return {start, restart, openStd, openWk};
}

function isStandalone(){ return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }

function diag(listEl, cv, vid, extra=[]){
  const yes = b => b ? '<span class="ok">כן</span>' : '<span class="bad">לא</span>';
  const items = [
    ['מותקן במסך הבית (standalone)', yes(isStandalone())],
    ['canvas.captureStream', yes(!!cv.captureStream)],
    ['Picture-in-Picture רגיל', yes(!!document.pictureInPictureEnabled)],
    ['Picture-in-Picture של WebKit', yes(!!(vid.webkitSupportsPresentationMode && vid.webkitSupportsPresentationMode('picture-in-picture')))],
    ['Document PiP (Windows)', yes('documentPictureInPicture' in window)],
    ['רוחב חלון', innerWidth + '×' + innerHeight],
    ...extra,
  ];
  listEl.innerHTML = items.map(([k,v]) => `<li><span>${k}</span><span>${v}</span></li>`).join('');
}

function copyResults(diagEl, logEl, log){
  const text = location.pathname.split('/').pop() + '\n' + [...diagEl.querySelectorAll('li')].map(li => li.innerText.replace('\n',': ')).join('\n') + '\n\n' + logEl.textContent;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
    .then(() => log('התוצאות הועתקו'))
    .catch(() => log('ההעתקה נכשלה, אפשר לצלם מסך'));
}

function setTheme(t){ if (t) root.dataset.theme = t; else delete root.dataset.theme; }

// הנתונים עוברים לעמוד החלון הצף בחלק שאחרי '#', שלא נשלח לשרת.
function toHash(d){ return '#d=' + encodeURIComponent(JSON.stringify(d)); }
function fromHash(){
  const m = location.hash.match(/^#d=(.*)$/);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch(e){ return null; }
}

window.FB = {BRIEF, DEFAULTS, LAYOUTS, $, makeLog, drawSheet, layoutButtons, pip, diag, copyResults, setTheme, toHash, fromHash, isStandalone};
})();
