const assert = require("node:assert/strict");
const { mkdtemp, readFile, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const releaseModule = pathToFileURL(resolve("scripts/release.mjs")).href;

async function loadReleaseTools() {
  return import(releaseModule);
}

test("calculates the highest release required by conventional commits", async () => {
  const { determineReleaseType, findNonConventionalCommit, parseCommitMessages } = await loadReleaseTools();
  assert.equal(determineReleaseType(["docs: explain releases", "fix: repair parser"]), "patch");
  assert.equal(determineReleaseType(["fix: repair parser", "feat: add dry-run output"]), "minor");
  assert.equal(determineReleaseType(["feat!: replace the public API"]), "major");
  assert.equal(determineReleaseType(["fix: repair parser\n\nBREAKING CHANGE: the previous API is removed"]), "major");
  assert.equal(determineReleaseType(["A non-conventional commit"]), undefined);
  assert.equal(findNonConventionalCommit(["fix: repair parser", "A non-conventional commit"]), "A non-conventional commit");
  assert.equal(findNonConventionalCommit(["Merge pull request #12 from BigfootDS/fix-parser"]), undefined);
  assert.deepEqual(parseCommitMessages("fix: repair parser\n\0\nci: configure releases\n\0\n"), ["fix: repair parser", "ci: configure releases"]);
});

test("bumps stable semantic versions", async () => {
  const { bumpVersion } = await loadReleaseTools();
  assert.equal(bumpVersion("0.0.1", "patch"), "0.0.2");
  assert.equal(bumpVersion("0.0.1", "minor"), "0.1.0");
  assert.equal(bumpVersion("0.0.1", "major"), "1.0.0");
  assert.throws(() => bumpVersion("0.0.1-beta.1", "patch"), /stable semantic version/);
});

test("updates package and lockfile versions together", async () => {
  const { writeReleaseVersion } = await loadReleaseTools();
  const directory = await mkdtemp(join(tmpdir(), "nodejs-semver-release-"));
  const packagePath = join(directory, "package.json");
  const lockPath = join(directory, "package-lock.json");
  await writeFile(packagePath, '{"name":"example","version":"0.0.1"}\n');
  await writeFile(lockPath, '{"name":"example","version":"0.0.1","packages":{"":{"name":"example","version":"0.0.1"}}}\n');
  writeReleaseVersion({ packagePath, lockPath, version: "0.1.0" });
  assert.equal(JSON.parse(await readFile(packagePath, "utf8")).version, "0.1.0");
  const lockfile = JSON.parse(await readFile(lockPath, "utf8"));
  assert.equal(lockfile.version, "0.1.0");
  assert.equal(lockfile.packages[""].version, "0.1.0");
});
