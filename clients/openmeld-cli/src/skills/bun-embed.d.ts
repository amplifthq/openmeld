// Ambient types for the Bun-only embedded-assets island
// (bundled-assets-embedded.ts). That module is excluded from the npm/tsdown
// bundle (tsdown marks it external) and is resolved only by the
// `bun build --compile` build, so these minimal decls let tsc typecheck it
// without adding a bun-types dependency.

declare module "*.md" {
  // Under `import x from "./f.md" with { type: "file" }`, Bun resolves the
  // default export to an embedded file path string.
  const embeddedFilePath: string;
  export default embeddedFilePath;
}
