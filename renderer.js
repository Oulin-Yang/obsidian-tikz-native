'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');

const DEFAULTS = Object.freeze({
  engine: 'lualatex', texPath: '', converterPath: '', preamble: '',
  timeout: 60, passes: 2, adaptivePasses: true, cacheEntries: 64, enabled: false, darkMode: false, themeSource: 'system', appearance: 'auto'
});
const ENGINES = ['lualatex', 'xelatex', 'pdflatex'];
// Mask comments without changing offsets; an escaped percent is not a comment.
function maskComments(source) {
  return source.replace(/(\\.)|%[^\n]*/g, (s, escaped) => escaped ? s : ' '.repeat(s.length));
}
function prepareSource(source, preamble = '') {
  const clean = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const visible = maskComments(clean);
  const hasClass = /\\documentclass\b/.test(visible);
  const begin = /\\begin\s*\{document\}/.exec(visible);
  if (hasClass && !begin) throw new Error('完整文档缺少 \\begin{document}。');
  if (begin && !/\\end\s*\{document\}/.test(visible)) throw new Error('缺少 \\end{document}。');
  if (begin) {
    const pos = hasClass ? /\\documentclass(?:\s*\[[^\]]*\])?\s*\{[^}]*\}/.exec(visible) : null;
    if (hasClass && !pos) throw new Error('无法识别 documentclass 声明。');
    // Complete documents own their package order/options. Never preload TikZ before xcolor etc.
    if (hasClass) return clean.slice(0, begin.index) + '\n' + preamble + '\n' + clean.slice(begin.index);
    return '\\documentclass[border=3pt]{standalone}\n' + injectTikz(clean.slice(0, begin.index), preamble) + clean.slice(begin.index);
  }
  // Keep package/library declarations before the first environment. Preserve all source whitespace.
  const body = /\\begin\s*\{[^}]+\}|\\(?:tikz\b|draw\b|node\b|path\b|fill\b|filldraw\b|shade\b|clip\b|foreach\b|graph\b)/.exec(visible);
  if (!body) throw new Error('未找到绘图内容；请使用 tikzpicture、其他绘图环境或完整 LaTeX 文档。');
  const head = clean.slice(0, body.index);
  let content = clean.slice(body.index);
  if (!/^\\begin\s*\{/.test(body[0]) && !/^\\tikz\b/.test(body[0])) {
    content = '\\begin{tikzpicture}\n' + content + '\n\\end{tikzpicture}';
  }
  return '\\documentclass[border=3pt]{standalone}\n' + injectTikz(head, preamble) + '\n\\begin{document}\n' + content + '\n\\end{document}\n';
}
function injectTikz(head, preamble) {
  // Load user packages before TikZ, except TikZ configuration needs TikZ loaded first.
  const config = /\\(?:usetikzlibrary|usepgflibrary|usegdlibrary|tikzset|pgf[a-zA-Z@]*)\b/.exec(maskComments(head));
  const at = config ? config.index : head.length;
  // TikZJax users expect the common AMS math commands to work in fragments.
  // Add them after user packages so package options and unicode-math keep precedence.
  return head.slice(0, at) + '\n\\usepackage{tikz}\n' + preamble + '\n' + head.slice(at)
    + '\n\\usepackage{amsmath}\n\\makeatletter\n\\@ifpackageloaded{unicode-math}{}{\\usepackage{amssymb}}\n\\makeatother\n';
}
function selectEngine(source, fallback) {
  const directive = /^\s*%\s*!TeX\s+program\s*=\s*([\w-]+)/im.exec(source);
  const engine = directive ? directive[1].toLowerCase() : fallback;
  if (!ENGINES.includes(engine)) throw new Error('编译器仅支持 lualatex、xelatex、pdflatex。');
  return engine;
}
async function executable(name, explicit = '') {
  if (explicit.trim()) return explicit.trim();
  const dirs = [...(process.env.PATH || '').split(path.delimiter), '/Library/TeX/texbin', '/opt/homebrew/bin', '/usr/local/bin'];
  if (process.platform === 'win32') dirs.push('C:\\texlive\\2026\\bin\\windows', 'C:\\texlive\\2025\\bin\\windows');
  for (const dir of dirs.filter(Boolean)) {
    const file = path.join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
    try { await fs.access(file, require('node:fs').constants.X_OK); return file; } catch (_) { /* next */ }
  }
  throw new Error(`找不到 ${name}。请安装完整 TeX Live / MacTeX，并在插件设置中填写程序绝对路径。`);
}
async function findConverters(explicit = '') {
  const candidates = [];
  if (explicit.trim()) candidates.push(explicit.trim());
  for (const name of ['mutool', 'pdftocairo']) {
    try { candidates.push(await executable(name)); } catch (_) { /* next */ }
  }
  // Desktop apps may not inherit the terminal PATH. Also recognize the existing
  // portable Poppler runtime on this Mac, without hardcoding a user name.
  const portable = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'poppler', 'poppler', 'bin', process.platform === 'win32' ? 'pdftocairo.exe' : 'pdftocairo');
  try { await fs.access(portable, require('node:fs').constants.X_OK); candidates.push(portable); } catch (_) { /* optional */ }
  try { candidates.push(await executable('dvisvgm')); } catch (_) { /* optional */ }
  if (!candidates.length) throw new Error('找不到 PDF → SVG 转换器。请安装 MuPDF（mutool）、Poppler（pdftocairo + pdfinfo）或带 PDF 支持的 dvisvgm。');
  return [...new Set(candidates)];
}
function needsAnotherPass(log) {
  return /Rerun to get|Label\(s\) may have changed|undefined references|(?:please|must|needs? to)\s+rerun|rerun\s+(?:LaTeX|LuaLaTeX|XeLaTeX)|rerunfilecheck[^\n]*Warning/i.test(log.replace(/\s+/g, ' '));
}
function pathKey(file) { const resolved = path.resolve(file); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; }
async function inputSignatures(dir) {
  let recorder;
  try { recorder = await fs.readFile(path.join(dir, 'diagram.fls'), 'utf8'); } catch (_) { return null; }
  const tempDirs = [dir, await fs.realpath(dir)].map(pathKey);
  const files = [...new Set(recorder.split(/\r?\n/).filter(line => line.startsWith('INPUT ')).map(line => path.resolve(dir, line.slice(6))))];
  const external = files.filter(file => !tempDirs.some(temp => pathKey(file) === temp || pathKey(file).startsWith(temp + path.sep)));
  const signatures = await Promise.all(external.map(async file => {
    try { const stat = await fs.stat(file); return { file, mtime: stat.mtimeMs, ctime: stat.ctimeMs, size: stat.size }; }
    catch (_) { return null; }
  }));
  // Do not cache when one of the recorded inputs disappeared during compilation.
  return signatures.some(item => item === null) ? null : signatures;
}
async function inputsUnchanged(dependencies) {
  if (!dependencies) return false;
  const matches = await Promise.all(dependencies.map(async input => {
    try { const stat = await fs.stat(input.file); return stat.mtimeMs === input.mtime && stat.ctimeMs === input.ctime && stat.size === input.size; }
    catch (_) { return false; }
  }));
  return matches.every(Boolean);
}
class Renderer {
  constructor() { this.cache = new Map(); this.pending = new Map(); this.tail = Promise.resolve(); this.children = new Set(); this.disposed = false; this.generation = 0; this.inputEpoch = 0; this.converterChoices = new Map(); }
  clear() { this.generation++; this.cache.clear(); }
  invalidatePath(file) {
    this.inputEpoch++;
    const key = pathKey(file);
    for (const [hash, entry] of this.cache) {
      if (!entry.dependencies || entry.dependencies.some(input => pathKey(input.file) === key)) this.cache.delete(hash);
    }
  }
  dispose() { this.disposed = true; this.clear(); for (const child of this.children) child.kill('SIGKILL'); }
  run(file, args, options, timeout) {
    if (this.disposed) return Promise.reject(new Error('插件已停止。'));
    return new Promise((resolve, reject) => {
      const child = execFile(file, args, { ...options, timeout: timeout * 1000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: false }, (error, stdout, stderr) => {
        this.children.delete(child);
        if (error) {
          const hint = error.code === 'ENOENT' ? `找不到程序 ${file}。` : error.killed ? `编译超时或被取消（每步上限 ${timeout} 秒）。` : `${path.basename(file)} 运行失败。`;
          reject(new Error(hint + '\n' + String(stdout || '').slice(-16000) + '\n' + String(stderr || '').slice(-8000)));
        } else resolve({ stdout, stderr });
      });
      this.children.add(child);
    });
  }
  render(source, options = {}, inputDir = '', isActive = () => true) {
    const settings = { ...DEFAULTS, ...options };
    const generation = this.generation;
    // Appearance and timeout settings do not change the rendered document.
    const config = [settings.engine, settings.texPath, settings.converterPath, settings.preamble, settings.passes, settings.adaptivePasses];
    const key = createHash('sha256').update(JSON.stringify([source, config, inputDir, generation])).digest('hex');
    if (this.pending.has(key)) { const current = this.pending.get(key); current.consumers.add(isActive); return current.promise; }
    const request = { consumers: new Set([isActive]) };
    const active = () => [...request.consumers].some(consumer => consumer());
    const load = async () => {
      if (this.disposed) throw new Error('插件已停止。');
      const hit = this.cache.get(key);
      if (hit && await inputsUnchanged(hit.dependencies) && generation === this.generation) {
        this.cache.delete(key); this.cache.set(key, hit); this.lastConverter = hit.converter;
        return hit.pages;
      }
      const job = this.tail.then(async () => {
        if (this.disposed) throw new Error('插件已停止。');
        if (!active()) throw new Error('已取消过期的绘图请求。');
        const epoch = this.inputEpoch;
        // Filesystem timestamps have sub-millisecond precision; Date.now() is rounded.
        const started = Date.now() + 1;
        const compiled = await this.compile(source, settings, inputDir);
        const entry = Array.isArray(compiled) ? { pages: compiled, dependencies: [] } : compiled;
        entry.converter = this.lastConverter;
        const stableInputs = entry.dependencies && entry.dependencies.every(input => input.mtime <= started && input.ctime <= started);
        if (generation === this.generation && epoch === this.inputEpoch && !this.disposed && stableInputs) {
          this.cache.set(key, entry);
          const limit = Math.min(256, Math.max(1, Number(settings.cacheEntries) || 64));
          while (this.cache.size > limit) this.cache.delete(this.cache.keys().next().value);
        }
        return entry.pages;
      });
      this.tail = job.catch(() => {});
      return job;
    };
    request.promise = load();
    this.pending.set(key, request);
    request.promise.then(() => this.pending.delete(key), () => this.pending.delete(key));
    return request.promise;
  }
  async compile(source, settings, inputDir) {
    const engine = selectEngine(source, settings.engine);
    const tex = await executable(engine, settings.texPath);
    const converters = await findConverters(settings.converterPath);
    const document = prepareSource(source, settings.preamble);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-tikz-'));
    try {
      await fs.writeFile(path.join(dir, 'diagram.tex'), document, 'utf8');
      // A trailing empty TEXINPUTS entry keeps the distribution's normal package search.
      const env = { ...process.env, openout_any: 'p', TEXMFOUTPUT: dir, TEXINPUTS: [dir, inputDir, process.env.TEXINPUTS || '', ''].join(path.delimiter), PATH: [path.dirname(tex), ...converters.map(c => path.dirname(c)), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(path.delimiter) };
      const timeout = Math.min(300, Math.max(5, Number(settings.timeout) || 60));
      const passes = Math.min(3, Math.max(1, Number(settings.passes) || 2));
      for (let pass = 0; pass < passes; pass++) {
        const result = await this.run(tex, ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-recorder', '-jobname=diagram', 'diagram.tex'], { cwd: dir, env }, timeout);
        if (/Missing character:/.test(result.stdout + result.stderr)) throw new Error('字体缺少所需字符；中文请使用 XeLaTeX / LuaLaTeX 和 ctex。\n' + (result.stdout + result.stderr).slice(-12000));
        if (settings.adaptivePasses !== false && !needsAnotherPass(result.stdout + result.stderr)) break;
      }
      const pages = await this.convertWithFallback(converters, dir, env, timeout);
      return { pages, dependencies: await inputSignatures(dir) };
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  async convertWithFallback(converters, dir, env, timeout) {
    const failures = [];
    const group = JSON.stringify(converters);
    const preferred = this.converterChoices.get(group);
    const ordered = preferred ? [preferred, ...converters.filter(converter => converter !== preferred)] : converters;
    for (const converter of ordered) {
      if (this.disposed) throw new Error('插件已停止。');
      // A failed converter may leave partial output; never mix pages from two tools.
      for (const name of await fs.readdir(dir)) {
        if (/^page-\d+\.svg$/.test(name)) await fs.rm(path.join(dir, name));
      }
      try {
        const pages = await this.convert(converter, dir, { ...env, PATH: [path.dirname(converter), env.PATH || ''].join(path.delimiter) }, timeout);
        this.lastConverter = converter;
        this.converterChoices.set(group, converter);
        if (this.converterChoices.size > 16) this.converterChoices.delete(this.converterChoices.keys().next().value);
        return pages;
      } catch (error) {
        failures.push(`${converter}\n${error.message || error}`);
      }
    }
    throw new Error('所有可用的 SVG 转换器均失败。\n\n' + failures.join('\n\n'));
  }
  async convert(converter, dir, env, timeout) {
    const kind = path.basename(converter).toLowerCase().replace(/\.exe$/, '');
    if (kind === 'mutool') {
      await this.run(converter, ['draw', '-F', 'svg', '-o', 'page-%d.svg', 'diagram.pdf'], { cwd: dir, env }, timeout);
    } else if (kind === 'pdftocairo') {
      const infoPath = await executable('pdfinfo', path.join(path.dirname(converter), process.platform === 'win32' ? 'pdfinfo.exe' : 'pdfinfo'));
      const info = await this.run(infoPath, ['diagram.pdf'], { cwd: dir, env: { ...env, LC_ALL: 'C' } }, timeout);
      const match = /^Pages:\s+(\d+)/m.exec(info.stdout);
      if (!match) throw new Error('pdfinfo 未返回 PDF 页数。');
      let input = 'diagram.pdf';
      const fontError = /Missing language pack|Unknown font tag|No font in show|Couldn't find a font|failed to load.*font/i;
      for (let page = 1; page <= Number(match[1]); page++) {
        let result = await this.run(converter, ['-svg', '-f', String(page), '-l', String(page), input, `page-${page}.svg`], { cwd: dir, env }, timeout);
        if (fontError.test(result.stderr)) {
          // Portable Poppler installs may lack CJK CMaps. Outline fonts rather than silently dropping labels.
          if (input !== 'diagram.pdf') throw new Error('SVG 转换丢失字体，已停止显示不完整图形。\n' + result.stderr);
          let gs;
          try { gs = await executable(process.platform === 'win32' ? 'gswin64c' : 'gs'); }
          catch (_) { throw new Error('Poppler 缺少字体/CJK 映射。请安装完整 Poppler 数据包或 MuPDF；也可安装 Ghostscript 用于自动字体转轮廓。\n' + result.stderr); }
          await this.run(gs, ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dNoOutputFonts', '-sDEVICE=pdfwrite', '-sOutputFile=outlined.pdf', 'diagram.pdf'], { cwd: dir, env }, timeout);
          input = 'outlined.pdf';
          // Re-render earlier pages too so every page uses the same font treatment.
          page = 0;
        }
      }
    } else {
      try {
        await this.run(converter, ['--pdf', '--page=1-', '--no-fonts', '--embed-bitmaps', '--output=page-%p.svg', 'diagram.pdf'], { cwd: dir, env }, timeout);
      } catch (error) {
        throw new Error(error.message + '\n提示：新版 Ghostscript 无法替代 mutool；若 dvisvgm 报页数错误，请安装 MuPDF（mutool），或将转换器路径改为 pdftocairo。');
      }
    }
    const names = (await fs.readdir(dir)).filter(n => /^page-\d+\.svg$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (!names.length) throw new Error('转换器未生成 SVG。请检查 dvisvgm 是否支持 PDF。');
    const pages = await Promise.all(names.map(n => fs.readFile(path.join(dir, n), 'utf8')));
    if (pages.some(svg => !/<svg\b/.test(svg))) throw new Error('转换器生成了无效的 SVG。');
    return pages;
  }
  async diagnose(settings) {
    const tex = await executable(settings.engine, settings.texPath);
    const a = await this.run(tex, ['--version'], {}, 10);
    // Report the tool that actually rendered, including any automatic fallback.
    this.clear();
    await this.render('\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}', settings);
    return `${tex}\n${a.stdout.split('\n')[0]}\n实际使用的 SVG 转换器：${this.lastConverter}\n基础编译与 PDF → SVG 转换通过。`;
  }
}
module.exports = { Renderer, DEFAULTS, ENGINES, prepareSource, selectEngine, maskComments, needsAnotherPass };
