/**
 * @marginline/core: the DOCX editor engine, the page API and the interface state the React and
 * Vue interfaces share. Import `@marginline/core/style.css` once for the fonts and styles.
 */
export {
  type ActiveEditor,
  type ChangeInfo,
  type CommentInfo,
  type DocumentApi,
  type ExportOptions,
  installPageApi,
  Marginline,
  type MarginlineConfig,
  type MarginlineEvent,
  type MarginlineHost,
  type Receipt,
  registerHost,
  type Target,
} from './api/marginline';
export { DOCX_MIME, downloadBlob, nameOfUrl, toBytes } from './api/source';
export { type CollabOptions, CollabSession, type CollabState, type CollabStatus, DEFAULT_RELAY, type Participant, relayAvailable, roomLink } from './collab/session';
export {
  DocxEditor,
  type DocxEditorOptions,
  type EditMode,
  type EditorEventMap,
  type Stream,
  type TrackedChangesView,
  type ViewingOptions,
} from './editor/DocxEditor';
export { type AutosaveRecord, clearAutosave, loadAutosave, saveAutosave } from './ui/autosave';
export { DISCARD_PROMPT, MarginlineUI, rootClassOf } from './ui/controller';
export { type EditorSnapshot, EditorStore } from './ui/store';
export * from './ui/types';
