import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import nounsanitized from 'eslint-plugin-no-unsanitized';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/lib/**',
      '**/node_modules/**',
      '**/coverage/**',
      'mobile/android/**',
      'mobile/www/**',
      'mobile/ios/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'no-unsanitized': nounsanitized },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Render text through JSX; raw HTML injection is forbidden (XSS).',
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'mobile/scripts/**/*.mjs', 'services/**/*.mjs', 'functions/scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['functions/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
);
