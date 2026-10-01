/**
 * The GitHub connector builds `/repos/{owner}/{repo}/…` from tool arguments.
 * `encodeURIComponent('..')` is `..`, which the URL parser collapses
 * (`/repos/../user` → `/user`), so a dot-segment name would redirect the
 * tenant's token to another provider path. The tool schemas must refuse it
 * before any request is built.
 */

import { describe, expect, it } from 'vitest';
import type { ConnectorHttpRequest, ConnectorHttpTransport } from '@nexora/connectors';

import { GitHubConnector } from '../src/ai/connectors/github-connector.js';

const requests: ConnectorHttpRequest[] = [];
const transport: ConnectorHttpTransport = {
  async request(request) {
    requests.push(request);
    return { status: 200, body: {} };
  },
};

/** The schema keywords this test needs: JSON-schema `pattern` + `minLength`/`maxLength`. */
function compile(schema: unknown): (value: Record<string, unknown>) => boolean {
  const properties = (schema as { properties: Record<string, Record<string, unknown>> }).properties;
  return (value) =>
    ['owner', 'repo'].every((key) => {
      const rule = properties[key]!;
      const text = value[key];
      return (
        typeof text === 'string' &&
        text.length >= (rule['minLength'] as number) &&
        text.length <= (rule['maxLength'] as number) &&
        new RegExp(rule['pattern'] as string).test(text)
      );
    });
}

const connector = new GitHubConnector({ token: 'test-token', transport });
const repoTools = connector.tools.filter((tool) =>
  ['github.repositories.get', 'github.issues.list', 'github.issues.create'].includes(tool.id),
);

describe('GitHub connector — owner / repo path segments', () => {
  it('covers the three repository-scoped tools', () => {
    expect(repoTools.map((tool) => tool.id).sort()).toEqual([
      'github.issues.create',
      'github.issues.list',
      'github.repositories.get',
    ]);
  });

  for (const tool of repoTools) {
    const validate = compile(tool.inputSchema);
    const base = tool.id === 'github.issues.create' ? { title: 'a title' } : {};

    it(`${tool.id}: rejects dot segments and path characters in owner and repo`, () => {
      for (const bad of ['..', '.', '', 'a/b', 'a b', '../x', 'a?b', 'a#b', 'a%2e', 'a\\b']) {
        expect(
          validate({ ...base, owner: bad, repo: 'repo' }),
          `owner ${JSON.stringify(bad)}`,
        ).toBe(false);
        expect(
          validate({ ...base, owner: 'owner', repo: bad }),
          `repo ${JSON.stringify(bad)}`,
        ).toBe(false);
      }
    });

    it(`${tool.id}: still accepts ordinary names (dots, dashes, underscores inside)`, () => {
      for (const good of ['octocat', 'my-org', 'repo.js', 'a_b', '.github', 'a..b']) {
        expect(validate({ ...base, owner: good, repo: good }), good).toBe(true);
      }
    });
  }
});
