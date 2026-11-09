<script setup lang="ts">
import { FONT_SIZES, parseFontSize, setFontSize } from '@marginline/core/views';
import { useSnapshot, useUI } from '../context';
import Combo from './Combo.vue';

const { editor } = useUI();
const size = useSnapshot((s) => s.cursor?.fontSize);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
const options = FONT_SIZES.map(String);

function commit(v: string) {
  const n = parseFontSize(v);
  if (n !== null) setFontSize(editor.activeView, n);
  editor.focus();
}
</script>

<template>
  <Combo label="Font size" :value="size ? String(size) : ''" :options="options" :width="58" test-id="tb-size" numeric :disabled="readOnly" @commit="commit" />
</template>
