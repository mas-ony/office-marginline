<script setup lang="ts">
import { Menu as MenuIcon, MessageSquareText } from '@lucide/vue';
import { ref } from 'vue';
import Popover from '../controls/Popover.vue';
import { useUI } from '../context';
import DocumentModeTool from '../toolbar/DocumentModeTool.vue';
import SearchTool from '../toolbar/SearchTool.vue';
import FileName from './FileName.vue';
import MobileMenu from './MobileMenu.vue';

const { ui } = useUI();
const open = ref(false);
const btn = ref<HTMLButtonElement | null>(null);
</script>

<template>
  <header class="ml-header is-mobile" data-testid="header">
    <button ref="btn" type="button" class="ml-icon-btn" aria-label="Menu" aria-haspopup="menu" :aria-expanded="open" data-testid="mobile-menu" @click="open = true">
      <MenuIcon :size="20" />
    </button>
    <FileName />
    <span class="ml-spacer" />
    <SearchTool />
    <DocumentModeTool />
    <button type="button" class="ml-icon-btn" aria-label="Comments and changes" data-testid="mobile-review" @click="ui.setPanelOpen(true)">
      <MessageSquareText :size="20" />
    </button>
    <Popover :anchor="btn" :open="open" title="Marginline" @close="open = false">
      <MobileMenu @done="open = false" />
    </Popover>
  </header>
</template>
