<script setup lang="ts">
import { useUI } from '../context';

defineProps<{ message: string }>();
const { layer } = useUI();
</script>

<template>
  <Teleport :to="layer">
    <div class="ml-ui-toast" role="status">{{ message }}</div>
  </Teleport>
</template>
