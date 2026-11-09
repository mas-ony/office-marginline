<script setup lang="ts">
import { Ruler } from '@lucide/vue';
import { useUI } from '../context';
import ToolButton from './ToolButton.vue';

const { ui, state } = useUI();
</script>

<template>
  <ToolButton label="Ruler" :active="state.rulerOn" test-id="tb-ruler" @click="ui.setRulerOn(!state.rulerOn)"><Ruler :size="18" /></ToolButton>
</template>
