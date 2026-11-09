<script setup lang="ts">
import { applyLink, linkRange, normalizeLink, removeLink } from '@marginline/core/views';
import { Link2 } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { useUI } from '../context';

/** "Add link" form: text to show and the address. Also edits or removes the link at the caret. */
const emit = defineEmits<{ done: [] }>();

const { editor } = useUI();
const v = editor.activeView;
const existing = linkRange(v.state);
const sel = v.state.selection;
const text = ref(existing ? v.state.doc.textBetween(existing.from, existing.to) : v.state.doc.textBetween(sel.from, sel.to, ' '));
const href = ref<string>(existing?.mark.attrs.href ?? '');
const hrefInput = ref<HTMLInputElement | null>(null);
onMounted(() => hrefInput.value?.focus());

function apply() {
  const url = normalizeLink(href.value);
  if (!url) return;
  applyLink(v, editor.docx, url, text.value.trim() || undefined);
  emit('done');
}

function remove() {
  removeLink(v);
  emit('done');
}
</script>

<template>
  <form class="ml-link-form" data-testid="link-form" @submit.prevent="apply">
    <div class="ml-form-title">{{ existing ? 'Edit link' : 'Add link' }}</div>
    <label class="ml-input-row">
      <span class="ml-input-icon">T</span>
      <input v-model="text" aria-label="Text" placeholder="Text" />
    </label>
    <label class="ml-input-row">
      <Link2 :size="16" class="ml-input-icon" />
      <input ref="hrefInput" v-model="href" aria-label="Type or paste a link" placeholder="Type or paste a link" />
    </label>
    <div class="ml-form-actions">
      <button v-if="existing" type="button" class="ml-btn" @click="remove">Remove</button>
      <a v-if="existing && /^https?:/i.test(existing.mark.attrs.href)" class="ml-btn" :href="existing.mark.attrs.href" target="_blank" rel="noopener noreferrer">Open</a>
      <button type="submit" class="ml-btn is-primary" :disabled="!href.trim()">Apply</button>
    </div>
  </form>
</template>
