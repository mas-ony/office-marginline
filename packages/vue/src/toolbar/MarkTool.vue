<script setup lang="ts">
import { MARKS, type MarkKind } from '@marginline/core/views';
import { Bold, Italic, Strikethrough, Underline } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import ToolButton from './ToolButton.vue';

const props = defineProps<{ kind: MarkKind }>();
const ICONS = { bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough };

const { editor } = useUI();
const on = useSnapshot((s) => !!s.cursor?.[props.kind]);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
</script>

<template>
  <ToolButton :label="MARKS[kind].label" :shortcut="MARKS[kind].key" :active="on" :disabled="readOnly" :test-id="`tb-${kind}`" @click="editor.runAction(kind)"><component :is="ICONS[kind]" :size="18" /></ToolButton>
</template>
