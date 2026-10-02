#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPdf } from '../src/render.mjs';
import { verifyPdf } from '../src/verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

const HELP = `md2pdf-local ${pkg.version} - offline Markdown to PDF converter

Usage:
  md2pdf <input.md> [options]
  md2pdf --check <file.pdf>

Options:
  -o, --output <file>     Output PDF path (default: input name with .pdf)
  -c, --css <file>        Extra stylesheet, applied after the built-in one (repeatable)
      --paper <name>      A4 (default), A3, A5, Letter, Legal, Tabloid
      --landscape         Landscape orientation
      --scale <n>         Render scale, 0.1-2 (default: 1)
      --margin <spec>     One value for all sides, or top,right,bottom,left
                          e.g. "18mm" or "16mm,15mm,15mm,15mm" (mm, cm, in, px, pt)
      --font-size <pt>    Base font size (default: 10.5)
      --title <text>      PDF metadata title (default: file name)
      --no-page-numbers   Hide the "n / total" footer
      --browser <path>    Chrome/Edge/Chromium executable to use
      --allow-network     Do NOT block http(s) requests (off by default: fully offline)
      --no-check          Skip the structural PDF check after rendering
      --strict            Exit with code 4 when the PDF check finds problems
      --json              Machine-readable output
  -h, --help              Show this help
  -v, --version           Show version

Privacy: the document is rendered and stored locally. All network requests from
the rendered page are blocked unless --allow-network is given.
`;

const MARGIN_RE = /^\d*\.?\d+(mm|cm|in|px|pt)$/;

function parseMargin(spec) {
  const parts = spec.split(',').map((part) => part.trim());
  if (parts.length === 1 && MARGIN_RE.test(parts[0])) {
    const [all] = parts;
    return { top: all, right: all, bottom: all, left: all };
  }
  if (parts.length === 4 && parts.every((part) => MARGIN_RE.test(part))) {
    const [top, right, bottom, left] = parts;
    return { top, right, bottom, left };
  }
  throw new Error(`Invalid --margin value: "${spec}" (expected e.g. 18mm or 16mm,15mm,15mm,15mm)`);
}

function parseArgs(argv) {
  const options = { cssFiles: [], pageNumbers: true, allowNetwork: false, check: true };
  const positional = [];

  const takesValue = new Set([
    '-o', '--output', '-c', '--css', '--paper', '--scale', '--margin', '--font-size',
    '--title', '--browser', '--check',
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (takesValue.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      i += 1;
      switch (arg) {
        case '-o': case '--output': options.output = value; break;
        case '-c': case '--css': options.cssFiles.push(value); break;
        case '--paper': options.paper = value; break;
        case '--scale': options.scale = Number(value); break;
        case '--margin': options.margin = parseMargin(value); break;
        case '--font-size': options.fontSize = Number(value); break;
        case '--title': options.title = value; break;
        case '--browser': options.browserPath = value; break;
        case '--check': options.checkFile = value; break;
        default: break;
      }
      continue;
    }

    switch (arg) {
      case '--landscape': options.landscape = true; break;
      case '--no-page-numbers': options.pageNumbers = false; break;
      case '--allow-network': options.allowNetwork = true; break;
      case '--no-check': options.check = false; break;
      case '--strict': options.strict = true; break;
      case '--json': options.json = true; break;
      case '-h': case '--help': options.help = true; break;
      case '-v': case '--version': options.version = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        positional.push(arg);
        break;
    }
  }

  options.input = positional[0];
  return options;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function checkSummary(report) {
  if (!report || report.skipped) return { status: 'skipped', problems: [] };
  const problems = [];
  for (const page of report.blankPages) problems.push(`blank page ${page}`);
  for (const item of report.textStartingOutsideMargin) {
    problems.push(`text starts outside the margin on page ${item.page} (x=${item.x})`);
  }
  for (const item of report.textRunningPastPageEdge) {
    problems.push(`text passes the page edge on page ${item.page} (right=${item.right})`);
  }
  return { status: problems.length ? 'warnings' : 'clean', problems };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.version) {
    console.log(pkg.version);
    return;
  }

  if (options.checkFile) {
    if (!fs.existsSync(options.checkFile)) {
      console.error(`File not found: ${options.checkFile}`);
      process.exit(2);
    }
    const report = await verifyPdf(options.checkFile);
    const summary = checkSummary(report);
    if (options.json) {
      console.log(JSON.stringify({ ...report, problems: summary.problems }, null, 2));
    } else if (report.skipped) {
      console.error(`Check skipped: ${report.reason}`);
      process.exit(3);
    } else {
      console.log(`Pages      : ${report.pages}  (${report.pageSizes.join(', ')})`);
      console.log(`Characters : ${report.totalChars} total, ${report.cjkChars} CJK`);
      console.log(`Problems   : ${summary.problems.length ? summary.problems.join('; ') : 'none'}`);
    }
    if (summary.problems.length && options.strict) process.exit(4);
    return;
  }

  if (!options.input) {
    console.error(HELP);
    process.exit(2);
  }

  const result = await renderPdf({
    input: options.input,
    output: options.output,
    paper: options.paper || 'A4',
    landscape: Boolean(options.landscape),
    scale: options.scale || 1,
    margin: options.margin,
    fontSize: options.fontSize,
    pageNumbers: options.pageNumbers,
    title: options.title,
    cssFiles: options.cssFiles,
    browserPath: options.browserPath,
    allowNetwork: options.allowNetwork,
  });

  let check = null;
  if (options.check) check = checkSummary(await verifyPdf(result.output));

  if (options.json) {
    console.log(JSON.stringify({ ...result, check }, null, 2));
  } else {
    console.log(`PDF      : ${result.output}`);
    console.log(`Pages    : ${result.pages ?? 'unknown'}   Size: ${formatBytes(result.bytes)}`);
    console.log(`Browser  : ${result.browser}`);
    console.log(`Network  : ${result.blockedNetworkRequests} request(s) blocked (offline mode)`);
    if (check && check.status !== 'skipped') {
      console.log(`Check    : ${check.problems.length ? check.problems.join('; ') : 'clean'}`);
    }
  }

  if (options.strict && check && check.problems.length) process.exit(4);
}

main().catch((err) => {
  console.error(err.code ? `[${err.code}] ${err.message}` : err.message);
  process.exit(1);
});
