<script setup lang="ts">
import { Search } from '@lucide/vue';
import { useUI } from '../context';
import ToolButton from './ToolButton.vue';

const { ui, state } = useUI();
</script>

<template>
  <ToolButton label="Search" shortcut="Ctrl+F" :active="state.findOpen" test-id="tb-search" @click="ui.setFindOpen(!state.findOpen)"><Search :size="18" /></ToolButton>
</template>
