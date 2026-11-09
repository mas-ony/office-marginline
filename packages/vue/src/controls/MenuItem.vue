<script setup lang="ts">
import { cx, keepFocus } from '@marginline/core/views';
import { Check } from '@lucide/vue';

withDefaults(defineProps<{
  label: string;
  description?: string;
  /** A choice: shown with a check mark when chosen. */
  checked?: boolean;
  /** With `checked`: an on/off setting (a menuitemcheckbox) rather than one of several choices. */
  toggle?: boolean;
  disabled?: boolean;
  shortcut?: string;
  testId?: string;
}>(), { checked: undefined });
const emit = defineEmits<{ select: [] }>();
</script>

<template>
  <button
    type="button"
    :class="cx('ml-ui-menuitem', checked && 'is-checked')"
    :role="checked === undefined ? 'menuitem' : toggle ? 'menuitemcheckbox' : 'menuitemradio'"
    :aria-checked="checked"
    :disabled="disabled"
    :data-testid="testId"
    @mousedown="keepFocus"
    @click="emit('select')"
  >
    <span class="ml-ui-menuitem-icon"><Check v-if="checked" :size="16" /><slot v-else name="icon" /></span>
    <span class="ml-ui-menuitem-text">
      <span class="ml-ui-menuitem-label">{{ label }}</span>
      <span v-if="description" class="ml-ui-menuitem-desc">{{ description }}</span>
    </span>
    <span v-if="shortcut" class="ml-ui-menuitem-shortcut">{{ shortcut }}</span>
  </button>
</template>
