<script setup lang="ts">
import { FileDown, FileText, Printer, Share2 } from '@lucide/vue';
import MenuItem from '../controls/MenuItem.vue';
import { useUI } from '../context';

const emit = defineEmits<{ done: [] }>();
const { ui } = useUI();
const files = ui.files;
</script>

<template>
  <MenuItem label="Export DOCX" test-id="export-docx" @select="emit('done'); files.downloadDocx()"><template #icon><FileText :size="16" /></template></MenuItem>
  <MenuItem label="Export PDF" test-id="export-pdf" @select="emit('done'); void files.exportPdf()"><template #icon><FileDown :size="16" /></template></MenuItem>
  <MenuItem label="Print…" test-id="export-print" @select="emit('done'); files.print()"><template #icon><Printer :size="16" /></template></MenuItem>
  <MenuItem v-if="files.share" label="Send file…" test-id="export-share" @select="emit('done'); files.share?.()"><template #icon><Share2 :size="16" /></template></MenuItem>
</template>
