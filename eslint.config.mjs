// Nexora — ESLint flat config (root).
// NOTE: tooling/lint/eslint.base.mjs holds the shared rules; this file
// composes them with workspace-wide settings. See ENGINEERING_PLAYBOOK.md §4.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const base = [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.turbo/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript strictness baseline (ENGINEERING_PLAYBOOK §4.1)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
];

export default defineConfig(base);
