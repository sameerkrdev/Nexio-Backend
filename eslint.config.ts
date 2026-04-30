import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: "@typescript-eslint/parser",
      globals: globals.browser,
    },
    plugins: {
      js,
    },
    extends: ["js/recommended"],
    rules: {
      "no-unused-vars": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
    ignores: ["node_modules", "dist", ".bun"],
  },
  tseslint.configs.recommended,
]);
