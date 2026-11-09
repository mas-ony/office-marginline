import type { Mark } from 'prosemirror-model';
import { schema } from './schema';
import type { RunProps } from './types';

/** Convert run properties into ProseMirror marks. */
export function runPropsToMarks(props: RunProps, rawXml: string | null = null): Mark[] {
  const s = schema.marks;
  const out: Mark[] = [];
  if (props.styleId) out.push(s.charStyle.create({ styleId: props.styleId }));
  if (props.fonts && Object.values(props.fonts).some(Boolean)) out.push(s.font.create({ ...props.fonts }));
  if (props.size !== undefined) out.push(s.fontSize.create({ size: props.size }));
  if (props.color) {
    out.push(s.color.create({
      color: props.color.val,
      themeColor: props.color.themeColor ?? null,
      themeShade: props.color.themeShade ?? null,
      themeTint: props.color.themeTint ?? null,
    }));
  }
  if (props.highlight) out.push(s.highlight.create({ color: props.highlight }));
  if (props.shading) out.push(s.shading.create({ fill: props.shading }));
  if (props.bold !== undefined) out.push(s.bold.create({ value: props.bold }));
  if (props.italic !== undefined) out.push(s.italic.create({ value: props.italic }));
  if (props.underline) out.push(s.underline.create({ type: props.underline, color: props.underlineColor ?? null }));
  if (props.strike !== undefined) out.push(s.strike.create({ value: props.strike }));
  if (props.dstrike !== undefined) out.push(s.dstrike.create({ value: props.dstrike }));
  if (props.caps !== undefined) out.push(s.caps.create({ value: props.caps }));
  if (props.smallCaps !== undefined) out.push(s.smallCaps.create({ value: props.smallCaps }));
  if (props.vanish !== undefined) out.push(s.hidden.create({ value: props.vanish }));
  if (props.vertAlign) out.push(s.vertAlign.create({ value: props.vertAlign }));
  if (props.spacing) out.push(s.charSpacing.create({ value: props.spacing }));
  if (props.position) out.push(s.position.create({ value: props.position }));
  if (rawXml) out.push(s.runExtra.create({ xml: rawXml }));
  return out;
}

export interface RunMarkInfo {
  props: RunProps;
  rawXml: string | null;
  link?: Mark;
  field?: Mark;
  insertion?: Mark;
  deletion?: Mark;
  formatChange?: Mark;
  comments: string[];
}

/** Split a mark set back into run properties and structural marks. */
export function marksToRunProps(marks: readonly Mark[]): RunMarkInfo {
  const props: RunProps = {};
  const info: RunMarkInfo = { props, rawXml: null, comments: [] };
  for (const m of marks) {
    const a = m.attrs;
    switch (m.type.name) {
      case 'charStyle': props.styleId = a.styleId; break;
      case 'font': {
        const f: RunProps['fonts'] = {};
        for (const k of ['ascii', 'hAnsi', 'eastAsia', 'cs', 'asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme', 'hint'] as const) {
          if (a[k]) f[k] = a[k];
        }
        props.fonts = f;
        break;
      }
      case 'fontSize': props.size = a.size; break;
      case 'color':
        props.color = { val: a.color };
        if (a.themeColor) props.color.themeColor = a.themeColor;
        if (a.themeShade) props.color.themeShade = a.themeShade;
        if (a.themeTint) props.color.themeTint = a.themeTint;
        break;
      case 'highlight': props.highlight = a.color; break;
      case 'shading': props.shading = a.fill; break;
      case 'bold': props.bold = a.value; break;
      case 'italic': props.italic = a.value; break;
      case 'underline':
        props.underline = a.type;
        if (a.color) props.underlineColor = a.color;
        break;
      case 'strike': props.strike = a.value; break;
      case 'dstrike': props.dstrike = a.value; break;
      case 'caps': props.caps = a.value; break;
      case 'smallCaps': props.smallCaps = a.value; break;
      case 'hidden': props.vanish = a.value; break;
      case 'vertAlign': props.vertAlign = a.value; break;
      case 'charSpacing': props.spacing = a.value; break;
      case 'position': props.position = a.value; break;
      case 'runExtra': info.rawXml = a.xml || null; break;
      case 'link': info.link = m; break;
      case 'field': info.field = m; break;
      case 'insertion': info.insertion = m; break;
      case 'deletion': info.deletion = m; break;
      case 'formatChange': info.formatChange = m; break;
      case 'comment': info.comments.push(a.id); break;
    }
  }
  return info;
}
