import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid/configs/typescript';
import globals from 'globals';

export default tseslint.config(
  // Ignore patterns
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js', '*.config.mjs'],
  },

  // Base JS config
  js.configs.recommended,

  // TypeScript configs
  ...tseslint.configs.recommended,

  // SolidJS TypeScript config
  {
    files: ['src/**/*.{ts,tsx}'],
    ...solid,
    languageOptions: {
      ...solid.languageOptions,
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...solid.rules,
      // Allow unused vars prefixed with underscore
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Allow explicit any for now (can tighten later)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow unused expressions (common in SolidJS)
      '@typescript-eslint/no-unused-expressions': 'off',
      // Relax prefer-const
      'prefer-const': 'warn',
      // innerHTML is dangerous but sometimes needed
      'solid/no-innerhtml': 'warn',
      // Prefer <For> over .map() - warn only (can fix incrementally)
      'solid/prefer-for': 'warn',
      // Allow control characters in regex (needed for ANSI parsing)
      'no-control-regex': 'off',
      // Allow lexical declarations in case blocks
      'no-case-declarations': 'off',
    },
  }
);
