import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          // Un seul PostgreSQL embarqué partagé : exécution séquentielle.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 180_000,
          globalSetup: ["tests/db/global-setup.ts"],
        },
      },
    ],
  },
});
