<script setup lang="ts">
import { useUI } from '../context';
import BookmarkDialog from './BookmarkDialog.vue';
import CrossRefDialog from './CrossRefDialog.vue';
import CustomizeDialog from './CustomizeDialog.vue';
import NoteDialog from './NoteDialog.vue';
import ShareDialog from './ShareDialog.vue';
import ShortcutsDialog from './ShortcutsDialog.vue';

const { state } = useUI();
</script>

<template>
  <BookmarkDialog v-if="state.modal === 'bookmark'" />
  <CrossRefDialog v-else-if="state.modal === 'crossRef'" />
  <NoteDialog v-else-if="state.modal === 'note'" />
  <CustomizeDialog v-else-if="state.modal === 'customize'" />
  <ShareDialog v-else-if="state.modal === 'share'" />
  <ShortcutsDialog v-else-if="state.modal === 'shortcuts'" />
</template>
