<script setup lang="ts">
import { ListIndentDecrease, ListIndentIncrease } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import ToolButton from './ToolButton.vue';

defineProps<{ dir: 'outdent' | 'indent' }>();
const { editor } = useUI();
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
</script>

<template>
  <ToolButton v-if="dir === 'outdent'" label="Left indent" shortcut="Shift+Tab" :disabled="readOnly" test-id="tb-outdent" @click="editor.runAction('outdent')"><ListIndentDecrease :size="18" /></ToolButton>
  <ToolButton v-else label="Right indent" shortcut="Tab" :disabled="readOnly" test-id="tb-indent" @click="editor.runAction('indent')"><ListIndentIncrease :size="18" /></ToolButton>
</template>
