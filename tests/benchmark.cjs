'use strict';
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const { Renderer } = require('../renderer');
const beforePath = process.argv[2];
if (!beforePath) throw new Error('Pass the saved previous renderer module as the first argument.');
const { Renderer: PreviousRenderer } = require(path.resolve(beforePath));
const source = fs.readFileSync(path.join(__dirname, '../examples/circuit-cut.tikz'), 'utf8');
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
(async () => {
  const old = new PreviousRenderer(); const current = new Renderer();
  const timings = { beforeMs: [], afterMs: [] }; const launches = { before: 0, after: 0 };
  for (const [name, renderer] of [['before', old], ['after', current]]) {
    const run = renderer.run.bind(renderer);
    renderer.run = (file, ...args) => { if (/pdflatex(?:\.exe)?$/i.test(file)) launches[name]++; return run(file, ...args); };
  }
  let oldPages, newPages;
  // Interleave the two versions so an already-warm OS cache benefits both.
  for (let i=0; i<5; i++) {
    for (const [name, renderer] of [['before', old], ['after', current]]) {
      renderer.clear(); const start = performance.now();
      const pages = await renderer.render(source, { engine: 'pdflatex' });
      if (i > 0) timings[name+'Ms'].push(performance.now()-start);
      if (name === 'before') oldPages = pages; else newPages = pages;
    }
  }
  old.clear(); let start = performance.now(); await old.render(source, { engine: 'pdflatex' }); const unrelatedBeforeMs = performance.now()-start;
  current.invalidatePath(path.join(__dirname, 'unrelated-note.md'));
  start = performance.now(); await current.render(source, { engine: 'pdflatex' }); const unrelatedAfterMs = performance.now()-start;
  const report = { ...timings, beforeMedianMs: median(timings.beforeMs), afterMedianMs: median(timings.afterMs), unrelatedBeforeMs, unrelatedAfterMs, texLaunches: launches, svgIdentical: JSON.stringify(oldPages) === JSON.stringify(newPages), environment: 'macOS, pdfLaTeX TeX Live 2025, portable Poppler; not a Windows benchmark' };
  report.reductionPercent = Math.round((1-report.afterMedianMs/report.beforeMedianMs)*100);
  fs.writeFileSync(path.join(__dirname, '../test-output/performance-1.0.4.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2)); old.dispose(); current.dispose();
})().catch(e => { console.error(e); process.exitCode=1; });
