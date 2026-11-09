<script setup lang="ts">
import { autosizeTextarea, completeMention, cx, keepFocus, mentionAt, mentionMatches, mentionPeople } from '@marginline/core/views';
import { computed, onMounted, ref, watch } from 'vue';
import { useUI } from '../context';
import Avatar from './Avatar.vue';

/** A comment text box with @mention suggestions. Enter submits, Shift+Enter adds a line. */
const props = withDefaults(defineProps<{
  placeholder: string;
  initial?: string;
  submitLabel: string;
  autoFocus?: boolean;
  testId?: string;
  /** Show as a one-line box until focused (reply boxes). */
  collapsed?: boolean;
}>(), { initial: '' });
const emit = defineEmits<{ submit: [text: string]; cancel: [] }>();

const { editor, state } = useUI();
const text = ref(props.initial);
const focused = ref(!!props.autoFocus);
const el = ref<HTMLTextAreaElement | null>(null);
// People who can be mentioned: authors in the document and the current user.
const people = computed(() => mentionPeople(editor, state.value.user.name));
const mention = computed(() => mentionAt(text.value, el.value?.selectionStart ?? text.value.length));
const matches = computed(() => mentionMatches(people.value, mention.value));
const open = computed(() => focused.value || !props.collapsed || !!text.value);

onMounted(() => {
  if (props.autoFocus) el.value?.focus();
  autosizeTextarea(el.value);
});
watch([text, focused], () => autosizeTextarea(el.value), { flush: 'post' });

function submit() {
  if (!text.value.trim()) return;
  emit('submit', text.value.trim());
  text.value = '';
  if (props.collapsed) focused.value = false;
}

function pick(name: string) {
  const m = mention.value;
  if (!m) return;
  text.value = completeMention(text.value, el.value?.selectionStart ?? text.value.length, m, name);
  requestAnimationFrame(() => el.value?.focus());
}

function cancel() {
  text.value = props.initial;
  focused.value = false;
  emit('cancel');
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (matches.value.length && mention.value) pick(matches.value[0]);
    else submit();
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    cancel();
  }
}
</script>

<template>
  <div :class="cx('ml-comment-input', open && 'is-open')" @click.stop>
    <textarea
      ref="el"
      rows="1"
      :value="text"
      :placeholder="placeholder"
      :aria-label="placeholder"
      :data-testid="testId"
      @input="text = ($event.target as HTMLTextAreaElement).value"
      @focus="focused = true"
      @keydown="onKey"
    />
    <div v-if="matches.length > 0" class="ml-mentions" role="listbox" aria-label="People">
      <button v-for="p in matches" :key="p" type="button" role="option" aria-selected="false" class="ml-mention" @mousedown="keepFocus" @click="pick(p)"><Avatar :name="p" :size="20" /> {{ p }}</button>
    </div>
    <div v-if="open" class="ml-comment-buttons">
      <button type="button" class="ml-btn is-quiet" @click="cancel">Cancel</button>
      <button type="button" class="ml-btn is-primary" :disabled="!text.trim()" :data-testid="testId ? `${testId}-submit` : undefined" @click="submit">{{ submitLabel }}</button>
    </div>
  </div>
</template>
