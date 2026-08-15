/**
 * @nexora/ai-runtime — discovery tests.
 */

import { describe, expect, it } from 'vitest';
import type { CapabilityDeclaration } from '@nexora/contracts/ai';

import { CapabilityMatcher, tokenize } from '../src/discovery/capability-matcher.js';
import { CapabilityResolver } from '../src/discovery/capability-resolver.js';
import { CapabilityDiscovery } from '../src/discovery/capability-discovery.js';
import { RuntimeRegistry, registryEntries } from '../src/registry/runtime-registry.js';
import { SkillIndex } from '../src/registry/skill-index.js';
import type { PermissionContext } from '../src/context/index.js';

const supervised: PermissionContext = { userId: 'u1', autonomyTier: 'supervised' };

const createProject: CapabilityDeclaration = {
  id: 'projects.create_project',
  name: 'Create project',
  description: 'Creates a new project',
  skillId: 'projects.create',
  sideEffectClass: 'state_change',
};

const closeSprint: CapabilityDeclaration = {
  id: 'projects.close_sprint',
  name: 'Close sprint',
  description: 'Closes the current sprint',
  skillId: 'projects.close',
  sideEffectClass: 'consequential',
};

function buildDiscovery() {
  const registry = new RuntimeRegistry();
  const skills = new SkillIndex();
  registry.register(
    registryEntries.capability({
      capability: createProject,
      owner: 'com.nexora.projects',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.capability({
      capability: closeSprint,
      owner: 'com.nexora.projects',
      version: '1.0.0',
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: {
        id: 'tool_create_project',
        description: 'creates',
        sideEffectClass: 'state_change',
        idempotent: false,
        timeoutMs: 1000,
        inputSchema: {},
      },
      owner: 'com.nexora.projects',
      version: '1.0.0',
      ownedByAgents: ['agt_projects'],
    }),
  );
  registry.register(
    registryEntries.tool({
      tool: {
        id: 'tool_close_sprint',
        description: 'closes',
        sideEffectClass: 'consequential',
        idempotent: false,
        timeoutMs: 1000,
        inputSchema: {},
      },
      owner: 'com.nexora.projects',
      version: '1.0.0',
      ownedByAgents: ['agt_projects'],
    }),
  );
  registry.register(
    registryEntries.agent({
      agent: { id: 'agt_projects', name: 'projects', displayName: 'Projects Agent' },
      manifest: {
        identity: { id: 'agt_projects', name: 'projects', displayName: 'Projects Agent' },
        version: '1.0.0',
        skills: [
          {
            id: 'projects.create',
            description: 'creates',
            toolIds: ['tool_create_project'],
            autonomyTier: 'supervised',
            requiresApproval: false,
          },
          {
            id: 'projects.close',
            description: 'closes',
            toolIds: ['tool_close_sprint'],
            autonomyTier: 'supervised',
            requiresApproval: true,
          },
        ],
        tools: [],
        knowledgeScopes: [],
        policyIds: [],
        emittedEventTypes: [],
        subscribedEventTypes: [],
        updatedAt: '2026-08-08T00:00:00.000Z',
      },
      health: 'healthy',
      owner: 'com.nexora.projects',
      version: '1.0.0',
    }),
  );
  skills.index(
    {
      id: 'projects.create',
      description: 'creates',
      toolIds: ['tool_create_project'],
      autonomyTier: 'supervised',
      requiresApproval: false,
    },
    'agt_projects',
  );
  skills.index(
    {
      id: 'projects.close',
      description: 'closes',
      toolIds: ['tool_close_sprint'],
      autonomyTier: 'supervised',
      requiresApproval: true,
    },
    'agt_projects',
  );
  return { registry, skills };
}

describe('tokenize', () => {
  it('splits and deduplicates tokens', () => {
    expect(tokenize('Create a New Project!')).toEqual(['create', 'new', 'project']);
  });
});

describe('CapabilityMatcher', () => {
  it('ranks matching capabilities above non-matching', () => {
    const matcher = new CapabilityMatcher();
    const scores = matcher.match('create a project', [createProject, closeSprint]);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0]?.capabilityId).toBe('projects.create_project');
  });

  it('returns empty when nothing matches', () => {
    const matcher = new CapabilityMatcher({ minScore: 0.2 });
    const scores = matcher.match('unrelated request', [createProject]);
    expect(scores).toHaveLength(0);
  });

  it('requires the capability name’s entity noun in the intent (no phantom cross-entity matches)', () => {
    const matcher = new CapabilityMatcher();
    const createWorkspace: CapabilityDeclaration = {
      id: 'workspaces.create_workspace',
      name: 'Create workspace',
      description: 'Creates a new workspace in the current organization',
      skillId: 'workspaces.create',
      sideEffectClass: 'consequential',
    };
    // "Create a project…" shares the verb `create` but NOT the noun
    // `workspace` — it must not match the workspace capability, otherwise
    // the plan gains a phantom gated step that can never be approved.
    const projectScores = matcher.match('Create a project called Mobile Banking', [
      createProject,
      createWorkspace,
    ]);
    expect(projectScores.map((score) => score.capabilityId)).toEqual(['projects.create_project']);

    const workspaceScores = matcher.match('Create a workspace called Engineering', [
      createProject,
      createWorkspace,
    ]);
    expect(workspaceScores.map((score) => score.capabilityId)).toEqual([
      'workspaces.create_workspace',
    ]);
  });

  it('disambiguates shared nouns by verb evidence (no phantom assignment/create cross-match)', () => {
    const matcher = new CapabilityMatcher();
    const assignEmployee: CapabilityDeclaration = {
      id: 'projects.assign_employee',
      name: 'Assign employee to project',
      description: 'Assigns an employee to a project in the current organization',
      skillId: 'projects.assign',
      sideEffectClass: 'consequential',
    };
    const findProject: CapabilityDeclaration = {
      id: 'projects.find_project',
      name: 'Find project',
      description: 'Finds a project in the current organization',
      skillId: 'projects.find',
      sideEffectClass: 'read_only',
    };
    // "Assign Sarah to the Mobile Banking project" evidences the noun
    // `project`, which is SHARED with create/find — only the capability
    // whose verb (`assign`) is evidenced may match; create/find must not
    // produce phantom steps.
    const assignScores = matcher.match('Assign Sarah to the Mobile Banking project', [
      createProject,
      assignEmployee,
      findProject,
    ]);
    expect(assignScores.map((score) => score.capabilityId)).toEqual(['projects.assign_employee']);

    // A unique-noun capability needs no verb evidence ("What workspaces do
    // I have?" matches "List workspaces" without the word "list").
    const listWorkspaces: CapabilityDeclaration = {
      id: 'workspaces.list_workspaces',
      name: 'List workspaces',
      description: 'Lists the workspaces available to the current user',
      skillId: 'workspaces.list',
      sideEffectClass: 'read_only',
    };
    const listScores = matcher.match('What workspaces do I have?', [listWorkspaces]);
    expect(listScores.map((score) => score.capabilityId)).toEqual(['workspaces.list_workspaces']);
  });

  it('respects minScore and maxResults', () => {
    const matcher = new CapabilityMatcher({ minScore: 1, maxResults: 1 });
    const scores = matcher.match('create project', [createProject]);
    expect(scores.length).toBeLessThanOrEqual(1);
  });
});

describe('CapabilityResolver', () => {
  it('resolves a capability to its skill and tools', () => {
    const { registry, skills } = buildDiscovery();
    const resolver = new CapabilityResolver(registry, skills);
    const resolved = resolver.resolve('projects.create_project');
    expect(resolved.skill?.id).toBe('projects.create');
    expect(resolved.tools.map((t) => t.id)).toContain('tool_create_project');
  });

  it('throws for unknown capabilities', () => {
    const { registry, skills } = buildDiscovery();
    const resolver = new CapabilityResolver(registry, skills);
    expect(() => resolver.resolve('unknown.capability')).toThrow();
  });
});

describe('CapabilityDiscovery', () => {
  it('discovers and assembles a permission-filtered outcome', () => {
    const { registry, skills } = buildDiscovery();
    const discovery = new CapabilityDiscovery(registry, skills);
    const outcome = discovery.discover({
      intent: 'create a project',
      permissions: supervised,
    });
    expect(outcome.capabilities.map((c) => c.id)).toContain('projects.create_project');
    expect(outcome.skills.length).toBeGreaterThan(0);
    expect(outcome.tools.length).toBeGreaterThan(0);
    expect(outcome.agents.length).toBeGreaterThan(0);
  });

  it('honors the capability allow-list', () => {
    const { registry, skills } = buildDiscovery();
    const discovery = new CapabilityDiscovery(registry, skills);
    const outcome = discovery.discover({
      intent: 'close the sprint',
      permissions: supervised,
      allowedCapabilityIds: ['projects.close_sprint'],
    });
    expect(outcome.capabilities.map((c) => c.id)).toEqual(['projects.close_sprint']);
  });

  it('returns empty results (not an error) when nothing matches', () => {
    const { registry, skills } = buildDiscovery();
    const discovery = new CapabilityDiscovery(registry, skills);
    const outcome = discovery.discover({
      intent: 'nothing relevant here',
      permissions: supervised,
    });
    expect(outcome.capabilities).toHaveLength(0);
    expect(outcome.scores).toHaveLength(0);
  });

  it('rank exposes the scored matches for observability', () => {
    const { registry, skills } = buildDiscovery();
    const discovery = new CapabilityDiscovery(registry, skills);
    const scores = discovery.rank({ intent: 'close the sprint', permissions: supervised });
    expect(scores[0]?.capabilityId).toBe('projects.close_sprint');
  });
});

describe('CapabilityDiscovery — role-aware focus (S24 Phase 3)', () => {
  const { registry, skills } = buildDiscovery();
  const discovery = new CapabilityDiscovery(registry, skills);

  it('narrows the candidate set to the business context capability affinities', () => {
    const outcome = discovery.discover({
      // The intent matches close-sprint better in the full registry, but the
      // role's affinity excludes it — discovery must surface only what the
      // trusted business context says the user's work is about.
      intent: 'create a project',
      permissions: supervised,
      businessContext: {
        domainId: 'technology',
        roleId: 'technology.developer',
        capabilityIds: ['projects.create_project'],
      },
    });
    expect(outcome.capabilities.map((c) => c.id)).toEqual(['projects.create_project']);
    expect(outcome.tools.map((t) => t.id)).toEqual(['tool_create_project']);
  });

  it('keeps only capabilities that are both in the affinity AND match the intent', () => {
    const outcome = discovery.discover({
      intent: 'close the sprint',
      permissions: supervised,
      businessContext: {
        domainId: 'technology',
        roleId: 'technology.developer',
        capabilityIds: ['projects.close_sprint', 'projects.create_project'],
      },
    });
    // Both are in the affinity, but only close-sprint matches the intent.
    expect(outcome.capabilities.map((c) => c.id)).toEqual(['projects.close_sprint']);
  });

  it('ignores unknown affinity ids safely (never an error, never a match)', () => {
    const outcome = discovery.discover({
      intent: 'close the sprint',
      permissions: supervised,
      businessContext: {
        domainId: 'legal',
        roleId: 'legal.general_counsel',
        capabilityIds: ['legal.contracts.read', 'unknown.capability'],
      },
    });
    expect(outcome.capabilities).toHaveLength(0);
    expect(outcome.scores).toHaveLength(0);
  });

  it('falls back to unrestricted discovery when no affinity is present', () => {
    const outcome = discovery.discover({
      intent: 'close the sprint',
      permissions: supervised,
      businessContext: undefined,
    });
    expect(outcome.capabilities.map((c) => c.id)).toContain('projects.close_sprint');
  });

  it('an empty affinity set means no focus — unrestricted discovery applies', () => {
    const outcome = discovery.discover({
      intent: 'close the sprint',
      permissions: supervised,
      businessContext: {
        domainId: 'finance',
        roleId: 'finance.cfo',
        capabilityIds: [],
      },
    });
    expect(outcome.capabilities.map((c) => c.id)).toContain('projects.close_sprint');
  });

  it('a broad affinity cannot widen past the permission allow-list (allowedActions is the ceiling)', () => {
    // A role claiming a broad affinity cannot surface a capability the
    // runtime's allowedActions do not permit: candidates are the
    // intersection of permissions and affinity, never the affinity alone.
    const outcome = discovery.discover({
      intent: 'close the sprint',
      permissions: { ...supervised, allowedActions: ['projects.close_sprint'] },
      businessContext: {
        domainId: 'executive',
        roleId: 'executive.ceo',
        capabilityIds: ['projects.create_project', 'projects.close_sprint'],
      },
    });
    expect(outcome.capabilities.map((c) => c.id)).toEqual(['projects.close_sprint']);
  });
});
