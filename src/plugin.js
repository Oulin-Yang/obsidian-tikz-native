'use strict';
const { Plugin, PluginSettingTab, Setting, MarkdownRenderChild, Notice, FileSystemAdapter } = require('obsidian');
// Obsidian loads plugins through a custom require; resolve sibling modules explicitly.
const path = require('node:path');
const { Renderer, DEFAULTS, ENGINES } = require(path.join(__dirname, 'renderer.js'));
const { inspectSvg, makeDarkSvg, useDarkTheme, darkPalette, parseColor } = require(path.join(__dirname, 'theming.js'));

class DiagramChild extends MarkdownRenderChild {
  constructor(el, plugin, source, sourcePath) {
    super(el); this.plugin = plugin; this.source = source; this.sourcePath = sourcePath;
    this.urls = new Map(); this.pages = []; this.revision = 0; this.stopped = false;
    this.themeChanged = () => this.applyAppearance();
  }
  onload() {
    this.plugin.views.add(this);
    const doc = this.containerEl.ownerDocument; const win = doc.defaultView;
    this.media = win.matchMedia('(prefers-color-scheme: dark)');
    if (this.media.addEventListener) this.media.addEventListener('change', this.themeChanged);
    else this.media.addListener(this.themeChanged);
    this.themeObserver = new win.MutationObserver(this.themeChanged);
    for (const target of [doc.body, doc.documentElement]) if (target) this.themeObserver.observe(target, { attributes: true, attributeFilter: ['class','style'] });
    this.timer = setTimeout(() => { this.timer = null; void this.render(); }, 180);
  }
  onunload() {
    if (this.timer) clearTimeout(this.timer);
    this.stopped = true; this.revision++;
    if (this.media) {
      if (this.media.removeEventListener) this.media.removeEventListener('change', this.themeChanged);
      else this.media.removeListener(this.themeChanged);
    }
    if (this.themeObserver) this.themeObserver.disconnect();
    this.release(); this.pages = []; this.plugin.views.delete(this);
  }
  release() { for (const [url, api] of this.urls) api.revokeObjectURL(url); this.urls.clear(); }
  blobUrl(svg) {
    const win = this.containerEl.ownerDocument.defaultView;
    const url = win.URL.createObjectURL(new win.Blob([svg], { type: 'image/svg+xml' }));
    this.urls.set(url, win.URL); return url;
  }
  applyAppearance() {
    if (this.stopped) return;
    const doc = this.containerEl.ownerDocument; const win = doc.defaultView;
    const appDark = doc.body.classList.contains('theme-dark');
    const dark = useDarkTheme(this.plugin.settings.themeSource, this.media ? this.media.matches : appDark, appDark);
    this.containerEl.toggleClass('tikz-native-is-dark', dark);
    let background = '';
    for (let node = this.containerEl; node; node = node.parentElement) {
      const value = win.getComputedStyle(node).backgroundColor; const color = parseColor(value);
      if (color && color.a >= .99) { background = value; break; }
    }
    const palette = darkPalette(win.getComputedStyle(this.containerEl).color, background);
    const paletteKey = JSON.stringify(palette);
    for (const page of this.pages) {
      const adapt = this.plugin.settings.appearance !== 'paper' && page.info.adaptable;
      page.wrapper.toggleClass('tikz-native-has-adapted', adapt);
      page.wrapper.toggleClass('tikz-native-paper', !adapt);
      if (!adapt || !dark || page.paletteKey === paletteKey) continue;
      const svg = makeDarkSvg(page.source, palette, win.DOMParser, win.XMLSerializer);
      const url = this.blobUrl(svg);
      if (page.darkUrl) { this.urls.get(page.darkUrl).revokeObjectURL(page.darkUrl); this.urls.delete(page.darkUrl); }
      page.darkUrl = url; page.paletteKey = paletteKey;
      // The palette background is only used for contrast and diagram fills.
      // Leave the image canvas transparent so the actual note shows through.
      page.darkImage.setAttribute('src', url);
    }
  }
  async render() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.stopped) return;
    const revision = ++this.revision;
    this.release(); this.pages = [];
    this.containerEl.empty(); this.containerEl.addClass('tikz-native');
    if (!this.plugin.settings.enabled) {
      this.containerEl.createEl('p', { text: 'TikZ Native：请先在插件设置中开启本地编译。' }); return;
    }
    const status = this.containerEl.createEl('p', { text: '正在编译 TikZ…', cls: 'tikz-native-status' });
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) throw new Error('本插件需要桌面端本地仓库。');
      const inputDir = path.join(adapter.getBasePath(), path.dirname(this.sourcePath));
      const pages = await this.plugin.renderer.render(this.source, { ...this.plugin.settings }, inputDir, () => !this.stopped && revision === this.revision);
      if (this.stopped || revision !== this.revision) return;
      status.remove();
      const win = this.containerEl.ownerDocument.defaultView;
      pages.forEach((svg, index) => {
        const wrapper = this.containerEl.createEl('div', { cls: 'tikz-native-page' });
        const label = `TikZ 图，第 ${index + 1} 页`;
        wrapper.createEl('img', { cls: 'tikz-native-image tikz-native-original', attr: { src: this.blobUrl(svg), alt: label } });
        const info = inspectSvg(svg, win.DOMParser);
        const darkImage = wrapper.createEl('img', { cls: 'tikz-native-image tikz-native-dark-image', attr: { alt: label } });
        this.pages.push({ source: svg, wrapper, info, darkImage });
      });
      this.applyAppearance();
    } catch (error) {
      if (this.stopped || revision !== this.revision) return;
      status.textContent = 'TikZ 编译失败';
      const details = this.containerEl.createEl('details');
      details.createEl('summary', { text: '查看原因与编译日志' }); details.createEl('pre', { text: String(error.message || error) });
      const retry = this.containerEl.createEl('button', { text: '重试' });
      retry.onclick = () => { this.plugin.renderer.clear(); void this.render(); };
    }
  }
}
class NativeSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl: el } = this;
    const p = this.plugin;
    el.empty();
    el.createEl('h2', { text: 'TikZ Native' });
    el.createEl('p', { text: '调用本机完整 LaTeX 环境。请关闭其他注册 tikz 代码块的插件（如 TikZJax），避免渲染冲突。' });
    new Setting(el).setName('开启本地编译').setDesc('仅对可信仓库开启。TeX 可读取本机文件；关闭 shell escape 并不等于沙箱。图形内容不上传网络。').addToggle(t => t.setValue(p.settings.enabled).onChange(async v => { p.settings.enabled = v; await p.saveSettings(); p.refresh(); }));
    new Setting(el).setName('默认编译器').setDesc('LuaLaTeX 支持 graphdrawing；中文可用 XeLaTeX / LuaLaTeX 配合 ctex。代码首行 % !TeX program = xelatex 可覆盖默认值。').addDropdown(d => {
      ENGINES.forEach(e => d.addOption(e, e));
      d.setValue(p.settings.engine).onChange(async v => { p.settings.engine = v; await p.saveSettings(); p.refresh(); });
    });
    const textSetting = (name, description, key, placeholder) => new Setting(el).setName(name).setDesc(description).addText(t => t.setPlaceholder(placeholder).setValue(p.settings[key]).onChange(async v => { p.settings[key] = v; await p.saveSettings(); }));
    textSetting('LaTeX 程序路径（可留空）', '填写可执行文件完整路径，不填写命令参数。使用代码中的编译器指令时，请留空以自动定位对应程序。', 'texPath', '/Library/TeX/texbin/lualatex');
    textSetting('首选 SVG 转换器路径（可留空）', '自动寻找 mutool、pdftocairo、已有的便携 Poppler 和 dvisvgm。首选工具失效时自动尝试其他可用工具，无需修改源码。', 'converterPath', '/opt/homebrew/bin/mutool');
    new Setting(el).setName('全局导言区').setDesc('例如 \\usepackage{pgfplots} 或 \\usetikzlibrary{arrows.meta,calc}。完整文档同样会注入此处。包选项请在代码内声明，避免重复加载冲突。').addTextArea(t => { t.inputEl.rows = 6; t.setValue(p.settings.preamble).onChange(async v => { p.settings.preamble = v; await p.saveSettings(); }); });
    new Setting(el).setName('每步超时（秒）').addText(t => t.setValue(String(p.settings.timeout)).onChange(async v => { const n = Number(v); if (Number.isFinite(n) && n >= 5 && n <= 300) { p.settings.timeout = n; await p.saveSettings(); } }));
    new Setting(el).setName('按需重复编译').setDesc('普通图只编译一次；日志提示交叉引用等需要重跑时，再编译到次数上限。特殊文档若依赖固定多遍处理，可关闭。').addToggle(t => t.setValue(p.settings.adaptivePasses).onChange(async v => { p.settings.adaptivePasses = v; await p.saveSettings(); }));
    new Setting(el).setName('编译次数上限').setDesc('按需模式下通常保留 2；关闭按需模式后按这个次数固定编译。').addDropdown(d => d.addOption('1', '1').addOption('2', '2').addOption('3', '3').setValue(String(p.settings.passes)).onChange(async v => { p.settings.passes = Number(v); await p.saveSettings(); }));
    new Setting(el).setName('图形主题').setDesc('默认自动跟随系统，也可跟随 Obsidian 或固定明暗。主题切换只更新显示，不调用 LaTeX。').addDropdown(d => d.addOption('system', '跟随系统（默认）').addOption('obsidian', '跟随 Obsidian').addOption('light', '始终浅色').addOption('dark', '始终深色').setValue(p.settings.themeSource).onChange(async v => { p.settings.themeSource = v; await p.saveSettings(); p.refreshAppearance(); }));
    new Setting(el).setName('颜色处理').setDesc('默认画布透明，直接透出笔记背景。文字和线条随主题适配；图内彩色填充保留区域并调整为夜间配色。原始配色留给浅色模式和打印；也可手动选择原图和白底。').addDropdown(d => d.addOption('auto', '透明画布，自动适配配色（默认）').addOption('paper', '始终保留原图和浅色底').setValue(p.settings.appearance).onChange(async v => { p.settings.appearance = v; await p.saveSettings(); p.refreshAppearance(); }));
    new Setting(el).setName('应用设置并重新渲染').addButton(b => b.setButtonText('重新渲染').onClick(() => p.refresh()));
    new Setting(el).setName('检查编译环境').addButton(b => b.setButtonText('检查').onClick(async () => {
      if (!p.settings.enabled) { new Notice('请先开启本地编译。'); return; }
      b.setDisabled(true); output.textContent = '检查中…';
      try { output.textContent = await p.renderer.diagnose({ ...p.settings }); }
      catch (e) { output.textContent = String(e.message || e); }
      finally { b.setDisabled(false); }
    }));
    const output = el.createEl('pre', { cls: 'tikz-native-diagnostics' });
  }
}
module.exports = class TikzNativePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.renderer = new Renderer(); this.views = new Set();
    this.addSettingTab(new NativeSettings(this.app, this));
    if (this.app.workspace) this.registerEvent(this.app.workspace.on('css-change', () => this.refreshAppearance()));
    for (const language of ['tikz', 'tikz-native']) {
      this.registerMarkdownCodeBlockProcessor(language, (source, el, ctx) => {
        ctx.addChild(new DiagramChild(el, this, source, ctx.sourcePath));
      });
    }
    this.addCommand({ id: 'refresh', name: '清除缓存并重新渲染', callback: () => this.refresh(true) });
    // Keep cached diagrams on unrelated note edits. Recorded TeX inputs are also
    // checked on every cache hit, including files changed outside Obsidian.
    for (const event of ['modify', 'create', 'delete', 'rename']) {
      this.registerEvent(this.app.vault.on(event, (file, oldPath) => {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) return;
        if (file && file.path) this.renderer.invalidatePath(path.join(adapter.getBasePath(), file.path));
        if (oldPath) this.renderer.invalidatePath(path.join(adapter.getBasePath(), oldPath));
      }));
    }
  }
  async saveSettings() { await this.saveData(this.settings); }
  refreshAppearance() { for (const view of this.views) view.applyAppearance(); }
  refresh(clearCache = false) { if (clearCache) this.renderer.clear(); for (const view of this.views) void view.render(); }
  onunload() { this.renderer.dispose(); for (const view of [...this.views]) view.onunload(); }
};
