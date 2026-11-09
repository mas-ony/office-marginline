<script setup lang="ts">
import { shortcutLabel, SHORTCUTS } from '@marginline/core/views';
import Modal from '../controls/Modal.vue';
import { useUI } from '../context';

const { ui } = useUI();
</script>

<template>
  <Modal title="Keyboard shortcuts" open test-id="shortcuts-dialog" @close="ui.openModal(null)">
    <table class="ml-shortcuts">
      <tbody>
        <tr v-for="[k, d] in SHORTCUTS" :key="k"><td><kbd>{{ shortcutLabel(k) }}</kbd></td><td>{{ d }}</td></tr>
      </tbody>
    </table>
  </Modal>
</template>
