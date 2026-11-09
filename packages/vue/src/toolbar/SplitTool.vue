<script setup lang="ts">
import { cx, keepFocus } from '@marginline/core/views';
import { ChevronDown } from '@lucide/vue';
import { ref } from 'vue';
import Popover from '../controls/Popover.vue';

/** Main action plus a separate arrow for its options (lists). */
defineProps<{ label: string; optionsLabel: string; active?: boolean; disabled?: boolean; testId?: string }>();
const emit = defineEmits<{ click: [] }>();

const open = ref(false);
const wrap = ref<HTMLDivElement | null>(null);
const close = () => {
  open.value = false;
};
</script>

<template>
  <div ref="wrap" :class="cx('ml-split', active && 'is-active')">
    <button type="button" class="ml-tool ml-split-main" :aria-label="label" :aria-pressed="!!active" :data-tip="label" :disabled="disabled" :data-testid="testId" @mousedown="keepFocus" @click="emit('click')"><slot name="icon" /></button>
    <button
      type="button"
      :class="cx('ml-tool ml-split-arrow', open && 'is-active')"
      :aria-label="optionsLabel"
      aria-haspopup="menu"
      :aria-expanded="open"
      :data-tip="optionsLabel"
      :disabled="disabled"
      :data-testid="testId ? `${testId}-options` : undefined"
      @mousedown="keepFocus"
      @click="open = !open"
    ><ChevronDown :size="12" /></button>
    <Popover :anchor="wrap" :open="open" :title="optionsLabel" @close="close"><slot :close="close" /></Popover>
  </div>
</template>
