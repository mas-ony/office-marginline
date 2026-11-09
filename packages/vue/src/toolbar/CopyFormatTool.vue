<script setup lang="ts">
import { Paintbrush } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import ToolButton from './ToolButton.vue';

const { editor } = useUI();
const on = useSnapshot((s) => s.painter);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function toggle() {
  if (on.value) editor.stopFormatPainter();
  else editor.startFormatPainter();
}
</script>

<template>
  <ToolButton label="Copy formatting" :active="on" :disabled="readOnly" test-id="tb-format-painter" @click="toggle"><Paintbrush :size="18" /></ToolButton>
</template>
