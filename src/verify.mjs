import fs from 'node:fs';
import { loadPackageOptional, pick } from './resolve.mjs';

/**
 * Structural PDF checks. Reports counts and geometry only - never text content.
 * Requires the optional dependency pdfjs-dist.
 */
export async function verifyPdf(file) {
  const pdfjs = await loadPackageOptional('pdfjs-dist', ['legacy/build/pdf.mjs']);
  const getDocument = pick(pdfjs, 'getDocument');
  if (!getDocument) {
    return { ok: false, skipped: true, reason: 'pdfjs-dist is not installed (npm install pdfjs-dist)' };
  }

  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;

  const report = {
    ok: true,
    pages: doc.numPages,
    totalChars: 0,
    cjkChars: 0,
    blankPages: [],
    textStartingOutsideMargin: [],
    textRunningPastPageEdge: [],
    pageSizes: [],
  };

  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    let chars = 0;

    for (const item of text.items) {
      if (typeof item.str !== 'string') continue;
      chars += item.str.length;
      for (const ch of item.str) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x4e00 && cp <= 0x9fff) report.cjkChars += 1;
      }
      const x = item.transform[4];
      const width = typeof item.width === 'number' ? item.width : 0;
      // A single glyph with an absurd width is usually a text-layer metric artifact
      // (color emoji fonts); only trust widths that are plausible for a text run.
      if (x > viewport.width - 34) report.textStartingOutsideMargin.push({ page: index, x: Math.round(x) });
      if (width < viewport.width * 0.6 && x + width > viewport.width - 1) {
        report.textRunningPastPageEdge.push({ page: index, x: Math.round(x), right: Math.round(x + width) });
      }
    }

    if (chars === 0) report.blankPages.push(index);
    report.totalChars += chars;
    report.pageSizes.push(`${Math.round(viewport.width)}x${Math.round(viewport.height)}pt`);
  }

  report.pageSizes = [...new Set(report.pageSizes)];
  return report;
}
