<script setup lang="ts">
import { BULLET_STYLES, cx, keepFocus, type ListPreset, setListPreset, toggleList } from '@marginline/core/views';
import { List } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import SplitTool from './SplitTool.vue';

const { editor } = useUI();
const cursor = useSnapshot((s) => s.cursor);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function pick(preset: ListPreset, close: () => void) {
  const v = editor.activeView;
  if (cursor.value?.listKind === 'bullet') setListPreset(v, editor.docx, preset);
  else toggleList(v, editor.docx, 'bullet', preset);
  close();
}
</script>

<template>
  <SplitTool label="Bullet list" options-label="Bullet list options" test-id="tb-bullets" :disabled="readOnly" :active="cursor?.listKind === 'bullet'" @click="editor.runAction('bulletList')">
    <template #icon><List :size="18" /></template>
    <template #default="{ close }">
      <div class="ml-icon-menu" role="menu" aria-label="Bullet styles">
        <button
          v-for="b in BULLET_STYLES"
          :key="b.preset"
          type="button"
          role="menuitem"
          :aria-label="b.label"
          :data-tip="b.label"
          :data-testid="`bullet-${b.preset}`"
          :class="cx('ml-tool ml-glyph', cursor?.listPreset === b.preset && 'is-active')"
          @mousedown="keepFocus"
          @click="pick(b.preset, close)"
        >{{ b.glyph }}</button>
      </div>
    </template>
  </SplitTool>
</template>
