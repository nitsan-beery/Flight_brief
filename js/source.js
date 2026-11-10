// "המקור בתדריך": עמוד 1 של התדריך, עם סימון של המקום שממנו נלקח הערך.
// CLAUDE.md: מכל תוצר אפשר להגיע למידע הגולמי בלחיצה אחת.

import { openPdf, renderPage } from './pdf/extract.js';

export function createSource({ dialog, body, page, canvas, mark, getBytes }) {
  let doc = null;
  let docBytes = null;

  dialog.querySelector('#source-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /** @param {{x,y,w,h}[]} boxes מלבנים ביחידות PDF; ריק = רק העמוד */
  async function open(boxes) {
    const bytes = getBytes();
    if (!bytes) return;
    if (!dialog.open) dialog.showModal();
    if (docBytes !== bytes) {
      if (doc) doc.destroy();
      doc = await openPdf(bytes);
      docBytes = bytes;
    }
    const width = Math.min(900, body.clientWidth - 24);
    const scale = await renderPage(doc, 1, canvas, width);
    page.style.width = `${width}px`;
    const bs = boxes.filter(Boolean);
    mark.hidden = !bs.length;
    if (!bs.length) return;
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    const pad = 3;
    Object.assign(mark.style, {
      left: `${x0 * scale - pad}px`, top: `${y0 * scale - pad}px`,
      width: `${(x1 - x0) * scale + 2 * pad}px`, height: `${(y1 - y0) * scale + 2 * pad}px`,
    });
    mark.scrollIntoView({ block: 'center', inline: 'center' });
  }

  return { open };
}
