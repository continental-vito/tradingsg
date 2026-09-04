import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 exports flat config arrays directly, so there is no
// FlatCompat shim here and @eslint/eslintrc is not a dependency.
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "prisma/migrations/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Money is bigint and prices are integers. `==` between a bigint and a
      // number coerces and reports 100n equal to 100, which is exactly the
      // comparison this codebase must never make by accident.
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
