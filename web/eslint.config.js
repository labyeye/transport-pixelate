import js from "@eslint/js";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Catches what `vite build` cannot: undefined identifiers (missing imports) and unused JSX components.
export default [
  { ignores: ["dist"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { react, "react-hooks": hooks },
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: "18" } },
    rules: {
      "no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "react/jsx-no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
