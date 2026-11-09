<script setup lang="ts">
import { splitMentions } from '@marginline/core/views';

/** Text with @mentions emphasised. */
defineProps<{ text: string }>();
</script>

<template>
  <template v-for="(p, i) in splitMentions(text)" :key="i"><span v-if="p.startsWith('@')" class="ml-at">{{ p }}</span><template v-else>{{ p }}</template></template>
</template>
