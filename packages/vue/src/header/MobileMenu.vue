<script setup lang="ts">
import { Bookmark, FileText, Palette, Superscript, TextCursorInput, TextQuote, Upload, UserPlus, WrapText } from '@lucide/vue';
import Menu from '../controls/Menu.vue';
import MenuItem from '../controls/MenuItem.vue';
import MenuSeparator from '../controls/MenuSeparator.vue';
import { useSnapshot, useUI } from '../context';
import ExampleItems from './ExampleItems.vue';
import ExportItems from './ExportItems.vue';

const emit = defineEmits<{ done: [] }>();
const { ui, editor } = useUI();
const viewMode = useSnapshot((s) => s.viewMode);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function run(fn: () => void) {
  emit('done');
  fn();
}

function toggleView() {
  emit('done');
  if (viewMode.value === 'web') {
    editor.setViewMode('print');
    requestAnimationFrame(() => editor.fitWidth());
  } else editor.setViewMode('web');
}
</script>

<template>
  <Menu label="Menu">
    <MenuItem label="Upload DOCX" test-id="m-upload" @select="run(() => ui.files.open())"><template #icon><Upload :size="16" /></template></MenuItem>
    <ExampleItems @done="emit('done')" />
    <MenuSeparator />
    <MenuItem
      :label="viewMode === 'web' ? 'Show pages' : 'Reflow text'"
      :description="viewMode === 'web' ? 'Page layout, scaled to the screen' : 'Text fits the screen width'"
      test-id="m-view"
      @select="toggleView"
    >
      <template #icon><FileText v-if="viewMode === 'web'" :size="16" /><WrapText v-else :size="16" /></template>
    </MenuItem>
    <template v-if="!readOnly">
      <MenuItem label="Insert field" test-id="m-field" @select="run(() => editor.insertField())"><template #icon><TextCursorInput :size="16" /></template></MenuItem>
      <MenuItem label="Insert footnote…" test-id="m-footnote" @select="run(() => ui.openModal('note', { kind: 'footnote' }))"><template #icon><Superscript :size="16" /></template></MenuItem>
      <MenuItem label="Create bookmark…" test-id="m-bookmark" @select="run(() => ui.openModal('bookmark'))"><template #icon><Bookmark :size="16" /></template></MenuItem>
      <MenuItem label="Insert cross-reference…" test-id="m-crossref" @select="run(() => ui.openModal('crossRef'))"><template #icon><TextQuote :size="16" /></template></MenuItem>
    </template>
    <MenuSeparator />
    <ExportItems @done="emit('done')" />
    <MenuSeparator />
    <MenuItem label="Share (collaborate)" test-id="m-share" @select="run(() => ui.openModal('share'))"><template #icon><UserPlus :size="16" /></template></MenuItem>
    <MenuItem label="Customize" test-id="m-customize" @select="run(() => ui.openModal('customize'))"><template #icon><Palette :size="16" /></template></MenuItem>
  </Menu>
</template>
