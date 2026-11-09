<script setup lang="ts">
import { clampToWindow, contextMenuAt, contextMenuState, insertTable, modKey as mod, pasteFromClipboard, pasteMatching, pasteRefusedMessage, removeLink } from '@marginline/core/views';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  ClipboardType,
  Copy,
  Link2,
  MessageSquare,
  PaintBucket,
  Redo2,
  Scissors,
  Superscript,
  Table,
  TableProperties,
  TextQuote,
  Undo2,
  Unlink,
} from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import Menu from './controls/Menu.vue';
import MenuItem from './controls/MenuItem.vue';
import MenuSeparator from './controls/MenuSeparator.vue';
import { useUI } from './context';
import ColorPalette from './toolbar/ColorPalette.vue';
import LinkForm from './toolbar/LinkForm.vue';
import TableActionsMenu from './toolbar/TableActionsMenu.vue';
import TableGrid from './toolbar/TableGrid.vue';

type Page = 'main' | 'table' | 'cellBg' | 'link' | 'insertTable';

/** The document context menu (right click). */
const { ui, state, editor, layer } = useUI();
const at = ref<{ x: number; y: number } | null>(null);
const page = ref<Page>('main');
const el = ref<HTMLDivElement | null>(null);
const pos = ref({ left: 0, top: 0 });
// What the menu offers, as of when it opened or changed page.
const offer = computed(() => {
  void at.value;
  void page.value;
  return { ...contextMenuState(editor), canUndo: editor.canUndo, canRedo: editor.canRedo };
});

const onContext = (e: MouseEvent) => {
  if (!contextMenuAt(editor, e, state.value.mobile)) return;
  page.value = 'main';
  at.value = { x: e.clientX, y: e.clientY };
};
onMounted(() => document.addEventListener('contextmenu', onContext));
onUnmounted(() => document.removeEventListener('contextmenu', onContext));

watch(at, (open, _, onCleanup) => {
  if (!open) return;
  const close = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
    if (e.type === 'pointerdown' && (el.value?.contains(e.target as Node) || (e.target as HTMLElement).closest?.('.ml-ui-popover'))) return;
    at.value = null;
  };
  document.addEventListener('pointerdown', close, true);
  document.addEventListener('keydown', close, true);
  window.addEventListener('blur', close);
  editor.scrollEl.addEventListener('scroll', close, { passive: true });
  onCleanup(() => {
    document.removeEventListener('pointerdown', close, true);
    document.removeEventListener('keydown', close, true);
    window.removeEventListener('blur', close);
    editor.scrollEl.removeEventListener('scroll', close);
  });
});

watch([at, page], () => {
  if (at.value && el.value) pos.value = clampToWindow(at.value.x, at.value.y, el.value);
}, { flush: 'post' });

const done = () => {
  at.value = null;
};

async function paste(kind: 'source' | 'match' | 'text') {
  done();
  const view = editor.activeView;
  const ok = kind === 'match' ? await pasteMatching(view) : await pasteFromClipboard(view, kind === 'text', (files) => void editor.insertImages(files));
  if (!ok) ui.toast(pasteRefusedMessage(kind));
}

function run(fn: () => void) {
  done();
  fn();
}

function command(name: 'cut' | 'copy') {
  document.execCommand(name);
  done();
}

function pickCellBackground(hex: string | null) {
  editor.setCellBackground(hex);
  done();
}

function insertGrid(rows: number, cols: number) {
  insertTable(editor.activeView, editor.docx, rows, cols);
  done();
  editor.focus();
}

function linkDone() {
  done();
  editor.focus();
}
</script>

<template>
  <Teleport v-if="at" :to="layer">
    <div ref="el" class="ml-ui-popover ml-context" :style="{ position: 'fixed', left: `${pos.left}px`, top: `${pos.top}px` }" data-testid="context-menu">
      <template v-if="page === 'table'">
        <button type="button" class="ml-ui-menuitem ml-menu-back" @click="page = 'main'"><ChevronLeft :size="16" /> Edit table</button>
        <TableActionsMenu @done="done" />
      </template>
      <template v-else-if="page === 'cellBg'">
        <button type="button" class="ml-ui-menuitem ml-menu-back" @click="page = 'main'"><ChevronLeft :size="16" /> Cell background</button>
        <ColorPalette label="Cell background" :value="null" none="No color" @pick="pickCellBackground" />
      </template>
      <LinkForm v-else-if="page === 'link'" @done="linkDone" />
      <TableGrid v-else-if="page === 'insertTable'" @pick="insertGrid" />
      <Menu v-else label="Context menu">
        <MenuItem label="Comment" test-id="ctx-comment" :disabled="offer.readOnly || !offer.body" @select="run(() => ui.openComposer())"><template #icon><MessageSquare :size="16" /></template></MenuItem>
        <MenuSeparator />
        <MenuItem label="Cut" :shortcut="`${mod}+X`" :disabled="offer.readOnly || !offer.hasText" @select="command('cut')"><template #icon><Scissors :size="16" /></template></MenuItem>
        <MenuItem label="Copy" :shortcut="`${mod}+C`" :disabled="!offer.hasText" @select="command('copy')"><template #icon><Copy :size="16" /></template></MenuItem>
        <MenuItem label="Keep Source Formatting" :shortcut="`${mod}+V`" :disabled="offer.readOnly" test-id="ctx-paste" @select="paste('source')"><template #icon><ClipboardPaste :size="16" /></template></MenuItem>
        <MenuItem label="Match Destination Formatting" :shortcut="`${mod}+Shift+V`" :disabled="offer.readOnly" @select="paste('match')"><template #icon><ClipboardPaste :size="16" /></template></MenuItem>
        <MenuItem label="Keep Text Only" :disabled="offer.readOnly" @select="paste('text')"><template #icon><ClipboardType :size="16" /></template></MenuItem>
        <MenuSeparator />
        <MenuItem label="Undo" :shortcut="`${mod}+Z`" :disabled="!offer.canUndo" @select="editor.undo(); done()"><template #icon><Undo2 :size="16" /></template></MenuItem>
        <MenuItem label="Redo" :shortcut="`${mod}+Shift+Z`" :disabled="!offer.canRedo" @select="editor.redo(); done()"><template #icon><Redo2 :size="16" /></template></MenuItem>
        <MenuSeparator />
        <MenuItem label="Create bookmark" test-id="ctx-bookmark" :disabled="offer.readOnly || !offer.body" @select="run(() => ui.openModal('bookmark'))"><template #icon><Bookmark :size="16" /></template></MenuItem>
        <MenuItem label="Insert cross-reference" test-id="ctx-crossref" :disabled="offer.readOnly || !offer.body" @select="run(() => ui.openModal('crossRef'))"><template #icon><TextQuote :size="16" /></template></MenuItem>
        <MenuItem :label="offer.link ? 'Edit link' : 'Insert link'" test-id="ctx-link" :disabled="offer.readOnly" @select="page = 'link'"><template #icon><Link2 :size="16" /></template></MenuItem>
        <MenuItem v-if="offer.link" label="Remove link" :disabled="offer.readOnly" @select="removeLink(editor.activeView); done()"><template #icon><Unlink :size="16" /></template></MenuItem>
        <MenuItem v-if="!offer.inTable" label="Insert table" test-id="ctx-table" :disabled="offer.readOnly" @select="page = 'insertTable'"><template #icon><Table :size="16" /></template></MenuItem>
        <MenuItem label="Insert footnote" test-id="ctx-footnote" :disabled="offer.readOnly || !offer.body" @select="run(() => ui.openModal('note', { kind: 'footnote' }))"><template #icon><Superscript :size="16" /></template></MenuItem>
        <template v-if="offer.inTable">
          <MenuSeparator />
          <button type="button" class="ml-ui-menuitem" role="menuitem" data-testid="ctx-edit-table" :disabled="offer.readOnly" @click="page = 'table'">
            <span class="ml-ui-menuitem-icon"><TableProperties :size="16" /></span>
            <span class="ml-ui-menuitem-text"><span class="ml-ui-menuitem-label">Edit table</span></span>
            <ChevronRight :size="16" />
          </button>
          <button type="button" class="ml-ui-menuitem" role="menuitem" data-testid="ctx-cell-bg" :disabled="offer.readOnly" @click="page = 'cellBg'">
            <span class="ml-ui-menuitem-icon"><PaintBucket :size="16" /></span>
            <span class="ml-ui-menuitem-text"><span class="ml-ui-menuitem-label">Cell background</span></span>
            <ChevronRight :size="16" />
          </button>
        </template>
      </Menu>
    </div>
  </Teleport>
</template>
