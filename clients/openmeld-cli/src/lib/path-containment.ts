import { isAbsolute, relative, sep } from "node:path";

const nativePath = { isAbsolute, relative, sep };
type PathOperations = typeof nativePath;

/** Lexical containment of already canonical absolute paths, not symlink resolution. */
export function isSameOrDescendantPath(
  candidate: string,
  parent: string,
  paths: PathOperations = nativePath
): boolean {
  if (!(paths.isAbsolute(candidate) && paths.isAbsolute(parent))) {
    return false;
  }
  const relation = paths.relative(parent, candidate);
  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${paths.sep}`) &&
      !paths.isAbsolute(relation))
  );
}
