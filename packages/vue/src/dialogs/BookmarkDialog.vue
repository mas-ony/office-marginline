<script setup lang="ts">
import { suggestedBookmarkName, validBookmarkName } from '@marginline/core/views';
import { Bookmark } from '@lucide/vue';
import { computed, ref } from 'vue';
import Field from '../controls/Field.vue';
import Modal from '../controls/Modal.vue';
import { useUI } from '../context';

const { ui, editor } = useUI();
const name = ref(suggestedBookmarkName(editor));
const existing = editor.bookmarks();
const valid = computed(() => validBookmarkName(name.value));
const close = () => ui.openModal(null);

function add() {
  if (!valid.value) return;
  if (editor.createBookmark(name.value)) {
    ui.toast(`Bookmark “${name.value}” created`);
    close();
    editor.focus();
  }
}

function go(pos: number) {
  editor.scrollToPos(pos);
  close();
}
</script>

<template>
  <Modal title="Create bookmark" open test-id="bookmark-dialog" @close="close">
    <Field label="Bookmark name" html-for="bm-name">
      <input id="bm-name" v-model="name" class="ml-input" placeholder="e.g. Payment_terms" @keydown.enter="add" />
    </Field>
    <p class="ml-hint">{{ name && !valid ? 'Start with a letter; use letters, numbers and underscores (up to 40).' : 'The bookmark marks the selected text, or the caret position.' }}</p>
    <template v-if="existing.length > 0">
      <div class="ml-label">Bookmarks in this document</div>
      <ul class="ml-pick-list">
        <li v-for="b in existing" :key="b.id">
          <button type="button" class="ml-pick" @click="go(b.pos)"><Bookmark :size="14" /> <b>{{ b.name }}</b> <span>{{ b.text }}</span></button>
        </li>
      </ul>
    </template>
    <template #footer>
      <button type="button" class="ml-btn" @click="close">Cancel</button>
      <button type="button" class="ml-btn is-primary" :disabled="!valid" data-testid="bookmark-add" @click="add">Add</button>
    </template>
  </Modal>
</template>
