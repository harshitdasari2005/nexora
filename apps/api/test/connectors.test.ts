/**
 * S25 Phase 7 — External connector provider tests.
 *
 * Verifies the GitHub and Slack connectors against deterministic fixture
 * transports (no live provider calls — contract tests with stable fixtures;
 * real-provider verification is a separate deferred step):
 * - every tool maps to the REAL provider API shape (repos/issues/channels/
 *   messages) and reads only its declared input fields;
 * - write tools VERIFY against the provider before reporting success (never
 *   a bare 201/200), and a failed read-back surfaces `VERIFICATION_FAILED`;
 * - provider failures (401/403/404/429/{ok:false}) map to stable Nexora
 *   connector error codes — never raw provider internals;
 * - credentials/identity/scope are NEVER part of tool input: schemas reject
 *   them by construction (`additionalProperties: false`), and the connector
 *   reads only its business fields from the input record.
 */

import { describe, expect, it } from 'vitest';
import type {
  ConnectorHttpRequest,
  ConnectorHttpResponse,
  ConnectorHttpTransport,
} from '@nexora/connectors';

import { GitHubConnector, GITHUB_CAPABILITIES } from '../src/ai/connectors/github-connector.js';
import { SlackConnector, SLACK_CAPABILITIES } from '../src/ai/connectors/slack-connector.js';

/** A deterministic fixture transport: records requests, serves canned responses. */
class FixtureTransport implements ConnectorHttpTransport {
  readonly calls: ConnectorHttpRequest[] = [];

  constructor(private readonly handler: (request: ConnectorHttpRequest) => ConnectorHttpResponse) {}

  async request(input: ConnectorHttpRequest): Promise<ConnectorHttpResponse> {
    this.calls.push(input);
    return this.handler(input);
  }
}

/** A connector execution context (trusted scope — never tool-supplied). */
const TRUSTED_CONTEXT = {
  tenantId: 'org_test',
  workspaceId: 'wsp_test',
  correlationId: 'corr_test',
};

/** Shared strict input records with injected credential/scope attempts. */
const FORGED_INPUT = {
  owner: 'acme',
  repo: 'mobile-banking',
  title: 'Payments bug',
  body: 'Describe the payments bug',
  token: 'ghp_forged',
  apiKey: 'xoxb-forged',
  tenantId: 'org_alien',
  organizationId: 'org_alien',
  workspaceId: 'wsp_alien',
  roleId: 'executive.ceo',
  capabilityIds: ['github.issues.create'],
};

describe('GitHub connector (S25 Phase 7)', () => {
  it('declares its capabilities and tools with correct read/write classification', () => {
    const connector = new GitHubConnector({ token: 'test-token' });
    expect(connector.id).toBe('github');
    expect(connector.provider).toBe('github');
    expect(connector.capabilities).toEqual(GITHUB_CAPABILITIES);
    expect(connector.tools.map((tool) => tool.id)).toEqual([
      'github.repositories.list',
      'github.repositories.get',
      'github.issues.list',
      'github.issues.create',
    ]);
    const create = connector.resolveTool('github.issues.create');
    expect(create?.operationType).toBe('write');
    expect(create?.requiresApproval).toBe(true);
    const list = connector.resolveTool('github.repositories.list');
    expect(list?.operationType).toBe('read');
    expect(list?.requiresApproval).toBe(false);
  });

  it('lists repositories through the provider and maps only business fields', async () => {
    const transport = new FixtureTransport(() => ({
      status: 200,
      body: [
        {
          name: 'mobile-banking',
          full_name: 'acme/mobile-banking',
          html_url: 'https://github.com/acme/mobile-banking',
          private: true,
          default_branch: 'main',
          description: 'The mobile banking app',
        },
      ],
    }));
    const connector = new GitHubConnector({ token: 'test-token', transport });
    const result = await connector
      .resolveTool('github.repositories.list')!
      .execute({}, TRUSTED_CONTEXT);
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      repositories: [
        {
          name: 'mobile-banking',
          fullName: 'acme/mobile-banking',
          htmlUrl: 'https://github.com/acme/mobile-banking',
          private: true,
          defaultBranch: 'main',
        },
      ],
      count: 1,
    });
    expect(transport.calls[0]?.headers?.Authorization).toBe('Bearer test-token');
  });

  it('gets one repository', async () => {
    const transport = new FixtureTransport(() => ({
      status: 200,
      body: { name: 'mobile-banking', full_name: 'acme/mobile-banking', private: false },
    }));
    const connector = new GitHubConnector({ token: 'test-token', transport });
    const result = await connector
      .resolveTool('github.repositories.get')!
      .execute({ owner: 'acme', repo: 'mobile-banking' }, TRUSTED_CONTEXT);
    expect(result.ok).toBe(true);
    expect(result.output?.repository).toMatchObject({
      name: 'mobile-banking',
      fullName: 'acme/mobile-banking',
    });
    expect(transport.calls[0]?.url).toContain('/repos/acme/mobile-banking');
  });

  it('lists issues (open by default, or by explicit state)', async () => {
    const transport = new FixtureTransport(() => ({
      status: 200,
      body: [
        {
          number: 42,
          title: 'Payments bug',
          state: 'open',
          html_url: 'https://github.com/acme/mobile-banking/issues/42',
        },
      ],
    }));
    const connector = new GitHubConnector({ token: 'test-token', transport });
    const result = await connector
      .resolveTool('github.issues.list')!
      .execute({ owner: 'acme', repo: 'mobile-banking' }, TRUSTED_CONTEXT);
    expect(result.ok).toBe(true);
    expect(result.output?.issues).toMatchObject([
      { number: 42, title: 'Payments bug', state: 'open' },
    ]);
    expect(transport.calls[0]?.url).toContain('state=open');
  });

  it('creates an issue ONLY after verifying it with the provider (read-back)', async () => {
    const calls: string[] = [];
    const transport = new FixtureTransport((request) => {
      calls.push(request.method + ' ' + request.url);
      if (request.method === 'POST') {
        return { status: 201, body: { number: 7 } };
      }
      // Verification read-back.
      return {
        status: 200,
        body: {
          number: 7,
          title: 'Payments bug',
          state: 'open',
          html_url: 'https://github.com/acme/mobile-banking/issues/7',
        },
      };
    });
    const connector = new GitHubConnector({ token: 'test-token', transport });
    const result = await connector
      .resolveTool('github.issues.create')!
      .execute(FORGED_INPUT, TRUSTED_CONTEXT);
    expect(result.ok).toBe(true);
    expect(result.output?.issue).toMatchObject({ number: 7, title: 'Payments bug' });
    // The write performed POST then the verification GET.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe('POST https://api.github.com/repos/acme/mobile-banking/issues');
    expect(calls[1]).toContain('/repos/acme/mobile-banking/issues/7');
    // The forged credential/scope fields were NEVER sent to the provider.
    const sentBody = transport.calls[0]?.body as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty('token');
    expect(sentBody).not.toHaveProperty('tenantId');
    expect(sentBody).not.toHaveProperty('workspaceId');
    expect(sentBody).not.toHaveProperty('roleId');
    expect(transport.calls[0]?.headers?.Authorization).toBe('Bearer test-token');
  });

  it('reports verification_failed when the created issue cannot be read back', async () => {
    const transport = new FixtureTransport((request) =>
      request.method === 'POST'
        ? { status: 201, body: { number: 9 } }
        : { status: 404, body: undefined },
    );
    const connector = new GitHubConnector({ token: 'test-token', transport });
    const result = await connector
      .resolveTool('github.issues.create')!
      .execute({ owner: 'acme', repo: 'mobile-banking', title: 'X' }, TRUSTED_CONTEXT);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VERIFICATION_FAILED');
  });

  it('maps provider failures to stable connector codes (401/403/404/429/5xx)', async () => {
    const cases: Array<{ status: number; code: string }> = [
      { status: 401, code: 'PROVIDER_AUTH_FAILED' },
      { status: 403, code: 'PROVIDER_PERMISSION_DENIED' },
      { status: 404, code: 'PROVIDER_NOT_FOUND' },
      { status: 429, code: 'PROVIDER_RATE_LIMITED' },
      { status: 500, code: 'PROVIDER_UNAVAILABLE' },
    ];
    for (const testCase of cases) {
      const transport = new FixtureTransport(() => ({ status: testCase.status, body: undefined }));
      const connector = new GitHubConnector({ token: 'test-token', transport });
      const result = await connector
        .resolveTool('github.repositories.list')!
        .execute({}, TRUSTED_CONTEXT);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(testCase.code);
    }
  });
});

describe('Slack connector (S25 Phase 7)', () => {
  it('declares its capabilities and tools with correct read/write classification', () => {
    const connector = new SlackConnector({ token: 'test-token' });
    expect(connector.id).toBe('slack');
    expect(connector.capabilities).toEqual(SLACK_CAPABILITIES);
    expect(connector.tools.map((tool) => tool.id)).toEqual([
      'slack.channels.list',
      'slack.messages.recent',
      'slack.messages.send',
    ]);
    const send = connector.resolveTool('slack.messages.send');
    expect(send?.operationType).toBe('write');
    expect(send?.requiresApproval).toBe(true);
  });

  it('lists accessible channels', async () => {
    const transport = new FixtureTransport(() => ({
      status: 200,
      body: {
        ok: true,
        channels: [{ id: 'C1', name: 'engineering', is_private: false, is_member: true }],
      },
    }));
    const connector = new SlackConnector({ token: 'test-token', transport });
    const result = await connector.resolveTool('slack.channels.list')!.execute({}, TRUSTED_CONTEXT);
    expect(result.ok).toBe(true);
    expect(result.output?.channels).toMatchObject([{ id: 'C1', name: 'engineering' }]);
  });

  it('lists recent messages in a channel', async () => {
    const transport = new FixtureTransport(() => ({
      status: 200,
      body: {
        ok: true,
        messages: [{ ts: '1.1', user: 'U1', text: 'hello', type: 'message' }],
      },
    }));
    const connector = new SlackConnector({ token: 'test-token', transport });
    const result = await connector
      .resolveTool('slack.messages.recent')!
      .execute({ channel: 'C1' }, TRUSTED_CONTEXT);
    expect(result.ok).toBe(true);
    expect(result.output?.messages).toMatchObject([{ ts: '1.1', text: 'hello' }]);
    expect(transport.calls[0]?.url).toContain('conversations.history');
  });

  it('sends a message and verifies the provider-returned message identifier', async () => {
    const transport = new FixtureTransport(() => ({
      status: 200,
      body: { ok: true, ts: '1680000000.000100', channel: 'C1' },
    }));
    const connector = new SlackConnector({ token: 'test-token', transport });
    const result = await connector
      .resolveTool('slack.messages.send')!
      .execute(
        { channel: 'C1', text: 'Payments bug', token: 'xoxb-forged', workspaceId: 'wsp_alien' },
        TRUSTED_CONTEXT,
      );
    expect(result.ok).toBe(true);
    expect(result.output?.message).toMatchObject({ ts: '1680000000.000100', channel: 'C1' });
    // Forged credential/scope fields are never part of the request body.
    const sentBody = transport.calls[0]?.body as Record<string, unknown>;
    expect(sentBody).toEqual({ channel: 'C1', text: 'Payments bug' });
    expect(sentBody).not.toHaveProperty('token');
    expect(sentBody).not.toHaveProperty('workspaceId');
  });

  it('reports verification_failed when the provider omits the message identifier', async () => {
    const transport = new FixtureTransport(() => ({ status: 200, body: { ok: true } }));
    const connector = new SlackConnector({ token: 'test-token', transport });
    const result = await connector
      .resolveTool('slack.messages.send')!
      .execute({ channel: 'C1', text: 'hi' }, TRUSTED_CONTEXT);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VERIFICATION_FAILED');
  });

  it('maps Slack API-level failures ({ok:false}) to stable codes', async () => {
    const cases: Array<{ error: string; code: string }> = [
      { error: 'invalid_auth', code: 'PROVIDER_AUTH_FAILED' },
      { error: 'channel_not_found', code: 'PROVIDER_NOT_FOUND' },
      { error: 'missing_scope', code: 'PROVIDER_PERMISSION_DENIED' },
      { error: 'ratelimited', code: 'PROVIDER_RATE_LIMITED' },
      { error: 'unknown_error', code: 'PROVIDER_UNAVAILABLE' },
    ];
    for (const testCase of cases) {
      const transport = new FixtureTransport(() => ({
        status: 200,
        body: { ok: false, error: testCase.error },
      }));
      const connector = new SlackConnector({ token: 'test-token', transport });
      const result = await connector
        .resolveTool('slack.messages.send')!
        .execute({ channel: 'C1', text: 'hi' }, TRUSTED_CONTEXT);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(testCase.code);
    }
  });
});
