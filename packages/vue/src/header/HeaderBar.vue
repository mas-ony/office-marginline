<script setup lang="ts">
import { cx } from '@marginline/core/views';
import { BookOpen, FileDown, FilePlus, Keyboard, Palette, PanelRightOpen, Upload, UserPlus } from '@lucide/vue';
import Menu from '../controls/Menu.vue';
import { useUI } from '../context';
import Avatar from '../review/Avatar.vue';
import ExampleItems from './ExampleItems.vue';
import ExportItems from './ExportItems.vue';
import FileName from './FileName.vue';
import Logo from './Logo.vue';
import MenuButton from './MenuButton.vue';
import MobileHeader from './MobileHeader.vue';

/** Top bar: file actions, examples, collaboration, customization and export. */
const { ui, state, examples } = useUI();

function showPanel() {
  ui.setPanelTab('review');
  ui.setPanelOpen(true);
}
</script>

<template>
  <MobileHeader v-if="state.mobile" />
  <header v-else class="ml-header" data-testid="header">
    <Logo />
    <span class="ml-app-name">Marginline</span>
    <button type="button" class="ml-btn" data-testid="upload" @click="ui.files.open()"><Upload :size="16" /> Upload DOCX</button>
    <FileName />
    <MenuButton v-if="examples.length > 0" label="Examples" text="Examples" test-id="examples">
      <template #icon><BookOpen :size="16" /></template>
      <template #default="{ close }"><Menu label="Examples"><ExampleItems @done="close" /></Menu></template>
    </MenuButton>
    <button v-else type="button" class="ml-btn" data-testid="new-document" @click="ui.files.newDocument()"><FilePlus :size="16" /> New</button>
    <span class="ml-spacer" />
    <span v-if="state.collab && state.collab.participants.length > 0" class="ml-people" :aria-label="`${state.collab.participants.length} people here`" data-testid="participants">
      <span v-for="p in state.collab.participants.slice(0, 5)" :key="p.clientID" :title="p.self ? `${p.name} (you)` : p.name"><Avatar :name="p.name" :size="28" /></span>
    </span>
    <button type="button" :class="cx('ml-btn', !!state.collab && 'is-live')" data-testid="share" @click="ui.openModal('share')"><UserPlus :size="16" /> {{ state.collab ? 'Sharing' : 'Share' }}</button>
    <button type="button" class="ml-btn" aria-label="Open customization options" data-testid="customize" @click="ui.openModal('customize')"><Palette :size="16" /> Customize</button>
    <MenuButton label="Export" test-id="export" align="end">
      <template #icon><FileDown :size="16" /></template>
      <template #default="{ close }"><Menu label="Export"><ExportItems @done="close" /></Menu></template>
    </MenuButton>
    <button type="button" class="ml-icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" @click="ui.openModal('shortcuts')"><Keyboard :size="17" /></button>
    <button v-if="!state.panelOpen" type="button" class="ml-icon-btn" aria-label="Show side panel" title="Show side panel" data-testid="panel-open" @click="showPanel"><PanelRightOpen :size="18" /></button>
  </header>
</template>
