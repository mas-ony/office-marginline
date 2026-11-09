<script setup lang="ts">
import { cx, keepFocus } from '@marginline/core/views';
import { ref } from 'vue';

const emit = defineEmits<{ pick: [rows: number, cols: number] }>();
const N = 10;
const hover = ref({ r: 1, c: 1 });
</script>

<template>
  <div class="ml-table-grid" data-testid="table-grid">
    <div class="ml-grid" role="grid" aria-label="Table size" @mouseleave="hover = { r: 1, c: 1 }">
      <div v-for="r in N" :key="r" class="ml-grid-row" role="row">
        <button
          v-for="c in N"
          :key="c"
          type="button"
          role="gridcell"
          :aria-label="`${r} x ${c}`"
          :class="cx('ml-grid-cell', r <= hover.r && c <= hover.c && 'is-on')"
          @mousedown="keepFocus"
          @mouseenter="hover = { r, c }"
          @focus="hover = { r, c }"
          @click="emit('pick', r, c)"
        />
      </div>
    </div>
    <div class="ml-grid-label">{{ hover.r }} x {{ hover.c }}</div>
  </div>
</template>
