<script setup lang="ts">
import { FONT_FAMILIES, fontStack, setFontFamily } from '@marginline/core/views';
import { useSnapshot, useUI } from '../context';
import Combo from './Combo.vue';

const { editor } = useUI();
const value = useSnapshot((s) => s.cursor?.fontFamily ?? '');
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function commit(family: string) {
  setFontFamily(editor.activeView, family);
  editor.focus();
}
</script>

<template>
  <Combo label="Font family" :value="value" :options="FONT_FAMILIES" :width="132" test-id="tb-font" :disabled="readOnly" @commit="commit">
    <template #option="{ option }"><span :style="{ fontFamily: fontStack(option) }">{{ option }}</span></template>
  </Combo>
</template>
