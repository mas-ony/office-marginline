<script setup lang="ts">
import { IMAGE_ACCEPT } from '@marginline/core/views';
import { Image as ImageIcon } from '@lucide/vue';
import { ref } from 'vue';
import { useSnapshot, useUI } from '../context';
import ToolButton from './ToolButton.vue';

const { editor } = useUI();
const readOnly = useSnapshot((s) => s.editMode === 'viewing');
const input = ref<HTMLInputElement | null>(null);

function picked(e: Event) {
  const el = e.target as HTMLInputElement;
  const files = Array.from(el.files ?? []);
  el.value = '';
  if (files.length) void editor.insertImages(files);
}
</script>

<template>
  <ToolButton label="Image" :disabled="readOnly" test-id="tb-image" @click="input?.click()"><ImageIcon :size="18" /></ToolButton>
  <input ref="input" type="file" :accept="IMAGE_ACCEPT" hidden data-testid="image-input" @change="picked" />
</template>
