// שכבת חילוץ מעל PDF.js: פריטי טקסט עם מיקום, וקיבוץ שלהם לשורות.
// הטקסט הגולמי של התדריך מתערבב בין עמודות, ולכן הניתוח עובד לפי מיקומי המילים (requirements.md, סעיף 4.1).

import * as pdfjs from '../../vendor/pdfjs/pdf.mjs';

const WORKER_URL = new URL('../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

let workerConfigured = false;
function configureWorker() {
  if (workerConfigured) return;
  // בדפדפן: worker אמיתי. ב-Node (כלים ובדיקות) אין Worker, ו-PDF.js מעבד בתהליך הראשי.
  if (typeof Worker !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
  workerConfigured = true;
}

/** פותח מסמך PDF. */
export async function openPdf(data) {
  configureWorker();
  return pdfjs.getDocument({ data: toBytes(data), useSystemFonts: true, isEvalSupported: false }).promise;
}

/**
 * פריטי הטקסט של עמוד אחד.
 * Item = {s, x, y, w, h}: x,y הפינה השמאלית-תחתונה בקואורדינטות התצוגה (y גדל כלפי מטה), ביחידות PDF.
 * @returns {Promise<{width:number, height:number, items:Item[]}>}
 */
export async function extractPage(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const t = pdfjs.Util.transform(vp.transform, it.transform);
    items.push({ s: it.str.trim(), x: round1(t[4]), y: round1(t[5]), w: round1(it.width || 0), h: round1(it.height || Math.abs(t[3]) || 0) });
  }
  page.cleanup();
  return { width: vp.width, height: vp.height, items };
}

// PDF.js דורש Uint8Array משלו: הוא מעביר את הבאפר ל-worker. לכן תמיד עותק, כדי שהמקור יישאר שמיש.
function toBytes(data) {
  const view = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
  return view.slice();
}

const round1 = (n) => Math.round(n * 10) / 10;
