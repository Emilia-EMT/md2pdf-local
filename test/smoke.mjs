import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPdf } from '../src/render.mjs';
import { verifyPdf } from '../src/verify.mjs';

const SAMPLE = `# 冒烟测试 / Smoke test

这是一个用于验证渲染管线的示例文档，包含中文、表格和代码块。

| 项目 | 说明 | 数值 |
|---|---|---|
| 渲染 | 本地 Chromium | 11 |
| 网络 | 全部阻断 | 0 |

<div class="page"/>

## 代码

\`\`\`js
const answer = 42;
\`\`\`
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf-smoke-'));
const input = path.join(dir, 'smoke.md');
const output = path.join(dir, 'smoke.pdf');

fs.writeFileSync(input, SAMPLE, 'utf8');

try {
  const result = await renderPdf({ input, output });
  const report = await verifyPdf(output);

  const failures = [];
  if (!fs.existsSync(output)) failures.push('no PDF was written');
  if (result.bytes < 1000) failures.push('PDF looks empty');
  if (!report.skipped && report.blankPages.length) failures.push(`blank pages: ${report.blankPages.join(',')}`);
  if (!report.skipped && report.cjkChars === 0) failures.push('no CJK text found in the PDF');
  if (result.blockedNetworkRequests > 0) failures.push('unexpected network activity');

  console.log(`pages=${result.pages} bytes=${result.bytes} cjk=${report.cjkChars ?? 'n/a'} blocked=${result.blockedNetworkRequests}`);
  if (failures.length) {
    console.error(`FAIL: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('OK');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
