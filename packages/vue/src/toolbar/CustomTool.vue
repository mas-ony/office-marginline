<script setup lang="ts">
import { keepFocus, type ToolbarItem } from '@marginline/core/views';
import { useUI } from '../context';

const props = defineProps<{ item: ToolbarItem }>();
const { editor } = useUI();

function run() {
  props.item.custom!.onClick();
  editor.focus();
}
</script>

<template>
  <button type="button" class="ml-tool ml-custom" :aria-label="item.custom!.label" :data-tip="item.custom!.label" :data-testid="`custom-${item.custom!.id}`" @mousedown="keepFocus" @click="run"><span aria-hidden="true">{{ item.custom!.text }}</span></button>
</template>
