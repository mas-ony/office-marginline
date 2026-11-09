<script setup lang="ts">
import { ALIGNS, cx, keepFocus } from '@marginline/core/views';
import { TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart } from '@lucide/vue';
import { computed } from 'vue';
import { useSnapshot, useUI } from '../context';
import ToolMenu from './ToolMenu.vue';

const ICONS = { left: TextAlignStart, center: TextAlignCenter, right: TextAlignEnd, both: TextAlignJustify };

const { editor } = useUI();
const align = useSnapshot((s) => s.cursor?.align ?? 'left');
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
const cur = computed(() => ALIGNS.find((a) => a.value === align.value) ?? ALIGNS[0]);
</script>

<template>
  <ToolMenu label="Text align" :disabled="readOnly" test-id="tb-align">
    <template #icon><component :is="ICONS[cur.value]" :size="18" /></template>
    <template #default="{ close }">
      <div class="ml-icon-menu" role="menu" aria-label="Text align">
        <button
          v-for="a in ALIGNS"
          :key="a.value"
          type="button"
          role="menuitem"
          :aria-label="a.label"
          :data-tip="a.label"
          :data-testid="`align-${a.value}`"
          :class="cx('ml-tool', a.value === cur.value && 'is-active')"
          @mousedown="keepFocus"
          @click="editor.runAction(a.action); close()"
        ><component :is="ICONS[a.value]" :size="18" /></button>
      </div>
    </template>
  </ToolMenu>
</template>
