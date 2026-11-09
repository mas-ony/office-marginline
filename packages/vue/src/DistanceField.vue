<script setup lang="ts">
import { distanceText, parseDistance } from '@marginline/core/views';
import { ref, watch } from 'vue';

/** A distance from the page edge, applied on Enter or on leaving the field (not when the menu is dismissed). */
const props = defineProps<{ label: string; value: number; max: number; metric: boolean; testId: string; discard: { readonly current: boolean } }>();
const emit = defineEmits<{ commit: [twips: number] }>();
const text = ref(distanceText(props.value, props.metric));
watch(() => [props.value, props.metric] as const, ([value, metric]) => {
  text.value = distanceText(value, metric);
});

function commit() {
  if (props.discard.current) return;
  const twips = parseDistance(text.value, props.max, props.metric);
  if (twips === null || twips === props.value) text.value = distanceText(props.value, props.metric);
  else emit('commit', twips);
}
</script>

<template>
  <label class="ml-hf-distance">
    <span class="ml-ui-menuitem-icon"><slot name="icon" /></span>
    <span class="ml-hf-distance-label">{{ label }}</span>
    <input
      class="ml-input"
      :aria-label="`${label} (${metric ? 'centimetres' : 'inches'})`"
      :value="text"
      inputmode="decimal"
      :data-testid="testId"
      @input="text = ($event.target as HTMLInputElement).value"
      @focus="($event.target as HTMLInputElement).select()"
      @blur="commit"
      @keydown.enter="commit"
    />
    <span class="ml-hf-unit">{{ metric ? 'cm' : 'in' }}</span>
  </label>
</template>
