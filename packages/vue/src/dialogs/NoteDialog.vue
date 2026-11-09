<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Field from '../controls/Field.vue';
import Modal from '../controls/Modal.vue';
import { useUI } from '../context';

const { ui, state, editor } = useUI();
const key = state.value.modalData.key as string | undefined;
const kind = (state.value.modalData.kind as 'footnote' | 'endnote' | undefined) ?? (key?.startsWith('endnote:') ? 'endnote' : 'footnote');
const label = kind === 'endnote' ? 'endnote' : 'footnote';
const text = ref(key ? editor.noteText(key) : '');
const box = ref<HTMLTextAreaElement | null>(null);
onMounted(() => box.value?.focus());
const close = () => ui.openModal(null);

function save() {
  if (key) editor.setNoteText(key, text.value);
  else editor.insertNote(kind, text.value);
  close();
  editor.focus();
}
</script>

<template>
  <Modal :title="key ? `Edit ${label}` : `Insert ${label}`" open test-id="note-dialog" @close="close">
    <Field :label="`${label[0].toUpperCase()}${label.slice(1)} text`" html-for="note-text">
      <textarea id="note-text" ref="box" v-model="text" class="ml-input" rows="4" />
    </Field>
    <p v-if="!key" class="ml-hint">The reference mark is inserted at the caret; the note appears at the bottom of its page.</p>
    <template #footer>
      <button type="button" class="ml-btn" @click="close">Cancel</button>
      <button type="button" class="ml-btn is-primary" data-testid="note-save" @click="save">{{ key ? 'Save' : 'Insert' }}</button>
    </template>
  </Modal>
</template>
