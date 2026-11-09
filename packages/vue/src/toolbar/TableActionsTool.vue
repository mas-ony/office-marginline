<script setup lang="ts">
import { TableProperties } from '@lucide/vue';
import { useSnapshot } from '../context';
import TableActionsMenu from './TableActionsMenu.vue';
import ToolMenu from './ToolMenu.vue';

const inTable = useSnapshot((s) => !!s.cursor?.inTable);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
</script>

<template>
  <ToolMenu label="Table actions" :chevron="false" :disabled="readOnly || !inTable" test-id="tb-table-actions">
    <template #icon><TableProperties :size="18" /></template>
    <template #default="{ close }"><TableActionsMenu @done="close" /></template>
  </ToolMenu>
</template>
