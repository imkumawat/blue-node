import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettier from "eslint-config-prettier";

const LOGGER_METHODS = "/^(trace|debug|info|warn|error|fatal)$/";

export default tseslint.config(
  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: `CallExpression[callee.object.name='logger'][callee.property.name=${LOGGER_METHODS}][arguments.0.type='Identifier']`,
          message:
            "Use structured logging: logger.info({ field }, 'message'). Passing a variable as first arg bypasses pino redaction.",
        },
        {
          selector: `CallExpression[callee.object.name='logger'][callee.property.name=${LOGGER_METHODS}][arguments.0.type='TemplateLiteral']`,
          message:
            "Don't interpolate values into log messages — bypasses pino redaction. Use logger.info({ field }, 'static message').",
        },
        {
          selector: `CallExpression[callee.object.name='logger'][callee.property.name=${LOGGER_METHODS}][arguments.0.type='BinaryExpression']`,
          message:
            "Don't concatenate into log messages — bypasses pino redaction. Use structured logging instead.",
        },
        {
          selector: `CallExpression[callee.object.property.name=/^(logger|log)$/][callee.property.name=${LOGGER_METHODS}][arguments.0.type='Identifier']`,
          message:
            "Use structured logging: ctx.logger.info({ field }, 'message'). Passing a variable as first arg bypasses pino redaction.",
        },
        {
          selector: `CallExpression[callee.object.property.name=/^(logger|log)$/][callee.property.name=${LOGGER_METHODS}][arguments.0.type='TemplateLiteral']`,
          message:
            "Don't interpolate values into log messages — bypasses pino redaction. Use ctx.logger.info({ field }, 'static message').",
        },
        {
          selector: `CallExpression[callee.object.property.name=/^(logger|log)$/][callee.property.name=${LOGGER_METHODS}][arguments.0.type='BinaryExpression']`,
          message:
            "Don't concatenate into log messages — bypasses pino redaction. Use structured logging instead.",
        },
      ],

      "no-console": ["warn", { allow: ["error"] }],

      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      "@typescript-eslint/no-explicit-any": "warn",

      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },

  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/tests/**"],
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  prettier,

  {
    ignores: ["node_modules/**", "dist/**", "build/**", "coverage/**"],
  },
);
