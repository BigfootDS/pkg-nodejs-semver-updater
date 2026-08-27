#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const releaseRank = { patch: 1, minor: 2, major: 3 };
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Return the greatest release level required by conventional commit messages. */
export function determineReleaseType(messages) {
  let releaseType;
  for (const message of messages) {
    const candidate = releaseTypeForCommit(message);
    if (candidate !== undefined && (releaseType === undefined || releaseRank[candidate] > releaseRank[releaseType])) {
      releaseType = candidate;
    }
  }
  return releaseType;
}

/** Return the first non-merge commit that does not use conventional commit syntax. */
export function findNonConventionalCommit(messages) {
  return messages.find((message) => !isMergeCommit(message) && releaseTypeForCommit(message) === undefined);
}

export function parseCommitMessages(logOutput) {
  return logOutput
    .split("\0")
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
}

/** Bump a stable Semantic Versioning release by one release level. */
export function bumpVersion(version, releaseType) {
  const match = versionPattern.exec(version);
  if (match === null) throw new Error(`Expected a stable semantic version, received ${JSON.stringify(version)}.`);
  const [major, minor, patch] = match.slice(1).map((part) => Number.parseInt(part, 10));
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new Error(`Version components must be safe integers; received ${JSON.stringify(version)}.`);
  }
  switch (releaseType) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "patch": return `${major}.${minor}.${patch + 1}`;
    default: throw new Error(`Unsupported release type: ${String(releaseType)}.`);
  }
}

/** Update the package manifest and its lockfile root together. */
export function writeReleaseVersion({ packagePath, lockPath, version }) {
  const manifest = readJson(packagePath);
  const lockfile = readJson(lockPath);
  manifest.version = version;
  lockfile.version = version;
  if (lockfile.packages?.[""] === undefined) {
    throw new Error("package-lock.json does not contain a root package entry.");
  }
  lockfile.packages[""].version = version;
  writeJson(packagePath, manifest);
  writeJson(lockPath, lockfile);
}

function releaseTypeForCommit(message) {
  const header = message.split(/\r?\n/, 1)[0];
  const match = /^(?<type>[a-z][a-z0-9-]*)(?:\([^\r\n)]*\))?(?<breaking>!)?:\s/.exec(header);
  if (match === null) return undefined;
  if (match.groups?.breaking === "!" || /\nBREAKING[ -]CHANGE:\s/m.test(message)) return "major";
  return match.groups?.type === "feat" ? "minor" : "patch";
}

function isMergeCommit(message) {
  return message.startsWith("Merge ");
}

function getLastReleaseTag() {
  const tags = runGit(["tag", "--merged", "HEAD", "--sort=-creatordate"])
    .split("\n")
    .filter((tag) => releaseTagPattern.test(tag));
  return tags[0];
}

function createReleasePlan() {
  const lastTag = getLastReleaseTag();
  if (lastTag === undefined) return { release: false };

  const packagePath = "package.json";
  const lockPath = "package-lock.json";
  const manifest = readJson(packagePath);
  const lastVersion = lastTag.slice(1);
  const messages = parseCommitMessages(runGit(["log", "--format=%B%x00", `${lastTag}..HEAD`]));
  const releaseType = determineReleaseType(messages);
  if (messages.length === 0) return { release: false };

  const invalidCommit = findNonConventionalCommit(messages);
  if (invalidCommit !== undefined) {
    throw new Error(`Non-conventional commit found: ${JSON.stringify(invalidCommit.split(/\r?\n/, 1)[0])}`);
  }
  if (manifest.version !== lastVersion) {
    throw new Error(`package.json is ${manifest.version}, but the last release tag is ${lastTag}. Versions are managed by CD.`);
  }
  if (releaseType === undefined) return { release: false };

  const version = bumpVersion(manifest.version, releaseType);
  writeReleaseVersion({ packagePath, lockPath, version });
  return { release: true, version, tag: `v${version}` };
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  if (process.argv[2] !== "--prepare") throw new Error("Usage: node scripts/release.mjs --prepare");
  const plan = createReleasePlan();
  process.stdout.write(`release=${plan.release}\n`);
  if (plan.release) {
    process.stdout.write(`version=${plan.version}\n`);
    process.stdout.write(`tag=${plan.tag}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
