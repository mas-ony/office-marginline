/** Reading documents from the ways they can be given, and saving files. */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A DOCX to open: a URL, a File or Blob, or the bytes. */
export type DocumentSource = string | Blob | ArrayBuffer | Uint8Array;

/** A document option: a source, or a source with the name to show. */
export type DocumentInput = DocumentSource | { data?: DocumentSource; url?: string; name?: string };

/** The source and name of a document option (no source for an empty object). */
export function documentOf(input: DocumentInput): { source?: DocumentSource; name?: string } {
  if (typeof input === 'string' || input instanceof Blob || input instanceof ArrayBuffer || input instanceof Uint8Array) return { source: input };
  return { source: input.data ?? input.url, name: typeof input.name === 'string' ? input.name : undefined };
}

/** File name in a URL: its last path segment. */
export function nameOfUrl(url: string): string {
  return decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'Document.docx');
}

export async function toBytes(src: DocumentSource): Promise<{ bytes: Uint8Array; name?: string }> {
  if (typeof src === 'string') {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`Could not fetch ${src} (HTTP ${r.status})`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), name: nameOfUrl(src) };
  }
  if (src instanceof Uint8Array) return { bytes: src };
  if (src instanceof ArrayBuffer) return { bytes: new Uint8Array(src) };
  return { bytes: new Uint8Array(await src.arrayBuffer()), name: (src as File).name };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
