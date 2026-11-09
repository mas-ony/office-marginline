<script setup lang="ts">
import { type AnchoredComment, cx } from '@marginline/core/views';
import { Check, RotateCcw } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import CommentInput from './CommentInput.vue';
import Message from './Message.vue';

defineProps<{ thread: AnchoredComment; active: boolean; imported: boolean }>();
const emit = defineEmits<{ activate: [] }>();

const { editor } = useUI();
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && e.target === e.currentTarget) emit('activate');
}
</script>

<template>
  <div
    :class="cx('ml-card ml-comment-card', active && 'is-active', thread.done && 'is-resolved')"
    role="dialog"
    :aria-label="`Comment by ${thread.author}`"
    data-testid="comment-card"
    :data-comment-id="thread.id"
    tabindex="0"
    @click="emit('activate')"
    @keydown="onKey"
  >
    <div v-if="thread.done" class="ml-resolved-label">Resolved</div>
    <Message :id="thread.id" :author="thread.author" :date="thread.date" :text="thread.text" :imported="imported" :read-only="readOnly" test-id="comment-root">
      <template #actions>
        <button v-if="thread.done" type="button" class="ml-icon-btn" aria-label="Reopen comment" title="Reopen" data-testid="comment-reopen" @click.stop="editor.resolveComment(thread.id, false)"><RotateCcw :size="16" /></button>
        <button v-else type="button" class="ml-icon-btn" aria-label="Resolve comment" title="Resolve" data-testid="comment-resolve" @click.stop="editor.resolveComment(thread.id, true)"><Check :size="16" /></button>
      </template>
    </Message>
    <div v-if="thread.quote && active" class="ml-card-quote">“{{ thread.quote }}”</div>
    <Message v-for="r in thread.replies" :id="r.id" :key="r.id" :author="r.author" :date="r.date" :text="r.text" :read-only="readOnly" test-id="comment-reply" />
    <CommentInput v-if="active && !readOnly && !thread.done" placeholder="Reply or add others with @" submit-label="Reply" collapsed test-id="reply-input" @submit="(t) => editor.replyToComment(thread.id, t)" />
  </div>
</template>
