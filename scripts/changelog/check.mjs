#!/usr/bin/env node

import { checkChangelog, formatChangelogError } from "./changelog.mjs";

try {
  const result = checkChangelog();
  console.log(
    `Changelog is valid (${result.publishedCount} published, ${result.draftCount} draft).`
  );
} catch (error) {
  console.error("Changelog validation failed:\n");
  console.error(formatChangelogError(error));
  process.exitCode = 1;
}
