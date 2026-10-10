import { useCallback, useEffect, useRef, useState } from 'react';
import { type z } from 'zod';

const COMPRESSED_PREFIX = 'z';
const PLAIN_PREFIX = 'j';

const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (encoded: string) =>
  Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
    char.charCodeAt(0),
  );

const pipeThrough = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

const encode = async (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if ('undefined' === typeof CompressionStream) {
    return PLAIN_PREFIX + toBase64Url(bytes);
  }
  return (
    COMPRESSED_PREFIX + toBase64Url(await pipeThrough(bytes, new CompressionStream('deflate-raw')))
  );
};

const decode = async (encoded: string): Promise<unknown> => {
  const bytes = fromBase64Url(encoded.slice(1));
  const json =
    COMPRESSED_PREFIX === encoded[0]
      ? await pipeThrough(bytes, new DecompressionStream('deflate-raw'))
      : bytes;
  return JSON.parse(new TextDecoder().decode(json)) as unknown;
};

const readHash = () => new URLSearchParams(window.location.hash.slice(1)).get('s');

/**
 * State that lives in the URL hash, so it can be shared as a link, and is kept in localStorage so
 * the last one comes back on the next visit. The hash never reaches the server. A link always
 * wins over what is stored, so opening a friend's link shows their version.
 */
export const useShareableState = <T>(schema: z.ZodType<T>, storageKey: string) => {
  const [state, setStateRaw] = useState<T | null>(null);
  const [ready, setReady] = useState(false);
  const dirty = useRef(false);

  const parse = useCallback(
    async (encoded: string | null) => {
      if (!encoded) {
        return null;
      }
      try {
        const parsed = schema.safeParse(await decode(encoded));
        return parsed.success ? parsed.data : null;
      } catch {
        // Links that were cut off or edited by hand are ignored.
        return null;
      }
    },
    [schema],
  );

  useEffect(() => {
    const load = async () => {
      const fromLink = await parse(readHash());
      const fromStorage = fromLink ? null : await parse(localStorage.getItem(storageKey));
      dirty.current = false;
      setStateRaw(fromLink ?? fromStorage);
      setReady(true);
    };
    load().catch(console.error);

    const onHashChange = () => {
      parse(readHash())
        .then((next) => {
          if (next) {
            dirty.current = false;
            setStateRaw(next);
          }
        })
        .catch(console.error);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [parse, storageKey]);

  useEffect(() => {
    if (!dirty.current || !state) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      encode(state)
        .then((encoded) => {
          if (cancelled) {
            return;
          }
          window.history.replaceState(null, '', `#s=${encoded}`);
          localStorage.setItem(storageKey, encoded);
        })
        .catch(console.error);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, storageKey]);

  const setState = useCallback((update: T | ((previous: T) => T)) => {
    dirty.current = true;
    setStateRaw((previous) =>
      'function' === typeof update
        ? previous
          ? (update as (previous: T) => T)(previous)
          : previous
        : update,
    );
  }, []);

  const shareUrl = useCallback(
    async () =>
      state
        ? `${window.location.origin}${window.location.pathname}#s=${await encode(state)}`
        : window.location.href,
    [state],
  );

  const clear = useCallback(() => {
    dirty.current = false;
    setStateRaw(null);
    localStorage.removeItem(storageKey);
    window.history.replaceState(null, '', window.location.pathname);
  }, [storageKey]);

  return { state, ready, setState, shareUrl, clear };
};

export const newId = () => Math.random().toString(36).slice(2, 7);
