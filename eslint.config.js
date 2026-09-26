import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'functions/node_modules']),
  {
    files: ['src/**/*.{js,jsx}', '*.{js,jsx}'],
    ignores: ['functions/**'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Advisory (an extra render when an effect sets loading/reset state
      // synchronously), not a correctness bug. Kept visible as a warning so
      // new code can avoid it, without failing CI on the ~40 existing
      // data-loading effects written before this rule existed.
      'react-hooks/set-state-in-effect': 'warn',
      // Dev-only Fast Refresh concern; the two offenders export a hook or a
      // constant alongside a component on purpose.
      'react-refresh/only-export-components': 'warn',
    },
  },
  // Service worker: runs in a worker scope, not a window.
  {
    files: ['public/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.serviceworker },
  },
  // Cloud Functions + repo scripts: CommonJS on Node, not browser modules.
  {
    files: ['functions/**/*.js', 'scripts/**/*.cjs', '**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  // Test files (both trees) are ESM run by vitest on Node.
  {
    files: ['**/__tests__/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
])
