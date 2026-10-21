# @cloudflare/vitest-plugin 1.3.6: resolve CommonJS requires under Vite 8

The Workers module fallback resolves `require()` calls through Vite and marks
them only with `custom["node-resolve"].isRequire`. Vite 8 no longer reads that
option; its resolver selects the `require` export condition from
`kind: "require-call"`. Without the patch every `require()` resolves with the
`import` condition, so CommonJS packages that ship a dual `exports` map load an
ESM entry as CommonJS. `pg` fails this way: `require("pg-protocol")` resolves
to `pg-protocol/esm/index.js` and Core Worker tests stop with "Cannot use
import statement outside a module". The patch also passes `kind`, keeping the
legacy option for older Vite versions.

Vitest 4.1.11 installs Vite 8 in this workspace. The Core Worker integration
suites (`services/core` `vitest.config.ts` and
`vitest.postgresql-owner.config.ts`) exercise this path through `pg`.

Remove this version-bound patch when an upstream release passes `kind` (or
otherwise resolves requires with the `require` condition) under Vite 8.
