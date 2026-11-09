<script setup lang="ts">
import { cx, type EditMode, keepFocus, MODES } from '@marginline/core/views';
import { Eye, MessageSquareText, PencilLine } from '@lucide/vue';
import { computed } from 'vue';
import { useSnapshot, useUI } from '../context';
import ToolMenu from './ToolMenu.vue';

defineProps<{ showLabel?: boolean }>();
const ICONS: Record<EditMode, unknown> = { editing: PencilLine, suggesting: MessageSquareText, viewing: Eye };

const { editor } = useUI();
const mode = useSnapshot((s) => s.editMode);
const cur = computed(() => MODES.find((m) => m.mode === mode.value) ?? MODES[0]);

function pick(m: EditMode, close: () => void) {
  editor.setEditMode(m);
  close();
}
</script>

<template>
  <ToolMenu label="Document mode" :text="showLabel ? cur.label : undefined" test-id="tb-mode" align="end" :active="mode !== 'editing'">
    <template #icon><component :is="ICONS[cur.mode]" :size="18" /></template>
    <template #default="{ close }">
      <div class="ml-ui-menu ml-mode-menu" role="menu" aria-label="Document mode">
        <button
          v-for="m in MODES"
          :key="m.mode"
          type="button"
          role="menuitemradio"
          :aria-checked="m.mode === mode"
          :aria-label="`${m.label} ${m.description}`"
          :class="cx('ml-ui-menuitem ml-mode-item', m.mode === mode && 'is-checked')"
          :data-testid="`mode-${m.mode}`"
          @mousedown="keepFocus"
          @click="pick(m.mode, close)"
        ><span class="ml-mode-icon"><component :is="ICONS[m.mode]" :size="18" /></span><span class="ml-mode-text"><b>{{ m.label }}</b><small>{{ m.description }}</small></span></button>
      </div>
    </template>
  </ToolMenu>
</template>
