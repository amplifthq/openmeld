"use strict";
// This hook is selected only by the CLI artifact builder, never by installation.
// pnpm owns catalog/workspace expansion; the publisher keeps the source identity.
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
module.exports = {
  hooks: {
    beforePacking(pkg) {
      const gitHead = process.env.OPENMELD_NPM_PACK_GIT_HEAD;
      if (!SOURCE_SHA.test(gitHead ?? "")) {
        throw new Error("CLI packing requires an exact source commit.");
      }
      return { ...pkg, gitHead };
    },
  },
};
