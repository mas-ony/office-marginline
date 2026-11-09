<script setup lang="ts">
import {
  type ColorScheme,
  type DocumentInput,
  type EditMode,
  type EditorSnapshot,
  type Example,
  type FileActions,
  type Marginline,
  type MarginlineOptions,
  MarginlineUI,
  rootClassOf,
  type ThemeName,
  type UserInfo,
} from '@marginline/core/views';
import { X } from '@lucide/vue';
import { computed, onMounted, onUnmounted, type PropType, provide, ref, shallowRef, watch } from 'vue';
import Banners from './Banners.vue';
import CaretPanel from './CaretPanel.vue';
import CommentBubble from './CommentBubble.vue';
import ContextMenu from './ContextMenu.vue';
import { type UIContext, UI_KEY } from './context';
import Toast from './controls/Toast.vue';
import Dialogs from './dialogs/Dialogs.vue';
import FindBar from './FindBar.vue';
import HeaderBar from './header/HeaderBar.vue';
import HeaderFooterMenu from './HeaderFooterMenu.vue';
import ModeBanner from './ModeBanner.vue';
import PageIndicator from './PageIndicator.vue';
import ComposerCard from './review/ComposerCard.vue';
import Ruler from './Ruler.vue';
import SidePanel from './SidePanel.vue';
import StreamBanner from './StreamBanner.vue';
import LinkForm from './toolbar/LinkForm.vue';
import Toolbar from './toolbar/Toolbar.vue';

/** The complete editor: toolbar, document, review panel, menus and dialogs. */
defineOptions({ name: 'MarginlineEditor' });

// The options of MarginlineOptions; its callbacks are the events below.
const props = defineProps({
  /** Opened at start, and again whenever it changes. */
  document: { type: null as unknown as PropType<DocumentInput>, default: undefined },
  documentMode: { type: String as PropType<EditMode>, default: undefined },
  /** Shown on comments and tracked changes. */
  user: { type: Object as PropType<{ name: string; email?: string }>, default: undefined },
  viewing: { type: Object as PropType<MarginlineOptions['viewing']>, default: undefined },
  /** Document name, replacing the file name. */
  title: { type: String, default: undefined },
  theme: { type: String as PropType<ThemeName>, default: undefined },
  colorScheme: { type: String as PropType<ColorScheme>, default: undefined },
  /** Documents for the Examples menu; without any, the menu is not shown. */
  examples: { type: Array as PropType<Example[]>, default: undefined },
  /** Keeps the theme, appearance, ruler and the user's name in localStorage under `<storageKey>-…`. */
  storageKey: { type: String, default: undefined },
  /** Keeps unsaved changes in an IndexedDB database of this name and offers to recover them. */
  autosave: { type: String, default: undefined },
  /** With `autosave`: offer recovery when the editor starts without a document or room (default true). */
  offerRecovery: { type: Boolean, default: undefined },
  /** Base URL of the sharing relay (default `/collab`, served by @marginline/relay). */
  relay: { type: String, default: undefined },
  /** Link that opens a shared document; by default this page with `?room=<id>`. */
  shareLink: { type: Function as PropType<(room: string) => string>, default: undefined },
  /** Join this shared document at start. */
  room: { type: String, default: undefined },
  /** Replace some of the built-in file actions (Upload, Export, Print…). */
  files: { type: Object as PropType<Partial<FileActions>>, default: undefined },
  /** Handle Ctrl+F and Ctrl+Shift+E anywhere on the page, not only inside the editor. */
  globalShortcuts: { type: Boolean, default: undefined },
});

const emit = defineEmits<{
  /** The editor is ready and the initial document (or room) has opened. */
  ready: [marginline: Marginline];
  /** The reader changed their name (`v-model:user`). */
  'update:user': [user: UserInfo];
  /** The reader picked another theme in Customize (`v-model:theme`). */
  'update:theme': [theme: ThemeName];
  /** The reader picked another appearance in Customize (`v-model:color-scheme`). */
  'update:colorScheme': [scheme: ColorScheme];
}>();

function options(): MarginlineOptions {
  return {
    ...props,
    onReady: (ml) => emit('ready', ml),
    onUserChange: (user) => emit('update:user', user),
    onThemeChange: (theme) => emit('update:theme', theme),
    onColorSchemeChange: (scheme) => emit('update:colorScheme', scheme),
  };
}

// The first props create the interface; later ones are passed on.
const ui = new MarginlineUI(options());
watch(() => ({ ...props }), () => ui.setOptions(options()));

const state = shallowRef(ui.getState());
const offState = ui.subscribe(() => {
  state.value = ui.getState();
});
const snapshot = shallowRef(null as unknown as EditorSnapshot);
const ctx: UIContext = {
  ui,
  state,
  snapshot,
  editor: null!,
  store: null!,
  layer: null!,
  examples: computed(() => props.examples ?? []),
};
provide(UI_KEY, ctx);

const root = ref<HTMLDivElement | null>(null);
const host = ref<HTMLDivElement | null>(null);
// The editor exists (the parts below need it).
const attached = ref(false);
let offSnapshot = () => {};

onMounted(() => {
  ui.attach({ root: root.value!, host: host.value! });
  const store = ui.store!;
  ctx.editor = ui.editor!;
  ctx.store = store;
  ctx.layer = ui.layer!;
  snapshot.value = store.getSnapshot();
  offSnapshot = store.subscribe(() => {
    snapshot.value = store.getSnapshot();
  });
  attached.value = true;
});

onUnmounted(() => {
  offSnapshot();
  offState();
  ui.detach();
});

function linkDone() {
  ui.setLinkAtCaret(false);
  ctx.editor.focus();
}
</script>

<template>
  <div ref="root" :class="rootClassOf(state)" data-testid="app">
    <template v-if="attached">
      <HeaderBar />
      <Toolbar />
      <StreamBanner />
      <ModeBanner />
    </template>
    <div class="ml-workspace">
      <div class="ml-doc-area">
        <Ruler v-if="attached && state.rulerOn && !state.mobile" />
        <div ref="host" class="ml-doc-host" data-testid="doc-host" />
        <template v-if="attached">
          <FindBar v-if="state.findOpen" />
          <CommentBubble />
          <PageIndicator />
        </template>
      </div>
      <SidePanel v-if="attached && state.panelOpen && !state.mobile" />
    </div>
    <template v-if="attached">
      <div v-if="state.mobile && state.panelOpen" class="ml-ui-sheet-backdrop" @pointerdown.self="ui.setPanelOpen(false)">
        <div class="ml-ui-sheet ml-panel-sheet" role="dialog" aria-label="Review and fields">
          <div class="ml-ui-sheet-grip" />
          <button type="button" class="ml-icon-btn ml-sheet-close" aria-label="Close" @click="ui.setPanelOpen(false)"><X :size="18" /></button>
          <SidePanel in-sheet />
        </div>
      </div>
      <div v-if="state.mobile && state.composerRange" class="ml-ui-sheet-backdrop" @pointerdown.self="ui.closeComposer()">
        <div class="ml-ui-sheet ml-composer-sheet" role="dialog" aria-label="New comment">
          <div class="ml-ui-sheet-grip" />
          <ComposerCard />
        </div>
      </div>
      <CaretPanel v-if="state.linkAtCaret" @close="ui.setLinkAtCaret(false)"><LinkForm @done="linkDone" /></CaretPanel>
      <ContextMenu />
      <HeaderFooterMenu v-if="state.hfMenu" :at="state.hfMenu.at" :page-index="state.hfMenu.pageIndex" @close="ui.closeHeaderFooterMenu()" />
      <Dialogs />
      <Toast v-if="state.toast" :message="state.toast" />
      <Banners />
    </template>
  </div>
</template>
