/**
 * @nexora/application-workspaces — first-party marketplace catalog.
 *
 * S19 dogfooding (ADR-003, BKD §10.1): the 4 MVP apps (HR, Projects,
 * Documents, Knowledge Base) are in-process modules but declare the SAME
 * frozen `PluginManifest` contract as third-party plugins. The catalog is
 * the marketplace listing source for first-party apps — installing an app
 * resolves its manifest here, reviews its declared permissions, and records
 * a `WorkspaceInstallation`. Third-party publishing (Phase 2) replaces the
 * catalog source, not the contract (BKD §10.3).
 *
 * The manifest contract lives in `@nexora/contracts/plugin` and is never
 * redefined here.
 */

import type { PluginManifest, MarketplaceMetadata } from '@nexora/contracts/plugin';

/** The platform API version the first-party apps are built against. */
const PLATFORM_API_VERSION = '1.0.0';
/** The Plugin SDK version the manifests are authored with. */
const SDK_VERSION = '0.1.0';
/** The current version of every first-party MVP app (v1 slice). */
const APP_VERSION = '1.0.0';

/** Common marketplace metadata for the Nexora first-party apps. */
function nexoraMarketplace(
  summary: string,
  description: string,
  categories: readonly string[],
): MarketplaceMetadata {
  return {
    publisher: 'Nexora',
    publisherId: 'com.nexora',
    summary,
    description,
    categories,
    installCount: 0,
  };
}

/**
 * The first-party app manifests — one canonical `PluginManifest` per MVP
 * app. Permissions declare what the app requires and grants (the install-time
 * permission review, PRD §20.2); navigation mirrors the shell sidebar
 * (FRONTEND.md §7).
 */
export const FIRST_PARTY_APP_MANIFESTS: readonly PluginManifest[] = [
  {
    id: 'com.nexora.hr',
    name: 'HR',
    version: APP_VERSION,
    capabilities: [
      {
        id: 'hr.create_employee',
        description: 'Creates an employee record and walks it through onboarding.',
        skillId: 'hr.create_employee',
      },
      {
        id: 'hr.hire_and_assign',
        description: 'Hires an employee and assigns them to a project.',
        skillId: 'hr.hire_and_assign',
      },
    ],
    permissions: {
      required: ['hr:read'],
      granted: ['hr:read', 'hr:write'],
    },
    events: {
      emits: ['employee.created', 'employee.updated'],
      subscribes: ['workflow.completed', 'workspace.member_added'],
    },
    navigation: [{ id: 'employees', label: 'Employees', icon: '⚕' }],
    compatibility: {
      platformApiVersion: PLATFORM_API_VERSION,
      sdkVersion: SDK_VERSION,
    },
    marketplace: nexoraMarketplace(
      'Employee records, hire, onboarding, and leave',
      'The HR app manages employee records, hires, onboarding checklists, leave, and the org chart baseline.',
      ['hr', 'people'],
    ),
  },
  {
    id: 'com.nexora.projects',
    name: 'Projects',
    version: APP_VERSION,
    capabilities: [
      {
        id: 'projects.create_project',
        description: 'Creates a project and assigns team members.',
        skillId: 'projects.create_project',
      },
      {
        id: 'projects.assign_employee',
        description: 'Assigns an employee to a project with a role.',
        skillId: 'projects.assign_employee',
      },
    ],
    permissions: {
      required: ['projects:read'],
      granted: ['projects:read', 'projects:write'],
    },
    events: {
      emits: ['project.created', 'project.updated'],
      subscribes: ['employee.created', 'workflow.completed'],
    },
    navigation: [{ id: 'projects', label: 'Projects', icon: '▤' }],
    compatibility: {
      platformApiVersion: PLATFORM_API_VERSION,
      sdkVersion: SDK_VERSION,
    },
    marketplace: nexoraMarketplace(
      'Projects, tasks, milestones, and resource assignment',
      'The Projects app manages projects, tasks, milestones, resource assignment, and capacity.',
      ['projects', 'productivity'],
    ),
  },
  {
    id: 'com.nexora.documents',
    name: 'Documents',
    version: APP_VERSION,
    capabilities: [
      {
        id: 'documents.upload',
        description: 'Uploads a document and indexes it for retrieval.',
        skillId: 'documents.upload',
      },
    ],
    permissions: {
      required: ['documents:read'],
      granted: ['documents:read', 'documents:write'],
    },
    events: {
      emits: ['document.uploaded', 'document.available', 'document.version_uploaded'],
      subscribes: ['workflow.completed'],
    },
    navigation: [{ id: 'documents', label: 'Documents', icon: '▤' }],
    compatibility: {
      platformApiVersion: PLATFORM_API_VERSION,
      sdkVersion: SDK_VERSION,
    },
    marketplace: nexoraMarketplace(
      'Document storage, versioning, templates, and RAG indexing',
      'The Documents app provides durable storage, version history, restore, templates, and indexing for retrieval.',
      ['documents', 'files'],
    ),
  },
  {
    id: 'com.nexora.knowledge',
    name: 'Knowledge Base',
    version: APP_VERSION,
    capabilities: [
      {
        id: 'knowledge.search',
        description: 'Searches the documents and published articles of the workspace.',
        skillId: 'knowledge.search',
      },
    ],
    permissions: {
      required: ['knowledge:read'],
      granted: ['knowledge:read', 'knowledge:write'],
    },
    events: {
      emits: ['knowledge.article.published', 'knowledge.article.archived'],
      subscribes: ['document.available', 'workspace.plugin_installed'],
    },
    navigation: [{ id: 'knowledge', label: 'Knowledge', icon: '📚' }],
    compatibility: {
      platformApiVersion: PLATFORM_API_VERSION,
      sdkVersion: SDK_VERSION,
    },
    marketplace: nexoraMarketplace(
      'Knowledge base articles, categories, and RAG answers',
      'The Knowledge Base app provides articles, categories, publish/archive lifecycle, and permission-filtered RAG answers.',
      ['knowledge', 'docs'],
    ),
  },
];

/**
 * The marketplace catalog: the listing + resolution source for install,
 * update, and permission review. Resolving an unknown app id returns
 * `undefined` (the caller maps it to a 404 — never a cross-tenant leak).
 */
export class AppCatalog {
  readonly #apps: readonly PluginManifest[];

  constructor(apps: readonly PluginManifest[] = FIRST_PARTY_APP_MANIFESTS) {
    this.#apps = apps;
  }

  /** All apps in the catalog, in marketplace order. */
  list(): readonly PluginManifest[] {
    return this.#apps;
  }

  /** Resolves an app by its manifest id, or `undefined`. */
  resolve(appId: string): PluginManifest | undefined {
    return this.#apps.find((app) => app.id === appId);
  }
}
