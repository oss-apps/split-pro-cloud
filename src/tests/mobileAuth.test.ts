import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  appendQueryParams,
  formatAppleFullName,
  generateOpaqueToken,
  getBearerToken,
  handoffIdentifier,
  handoffUserId,
  hasBearerAuthorization,
  hashVerificationToken,
  isJsonContentType,
  isOwnNavigation,
  isValidChallenge,
  isValidHandoffCode,
  parseAppleAudiences,
  parseMobileRedirect,
  pkceChallenge,
  readChallengeCookie,
  signChallengeCookie,
  verifierMatchesChallenge,
} from '~/server/mobileAuthTokens';

const require = createRequire(import.meta.url);
// next-auth doesn't export its internals, so load the module that hashes email tokens by path
const { hashToken } = require(
  path.join(path.dirname(require.resolve('next-auth')), 'core/lib/utils.js'),
) as { hashToken: (token: string, options: { provider: object; secret: string }) => string };

// RFC 7636, appendix B
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const EXPO_GO_REDIRECTS = [
  'exp://192.168.1.20:8081/--/oauth-callback',
  'exp://u.expo.dev/abc/--/oauth-callback',
  'exp://evil.example.com/--/oauth-callback',
];

const REJECTED_REDIRECTS = [
  'https://evil.example',
  'https://evil.example/splitpro://oauth-callback',
  'http://localhost:3000',
  'javascript:alert(1)',
  'data:text/html,hi',
  '//evil.example',
  'splitpro.evil.example',
  'splitprox://oauth-callback',
  'exps://u.expo.dev',
  ' splitpro://oauth-callback',
  'splitpro://oauth-callback\n',
  '',
  undefined,
  ['splitpro://oauth-callback'],
];

void describe('parseMobileRedirect', () => {
  void describe('production', () => {
    void it('should accept only the app redirect', () => {
      assert.equal(
        parseMobileRedirect('splitpro://oauth-callback', false)?.href,
        'splitpro://oauth-callback',
      );
    });

    void it('should reject other app URIs, extra params and Expo Go', () => {
      [
        'splitpro://',
        'splitpro://auth',
        'splitpro://oauth-callback/',
        'splitpro:///oauth-callback',
        'splitpro://oauth-callback?code=planted',
        'splitpro://oauth-callback#x',
        'splitpro://oauth-callback.evil',
        'splitpro://user@oauth-callback',
        ...EXPO_GO_REDIRECTS,
        ...REJECTED_REDIRECTS,
      ].forEach((redirect) => {
        assert.equal(parseMobileRedirect(redirect, false), null, String(redirect));
      });
    });
  });

  void describe('development', () => {
    void it('should also accept Expo Go on any host', () => {
      ['splitpro://oauth-callback', ...EXPO_GO_REDIRECTS].forEach((redirect) => {
        assert.ok(parseMobileRedirect(redirect, true), redirect);
      });
    });

    void it('should reject everything else', () => {
      ['splitpro://auth', ...REJECTED_REDIRECTS].forEach((redirect) => {
        assert.equal(parseMobileRedirect(redirect, true), null, String(redirect));
      });
    });
  });

  void it('should append the code to the redirect', () => {
    const redirect = parseMobileRedirect('splitpro://oauth-callback', false)!;
    assert.equal(
      appendQueryParams(redirect, { code: 'abc' }),
      'splitpro://oauth-callback?code=abc',
    );
  });
});

void describe('parseAppleAudiences', () => {
  void it("should ignore Expo Go's bundle id outside development", () => {
    assert.deepEqual(parseAppleAudiences('app.splitpro, host.exp.Exponent', false), [
      'app.splitpro',
    ]);
    assert.deepEqual(parseAppleAudiences('host.exp.Exponent', false), []);
  });

  void it('should accept it in development', () => {
    assert.deepEqual(parseAppleAudiences('app.splitpro, host.exp.Exponent', true), [
      'app.splitpro',
      'host.exp.Exponent',
    ]);
  });

  void it('should skip empty entries', () => {
    assert.deepEqual(parseAppleAudiences('', false), []);
    assert.deepEqual(parseAppleAudiences(' app.splitpro ,,', false), ['app.splitpro']);
  });
});

void describe('challenge cookie', () => {
  const secret = 'test-secret';

  void it('should round trip the challenge and when it was issued', () => {
    const value = signChallengeCookie(RFC_CHALLENGE, 1_700_000_000_000, secret);
    assert.deepEqual(readChallengeCookie(value, secret), {
      challenge: RFC_CHALLENGE,
      issuedAt: 1_700_000_000_000,
    });
  });

  void it('should reject forged or malformed values', () => {
    const value = signChallengeCookie(RFC_CHALLENGE, 1_700_000_000_000, secret);
    const [challenge, issuedAt, signature] = value.split('.');
    [
      undefined,
      '',
      RFC_CHALLENGE,
      `${challenge}.${issuedAt}`,
      `${challenge}.0.${signature}`,
      `${pkceChallenge('a'.repeat(43))}.${issuedAt}.${signature}`,
      `${challenge}.${issuedAt}.${signature}x`,
      `${value}.extra`,
      signChallengeCookie(RFC_CHALLENGE, 1_700_000_000_000, 'other-secret'),
    ].forEach((cookie) => {
      assert.equal(readChallengeCookie(cookie, secret), null, String(cookie));
    });
  });
});

void describe('isValidHandoffCode', () => {
  void it('should only accept generated codes', () => {
    assert.ok(isValidHandoffCode(generateOpaqueToken()));
    assert.ok(!isValidHandoffCode('ABC234'));
    assert.ok(!isValidHandoffCode(generateOpaqueToken().toUpperCase()));
    assert.ok(!isValidHandoffCode(`${generateOpaqueToken()}0`));
  });
});

void describe('isJsonContentType', () => {
  void it('should accept JSON with or without parameters', () => {
    assert.ok(isJsonContentType('application/json'));
    assert.ok(isJsonContentType('Application/JSON; charset=utf-8'));
  });

  void it('should reject what HTML forms can send', () => {
    [
      undefined,
      '',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'text/plain',
      'text/plain; application/json',
    ].forEach((contentType) => {
      assert.ok(!isJsonContentType(contentType), String(contentType));
    });
  });
});

void describe('PKCE', () => {
  void it('should match the RFC 7636 example', () => {
    assert.equal(pkceChallenge(RFC_VERIFIER), RFC_CHALLENGE);
    assert.ok(isValidChallenge(RFC_CHALLENGE));
    assert.ok(verifierMatchesChallenge(RFC_VERIFIER, RFC_CHALLENGE));
  });

  void it('should reject a different or malformed verifier', () => {
    assert.ok(!verifierMatchesChallenge(`${RFC_VERIFIER.slice(0, -1)}A`, RFC_CHALLENGE));
    assert.ok(!verifierMatchesChallenge('short', pkceChallenge('short')));
    assert.ok(!verifierMatchesChallenge(`${'a'.repeat(43)} `, pkceChallenge(`${'a'.repeat(43)} `)));
  });

  void it('should only accept base64url sha256 challenges', () => {
    assert.ok(!isValidChallenge(`${RFC_CHALLENGE}=`));
    assert.ok(!isValidChallenge(RFC_CHALLENGE.replace('-', '+')));
    assert.ok(!isValidChallenge(RFC_CHALLENGE.slice(1)));
  });
});

void describe('hashVerificationToken', () => {
  void it("should hash like next-auth, so both can consume each other's codes", () => {
    const secret = 'test-secret';
    assert.equal(
      hashVerificationToken('ABC234', secret),
      hashToken('ABC234', { provider: {}, secret }),
    );
  });
});

void describe('handoff identifiers', () => {
  void it('should round trip the user id for the same challenge only', () => {
    const identifier = handoffIdentifier(RFC_CHALLENGE, 42);
    assert.equal(handoffUserId(identifier, RFC_CHALLENGE), 42);
    assert.equal(handoffUserId(identifier, pkceChallenge('a'.repeat(43))), null);
    assert.equal(handoffUserId('someone@example.com', RFC_CHALLENGE), null);
    assert.equal(handoffUserId(`mobile-handoff:${RFC_CHALLENGE}:42x`, RFC_CHALLENGE), null);
  });
});

void describe('getBearerToken', () => {
  void it('should read the token from an Authorization header', () => {
    assert.equal(getBearerToken('Bearer abc123'), 'abc123');
    assert.equal(getBearerToken('bearer  abc123 '), 'abc123');
  });

  void it('should ignore anything else', () => {
    assert.equal(getBearerToken(undefined), null);
    assert.equal(getBearerToken(''), null);
    assert.equal(getBearerToken('Basic abc123'), null);
    assert.equal(getBearerToken('Bearer'), null);
    assert.equal(getBearerToken('Bearer abc 123'), null);
  });
});

void describe('hasBearerAuthorization', () => {
  void it('should detect the bearer scheme, even with a malformed token', () => {
    assert.ok(hasBearerAuthorization('Bearer abc123'));
    assert.ok(hasBearerAuthorization('bearer abc 123'));
    assert.ok(hasBearerAuthorization('Bearer'));
  });

  void it('should leave other requests to the cookie session', () => {
    assert.ok(!hasBearerAuthorization(undefined));
    assert.ok(!hasBearerAuthorization(''));
    assert.ok(!hasBearerAuthorization('Basic abc123'));
    assert.ok(!hasBearerAuthorization('Bearerabc'));
  });
});

void describe('formatAppleFullName', () => {
  void it('should join the parts Apple shares', () => {
    assert.equal(formatAppleFullName({ givenName: 'Ada', familyName: 'Lovelace' }), 'Ada Lovelace');
    assert.equal(
      formatAppleFullName({ givenName: ' Ada ', middleName: null, familyName: 'Lovelace' }),
      'Ada Lovelace',
    );
    assert.equal(formatAppleFullName('  Ada   Lovelace '), 'Ada Lovelace');
  });

  void it('should return null without a name', () => {
    assert.equal(formatAppleFullName(undefined), null);
    assert.equal(formatAppleFullName({ givenName: null, familyName: null }), null);
    assert.equal(formatAppleFullName(' '), null);
  });
});

void describe('isOwnNavigation', () => {
  const origin = 'https://splitpro.app';

  void it('allows what the browser opened itself or one of our pages linked to', () => {
    assert.equal(isOwnNavigation('none', undefined, origin), true);
    assert.equal(isOwnNavigation('same-origin', `${origin}/auth/signin`, origin), true);
  });

  void it('refuses links and forms from other sites, whatever the Referer says', () => {
    assert.equal(isOwnNavigation('cross-site', undefined, origin), false);
    assert.equal(isOwnNavigation('same-site', 'https://evil.splitpro.app/', origin), false);
    assert.equal(isOwnNavigation('cross-site', `${origin}/`, origin), false);
    assert.equal(isOwnNavigation('unknown', undefined, origin), false);
    assert.equal(isOwnNavigation(['none', 'none'], undefined, origin), false);
  });

  void it('allows browsers without Fetch Metadata unless the Referer is another site', () => {
    assert.equal(isOwnNavigation(undefined, undefined, origin), true);
    assert.equal(isOwnNavigation(undefined, `${origin}/balances`, origin), true);
    assert.equal(isOwnNavigation(undefined, 'https://evil.example/', origin), false);
    assert.equal(isOwnNavigation(undefined, 'https://splitpro.app.evil.example/', origin), false);
    assert.equal(isOwnNavigation(undefined, 'not a url', origin), false);
  });
});
