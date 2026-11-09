<script setup lang="ts">
import { cx, keepFocus } from '@marginline/core/views';
import { ChevronDown } from '@lucide/vue';
import { ref } from 'vue';
import Popover from '../controls/Popover.vue';

/** A toolbar button that opens a menu or panel below it (the default slot, given `close`). */
withDefaults(defineProps<{
  label: string;
  text?: string;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
  wide?: boolean;
  chevron?: boolean;
  align?: 'start' | 'end';
  title?: string;
}>(), { chevron: true });

const open = ref(false);
const btn = ref<HTMLButtonElement | null>(null);
const close = () => {
  open.value = false;
};
</script>

<template>
  <button
    ref="btn"
    type="button"
    :class="cx('ml-tool ml-tool-menu', (active || open) && 'is-active', wide && 'is-wide')"
    :aria-label="label"
    aria-haspopup="menu"
    :aria-expanded="open"
    :data-tip="label"
    :disabled="disabled"
    :data-testid="testId"
    @mousedown="keepFocus"
    @click="open = !open"
  ><slot name="icon" /><span v-if="text !== undefined" class="ml-tool-text">{{ text }}</span><ChevronDown v-if="chevron" :size="14" class="ml-chevron" /></button>
  <Popover :anchor="btn" :open="open" :title="title ?? label" :align="align" @close="close"><slot :close="close" /></Popover>
</template>
