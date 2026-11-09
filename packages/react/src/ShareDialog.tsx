import { copyLink, qrSvg, relayAvailable, shareStatusText } from '@marginline/core/views';
import { Copy, Link2, LogOut, Users, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './controls';
import { useUI } from './context';
import { Avatar } from './review/cards';

function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => qrSvg(text), [text]);
  // The SVG is generated locally from the link text.
  return <div className="ml-qr" aria-label="QR code of the link" role="img" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Share: start a real-time session, show the link and who is connected. */
export function ShareDialog() {
  const { ui, openModal, collab, startSharing, stopSharing, toast } = useUI();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void relayAvailable(ui.options.relay).then(setAvailable);
  }, [ui]);
  const close = () => openModal(null);
  const link = collab?.link ?? '';
  const copy = async () => toast(await copyLink(link, input.current));
  return (
    <Modal title="Share" open onClose={close} testId="share-dialog" footer={<button type="button" className="ml-btn is-primary" onClick={close}>Done</button>}>
      {!collab && (
        <>
          <p className="ml-hint">Edit this document together in real time. Everyone with the link sees each other’s edits, comments, suggestions and cursors.</p>
          {available === false && (
            <p className="ml-share-warn" data-testid="share-unavailable">
              <WifiOff size={16} /> Real-time collaboration needs the Marginline relay on the server. This page is served without it.
            </p>
          )}
          {error && <p className="ml-share-warn">{error}</p>}
          <button
            type="button"
            className="ml-btn is-primary"
            disabled={!available || busy}
            data-testid="share-start"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await startSharing();
              } catch (e) {
                setError(`Could not start sharing: ${(e as Error).message}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Users size={16} /> {busy ? 'Starting…' : 'Start collaboration'}
          </button>
          <p className="ml-hint">Headers, footers and footnotes cannot be edited while a document is shared.</p>
        </>
      )}
      {collab && (
        <div className="ml-share" data-testid="share-live">
          <div className="ml-share-status">
            {collab.status === 'live' ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span data-testid="share-status">{shareStatusText(collab.status)}</span>
          </div>
          <div className="ml-label">Link</div>
          <div className="ml-share-link">
            <Link2 size={16} />
            <input ref={input} className="ml-input" readOnly value={link} aria-label="Share link" data-testid="share-link" onFocus={(e) => e.target.select()} />
            <button type="button" className="ml-btn" onClick={copy}><Copy size={15} /> Copy</button>
          </div>
          <div className="ml-share-body">
            <QrCode text={link} />
            <div className="ml-share-people">
              <div className="ml-label">Here now</div>
              <ul data-testid="share-people">
                {collab.participants.map((p) => (
                  <li key={p.clientID}><Avatar name={p.name} size={24} /> {p.name}{p.self ? ' (you)' : ''}</li>
                ))}
              </ul>
              <p className="ml-hint">Scan the code with a phone on the same network to open the document there.</p>
            </div>
          </div>
          <button type="button" className="ml-btn" data-testid="share-stop" onClick={stopSharing}><LogOut size={15} /> Stop sharing on this device</button>
        </div>
      )}
    </Modal>
  );
}
