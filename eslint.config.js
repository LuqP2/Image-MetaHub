// @ts-check

import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import eslintJs from '@eslint/js';

export default tseslint.config(
  eslintJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Applies to all files
    plugins: {
      react: reactPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
        // A good practice is to disable the base rule and use the TS-specific one
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": "warn",
        // Downgrade 'any' to a warning to make the transition smoother
        "@typescript-eslint/no-explicit-any": "warn"
    }
  },
  {
    // Specifically for JS/CJS/MJS files that are not part of the main TS/React app
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off', // Allow require() in these files
      '@typescript-eslint/no-var-requires': 'off', // Allow require() in these files
    }
  },
  {
    // Ignores files from the linting process
    ignores: ["node_modules/", "build/", "dist/"]
  }
);
