<script setup lang="ts">
import { ZOOM_LEVELS } from '@marginline/core/views';
import Menu from '../controls/Menu.vue';
import MenuItem from '../controls/MenuItem.vue';
import MenuSeparator from '../controls/MenuSeparator.vue';
import { useSnapshot, useUI } from '../context';
import ToolMenu from './ToolMenu.vue';

const { editor } = useUI();
const percent = useSnapshot((s) => Math.round(s.zoom * 100));
</script>

<template>
  <ToolMenu label="Zoom" :text="`${percent}%`" test-id="tb-zoom" wide>
    <template #default="{ close }">
      <Menu label="Zoom">
        <MenuItem v-for="z in ZOOM_LEVELS" :key="z" :label="`${z}%`" :checked="percent === z" :test-id="`zoom-${z}`" @select="editor.setZoom(z / 100); close()" />
        <MenuSeparator />
        <MenuItem label="Fit width" test-id="zoom-fit" @select="editor.fitWidth(); close()" />
      </Menu>
    </template>
  </ToolMenu>
</template>
