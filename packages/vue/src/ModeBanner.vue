<script setup lang="ts">
import { cx } from '@marginline/core/views';
import { useSnapshot, useUI } from './context';

/** On phones: a reminder that edits are suggestions, or that the document is read only. */
const { state } = useUI();
const mode = useSnapshot((s) => s.editMode);
</script>

<template>
  <div v-if="mode !== 'editing' && state.mobile" :class="cx('ml-mode-banner', `is-${mode}`)" data-testid="mode-banner">{{ mode === 'suggesting' ? 'Suggesting: your edits are tracked' : 'Viewing: read only' }}</div>
</template>
