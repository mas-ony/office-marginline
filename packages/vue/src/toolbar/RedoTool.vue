<script setup lang="ts">
import { Redo2 } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import ToolButton from './ToolButton.vue';

const { editor } = useUI();
const can = useSnapshot((s) => s.canRedo);
</script>

<template>
  <ToolButton label="Redo" shortcut="Ctrl+Y" :disabled="!can" test-id="tb-redo" @click="editor.redo()"><Redo2 :size="18" /></ToolButton>
</template>
