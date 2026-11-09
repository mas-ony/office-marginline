<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSnapshot, useUI } from '../context';

const { editor } = useUI();
const name = useSnapshot((s) => s.fileName);
const dirty = useSnapshot((s) => s.dirty);
const base = computed(() => name.value.replace(/\.docx$/i, ''));
const editing = ref(false);
const input = ref<HTMLInputElement | null>(null);
let cancelled = false;

watch(input, (el) => el?.focus());

function edit() {
  cancelled = false;
  editing.value = true;
}

function commit(e: FocusEvent) {
  const v = (e.target as HTMLInputElement).value.trim();
  if (v && !cancelled) editor.fileName = v;
  editing.value = false;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  if (e.key === 'Escape') {
    cancelled = true;
    editing.value = false;
  }
}
</script>

<template>
  <input
    v-if="editing"
    ref="input"
    class="ml-filename-input"
    aria-label="Document name"
    :value.attr="base"
    @focus="($event.target as HTMLInputElement).select()"
    @blur="commit"
    @keydown="onKey"
  />
  <button v-else type="button" class="ml-filename" title="Rename document" data-testid="file-name" @click="edit">{{ base }}<span v-if="dirty" class="ml-dirty" aria-label="Unsaved changes" title="Unsaved changes">•</span></button>
</template>
