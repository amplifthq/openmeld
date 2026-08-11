const SEMVER_CORE_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)/u;

export function compareSemverCore(left, right) {
  const parsedLeft = parseSemverCore(left);
  const parsedRight = parseSemverCore(right);
  if (!(parsedLeft && parsedRight)) {
    return String(left).localeCompare(String(right));
  }
  for (let index = 0; index < 3; index += 1) {
    if (parsedLeft[index] !== parsedRight[index]) {
      return parsedLeft[index] > parsedRight[index] ? 1 : -1;
    }
  }
  return 0;
}

function parseSemverCore(value) {
  const match = String(value ?? "")
    .trim()
    .match(SEMVER_CORE_PATTERN);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
