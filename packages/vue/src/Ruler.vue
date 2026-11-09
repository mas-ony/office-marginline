<script setup lang="ts">
import { type RulerDrag, type RulerHandle, rulerGeometry, rulerLayout, rulerUsesMetric, startRulerDrag } from '@marginline/core/views';
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useUI } from './context';

/** Horizontal ruler for the page holding the caret, with margin and indent markers. */
const { editor, snapshot } = useUI();
const el = ref<HTMLDivElement | null>(null);
const tick = ref(0);
const drag = shallowRef<RulerDrag | null>(null);
const metric = rulerUsesMetric();

// Measured against the ruler, again after every editor change, scroll and resize.
const geometry = computed(() => {
  void snapshot.value;
  void tick.value;
  return rulerGeometry(editor, el.value);
});
const layout = computed(() => (geometry.value ? rulerLayout(geometry.value, drag.value, metric) : null));

const redraw = () => {
  tick.value++;
};
onMounted(() => {
  editor.scrollEl.addEventListener('scroll', redraw, { passive: true });
  window.addEventListener('resize', redraw);
});
onUnmounted(() => {
  editor.scrollEl.removeEventListener('scroll', redraw);
  window.removeEventListener('resize', redraw);
});

function onDown(handle: RulerHandle, e: PointerEvent) {
  startRulerDrag(editor, el.value!, handle, e, metric, (d) => {
    drag.value = d;
  });
}

const px = (n: number | undefined) => (n === undefined ? undefined : `${n}px`);
</script>

<template>
  <div ref="el" class="ml-ruler" data-testid="ruler" :role="layout ? 'group' : undefined" :aria-label="layout ? 'Ruler' : undefined" :aria-hidden="layout ? undefined : 'true'">
    <template v-if="layout">
      <div class="ml-ruler-page" :style="{ left: px(layout.page.left), width: px(layout.page.width) }" />
      <span v-for="t in layout.ticks" :key="t.key" :class="t.className" :style="{ left: px(t.left) }"><span v-if="t.label !== undefined" class="ml-tick-label">{{ t.label }}</span></span>
      <span
        v-for="s in layout.sliders"
        :key="s.handle"
        :class="s.className"
        role="slider"
        :aria-label="s.label"
        :aria-valuenow="s.value"
        tabindex="-1"
        :title="s.title"
        :style="{ left: px(s.left), width: px(s.width) }"
        @pointerdown="onDown(s.handle, $event)"
      />
    </template>
  </div>
</template>
