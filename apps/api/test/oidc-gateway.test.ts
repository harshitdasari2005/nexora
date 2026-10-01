/**
 * OIDC gateway regression tests.
 *
 * The API test suite otherwise uses {@link FakeOidcGateway}, which never
 * exercised the REAL Keycloak code path. During the product stabilization
 * E2E pass, the real flow failed with `RPError: state missing from the
 * response`: `openid-client` validates the OIDC `state` against the callback
 * query PARAMS (line: `if (!params.state && checks.state) throw`), but
 * `KeycloakOidcGateway.exchangeCode` only passed `{ code }`. These tests
 * pin the production gateway's contract with a mocked issuer.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  generateNonce,
  generatePkce,
  KeycloakOidcGateway,
  OidcValidationError,
} from '../src/oidc/gateway.js';

/** The `client.callback` call record the mock captures. */
interface CallbackRecord {
  redirectUri: string;
  params: Record<string, unknown>;
  checks: Record<string, unknown>;
}

/** The calls captured by the mocked openid-client client. */
const callbackCalls: CallbackRecord[] = [];

/** The authorization-URL requests the mocked client received. */
const authorizationCalls: Record<string, unknown>[] = [];

/** When set, the mocked `client.callback` throws it (e.g. an RPError). */
let mockCallbackError: Error | undefined;

/** The default claims the mocked `client.callback` returns. */
const DEFAULT_CLAIMS: Record<string, unknown> = {
  sub: 'sub-alex-123',
  email: 'alex@nexora.dev',
  email_verified: true,
  name: 'Alex Morgan',
  nonce: 'nonce-123',
};

/**
 * Overridable claims for the mocked `client.callback`. Named `mock*` so the
 * hoisted `vi.mock` factory below may close over it.
 */
let mockClaims: Record<string, unknown> = { ...DEFAULT_CLAIMS };

/** Resets the captured calls and claims between tests. */
function resetCalls(): void {
  callbackCalls.length = 0;
  authorizationCalls.length = 0;
  mockCallbackError = undefined;
  mockClaims = { ...DEFAULT_CLAIMS };
}

vi.mock('openid-client', () => {
  const authorizationUrl = vi.fn().mockImplementation(async (request: Record<string, unknown>) => {
    authorizationCalls.push(request);
    return 'http://issuer.test/authorize';
  });
  const endSessionUrl = vi.fn().mockResolvedValue('http://issuer.test/logout');
  const callback = vi
    .fn()
    .mockImplementation(
      async (
        redirectUri: string,
        params: Record<string, unknown>,
        checks: Record<string, unknown>,
      ) => {
        callbackCalls.push({ redirectUri, params, checks });
        if (mockCallbackError !== undefined) throw mockCallbackError;
        return { claims: () => mockClaims };
      },
    );
  return {
    Issuer: {
      discover: vi.fn().mockResolvedValue({
        Client: class {
          readonly authorizationUrl = authorizationUrl;
          readonly endSessionUrl = endSessionUrl;
          readonly callback = callback;
        },
      }),
    },
  };
});

/** A gateway backed by the mocked issuer. */
function buildGateway(): KeycloakOidcGateway {
  return new KeycloakOidcGateway({
    issuerUrl: 'http://localhost:8080/realms/nexora',
    clientId: 'nexora-web',
    redirectUri: 'http://localhost:3001/api/auth/callback',
  });
}

describe('KeycloakOidcGateway.exchangeCode (real Keycloak contract)', () => {
  it('passes the full callback query (state + iss) to openid-client (stabilization regression)', async () => {
    resetCalls();
    const gateway = buildGateway();
    const identity = await gateway.exchangeCode(
      {
        code: 'code-abc',
        state: 'state-123',
        iss: 'http://localhost:8080/realms/nexora',
        session_state: 'sess-1',
      },
      'state-123',
      'verifier-xyz',
      'nonce-123',
    );

    // openid-client validates the callback query PARAMS against the issuer
    // metadata: without `state` it throws `state missing from the response`
    // and without `iss` (when the IdP emits it) `iss missing from the
    // response`. The real Keycloak redirect carries BOTH — so both must be
    // passed through.
    expect(callbackCalls).toHaveLength(1);
    expect(callbackCalls[0]?.params).toMatchObject({
      code: 'code-abc',
      state: 'state-123',
      iss: 'http://localhost:8080/realms/nexora',
    });
    expect(callbackCalls[0]?.checks).toMatchObject({
      state: 'state-123',
      code_verifier: 'verifier-xyz',
      nonce: 'nonce-123', // openid-client validates the ID token's nonce against this
    });

    // The identity maps from the token claims.
    expect(identity).toMatchObject({
      subject: 'sub-alex-123',
      email: 'alex@nexora.dev',
      emailVerified: true,
      displayName: 'Alex Morgan',
    });
  });

  it('rejects a token set with no email claim (never provisions an empty address)', async () => {
    resetCalls();
    mockClaims = { sub: 'sub-no-email', email_verified: false, nonce: 'n' };
    const gateway = buildGateway();
    await expect(
      gateway.exchangeCode({ code: 'c', state: 's', iss: 'i' }, 's', 'v', 'n'),
    ).rejects.toThrow(/no email claim/);
  });

  it('builds the authorization URL with the PKCE challenge and state', async () => {
    resetCalls();
    const gateway = buildGateway();
    const pkce = generatePkce();
    const url = await gateway.buildAuthorizationUrl('state-456', pkce, 'nonce-456');

    expect(url).toContain('issuer.test');
    expect(pkce.codeChallenge.length).toBeGreaterThan(20);
    expect(pkce.codeVerifier.length).toBeGreaterThan(20);
    expect(pkce.codeChallenge).not.toBe(pkce.codeVerifier);
  });

  it('AUTH-006: the authorization request carries the nonce, next to state and the S256 PKCE challenge', async () => {
    resetCalls();
    const pkce = generatePkce();
    await buildGateway().buildAuthorizationUrl('state-789', pkce, 'nonce-789');
    expect(authorizationCalls).toHaveLength(1);
    expect(authorizationCalls[0]).toMatchObject({
      state: 'state-789',
      nonce: 'nonce-789',
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
    });
  });

  it('AUTH-006: an ID token with a missing, empty or different nonce is rejected even if the library check were bypassed', async () => {
    const gateway = buildGateway();
    for (const claims of [
      { sub: 's', email: 'a@b.co', nonce: 'someone-elses-nonce' },
      { sub: 's', email: 'a@b.co' }, // no nonce claim at all
      { sub: 's', email: 'a@b.co', nonce: '' },
      { sub: 's', email: 'a@b.co', nonce: 42 },
    ]) {
      resetCalls();
      mockClaims = claims as Record<string, unknown>;
      await expect(
        gateway.exchangeCode({ code: 'c', state: 's', iss: 'i' }, 's', 'v', 'expected-nonce'),
      ).rejects.toBeInstanceOf(OidcValidationError);
    }
  });

  it('AUTH-006: library validation failures (RPError/OPError) become OidcValidationError; other failures keep propagating', async () => {
    const gateway = buildGateway();
    for (const name of ['RPError', 'OPError']) {
      resetCalls();
      mockCallbackError = Object.assign(new Error('nonce mismatch, expected X, got: Y'), { name });
      await expect(
        gateway.exchangeCode({ code: 'c', state: 's', iss: 'i' }, 's', 'v', 'n'),
      ).rejects.toBeInstanceOf(OidcValidationError);
    }
    resetCalls();
    mockCallbackError = new Error('connect ECONNREFUSED');
    const failure = gateway.exchangeCode({ code: 'c', state: 's', iss: 'i' }, 's', 'v', 'n');
    await expect(failure).rejects.toThrow(/ECONNREFUSED/);
    await expect(failure).rejects.not.toBeInstanceOf(OidcValidationError);
  });

  it('generateNonce is fresh and high-entropy for every call', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits, base64url
  });
});
