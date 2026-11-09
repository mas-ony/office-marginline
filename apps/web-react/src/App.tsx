import { MarginlineEditor } from '@marginline/react';
import { useState } from 'react';
import { connectShell, shellOptions } from '@marginline/web-shared/shell';

export function App() {
  const [options] = useState(shellOptions);
  return <MarginlineEditor {...options} onReady={(ml) => connectShell(ml, options)} />;
}
