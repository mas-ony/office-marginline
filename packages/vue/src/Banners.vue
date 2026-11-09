<script setup lang="ts">
import { useUI } from './context';

/** Unsaved work found by autosave, and messages that stay until dismissed. */
const { ui, state, layer } = useUI();
</script>

<template>
  <Teleport :to="layer">
    <div v-if="state.restore" class="ml-restore" role="alertdialog" aria-label="Recover document" data-testid="restore-banner">
      <span>Recover unsaved changes to “{{ state.restore.fileName }}” from {{ new Date(state.restore.savedAt).toLocaleString() }}?</span>
      <button type="button" class="ml-btn is-primary" @click="ui.recover()">Recover</button>
      <button type="button" class="ml-btn" @click="ui.discardRecovery()">Discard</button>
    </div>
    <div v-if="state.notice" class="ml-notice" role="alert" data-testid="notice">
      <span>{{ state.notice }}</span>
      <button type="button" class="ml-btn" @click="ui.notice(null)">OK</button>
    </div>
  </Teleport>
</template>
