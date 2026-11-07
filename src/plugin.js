'use strict';
const { Plugin, PluginSettingTab, Setting, MarkdownRenderChild, Notice, FileSystemAdapter } = require('obsidian');
// Obsidian loads plugins through a custom require; resolve sibling modules explicitly.
const path = require('node:path');
const { Renderer, DEFAULTS, ENGINES } = require(path.join(__dirname, 'renderer.js'));
const { inspectSvg, makeDarkSvg, useDarkTheme, darkPalette, parseColor } = require(path.join(__dirname, 'theming.js'));
const { translate, LocalizedError, formatError } = require(path.join(__dirname, 'i18n.js'));

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
  applyLanguage() {
    const language = this.plugin.settings.language;
    if (this.status) this.status.textContent = translate(language, this.statusKey);
    if (this.failure) {
      const { summary, log, retry, error } = this.failure;
      summary.textContent = translate(language, 'logs');
      log.textContent = formatError(error, language);
      retry.textContent = translate(language, 'retry');
    }
    this.pages.forEach(({ originalImage, darkImage }, index) => {
      const label = translate(language, 'page', index + 1);
      originalImage.setAttribute('alt', label);
      darkImage.setAttribute('alt', label);
    });
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
    this.failure = null;
    this.containerEl.empty(); this.containerEl.addClass('tikz-native');
    if (!this.plugin.settings.enabled) {
      this.status = this.containerEl.createEl('p');
      this.statusKey = 'disabled';
      this.applyLanguage();
      return;
    }
    this.status = this.containerEl.createEl('p', { cls: 'tikz-native-status' });
    this.statusKey = 'compiling';
    this.applyLanguage();
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) throw new LocalizedError('desktopOnly');
      const inputDir = path.join(adapter.getBasePath(), path.dirname(this.sourcePath));
      const pages = await this.plugin.renderer.render(this.source, { ...this.plugin.settings }, inputDir, () => !this.stopped && revision === this.revision);
      if (this.stopped || revision !== this.revision) return;
      const win = this.containerEl.ownerDocument.defaultView;
      for (const svg of pages) {
        const wrapper = this.containerEl.createEl('div', { cls: 'tikz-native-page' });
        const originalImage = wrapper.createEl('img', { cls: 'tikz-native-image tikz-native-original', attr: { src: this.blobUrl(svg) } });
        const info = inspectSvg(svg, win.DOMParser);
        const darkImage = wrapper.createEl('img', { cls: 'tikz-native-image tikz-native-dark-image' });
        this.pages.push({ source: svg, wrapper, info, originalImage, darkImage });
      }
      this.applyLanguage();
      this.applyAppearance();
      this.status.remove();
      this.status = null;
    } catch (error) {
      if (this.stopped || revision !== this.revision) return;
      this.statusKey = 'failed';
      const details = this.containerEl.createEl('details');
      const summary = details.createEl('summary');
      const log = details.createEl('pre');
      const retry = details.createEl('button');
      retry.onclick = () => { this.plugin.renderer.clear(); void this.render(); };
      this.failure = { summary, log, retry, error };
      this.applyLanguage();
    }
  }
}
class NativeSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl: el, plugin: p } = this;
    const t = (key, ...args) => translate(p.settings.language, key, ...args);
    const setting = (name, description) => {
      const row = new Setting(el).setName(t(name));
      return description ? row.setDesc(t(description)) : row;
    };
    el.empty();
    el.createEl('h2', { text: 'TikZ Native' });
    setting('language').addDropdown(dropdown => dropdown
      .addOption('zh', '简体中文')
      .addOption('en', 'English')
      .setValue(p.settings.language)
      .onChange(async language => {
        dropdown.setDisabled(true);
        try {
          await p.setLanguage(language);
        } finally {
          this.display();
        }
      }));
    el.createEl('p', { text: t('intro') });
    setting('local', 'localHelp').addToggle(toggle => toggle
      .setValue(p.settings.enabled)
      .onChange(async value => { p.settings.enabled = value; await p.saveSettings(); p.refresh(); }));
    setting('engine', 'engineHelp').addDropdown(dropdown => {
      for (const engine of ENGINES) dropdown.addOption(engine, engine);
      dropdown.setValue(p.settings.engine)
        .onChange(async value => { p.settings.engine = value; await p.saveSettings(); p.refresh(); });
    });
    const textSetting = (key, placeholder) => setting(key, key + 'Help').addText(input => input
      .setPlaceholder(placeholder)
      .setValue(p.settings[key])
      .onChange(async value => { p.settings[key] = value; await p.saveSettings(); }));
    textSetting('texPath', '/Library/TeX/texbin/lualatex');
    textSetting('converterPath', '/opt/homebrew/bin/mutool');
    setting('preamble', 'preambleHelp').addTextArea(input => {
      input.inputEl.rows = 6;
      input.setValue(p.settings.preamble)
        .onChange(async value => { p.settings.preamble = value; await p.saveSettings(); });
    });
    setting('timeout').addText(input => input
      .setValue(String(p.settings.timeout))
      .onChange(async value => {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 5 && seconds <= 300) {
          p.settings.timeout = seconds;
          await p.saveSettings();
        }
      }));
    setting('adaptive', 'adaptiveHelp').addToggle(toggle => toggle
      .setValue(p.settings.adaptivePasses)
      .onChange(async value => { p.settings.adaptivePasses = value; await p.saveSettings(); }));
    setting('passes', 'passesHelp').addDropdown(dropdown => dropdown
      .addOption('1', '1').addOption('2', '2').addOption('3', '3')
      .setValue(String(p.settings.passes))
      .onChange(async value => { p.settings.passes = Number(value); await p.saveSettings(); }));
    setting('theme', 'themeHelp').addDropdown(dropdown => {
      for (const option of ['system', 'obsidian', 'light', 'dark']) dropdown.addOption(option, t(option));
      dropdown.setValue(p.settings.themeSource)
        .onChange(async value => { p.settings.themeSource = value; await p.saveSettings(); p.refreshAppearance(); });
    });
    setting('appearance', 'appearanceHelp').addDropdown(dropdown => dropdown
      .addOption('auto', t('auto')).addOption('paper', t('paper'))
      .setValue(p.settings.appearance)
      .onChange(async value => { p.settings.appearance = value; await p.saveSettings(); p.refreshAppearance(); }));
    setting('apply').addButton(button => button.setButtonText(t('rerender')).onClick(() => p.refresh()));
    setting('check').addButton(button => {
      this.checkButton = button.setButtonText(t('checkButton')).onClick(() => this.checkEnvironment());
    });
    this.diagnosticOutput = el.createEl('pre', { cls: 'tikz-native-diagnostics' });
    this.showDiagnosis();
  }

  async checkEnvironment() {
    const p = this.plugin;
    if (!p.settings.enabled) {
      new Notice(translate(p.settings.language, 'enableFirst'));
      return;
    }
    this.checking = true;
    this.showDiagnosis();
    try {
      this.diagnosis = { result: await p.renderer.diagnose({ ...p.settings }) };
    } catch (error) {
      this.diagnosis = { error };
    } finally {
      this.checking = false;
      this.showDiagnosis();
    }
  }

  showDiagnosis() {
    const language = this.plugin.settings.language;
    this.checkButton.setDisabled(Boolean(this.checking));
    let text = '';
    if (this.checking) {
      text = translate(language, 'checking');
    } else if (this.diagnosis?.result) {
      const { tex, version, converter } = this.diagnosis.result;
      text = [tex, version, translate(language, 'diagnosis', converter)].join('\n');
    } else if (this.diagnosis) {
      text = formatError(this.diagnosis.error, language);
    }
    this.diagnosticOutput.textContent = text;
  }
}
module.exports = class TikzNativePlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULTS, saved);
    this.settings.language = saved ? (saved.language === 'en' ? 'en' : 'zh') : 'en';
    this.renderer = new Renderer(); this.views = new Set();
    this.addSettingTab(new NativeSettings(this.app, this));
    if (this.app.workspace) this.registerEvent(this.app.workspace.on('css-change', () => this.refreshAppearance()));
    for (const language of ['tikz', 'tikz-native']) {
      this.registerMarkdownCodeBlockProcessor(language, (source, el, ctx) => {
        ctx.addChild(new DiagramChild(el, this, source, ctx.sourcePath));
      });
    }
    this.registerRefreshCommand();
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
  registerRefreshCommand() {
    this.addCommand({
      id: 'refresh',
      name: translate(this.settings.language, 'refresh'),
      callback: () => this.refresh(true)
    });
  }
  async setLanguage(language) {
    const previous = this.settings.language;
    this.settings.language = language;
    try {
      await this.saveSettings();
    } catch (error) {
      this.settings.language = previous;
      throw error;
    }
    if (typeof this.removeCommand === 'function') {
      this.removeCommand('refresh');
      this.registerRefreshCommand();
    }
    for (const view of this.views) view.applyLanguage();
  }
  async saveSettings() { await this.saveData(this.settings); }
  refreshAppearance() { for (const view of this.views) view.applyAppearance(); }
  refresh(clearCache = false) { if (clearCache) this.renderer.clear(); for (const view of this.views) void view.render(); }
  onunload() { this.renderer.dispose(); for (const view of [...this.views]) view.onunload(); }
};
