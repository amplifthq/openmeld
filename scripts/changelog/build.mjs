#!/usr/bin/env node

import { buildChangelog, formatChangelogError } from "./changelog.mjs";

try {
  const result = buildChangelog();
  console.log(
    `Built Changelog projections (${result.publishedCount} published, ${result.draftCount} draft).`
  );
} catch (error) {
  console.error("Could not build the Changelog:\n");
  console.error(formatChangelogError(error));
  process.exitCode = 1;
}
