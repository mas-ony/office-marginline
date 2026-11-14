import { strFromU8, unzipSync, unzlibSync } from 'fflate';
import { DOMParser as PMDOMParser, Fragment } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { exportDocx } from '../../src/core/export/exporter';
import { importDocx } from '../../src/core/import/importer';
import { drawingTheme, renderDrawing, resolveColor, shapeOutline, type DrawingModel, type DrawingTheme, type PartBox, type PicturePart, type ShapePart } from '../../src/core/model/drawing';
import { ATTRS_DATA, schema } from '../../src/core/model/schema';
import { parseXml } from '../../src/core/xml/xml';
import { clipboardSerializer } from '../../src/editor/clipboard';
import { writePdf } from '../../src/pdf/writer';
import { fixture, nodesOfType } from './helpers';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const office = drawingTheme({});
/** A DrawingML colour element, written without its namespace declaration. */
const color = (xml: string, theme: DrawingTheme = office) => resolveColor(parseXml(xml.replace(/^<a:(\w+)/, `<a:$1 xmlns:a="${A}"`)).root, theme);
/** A part's box rounded to 0.01 px: x, y, width, height. */
const box = (p: PartBox) => [p.x, p.y, p.w, p.h].map((v) => Math.round(v * 100) / 100);

describe('drawing colours', () => {
  it('darkens theme colours with shade in linear light, as shape styles do', () => {
    expect(color('<a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr>')).toEqual({ color: '#2F528F', opacity: 1 });
  });

  it('applies the luminance modifiers of the lighter and darker theme colours', () => {
    expect(color('<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>')?.color).toBe('#8FAADC');
    expect(color('<a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr>')?.color).toBe('#2F5597');
    expect(color('<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>')?.color).toBe('#203864');
    expect(color('<a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr>')?.color).toBe('#C55A11');
    expect(color('<a:schemeClr val="bg1"><a:lumMod val="85000"/></a:schemeClr>')?.color).toBe('#D9D9D9');
    expect(color('<a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr>')?.color).toBe('#595959');
  });

  it('reads transparency and preset, system and placeholder colours', () => {
    expect(color('<a:srgbClr val="FF0000"><a:alpha val="25000"/></a:srgbClr>')).toEqual({ color: '#FF0000', opacity: 0.25 });
    expect(color('<a:prstClr val="navy"/>')?.color).toBe('#000080');
    expect(color('<a:sysClr val="windowText" lastClr="111111"/>')?.color).toBe('#111111');
    expect(color('<a:schemeClr val="phClr"/>')).toBeNull();
    const ph = resolveColor(parseXml(`<a:schemeClr xmlns:a="${A}" val="phClr"><a:alpha val="50000"/></a:schemeClr>`).root, office, { color: '#123456', opacity: 1 });
    expect(ph).toEqual({ color: '#123456', opacity: 0.5 });
  });

  it('maps the background and text colours as the document settings say', () => {
    const mapping = parseXml(`<w:clrSchemeMapping xmlns:w="${W}" w:bg1="dark1" w:t1="light1" w:bg2="dark2" w:t2="light2"/>`).root;
    const theme = drawingTheme({ dk1: '101010', lt1: 'FAFAFA', dk2: '203040', lt2: 'E0E0E0' }, [], mapping);
    expect(color('<a:schemeClr val="bg1"/>', theme)?.color).toBe('#101010');
    expect(color('<a:schemeClr val="tx1"/>', theme)?.color).toBe('#FAFAFA');
    expect(color('<a:schemeClr val="tx2"/>', theme)?.color).toBe('#E0E0E0');
    expect(color('<a:schemeClr val="bg1"/>')?.color).toBe('#FFFFFF');
  });
});

describe('drawings in a document', () => {
  const doc = importDocx(fixture('drawings.docx'), { urlFactory: (media) => `blob:test/${media.path}` });
  const nodes = nodesOfType(doc.body, 'opaque_inline');
  const drawings = nodes.map((n) => n.attrs.drawing as DrawingModel);

  it('reads shapes, groups and canvases, and a picture in a group as part of the group', () => {
    expect(nodes.map((n) => n.attrs.label)).toEqual(['Group', 'Shape', 'Shape', 'Shape', 'Shape', 'Shape', 'Drawing canvas']);
    expect(drawings.every(Boolean)).toBe(true);
    expect(nodesOfType(doc.body, 'image')).toHaveLength(0);
    expect(doc.warnings).toEqual([]);
  });

  it('places the parts of a group in its box, scaled from the child space', () => {
    const [group] = drawings;
    expect([group.width, group.height]).toEqual([400, 100]);
    expect(group.anchor).toMatchObject({ wrap: 'none', behindDoc: false, hRelative: 'column', hOffset: 0, vRelative: 'paragraph', vOffset: 0 });
    const [pic, text, line] = group.parts as [PicturePart, ShapePart, ShapePart];
    expect(pic.kind).toBe('picture');
    expect(pic.mediaPath).toBe('word/media/image1.png');
    expect(box(pic)).toEqual([0, 0, 50, 100]);
    expect(box(text)).toEqual([60, 0, 340, 80]);
    expect([text.fill, text.line]).toEqual([null, null]);
    expect(box(line)).toEqual([0, 94, 400, 2]);
    expect(line).toMatchObject({ flipV: true, geometry: { preset: 'line' }, line: { paint: { color: '#000000', opacity: 1 }, width: 3 } });
  });

  it('reads the paragraphs of a text box in a group as editor content', () => {
    const text = (drawings[0].parts[1] as ShapePart).text!;
    expect(text).toMatchObject({ insets: [9.6, 4.8, 9.6, 4.8], anchor: 'top', vertical: 'horz', wrap: true });
    const paragraphs = Fragment.fromJSON(schema, text.content);
    expect(paragraphs.childCount).toBe(2);
    expect(paragraphs.child(0).textContent).toBe('Drawn heading');
    expect(paragraphs.child(0).attrs.align).toBe('center');
    expect(paragraphs.child(0).firstChild!.marks.map((m) => m.type.name)).toContain('bold');
    expect(paragraphs.child(1).textContent).toBe('Second line');
  });

  it('takes an outline from the shape style and the theme', () => {
    const check = drawings[1];
    expect(check.anchor).toMatchObject({ wrap: 'none', hOffset: 38100, vOffset: 19050 });
    const [rect] = check.parts as [ShapePart];
    expect(rect.fill).toBeNull();
    expect(rect.line?.paint).toEqual({ color: '#2F528F', opacity: 1 });
    expect(rect.line?.width).toBeCloseTo(12700 / 9525, 5);
  });

  it('reads fills, dashes, line ends, custom outlines and canvases', () => {
    const [ellipse, round, arrow, custom, canvas] = drawings.slice(2).map((d) => d.parts as ShapePart[]);
    expect(ellipse[0]).toMatchObject({ geometry: { preset: 'ellipse' }, fill: { kind: 'solid', paint: { color: '#C55A11', opacity: 1 } }, line: null });
    expect(round[0].geometry).toEqual({ preset: 'roundRect', adjust: { adj: 25000 } });
    expect(round[0].fill).toEqual({ kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#4472C4', opacity: 1 }, { offset: 1, color: '#FFFFFF', opacity: 1 }] });
    expect(round[0].line).toMatchObject({ paint: { color: '#1F3864' }, width: 1, dash: [4, 3] });
    expect(arrow[0].line).toMatchObject({ paint: { color: '#C00000' }, width: 2, tail: { type: 'triangle', w: 'med', len: 'med' } });
    expect(arrow[0].line?.head).toBeUndefined();
    expect(custom[0].geometry).toEqual({ paths: [{ w: 100, h: 100, fill: true, stroke: true, commands: [['M', 0, 100], ['L', 0, 50], ['A', 50, 50, 180, 180], ['L', 100, 100], ['Z']] }] });
    expect(custom[0].fill).toEqual({ kind: 'solid', paint: { color: '#FFC000', opacity: 0.5 } });
    expect(canvas.map((p) => [p.kind, 'preset' in p.geometry && p.geometry.preset, ...box(p)])).toEqual([['shape', 'rect', 0, 0, 60, 40], ['shape', 'diamond', 10, 10, 30, 20]]);
    expect(canvas[0].fill).toEqual({ kind: 'solid', paint: { color: '#F2F2F2', opacity: 1 } });
  });

  it('writes outlines with lines and curves only', () => {
    expect(shapeOutline({ preset: 'rect', adjust: {} }, 23, 15)[0].d).toBe('M0 0 L23 0 L23 15 L0 15 Z');
    // The custom arch: up the left side, half an ellipse over the top in two curves, down the right.
    const arch = shapeOutline((drawings[5].parts[0] as ShapePart).geometry, 40, 40)[0].d;
    expect(arch).toMatch(/^M0 40 L0 20 C[\d. ]+ 20 0 C[\d. ]+ 40 20 L40 40 Z$/);
    for (const preset of ['ellipse', 'roundRect', 'wedgeRoundRectCallout', 'cloud', 'can', 'arc', 'pie', 'heart', 'donut', 'flowChartDocument', 'rightArrow', 'star5']) {
      for (const o of shapeOutline({ preset, adjust: {} }, 120, 80)) expect(o.d, preset).toMatch(/^M[MLCZ\d .e-]*$/);
    }
  });

  it('draws a drawing as parts placed over outlines', () => {
    const group = renderDrawing(drawings[0], schema);
    expect(group.className).toBe('ml-dx-drawing ml-dx-float');
    expect([group.style.position, group.style.width, group.style.height, group.style.left, group.style.top]).toEqual(['absolute', '400px', '100px', '0px', '0px']);
    const parts = Array.from(group.children) as HTMLElement[];
    expect(parts.map((p) => p.className)).toEqual(['ml-dx-drawing-part ml-dx-drawing-pic', 'ml-dx-drawing-part', 'ml-dx-drawing-part']);
    expect([parts[1].style.left, parts[1].style.width, parts[1].style.height]).toEqual(['60px', '340px', '80px']);
    expect(parts[0].querySelector('img')?.getAttribute('src')).toBe('blob:test/word/media/image1.png');
    // A paragraph cannot hold <p>: the text box's paragraphs become block spans.
    const text = parts[1].querySelector('.ml-dx-drawing-text')!;
    expect(text.querySelector('p')).toBeNull();
    expect(Array.from(text.querySelectorAll('.ml-dx-p')).map((p) => p.textContent)).toEqual(['Drawn heading', 'Second line']);
    expect(parts[2].style.transform).toBe('');
    expect(parts[2].querySelector('svg')?.style.transform).toBe('scale(1, -1)');

    const check = renderDrawing(drawings[1], schema);
    expect([check.style.left, check.style.top]).toEqual(['4px', '2px']);
    const path = check.querySelector('path')!;
    expect(path.getAttribute('d')).toBe('M0 0 L23 0 L23 15 L0 15 Z');
    expect([path.getAttribute('fill'), path.getAttribute('stroke'), path.getAttribute('stroke-width')]).toEqual(['none', '#2F528F', '1.33']);

    const inline = renderDrawing(drawings[2], schema);
    expect(inline.className).toBe('ml-dx-drawing');
    expect(inline.style.position).toBe('');
  });

  it('keeps a drawing through copy and paste', () => {
    const container = document.createElement('div');
    container.appendChild(clipboardSerializer().serializeFragment(Fragment.from(nodes[0])));
    expect(container.querySelector(`.ml-dx-drawing[${ATTRS_DATA}]`)).not.toBeNull();
    const pasted = PMDOMParser.fromSchema(schema).parseSlice(container).content.firstChild!;
    expect(pasted.type.name).toBe('opaque_inline');
    expect(pasted.attrs.drawing).toEqual(nodes[0].attrs.drawing);
    expect(pasted.attrs.xml).toBe(nodes[0].attrs.xml);
  });

  it('writes the drawings back as they were', () => {
    const bytes = exportDocx(doc, doc.body, { now: new Date('2025-01-01T00:00:00Z') });
    const files = unzipSync(bytes);
    const xml = strFromU8(files['word/document.xml']);
    expect(xml.match(/<wpg:wgp>/g)).toHaveLength(1);
    expect(xml.match(/<wpc:wpc>/g)).toHaveLength(1);
    expect(xml.match(/<mc:AlternateContent>/g)).toHaveLength(1);
    expect(files['word/media/image1.png']).toBeDefined();
  });
});

describe('vector paths in PDF', () => {
  it('writes moves, lines, curves and closes with fill, outline and dashes', () => {
    const bytes = writePdf([{
      width: 200,
      height: 100,
      ops: [
        { kind: 'path', segs: [['M', 0, 0], ['L', 40, 0], ['C', 40, 20, 20, 40, 0, 40], ['Z']], fill: [255, 0, 0], evenOdd: true, stroke: [0, 0, 255], width: 2, dash: [4, 2], cap: 'round', join: 'bevel' },
        { kind: 'path', segs: [['M', 0, 0], ['L', 40, 40]], stroke: [47, 82, 143], width: 1 },
        { kind: 'path', segs: [['M', 0, 0], ['L', 4, 4], ['Z']], fill: [0, 128, 0] },
      ],
    }]);
    // Without text or pictures, the page's content is the file's only stream.
    const text = new TextDecoder('latin1').decode(bytes);
    const streams = [...text.matchAll(/\/Length (\d+) >>\nstream\n/g)];
    expect(streams).toHaveLength(1);
    const start = streams[0].index! + streams[0][0].length;
    const ops = strFromU8(unzlibSync(bytes.subarray(start, start + Number(streams[0][1]))));
    expect(ops).toContain('q 1 0 0 rg 0 0 1 RG 1.5 w 1 J 2 j [3 1.5] 0 d 0 75 m 30 75 l 30 60 15 45 0 45 c h B* Q');
    expect(ops).toContain('q 0.184 0.322 0.561 RG 0.75 w 0 J 0 j [] 0 d 0 75 m 30 45 l S Q');
    expect(ops).toContain('q 0 0.502 0 rg 0 75 m 3 72 l h f Q');
  });
});
