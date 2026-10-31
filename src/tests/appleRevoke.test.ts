import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { UnsecuredJWT, decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';

import {
  type AppleRevokeConfig,
  createAppleClientSecret,
  getAppleRevokeConfig,
  normalizeApplePrivateKey,
  revokeAppleAuthorization,
} from '~/server/appleRevoke';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const config: AppleRevokeConfig = {
  teamId: 'TEAM123456',
  keyId: 'KEY1234567',
  privateKey: PRIVATE_KEY,
  clientId: 'app.splitpro.ios',
};

const APPLE_SUB = '001234.abcdef.1234';
const idToken = (sub: string) => new UnsecuredJWT({ sub }).encode();

type Call = { url: string; form: URLSearchParams };

/** A fetch that answers each Apple endpoint with the given response, and records the calls. */
const mockFetch = (responses: Record<string, () => Response | Promise<Response>>) => {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, form: new URLSearchParams(String(init?.body)) });
    const respond = responses[url];
    assert.ok(respond, `Unexpected request to ${url}`);
    return respond();
  }) as typeof fetch;
  return { calls, fetchFn };
};

const tokenResponse = (body: Record<string, string>) => () =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Runs without the expected error logs. */
const quietly = async <T>(run: () => Promise<T>) => {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = original;
  }
};

const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

void describe('createAppleClientSecret', () => {
  void it('should sign an ES256 JWT with the key id, team and bundle id for Apple', async () => {
    const now = Date.UTC(2026, 9, 21, 12);
    const secret = await createAppleClientSecret(config, now);

    assert.deepEqual(decodeProtectedHeader(secret), { alg: 'ES256', kid: 'KEY1234567' });
    const { payload } = await jwtVerify(secret, await importSPKI(PUBLIC_KEY, 'ES256'), {
      currentDate: new Date(now),
    });
    assert.deepEqual(payload, {
      iss: 'TEAM123456',
      sub: 'app.splitpro.ios',
      aud: 'https://appleid.apple.com',
      iat: now / 1000,
      exp: now / 1000 + 300,
    });
  });
});

void describe('getAppleRevokeConfig', () => {
  void it('should read a private key with literal \\n as a PEM', () => {
    const oneLine = PRIVATE_KEY.trim().replace(/\n/g, '\\n');

    assert.equal(normalizeApplePrivateKey(oneLine), PRIVATE_KEY.trim());
    assert.equal(
      getAppleRevokeConfig({ ...config, privateKey: oneLine })?.privateKey,
      PRIVATE_KEY.trim(),
    );
  });

  void it('should be unconfigured when anything is missing', () => {
    assert.equal(getAppleRevokeConfig({ ...config, teamId: undefined }), null);
    assert.equal(getAppleRevokeConfig({ ...config, keyId: '' }), null);
    assert.equal(getAppleRevokeConfig({ ...config, privateKey: undefined }), null);
    assert.equal(getAppleRevokeConfig({ ...config, clientId: undefined }), null);
  });
});

void describe('revokeAppleAuthorization', () => {
  void it('should exchange the code, then revoke the refresh token', async () => {
    const { calls, fetchFn } = mockFetch({
      [TOKEN_URL]: tokenResponse({
        access_token: 'access',
        refresh_token: 'refresh',
        id_token: idToken(APPLE_SUB),
      }),
      [REVOKE_URL]: () => new Response(null, { status: 200 }),
    });

    const result = await revokeAppleAuthorization({
      config,
      authorizationCode: 'auth-code',
      appleUserIds: [APPLE_SUB],
      fetchFn,
    });

    assert.equal(result, 'revoked');
    assert.deepEqual(
      calls.map((call) => call.url),
      [TOKEN_URL, REVOKE_URL],
    );
    const [exchange, revoke] = calls;
    assert.equal(exchange?.form.get('client_id'), 'app.splitpro.ios');
    assert.equal(exchange?.form.get('code'), 'auth-code');
    assert.equal(exchange?.form.get('grant_type'), 'authorization_code');
    assert.equal(exchange?.form.has('redirect_uri'), false);
    assert.ok(exchange?.form.get('client_secret'));
    assert.equal(revoke?.form.get('client_id'), 'app.splitpro.ios');
    assert.equal(revoke?.form.get('client_secret'), exchange?.form.get('client_secret'));
    assert.equal(revoke?.form.get('token'), 'refresh');
    assert.equal(revoke?.form.get('token_type_hint'), 'refresh_token');
  });

  void it('should revoke the access token when there is no refresh token', async () => {
    const { calls, fetchFn } = mockFetch({
      [TOKEN_URL]: tokenResponse({ access_token: 'access', id_token: idToken(APPLE_SUB) }),
      [REVOKE_URL]: () => new Response(null, { status: 200 }),
    });

    const result = await revokeAppleAuthorization({
      config,
      authorizationCode: 'auth-code',
      appleUserIds: [APPLE_SUB],
      fetchFn,
    });

    assert.equal(result, 'revoked');
    assert.equal(calls[1]?.form.get('token'), 'access');
    assert.equal(calls[1]?.form.get('token_type_hint'), 'access_token');
  });

  void it('should skip when Apple is not configured', async () => {
    const { calls, fetchFn } = mockFetch({});

    const result = await revokeAppleAuthorization({
      config: null,
      authorizationCode: 'auth-code',
      appleUserIds: [APPLE_SUB],
      fetchFn,
    });

    assert.equal(result, 'unconfigured');
    assert.equal(calls.length, 0);
  });

  void it('should not revoke a code for another Apple ID', async () => {
    const { calls, fetchFn } = mockFetch({
      [TOKEN_URL]: tokenResponse({ refresh_token: 'refresh', id_token: idToken('someone-else') }),
    });

    const result = await quietly(() =>
      revokeAppleAuthorization({
        config,
        authorizationCode: 'auth-code',
        appleUserIds: [APPLE_SUB],
        fetchFn,
      }),
    );

    assert.equal(result, 'mismatched');
    assert.deepEqual(
      calls.map((call) => call.url),
      [TOKEN_URL],
    );
  });

  void describe('Failures', () => {
    void it('should report a rejected code without throwing', async () => {
      const { calls, fetchFn } = mockFetch({
        [TOKEN_URL]: () => new Response('{"error":"invalid_grant"}', { status: 400 }),
      });

      const result = await quietly(() =>
        revokeAppleAuthorization({
          config,
          authorizationCode: 'used-code',
          appleUserIds: [APPLE_SUB],
          fetchFn,
        }),
      );

      assert.equal(result, 'failed');
      assert.equal(calls.length, 1);
    });

    void it('should report a failed revoke without throwing', async () => {
      const { fetchFn } = mockFetch({
        [TOKEN_URL]: tokenResponse({ refresh_token: 'refresh', id_token: idToken(APPLE_SUB) }),
        [REVOKE_URL]: () => new Response('{"error":"invalid_client"}', { status: 400 }),
      });

      const result = await quietly(() =>
        revokeAppleAuthorization({
          config,
          authorizationCode: 'auth-code',
          appleUserIds: [APPLE_SUB],
          fetchFn,
        }),
      );

      assert.equal(result, 'failed');
    });

    void it('should report a network error or a bad key without throwing', async () => {
      const { fetchFn } = mockFetch({
        [TOKEN_URL]: () => Promise.reject(new TypeError('fetch failed')),
      });

      const [offline, badKey] = await quietly(() =>
        Promise.all([
          revokeAppleAuthorization({
            config,
            authorizationCode: 'auth-code',
            appleUserIds: [APPLE_SUB],
            fetchFn,
          }),
          revokeAppleAuthorization({
            config: { ...config, privateKey: 'not a key' },
            authorizationCode: 'auth-code',
            appleUserIds: [APPLE_SUB],
            fetchFn,
          }),
        ]),
      );

      assert.equal(offline, 'failed');
      assert.equal(badKey, 'failed');
    });
  });
});
