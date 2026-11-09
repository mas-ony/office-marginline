<script setup lang="ts">
import { cx, type SidePanelTab } from '@marginline/core/views';
import { ListChecks, PanelRightClose, TextCursorInput } from '@lucide/vue';
import { useUI } from './context';
import FieldsPanel from './FieldsPanel.vue';
import ReviewPanel from './review/ReviewPanel.vue';

/** The right-hand panel with Review (comments and changes) and Fields tabs. */
defineProps<{ inSheet?: boolean }>();
const TABS: { id: SidePanelTab; label: string; icon: unknown }[] = [
  { id: 'review', label: 'Review', icon: ListChecks },
  { id: 'fields', label: 'Fields', icon: TextCursorInput },
];
const { ui, state } = useUI();
</script>

<template>
  <aside :class="cx('ml-side', inSheet && 'in-sheet')" aria-label="Editor side panel" data-testid="side-panel">
    <div class="ml-side-tabs" role="tablist" aria-label="Side panel">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        role="tab"
        :aria-selected="state.panelTab === t.id"
        :class="cx('ml-side-tab', state.panelTab === t.id && 'is-on')"
        :data-testid="`tab-${t.id}`"
        @click="ui.setPanelTab(t.id)"
      ><component :is="t.icon" :size="16" /> {{ t.label }}</button>
      <button v-if="!inSheet" type="button" class="ml-icon-btn ml-side-close" aria-label="Minimize side panel" title="Minimize side panel" @click="ui.setPanelOpen(false)"><PanelRightClose :size="16" /></button>
    </div>
    <div class="ml-side-body" role="tabpanel" :aria-label="state.panelTab === 'review' ? 'Review' : 'Fields'">
      <ReviewPanel v-if="state.panelTab === 'review'" />
      <FieldsPanel v-else />
    </div>
  </aside>
</template>
