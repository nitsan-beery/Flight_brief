// הדפית בחלון צף מעל אפליקציות אחרות. requirements.md, סעיף 5.1.2.
//
// אייפד (Safari/Chrome): החלון הצף של המערכת מקבל רק וידאו. הדפית מצוירת על canvas, מוזרמת לווידאו
// (captureStream) ונפתחת ב-Picture-in-Picture, לקריאה בלבד. פריים חדש מצויר רק כשערך משתנה.
// מאפליקציה שהותקנה למסך הבית הפתיחה נכשלת (באג WebKit 303885): מנסים, וכשנכשל מציגים הסבר.
// Windows (Chrome/Edge): Document Picture-in-Picture, חלון HTML אמיתי שאפשר לערוך בו.

import { MISSING } from './sheet.js';

const FONT = '-apple-system, system-ui, "Segoe UI", Arial, sans-serif';
const W = 600;

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * @param {{canvas, video, getData:()=>({brief, manual}|null), getSheet:()=>HTMLElement|null,
 *          onState:(open:boolean, kind:'video'|'doc'|null)=>void, onDocClosed:()=>void}} o
 */
export function createFloat(o) {
  const { canvas, video } = o;
  let stream = null;
  let docWin = null;

  function draw() {
    const d = o.getData();
    if (!d) return;
    drawSheet(canvas, d.brief, d.manual);
  }

  /** מכין את הזרם מראש: הפתיחה עצמה חייבת לקרות מיד בלחיצה, על וידאו שכבר מנגן. */
  function prepare() {
    if (docSupported() || stream || !canvas.captureStream) { draw(); return; }
    draw();
    try {
      stream = canvas.captureStream();
      video.srcObject = stream;
      draw();
      video.play().catch(() => {});
    } catch { stream = null; }
  }

  const docSupported = () => 'documentPictureInPicture' in window;
  const videoOpen = () => document.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
  const isOpen = () => !!docWin || videoOpen();

  video.addEventListener('enterpictureinpicture', () => o.onState(true, 'video'));
  video.addEventListener('leavepictureinpicture', () => o.onState(false, null));
  video.addEventListener('webkitpresentationmodechanged', () => o.onState(videoOpen(), videoOpen() ? 'video' : null));

  async function openDoc() {
    const sheet = o.getSheet();
    if (!sheet) return;
    const rect = sheet.getBoundingClientRect();
    docWin = await documentPictureInPicture.requestWindow({ width: Math.round(Math.min(640, rect.width + 24)), height: Math.round(Math.min(screen.availHeight * 0.85, rect.height + 24)) });
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
    docWin.addEventListener('pagehide', () => { docWin = null; o.onState(false, null); o.onDocClosed(); });
    o.onState(true, 'doc');
  }

  /** @returns {Promise<string|null>} הודעה למשתמש כשהחלון לא נפתח */
  async function open() {
    if (docSupported()) {
      try { await openDoc(); return null; } catch (e) { return `החלון הצף לא נפתח (${e.name}).`; }
    }
    prepare();
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

  function close() {
    if (docWin) { docWin.close(); return; }
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else if (video.webkitPresentationMode === 'picture-in-picture') video.webkitSetPresentationMode('inline');
  }

  function syncTheme() {
    if (!docWin) return;
    const t = document.documentElement.dataset.theme;
    if (t) docWin.document.documentElement.dataset.theme = t;
    else delete docWin.document.documentElement.dataset.theme;
  }

  /** ערך השתנה או ערכת הצבעים התחלפה. */
  function update() { draw(); syncTheme(); }

  return { prepare, open, close, update, isOpen, docOpen: () => !!docWin };
}

// ---- ציור הדפית לווידאו: אותו עיצוב כמו במסך (5.1.1), לקריאה בלבד ----

function drawSheet(canvas, brief, manual) {
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const c = { sheet: css('--sheet'), card: css('--card'), fld: css('--fld'), tx: css('--tx'), tx2: css('--tx2'), bx: css('--bx'), ac: css('--ac'), bad: css('--bad') };
  const names = (l) => l.map((s) => s.trim()).filter(Boolean);
  const cab = names(manual.cab), ck = names(manual.ck);
  const crewRows = Math.max(1, cab.length, ck.length);
  const H = 630 + crewRows * 24; // כותרת 112, ארבעה מקטעים של 104, צוות 66 + שורות, תחתית 36
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;

  const ctx = canvas.getContext('2d');
  const rr = (x, y, w, h, r, fill, stroke) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  };
  const txt = (s, x, y, size, color, opt = {}) => {
    ctx.font = `${opt.w || 400} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.direction = opt.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = opt.align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  };
  const f = brief.fields;
  const v = (k) => (f[k].missing ? MISSING : f[k].value);
  const M = 24, G = 12, IW = W - 2 * M;

  ctx.clearRect(0, 0, W, H);
  rr(0, 0, W, H, 0, c.sheet);
  txt(brief.flight, M, 52, 30, c.tx, { w: 600 });
  txt(`${brief.org} → ${brief.dst} · ${brief.reg} · ${v('type')}`, M, 80, 17, c.tx2);
  txt(v('date'), W - M, 44, 15, c.tx2, { align: 'right' });
  txt(`OFP ${brief.ofp}`, W - M, 66, 15, c.tx2, { align: 'right' });

  let y = 112;
  const section = (t) => { txt(t, W - M, y, 15, c.tx2, { rtl: true, align: 'right' }); y += 10; };
  const cells = (spec, h = 72) => {
    const total = spec.reduce((a, s) => a + (s.f || 1), 0);
    const unit = (IW - G * (spec.length - 1)) / total;
    let x = M;
    for (const s of spec) {
      const w = unit * (s.f || 1);
      rr(x, y, w, h, 10, c.card);
      if (s.heb) txt(s.l, x + w - 12, y + 22, 14, c.tx2, { rtl: true, align: 'right' }); else txt(s.l, x + 12, y + 22, 14, c.tx2);
      if (s.lines) s.lines.forEach((n, k) => txt(n, x + w - 12, y + 48 + k * 24, 19, c.tx, { rtl: true, align: 'right' }));
      else txt(s.v || '—', x + 20, y + 55, s.missing ? 18 : 21, s.missing ? c.bad : (s.col || c.tx));
      x += w + G;
    }
    y += h + 22;
  };
  const m = (k) => (manual[k] ?? '').trim();
  const plan = f.bf.missing ? null : f.bf.value;
  const bf = m('bf');

  section('זמנים');
  cells([{ l: 'STD – STA', v: `${v('std')} – ${v('sta')}`, f: 2, missing: f.std.missing || f.sta.missing }, { l: 'ETE', v: v('ete'), missing: f.ete.missing }]);
  section('דלק ומשקל');
  cells([
    { l: 'T.F', v: v('tf'), missing: f.tf.missing },
    { l: 'T.O.W', v: v('tow'), missing: f.tow.missing },
    { l: `B.F (${plan ?? MISSING})`, v: bf, col: plan !== null && bf !== plan ? c.ac : c.tx },
  ]);
  section('צוות');
  cells([{ l: 'קבינה', heb: 1, lines: cab }, { l: 'קוקפיט', heb: 1, lines: ck }], 34 + crewRows * 24);
  section('Loadsheet');
  cells([{ l: 'CG (MACTOW)', v: m('cg') }, { l: 'SOB', v: m('sob') }]);
  section('OPT');
  cells([{ l: 'N1', v: m('n1') }, { l: 'V1', v: m('v1') }, { l: 'VR', v: m('vr') }, { l: 'V2', v: m('v2') }]);
  txt('כלי עזר בלבד', W - M, H - 20, 13, c.tx2, { rtl: true, align: 'right' });
}
