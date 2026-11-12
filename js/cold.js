// דפית Cold weather לחלון הצף: תזכורת קבועה, לא תלויה בתדריך. requirements.md, סעיף 5.1.2 (גרסה 36).
// מצוירת על ה-canvas של החלון הצף, באותם צבעים ובאותו רוחב כמו שאר הדפיות שב-float.js.

export const COLD = {
  title: 'Cold weather operations',
  steps: [
    ['Preflight', ['Probe Heat ON']],
    ['Before Taxi', ['Eng (Wing) A.I', 'FLAPS 0-40-0']],
    ['Line Up', ['Eng. Run up']],
    ['After T.O', ['Flaps → up', 'Bank Angle 15']],
  ],
};

const FONT = '-apple-system, system-ui, "Segoe UI", Arial, sans-serif';
const W = 600, M = 16, G = 8, PAD = 10, LS = 15, MAX = 20, MIN = 12;

/** הגודל הגדול ביותר (עד MAX) שבו השורה הארוכה נכנסת ברוחב. measure(text, size) מחזיר רוחב. */
export function fitSize(lines, maxW, measure) {
  let size = MAX;
  while (size > MIN && lines.some((t) => measure(t, size) > maxW)) size--;
  return size;
}

export function drawCold(canvas) {
  const ctx = canvas.getContext('2d');
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const c = { sheet: css('--sheet'), card: css('--card'), tx: css('--tx'), tx2: css('--tx2') };
  const cw = (W - 2 * M - G * (COLD.steps.length - 1)) / COLD.steps.length;
  const measure = (t, size) => { ctx.font = `400 ${size}px ${FONT}`; return ctx.measureText(t).width; };
  const vs = fitSize(COLD.steps.flatMap(([, l]) => l), cw - 2 * PAD, measure);
  const lh = Math.round(vs * 1.35);
  const rows = Math.max(...COLD.steps.map(([, l]) => l.length));
  const top = 52, cellH = PAD + LS + 8 + rows * lh + PAD;
  const H = top + cellH + M;

  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = c.sheet;
  ctx.fillRect(0, 0, W, H);
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const txt = (s, x, y, size, color, w = 400) => { ctx.font = `${w} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.fillText(s, x, y); };

  txt(COLD.title, M, 34, 20, c.tx2, 600);
  COLD.steps.forEach(([label, lines], i) => {
    const x = M + i * (cw + G);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, top, cw, cellH, 10); else ctx.rect(x, top, cw, cellH);
    ctx.fillStyle = c.card;
    ctx.fill();
    txt(label, x + PAD, top + PAD + LS, LS, c.tx2);
    lines.forEach((t, k) => txt(t, x + PAD, top + PAD + LS + 8 + lh * (k + 1) - (lh - vs) / 2, vs, c.tx));
  });
}
