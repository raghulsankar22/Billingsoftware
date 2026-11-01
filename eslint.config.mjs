import { createRequire } from "node:module";
import path from "node:path";
import { FlatCompat } from "@eslint/eslintrc";

// pnpm keeps a package's plugins beside it rather than in the top-level node_modules.
const require = createRequire(import.meta.url);
const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  resolvePluginsRelativeTo: path.dirname(require.resolve("eslint-config-next/package.json")),
});

export default [
  { ignores: ["node_modules/**", ".next/**", ".next-*/**", ".desktop-runtime/**", ".codex/**", "release/**", "data/**", "backups/**", "tmp/**", "mattpocock-skills-source/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals"),
];
