'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Renderer, DEFAULTS } = require('../renderer');
const cases = [
  ['circuit-cut', 'lualatex', require('node:fs').readFileSync(path.join(__dirname, '..', 'examples', 'circuit-cut.tikz'), 'utf8')],
  ['basic', 'pdflatex', '\\begin{tikzpicture}\\draw[->,red] (0,0)--(2,1);\\node at (1,0) {$x^2$};\\end{tikzpicture}'],
  ['libraries', 'lualatex', '\\usetikzlibrary{arrows.meta,calc,positioning,decorations.pathmorphing,patterns,intersections}\n\\begin{tikzpicture}\\node[draw,pattern=north east lines] (a) {A};\\node[draw,right=of a] (b) {B};\\draw[-{Stealth},decorate,decoration=snake] (a)--(b);\\end{tikzpicture}'],
  ['graphdrawing', 'lualatex', '\\usetikzlibrary{graphs,graphdrawing}\n\\usegdlibrary{layered}\n\\begin{tikzpicture}\\graph[layered layout,nodes={draw,circle}]{a -> {b,c} -> d};\\end{tikzpicture}'],
  ['pgfplots-3d', 'lualatex', '\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\n\\begin{tikzpicture}\\begin{axis}\\addplot3[surf,samples=8,domain=-2:2]{x^2-y^2};\\end{axis}\\end{tikzpicture}'],
  ['tikz-cd', 'pdflatex', '\\usepackage{tikz-cd}\n\\begin{tikzcd} A \\arrow[r,"f"] \\arrow[d] & B \\arrow[d] \\\\ C \\arrow[r] & D \\end{tikzcd}'],
  ['circuitikz', 'pdflatex', '\\usepackage[european]{circuitikz}\n\\begin{circuitikz}\\draw (0,0) to[R=$R$] (3,0) to[C=$C$] (3,2);\\end{circuitikz}'],
  ['forest', 'lualatex', '\\usepackage{forest}\n\\begin{forest} [Root [Left] [Right [Leaf]]] \\end{forest}'],
  ['chinese', 'xelatex', '\\usepackage[fontset=fandol]{ctex}\n\\begin{tikzpicture}\\node[draw] {图论：顶点与边};\\end{tikzpicture}'],
  ['complete-document', 'pdflatex', '\\documentclass[tikz,border=4pt]{standalone}\n\\begin{document}\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}\\end{document}'],
  ['multiple-pages', 'pdflatex', '\\documentclass[tikz,multi,border=3pt]{standalone}\n\\begin{document}\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}\\end{document}']
];
const renderer = new Renderer();
const render = renderer.render.bind(renderer);
renderer.render = (source, options, inputDir) => render(source, { ...options, ...(process.env.TIKZ_TEST_CONVERTER ? { converterPath: process.env.TIKZ_TEST_CONVERTER } : {}) }, inputDir);
const artifacts = path.join(__dirname, '..', 'test-output');
test('real TeX compatibility suite', { timeout: 300000 }, async t => {
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(path.join(__dirname, '..', 'examples', '兼容性示例.md'), '# TikZ Native 兼容性示例\n\n' + cases.map(([name, engine, source]) => `## ${name}\n\n\`\`\`tikz\n% !TeX program = ${engine}\n${source}\n\`\`\`\n`).join('\n'));
  for (const [name, engine, source] of cases) await t.test(name, async () => {
    const pages = await renderer.render(source, { ...DEFAULTS, engine, passes: 2 });
    assert.ok(pages.every(p => /<svg\b/.test(p) && /<path\b/.test(p)));
    if (name === 'chinese') assert.ok((pages[0].match(/<path\b/g) || []).length >= 8, 'Chinese glyph outlines must be present, not only the node border');
    if (name === 'multiple-pages') assert.equal(pages.length, 2);
    await fs.writeFile(path.join(artifacts, name + '.svg'), pages[0]);
  });
  await t.test('relative CSV dependency', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tikz-test-data-'));
    try {
      await fs.writeFile(path.join(dir, 'points.csv'), 'x,y\n0,0\n1,2\n2,1\n');
      const source = '\\usepackage{pgfplots}\n\\begin{tikzpicture}\\begin{axis}\\addplot table[col sep=comma,x=x,y=y]{points.csv};\\end{axis}\\end{tikzpicture}';
      assert.ok((await renderer.render(source, { engine: 'pdflatex' }, dir))[0].includes('<svg'));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  await t.test('syntax failure includes actionable log and next render recovers', async () => {
    await assert.rejects(renderer.render('\\begin{tikzpicture}\\undefinedcommand\\end{tikzpicture}', { engine: 'pdflatex' }), /Undefined control sequence/);
    assert.ok((await renderer.render(cases[0][2], { engine: 'pdflatex' }))[0].includes('<svg'));
  });
  await t.test('AMS package guard works without the newer LaTeX conditional', async () => {
    // Emulate the exact missing command reported by the TeX Live 2021 log.
    const pages = await renderer.render(cases[0][2], { engine: 'pdflatex', preamble: '\\let\\IfPackageLoadedTF\\undefined' });
    assert.ok(pages[0].includes('<svg'));
  });
  await t.test('adaptive compilation skips redundant passes and retains reference reruns', async () => {
    const local = new Renderer(); const run = local.run.bind(local); let launches = 0;
    local.run = (file, ...args) => { if (/pdflatex(?:\.exe)?$/i.test(file)) launches++; return run(file, ...args); };
    try {
      const basic = '\\begin{tikzpicture}\\node {$x$};\\end{tikzpicture}';
      await local.render(basic, { engine: 'pdflatex' }); assert.equal(launches, 1);
      await local.render(basic, { engine: 'pdflatex', adaptivePasses: false }); assert.equal(launches, 3);
      launches = 0;
      await local.render('\\begin{tikzpicture}\\node {\\ref{target}};\\node at (2,0) {\\refstepcounter{equation}\\label{target}$x$};\\end{tikzpicture}', { engine: 'pdflatex' });
      assert.equal(launches, 2);
    } finally { local.dispose(); }
  });
  await t.test('actual recorder dependencies preserve cache and refresh external input changes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tikz-recorded-input-')); const file = path.join(dir, 'label with spaces.tex');
    const local = new Renderer(); const run = local.run.bind(local); let launches = 0;
    local.run = (program, ...args) => { if (/pdflatex(?:\.exe)?$/i.test(program)) launches++; return run(program, ...args); };
    const source = '\\begin{tikzpicture}\\input{label with spaces.tex}\\end{tikzpicture}';
    try {
      await fs.writeFile(file, '\\node {Original};');
      const first = await local.render(source, { engine: 'pdflatex' }, dir);
      local.invalidatePath(path.join(dir, 'unrelated.md'));
      assert.deepEqual(await local.render(source, { engine: 'pdflatex' }, dir), first); assert.equal(launches, 1);
      await fs.writeFile(file, '\\node {Modified label};');
      const changed = await local.render(source, { engine: 'pdflatex' }, dir);
      assert.notEqual(changed[0], first[0]); assert.equal(launches, 2);
    } finally { local.dispose(); await fs.rm(dir, { recursive: true, force: true }); }
  });
  await t.test('hung process is killed by timeout', async () => {
    await assert.rejects(renderer.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {}, 0.1), /超时/);
    assert.equal(renderer.children.size, 0);
  });
  await t.test('configured dvisvgm PDF failure automatically recovers on this Mac', async t => {
    const converterPath = '/Library/TeX/texbin/dvisvgm';
    try { await fs.access(converterPath); } catch (_) { t.skip('MacTeX path unavailable'); return; }
    // Do not use the test converter override: reproduce the exact failing configuration.
    const pages = await render(cases[0][2], { engine: 'pdflatex', converterPath });
    assert.ok(pages[0].includes('<svg'));
    assert.ok(renderer.lastConverter);
    console.log('Configured dvisvgm; successful converter:', renderer.lastConverter);
  });
  renderer.dispose();
});
