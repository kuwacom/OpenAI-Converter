import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                './*.js',
                '../*.js',
                '../../*.js',
                '../../../*.js',
                '../../../../*.js',
              ],
              message: 'TypeScript source imports should be extensionless.',
            },
            {
              group: ['../*', '../../*', '../../../*', '../../../../*'],
              message: 'Use the @ alias instead of parent relative imports.',
            },
          ],
        },
      ],
    },
  },
);
