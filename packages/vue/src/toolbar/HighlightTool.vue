<script setup lang="ts">
import { highlightBar, setHighlight } from '@marginline/core/views';
import { Highlighter } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import ColorPalette from './ColorPalette.vue';
import ToolMenu from './ToolMenu.vue';

const { editor } = useUI();
const hl = useSnapshot((s) => s.cursor?.highlight ?? null);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function pick(hex: string | null, close: () => void) {
  setHighlight(editor.activeView, hex ? `#${hex}` : null);
  close();
  editor.focus();
}
</script>

<template>
  <ToolMenu label="Highlight" :chevron="false" :disabled="readOnly" test-id="tb-highlight">
    <template #icon><span class="ml-color-icon"><Highlighter :size="18" /><span class="ml-color-bar" :style="{ background: highlightBar(hl) }" /></span></template>
    <template #default="{ close }"><ColorPalette label="Highlight" :value="hl?.startsWith('#') ? hl : null" none="None" @pick="(hex) => pick(hex, close)" /></template>
  </ToolMenu>
</template>
