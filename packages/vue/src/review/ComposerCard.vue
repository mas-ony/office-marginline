<script setup lang="ts">
import { useUI } from '../context';
import Avatar from './Avatar.vue';
import CommentInput from './CommentInput.vue';

/** The new-comment card: shown for the selection the composer was opened on. */
const { ui, state, editor } = useUI();

function add(text: string) {
  const range = state.value.composerRange;
  if (range) editor.addCommentAt(range, text);
  ui.closeComposer();
}
</script>

<template>
  <div class="ml-card ml-composer is-active" role="dialog" aria-label="New comment" data-testid="comment-composer">
    <div class="ml-card-head">
      <Avatar :name="state.user.name" />
      <div class="ml-card-who">
        <div class="ml-card-name"><span class="ml-card-author">{{ state.user.name }}</span></div>
        <div class="ml-card-time">Now</div>
      </div>
    </div>
    <CommentInput placeholder="Add a comment" submit-label="Comment" auto-focus test-id="composer-input" @submit="add" @cancel="ui.closeComposer()" />
  </div>
</template>
