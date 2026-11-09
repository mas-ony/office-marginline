<script setup lang="ts">
import { FilePlus, FileText } from '@lucide/vue';
import MenuItem from '../controls/MenuItem.vue';
import MenuSeparator from '../controls/MenuSeparator.vue';
import { useUI } from '../context';

const emit = defineEmits<{ done: [] }>();
const { ui, examples } = useUI();
</script>

<template>
  <MenuItem label="Blank document" test-id="example-blank" @select="emit('done'); ui.files.newDocument()"><template #icon><FilePlus :size="16" /></template></MenuItem>
  <MenuSeparator v-if="examples.length > 0" />
  <MenuItem v-for="ex in examples" :key="ex.id" :label="ex.label" :description="ex.description" :test-id="`example-${ex.id}`" @select="emit('done'); ui.files.openExample(ex.id)"><template #icon><FileText :size="16" /></template></MenuItem>
</template>
