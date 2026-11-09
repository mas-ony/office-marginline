<script setup lang="ts">
import { avatarColor, initials } from '@marginline/core/views';

withDefaults(defineProps<{ name: string; size?: number }>(), { size: 28 });
</script>

<template>
  <span class="ml-avatar" :style="{ background: avatarColor(name), width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.38}px` }" aria-hidden="true">{{ initials(name) }}</span>
</template>
