import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portals its children into document.body so that fixed-positioned modals
 * are not clipped by ancestor overflow containers (e.g. overflow-hidden on
 * page wrappers).
 *
 * Hydrates safely – renders nothing on the server / during SSR.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional hydration pattern
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(children, document.body);
}
