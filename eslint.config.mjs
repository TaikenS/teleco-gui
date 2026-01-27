// eslint.config.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tsParser from '@typescript-eslint/parser';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const importOrderRule = [
    'error',
    {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
        pathGroups: [
            {
                pattern: '{react,react-dom/**,react-router-dom}',
                group: 'builtin',
                position: 'before',
            },
        ],
        pathGroupsExcludedImportTypes: ['builtin'],
        alphabetize: { order: 'asc' },
    },
];

export default defineConfig([
    // Next.js 推奨（Core Web Vitals） + TS補助
    ...nextVitals,
    ...nextTs,

    // Prettier と競合する整形ルールを無効化
    prettier,

    // .eslintignore の代わり（ESLint 9は .eslintignore 非対応）
    globalIgnores([
        // Next.js 公式が挙げている default ignores（必要なら調整）
        '.next/**',
        'out/**',
        'build/**',
        'next-env.d.ts',

        // 追加で無視したいもの
        'dist/**',
        'node_modules/**',
    ]),

    // TypeScript: 型情報が必要な no-unsafe-* を動かすため project を設定
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: __dirname,
                sourceType: 'module',
            },
        },
        plugins: {
            'unused-imports': unusedImports,
            import: importPlugin,
        },
        rules: {
            // unused-imports を使うなら no-unused-vars は二重報告になりやすいので OFF 推奨
            '@typescript-eslint/no-unused-vars': 'off',

            // 旧: unused-imports/no-unused-imports-ts → 現行: unused-imports/no-unused-imports
            'unused-imports/no-unused-imports': 'warn',

            // 変数/引数の未使用は error で維持（imports は上のルールで別扱い）
            'unused-imports/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                },
            ],

            '@typescript-eslint/no-explicit-any': 'warn',

            // これらは「型情報」が必要（project 設定が効きます）
            '@typescript-eslint/no-unsafe-call': 'error',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unsafe-return': 'warn',

            'import/order': importOrderRule,
        },
    },

    // JS/JSX も同じ import/order / unused-imports を効かせたい場合
    {
        files: ['**/*.{js,jsx,mjs,cjs}'],
        plugins: {
            'unused-imports': unusedImports,
            import: importPlugin,
        },
        rules: {
            'no-unused-vars': 'off',
            'unused-imports/no-unused-imports': 'warn',
            'unused-imports/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                },
            ],
            'import/order': importOrderRule,
        },
    },
]);
