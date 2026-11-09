<script setup lang="ts">
import { copyLink, qrSvg, relayAvailable, shareStatusText } from '@marginline/core/views';
import { Copy, Link2, LogOut, Users, Wifi, WifiOff } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import Modal from '../controls/Modal.vue';
import { useUI } from '../context';
import Avatar from '../review/Avatar.vue';

/** Share: start a real-time session, show the link and who is connected. */
const { ui, state } = useUI();
const available = ref<boolean | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const input = ref<HTMLInputElement | null>(null);
const link = computed(() => state.value.collab?.link ?? '');
// The SVG is generated locally from the link text.
const qr = computed(() => qrSvg(link.value));
const close = () => ui.openModal(null);

onMounted(() => {
  void relayAvailable(ui.options.relay).then((ok) => {
    available.value = ok;
  });
});

async function copy() {
  ui.toast(await copyLink(link.value, input.value));
}

async function start() {
  busy.value = true;
  error.value = null;
  try {
    await ui.startSharing();
  } catch (e) {
    error.value = `Could not start sharing: ${(e as Error).message}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal title="Share" open test-id="share-dialog" @close="close">
    <template v-if="!state.collab">
      <p class="ml-hint">Edit this document together in real time. Everyone with the link sees each other’s edits, comments, suggestions and cursors.</p>
      <p v-if="available === false" class="ml-share-warn" data-testid="share-unavailable"><WifiOff :size="16" /> Real-time collaboration needs the Marginline relay on the server. This page is served without it.</p>
      <p v-if="error" class="ml-share-warn">{{ error }}</p>
      <button type="button" class="ml-btn is-primary" :disabled="!available || busy" data-testid="share-start" @click="start"><Users :size="16" /> {{ busy ? 'Starting…' : 'Start collaboration' }}</button>
      <p class="ml-hint">Headers, footers and footnotes cannot be edited while a document is shared.</p>
    </template>
    <div v-else class="ml-share" data-testid="share-live">
      <div class="ml-share-status">
        <Wifi v-if="state.collab.status === 'live'" :size="16" />
        <WifiOff v-else :size="16" />
        <span data-testid="share-status">{{ shareStatusText(state.collab.status) }}</span>
      </div>
      <div class="ml-label">Link</div>
      <div class="ml-share-link">
        <Link2 :size="16" />
        <input ref="input" class="ml-input" readonly :value="link" aria-label="Share link" data-testid="share-link" @focus="($event.target as HTMLInputElement).select()" />
        <button type="button" class="ml-btn" @click="copy"><Copy :size="15" /> Copy</button>
      </div>
      <div class="ml-share-body">
        <div class="ml-qr" aria-label="QR code of the link" role="img" v-html="qr" />
        <div class="ml-share-people">
          <div class="ml-label">Here now</div>
          <ul data-testid="share-people">
            <li v-for="p in state.collab.participants" :key="p.clientID"><Avatar :name="p.name" :size="24" /> {{ p.name }}{{ p.self ? ' (you)' : '' }}</li>
          </ul>
          <p class="ml-hint">Scan the code with a phone on the same network to open the document there.</p>
        </div>
      </div>
      <button type="button" class="ml-btn" data-testid="share-stop" @click="ui.stopSharing()"><LogOut :size="15" /> Stop sharing on this device</button>
    </div>
    <template #footer>
      <button type="button" class="ml-btn is-primary" @click="close">Done</button>
    </template>
  </Modal>
</template>
