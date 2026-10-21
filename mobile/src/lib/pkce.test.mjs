// Run with `node --test src/lib/pkce.test.mjs` (Node 22.18+ strips the TypeScript types).
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  VERIFIER_BYTE_LENGTH,
  VERIFIER_PATTERN,
  base64UrlEncode,
  createCodeChallenge,
  createCodeVerifier,
} from './pkce.ts';

const sha256 = (data) => webcrypto.subtle.digest('SHA-256', data);

describe('createCodeChallenge', () => {
  it('should match the RFC 7636 appendix B example', async () => {
    const challenge = await createCodeChallenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      sha256,
    );
    assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('should match the server pkceChallenge for a generated verifier', async () => {
    const verifier = createCodeVerifier(webcrypto.getRandomValues(new Uint8Array(64)));
    const server = createHash('sha256').update(verifier).digest('base64url');
    assert.equal(await createCodeChallenge(verifier, sha256), server);
  });
});

describe('createCodeVerifier', () => {
  it('should produce a valid verifier', () => {
    const verifier = createCodeVerifier(
      webcrypto.getRandomValues(new Uint8Array(VERIFIER_BYTE_LENGTH)),
    );
    assert.equal(verifier.length, VERIFIER_BYTE_LENGTH);
    assert.match(verifier, VERIFIER_PATTERN);
  });

  it('should reject too few or too many bytes', () => {
    assert.throws(() => createCodeVerifier(new Uint8Array(42)));
    assert.throws(() => createCodeVerifier(new Uint8Array(129)));
  });
});

describe('base64UrlEncode', () => {
  it('should use the url alphabet without padding', () => {
    assert.equal(base64UrlEncode(new Uint8Array([0xfb, 0xff])), '-_8');
    assert.equal(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xbf])), '-_-_');
    assert.equal(base64UrlEncode(new Uint8Array([])), '');
  });
});
