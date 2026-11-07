'use strict';
// Offline visual check. Pass the path to an existing Sharp installation.
// Sharp is a verification tool only; it is not used or shipped by the plugin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { makeDarkSvg, DARK_PALETTE } = require('../theming');
const sharp = require(process.argv[2] || 'sharp');
const output = path.join(__dirname, '../test-output');

async function main() {
  const panelWidth = 500, rowHeight = 270, header = 44;
  const backgrounds = ['#1e1e1e', '#282d43', null];
  const report = [];
  const layers = [];
  let checker = '';
  for (let x = panelWidth * 2; x < panelWidth * 3; x += 20) {
    for (let y = header; y < header + rowHeight * 2; y += 20) {
      checker += `<rect x="${x}" y="${y}" width="20" height="20" fill="${((x / 20 + (y - header) / 20) % 2) ? '#404046' : '#2a2a30'}"/>`;
    }
  }
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="584"><rect width="1500" height="584" fill="#1e1e1e"/><rect x="500" y="44" width="500" height="540" fill="#282d43"/>${checker}<g font-family="sans-serif" font-size="17" fill="#eee"><text x="20" y="28">Note background #1e1e1e</text><text x="520" y="28">Different background #282d43</text><text x="1020" y="28">Transparency checkerboard</text></g></svg>`);
  layers.push({ input: background, left: 0, top: 0 });
  for (const [row, name] of ['graphdrawing', 'circuit-cut'].entries()) {
    const source = fs.readFileSync(path.join(output, name + '.svg'), 'utf8');
    let darkPng;
    for (const [mode, svg] of [['light', source], ['dark', makeDarkSvg(source, DARK_PALETTE, DOMParser, XMLSerializer)]]) {
      const png = await sharp(Buffer.from(svg), { density: 180 }).resize({ width: 450, height: 220, fit: 'inside' }).png().toBuffer();
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const corners = [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]];
      const cornerAlpha = corners.map(([x, y]) => data[(y * info.width + x) * 4 + 3]);
      assert.deepEqual(cornerAlpha, [0, 0, 0, 0], `${name} ${mode}: corners must have zero alpha`);
      let transparentPixels = 0, opaquePixels = 0, coloredPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) transparentPixels++;
        if (data[i + 3] === 255) {
          opaquePixels++;
          if (Math.max(...data.subarray(i, i + 3)) - Math.min(...data.subarray(i, i + 3)) > 8) coloredPixels++;
        }
      }
      assert.ok(transparentPixels > info.width * info.height * .5, 'empty canvas must remain transparent');
      assert.ok(info.width * info.height - transparentPixels > 100, 'diagram content must remain visible, including antialiased thin lines');
      if (name === 'circuit-cut') assert.ok(coloredPixels > 1000, 'meaningful blue fill must remain painted');
      report.push({ name, mode, cornerAlpha, transparentPixels, opaquePixels, coloredPixels });
      fs.writeFileSync(path.join(output, `${name}-${mode}-transparent-1.0.8.png`), png);
      if (mode === 'dark') darkPng = { png, info };
    }
    for (const [column, color] of backgrounds.entries()) {
      // All three columns use the exact same PNG, without flattening it first.
      layers.push({ input: darkPng.png, left: column * panelWidth + Math.floor((panelWidth - darkPng.info.width) / 2), top: header + row * rowHeight + Math.floor((rowHeight - darkPng.info.height) / 2) });
      if (color) {
        const composite = await sharp({ create: { width: darkPng.info.width, height: darkPng.info.height, channels: 4, background: color } }).composite([{ input: darkPng.png }]).raw().toBuffer();
        const expected = color.slice(1).match(/../g).map(v => parseInt(v, 16));
        assert.deepEqual([...composite.subarray(0, 3)], expected, 'transparent corner must show the underlying background exactly');
      }
    }
  }
  await sharp({ create: { width: 1500, height: 584, channels: 4, background: '#1e1e1e' } }).composite(layers).png().toFile(path.join(output, 'transparency-1.0.8.png'));
  fs.writeFileSync(path.join(output, 'transparency-1.0.8.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
