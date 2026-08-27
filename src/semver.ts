const numericIdentifier = "(?:0|[1-9]\\d*)";
const prereleaseIdentifier = `(?:${numericIdentifier}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const prerelease = `(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?`;
const build = "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";

/** A strict SemVer 2.0.0 pattern, adapted from the other BigfootDS version updaters. */
const semanticVersionPattern = new RegExp(
  `^${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}${prerelease}${build}$`,
);

/** Returns whether a string is a strict Semantic Versioning 2.0.0 version. */
export function isSemanticVersion(version: string): boolean {
  return semanticVersionPattern.test(version);
}
