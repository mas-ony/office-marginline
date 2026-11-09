<script setup lang="ts">
import { caretPanelPosition, dismissOnOutside } from '@marginline/core/views';
import { onMounted, onUnmounted, ref } from 'vue';
import { useUI } from './context';

/** Fixed-position panel at the caret (used for Ctrl+K). */
const emit = defineEmits<{ close: [] }>();
const { editor, layer } = useUI();
const el = ref<HTMLDivElement | null>(null);
const pos = ref({ left: 0, top: 0 });
let off = () => {};
onMounted(() => {
  pos.value = caretPanelPosition(editor, el.value);
  off = dismissOnOutside(() => el.value, () => emit('close'));
});
onUnmounted(() => off());
</script>

<template>
  <Teleport :to="layer">
    <div ref="el" class="ml-ui-popover ml-caret-panel" :style="{ position: 'fixed', left: `${pos.left}px`, top: `${pos.top}px` }"><slot /></div>
  </Teleport>
</template>
