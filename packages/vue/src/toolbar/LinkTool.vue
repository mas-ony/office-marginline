<script setup lang="ts">
import { Link2 } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import LinkForm from './LinkForm.vue';
import ToolMenu from './ToolMenu.vue';

const { editor } = useUI();
const onLink = useSnapshot((s) => !!s.cursor?.link);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
</script>

<template>
  <ToolMenu label="Link" :chevron="false" :disabled="readOnly" :active="onLink" test-id="tb-link">
    <template #icon><Link2 :size="18" /></template>
    <template #default="{ close }"><LinkForm @done="close(); editor.focus()" /></template>
  </ToolMenu>
</template>
