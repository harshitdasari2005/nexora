// Nexora evaluation ESLint config (ENGINEERING_PLAYBOOK.md §4).
import { defineConfig } from 'eslint/config';
import rootConfig from '../../eslint.config.mjs';

export default defineConfig([...rootConfig]);
