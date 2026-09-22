/**
 * eslint.config.js
 * ---------------------------------------------------------------------------
 * One config for all three workspaces.
 *
 * ===========================================================================
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
 * ===========================================================================
 * TypeScript already catches the whole class of "this does not exist" and
 * "this is the wrong shape". A linter that re-states those rules is noise. So
 * this config is deliberately narrow: it catches the things a typechecker
 * cannot see, and it stays quiet about everything else.
 *
 * The rules that earn their place here are the ones that have actually bitten
 * this codebase:
 *
 *   - a floating promise. Fire-and-forget is a REAL pattern here - emails must
 *     not roll back a paid booking - but it has to be written as `void
 *     something()`, deliberately, rather than by forgetting an `await`. The
 *     difference between the two is invisible at a glance and the linter is
 *     the only thing that can tell them apart.
 *
 *   - an unused import or variable, which is how a half-finished refactor
 *     hides in a diff.
 *
 *   - a React hook called conditionally, or a dependency array missing an
 *     entry, which produces a component that works until it does not.
 *
 * Formatting is not linted at all. Nobody should be arguing with a machine
 * about a comma.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    // Build output, dependencies and generated code. Linting a Prisma client
    // is a way to generate hundreds of warnings nobody can act on.
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      'backend/prisma/migrations/**',
      'backend/uploads/**',
      'backend/private/**',
    ],
  },

  // --- Backend: Node, and type-aware so the promise rules can work ---------
  {
    files: ['backend/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        /*
         * The lint config, not the build config. The build deliberately
         * excludes tests so they never land in dist; type-aware rules need
         * them in a project to see a promise at all.
         */
        project: ['./backend/tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /*
       * The one that matters most here. An un-awaited promise in a money path
       * means the response is sent before the work finishes - or the work is
       * silently abandoned. `void x()` opts out explicitly, which is exactly
       * the distinction worth making visible.
       */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // An argument-shaped mistake, not a style choice: an underscore prefix
      // is how this codebase says "deliberately unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      /*
       * Turned off, not fought. Prisma's JSON columns, Express's untyped
       * request body and the audit metadata bag are genuinely `any` at the
       * boundary; the code casts them at the edge and works in types from
       * there. Flagging every one of those would train everybody to ignore
       * the linter, which costs more than it saves.
       */
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // `?? ''` on a value the types call non-nullable is usually defensive
      // coding against a server that might disagree, not a redundancy.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },

  // --- Tests: the same rules, minus the ones that fight a test suite -------
  {
    files: ['backend/tests/**/*.ts'],
    rules: {
      // Tests assert on shapes the types do not know about (response bodies),
      // and a non-null assertion on a fixture is clearer than a guard clause.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // --- The two React apps --------------------------------------------------
  {
    files: ['frontend/**/*.{ts,tsx}', 'admin/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // A component file that also exports a helper breaks fast refresh: the
      // whole module reloads and the page loses its state mid-edit.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
