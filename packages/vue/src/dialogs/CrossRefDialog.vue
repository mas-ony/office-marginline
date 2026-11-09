<script setup lang="ts">
import { cx, shortcutLabel } from '@marginline/core/views';
import { Bookmark, Heading } from '@lucide/vue';
import { computed, ref } from 'vue';
import Modal from '../controls/Modal.vue';
import { useUI } from '../context';

const { ui, editor } = useUI();
const bookmarks = editor.bookmarks();
const headings = editor.headings();
const kind = ref<'bookmark' | 'heading'>(bookmarks.length ? 'bookmark' : 'heading');
const pick = ref<string | null>(null);
const close = () => ui.openModal(null);

const list = computed(() => (kind.value === 'bookmark'
  ? bookmarks.map((b) => ({ key: b.name, icon: Bookmark, label: b.name, detail: b.text }))
  : headings.map((h) => ({ key: String(h.pos), icon: Heading, label: h.text, detail: `Heading ${h.level}` }))));

function setKind(k: 'bookmark' | 'heading') {
  kind.value = k;
  pick.value = null;
}

function insert() {
  if (!pick.value) return;
  if (kind.value === 'bookmark') editor.insertCrossReference({ bookmark: pick.value });
  else editor.insertCrossReference({ headingPos: Number(pick.value) });
  close();
  editor.focus();
}

function choose(key: string, now = false) {
  pick.value = key;
  if (now) setTimeout(insert, 0);
}
</script>

<template>
  <Modal title="Insert cross-reference" open test-id="crossref-dialog" @close="close">
    <div class="ml-segmented" role="radiogroup" aria-label="Reference type">
      <button type="button" role="radio" :aria-checked="kind === 'bookmark'" :class="cx(kind === 'bookmark' && 'is-on')" @click="setKind('bookmark')">Bookmarks</button>
      <button type="button" role="radio" :aria-checked="kind === 'heading'" :class="cx(kind === 'heading' && 'is-on')" @click="setKind('heading')">Headings</button>
    </div>
    <ul v-if="list.length" class="ml-pick-list" role="listbox" :aria-label="kind === 'bookmark' ? 'Bookmarks' : 'Headings'">
      <li v-for="it in list" :key="it.key">
        <button type="button" role="option" :aria-selected="pick === it.key" :class="cx('ml-pick', pick === it.key && 'is-on')" @click="choose(it.key)" @dblclick="choose(it.key, true)"><component :is="it.icon" :size="14" /> <b>{{ it.label }}</b> <span>{{ it.detail }}</span></button>
      </li>
    </ul>
    <p v-else class="ml-hint">{{ kind === 'bookmark' ? 'There are no bookmarks yet. Select text and choose Create bookmark.' : 'There are no headings in this document.' }}</p>
    <p class="ml-hint">The reference is inserted as linked text; {{ shortcutLabel('Ctrl') }}+click it to jump to the target.</p>
    <template #footer>
      <button type="button" class="ml-btn" @click="close">Cancel</button>
      <button type="button" class="ml-btn is-primary" :disabled="!pick" data-testid="crossref-insert" @click="insert">Insert</button>
    </template>
  </Modal>
</template>
