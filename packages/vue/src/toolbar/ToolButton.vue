<script setup lang="ts">
import { cx, keepFocus } from '@marginline/core/views';

/** A toolbar icon button with a tooltip and pressed state. */
withDefaults(defineProps<{
  label: string;
  /** Pressed state, for buttons that switch something on and off. */
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  shortcut?: string;
}>(), { active: undefined });
const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <button
    type="button"
    :class="cx('ml-tool', active && 'is-active')"
    :aria-label="label"
    :aria-pressed="active === undefined ? undefined : active"
    :data-tip="shortcut ? `${label} (${shortcut})` : label"
    :disabled="disabled"
    :data-testid="testId"
    @mousedown="keepFocus"
    @click="emit('click')"
  ><slot /></button>
</template>
