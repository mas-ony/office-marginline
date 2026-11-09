<script setup lang="ts">
import { cx, searchRegExp } from '@marginline/core/views';
import { ChevronDown, ChevronRight, ChevronUp, Search, X } from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSnapshot, useUI } from './context';

/** Find and replace bar floating over the top-right of the document. */
const { ui, state, editor } = useUI();
const search = useSnapshot((s) => s.search);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
const sel = editor.view.state;
const query = ref(sel.selection.empty ? search.value.query : sel.doc.textBetween(sel.selection.from, sel.selection.to, ' ').slice(0, 100));
const caseSensitive = ref(false);
const regex = ref(false);
const showReplace = ref(state.value.findReplace);
const replacement = ref('');
const input = ref<HTMLInputElement | null>(null);
const invalid = computed(() => regex.value && !!query.value && !searchRegExp({ query: query.value, caseSensitive: caseSensitive.value, regex: regex.value, wholeWord: false }));
const count = computed(() => {
  if (!query.value) return '';
  if (search.value.count) return `${search.value.index + 1} of ${search.value.count}`;
  return invalid.value ? 'Invalid' : 'No results';
});

const run = () => editor.search({ query: query.value, caseSensitive: caseSensitive.value, regex: regex.value, wholeWord: false });
onMounted(() => {
  input.value?.focus();
  input.value?.select();
  run();
});
watch([query, caseSensitive, regex], run);
watch(() => state.value.findReplace, (r) => {
  showReplace.value ||= r;
});
onUnmounted(() => editor.clearSearch());

function close() {
  ui.setFindOpen(false);
  editor.focus();
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  }
}

function onFindKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    editor.searchStep(e.shiftKey ? -1 : 1);
  }
}

function onReplaceKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    editor.replace(replacement.value);
  }
}
</script>

<template>
  <div :class="cx('ml-find', state.mobile && 'is-mobile')" role="dialog" aria-label="Find text" data-testid="find-bar" @keydown="onKey">
    <div class="ml-find-row">
      <button v-if="!readOnly" type="button" class="ml-icon-btn" aria-label="Toggle replace" :aria-expanded="showReplace" data-testid="find-toggle-replace" @click="showReplace = !showReplace">
        <ChevronDown v-if="showReplace" :size="16" />
        <ChevronRight v-else :size="16" />
      </button>
      <label :class="cx('ml-find-input', invalid && 'is-invalid')">
        <Search :size="15" aria-hidden="true" />
        <input ref="input" v-model="query" aria-label="Find text" placeholder="Find" data-testid="find-input" @keydown="onFindKey" />
        <button type="button" :class="cx('ml-find-opt', caseSensitive && 'is-on')" aria-label="Match case" :aria-pressed="caseSensitive" title="Match case" data-testid="find-case" @click="caseSensitive = !caseSensitive">Aa</button>
        <button type="button" :class="cx('ml-find-opt', regex && 'is-on')" aria-label="Use regular expression" :aria-pressed="regex" title="Use regular expression" data-testid="find-regex" @click="regex = !regex">.*</button>
      </label>
      <span class="ml-find-count" data-testid="find-count" aria-live="polite">{{ count }}</span>
      <button type="button" class="ml-icon-btn" aria-label="Previous match" :disabled="!search.count" @click="editor.searchStep(-1)"><ChevronUp :size="16" /></button>
      <button type="button" class="ml-icon-btn" aria-label="Next match" :disabled="!search.count" data-testid="find-next" @click="editor.searchStep(1)"><ChevronDown :size="16" /></button>
      <button type="button" class="ml-icon-btn" aria-label="Close find and replace" @click="close"><X :size="16" /></button>
    </div>
    <div v-if="showReplace && !readOnly" class="ml-find-row ml-replace-row">
      <label class="ml-find-input">
        <input v-model="replacement" aria-label="Replace with" placeholder="Replace" data-testid="replace-input" @keydown="onReplaceKey" />
      </label>
      <button type="button" class="ml-btn is-small" :disabled="!search.count" data-testid="replace-one" @click="editor.replace(replacement)">Replace</button>
      <button type="button" class="ml-btn is-small" :disabled="!search.count" data-testid="replace-all" @click="editor.replaceAll(replacement)">Replace all</button>
    </div>
  </div>
</template>
