// הדפית בחלון צף מעל אפליקציות אחרות. requirements.md, סעיף 5.1.2.
//
// אייפד (Safari/Chrome): החלון הצף של המערכת מקבל רק וידאו. הדפית מצוירת על canvas, מוזרמת לווידאו
// (captureStream) ונפתחת ב-Picture-in-Picture, לקריאה בלבד. הזרם בקצב קבוע, והדפית מצוירת מחדש פעם
// בשנייה: בלי פריימים רציפים Safari עוצר את הווידאו, והחלון נתקע (נבדק באייפד, גרסה 8).
// מאפליקציה שהותקנה למסך הבית הפתיחה נכשלת (באג WebKit 303885): מנסים, וכשנכשל מציגים הסבר.
// Windows (Chrome/Edge): הדפית המלאה ב-Document Picture-in-Picture, חלון HTML שאפשר לערוך בו.
//
// שלוש דפיות (mode): 'full' הדפית המלאה, 'takeoff' רק OPT, 'cruise' זמנים וצוות.

import { MISSING } from './sheet.js';
import { flightLabel, bfBox } from './brief.js';

const FONT = '-apple-system, system-ui, "Segoe UI", Arial, sans-serif';
const W = 600;

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * @param {{canvas, video, getData:()=>({brief, manual}|null), getSheet:()=>HTMLElement|null,
 *          onState:(open:boolean, mode:string|null)=>void, onDocClosed:()=>void}} o
 */
export function createFloat(o) {
  const { canvas, video } = o;
  let stream = null;
  let docWin = null;
  let mode = 'full';

  function draw() {
    const d = o.getData();
    if (!d) return;
    (DRAW[mode] ?? drawFull)(canvas, d.brief, d.manual);
  }

  /** מכין את הזרם מראש: הפתיחה עצמה חייבת לקרות מיד בלחיצה, על וידאו שכבר מנגן. */
  function prepare() {
    draw();
    if (stream || !canvas.captureStream) return;
    try {
      stream = canvas.captureStream(10);
      video.srcObject = stream;
      video.play().catch(() => {});
      setInterval(draw, 1000);
    } catch { stream = null; }
  }

  // וידאו שנעצר (Safari, או השהיה בחלון הצף) חוזר לנגן: החלון מציג דפית, לא סרט.
  video.addEventListener('pause', () => { if (stream) video.play().catch(() => {}); });

  const docSupported = () => 'documentPictureInPicture' in window;
  const videoOpen = () => document.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
  const isOpen = () => !!docWin || videoOpen();
  const state = () => o.onState(isOpen(), isOpen() ? mode : null);

  video.addEventListener('enterpictureinpicture', state);
  video.addEventListener('leavepictureinpicture', state);
  video.addEventListener('webkitpresentationmodechanged', state);

  async function openDoc() {
    const sheet = o.getSheet();
    if (!sheet) throw Object.assign(new Error('no sheet'), { name: 'NotFoundError' });
    const rect = sheet.getBoundingClientRect();
    const w = rect.width || 600, h = rect.height || 900;
    docWin = await documentPictureInPicture.requestWindow({ width: Math.round(Math.min(640, w + 24)), height: Math.round(Math.min(screen.availHeight * 0.85, h + 24)) });
    for (const s of document.styleSheets) {
      try {
        const st = docWin.document.createElement('style');
        st.textContent = [...s.cssRules].map((r) => r.cssText).join('\n');
        docWin.document.head.append(st);
      } catch { /* גיליון ממקור אחר */ }
    }
    syncTheme();
    docWin.document.documentElement.lang = 'he';
    docWin.document.documentElement.dir = 'rtl';
    docWin.document.title = 'דפית טיסה';
    docWin.document.body.style.padding = '12px';
    docWin.document.body.append(sheet);
    docWin.addEventListener('pagehide', () => { docWin = null; state(); o.onDocClosed(); });
    state();
  }

  function closeDoc() { if (docWin) docWin.close(); }

  /**
   * פותח את הדפית בחלון צף, או מחליף את הדפית בחלון שכבר פתוח.
   * @returns {Promise<string|null>} הודעה למשתמש כשהחלון לא נפתח
   */
  async function open(next = 'full') {
    // Windows: הדפית המלאה בחלון HTML שאפשר לערוך בו.
    if (next === 'full' && docSupported()) {
      if (docWin) return null;
      mode = next;
      if (videoOpen()) await exitVideo();
      try { await openDoc(); return null; } catch (e) { return `החלון הצף לא נפתח (${e.name}).`; }
    }
    if (docWin) closeDoc();
    mode = next;
    prepare();
    if (videoOpen()) { state(); return null; } // אותו חלון, תוכן אחר
    try {
      if (!video.requestPictureInPicture) throw Object.assign(new Error('no api'), { name: 'NotSupportedError' });
      await video.requestPictureInPicture();
      return null;
    } catch (e) {
      if (video.webkitSupportsPresentationMode?.('picture-in-picture')) {
        try { video.webkitSetPresentationMode('picture-in-picture'); return null; } catch { /* נמשיך להודעה */ }
      }
      if (isStandalone()) return 'החלון הצף נפתח רק כשהאפליקציה פתוחה ב-Safari או ב-Chrome, לא מהמסך הבית.';
      return `החלון הצף לא נפתח במכשיר הזה (${e.name}).`;
    }
  }

  function exitVideo() {
    if (document.pictureInPictureElement) return document.exitPictureInPicture().catch(() => {});
    if (video.webkitPresentationMode === 'picture-in-picture') video.webkitSetPresentationMode('inline');
    return Promise.resolve();
  }

  function close() {
    if (docWin) { closeDoc(); return; }
    exitVideo();
  }

  function syncTheme() {
    if (!docWin) return;
    const t = document.documentElement.dataset.theme;
    if (t) docWin.document.documentElement.dataset.theme = t;
    else delete docWin.document.documentElement.dataset.theme;
  }

  /** ערך השתנה או ערכת הצבעים התחלפה. */
  function update() { draw(); syncTheme(); }

  return { prepare, open, close, update, isOpen, docOpen: () => !!docWin, mode: () => (isOpen() ? mode : null) };
}

// ---- ציור לווידאו, לקריאה בלבד ----

function setup(canvas, H) {
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const c = { sheet: css('--sheet'), card: css('--card'), tx: css('--tx'), tx2: css('--tx2'), ac: css('--ac'), bad: css('--bad') };
  const ctx = canvas.getContext('2d');
  const rr = (x, y, w, h, r, fill) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const txt = (s, x, y, size, color, opt = {}) => {
    ctx.font = `${opt.w || 400} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.direction = opt.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = opt.align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  };
  ctx.clearRect(0, 0, W, H);
  rr(0, 0, W, H, 0, c.sheet);
  return { c, rr, txt };
}

const fieldVal = (f, k) => (f[k].missing ? MISSING : f[k].value);
const manualVal = (manual, k) => (manual[k] ?? '').trim();
const crewNames = (l) => l.map((s) => s.trim()).filter(Boolean);

let measure = null;
/**
 * שמות הצוות בשורות שנכנסות ברוחב: שורה ארוכה (השמות הפרטיים בקבינה) נשברת אחרי פסיק, והפסיק בסוף
 * השורה יורד. requirements.md, 3.3.
 */
function wrapNames(names, size, maxW) {
  measure ??= document.createElement('canvas').getContext('2d');
  measure.font = `400 ${size}px ${FONT}`;
  const fits = (t) => measure.measureText(t).width <= maxW;
  const out = [];
  for (const n of names) {
    if (fits(n)) { out.push(n); continue; }
    let line = '';
    for (const seg of n.split(/\s*,\s*/)) {
      const t = line ? `${line}, ${seg}` : seg;
      if (line && !fits(t)) { out.push(line); line = seg; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const M = 24, G = 12, IW = W - 2 * M;

/** משבצת עם כותרת וערך. */
function cell(p, x, y, w, h, label, value, o = {}) {
  p.rr(x, y, w, h, 10, p.c.card);
  p.txt(label, x + 12, y + (o.ls ?? 16) + 7, o.ls ?? 16, p.c.tx2);
  const vs = o.vs ?? 21;
  p.txt(value || '—', x + 20, y + h - (h - (o.ls ?? 16) - 7 - vs) / 2 - vs * 0.15, o.missing ? vs - 3 : vs, o.missing ? p.c.bad : (o.col || p.c.tx));
}

/** משבצת צוות: כותרת בעברית מימין, ושם בכל שורה. גובה: top + שורות * lh. */
const CREW = { ls: 16, ns: 19, lh: 24, top: 34 };
const HEB = /[֐-׿]/;
function crewCell(p, x, y, w, h, label, names, o = CREW) {
  p.rr(x, y, w, h, 10, p.c.card);
  p.txt(label, x + w - 12, y + o.ls + 7, o.ls, p.c.tx2, { rtl: true, align: 'right' });
  // שם באנגלית משמאל, ושם בעברית מימין (requirements.md, 5.1.1, גרסה 21).
  names.forEach((n, k) => {
    const heb = HEB.test(n);
    p.txt(n, heb ? x + w - 12 : x + 12, y + o.ls + 7 + o.lh * (k + 1), o.ns, p.c.tx, { rtl: heb, align: heb ? 'right' : 'left' });
  });
}

/** הדפית המלאה, לפי העיצוב שבמסך (5.1.1). */
function drawFull(canvas, brief, manual) {
  const f = brief.fields;
  const cw = (IW - G) / 2 - 24;
  const cab = wrapNames(crewNames(manual.cab), CREW.ns, cw), ck = wrapNames(crewNames(manual.ck), CREW.ns, cw);
  const crewRows = Math.max(1, cab.length, ck.length);
  const H = 630 + crewRows * 24; // כותרת 112, ארבעה מקטעים של 104, צוות 66 + שורות, תחתית 36
  const p = setup(canvas, H);
  const { c, txt } = p;
  const v = (k) => fieldVal(f, k), m = (k) => manualVal(manual, k);

  txt(flightLabel(brief), M, 52, 30, c.tx, { w: 600 });
  txt(`${brief.org} → ${brief.dst} · ${brief.reg} · ${v('type')}`, M, 80, 17, c.tx2);
  txt(v('date'), W - M, 44, 15, c.tx2, { align: 'right' });
  txt(`OFP ${brief.ofp}`, W - M, 66, 15, c.tx2, { align: 'right' });

  let y = 112;
  // כותרות: 16 בציור (14 במסך, באותו יחס לערכים). requirements.md, 5.1.1.
  const section = (t) => { txt(t, W - M, y, 16, c.tx2, { rtl: true, align: 'right' }); y += 10; };
  const row = (spec, h = 72) => {
    const total = spec.reduce((a, s) => a + (s.f || 1), 0);
    const unit = (IW - G * (spec.length - 1)) / total;
    let x = M;
    for (const s of spec) {
      const w = unit * (s.f || 1);
      if (s.lines) crewCell(p, x, y, w, h, s.l, s.lines); else cell(p, x, y, w, h, s.l, s.v, s);
      x += w + G;
    }
    y += h + 22;
  };
  const plan = f.bf.missing ? null : f.bf.value;
  const bf = m('bf');

  section('זמנים');
  row([{ l: 'STD – STA', v: `${v('std')} – ${v('sta')}`, f: 2, missing: f.std.missing || f.sta.missing }, { l: 'ETE', v: v('ete'), missing: f.ete.missing }]);
  section('דלק ומשקל');
  row([
    { l: 'T.F', v: v('tf'), missing: f.tf.missing },
    { l: 'T.O.W', v: v('tow'), missing: f.tow.missing },
    { l: `B.F (${plan ?? MISSING})`, v: bf, col: plan !== null && bf !== bfBox(plan) ? c.ac : c.tx },
  ]);
  section('צוות');
  row([{ l: 'קבינה', lines: cab }, { l: 'קוקפיט', lines: ck }], 34 + crewRows * 24);
  section('Loadsheet');
  row([{ l: 'CG (MACTOW)', v: m('cg') }, { l: 'SOB', v: m('sob') }]);
  section('OPT');
  // N1 במשבצת משלו ברווח כפול, וכל מהירות במשבצת משלה ברווח 8 (requirements.md, 5.1.1, גרסה 15).
  {
    const h = 72, gap = 2 * G, n1w = (IW - gap) / 4, sg = 8;
    cell(p, M, y, n1w, h, 'N1', m('n1'));
    const sx = M + n1w + gap, sw = (IW - n1w - gap - 2 * sg) / 3;
    [['V1', 'v1'], ['VR', 'vr'], ['V2', 'v2']].forEach(([l, k], i) => cell(p, sx + i * (sw + sg), y, sw, h, l, m(k)));
  }
  txt('כלי עזר בלבד', W - M, H - 20, 13, c.tx2, { rtl: true, align: 'right' });
}

/** המראה: רק OPT, בלי כותרת. N1 ממורכז למעלה, והמהירויות בשלוש משבצות נפרדות מתחתיו. */
function drawTakeoff(canvas, brief, manual) {
  // גדלים: requirements.md, 5.1.2 (גרסה 10).
  const h = 80, gap = 16, cw = (IW - 2 * gap) / 3;
  const H = M + h + gap + h + M;
  const p = setup(canvas, H);
  const m = (k) => manualVal(manual, k);
  const big = { ls: 15, vs: 28 };
  cell(p, M + cw + gap, M, cw, h, 'N1', m('n1'), big);
  [['V1', 'v1'], ['VR', 'vr'], ['V2', 'v2']].forEach(([l, k], i) => cell(p, M + i * (cw + gap), M + h + gap, cw, h, l, m(k), big));
}

/** שיוט: שורת טיסה קטנה, זמנים וצוות. */
function drawCruise(canvas, brief, manual) {
  const f = brief.fields;
  // גדלים: requirements.md, 5.1.2 (גרסה 10).
  const crew = { ls: 20, ns: 30, lh: 36, top: 40 }; // זמנים ושמות באותו גודל (גרסה 13)
  const cw = (IW - G) / 2 - 24;
  const cab = wrapNames(crewNames(manual.cab), crew.ns, cw), ck = wrapNames(crewNames(manual.ck), crew.ns, cw);
  const crewRows = Math.max(1, cab.length, ck.length);
  const timesH = 100, crewH = crew.top + crewRows * crew.lh;
  const H = 64 + timesH + G + crewH + M;
  const p = setup(canvas, H);
  const { c, txt } = p;
  const v = (k) => fieldVal(f, k);
  txt(flightLabel(brief), M, 42, 22, c.tx2, { w: 600 });
  txt(`${brief.org} → ${brief.dst}`, W - M, 42, 20, c.tx2, { align: 'right' });
  let y = 64;
  const unit = (IW - G) / 3;
  const big = { ls: 20, vs: 30 };
  cell(p, M, y, unit * 2, timesH, 'STD – STA', `${v('std')} – ${v('sta')}`, { ...big, missing: f.std.missing || f.sta.missing });
  cell(p, M + unit * 2 + G, y, unit, timesH, 'ETE', v('ete'), { ...big, missing: f.ete.missing });
  y += timesH + G;
  const half = (IW - G) / 2;
  crewCell(p, M, y, half, crewH, 'קבינה', cab, crew);
  crewCell(p, M + half + G, y, half, crewH, 'קוקפיט', ck, crew);
}

const DRAW = { full: drawFull, takeoff: drawTakeoff, cruise: drawCruise };
