<script setup lang="ts">
import { focusFirstMenuItem, menuKeyDown } from '@marginline/core/views';
import { onMounted, ref } from 'vue';

defineProps<{ label?: string }>();
const el = ref<HTMLElement | null>(null);
onMounted(() => focusFirstMenuItem(el.value));
</script>

<template>
  <div ref="el" class="ml-ui-menu" role="menu" :aria-label="label" @keydown="menuKeyDown(el, $event)"><slot /></div>
</template>
