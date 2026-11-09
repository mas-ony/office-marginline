<script setup lang="ts">
import { Undo2 } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import ToolButton from './ToolButton.vue';

const { editor } = useUI();
const can = useSnapshot((s) => s.canUndo);
</script>

<template>
  <ToolButton label="Undo" shortcut="Ctrl+Z" :disabled="!can" test-id="tb-undo" @click="editor.undo()"><Undo2 :size="18" /></ToolButton>
</template>
