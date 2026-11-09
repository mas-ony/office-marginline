<script setup lang="ts">
import { FIELD_DRAG_TYPE } from '@marginline/core/views';
import { GripVertical, Plus, TextCursorInput } from '@lucide/vue';
import { computed } from 'vue';
import { useSnapshot, useUI } from './context';
import FieldRow from './FieldRow.vue';

const { editor } = useUI();
const version = useSnapshot((s) => s.fieldsVersion);
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
const fields = computed(() => {
  void version.value;
  return editor.fields();
});

function dragStart(e: DragEvent) {
  e.dataTransfer!.setData(FIELD_DRAG_TYPE, 'new');
  e.dataTransfer!.setData('text/plain', '');
  e.dataTransfer!.effectAllowed = 'copy';
}

function insert() {
  editor.insertField();
  editor.focus();
}
</script>

<template>
  <div class="ml-fields" data-testid="fields-panel">
    <h3 class="ml-panel-title">Fill the fields</h3>
    <div class="ml-label">Edit fields</div>
    <ul v-if="fields.length" class="ml-field-list" aria-label="Document fields">
      <FieldRow v-for="f in fields" :key="f.name" :field="f" :read-only="readOnly" />
    </ul>
    <p v-else class="ml-empty">This document has no fields yet.</p>
    <template v-if="!readOnly">
      <div class="ml-label">Add fields</div>
      <div class="ml-field-drop">
        <button type="button" class="ml-field-chip" draggable="true" data-testid="new-field" title="Drag onto the page, or click to insert at the cursor" @dragstart="dragStart" @click="insert"><GripVertical :size="14" /> <TextCursorInput :size="15" /> New field</button>
        <p>Drag onto the page to add a new field, or click to insert it at the cursor. Selected text becomes the field's value.</p>
      </div>
      <button type="button" class="ml-btn is-small" @click="insert"><Plus :size="15" /> Insert field at cursor</button>
    </template>
  </div>
</template>
