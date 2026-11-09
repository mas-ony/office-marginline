<script setup lang="ts">
import { LINE_HEIGHTS, setLineSpacing } from '@marginline/core/views';
import { UnfoldVertical } from '@lucide/vue';
import Menu from '../controls/Menu.vue';
import MenuItem from '../controls/MenuItem.vue';
import { useSnapshot, useUI } from '../context';
import ToolMenu from './ToolMenu.vue';

const { editor } = useUI();
const cur = useSnapshot((s) => s.cursor?.lineSpacing ?? null);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function pick(h: number, close: () => void) {
  setLineSpacing(editor.activeView, h);
  close();
  editor.focus();
}
</script>

<template>
  <ToolMenu label="Line height" :chevron="false" :disabled="readOnly" test-id="tb-line-height">
    <template #icon><UnfoldVertical :size="18" /></template>
    <template #default="{ close }">
      <Menu label="Line height">
        <MenuItem v-for="h in LINE_HEIGHTS" :key="h" :label="h.toFixed(2)" :checked="cur !== null && Math.abs(cur - h) < 0.01" :test-id="`line-${h}`" @select="pick(h, close)" />
      </Menu>
    </template>
  </ToolMenu>
</template>
