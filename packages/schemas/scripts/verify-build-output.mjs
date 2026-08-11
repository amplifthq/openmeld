import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findBareSideEffectImports } from "./build-output-invariants.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8")
);
const schemasEntrypointPath = resolve(packageRoot, "dist/schemas/index.js");
const schemasEntrypoint = readFileSync(schemasEntrypointPath, "utf8");
const representativeModuleImports = [
  "./cli/json-output.js",
  "./daemon/runtime-transport.js",
  "./http/space-bootstrap.js",
];

if (packageManifest.sideEffects !== false) {
  throw new Error(
    "Schema package must declare sideEffects=false so downstream builds can remove unused schema modules."
  );
}

for (const moduleImport of representativeModuleImports) {
  if (!schemasEntrypoint.includes(`from "${moduleImport}"`)) {
    throw new Error(
      `Schema build must preserve the ${moduleImport} module boundary for downstream tree shaking.`
    );
  }
}

const bareSideEffectImports = findBareSideEffectImports(
  resolve(packageRoot, "dist")
);
if (bareSideEffectImports.length > 0) {
  const details = bareSideEffectImports
    .map(
      (finding) =>
        `${finding.file}:${finding.line} imports ${finding.importPath}`
    )
    .join("\n");
  throw new Error(
    `Schema build must not retain bare side-effect imports when sideEffects=false:\n${details}`
  );
}

const publicEntrypoint = await import(
  pathToFileURL(resolve(packageRoot, "dist/index.js"))
);

if (publicEntrypoint.OPENMELD_SCHEMA_VERSION !== 1) {
  throw new Error(
    "Schema build must keep the public package entrypoint loadable."
  );
}
