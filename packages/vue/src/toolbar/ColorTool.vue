<script setup lang="ts">
import { colorBar, setTextColor } from '@marginline/core/views';
import { Baseline } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import ColorPalette from './ColorPalette.vue';
import ToolMenu from './ToolMenu.vue';

const { editor } = useUI();
const color = useSnapshot((s) => s.cursor?.color ?? null);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function pick(hex: string | null, close: () => void) {
  setTextColor(editor.activeView, hex);
  close();
  editor.focus();
}
</script>

<template>
  <ToolMenu label="Text color" :chevron="false" :disabled="readOnly" test-id="tb-color">
    <template #icon><span class="ml-color-icon"><Baseline :size="18" /><span class="ml-color-bar" :style="{ background: colorBar(color) }" /></span></template>
    <template #default="{ close }"><ColorPalette label="Text color" :value="color" none="Automatic" @pick="(hex) => pick(hex, close)" /></template>
  </ToolMenu>
</template>
