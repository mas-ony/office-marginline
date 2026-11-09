<script setup lang="ts">
import { cx, trapFocus } from '@marginline/core/views';
import { X } from '@lucide/vue';
import { ref, watchPostEffect } from 'vue';
import { useUI } from '../context';

const props = defineProps<{ title: string; open: boolean; testId?: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { layer } = useUI();
const el = ref<HTMLElement | null>(null);
watchPostEffect((onCleanup) => {
  if (!props.open) return;
  onCleanup(trapFocus(el.value, () => emit('close')));
});
</script>

<template>
  <Teleport v-if="open" :to="layer">
    <div class="ml-ui-modal-backdrop" @pointerdown.self="emit('close')">
      <div ref="el" :class="cx('ml-ui-modal', wide && 'is-wide')" role="dialog" aria-modal="true" :aria-label="title" :data-testid="testId">
        <div class="ml-ui-modal-head">
          <h2>{{ title }}</h2>
          <button type="button" class="ml-ui-btn ml-ui-modal-close" aria-label="Close" @click="emit('close')"><X :size="18" /></button>
        </div>
        <div class="ml-ui-modal-body"><slot /></div>
        <div v-if="$slots.footer" class="ml-ui-modal-foot"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>
