import js from "@eslint/js";
import globals from "globals";

// Catches undefined identifiers (e.g. a missing import in a code path the tests don't reach).
export default [
  { ignores: ["uploads"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
    rules: { "no-undef": "error", "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
];
