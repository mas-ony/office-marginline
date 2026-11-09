<script setup lang="ts">
import { insertTable } from '@marginline/core/views';
import { Table } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import TableGrid from './TableGrid.vue';
import ToolMenu from './ToolMenu.vue';

const { editor } = useUI();
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function insert(rows: number, cols: number, close: () => void) {
  insertTable(editor.activeView, editor.docx, rows, cols);
  close();
  editor.focus();
}
</script>

<template>
  <ToolMenu label="Table" :chevron="false" :disabled="readOnly" test-id="tb-table">
    <template #icon><Table :size="18" /></template>
    <template #default="{ close }"><TableGrid @pick="(r, c) => insert(r, c, close)" /></template>
  </ToolMenu>
</template>
