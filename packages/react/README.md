# @marginline/react

Marginline is a Word (DOCX) editor for desktop and mobile that runs in the browser: a one-row
toolbar, a review panel with comments and suggestions, Editing, Suggesting and Viewing modes,
fillable fields, themes and a page API. On phones it reflows the text and has a touch layout.
PDF export runs in the browser, and real-time sharing runs through a small relay
(`@marginline/relay`).

This package is the React interface. `@marginline/vue` is the same interface written in Vue, with
the same options.

## Install

```bash
npm install @marginline/react react react-dom
```

It needs React 19.

## Use

```tsx
import { MarginlineEditor } from '@marginline/react';
import '@marginline/react/style.css';

export function Contract() {
  return (
    <div style={{ height: '80vh' }}>
      <MarginlineEditor
        document="/contracts/lease.docx"
        documentMode="suggesting"
        user={{ name: 'Jordan Lee', email: 'jordan@example.com' }}
        onReady={(ml) => ml.on('commentsUpdate', () => console.log('comments changed'))}
      />
    </div>
  );
}
```

Import `style.css` once: it brings the fonts and the editor's styles. The editor fills its
container, so give the container a height.

`mount()` takes the same options, for pages that are not written in React:

```js
import { mount } from '@marginline/react';
import '@marginline/react/style.css';

const editor = mount(document.querySelector('#editor'), { document: file, theme: 'word' });
const ml = await editor.ready;
editor.update({ documentMode: 'viewing' });
editor.destroy();
```

## Options

| Option | |
| --- | --- |
| `document` | A URL, Blob, ArrayBuffer or bytes, or `{ url or data, name }`; opened again when it changes |
| `documentMode`, `viewing` | `'editing'`, `'suggesting'` or `'viewing'`; what Viewing shows (`trackedChanges`, `comments`) |
| `user` | The name (and email) on comments and tracked changes |
| `title` | The document name, in place of the file name |
| `theme`, `colorScheme` | `'modern'`, `'docs'`, `'word'` or `'blueprint'`; `'system'`, `'light'` or `'dark'` |
| `examples` | Documents for the Examples menu (no menu without them) |
| `storageKey` | Keep the theme, appearance, ruler and the user's name in localStorage |
| `autosave`, `offerRecovery` | Keep unsaved work in IndexedDB and offer to recover it |
| `relay`, `shareLink`, `room` | Sharing: the relay's URL (default `/collab`), the link to a room, a room to join at start |
| `files` | Replace some of the file actions (New, Upload, the examples, Export DOCX and PDF, Print, Send) |
| `globalShortcuts` | Handle Ctrl+F and Ctrl+Shift+E anywhere on the page |

The types are exported as `MarginlineOptions`, `ThemeName`, `UserInfo` and so on.

## Events

`onReady(ml)` runs once the first document (or shared room) has opened, with the editor's page
API instance. `onUserChange`, `onThemeChange` and `onColorSchemeChange` run when the reader
changes them in the interface.

## Page API

The instance passed to `onReady` drives the editor from code: finding and changing text, tracked
changes, comments, modes, events and export.

```js
const { items } = await ml.doc.query.match({ select: { type: 'text', pattern: 'twelve months' }, require: 'first' });
await ml.doc.replace({ target: items[0].target, text: 'eighteen months' }, { changeMode: 'tracked' });
const changes = await ml.doc.trackChanges.list();
ml.setDocumentMode('viewing');
const blob = await ml.export({ exportType: ['docx'], triggerDownload: false });
```

`installPageApi(ml)` from `@marginline/core` also puts it on the page as `window.marginline`.

## Page styles

The editor keeps its classes on its own element and on a layer it adds to the body for menus,
dialogs and messages: `ml-` for the interface, `ml-ui-` for menus and dialogs, `ml-dx-` for the
document. It changes nothing on `<html>` or `<body>`, and several editors can share a page.

## Sharing

Editing together needs `@marginline/relay` on the server that serves the page.

## License

MIT
