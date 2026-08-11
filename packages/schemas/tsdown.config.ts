import { defineConfig } from "tsdown";

const BARE_RELATIVE_IMPORT_REGEX =
  /^[\t ]*import[\t ]+["']\.\.?\/[^"'\r\n]+["'][\t ]*;?[\t ]*$/gmu;

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "schemas/index": "src/schemas/index.ts",
    testing: "src/testing/space-members.ts",
    "types/index": "src/types/index.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: true,
  clean: false,
  unbundle: true,
  plugins: [
    {
      name: "openmeld:remove-redundant-schema-imports",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") {
            continue;
          }
          // Rolldown preserveModules can retain a relative import after it has
          // inlined every imported value. The package declares sideEffects=false,
          // so the import is redundant. Keep its width to preserve sourcemap
          // positions for every remaining statement in the chunk.
          output.code = output.code.replace(
            BARE_RELATIVE_IMPORT_REGEX,
            (line) => line.replace(/[^\r\n]/gu, " ")
          );
        }
      },
    },
  ],
  outExtensions: () => ({ js: ".js" }),
});
