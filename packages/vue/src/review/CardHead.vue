<script setup lang="ts">
import { formatWhen } from '@marginline/core/views';
import Avatar from './Avatar.vue';

defineProps<{ name: string; date?: string; imported?: boolean }>();
</script>

<template>
  <div class="ml-card-head">
    <Avatar :name="name" />
    <div class="ml-card-who">
      <div class="ml-card-name">
        <span class="ml-card-author">{{ name }}</span>
        <span v-if="imported" class="ml-badge">Imported</span>
      </div>
      <div class="ml-card-time">{{ formatWhen(date) }}</div>
    </div>
    <div v-if="$slots.actions" class="ml-card-actions"><slot name="actions" /></div>
  </div>
</template>
