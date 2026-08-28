/**
 * @nexora/app-api — OIDC gateway.
 *
 * The authentication boundary between the API and the OIDC identity provider
 * (Keycloak). The gateway is an interface so tests can substitute a fake;
 * the production implementation uses `openid-client` discovery against the
 * configured issuer (SAD.md §13.1 authentication; ROADMAP.md §3 TDR 3.11).
 */

import { createHash, randomBytes } from 'node:crypto';

import { Issuer, type Client } from 'openid-client';

import type { OidcConfig } from '../config.js';

/** The verified identity of a principal after the OIDC code exchange. */
export interface OidcIdentity {
  /** The stable IdP-side subject. */
  subject: string;
  /** The verified email address. */
  email: string;
  /** Whether the IdP verified the email. */
  emailVerified: boolean;
  /** The display name from the IdP profile, when provided. */
  displayName?: string;
  /** The issuer that verified the identity (audit trail). */
  issuer: string;
}

/**
 * PKCE parameters for a public OAuth client (SAD.md §13.1). The client is
 * public (`token_endpoint_auth_method: none`), so the authorization request
 * must carry a code challenge and the token exchange must prove possession
 * of the matching verifier (OAuth 2.1).
 */
export interface PkceParameters {
  /** The S256 code challenge sent in the authorization request. */
  codeChallenge: string;
  /** The code verifier held server-side until the callback. */
  codeVerifier: string;
}

/** Generates a PKCE verifier + S256 challenge pair for one authorization. */
export function generatePkce(): PkceParameters {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeChallenge, codeVerifier };
}

/** The IdP boundary used by the auth routes. */
export interface OidcGateway {
  /**
   * Builds the authorization URL for the given CSRF state and PKCE challenge.
   */
  buildAuthorizationUrl(state: string, pkce: PkceParameters): Promise<string>;
  /**
   * Exchanges an authorization code (validating the state) for an identity,
   * proving possession of the PKCE verifier. `params` is the parsed callback
   * query (code, state, iss, ...) — openid-client validates these against
   * the issuer metadata and the expected checks.
   */
  exchangeCode(
    params: OidcCallbackParams,
    expectedState: string,
    codeVerifier: string,
  ): Promise<OidcIdentity>;
  /** Builds the IdP logout URL that returns to the given post-logout target. */
  buildLogoutUrl(redirectTo: string): Promise<string>;
}

/** The parsed OIDC callback query (the raw IdP redirect parameters). */
export interface OidcCallbackParams {
  /** The authorization code. */
  code?: string;
  /** The CSRF state echoed by the IdP. */
  state?: string;
  /** The issuer that produced the response (Keycloak appends `iss`). */
  iss?: string;
  /** Keycloak's session state (informational). */
  session_state?: string;
}

/**
 * A {@link OidcGateway} backed by Keycloak via `openid-client` discovery.
 * The client is resolved lazily (one discovery per process) and cached.
 */
export class KeycloakOidcGateway implements OidcGateway {
  readonly #issuerUrl: string;
  readonly #clientId: string;
  readonly #redirectUri: string;
  #clientPromise: Promise<Client> | undefined;

  constructor(config: OidcConfig) {
    this.#issuerUrl = config.issuerUrl;
    this.#clientId = config.clientId;
    this.#redirectUri = config.redirectUri;
  }

  async buildAuthorizationUrl(state: string, pkce: PkceParameters): Promise<string> {
    const client = await this.#client();
    return client.authorizationUrl({
      scope: 'openid profile email',
      state,
      nonce: undefined,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
    });
  }

  async exchangeCode(
    params: OidcCallbackParams,
    expectedState: string,
    codeVerifier: string,
  ): Promise<OidcIdentity> {
    const client = await this.#client();
    // openid-client validates the callback query PARAMS against the issuer
    // metadata (state AND iss are required when the IdP emits them) — the
    // real Keycloak redirect appends `state` and `iss`, so the full parsed
    // callback query is passed through. (Regression: the fake gateway used
    // in tests never exercised this real flow.)
    const tokenSet = await client.callback(
      this.#redirectUri,
      { code: params.code, state: params.state, iss: params.iss },
      { state: expectedState, code_verifier: codeVerifier },
    );
    const claims = tokenSet.claims();
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new Error('OIDC token set carried no subject claim');
    }
    if (typeof claims.email !== 'string' || claims.email.length === 0) {
      // The realm is configured to always release `email` (scope `email`).
      // A token without it is malformed for our purposes — fail rather than
      // provision a user with an empty address (defense in depth).
      throw new Error('OIDC token set carried no email claim');
    }
    return {
      subject: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true,
      displayName:
        typeof claims.name === 'string' && claims.name.length > 0
          ? claims.name
          : typeof claims.preferred_username === 'string'
            ? claims.preferred_username
            : undefined,
      issuer: this.#issuerUrl,
    };
  }

  async buildLogoutUrl(redirectTo: string): Promise<string> {
    const client = await this.#client();
    return client.endSessionUrl({
      post_logout_redirect_uri: redirectTo,
      client_id: this.#clientId,
    });
  }

  /** Lazily discovers the issuer and creates the client (cached). */
  #client(): Promise<Client> {
    this.#clientPromise ??= (async () => {
      const issuer = await Issuer.discover(this.#issuerUrl);
      return new issuer.Client({
        client_id: this.#clientId,
        redirect_uris: [this.#redirectUri],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    })();
    return this.#clientPromise;
  }
}
