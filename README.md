# md2pdf-local

把 Markdown 转成排版干净的 PDF，**全程在本机完成**：不调用任何在线转换服务，不把文件内容发到任何地方。

> Offline Markdown → PDF converter. Renders with `marked` + a **locally installed** Chrome / Edge / Chromium.
> Every http(s) request from the rendered page is blocked by default, so the document never leaves your machine.

## 为什么用这个

- **隐私优先**：默认拦截页面发出的所有 `http(s)` 请求，转换结束后会报告拦截数量，正常情况下是 0。
- **零安装可用**：如果本机已有 Node 运行时自带的 `marked` / `playwright-core`（例如 Codex 环境），不需要 `npm install` 就能直接跑。
- **中英文排版友好**：内置样式针对中文行高、GFM 宽表格换行、代码块折行做了处理，不需要额外配置。
- **自检**：生成后会自动做结构校验（页数、空白页、文字是否越界），有问题会直接告诉你。
- **可定制**：支持追加自己的 CSS、调整纸张、页边距、字号、横竖版。

## 环境要求

- Node.js 18 或更高版本
- 本机安装 Google Chrome / Microsoft Edge / Chromium 之一（工具会自动查找；也可以用 `--browser` 指定）
- 三个 JS 依赖：`marked`、`pdf-lib`、`playwright-core`（可选 `pdfjs-dist` 用于自检）

## 安装

方式一：直接用本仓库

```bash
git clone https://github.com/<your-name>/md2pdf-local.git
cd md2pdf-local
npm install          # 只需要一次；若本机运行时已自带依赖，可跳过
node bin/md2pdf.mjs report.md
```

方式二：全局安装

```bash
npm install -g .
md2pdf report.md
```

依赖也可以单独指定位置，便于在受限环境下使用：

```bash
MD2PDF_MODULES="D:/shared/node_modules" node bin/md2pdf.mjs report.md
```

## 用法

```bash
md2pdf <input.md> [options]
md2pdf --check <file.pdf>
```

常用示例：

```bash
# 最简：输出同名 PDF 到源文件旁边
md2pdf 分析报告.md

# 指定输出、纸张方向、页边距、字号
md2pdf 分析报告.md -o out/report.pdf --paper A4 --landscape --margin 16mm,15mm,15mm,15mm --font-size 10.5

# 追加自定义样式（在内置样式之后生效）
md2pdf report.md -c brand.css -c print-fixes.css

# 指定浏览器，不要页脚页码，输出机器可读的结果
md2pdf report.md --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --no-page-numbers --json

# 校验一个已有 PDF：页数、空白页、越界文字
md2pdf --check out/report.pdf
```

### 参数

| 参数 | 说明 |
|---|---|
| `-o, --output <file>` | 输出路径，默认把输入后缀换成 `.pdf` |
| `-c, --css <file>` | 追加样式表，可重复；在内置样式之后加载 |
| `--paper <name>` | `A4`（默认）/ `A3` / `A5` / `Letter` / `Legal` / `Tabloid` |
| `--landscape` | 横向 |
| `--scale <n>` | 渲染缩放，0.1–2，默认 1 |
| `--margin <spec>` | 单值（四边相同）或 `上,右,下,左`，单位 `mm`/`cm`/`in`/`px`/`pt` |
| `--font-size <pt>` | 正文字号，默认 10.5pt |
| `--title <text>` | PDF 元数据标题，默认文件名 |
| `--no-page-numbers` | 不显示页脚页码 |
| `--browser <path>` | 指定浏览器可执行文件 |
| `--allow-network` | **关闭**网络拦截（默认拦截，见下方隐私说明） |
| `--no-check` | 跳过生成后的结构校验 |
| `--strict` | 校验发现问题时以退出码 4 结束 |
| `--json` | 输出 JSON，便于脚本调用 |

## 隐私说明

- 转换过程只用本机的 Chromium 内核渲染，输出文件写在本地磁盘。
- 渲染页面时，除 `file:` / `data:` / `blob:` 之外的请求（也就是所有 `http(s)`）都会被阻断并计数。
- 工具不上传、不缓存、不记录文档内容；控制台和 `--json` 输出里只有路径、页数、字节数这类统计信息。
- 唯一会联网的情况是显式传入 `--allow-network`，用于文档里确实需要加载远程图片的场景；此时远程服务器会收到请求（但文档内容仍然不会被上传）。
- 如果文档引用了远程图片而你没有开启 `--allow-network`，图片位置会留空，这是预期行为。

## 支持的 Markdown 语法

- 标准 Markdown + GFM：表格、任务列表（`- [x]`）、删除线、自动链接
- 围栏代码块（原样保留，等宽字体、自动折行）
- `<div class="page"/>` 或 `<div class="page"></div>` 强制分页
- 开头的 YAML front matter 会被忽略，不会渲染成正文
- 原文中的原始 HTML 会按原样输出（不做 sanitize），请只转换自己信任的文档

未内置（需要本地库才能渲染）：Mermaid、PlantUML、KaTeX 数学公式。它们在文档里会以代码块或原文形式出现。如果你需要，可以自行引入本地版本的渲染库并通过 `--css` 之外的扩展方式接入。

## 自定义样式

内置样式位于 [`assets/report.css`](assets/report.css)，可以在里面直接改字体、颜色、表格边框，或者用 `-c my.css` 覆盖单个规则：

```css
/* my.css */
:root {
  --md2pdf-accent: #0f766e;
  --md2pdf-font-size: 11pt;
}

body { font-family: "Source Han Serif SC", "Songti SC", serif; }
table { font-size: 0.9em; }
```

## 自检说明

生成 PDF 后，工具会用 `pdfjs-dist` 做一次结构检查：

- 页数与页面尺寸
- 空白页
- 文字是否从页边距之外开始，或越过页面边缘

检查结果只是提示，不会修改文件；如果不希望检查，加 `--no-check`，如果希望有问题就报错退出，加 `--strict`。

> 注意：彩色 emoji 字体在 PDF 文本层可能给出虚假的字形宽度，工具已经对这种情况做了过滤，但仍建议生成后自己翻一遍最终文件。

## 故障排查

| 现象 | 处理 |
|---|---|
| `Cannot find package "marked"` | 在仓库目录执行 `npm install`，或设置 `MD2PDF_MODULES` 指向已有依赖目录 |
| `No usable Chromium browser found` | 安装 Chrome/Edge，或用 `--browser` / `MD2PDF_BROWSER` 指定路径 |
| 中文显示成方块 | 说明系统缺少中文字体；安装思源黑体/微软雅黑，或在自定义 CSS 里指定已安装字体 |
| 生成的 PDF 里远程图片缺失 | 默认离线模式的预期行为；确认来源可信后可加 `--allow-network` |
| Windows 路径包含反斜杠 | JSON 配置里需要写成 `\\`，命令行里用引号包住即可 |

## 开发

```bash
npm test        # 生成一份临时 PDF 并校验，随后清理
```

目录结构：

```
bin/md2pdf.mjs    CLI：参数解析与输出
src/resolve.mjs   依赖查找（本地 / 全局 / 运行时内置）
src/browser.mjs   浏览器查找与启动
src/render.mjs    Markdown → HTML → PDF
src/verify.mjs    PDF 结构校验
assets/report.css 默认样式
```

## License

[MIT](LICENSE)
