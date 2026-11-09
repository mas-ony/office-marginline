<script setup lang="ts">
import { changeTextClass, cx, type ReviewItem } from '@marginline/core/views';
import { Check, X } from '@lucide/vue';
import { useSnapshot, useUI } from '../context';
import CardHead from './CardHead.vue';

const props = defineProps<{ item: Extract<ReviewItem, { kind: 'change' }>; active: boolean; imported: boolean }>();
const emit = defineEmits<{ activate: [] }>();

const { editor } = useUI();
const readOnly = useSnapshot((s) => s.editMode === 'viewing');

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && e.target === e.currentTarget) emit('activate');
}
</script>

<template>
  <div
    :class="cx('ml-card ml-change-card', active && 'is-active')"
    role="dialog"
    aria-label="Tracked change discussion"
    data-testid="change-card"
    tabindex="0"
    @click="emit('activate')"
    @keydown="onKey"
  >
    <CardHead :name="item.author" :date="item.date" :imported="imported">
      <template v-if="!readOnly" #actions>
        <button type="button" class="ml-icon-btn" aria-label="Accept change" title="Accept" data-testid="change-accept" @click.stop="editor.decideChanges(props.item.changes, true)"><Check :size="16" /></button>
        <button type="button" class="ml-icon-btn" aria-label="Reject change" title="Reject" data-testid="change-reject" @click.stop="editor.decideChanges(props.item.changes, false)"><X :size="16" /></button>
      </template>
    </CardHead>
    <div class="ml-card-text">{{ item.summary.verb }}<template v-if="item.summary.text">{{ ' ' }}<span :class="changeTextClass(item.summary)">“{{ item.summary.text }}”</span></template><template v-if="item.summary.with !== undefined"> with <span class="ml-ins-text">“{{ item.summary.with }}”</span></template></div>
  </div>
</template>
