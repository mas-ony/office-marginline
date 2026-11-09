<script setup lang="ts">
import { cx, placePopover, trackPopover } from '@marginline/core/views';
import { X } from '@lucide/vue';
import { computed, type CSSProperties, onMounted, onUpdated, ref, watchPostEffect } from 'vue';
import { useUI } from '../context';

const props = withDefaults(defineProps<{
  anchor: HTMLElement | null;
  open: boolean;
  panelClass?: string;
  align?: 'start' | 'end';
  /** Render as a bottom sheet on small screens. */
  sheetOnMobile?: boolean;
  title?: string;
}>(), { align: 'start', sheetOnMobile: true });
const emit = defineEmits<{ close: [] }>();

const { layer, state } = useUI();
const el = ref<HTMLElement | null>(null);
const pos = ref<{ left: number; top: number; maxHeight: number } | null>(null);
const mobile = computed(() => state.value.mobile && props.sheetOnMobile);
const style = computed<CSSProperties>(() => (pos.value
  ? { position: 'fixed', left: `${pos.value.left}px`, top: `${pos.value.top}px`, maxHeight: `${pos.value.maxHeight}px` }
  : { position: 'fixed', visibility: 'hidden' }));

/** Below the anchor, measured again whenever the content renders. */
function place() {
  if (!props.open || mobile.value || !props.anchor || !el.value) return;
  const p = placePopover(props.anchor, el.value, props.align);
  const q = pos.value;
  if (!q || p.left !== q.left || p.top !== q.top || p.maxHeight !== q.maxHeight) pos.value = p;
}
onMounted(place);
onUpdated(place);

watchPostEffect((onCleanup) => {
  if (!props.open || mobile.value || !props.anchor) return;
  window.addEventListener('resize', place);
  onCleanup(() => window.removeEventListener('resize', place));
});

watchPostEffect((onCleanup) => {
  if (!props.open) return;
  const anchor = props.anchor;
  onCleanup(trackPopover(el.value, () => anchor, () => emit('close')));
});
</script>

<template>
  <Teleport v-if="open" :to="layer">
    <div v-if="mobile" ref="el" class="ml-ui-sheet-backdrop" @pointerdown.self="emit('close')">
      <div :class="cx('ml-ui-sheet', panelClass)" role="dialog" :aria-label="title">
        <div class="ml-ui-sheet-grip" />
        <div v-if="title" class="ml-ui-sheet-title">
          <span>{{ title }}</span>
          <button type="button" class="ml-ui-btn" aria-label="Close" @click="emit('close')"><X :size="18" /></button>
        </div>
        <div class="ml-ui-sheet-body"><slot /></div>
      </div>
    </div>
    <div v-else ref="el" :class="cx('ml-ui-popover', panelClass)" :style="style" role="dialog" :aria-label="title"><slot /></div>
  </Teleport>
</template>
