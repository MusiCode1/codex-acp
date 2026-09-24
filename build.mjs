import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts', 'src/lib.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  external: ['@openai/codex'],
  // Polyfill `require` for CJS modules bundled into ESM output
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});
