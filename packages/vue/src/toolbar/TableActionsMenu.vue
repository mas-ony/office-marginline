<script setup lang="ts">
import { TABLE_ACTIONS, type TableAction } from '@marginline/core/views';
import { Columns2, Grid2x2, Merge, Rows2, Split, Trash2, Wrench } from '@lucide/vue';
import { computed } from 'vue';
import Menu from '../controls/Menu.vue';
import MenuItem from '../controls/MenuItem.vue';
import { useSnapshot, useUI } from '../context';

const emit = defineEmits<{ done: [] }>();
const ICONS: Record<TableAction, unknown> = {
  addRowBefore: Rows2,
  addRowAfter: Rows2,
  addColumnBefore: Columns2,
  addColumnAfter: Columns2,
  deleteRow: Trash2,
  deleteColumn: Trash2,
  deleteTable: Trash2,
  removeBorders: Grid2x2,
  mergeCells: Merge,
  splitCell: Split,
  fixTables: Wrench,
};

const { editor } = useUI();
const cursor = useSnapshot((s) => s.cursor);
// What can be done depends on the selection.
const possible = computed(() => {
  void cursor.value;
  return new Set(TABLE_ACTIONS.filter((a) => editor.canTableAction(a.action)).map((a) => a.action));
});

function run(action: TableAction) {
  editor.tableAction(action);
  emit('done');
  editor.focus();
}
</script>

<template>
  <Menu label="Table actions">
    <MenuItem v-for="a in TABLE_ACTIONS" :key="a.action" :label="a.label" :test-id="`table-${a.action}`" :disabled="!possible.has(a.action)" @select="run(a.action)">
      <template #icon><component :is="ICONS[a.action]" :size="16" /></template>
    </MenuItem>
  </Menu>
</template>
