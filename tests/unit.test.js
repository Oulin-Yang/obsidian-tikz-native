'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Renderer, prepareSource, selectEngine, needsAnotherPass } = require('../renderer');

test('accepts original TikZJax format with preamble', () => {
  const s = '\\usepackage{pgfplots}\n\\begin{document}\n\\begin{tikzpicture}\\end{tikzpicture}\n\\end{document}';
  const out = prepareSource(s);
  assert.ok(out.includes('\\usepackage{pgfplots}'));
  assert.ok(out.includes('\\begin{document}\n\\begin{tikzpicture}\\end{tikzpicture}\n\\end{document}'));
  assert.equal((out.match(/\\documentclass/g) || []).length, 1);
});
test('keeps complete document class and package options', () => {
  const s = '\\documentclass[border=2pt]{standalone}\n\\usepackage[european]{circuitikz}\n\\begin{document}x\\end{document}';
  const out = prepareSource(s, '\\newcommand{\\foo}{bar}');
  assert.ok(out.startsWith('\\documentclass[border=2pt]{standalone}'));
  assert.ok(out.includes('\\usepackage[european]{circuitikz}'));
  assert.ok(out.includes('\\newcommand{\\foo}{bar}'));
});
test('preserves whitespace, percent comments, nonbreaking spaces and HTML-like labels', () => {
  const s = '% \\begin{document} fake\n\\usetikzlibrary{calc}\n\\begin{tikzpicture}\n  % hello\n  \\node {a b &nbsp; \\%};\n\\end{tikzpicture}';
  const out = prepareSource(s);
  assert.ok(out.includes('  % hello\n  \\node {a b &nbsp; \\%};'));
  assert.ok(out.indexOf('\\usetikzlibrary{calc}') < out.indexOf('\n\\begin{document}'));
});
test('wraps bare commands and supports single tikz command', () => {
  assert.ok(prepareSource('\\draw (0,0) -- (1,1);').includes('\\begin{tikzpicture}'));
  assert.ok(!prepareSource('\\tikz \\draw (0,0)--(1,1);').includes('\\begin{tikzpicture}'));
});
test('fragments get AMS symbols while complete documents own their math packages', () => {
  const out = prepareSource('\\begin{tikzpicture}\\node {$\\varnothing$};\\end{tikzpicture}');
  assert.ok(out.includes('\\usepackage{amsmath}'));
  assert.ok(out.includes('\\makeatletter\n\\@ifpackageloaded{unicode-math}{}{\\usepackage{amssymb}}\n\\makeatother'));
  assert.ok(!out.includes('\\IfPackageLoadedTF'));
  assert.ok(out.indexOf('\\usepackage{amssymb}') < out.indexOf('\\begin{document}'));
  const full = '\\documentclass{standalone}\n\\begin{document}x\\end{document}';
  assert.ok(!prepareSource(full).includes('amssymb'));
});
test('checks incomplete documents and engine directives', () => {
  assert.throws(() => prepareSource('\\documentclass{article}'), /begin/);
  assert.throws(() => prepareSource('\\begin{document}x'), /end/);
  assert.equal(selectEngine('% !TeX program = XeLaTeX\nx', 'lualatex'), 'xelatex');
  assert.throws(() => selectEngine('% !TeX program = arbitrary-command', 'lualatex'));
});
test('adaptive passes recognize wrapped rerun warnings without reacting to package filenames', () => {
  assert.equal(needsAnotherPass('LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.'), true);
  assert.equal(needsAnotherPass('LaTeX Warning: There were undefined\nreferences.'), true);
  assert.equal(needsAnotherPass('Package pgf Warning: Rerun to get the correct picture position.'), true);
  assert.equal(needsAnotherPass('(rerunfilecheck.sty) Output written on diagram.pdf'), false);
});
test('full document preserves xcolor loading order', () => {
  const s = '\\documentclass{standalone}\n\\usepackage[dvipsnames]{xcolor}\n\\usepackage{tikz}\n\\begin{document}x\\end{document}';
  assert.equal(prepareSource(s).indexOf('\\usepackage{tikz}'), s.indexOf('\\usepackage{tikz}'));
  const fragment = prepareSource('\\usepackage[dvipsnames]{xcolor}\n\\begin{tikzpicture}\\draw[Red] (0,0)--(1,1);\\end{tikzpicture}');
  assert.ok(fragment.indexOf('\\usepackage[dvipsnames]{xcolor}') < fragment.indexOf('\\usepackage{tikz}'));
});
test('deduplicates, serializes jobs and invalidates cache', async () => {
  const renderer = new Renderer(); let count = 0; let active = 0; let maxActive = 0;
  renderer.compile = async () => { count++; active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 10)); active--; return ['<svg/>']; };
  await Promise.all([renderer.render('a'), renderer.render('a'), renderer.render('b')]);
  assert.equal(count, 2); assert.equal(maxActive, 1);
  await renderer.render('a'); assert.equal(count, 2);
  renderer.clear(); await renderer.render('a'); assert.equal(count, 3);
  renderer.dispose(); await assert.rejects(renderer.render('x'), /停止/);
});
test('failed jobs do not poison queue', async () => {
  const renderer = new Renderer();
  renderer.compile = async source => { if (source === 'bad') throw Error('bad'); return ['<svg/>']; };
  await assert.rejects(renderer.render('bad'));
  assert.deepEqual(await renderer.render('good'), ['<svg/>']);
  renderer.dispose();
});
test('unrelated edits and appearance changes keep cache; recorded input changes invalidate it', async () => {
  const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tikz-input-test-'));
  const file = path.join(dir, 'data.csv'); let count = 0;
  const renderer = new Renderer();
  renderer.compile = async () => {
    count++; const stat = await fs.stat(file);
    return { pages: ['<svg/>'], dependencies: [{ file, mtime: stat.mtimeMs, ctime: stat.ctimeMs, size: stat.size }] };
  };
  try {
    await fs.writeFile(file, 'original'); await renderer.render('source');
    renderer.invalidatePath(path.join(dir, 'unrelated.md'));
    await renderer.render('source', { darkMode: true, themeSource:'dark', appearance:'paper' }); assert.equal(count, 1);
    await fs.writeFile(file, 'changed external input');
    await renderer.render('source'); assert.equal(count, 2);
    renderer.invalidatePath(file); await renderer.render('source'); assert.equal(count, 3);
    await fs.rm(file); await assert.rejects(renderer.render('source')); assert.equal(count, 4);
  } finally { renderer.dispose(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('obsolete queued requests are skipped while shared live consumers still render', async () => {
  const renderer = new Renderer(); let release; const called = [];
  renderer.compile = async source => { called.push(source); if (source === 'busy') await new Promise(r => { release = r; }); return ['<svg/>']; };
  const busy = renderer.render('busy');
  await new Promise(resolve => setImmediate(resolve));
  const obsolete = renderer.render('obsolete', {}, '', () => false);
  const rejection = assert.rejects(obsolete, /过期/);
  const shared = renderer.render('shared', {}, '', () => false);
  const live = renderer.render('shared', {}, '', () => true);
  release(); await Promise.all([busy, rejection, shared, live]);
  assert.deepEqual(called, ['busy', 'shared']); renderer.dispose();
});
test('converter failure falls back and removes incomplete pages', async () => {
  const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tikz-fallback-test-'));
  const renderer = new Renderer(); const tried = [];
  renderer.convert = async converter => {
    tried.push(converter);
    if (converter === 'broken') { await fs.writeFile(path.join(dir, 'page-2.svg'), '<svg>partial</svg>'); throw new Error("can't retrieve number of pages"); }
    assert.deepEqual(await fs.readdir(dir), []);
    return ['<svg>complete</svg>'];
  };
  try {
    assert.deepEqual(await renderer.convertWithFallback(['broken', 'working'], dir, {}, 10), ['<svg>complete</svg>']);
    assert.deepEqual(tried, ['broken', 'working']);
    assert.equal(renderer.lastConverter, 'working');
    tried.length = 0;
    await renderer.convertWithFallback(['broken', 'working'], dir, {}, 10);
    assert.deepEqual(tried, ['working']);
  } finally { renderer.dispose(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('all failed converters retain useful diagnostics', async () => {
  const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tikz-fallback-test-'));
  const renderer = new Renderer(); renderer.convert = async converter => { throw new Error(converter + ' failed'); };
  try { await assert.rejects(renderer.convertWithFallback(['a', 'b'], dir, {}, 10), error => /a failed/.test(error.message) && /b failed/.test(error.message)); }
  finally { renderer.dispose(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('bundled plugin loads without relative imports and registers both fences', async () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const languages = [];
  class Plugin { async loadData() { return null; } addSettingTab() {} addCommand() {} registerEvent() {} registerMarkdownCodeBlockProcessor(lang) { languages.push(lang); } }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../main.js'), 'utf8'), {
    module, require: name => name === 'obsidian' ? { Plugin, PluginSettingTab: class {}, MarkdownRenderChild: class {} } : require(name), process, console, setTimeout
  });
  const plugin = new module.exports(); plugin.app = { vault: { on() {} } };
  await plugin.onload(); assert.deepEqual(languages, ['tikz', 'tikz-native']); plugin.onunload();
});
