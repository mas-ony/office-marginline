<script setup lang="ts">
import { cx, keepFocus, type ListPreset, NUMBER_STYLES, setListPreset, toggleList } from '@marginline/core/views';
import { ListOrdered } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import SplitTool from './SplitTool.vue';

const { editor } = useUI();
const cursor = useSnapshot((s) => s.cursor);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function pick(preset: ListPreset, close: () => void) {
  const v = editor.activeView;
  if (cursor.value?.listKind === 'ordered') setListPreset(v, editor.docx, preset);
  else toggleList(v, editor.docx, 'ordered', preset);
  close();
}
</script>

<template>
  <SplitTool label="Numbered list" options-label="Numbered list options" test-id="tb-numbers" :disabled="readOnly" :active="cursor?.listKind === 'ordered'" @click="editor.runAction('numberedList')">
    <template #icon><ListOrdered :size="18" /></template>
    <template #default="{ close }">
      <div class="ml-number-menu" role="menu" aria-label="Number styles">
        <button
          v-for="n in NUMBER_STYLES"
          :key="n.preset"
          type="button"
          role="menuitem"
          :aria-label="n.label"
          :title="n.label"
          :data-testid="`numbers-${n.preset}`"
          :class="cx('ml-number-style', cursor?.listPreset === n.preset && 'is-active')"
          @mousedown="keepFocus"
          @click="pick(n.preset, close)"
        ><span v-for="(s, i) in n.sample" :key="i"><b>{{ s }}</b><i /></span></button>
      </div>
    </template>
  </SplitTool>
</template>
