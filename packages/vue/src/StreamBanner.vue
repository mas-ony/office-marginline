<script setup lang="ts">
import { useSnapshot, useUI } from './context';

const { editor } = useUI();
const stream = useSnapshot((s) => s.stream);
const label = useSnapshot((s) => s.streamLabel);
</script>

<template>
  <div v-if="stream !== 'body'" class="ml-stream" role="status" data-testid="stream-banner">
    Editing {{ label || stream }}<button type="button" class="ml-btn is-small" @click="editor.exitHeaderFooter()">Close {{ stream }}</button>
  </div>
</template>
