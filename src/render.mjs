import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPackageOptional, pick, readAsset } from './resolve.mjs';
import { launchBrowser } from './browser.mjs';

const DEFAULT_MARGIN = { top: '16mm', bottom: '15mm', left: '15mm', right: '15mm' };

/** Drop a leading YAML front matter block so it is not rendered as text. */
export function stripFrontMatter(markdown) {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return markdown;
  const after = markdown.indexOf('\n', end + 1);
  return after === -1 ? markdown : markdown.slice(after + 1);
}

/** `<div class="page"/>` is the conventional page break in Markdown PDF tooling. */
export function applyPageBreaks(markdown) {
  return markdown
    .replace(/<div\s+class="page"\s*\/>\s*(?:<\/div>)?/gi, '<div class="page-break"></div>')
    .replace(/<div\s+class="page"\s*><\/div>/gi, '<div class="page-break"></div>');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildHtml({ markdown, title, baseDir, extraCss = [], fontSize }) {
  const baseCss = readAsset('assets/report.css');
  const sizeOverride = fontSize ? `:root { --md2pdf-font-size: ${fontSize}pt; }` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<base href="${pathToFileURL(baseDir + path.sep).href}">
<style>${baseCss}\n${sizeOverride}</style>
${extraCss.map((css) => `<style>${css}</style>`).join('\n')}
</head>
<body class="markdown-body">
${markdown}
</body>
</html>`;
}

function footerTemplate() {
  return (
    '<div style="width:100%;font-size:8px;color:#8b949e;text-align:center;margin:0 14mm;">' +
    '<span class="pageNumber"></span> / <span class="totalPages"></span></div>'
  );
}

/**
 * Render a Markdown file to PDF with a locally installed Chromium.
 * The document never leaves the machine: every http(s) request is blocked
 * unless `allowNetwork` is explicitly enabled.
 */
export async function renderPdf({
  input,
  output,
  paper = 'A4',
  landscape = false,
  scale = 1,
  margin = DEFAULT_MARGIN,
  fontSize,
  pageNumbers = true,
  title,
  cssFiles = [],
  browserPath,
  allowNetwork = false,
  markedModule,
} = {}) {
  const marked = markedModule || pick(await loadPackageOptional('marked'), 'marked');
  if (!marked) throw new Error('Cannot find package "marked". Install it with: npm install marked');

  const inputPath = path.resolve(input);
  if (!fs.existsSync(inputPath)) {
    const error = new Error(`Input file not found: ${inputPath}`);
    error.code = 'MD2PDF_INPUT_MISSING';
    throw error;
  }

  const outputPath = path.resolve(output || inputPath.replace(/\.(md|markdown|mdown|mkd)$/i, '') + '.pdf');
  const markdown = applyPageBreaks(stripFrontMatter(fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '')));
  const extraCss = cssFiles.map((file) => fs.readFileSync(path.resolve(file), 'utf8'));
  const docTitle = title || path.basename(inputPath).replace(/\.[^.]+$/, '');

  const html = buildHtml({
    markdown: marked.parse(markdown, { gfm: true, breaks: false }),
    title: docTitle,
    baseDir: path.dirname(inputPath),
    extraCss,
    fontSize,
  });

  const { browser, label } = await launchBrowser({ explicitPath: browserPath });
  let blockedRequests = 0;

  try {
    const context = await browser.newContext({ viewport: { width: 1240, height: 1754 } });
    if (!allowNetwork) {
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) {
          return route.continue();
        }
        blockedRequests += 1;
        return route.abort();
      });
    }

    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: 'print' });

    const pdfOptions = {
      format: paper,
      landscape,
      scale,
      printBackground: true,
      margin,
    };
    if (pageNumbers) {
      pdfOptions.displayHeaderFooter = true;
      pdfOptions.headerTemplate = '<div></div>';
      pdfOptions.footerTemplate = footerTemplate();
    }

    const raw = await page.pdf(pdfOptions);
    const pdfLib = await loadPackageOptional('pdf-lib');
    const PDFDocument = pick(pdfLib, 'PDFDocument');

    let bytes = raw;
    let pages = null;
    if (PDFDocument) {
      const doc = await PDFDocument.load(raw);
      pages = doc.getPageCount();
      doc.setTitle(docTitle);
      doc.setProducer('md2pdf-local (marked + local Chromium)');
      doc.setCreator('md2pdf-local');
      doc.setCreationDate(new Date());
      doc.setModificationDate(new Date());
      bytes = await doc.save();
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, bytes);

    return {
      ok: true,
      output: outputPath,
      bytes: bytes.length,
      pages,
      browser: label,
      blockedNetworkRequests: blockedRequests,
    };
  } finally {
    await browser.close();
  }
}
