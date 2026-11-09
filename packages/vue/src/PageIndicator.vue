<script setup lang="ts">
import { cx } from '@marginline/core/views';
import { ref, watch } from 'vue';
import { useSnapshot } from './context';

/** "Page 3 of 12" while scrolling. */
const page = useSnapshot((s) => s.pageIndex);
const count = useSnapshot((s) => s.pageCount);
const mode = useSnapshot((s) => s.viewMode);
const visible = ref(false);
watch(page, (_, __, onCleanup) => {
  visible.value = true;
  const t = setTimeout(() => {
    visible.value = false;
  }, 1400);
  onCleanup(() => clearTimeout(t));
}, { immediate: true });
</script>

<template>
  <div v-if="mode === 'print' && count >= 2" :class="cx('ml-page-indicator', visible && 'is-visible')" aria-live="polite" data-testid="page-indicator">Page {{ page + 1 }} of {{ count }}</div>
</template>
