<script setup lang="ts">
import { type Marginline, MarginlineEditor } from '@marginline/vue';
import { connectShell, shellOptions } from '@marginline/web-shared/shell';

const options = shellOptions();
const onReady = (ml: Marginline) => connectShell(ml, options);
</script>

<template>
  <MarginlineEditor v-bind="options" @ready="onReady" />
</template>
