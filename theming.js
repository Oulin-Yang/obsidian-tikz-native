'use strict';
const DARK_PALETTE = Object.freeze({ foreground: '#dadada', background: '#1e1e1e' });
function parseColor(value) {
  const color = String(value || '').trim().toLowerCase();
  const names = { black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', red:'#ff0000', blue:'#0000ff', green:'#008000', lime:'#00ff00', navy:'#000080', maroon:'#800000', purple:'#800080', teal:'#008080', olive:'#808000', aqua:'#00ffff', fuchsia:'#ff00ff', yellow:'#ffff00', orange:'#ffa500' };
  if (names[color]) return parseColor(names[color]);
  if (/^#[\da-f]{3,4}$/.test(color)) return parseColor('#' + [...color.slice(1)].map(c => c + c).join(''));
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/.test(color)) return { r: parseInt(color.slice(1,3),16), g: parseInt(color.slice(3,5),16), b: parseInt(color.slice(5,7),16), a: color.length === 9 ? parseInt(color.slice(7,9),16)/255 : 1 };
  const rgb = /^rgba?\(([^)]+)\)$/.exec(color);
  if (rgb) {
    const values = rgb[1].split(/[,\s/]+/).filter(Boolean);
    if (values.length < 3 || values.length > 4) return null;
    const channels = values.slice(0,3).map(v => Number.parseFloat(v) * (v.endsWith('%') ? 2.55 : 1));
    const alpha = values[3] === undefined ? 1 : Number.parseFloat(values[3]) / (values[3].endsWith('%') ? 100 : 1);
    if ([...channels,alpha].some(v => !Number.isFinite(v))) return null;
    return { r: channels[0], g: channels[1], b: channels[2], a: alpha };
  }
  return null;
}
function isNeutral(color) { return Math.max(color.r,color.g,color.b) - Math.min(color.r,color.g,color.b) <= 3; }
function hex(color) { return '#' + [color.r,color.g,color.b].map(v => Math.max(0, Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); }
function neutralPaint(value, palette) {
  const important = /\s*!important\s*$/i.exec(value);
  const paint = important ? value.slice(0, important.index).trim() : value.trim();
  const color = parseColor(paint);
  if (!color || color.a === 0 || !isNeutral(color)) return value;
  const foreground = parseColor(palette.foreground) || parseColor(DARK_PALETTE.foreground);
  const background = parseColor(palette.background) || parseColor(DARK_PALETTE.background);
  const t = (color.r + color.g + color.b) / (3*255);
  const result = { r: foreground.r*(1-t)+background.r*t, g: foreground.g*(1-t)+background.g*t, b: foreground.b*(1-t)+background.b*t };
  const mapped = color.a === 1 ? hex(result) : `rgba(${Math.round(result.r)},${Math.round(result.g)},${Math.round(result.b)},${color.a})`;
  return mapped + (important ? ' !important' : '');
}
function declarations(css) {
  const out = [];
  css.replace(/\b(fill|stroke|color|stop-color)\s*:\s*([^;}]+)/gi, (_, property, value) => { out.push([property.toLowerCase(), value.trim()]); return _; });
  return out;
}
function parseSvg(source, Parser) {
  try {
    const doc = new Parser().parseFromString(source, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length || !doc.documentElement || doc.documentElement.localName !== 'svg') return null;
    return doc;
  } catch (_) { return null; }
}
function inspectSvg(source, Parser) {
  const doc = parseSvg(source, Parser);
  if (!doc) return { adaptable: false, reason: 'unparsed' };
  for (const element of Array.from(doc.documentElement.getElementsByTagName('*'))) {
    const tag = String(element.localName || element.nodeName).toLowerCase();
    // Their internal luminance/HTML rules need a separate rendering model.
    if (['foreignobject','mask','filter'].includes(tag)) return { adaptable: false, reason: tag };
  }
  return { adaptable: true, reason: null };
}
function colorString(color) {
  return color.a === undefined || color.a >= .999 ? hex(color) : `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${color.a})`;
}
function blend(a,b,t) { return { r:a.r*(1-t)+b.r*t, g:a.g*(1-t)+b.g*t, b:a.b*(1-t)+b.b*t }; }
function fillPaint(value, palette) {
  const original = parseColor(value);
  if (!original || original.a === 0) return value;
  const bg = parseColor(palette.background) || parseColor(DARK_PALETTE.background);
  const fg = parseColor(palette.foreground) || parseColor(DARK_PALETTE.foreground);
  let color;
  if (isNeutral(original)) {
    // Area fills are surfaces, not text: white paper and black-filled nodes
    // both become dark surfaces. A small gray range keeps shade distinctions.
    const gray = (original.r+original.g+original.b)/(3*255);
    color = blend(bg, {r:90,g:90,b:90}, (1-gray)*.28);
  } else {
    // Remove the white tint and reapply the same hue on the dark surface.
    const white = Math.min(original.r,original.g,original.b)/255;
    const strength = 1-white;
    const pigment = { r:(original.r-255*white)/strength, g:(original.g-255*white)/strength, b:(original.b-255*white)/strength };
    color = blend(bg,pigment,Math.pow(strength,.7));
  }
  if (contrastRatio(color,fg) < 4.5) {
    let low=0,high=1;
    for(let i=0;i<14;i++){const t=(low+high)/2;if(contrastRatio(blend(color,bg,t),fg)<4.55)low=t;else high=t;}
    color=blend(color,bg,high);
  }
  return colorString({...color,a:original.a});
}
function foregroundPaint(value,palette) {
  const color=parseColor(value);
  if (!color || color.a===0) return value;
  // White lettering on colored nodes must remain light too.
  if (isNeutral(color)) return colorString({...parseColor(palette.foreground),a:color.a});
  return strokePaint(value,palette,4.5);
}
function tagOf(element) { return String(element.localName||element.nodeName).toLowerCase(); }
function glyphElement(element) {
  const tag=tagOf(element);
  if(['text','tspan','textpath'].includes(tag))return true;
  if(tag!=='use')return false;
  const ref=element.getAttribute('href')||element.getAttribute('xlink:href')||'';
  return /^#(?:glyph|g\d+-|font[_-])/i.test(ref)||element.hasAttribute('data-text');
}
function inDefinitions(element) {
  for(let parent=element.parentNode;parent&&parent.nodeType===1;parent=parent.parentNode)if(['defs','clippath','mask','filter'].includes(tagOf(parent)))return true;
  return false;
}
function styleRules(root) {
  const rules=[];
  for(const element of Array.from(root.getElementsByTagName('style'))){
    (element.textContent||'').replace(/([^{}]+)\{([^{}]*)\}/g,(_,selectors,body)=>{
      for(const selector of selectors.split(',')){
        const value=selector.trim();
        if(/^(?:[a-zA-Z_][\w-]*)?(?:[.#][\w-]+)*$/.test(value)&&value)rules.push({selector:value,paints:declarations(body),specificity:(value.match(/#/g)||[]).length*100+(value.match(/\./g)||[]).length*10+(/^[a-zA-Z_]/.test(value)?1:0)});
      }
      return _;
    });
  }
  return rules;
}
function ruleMatches(element,selector) {
  const tag=/^[a-zA-Z_][\w-]*/.exec(selector);if(tag&&tagOf(element)!==tag[0].toLowerCase())return false;
  const id=/#([\w-]+)/.exec(selector);if(id&&element.getAttribute('id')!==id[1])return false;
  const classes=(element.getAttribute('class')||'').split(/\s+/);
  return Array.from(selector.matchAll(/\.([\w-]+)/g)).every(match=>classes.includes(match[1]));
}
function inheritedPaint(element,property,fallback,rules=[]) {
  for(let node=element;node&&node.nodeType===1;node=node.parentNode){
    const styles=declarations(node.getAttribute('style')||'').filter(([name])=>name===property);
    let value=node.getAttribute(property),specificity=-1;
    for(const rule of rules){if(rule.specificity<specificity||!ruleMatches(node,rule.selector))continue;const paints=rule.paints.filter(([name])=>name===property);if(paints.length){value=paints[paints.length-1][1];specificity=rule.specificity;}}
    if(styles.length)value=styles[styles.length-1][1];
    if(value)value=value.replace(/\s*!important\s*$/i,'');
    if(value&&value!=='inherit')return /^currentcolor$/i.test(value)?inheritedPaint(property==='color'?node.parentNode:node,'color','black',rules):value;
  }
  return fallback;
}
function areaFill(element,root) {
  if(['rect','circle','ellipse','polygon','image'].includes(tagOf(element)))return true;
  if(tagOf(element)!=='path')return false;
  const view=(root.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number);
  const canvas=view.length===4?Math.abs(view[2]*view[3]):0;
  const d=element.getAttribute('d')||'';
  // Closed polygon/Bezier fills cover regions; tiny filled paths are arrowheads.
  // Unsupported relative/arc paths conservatively count as regions.
  if(/[a-y]/.test(d)||/[Aa]/.test(d))return true;
  const values=(d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)||[]).map(Number);
  const xs=values.filter((_,i)=>i%2===0),ys=values.filter((_,i)=>i%2===1);
  if(!canvas||xs.length<2||ys.length<2)return false;
  const range=values=>values.reduce((b,v)=>[Math.min(b[0],v),Math.max(b[1],v)],[Infinity,-Infinity]);
  const xr=range(xs),yr=range(ys);let area=(xr[1]-xr[0])*(yr[1]-yr[0]);
  const matrix=/matrix\(([^)]+)\)/.exec(element.getAttribute('transform')||'');
  if(matrix){const m=matrix[1].trim().split(/[ ,]+/).map(Number);if(m.length===6)area*=Math.abs(m[0]*m[3]-m[1]*m[2]);}
  return area/canvas>.0025;
}
function makeDarkSvg(source, palette, Parser, Serializer) {
  const doc=parseSvg(source,Parser);if(!doc)return source;
  const root=doc.documentElement;
  const defaultFill=!root.hasAttribute('fill'),defaultColor=!root.hasAttribute('color');
  const elements=[root,...Array.from(root.getElementsByTagName('*'))];
  const rules=styleRules(root);
  const snapshots=[];
  for(const element of elements){
    if(inDefinitions(element))continue;
    if(glyphElement(element)||['path','rect','circle','ellipse','polygon','polyline'].includes(tagOf(element))){
      snapshots.push({element,fill:inheritedPaint(element,'fill','black',rules),area:!glyphElement(element)&&areaFill(element,root)});
    }
  }
  const adaptCss=css=>css.replace(/\b(fill|stroke|color|stop-color)\s*:\s*([^;}]+)/gi,(match,property,value)=>{
    const name=property.toLowerCase();const paint=value.trim();
    const mapped=name==='stroke'?strokePaint(paint,palette):(name==='fill'||name==='stop-color')?fillPaint(paint,palette):foregroundPaint(paint,palette);
    return mapped===paint?match:`${property}:${mapped}`;
  });
  for(const element of elements){
    if(['clippath','mask','filter'].includes(tagOf(element)))continue;
    for(const property of ['fill','stroke','color','stop-color']){
      if(!element.hasAttribute(property))continue;
      const value=element.getAttribute(property);
      const mapped=property==='stroke'?strokePaint(value,palette):(property==='fill'||property==='stop-color')?fillPaint(value,palette):foregroundPaint(value,palette);
      if(mapped!==value)element.setAttribute(property,mapped);
    }
    if(element.hasAttribute('style'))element.setAttribute('style',adaptCss(element.getAttribute('style')));
    if(tagOf(element)==='style')element.textContent=adaptCss(element.textContent||'');
  }
  // Override inherited fill on visible glyphs and arrowheads after recoloring
  // their parent groups. Keep path data, transforms, alpha and layout intact.
  for(const {element,fill,area} of snapshots){
    const mapped=area?fillPaint(fill,palette):foregroundPaint(fill,palette);
    element.setAttribute('fill',mapped);
    element.setAttribute('style',(element.getAttribute('style')||'')+';fill:'+mapped+' !important');
  }
  if(defaultFill)root.setAttribute('fill',palette.foreground);
  if(defaultColor)root.setAttribute('color',palette.foreground);
  return new Serializer().serializeToString(doc);
}
function useDarkTheme(source, systemDark, obsidianDark) {
  if (source === 'light') return false;
  if (source === 'dark') return true;
  return source === 'obsidian' ? obsidianDark : systemDark;
}
function luminance(color) {
  const linear = [color.r,color.g,color.b].map(v => { const c = v/255; return c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4; });
  return linear[0]*.2126 + linear[1]*.7152 + linear[2]*.0722;
}
function contrastRatio(a, b) { return (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05); }
function strokePaint(value, palette, minimum = 3) {
  const color = parseColor(value);
  if (!color || isNeutral(color)) return neutralPaint(value, palette);
  const background = parseColor(palette.background) || parseColor(DARK_PALETTE.background);
  if (color.a < .99 || contrastRatio(color, background) >= minimum) return value;
  // Mixing with white preserves HSL hue. Only low-contrast colored strokes are
  // lifted; colored fills/scales are never adapted by automatic mode.
  let low = 0; let high = 1;
  const mix = t => ({ r: color.r+(255-color.r)*t, g: color.g+(255-color.g)*t, b: color.b+(255-color.b)*t });
  for (let i=0; i<14; i++) { const t = (low+high)/2; if (contrastRatio(mix(t),background) < minimum+.05) low=t; else high=t; }
  return hex(mix(high));
}
function darkPalette(foreground, background) {
  const bg = parseColor(background);
  const chosenBg = bg && bg.a >= .99 && luminance(bg) < .25 ? hex(bg) : DARK_PALETTE.background;
  const fg = parseColor(foreground); const actualBg = parseColor(chosenBg);
  const contrast = fg ? (Math.max(luminance(fg),luminance(actualBg))+.05)/(Math.min(luminance(fg),luminance(actualBg))+.05) : 0;
  return { foreground: fg && contrast >= 4.5 ? hex(fg) : DARK_PALETTE.foreground, background: chosenBg };
}
module.exports = { DARK_PALETTE, parseColor, neutralPaint, fillPaint, foregroundPaint, strokePaint, contrastRatio, inspectSvg, makeDarkSvg, useDarkTheme, darkPalette };
