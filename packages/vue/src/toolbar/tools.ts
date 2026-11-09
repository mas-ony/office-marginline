import type { Component } from 'vue';
import AlignTool from './AlignTool.vue';
import BulletListTool from './BulletListTool.vue';
import ClearFormatTool from './ClearFormatTool.vue';
import ColorTool from './ColorTool.vue';
import CopyFormatTool from './CopyFormatTool.vue';
import FontFamilyTool from './FontFamilyTool.vue';
import FontSizeTool from './FontSizeTool.vue';
import HighlightTool from './HighlightTool.vue';
import ImageTool from './ImageTool.vue';
import IndentTool from './IndentTool.vue';
import LineHeightTool from './LineHeightTool.vue';
import LinkTool from './LinkTool.vue';
import MarkTool from './MarkTool.vue';
import NumberedListTool from './NumberedListTool.vue';
import RedoTool from './RedoTool.vue';
import RulerTool from './RulerTool.vue';
import StylesTool from './StylesTool.vue';
import TableActionsTool from './TableActionsTool.vue';
import TableTool from './TableTool.vue';
import UndoTool from './UndoTool.vue';
import ZoomTool from './ZoomTool.vue';

/** The component (and its props) for each built-in toolbar item. */
export const TOOLS: Record<string, { is: Component; props?: Record<string, unknown> }> = {
  undo: { is: UndoTool },
  redo: { is: RedoTool },
  zoom: { is: ZoomTool },
  font: { is: FontFamilyTool },
  size: { is: FontSizeTool },
  bold: { is: MarkTool, props: { kind: 'bold' } },
  italic: { is: MarkTool, props: { kind: 'italic' } },
  underline: { is: MarkTool, props: { kind: 'underline' } },
  strike: { is: MarkTool, props: { kind: 'strike' } },
  color: { is: ColorTool },
  highlight: { is: HighlightTool },
  link: { is: LinkTool },
  image: { is: ImageTool },
  table: { is: TableTool },
  'table-actions': { is: TableActionsTool },
  align: { is: AlignTool },
  bullets: { is: BulletListTool },
  numbers: { is: NumberedListTool },
  outdent: { is: IndentTool, props: { dir: 'outdent' } },
  indent: { is: IndentTool, props: { dir: 'indent' } },
  'line-height': { is: LineHeightTool },
  styles: { is: StylesTool },
  'copy-format': { is: CopyFormatTool },
  clear: { is: ClearFormatTool },
  ruler: { is: RulerTool },
};
