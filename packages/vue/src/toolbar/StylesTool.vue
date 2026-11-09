<script setup lang="ts">
import { cx, keepFocus, setParagraphStyle } from '@marginline/core/views';
import { Check, Pilcrow } from '@lucide/vue';
import { computed } from 'vue';
import { useSnapshot, useUI } from '../context';
import ToolMenu from './ToolMenu.vue';

const { editor } = useUI();
const styleId = useSnapshot((s) => s.cursor?.styleId);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
const version = useSnapshot((s) => s.stylesVersion);
const styles = computed(() => {
  void version.value;
  return editor.docx.styles.paragraphStyleList();
});

function pick(id: string, close: () => void) {
  setParagraphStyle(editor.activeView, editor.docx, id);
  close();
  editor.focus();
}
</script>

<template>
  <ToolMenu label="Linked styles" :chevron="false" :disabled="readOnly" test-id="tb-styles">
    <template #icon><Pilcrow :size="18" /></template>
    <template #default="{ close }">
      <div class="ml-ui-menu ml-styles-menu" role="menu" aria-label="Linked styles">
        <button
          v-for="s in styles"
          :key="s.id"
          type="button"
          role="menuitemradio"
          :aria-checked="styleId === s.id"
          :class="cx('ml-ui-menuitem ml-style-item', styleId === s.id && 'is-checked')"
          :data-testid="`style-${s.id}`"
          @mousedown="keepFocus"
          @click="pick(s.id, close)"
        ><span :class="cx('ml-style-sample', `ml-style-${s.id.toLowerCase()}`)">{{ s.label }}</span><Check v-if="styleId === s.id" :size="14" /></button>
      </div>
    </template>
  </ToolMenu>
</template>
