<script setup lang="ts">
import { cx, keepFocus } from '@marginline/core/views';
import { ChevronDown } from '@lucide/vue';
import { ref } from 'vue';
import Popover from '../controls/Popover.vue';

defineProps<{ label: string; text?: string; testId?: string; primary?: boolean; align?: 'start' | 'end' }>();
const open = ref(false);
const btn = ref<HTMLButtonElement | null>(null);
const close = () => {
  open.value = false;
};
</script>

<template>
  <button ref="btn" type="button" :class="cx('ml-btn', primary && 'is-primary', open && 'is-pressed')" :aria-label="label" aria-haspopup="menu" :aria-expanded="open" :data-testid="testId" @mousedown="keepFocus" @click="open = !open"><slot name="icon" /><span v-if="text">{{ text }}</span><ChevronDown :size="14" /></button>
  <Popover :anchor="btn" :open="open" :title="label" :align="align" @close="close"><slot :close="close" /></Popover>
</template>
