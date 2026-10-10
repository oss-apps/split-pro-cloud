import { useCallback, useEffect, useRef, useState } from 'react';
import { type z } from 'zod';

const encode = (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const decode = (encoded: string): unknown => {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
};

/**
 * Calculator state that lives in the URL hash, so a result can be shared as a link. The hash never
 * reaches the server. The URL only changes once the user edits something.
 */
export const useShareableState = <T>(schema: z.ZodType<T>, initial: () => T) => {
  const [state, setStateRaw] = useState<T>(initial);
  const dirty = useRef(false);

  useEffect(() => {
    const encoded = new URLSearchParams(window.location.hash.slice(1)).get('s');
    if (!encoded) {
      return;
    }
    try {
      const parsed = schema.safeParse(decode(encoded));
      if (parsed.success) {
        setStateRaw(parsed.data);
      }
    } catch {
      // Ignore links that were cut off or edited by hand.
    }
  }, [schema]);

  useEffect(() => {
    if (!dirty.current) {
      return;
    }
    const timer = setTimeout(() => {
      window.history.replaceState(null, '', `#s=${encode(state)}`);
    }, 250);
    return () => clearTimeout(timer);
  }, [state]);

  const setState = useCallback((update: T | ((previous: T) => T)) => {
    dirty.current = true;
    setStateRaw(update);
  }, []);

  const shareUrl = useCallback(
    () => `${window.location.origin}${window.location.pathname}#s=${encode(state)}`,
    [state],
  );

  const reset = useCallback((next: T) => {
    dirty.current = false;
    setStateRaw(next);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return { state, setState, shareUrl, reset };
};

let idCounter = 0;
export const newId = () => `${Date.now().toString(36)}${(idCounter++).toString(36)}`;
