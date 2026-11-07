'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { DARK_PALETTE, parseColor, neutralPaint, fillPaint, foregroundPaint, strokePaint, contrastRatio, inspectSvg, makeDarkSvg, useDarkTheme, darkPalette } = require('../theming');
const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">${content}</svg>`;

test('system source follows the OS independently of application overrides', () => {
  assert.equal(useDarkTheme('system',true,false),true);
  assert.equal(useDarkTheme('system',false,true),false);
  assert.equal(useDarkTheme('obsidian',false,true),true);
  assert.equal(useDarkTheme('light',true,true),false);
  assert.equal(useDarkTheme('dark',false,false),true);
});
test('neutral mapping understands converter color encodings and retains opacity', () => {
  assert.equal(neutralPaint('#000',DARK_PALETTE),'#dadada');
  assert.equal(neutralPaint('rgb(100%, 100%, 100%)',DARK_PALETTE),'#1e1e1e');
  assert.equal(neutralPaint('rgba(0,0,0,0.5)',DARK_PALETTE),'rgba(218,218,218,0.5)');
  assert.equal(neutralPaint('#fff !important',DARK_PALETTE),'#1e1e1e !important');
  assert.equal(neutralPaint('rgb(100%, 0%, 0%)',DARK_PALETTE),'rgb(100%, 0%, 0%)');
});
test('low-contrast blue strokes are lifted without changing their hue; readable red is preserved', () => {
  const value = strokePaint('#0000ff',DARK_PALETTE); const blue = parseColor(value);
  assert.ok(blue.r > 0); assert.equal(blue.r,blue.g); assert.equal(blue.b,255);
  assert.ok(contrastRatio(blue,parseColor(DARK_PALETTE.background)) >= 3);
  assert.equal(strokePaint('#ff0000',DARK_PALETTE),'#ff0000');
});
test('colored vector fills participate in automatic dark adaptation', () => {
  assert.equal(inspectSvg(svg('<path stroke="#00f" fill="none"/>'),DOMParser).adaptable,true);
  assert.equal(inspectSvg(svg('<rect fill="white"/><path stroke="black"/>'),DOMParser).adaptable,true);
  assert.equal(inspectSvg(svg('<ellipse fill="#ebebff"/><path stroke="black"/>'),DOMParser).adaptable,true);
  assert.equal(inspectSvg(svg('<style>.a {fill:rgb(20%,0%,0%)}</style><path class="a"/>'),DOMParser).adaptable,true);
  assert.equal(inspectSvg(svg('<g color="blue"><path fill="currentColor"/></g>'),DOMParser).adaptable,true);
});
test('gradients and gray scales adapt while unsupported masks and filters remain protected', () => {
  for (const content of ['<linearGradient/>','<radialGradient/>','<image/>']) assert.equal(inspectSvg(svg(content),DOMParser).adaptable,true);
  for (const content of ['<mask/>','<filter/>']) assert.equal(inspectSvg(svg(content),DOMParser).adaptable,false);
  const cells = ['#000','#333','#666','#999','#ccc'].map(fill => `<rect fill="${fill}"/>`).join('');
  assert.equal(inspectSvg(svg(cells),DOMParser).adaptable,true);
});
test('pale blue fills become dark blue surfaces and colored fills retain readable lettering', () => {
  const blue=parseColor(fillPaint('#ebebff',DARK_PALETTE));
  assert.equal(blue.r,blue.g);assert.ok(blue.b>blue.r);assert.ok(blue.r<70&&blue.b<110);
  assert.equal(fillPaint('#ffffff',DARK_PALETTE),'#1e1e1e');
  for(const source of ['#ebebff','#ff0000','#ffff00','#00ff00','#0000ff']){
    const background=parseColor(fillPaint(source,DARK_PALETTE));
    assert.ok(contrastRatio(background,parseColor(DARK_PALETTE.foreground))>=4.5,source);
  }
  assert.equal(foregroundPaint('white',DARK_PALETTE),DARK_PALETTE.foreground);
});
test('filled nodes, glyphs and tiny arrowheads receive different treatments without changing geometry', () => {
  const original=svg('<defs><path id="glyph-0" d="M0 0L1 1"/></defs><rect id="canvas" fill="white" width="100" height="60"/><path id="area" fill="#ebebff" d="M10 10L90 10L90 50L10 50Z"/><path id="arrow" fill="#000" d="M2 2L4 3L2 4Z"/><g fill="white"><use href="#glyph-0"/></g>');
  const dark=makeDarkSvg(original,DARK_PALETTE,DOMParser,XMLSerializer);
  const doc=new DOMParser().parseFromString(dark,'image/svg+xml');
  assert.equal(doc.getElementsByTagName('rect')[0].getAttribute('fill'),DARK_PALETTE.background);
  const paths=Array.from(doc.getElementsByTagName('path'));
  assert.equal(paths.find(p=>p.getAttribute('id')==='arrow').getAttribute('fill'),DARK_PALETTE.foreground);
  const area=paths.find(p=>p.getAttribute('id')==='area');assert.notEqual(area.getAttribute('fill'),'#ebebff');assert.equal(area.getAttribute('d'),'M10 10L90 10L90 50L10 50Z');
  assert.equal(doc.getElementsByTagName('use')[0].getAttribute('fill'),DARK_PALETTE.foreground);
});
test('gradient stops and text adapt but embedded image bytes remain untouched', () => {
  const data='data:image/png;base64,AAAA';
  const original=svg(`<defs><linearGradient id="shade"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="yellow"/></linearGradient></defs><rect fill="url(#shade)" width="100" height="60"/><text fill="black">Label</text><image href="${data}"/>`);
  const doc=new DOMParser().parseFromString(makeDarkSvg(original,DARK_PALETTE,DOMParser,XMLSerializer),'image/svg+xml');
  assert.equal(doc.getElementsByTagName('rect')[0].getAttribute('fill'),'url(#shade)');
  assert.notEqual(doc.getElementsByTagName('stop')[0].getAttribute('stop-color'),'white');
  assert.notEqual(doc.getElementsByTagName('stop')[1].getAttribute('stop-color'),'yellow');
  assert.equal(doc.getElementsByTagName('text')[0].getAttribute('fill'),DARK_PALETTE.foreground);
  assert.equal(doc.getElementsByTagName('image')[0].getAttribute('href'),data);
});
test('dark SVG changes paints while preserving geometry, clipping, identifiers and original source', () => {
  const original = svg('<defs><path id="glyph" d="M0 0L10 10"/></defs><g transform="translate(2 3)"><path id="line" d="M1 2L20 30" stroke="rgb(100%, 0%, 0%)" fill="none" stroke-width="2"/><use href="#glyph" fill="black"/></g>');
  const dark = makeDarkSvg(original,DARK_PALETTE,DOMParser,XMLSerializer);
  const doc = new DOMParser().parseFromString(dark,'image/svg+xml');
  const paths = Array.from(doc.getElementsByTagName('path'));
  assert.equal(paths[0].getAttribute('d'),'M0 0L10 10');
  assert.equal(paths[1].getAttribute('stroke'),'rgb(100%, 0%, 0%)');
  assert.equal(paths[1].getAttribute('stroke-width'),'2');
  assert.equal(doc.getElementsByTagName('g')[0].getAttribute('transform'),'translate(2 3)');
  assert.equal(doc.getElementsByTagName('use')[0].getAttribute('fill'),'#dadada');
  assert.ok(original.includes('fill="black"'));
});
test('stylesheet rules and inherited default glyph fills adapt without flattening colored strokes', () => {
  const dark = makeDarkSvg(svg('<style>.a {fill:black;stroke:#0000ff}.b {stroke:red;fill:none}</style><path class="a" d="M0 0"/>'),DARK_PALETTE,DOMParser,XMLSerializer);
  assert.ok(dark.includes('fill:#2f2f2f')); assert.ok(!dark.includes('stroke:#0000ff'));
  assert.ok(dark.includes('stroke:red;fill:none')); assert.ok(dark.includes('fill="#dadada"'));
});
test('actual exported diagrams including the formerly white-card third example all adapt', () => {
  const fs = require('node:fs'); const path = require('node:path');
  for (const [name,expected] of [['forest',true],['basic',true],['circuit-cut',true],['pgfplots-3d',true]]) {
    const filename = path.join(__dirname,'../test-output/',name+'.svg');
    if (fs.existsSync(filename)) assert.equal(inspectSvg(fs.readFileSync(filename,'utf8'),DOMParser).adaptable,expected,name);
  }
});
test('dark palette uses the note colors when appropriate and protects legibility on a light app override', () => {
  assert.deepEqual(darkPalette('rgb(220,220,220)','rgb(30,30,30)'),{foreground:'#dcdcdc',background:'#1e1e1e'});
  assert.deepEqual(darkPalette('rgb(20,20,20)','rgb(250,250,250)'),DARK_PALETTE);
});

test('live system and app theme switches update images without compilation; unload removes listeners and URLs', async () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const mediaListeners = new Set(); const observers = []; const urls = new Map(); const revoked = []; let urlId=0; let appDark=false; let compileCalls=0;
  const media = { matches:false, addEventListener(_,fn){mediaListeners.add(fn);}, removeEventListener(_,fn){mediaListeners.delete(fn);} };
  class Observer { constructor(fn){this.fn=fn;observers.push(this);} observe(){} disconnect(){this.disconnected=true;} }
  const win = { DOMParser,XMLSerializer,Blob,MutationObserver:Observer,matchMedia:()=>media,
    URL:{createObjectURL(blob){const url='blob:test-'+(++urlId);urls.set(url,blob);return url;},revokeObjectURL(url){urls.delete(url);revoked.push(url);}},
    getComputedStyle:()=>({color:'rgb(218,218,218)',backgroundColor:'rgb(30,30,30)'}) };
  const doc = { defaultView:win,body:{classList:{contains:()=>appDark}},documentElement:{} };
  class Element {
    constructor(parent=null){this.ownerDocument=doc;this.parentElement=parent;this.children=[];this.classes=new Set();this.attrs={};this.style={};}
    empty(){this.children=[];} addClass(c){this.classes.add(c);} toggleClass(c,on){if(on)this.classes.add(c);else this.classes.delete(c);}
    createEl(tag,options={}){const child=new Element(this);child.tag=tag;child.attrs={...options.attr};for(const c of (options.cls||'').split(/\s+/).filter(Boolean))child.classes.add(c);this.children.push(child);return child;}
    setAttribute(key,value){this.attrs[key]=value;} remove(){this.removed=true;}
  }
  class Adapter {getBasePath(){return '/vault';}}
  class Plugin {async loadData(){return {enabled:true};}addSettingTab(){}addCommand(){}registerEvent(){}registerMarkdownCodeBlockProcessor(language,handler){if(language==='tikz')this.handler=handler;}}
  class Child {constructor(el){this.containerEl=el;}}
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../main.js'),'utf8'),{module,process,console,setTimeout,clearTimeout,require:name=>name==='obsidian'?{Plugin,PluginSettingTab:class{},MarkdownRenderChild:Child,FileSystemAdapter:Adapter}:require(name)});
  const plugin = new module.exports();plugin.app={vault:{adapter:new Adapter(),on(){}},workspace:{on(){}}};await plugin.onload();
  plugin.renderer.render=async()=>{compileCalls++;return [svg('<ellipse fill="#ebebff" cx="50" cy="30" rx="40" ry="20"/><path fill="none" stroke="#000" d="M0 0L100 60"/>')];};
  let view;plugin.handler('source',new Element(),{sourcePath:'note.md',addChild(child){view=child;child.onload();}});await view.render();
  assert.equal(compileCalls,1);assert.equal(view.containerEl.classes.has('tikz-native-is-dark'),false);
  media.matches=true;for(const fn of mediaListeners)fn();assert.equal(view.containerEl.classes.has('tikz-native-is-dark'),true);
  const darkUrl=view.pages[0].darkImage.attrs.src;assert.ok((await urls.get(darkUrl).text()).includes('#dadada'));
  assert.equal(view.pages[0].darkImage.style.backgroundColor,undefined,'automatic mode must not paint a solid canvas behind the transparent SVG');
  assert.equal(view.pages[0].wrapper.classes.has('tikz-native-has-adapted'),true);assert.equal(view.pages[0].wrapper.classes.has('tikz-native-paper'),false);
  const created=urlId;media.matches=false;for(const fn of mediaListeners)fn();media.matches=true;for(const fn of mediaListeners)fn();assert.equal(urlId,created);
  plugin.settings.themeSource='obsidian';plugin.refreshAppearance();assert.equal(view.containerEl.classes.has('tikz-native-is-dark'),false);
  appDark=true;for(const observer of observers)observer.fn();assert.equal(view.containerEl.classes.has('tikz-native-is-dark'),true);
  plugin.settings.appearance='paper';plugin.refreshAppearance();assert.equal(view.pages[0].wrapper.classes.has('tikz-native-paper'),true);
  assert.equal(compileCalls,1);view.onunload();assert.equal(mediaListeners.size,0);assert.ok(observers.every(o=>o.disconnected));assert.equal(urls.size,0);assert.equal(revoked.length,2);plugin.onunload();
});
