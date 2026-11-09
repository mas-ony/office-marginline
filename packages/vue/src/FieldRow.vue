<script setup lang="ts">
import type { FieldInfo } from '@marginline/core/views';
import { Trash2 } from '@lucide/vue';
import { ref, watch } from 'vue';
import { useUI } from './context';

const props = defineProps<{ field: FieldInfo; readOnly: boolean }>();
const { editor } = useUI();
const name = ref(props.field.name);
const value = ref(props.field.value);
let editingValue = false;
let timer: ReturnType<typeof setTimeout> | null = null;

watch(() => props.field.name, (n) => {
  name.value = n;
});
watch(() => props.field.value, (v) => {
  if (!editingValue) value.value = v;
});

function flush(v: string) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (v !== props.field.value || (v === '' && !props.field.placeholder)) editor.setFieldValue(props.field.name, v);
}

function rename() {
  if (name.value.trim() && name.value.trim() !== props.field.name) editor.renameField(props.field.name, name.value);
  else name.value = props.field.name;
}

function onInput(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  value.value = v;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(v), 300);
}

function onFocus() {
  editingValue = true;
  editor.focusField(props.field.name);
}

function onBlur(e: FocusEvent) {
  editingValue = false;
  flush((e.target as HTMLInputElement).value);
  editor.focusField(null);
}
</script>

<template>
  <li class="ml-field" data-testid="field-row" :data-field="field.name">
    <div class="ml-field-head">
      <input
        v-model="name"
        class="ml-field-name"
        aria-label="Field name"
        :disabled="readOnly"
        @blur="rename"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <span v-if="field.ranges.length > 1" class="ml-field-count" title="Places in the document">×{{ field.ranges.length }}</span>
      <button v-if="!readOnly" type="button" class="ml-icon-btn" :aria-label="`Remove field ${field.name}`" title="Remove field (keep text)" @click="editor.removeField(field.name)"><Trash2 :size="14" /></button>
    </div>
    <input
      class="ml-field-value"
      :aria-label="`${field.name} value`"
      placeholder="Empty - type a value"
      :value="value"
      :disabled="readOnly"
      data-testid="field-value"
      @focus="onFocus"
      @blur="onBlur"
      @input="onInput"
      @keydown.enter="flush(($event.target as HTMLInputElement).value)"
    />
  </li>
</template>
