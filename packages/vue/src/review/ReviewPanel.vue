<script setup lang="ts">
import { cx, reviewCountText, reviewItems, type ReviewItem, TRACKED_VIEWS } from '@marginline/core/views';
import { CheckCheck, MessageSquarePlus, XCircle } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useSnapshot, useUI } from '../context';
import ChangeCard from './ChangeCard.vue';
import CommentCard from './CommentCard.vue';
import ComposerCard from './ComposerCard.vue';

const { ui, state, editor } = useUI();
const version = useSnapshot((s) => `${s.commentsVersion}:${s.changesVersion}`);
const activeComment = useSnapshot((s) => s.activeComment);
const imported = useSnapshot((s) => s.imported);
const mode = useSnapshot((s) => s.editMode);
const viewing = useSnapshot((s) => s.viewing);
const textSelected = useSnapshot((s) => !!s.cursor?.textSelected);
const showResolved = ref(false);
const activeChange = ref<string | null>(null);
const list = ref<HTMLDivElement | null>(null);

const items = computed(() => {
  void version.value;
  return reviewItems(editor, { resolved: showResolved.value });
});
const changes = computed(() => items.value.filter((i) => i.kind === 'change').length);
const comments = computed(() => {
  void version.value;
  return editor.comments().filter((c) => !c.done).length;
});

/** The cards in document order, with the new-comment card at its selection. */
const cards = computed(() => {
  const range = state.value.composerRange;
  const out: ({ key: string; item: ReviewItem } | { key: 'composer'; item: null })[] = items.value.map((item) => ({ key: item.key, item }));
  if (range && !state.value.mobile) {
    const at = items.value.findIndex((i) => i.pos > range.from);
    out.splice(at < 0 ? out.length : at, 0, { key: 'composer', item: null });
  }
  return out;
});

watch(activeComment, (id) => {
  if (!id) return;
  const el = list.value?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}, { flush: 'post' });

function activate(item: ReviewItem) {
  if (item.kind === 'comment') {
    activeChange.value = null;
    editor.selectComment(item.thread.id);
  } else {
    activeChange.value = item.key;
    editor.selectComment(null);
    editor.selectChange(item.changes[0]);
  }
}
</script>

<template>
  <div class="ml-review" data-testid="review-panel">
    <div class="ml-review-head">
      <span class="ml-review-count" data-testid="review-count">{{ reviewCountText(changes, comments) }}</span>
      <label class="ml-check"><input v-model="showResolved" type="checkbox" /> Resolved</label>
    </div>
    <div v-if="mode === 'viewing'" class="ml-review-views">
      <div class="ml-segmented" role="radiogroup" aria-label="Tracked changes">
        <button
          v-for="v in TRACKED_VIEWS"
          :key="v.value"
          type="button"
          role="radio"
          :aria-checked="viewing.trackedChanges === v.value"
          :class="cx(viewing.trackedChanges === v.value && 'is-on')"
          :data-testid="`view-${v.value}`"
          @click="editor.setViewingOptions({ trackedChanges: v.value })"
        >{{ v.label }}</button>
      </div>
      <label class="ml-check"><input type="checkbox" :checked="viewing.comments" @change="editor.setViewingOptions({ comments: ($event.target as HTMLInputElement).checked })" /> Comments</label>
    </div>
    <div v-if="changes > 0 && mode !== 'viewing'" class="ml-review-bulk">
      <button type="button" class="ml-btn is-small" data-testid="accept-all" @click="editor.decideChanges('all', true)"><CheckCheck :size="15" /> Accept all</button>
      <button type="button" class="ml-btn is-small" data-testid="reject-all" @click="editor.decideChanges('all', false)"><XCircle :size="15" /> Reject all</button>
    </div>
    <div ref="list" class="ml-review-list" role="list">
      <div v-for="c in cards" :key="c.key" role="listitem">
        <ComposerCard v-if="!c.item" />
        <CommentCard v-else-if="c.item.kind === 'comment'" :thread="c.item.thread" :active="activeComment === c.item.thread.id" :imported="imported.has(`comment:${c.item.thread.id}`)" @activate="activate(c.item)" />
        <ChangeCard v-else :item="c.item" :active="activeChange === c.item.key" :imported="c.item.changes.some((ch) => imported.has(`change:${ch.type}:${ch.id}`))" @activate="activate(c.item)" />
      </div>
      <div v-if="!cards.length" class="ml-empty">
        <p>No comments or tracked changes.</p>
        <p>Select text and choose <b>Comment</b>, or switch to <b>Suggesting</b> to track your edits.</p>
      </div>
    </div>
    <button v-if="mode !== 'viewing' && !state.composerRange" type="button" class="ml-btn ml-review-add" :disabled="!textSelected" data-testid="panel-add-comment" @click="ui.openComposer()"><MessageSquarePlus :size="16" /> Add comment</button>
  </div>
</template>
