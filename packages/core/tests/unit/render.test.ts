import { describe, expect, it } from 'vitest';
import { bordersCss, shadingCss, spacingCss } from '../../src/core/model/css';
import { schema } from '../../src/core/model/schema';
import { openEditor } from './editorHelpers';

describe('paragraph spacing CSS', () => {
  it('keeps borders and shading inside the space before and after', () => {
    expect(spacingCss({ before: 240, after: 120 })).toEqual(['--ml-dx-sb: 12pt', '--ml-dx-sa: 6pt']);
    expect(bordersCss({ bottom: { val: 'single', sz: 8, space: 4, color: '000000' } })).toEqual(expect.arrayContaining(['--ml-dx-oa: 1', '--ml-dx-bbs: 4pt']));
    expect(shadingCss('EDF3FB')).toEqual(['background-color: #EDF3FB', '--ml-dx-ob: 1', '--ml-dx-oa: 1']);
    const dom = schema.nodes.paragraph.spec.toDOM!(schema.nodes.paragraph.create({ spacing: { after: 160 }, shading: 'EDF3FB' })) as [string, Record<string, string>];
    expect(dom[1].style).toContain('--ml-dx-sa: 8pt');
    expect(dom[1].style).toContain('--ml-dx-oa: 1');
  });
});

describe('floating pictures', () => {
  it('sit on the margin; their distances only keep the text away', () => {
    const ed = openEditor();
    const anchor = { wrap: 'square', behindDoc: false, hAlign: 'right', hRelative: 'margin', vRelative: 'paragraph', vOffset: 0, distT: 0, distB: 0, distL: 114300, distR: 114300 };
    const image = schema.nodes.image.create({ width: 1143000, height: 1143000, anchor });
    ed.view.dispatch(ed.view.state.tr.insert(1, image));
    const el = ed.view.dom.querySelector<HTMLElement>('.ml-dx-image-wrap')!;
    expect(el.style.float).toBe('right');
    expect(parseFloat(el.style.marginRight)).toBe(0);
    expect(parseFloat(el.style.marginLeft)).toBe(9);
    ed.destroy();
  });
});
