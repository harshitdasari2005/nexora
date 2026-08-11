# Plugin Developer Guide

How to build a Nexora plugin end-to-end with `@nexora/plugin-sdk`.

## 1. Declare the manifest

Use `PluginManifestBuilder` — it produces the canonical `PluginManifest`:

```ts
import { PluginManifestBuilder } from '@nexora/plugin-sdk/builders';

const manifest = new PluginManifestBuilder('com.nexora.projects', 'Projects', '1.0.0')
  .withCapability({
    id: 'projects.create_project',
    description: 'Create a project and assign it to a workspace',
    skillId: 'skills.create_project',
  })
  .requires('projects:read') // install-time permission review
  .grants('projects:write')
  .emits('project.created') // events the plugin publishes
  .subscribes('employee.hired') // events the plugin handles
  .dependsOn({ id: 'com.nexora.identity', range: '^1.0.0' })
  .withNavigation('projects', 'Projects', 'folder')
  .build();
```

## 2. Extend `BasePlugin`

```ts
import { BasePlugin, type PluginContext } from '@nexora/plugin-sdk/base';
import {
  NavigationBuilder,
  CommandBuilder,
  PageBuilder,
  WidgetBuilder,
} from '@nexora/plugin-sdk/builders';

export class ProjectsPlugin extends BasePlugin {
  constructor() {
    super({ manifest });
  }

  async activate(context: PluginContext): Promise<void> {
    // Shell surfaces (declarative — the frontend resolves component ids).
    this.registerNavigation(
      new NavigationBuilder()
        .ownedBy('com.nexora.projects')
        .addSidebarItem({ id: 'projects', label: 'Projects', route: '/projects' })
        .addPaletteItem({
          id: 'pal.new-project',
          keywords: ['new', 'project'],
          action: 'projects.new',
        })
        .build(),
    );
    this.registerPage(
      new PageBuilder(
        'com.nexora.projects.overview',
        'Overview',
        'cmp.project-overview',
        '/projects',
      )
        .requiresScope('projects:read')
        .build(),
    );
    this.registerWidget(
      new WidgetBuilder('com.nexora.projects.active', 'Active Projects', {
        kind: 'metric',
        label: 'Active',
        sourceKey: 'projects.active',
      })
        .refreshEvery(30_000)
        .build(),
    );

    // Commands (also available to AI when exposeToAi is set).
    this.registerCommand(
      new CommandBuilder(
        {
          id: 'projects.new',
          name: 'New Project',
          description: 'Create a project',
          keywords: ['new'],
        },
        async ({ args }) => ({ created: args[0] }),
      )
        .exposeToAi()
        .build(),
    );
  }

  // Lifecycle hooks (optional).
  override onInstall(ctx: PluginHookContext): void {
    ctx.configuration.set('installedAt', ctx.timestamp);
  }
}
```

## 3. Contribute AI surfaces (AIR.md §3, §5)

```ts
import { applyAgentContributions, type AgentContribution } from '@nexora/plugin-sdk/agents';

// Inside activate:
this.registerAgent({
  kind: 'agent',
  id: 'agt_projects',
  agent: () => new ProjectsAgent(/* injected ports */),
});
this.registerSkill({
  kind: 'skill',
  id: 'skills.create_project',
  skill: {
    manifest: {/* Agent SDK SkillManifest */},
    execute: async (input) => ({ ok: true, output }),
  },
});
```

The platform calls `applyAgentContributions(agent, plugin.contributions.byKind('skill'|'tool'))` to wire the agent.

## 4. Subscribe to events

```ts
this.registerEvent({
  kind: 'event',
  emits: ['project.created'],
  subscriptions: [
    {
      eventType: 'employee.hired',
      awaitable: true,
      handler: async (event, { tenantId }) => {
        // create the project from the hire
      },
    },
  ],
});
```

## 5. Expose settings

```ts
this.registerConfiguration({
  kind: 'configuration',
  schema: {
    id: 'com.nexora.projects.settings',
    title: 'Projects Settings',
    properties: {
      defaultView: { type: 'enum', enum: ['board', 'list'], default: 'board' },
      autoArchive: { type: 'boolean', default: false },
    },
  },
  defaults: { defaultView: 'board', autoArchive: false },
});
// Read at runtime: this.configuration.get('defaultView')
```

## 6. Test the plugin

```ts
import { MockPlugin, fakePluginContext, testPluginManifest } from '@nexora/plugin-sdk/testing';

const plugin = new MockPlugin({ manifest: testPluginManifest() });
await plugin.activate(fakePluginContext());
expect(plugin.contributions.size).toBeGreaterThan(0);
```

For installer-level tests, use `DefaultPluginInstaller` with a `PluginRegistry` (see `test/installer.test.ts`).

## Rules of thumb

- **No business logic in the plugin shell** — delegate to domain application services via injected ports.
- **Never import a domain or platform module** — the SDK and your ports are the boundary.
- **Frontend surfaces are ids, not code** — components live in the host app.
- **Return failures as values** from handlers; throw only for unexpected errors.
