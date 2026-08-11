/**
 * Manifest module tests: the SDK manifest wrapper, metadata, and canonical
 * derivation.
 */

import { describe, expect, it } from 'vitest';

import { PLUGIN_LIFECYCLE_STATES, type PluginManifest } from '@nexora/contracts/plugin';

import {
  toCanonicalManifest,
  type PluginMetadata,
  type SdkPluginManifest,
} from '../src/manifest/index.js';
import { testPluginManifest } from '../src/testing/index.js';

describe('SdkPluginManifest', () => {
  it('wraps the canonical manifest with metadata', () => {
    const metadata: PluginMetadata = {
      author: 'Nexora',
      license: 'Apache-2.0',
      description: 'The Projects app',
      homepage: 'https://nexora.com/projects',
      keywords: ['projects', 'work'],
    };
    const authored: SdkPluginManifest = {
      manifest: testPluginManifest(),
      metadata,
    };
    expect(authored.manifest.id).toBe('com.nexora.test');
    expect(authored.metadata?.author).toBe('Nexora');
  });

  it('toCanonicalManifest returns the canonical contract shape', () => {
    const manifest = testPluginManifest({ version: '3.0.0' });
    const canonical = toCanonicalManifest({ manifest });
    const check: PluginManifest = canonical;
    expect(check.version).toBe('3.0.0');
  });

  it('carries settings and feature flags on the authored manifest', () => {
    const authored: SdkPluginManifest = {
      manifest: testPluginManifest(),
      settings: { defaultView: 'board' },
      featureFlags: [
        { name: 'beta.auto_archive', description: 'Auto-archive', defaultEnabled: false },
      ],
    };
    expect(authored.settings).toEqual({ defaultView: 'board' });
    expect(authored.featureFlags?.[0]).toMatchObject({
      name: 'beta.auto_archive',
      defaultEnabled: false,
    });
  });

  it('keeps canonical lifecycle states available', () => {
    expect(PLUGIN_LIFECYCLE_STATES).toContain('installed');
    expect(PLUGIN_LIFECYCLE_STATES).toContain('active');
    expect(PLUGIN_LIFECYCLE_STATES).toContain('uninstalled');
  });
});
