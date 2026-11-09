<script setup lang="ts">
import { type ToolbarItem, withSeparators } from '@marginline/core/views';
import CustomTool from './CustomTool.vue';
import { TOOLS } from './tools';
import ToolSeparator from './ToolSeparator.vue';

defineProps<{ items: ToolbarItem[] }>();
</script>

<template>
  <template v-for="{ item, separator } in withSeparators(items)" :key="item.id">
    <ToolSeparator v-if="separator" />
    <span class="ml-tool-slot" :data-item="item.id"><CustomTool v-if="item.custom" :item="item" /><component :is="TOOLS[item.id].is" v-else v-bind="TOOLS[item.id].props" /></span>
  </template>
</template>
