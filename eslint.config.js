import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ["**/dist/", "**/node_modules/", "**/*.d.ts"],
  },
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Relax rules that are too noisy for a boilerplate
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // React hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Node scripts (.mjs) need Node globals
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  // Express type augmentation requires namespace
  {
    files: ["**/types/index.ts"],
    rules: {
      "@typescript-eslint/no-namespace": "off",
    },
  },
  // Allow intentional control character regex in auth sanitization
  {
    files: ["packages/server/src/auth.ts"],
    rules: {
      "no-control-regex": "off",
    },
  },
);
