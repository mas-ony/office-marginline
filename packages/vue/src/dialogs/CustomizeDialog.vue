<script setup lang="ts">
import { type ColorScheme, cx, DATE_BUTTON_SNIPPET, SCHEMES, THEMES } from '@marginline/core/views';
import { Moon, Plus, Sun, SunMoon } from '@lucide/vue';
import { computed, ref } from 'vue';
import Modal from '../controls/Modal.vue';
import { useUI } from '../context';

const SCHEME_ICONS: Record<ColorScheme, unknown> = { system: SunMoon, light: Sun, dark: Moon };

const { ui, state } = useUI();
const name = ref(state.value.user.name);
const email = ref(state.value.user.email);
const hasDemo = computed(() => state.value.customButtons.some((b) => b.id === 'today'));

function close() {
  const user = state.value.user;
  if (name.value.trim() && (name.value.trim() !== user.name || email.value.trim() !== user.email)) ui.setUser({ name: name.value.trim(), email: email.value.trim() });
  ui.openModal(null);
}

function addDemo() {
  const api = state.value.ready ? ui.api : null;
  if (!api) return;
  api.toolbar.addButton({
    id: 'today',
    label: "Insert today's date",
    text: '📅',
    onClick: () => void api.doc.text.insert({ text: new Date().toLocaleDateString() }),
  });
}
</script>

<template>
  <Modal title="Customize the editor" open test-id="customize-dialog" wide @close="close">
    <h3 class="ml-dialog-h">Set the theme</h3>
    <div class="ml-theme-grid" role="radiogroup" aria-label="Theme">
      <button v-for="t in THEMES" :key="t.id" type="button" role="radio" :aria-checked="state.theme === t.id" :class="cx('ml-theme-card', state.theme === t.id && 'is-on')" :data-theme-preview="t.id" :data-testid="`theme-${t.id}`" @click="ui.setTheme(t.id)">
        <span class="ml-theme-swatch" aria-hidden="true"><i /><i /><i /></span>
        <b>{{ t.label }}</b>
        <small>{{ t.description }}</small>
      </button>
    </div>
    <div class="ml-segmented" role="radiogroup" aria-label="Appearance">
      <button v-for="s in SCHEMES" :key="s.id" type="button" role="radio" :aria-checked="state.scheme === s.id" :class="cx(state.scheme === s.id && 'is-on')" :data-testid="`scheme-${s.id}`" @click="ui.setScheme(s.id)"><component :is="SCHEME_ICONS[s.id]" :size="15" /> {{ s.label }}</button>
    </div>
    <h3 class="ml-dialog-h">Customize the toolbar</h3>
    <p class="ml-hint">Add your own toolbar controls that change the document, with the page API.</p>
    <div class="ml-row">
      <button type="button" class="ml-btn" :disabled="hasDemo" data-testid="add-demo-button" @click="addDemo"><Plus :size="15" /> {{ hasDemo ? 'Date button added' : 'Quick demo: add a date button' }}</button>
    </div>
    <pre class="ml-code" aria-label="Demo code">{{ DATE_BUTTON_SNIPPET }}</pre>
    <h3 class="ml-dialog-h">Your name</h3>
    <p class="ml-hint">Shown on your comments and tracked changes.</p>
    <div class="ml-row">
      <input v-model="name" class="ml-input" aria-label="Your name" data-testid="user-name" />
      <input v-model="email" class="ml-input" aria-label="Your email" type="email" placeholder="Email (optional)" />
    </div>
    <template #footer>
      <button type="button" class="ml-btn is-primary" @click="close">Done</button>
    </template>
  </Modal>
</template>
