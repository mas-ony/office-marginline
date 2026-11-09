<script setup lang="ts">
import { commentBubblePosition } from '@marginline/core/views';
import { MessageSquarePlus } from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useUI } from './context';

/** The "add comment" bubble beside the page next to a selection. */
const { ui, state, snapshot, editor } = useUI();
const tick = ref(0);
const redraw = () => {
  tick.value++;
};
onMounted(() => {
  editor.scrollEl.addEventListener('scroll', redraw, { passive: true });
  window.addEventListener('resize', redraw);
});
onUnmounted(() => {
  editor.scrollEl.removeEventListener('scroll', redraw);
  window.removeEventListener('resize', redraw);
});

const at = computed(() => {
  void tick.value;
  const s = snapshot.value;
  if (!s.cursor?.textSelected || s.stream !== 'body' || s.editMode === 'viewing' || state.value.composerRange) return null;
  return commentBubblePosition(editor, state.value.mobile);
});
</script>

<template>
  <button
    v-if="at"
    type="button"
    class="ml-comment-bubble"
    :style="{ top: `${at.top}px`, left: `${at.left}px` }"
    aria-label="Add comment"
    title="Add comment"
    data-testid="comment-bubble"
    @mousedown.prevent
    @click="ui.openComposer()"
  >
    <MessageSquarePlus :size="18" />
  </button>
</template>
