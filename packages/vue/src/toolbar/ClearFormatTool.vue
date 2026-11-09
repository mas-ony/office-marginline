<script setup lang="ts">
import { RemoveFormatting } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import ToolButton from './ToolButton.vue';

const { editor } = useUI();
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
</script>

<template>
  <ToolButton label="Clear formatting" :disabled="readOnly" test-id="tb-clear" @click="editor.runAction('clearFormatting')"><RemoveFormatting :size="18" /></ToolButton>
</template>
