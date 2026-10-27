module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "react-hooks"],
  rules: {
    // Allow empty catch blocks (used throughout the codebase intentionally)
    "no-empty": ["error", { allowEmptyCatch: true }],
    // Unused imports/vars are cleaned up gradually — not enforced at build time
    "@typescript-eslint/no-unused-vars": "off",
    // Explicit any is acceptable in this codebase
    "@typescript-eslint/no-explicit-any": "off",
    // exhaustive-deps: the codebase intentionally omits some deps to avoid
    // re-render loops (documented in context.json key_patterns #7)
    "react-hooks/exhaustive-deps": "off",
    // react-hooks rules of hooks must be enforced
    "react-hooks/rules-of-hooks": "error",
    // prefer-const: enforce immutability where possible
    "prefer-const": "error",
  },
};
