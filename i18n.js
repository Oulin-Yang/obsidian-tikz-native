'use strict';

const messages = {
  language: ['界面语言 / Language', 'Language / 界面语言'],
  intro: [
    '调用本机 LaTeX 环境。请关闭同样注册 tikz 代码块的插件（如 TikZJax），避免渲染冲突。',
    'Use your local LaTeX installation. Disable other plugins that register tikz code blocks, such as TikZJax, to avoid rendering conflicts.'
  ],
  local: ['开启本地编译', 'Enable local compilation'],
  localHelp: [
    '仅对可信仓库开启。TeX 可读取本机文件。关闭 shell escape 仍无法隔离 TeX 或 Lua。插件不会上传图形内容。',
    'Enable this only for trusted vaults. TeX can read local files. Disabling shell escape still leaves TeX and Lua with access to local resources. The plugin does not upload diagram content.'
  ],
  engine: ['默认编译器', 'Default compiler'],
  engineHelp: [
    'LuaLaTeX 支持 graphdrawing。中文可用 XeLaTeX 或 LuaLaTeX 配合 ctex。代码首行 % !TeX program = xelatex 可覆盖默认值。',
    'LuaLaTeX supports graphdrawing. For Chinese text, use XeLaTeX or LuaLaTeX with ctex. Start a code block with % !TeX program = xelatex to override the default.'
  ],
  texPath: ['LaTeX 程序路径（可留空）', 'LaTeX executable path (optional)'],
  texPathHelp: [
    '填写可执行文件的完整路径。若使用代码块中的编译器指令，请留空以自动定位程序。',
    'Enter the full path to the executable. Leave blank to discover the compiler selected by a directive in a code block.'
  ],
  converterPath: ['首选 SVG 转换器路径（可留空）', 'Preferred SVG converter path (optional)'],
  converterPathHelp: [
    '自动寻找 mutool、pdftocairo、已有的便携 Poppler 和 dvisvgm。首选工具失败后会尝试其他已找到的工具。',
    'Automatically discover mutool, pdftocairo, an existing portable Poppler installation, and dvisvgm. If the preferred converter fails, try the other available tools.'
  ],
  preamble: ['全局导言区', 'Global preamble'],
  preambleHelp: [
    '例如 \\usepackage{pgfplots} 或 \\usetikzlibrary{arrows.meta,calc}。此处内容也会加入完整文档。建议在代码块内声明包选项。',
    'Examples include \\usepackage{pgfplots} and \\usetikzlibrary{arrows.meta,calc}. This preamble is also inserted into full documents. Declare package options in the code block.'
  ],
  timeout: ['每步超时（秒）', 'Timeout per step (seconds)'],
  adaptive: ['按需重复编译', 'Run extra passes as needed'],
  adaptiveHelp: [
    '普通图编译一次。日志要求重跑时，继续编译到次数上限。若文档需要固定次数，可关闭此选项。',
    'Most diagrams compile in one pass. When the log asks for another pass, compilation continues up to the limit. Turn this off to use a fixed number of passes.'
  ],
  passes: ['编译次数上限', 'Compilation pass limit'],
  passesHelp: ['按需模式通常设为 2。固定模式会执行所选次数。', 'Two passes usually suffice in adaptive mode. Fixed mode runs the selected number of passes.'],
  theme: ['图形主题', 'Diagram theme'],
  themeHelp: ['默认跟随系统。切换主题只更新显示。', 'Follows the system by default. Changing the theme only updates the display.'],
  system: ['跟随系统（默认）', 'Follow system (default)'],
  obsidian: ['跟随 Obsidian', 'Follow Obsidian'],
  light: ['始终浅色', 'Always light'],
  dark: ['始终深色', 'Always dark'],
  appearance: ['颜色处理', 'Color handling'],
  appearanceHelp: [
    '默认使用透明画布，线条、文字和填充按主题配色。浅色模式和打印保留原配色。',
    'The default transparent canvas adapts lines, text, and fills to the theme. Light mode and printing retain the original colors.'
  ],
  auto: ['透明画布，自动适配配色（默认）', 'Transparent canvas with adaptive colors (default)'],
  paper: ['始终保留原图和浅色底', 'Always use original colors on a light background'],
  apply: ['应用设置并重新渲染', 'Apply settings and render again'],
  rerender: ['重新渲染', 'Render again'],
  check: ['检查编译环境', 'Check compilation environment'],
  checkButton: ['检查', 'Check'],
  checking: ['检查中…', 'Checking…'],
  enableFirst: ['请先开启本地编译。', 'Enable local compilation first.'],
  disabled: ['TikZ Native：请先在插件设置中开启本地编译。', 'TikZ Native: Enable local compilation in the plugin settings.'],
  compiling: ['正在编译 TikZ…', 'Compiling TikZ…'],
  desktopOnly: ['本插件需要桌面端本地仓库。', 'This plugin requires a local vault in Obsidian Desktop.'],
  page: ['TikZ 图，第 {0} 页', 'TikZ diagram, page {0}'],
  failed: ['TikZ 编译失败', 'TikZ compilation failed'],
  logs: ['查看原因与编译日志', 'Show details and compiler log'],
  retry: ['重试', 'Retry'],
  refresh: ['清除缓存并重新渲染', 'Clear cache and render again'],
  missingBegin: ['完整文档缺少 \\begin{document}。', 'The full document is missing \\begin{document}.'],
  missingEnd: ['缺少 \\end{document}。', 'Missing \\end{document}.'],
  invalidClass: ['无法识别 documentclass 声明。', 'Could not read the \\documentclass declaration.'],
  noDrawing: [
    '未找到绘图内容。请使用 tikzpicture、其他绘图环境或完整 LaTeX 文档。',
    'No drawing found. Use a tikzpicture, another drawing environment, or a complete LaTeX document.'
  ],
  invalidEngine: ['编译器仅支持 lualatex、xelatex、pdflatex。', 'Supported compilers are lualatex, xelatex, and pdflatex.'],
  missingProgram: [
    '找不到 {0}。请安装 TeX Live 或 MacTeX，或在插件设置中填写程序的绝对路径。',
    'Could not find {0}. Install TeX Live or MacTeX, or enter the absolute executable path in the plugin settings.'
  ],
  missingConverter: [
    '找不到 PDF 转 SVG 工具。请安装 MuPDF（mutool）、Poppler（pdftocairo 和 pdfinfo）或支持 PDF 的 dvisvgm。',
    'No PDF-to-SVG converter found. Install MuPDF (mutool), Poppler (pdftocairo and pdfinfo), or dvisvgm with PDF support.'
  ],
  stopped: ['插件已停止。', 'The plugin has stopped.'],
  outdated: ['已取消过期的绘图请求。', 'Canceled an outdated render request.'],
  executableMissing: ['找不到程序 {0}。', 'Executable not found: {0}.'],
  timedOut: ['编译超时或被取消（每步上限 {0} 秒）。', 'Compilation timed out or was canceled (limit of {0} seconds per step).'],
  executableFailed: ['{0} 运行失败。', '{0} failed.'],
  missingGlyphs: [
    '字体缺少所需字符。中文请使用 XeLaTeX 或 LuaLaTeX 配合 ctex。',
    'The font lacks required characters. For Chinese text, use XeLaTeX or LuaLaTeX with ctex.'
  ],
  allConvertersFailed: ['所有可用的 SVG 转换器均失败。', 'All available SVG converters failed.'],
  missingPageCount: ['pdfinfo 未返回 PDF 页数。', 'pdfinfo did not report a PDF page count.'],
  incompleteFonts: ['SVG 转换丢失字体，已停止显示不完整图形。', 'SVG conversion lost font information. The incomplete diagram was omitted.'],
  missingFontData: [
    'Poppler 缺少字体或 CJK 映射。请安装完整的 Poppler 数据包或 MuPDF，也可以安装 Ghostscript 将字体转为轮廓。',
    'Poppler is missing fonts or CJK maps. Install the full Poppler data package or MuPDF, or install Ghostscript to convert fonts to outlines.'
  ],
  dvisvgmHint: [
    '新版 Ghostscript 无法替代 mutool。若 dvisvgm 报页数错误，请安装 MuPDF（mutool）或将转换器路径改为 pdftocairo。',
    'Recent Ghostscript versions cannot replace mutool. If dvisvgm reports a page count error, install MuPDF (mutool) or set the converter path to pdftocairo.'
  ],
  missingSvg: ['转换器未生成 SVG。请检查 dvisvgm 是否支持 PDF。', 'The converter produced no SVG. Check whether dvisvgm supports PDF.'],
  invalidSvg: ['转换器生成了无效的 SVG。', 'The converter produced invalid SVG.'],
  diagnosis: [
    '实际使用的 SVG 转换器：{0}\n基础编译与 PDF 转 SVG 测试通过。',
    'SVG converter used: {0}\nBasic compilation and PDF-to-SVG conversion passed.'
  ]
};

function translate(language, key, ...args) {
  return messages[key][language === 'en' ? 1 : 0].replace(/\{(\d+)\}/g, (_, index) => args[index]);
}

class LocalizedError extends Error {
  constructor(key, args = [], details = '') {
    super();
    this.key = key;
    this.args = args;
    this.details = details;
    this.message = this.format('zh');
  }

  format(language) {
    const message = translate(language, this.key, ...this.args);
    const details = typeof this.details === 'function' ? this.details(language) : this.details;
    return details ? message + '\n' + details : message;
  }
}

function formatError(error, language) {
  return error instanceof LocalizedError ? error.format(language) : String(error?.message || error);
}

module.exports = { translate, LocalizedError, formatError };
