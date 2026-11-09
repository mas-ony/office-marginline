<script setup lang="ts">
defineProps<{ label: string; htmlFor?: string }>();
</script>

<template>
  <div class="ml-ui-field">
    <label :for="htmlFor">{{ label }}</label>
    <slot />
  </div>
</template>
