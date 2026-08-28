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

import { KeycloakOidcGateway, generatePkce } from '../src/oidc/gateway.js';

/** The `client.callback` call record the mock captures. */
interface CallbackRecord {
  redirectUri: string;
  params: Record<string, unknown>;
  checks: Record<string, unknown>;
}

/** The calls captured by the mocked openid-client client. */
const callbackCalls: CallbackRecord[] = [];

/** The default claims the mocked `client.callback` returns. */
const DEFAULT_CLAIMS: Record<string, unknown> = {
  sub: 'sub-alex-123',
  email: 'alex@nexora.dev',
  email_verified: true,
  name: 'Alex Morgan',
};

/**
 * Overridable claims for the mocked `client.callback`. Named `mock*` so the
 * hoisted `vi.mock` factory below may close over it.
 */
let mockClaims: Record<string, unknown> = { ...DEFAULT_CLAIMS };

/** Resets the captured calls and claims between tests. */
function resetCalls(): void {
  callbackCalls.length = 0;
  mockClaims = { ...DEFAULT_CLAIMS };
}

vi.mock('openid-client', () => {
  const authorizationUrl = vi.fn().mockResolvedValue('http://issuer.test/authorize');
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
    mockClaims = { sub: 'sub-no-email', email_verified: false };
    const gateway = buildGateway();
    await expect(
      gateway.exchangeCode({ code: 'c', state: 's', iss: 'i' }, 's', 'v'),
    ).rejects.toThrow(/no email claim/);
  });

  it('builds the authorization URL with the PKCE challenge and state', async () => {
    resetCalls();
    const gateway = buildGateway();
    const pkce = generatePkce();
    const url = await gateway.buildAuthorizationUrl('state-456', pkce);

    expect(url).toContain('issuer.test');
    expect(pkce.codeChallenge.length).toBeGreaterThan(20);
    expect(pkce.codeVerifier.length).toBeGreaterThan(20);
    expect(pkce.codeChallenge).not.toBe(pkce.codeVerifier);
  });
});
