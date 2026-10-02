import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPackage, pick } from './resolve.mjs';

function windowsCandidates() {
  const found = [];
  const programFiles = process.env['ProgramFiles'];
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env['LOCALAPPDATA'];
  const browsers = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['Chromium', 'Application', 'chrome.exe'],
  ];
  for (const base of [programFiles, programFilesX86, localAppData].filter(Boolean)) {
    for (const parts of browsers) {
      found.push(path.join(base, ...parts));
    }
  }
  return found;
}

function macCandidates() {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  ];
}

function linuxCandidates() {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/snap/bin/chromium',
    '/usr/bin/brave-browser',
  ];
}

/** First locally installed Chromium-based browser we can find, or null. */
export function findLocalBrowser() {
  const candidates =
    process.platform === 'win32'
      ? windowsCandidates()
      : process.platform === 'darwin'
        ? macCandidates()
        : linuxCandidates();

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Launch a Chromium browser, preferring, in order:
 *   1. an explicit --browser path
 *   2. $MD2PDF_BROWSER
 *   3. a locally installed Chrome / Edge / Chromium
 *   4. a browser Playwright manages itself (channel, then bundled download)
 */
export async function launchBrowser({ explicitPath, chromiumModule } = {}) {
  const playwright = chromiumModule ? null : await loadPackage('playwright-core');
  const chromium = chromiumModule || pick(playwright, 'chromium');
  if (!chromium) throw new Error('playwright-core is required to render PDFs.');

  const wanted = explicitPath || process.env.MD2PDF_BROWSER || findLocalBrowser() || null;

  const attempts = [];
  if (wanted) {
    attempts.push({ label: wanted, options: { executablePath: wanted } });
  }
  attempts.push({ label: 'Playwright channel: chrome', options: { channel: 'chrome' } });
  attempts.push({ label: 'Playwright channel: msedge', options: { channel: 'msedge' } });
  attempts.push({ label: 'Playwright bundled Chromium', options: {} });

  const launchArgs = [
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--no-default-browser-check',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({
        ...attempt.options,
        headless: true,
        args: launchArgs,
      });
      return { browser, label: attempt.label };
    } catch (err) {
      errors.push(`${attempt.label}: ${err.message.split('\n')[0]}`);
    }
  }

  const error = new Error(
    'No usable Chromium browser found. Install Google Chrome or Microsoft Edge, ' +
      `or point the tool at one with --browser <path> / $MD2PDF_BROWSER.\n` +
      `Tried:\n  ${errors.join('\n  ')}`
  );
  error.code = 'MD2PDF_NO_BROWSER';
  throw error;
}
