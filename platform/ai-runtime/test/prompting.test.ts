/**
 * @nexora/ai-runtime — prompting tests.
 */

import { describe, expect, it } from 'vitest';
import { isValidationError } from '@nexora/shared/errors';

import { createTemplate } from '../src/prompting/prompt-template.js';
import { PromptRegistry, compareVersions } from '../src/prompting/prompt-registry.js';
import { TemplateRenderer, passthroughRenderer } from '../src/prompting/prompt-renderer.js';
import { SystemPromptBuilder } from '../src/prompting/system-prompt-builder.js';

describe('createTemplate', () => {
  it('builds a template with default variables', () => {
    const template = createTemplate({ id: 't', version: '1.0.0', text: 'Hello {{name}}' });
    expect(template.variables).toEqual(['name']);
  });

  it('honors declared variables', () => {
    const template = createTemplate({
      id: 't',
      version: '1.0.0',
      text: '{{a}} and {{b}}',
      variables: ['a', 'b'],
    });
    expect(template.variables).toEqual(['a', 'b']);
  });
});

describe('PromptRegistry', () => {
  it('resolves the latest version', () => {
    const registry = new PromptRegistry();
    registry.register(createTemplate({ id: 't', version: '1.0.0', text: 'v1' }));
    registry.register(createTemplate({ id: 't', version: '1.2.0', text: 'v1.2' }));
    expect(registry.resolve('t').version).toBe('1.2.0');
  });

  it('resolves a pinned version', () => {
    const registry = new PromptRegistry();
    registry.register(createTemplate({ id: 't', version: '1.0.0', text: 'v1' }));
    expect(registry.resolve('t', '1.0.0').text).toBe('v1');
  });

  it('throws on duplicate id@version', () => {
    const registry = new PromptRegistry();
    registry.register(createTemplate({ id: 't', version: '1.0.0', text: 'v1' }));
    expect(() =>
      registry.register(createTemplate({ id: 't', version: '1.0.0', text: 'v1' })),
    ).toThrow(/already registered/);
  });

  it('throws for unknown ids and versions', () => {
    const registry = new PromptRegistry();
    expect(() => registry.resolve('missing')).toThrow();
    registry.register(createTemplate({ id: 't', version: '1.0.0', text: 'v1' }));
    expect(() => registry.resolve('t', '9.0.0')).toThrow();
  });

  it('lists ids and counts versions', () => {
    const registry = new PromptRegistry();
    registry.register(createTemplate({ id: 'a', version: '1.0.0', text: 'a' }));
    registry.register(createTemplate({ id: 'a', version: '1.1.0', text: 'a' }));
    registry.register(createTemplate({ id: 'b', version: '1.0.0', text: 'b' }));
    expect(registry.ids()).toEqual(['a', 'b']);
    expect(registry.size).toBe(3);
    expect(registry.versions('a')).toHaveLength(2);
  });
});

describe('compareVersions', () => {
  it('orders semvers', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

describe('TemplateRenderer', () => {
  it('renders declared variables', () => {
    const renderer = new TemplateRenderer();
    const template = createTemplate({ id: 't', version: '1.0.0', text: 'Hi {{name}}!' });
    expect(renderer.render(template, { name: 'Alice' })).toBe('Hi Alice!');
  });

  it('throws a ValidationError when a variable is missing', () => {
    const renderer = new TemplateRenderer();
    const template = createTemplate({ id: 't', version: '1.0.0', text: 'Hi {{name}}!' });
    try {
      renderer.render(template, {});
      expect.unreachable();
    } catch (error) {
      expect(isValidationError(error)).toBe(true);
      expect((error as { issues: readonly { path: string }[] }).issues[0]?.path).toBe('name');
    }
  });

  it('throws when an undeclared variable is passed', () => {
    const renderer = new TemplateRenderer();
    const template = createTemplate({ id: 't', version: '1.0.0', text: 'Hi' });
    try {
      renderer.render(template, { extra: 1 });
      expect.unreachable();
    } catch (error) {
      expect(isValidationError(error)).toBe(true);
      expect((error as { issues: readonly { path: string }[] }).issues[0]?.path).toBe('extra');
    }
  });

  it('stringifies complex values', () => {
    const renderer = new TemplateRenderer();
    const template = createTemplate({ id: 't', version: '1.0.0', text: '{{v}}', variables: ['v'] });
    expect(renderer.render(template, { v: { a: 1 } })).toBe('{"a":1}');
  });
});

describe('passthroughRenderer', () => {
  it('returns the template text unchanged', () => {
    const template = createTemplate({ id: 't', version: '1.0.0', text: 'static {{ignored}}' });
    expect(passthroughRenderer.render(template, {})).toBe('static {{ignored}}');
  });
});

describe('SystemPromptBuilder', () => {
  it('composes sections in order', () => {
    const prompt = new SystemPromptBuilder()
      .role('You are Nexora.')
      .context('Workspace: Engineering')
      .policy('Never fabricate.')
      .instruction('Act on the plan.')
      .build();
    expect(prompt).toContain('# Role');
    expect(prompt).toContain('# Context');
    expect(prompt).toContain('# Policies');
    expect(prompt).toContain('# Instructions');
    expect(prompt.indexOf('# Role')).toBeLessThan(prompt.indexOf('# Instructions'));
  });

  it('replaces a section with the same heading', () => {
    const builder = new SystemPromptBuilder().role('old');
    builder.role('new');
    expect(builder.sections()).toHaveLength(1);
    expect(builder.sections()[0]?.body).toBe('new');
  });

  it('exposes the current sections', () => {
    const builder = new SystemPromptBuilder().instruction('do it');
    expect(builder.sections()[0]?.heading).toBe('Instructions');
  });
});
