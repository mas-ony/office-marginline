<script setup lang="ts">
import { clampToWindow, headerFooterMenuState, headerFooterOptionsButton, rulerUsesMetric } from '@marginline/core/views';
import { ArrowDownToLine, ArrowUpToLine, FileDigit, Hash, Layers, Link2, Sigma, Unlink } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue';
import { useUI } from './context';
import Menu from './controls/Menu.vue';
import MenuItem from './controls/MenuItem.vue';
import MenuSeparator from './controls/MenuSeparator.vue';
import DistanceField from './DistanceField.vue';

/** The Options menu of the header or footer being edited, opened from the button on its bar. */
const props = defineProps<{ at: { x: number; y: number }; pageIndex: number }>();
const emit = defineEmits<{ close: [] }>();
const { editor, layer } = useUI();
const el = ref<HTMLDivElement | null>(null);
const pos = ref({ left: props.at.x, top: props.at.y });
const metric = rulerUsesMetric();
// Set when Escape dismisses the menu or it is removed: what was typed in a distance field is then dropped.
const discard = { current: false };
// What the menu offers, as of when it opened.
const offer = computed(() => headerFooterMenuState(editor, props.pageIndex));

watch(() => props.at, (at) => {
  if (el.value) pos.value = clampToWindow(at.x, at.y, el.value);
}, { flush: 'post' });

let button: HTMLElement | null = null;
const close = (e: Event) => {
  if (e instanceof KeyboardEvent) {
    if (e.key !== 'Escape') return;
    discard.current = true;
    emit('close');
    editor.focus();
    return;
  }
  if (e.type === 'pointerdown' && el.value?.contains(e.target as Node)) return;
  // Leaving a distance field this way applies what was typed in it.
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && el.value?.contains(focused)) focused.blur();
  // Its own button closes it as well, through the request the button sends.
  if (e.type === 'pointerdown' && button?.contains(e.target as Node)) return;
  emit('close');
};
onMounted(() => {
  if (el.value) pos.value = clampToWindow(props.at.x, props.at.y, el.value);
  button = headerFooterOptionsButton(editor);
  button?.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', close, true);
  document.addEventListener('keydown', close, true);
  window.addEventListener('blur', close);
  editor.scrollEl.addEventListener('scroll', close, { passive: true });
});
onBeforeUnmount(() => {
  discard.current = true;
});
onUnmounted(() => {
  button?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', close, true);
  document.removeEventListener('keydown', close, true);
  window.removeEventListener('blur', close);
  editor.scrollEl.removeEventListener('scroll', close);
});

function run(fn: () => void) {
  emit('close');
  fn();
}
const field = (k: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGEXOFY') => run(() => editor.insertPageField(k));
const set = (o: Parameters<typeof editor.setHeaderFooterOptions>[1]) => editor.setHeaderFooterOptions(props.pageIndex, o);
</script>

<template>
  <Teleport :to="layer">
    <div ref="el" class="ml-ui-popover ml-context" :style="{ position: 'fixed', left: `${pos.left}px`, top: `${pos.top}px` }" data-testid="hf-options">
      <Menu :label="offer.kind === 'header' ? 'Header options' : 'Footer options'">
        <MenuItem label="Insert current page number" :disabled="!offer.editing" test-id="hf-page-number" @select="field('PAGE')"><template #icon><Hash :size="16" /></template></MenuItem>
        <MenuItem label="Insert total page count" :disabled="!offer.editing" test-id="hf-total-pages" @select="field('NUMPAGES')"><template #icon><Sigma :size="16" /></template></MenuItem>
        <MenuItem label="Insert section page count" :disabled="!offer.editing" test-id="hf-section-pages" @select="field('SECTIONPAGES')"><template #icon><Layers :size="16" /></template></MenuItem>
        <MenuItem label="Insert page X of Y" :disabled="!offer.editing" test-id="hf-page-x-of-y" @select="field('PAGEXOFY')"><template #icon><FileDigit :size="16" /></template></MenuItem>
        <MenuSeparator />
        <MenuItem label="Different first page" :checked="offer.options.differentFirstPage" toggle test-id="hf-different-first" @select="run(() => set({ differentFirstPage: !offer.options.differentFirstPage }))" />
        <MenuItem label="Different odd and even pages" description="Applies to the whole document." :checked="offer.options.differentOddEven" toggle test-id="hf-odd-even" @select="run(() => set({ differentOddEven: !offer.options.differentOddEven }))" />
        <template v-if="offer.linked !== null">
          <MenuSeparator />
          <MenuItem
            :label="offer.linked ? 'Unlink from previous' : 'Link to previous'"
            :description="offer.linked ? 'Same as previous' : undefined"
            test-id="hf-link"
            @select="run(() => editor.setHeaderFooterLinked(offer.kind, pageIndex, !offer.linked))"
          >
            <template #icon><Unlink v-if="offer.linked" :size="16" /><Link2 v-else :size="16" /></template>
          </MenuItem>
        </template>
      </Menu>
      <div class="ml-hf-distances" role="group" aria-label="Distances from the page edge">
        <DistanceField label="Header distance from edge" :value="offer.options.headerDistance" :max="offer.options.maxDistance" :metric="metric" test-id="hf-header-distance" :discard="discard" @commit="(v) => set({ headerDistance: v })">
          <template #icon><ArrowUpToLine :size="16" /></template>
        </DistanceField>
        <DistanceField label="Footer distance from edge" :value="offer.options.footerDistance" :max="offer.options.maxDistance" :metric="metric" test-id="hf-footer-distance" :discard="discard" @commit="(v) => set({ footerDistance: v })">
          <template #icon><ArrowDownToLine :size="16" /></template>
        </DistanceField>
      </div>
    </div>
  </Teleport>
</template>
