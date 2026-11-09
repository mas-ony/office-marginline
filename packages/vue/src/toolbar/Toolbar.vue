<script setup lang="ts">
import { cx, fitToolbar, keepFocus, phoneToolbar, toolbarItems } from '@marginline/core/views';
import { EllipsisVertical } from '@lucide/vue';
import { computed, ref, watchPostEffect } from 'vue';
import Popover from '../controls/Popover.vue';
import { useSnapshot, useUI } from '../context';
import DocumentModeTool from './DocumentModeTool.vue';
import SearchTool from './SearchTool.vue';
import ToolRow from './ToolRow.vue';

/** The single-row toolbar; items that do not fit move into "⋮". */
const { state } = useUI();
const viewMode = useSnapshot((s) => s.viewMode);
const row = ref<HTMLDivElement | null>(null);
const more = ref<HTMLButtonElement | null>(null);
const width = ref(10_000);
const moreOpen = ref(false);

const items = computed(() => toolbarItems(state.value.customButtons));
const shown = computed(() => fitToolbar(items.value, width.value));
const visible = computed(() => items.value.filter((i) => shown.value.has(i.id)));
const hidden = computed(() => items.value.filter((i) => !shown.value.has(i.id)));
const phoneItems = computed(() => phoneToolbar(items.value, viewMode.value));

watchPostEffect((onCleanup) => {
  const el = row.value;
  if (!el || typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(() => {
    width.value = el.clientWidth;
  });
  ro.observe(el);
  width.value = el.clientWidth;
  onCleanup(() => ro.disconnect());
});
</script>

<template>
  <div v-if="state.mobile" class="ml-toolbar is-mobile" role="toolbar" aria-label="Toolbar" data-testid="toolbar">
    <div class="ml-toolbar-scroll"><ToolRow :items="phoneItems" /></div>
  </div>
  <div v-else class="ml-toolbar" role="toolbar" aria-label="Toolbar" data-testid="toolbar">
    <div ref="row" class="ml-toolbar-main">
      <ToolRow :items="visible" />
      <template v-if="hidden.length > 0">
        <button
          ref="more"
          type="button"
          :class="cx('ml-tool', moreOpen && 'is-active')"
          aria-label="Overflow items"
          aria-haspopup="true"
          :aria-expanded="moreOpen"
          data-tip="More tools"
          data-testid="tb-more"
          @mousedown="keepFocus"
          @click="moreOpen = !moreOpen"
        ><EllipsisVertical :size="18" /></button>
        <Popover :anchor="more" :open="moreOpen" title="More tools" @close="moreOpen = false">
          <div class="ml-overflow" role="group" aria-label="More tools" data-testid="tb-overflow"><ToolRow :items="hidden" /></div>
        </Popover>
      </template>
    </div>
    <div class="ml-toolbar-side">
      <SearchTool />
      <DocumentModeTool />
    </div>
  </div>
</template>
