import js from '@eslint/js'
import security from 'eslint-plugin-security'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * The backend runs ESLint rather than the oxlint the frontend uses, for one
 * reason: eslint-plugin-security and the type-aware typescript-eslint rules.
 * This workspace handles OAuth tokens, attacker-controlled CSV values and a
 * send engine whose defects reach real recipients.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  security.configs.recommended,

  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          // Build tooling sits outside the TypeScript program, which only
          // covers src. Listing it here keeps the type-aware rules on rather
          // than exempting these files from them.
          allowDefaultProject: ['scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* A floating promise in the send engine is a send whose failure nobody
         sees. Escalated from the default. */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      /* CONTRIBUTING.md: no `any` without a comment saying why it cannot be
         avoided. The comment is the exception, so this stays an error and is
         silenced case by case. */
      '@typescript-eslint/no-explicit-any': 'error',

      /* Prefer an explicit unused marker over a silent one. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /* Interpolating a number is safe and reads better than String(n). */
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],

      /* console is the log transport until pino lands in Phase 7. */
      'no-console': 'off',
    },
  },

  {
    /* The config file itself is not part of the TypeScript program. */
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
)
