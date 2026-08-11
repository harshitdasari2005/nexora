/**
 * Workspace value object tests: WorkspaceId, WorkspaceName, WorkspaceSlug,
 * WorkspaceStatus, WorkspaceVisibility, WorkspaceType, WorkspaceColor,
 * WorkspaceIcon, WorkspaceTimeZone, WorkspaceLocale, MembershipRole.
 */

import { describe, expect, it } from 'vitest';

import { InvalidWorkspaceValueError } from '../src/errors/index.js';
import { WorkspaceId } from '../src/value-objects/workspace-id.js';
import { MAX_WORKSPACE_NAME_LENGTH, WorkspaceName } from '../src/value-objects/workspace-name.js';
import {
  MAX_SLUG_LENGTH,
  MIN_SLUG_LENGTH,
  WorkspaceSlug,
} from '../src/value-objects/workspace-slug.js';
import { WORKSPACE_STATUSES, WorkspaceStatus } from '../src/value-objects/workspace-status.js';
import {
  WORKSPACE_VISIBILITIES,
  WorkspaceVisibility,
} from '../src/value-objects/workspace-visibility.js';
import { WORKSPACE_TYPES, WorkspaceType } from '../src/value-objects/workspace-type.js';
import { WorkspaceColor } from '../src/value-objects/workspace-color.js';
import { MAX_ICON_LENGTH, WorkspaceIcon } from '../src/value-objects/workspace-icon.js';
import {
  MAX_TIME_ZONE_LENGTH,
  WorkspaceTimeZone,
} from '../src/value-objects/workspace-time-zone.js';
import { WorkspaceLocale } from '../src/value-objects/workspace-locale.js';
import { MEMBERSHIP_ROLES } from '../src/value-objects/membership-role.js';

describe('WorkspaceId', () => {
  it('creates unique prefixed ids', () => {
    const first = WorkspaceId.create();
    const second = WorkspaceId.create();
    expect(first).toMatch(/^wsp_/);
    expect(first).not.toBe(second);
  });

  it('reconstructs a stored id', () => {
    const created = WorkspaceId.create();
    expect(WorkspaceId.from(created)).toBe(created);
  });

  it('rejects a malformed id', () => {
    expect(() => WorkspaceId.from('tenant_1')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceId.from('wsp_short')).toThrow(InvalidWorkspaceValueError);
  });
});

describe('WorkspaceName', () => {
  it('creates and trims a valid name', () => {
    expect(WorkspaceName.create('  Engineering  ').value).toBe('Engineering');
  });

  it('compares by value', () => {
    expect(WorkspaceName.create('Eng').equals(WorkspaceName.create('Eng'))).toBe(true);
    expect(WorkspaceName.create('Eng').equals(WorkspaceName.create('Sales'))).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(() => WorkspaceName.create('   ')).toThrow(InvalidWorkspaceValueError);
  });

  it('rejects an over-long name', () => {
    expect(() => WorkspaceName.create('x'.repeat(MAX_WORKSPACE_NAME_LENGTH + 1))).toThrow(
      InvalidWorkspaceValueError,
    );
  });
});

describe('WorkspaceSlug', () => {
  it('creates and normalizes a valid slug', () => {
    expect(WorkspaceSlug.create('  Engineering  ').value).toBe('engineering');
  });

  it('accepts digits and multiple dashes', () => {
    expect(WorkspaceSlug.create('europe-eng-2026').value).toBe('europe-eng-2026');
  });

  it('rejects empty, short, and long slugs', () => {
    expect(() => WorkspaceSlug.create('')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceSlug.create('ab')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceSlug.create('a'.repeat(MAX_SLUG_LENGTH + 1))).toThrow(
      InvalidWorkspaceValueError,
    );
  });

  it('rejects uppercase, spaces, and symbols', () => {
    expect(() => WorkspaceSlug.create('Engineering Room')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceSlug.create('engineering_room')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceSlug.create('-eng')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceSlug.create('eng-')).toThrow(InvalidWorkspaceValueError);
  });

  it('accepts the exact minimum and maximum lengths', () => {
    expect(WorkspaceSlug.create('a'.repeat(MIN_SLUG_LENGTH)).value).toHaveLength(MIN_SLUG_LENGTH);
    expect(WorkspaceSlug.create('a'.repeat(MAX_SLUG_LENGTH)).value).toHaveLength(MAX_SLUG_LENGTH);
  });
});

describe('WorkspaceStatus', () => {
  it('exposes all lifecycle statuses', () => {
    expect(WORKSPACE_STATUSES).toEqual(['provisioning', 'active', 'suspended', 'archived']);
    expect(WorkspaceStatus.provisioning().value).toBe('provisioning');
    expect(WorkspaceStatus.active().value).toBe('active');
    expect(WorkspaceStatus.suspended().value).toBe('suspended');
    expect(WorkspaceStatus.archived().value).toBe('archived');
  });

  it('is active only for the active status', () => {
    expect(WorkspaceStatus.active().isActive()).toBe(true);
    expect(WorkspaceStatus.provisioning().isActive()).toBe(false);
    expect(WorkspaceStatus.suspended().isActive()).toBe(false);
    expect(WorkspaceStatus.archived().isActive()).toBe(false);
  });

  it('parses valid status strings and rejects unknown ones', () => {
    for (const status of WORKSPACE_STATUSES) {
      expect(WorkspaceStatus.from(status).value).toBe(status);
    }
    expect(() => WorkspaceStatus.from('deleted')).toThrow(InvalidWorkspaceValueError);
  });
});

describe('WorkspaceVisibility', () => {
  it('exposes both scopes', () => {
    expect(WORKSPACE_VISIBILITIES).toEqual(['private', 'company']);
    expect(WorkspaceVisibility.private().value).toBe('private');
    expect(WorkspaceVisibility.company().value).toBe('company');
  });

  it('isPrivate only for private', () => {
    expect(WorkspaceVisibility.private().isPrivate()).toBe(true);
    expect(WorkspaceVisibility.company().isPrivate()).toBe(false);
  });

  it('rejects an unknown scope', () => {
    expect(() => WorkspaceVisibility.from('public')).toThrow(InvalidWorkspaceValueError);
  });
});

describe('WorkspaceType', () => {
  it('exposes all template types', () => {
    expect(WORKSPACE_TYPES).toContain('operations');
    expect(WORKSPACE_TYPES).toContain('engineering');
    expect(WORKSPACE_TYPES).toContain('hr');
    expect(WORKSPACE_TYPES).toContain('finance');
    expect(WORKSPACE_TYPES).toContain('sales');
    expect(WorkspaceType.operations().value).toBe('operations');
    expect(WorkspaceType.engineering().value).toBe('engineering');
    expect(WorkspaceType.general().value).toBe('general');
  });

  it('parses valid types and rejects unknown ones', () => {
    for (const type of WORKSPACE_TYPES) {
      expect(WorkspaceType.from(type).value).toBe(type);
    }
    expect(() => WorkspaceType.from('legal')).toThrow(InvalidWorkspaceValueError);
  });
});

describe('WorkspaceColor', () => {
  it('normalizes hex colors to lowercase', () => {
    expect(WorkspaceColor.create('#4F46E5').value).toBe('#4f46e5');
  });

  it('rejects invalid colors', () => {
    expect(() => WorkspaceColor.create('blue')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceColor.create('#fff')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceColor.create('#gggggg')).toThrow(InvalidWorkspaceValueError);
  });
});

describe('WorkspaceIcon', () => {
  it('accepts emoji and short keys', () => {
    expect(WorkspaceIcon.create('🧭').value).toBe('🧭');
    expect(WorkspaceIcon.create('rocket').value).toBe('rocket');
  });

  it('rejects empty, over-long, and whitespace icons', () => {
    expect(() => WorkspaceIcon.create('')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceIcon.create('a'.repeat(MAX_ICON_LENGTH + 1))).toThrow(
      InvalidWorkspaceValueError,
    );
    expect(() => WorkspaceIcon.create('rocket ship')).toThrow(InvalidWorkspaceValueError);
  });
});

describe('WorkspaceTimeZone', () => {
  it('accepts IANA names', () => {
    expect(WorkspaceTimeZone.create('UTC').value).toBe('UTC');
    expect(WorkspaceTimeZone.create('Europe/Berlin').value).toBe('Europe/Berlin');
  });

  it('rejects empty and over-long names', () => {
    expect(() => WorkspaceTimeZone.create('   ')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceTimeZone.create('x'.repeat(MAX_TIME_ZONE_LENGTH + 1))).toThrow(
      InvalidWorkspaceValueError,
    );
  });
});

describe('WorkspaceLocale', () => {
  it('accepts language tags', () => {
    expect(WorkspaceLocale.create('en').value).toBe('en');
    expect(WorkspaceLocale.create('en-US').value).toBe('en-US');
  });

  it('rejects invalid tags', () => {
    expect(() => WorkspaceLocale.create('english')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceLocale.create('en-us')).toThrow(InvalidWorkspaceValueError);
    expect(() => WorkspaceLocale.create('')).toThrow(InvalidWorkspaceValueError);
  });
});

describe('MembershipRole', () => {
  it('exposes the role vocabulary', () => {
    expect(MEMBERSHIP_ROLES).toEqual(['owner', 'admin', 'member']);
  });
});
