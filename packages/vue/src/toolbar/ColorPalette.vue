<script setup lang="ts">
import { colorInputValue, cx, keepFocus, PALETTE } from '@marginline/core/views';
import { computed } from 'vue';

/** The colour grid used for text colour, highlight and cell background. */
const props = defineProps<{
  value: string | null;
  /** Label of the "no colour" choice, when there is one. */
  none?: string;
  label: string;
}>();
const emit = defineEmits<{ pick: [hex: string | null] }>();
const current = computed(() => props.value?.replace('#', '').toUpperCase() ?? null);
</script>

<template>
  <div class="ml-palette" role="menu" :aria-label="label">
    <button v-if="none" type="button" role="menuitem" class="ml-palette-none" aria-label="Clear color selection" @mousedown="keepFocus" @click="emit('pick', null)"><span class="ml-swatch ml-swatch-none" /> {{ none }}</button>
    <div v-for="(row, r) in PALETTE" :key="r" class="ml-palette-row" role="group">
      <button
        v-for="c in row"
        :key="c.hex"
        type="button"
        role="menuitem"
        :aria-label="c.name"
        :title="c.name"
        :class="cx('ml-swatch', current === c.hex && 'is-selected')"
        :style="{ background: `#${c.hex}` }"
        @mousedown="keepFocus"
        @click="emit('pick', c.hex)"
      />
    </div>
    <label class="ml-palette-custom">
      <span>Custom color</span>
      <input type="color" :value="colorInputValue(value)" @input="emit('pick', ($event.target as HTMLInputElement).value.slice(1).toUpperCase())" />
    </label>
  </div>
</template>
