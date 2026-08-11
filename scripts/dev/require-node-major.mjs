const expectedMajor = Number.parseInt(process.argv[2] ?? "", 10);

if (!Number.isInteger(expectedMajor)) {
  throw new Error(
    "require-node-major.mjs requires a numeric major version argument"
  );
}

const actualVersion = process.versions.node;
const actualMajor = Number.parseInt(actualVersion.split(".")[0] ?? "", 10);

if (actualMajor === expectedMajor) {
  process.exit(0);
}

console.error(
  [
    `This workspace must run on Node ${expectedMajor}.x.`,
    `Current Node: ${actualVersion}.`,
    "Use `nvm use` from the repo root before running workspace scripts.",
  ].join(" ")
);
process.exit(1);
