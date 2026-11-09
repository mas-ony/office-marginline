<script setup lang="ts">
import { cx, keepFocus } from '@marginline/core/views';
import { ref, watch } from 'vue';
import Popover from '../controls/Popover.vue';

/** An editable combobox with a list (font family and size); the `option` slot renders a choice. */
const props = defineProps<{
  label: string;
  value: string;
  options: string[];
  width: number;
  testId: string;
  disabled?: boolean;
  numeric?: boolean;
}>();
const emit = defineEmits<{ commit: [value: string] }>();

const text = ref(props.value);
const open = ref(false);
const wrap = ref<HTMLDivElement | null>(null);
watch(() => props.value, (v) => {
  text.value = v;
});

function commit(v: string) {
  open.value = false;
  if (v.trim()) emit('commit', v.trim());
  else text.value = props.value;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commit(text.value);
  } else if (e.key === 'Escape') {
    text.value = props.value;
    open.value = false;
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    open.value = true;
  }
}
</script>

<template>
  <div ref="wrap" :class="cx('ml-combo', open && 'is-open')" :style="{ width: `${width}px` }">
    <input
      class="ml-combo-input"
      role="combobox"
      :aria-label="label"
      :aria-expanded="open"
      :value="text"
      :disabled="disabled"
      :inputmode="numeric ? 'decimal' : undefined"
      :data-testid="testId"
      @input="text = ($event.target as HTMLInputElement).value"
      @keydown="onKey"
      @focus="($event.target as HTMLInputElement).select()"
    />
    <button type="button" class="ml-combo-arrow" :aria-label="`${label} options`" :disabled="disabled" :data-testid="`${testId}-options`" @mousedown="keepFocus" @click="open = !open">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
    </button>
    <Popover :anchor="wrap" :open="open" :title="label" @close="open = false">
      <div class="ml-ui-menu ml-listbox" role="listbox" :aria-label="label">
        <button
          v-for="o in options"
          :key="o"
          type="button"
          role="option"
          :aria-selected="o === value"
          :aria-label="`${label} - ${o}`"
          :class="cx('ml-ui-menuitem', o === value && 'is-checked')"
          @mousedown="keepFocus"
          @click="commit(o)"
        ><span class="ml-ui-menuitem-label"><slot name="option" :option="o">{{ o }}</slot></span></button>
      </div>
    </Popover>
  </div>
</template>
