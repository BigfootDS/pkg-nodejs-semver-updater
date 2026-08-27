#!/usr/bin/env node

import { parseArgs } from "node:util";
import { type JsonVersionProperty, updateNodeProjectVersion } from "./index.js";

const help = `Usage: nodejs-semver-updater --version <version> [options]

Update a Node.js package.json version and optional duplicate JSON version properties.

Options:
  -p, --package <path>       Package manifest to update (default: package.json)
      --property <file:/ptr> Additional JSON version property. Repeat as needed.
      --create-missing-properties
                                Add missing final properties configured by --property.
  -v, --version <version>    Semantic version to write (required)
      --strip-leading-v      Remove one leading v from the version
      --allow-non-semver     Do not validate the version as semantic versioning
      --dry-run              Report changes without writing files
  -h, --help                 Show this help message

Examples:
  nodejs-semver-updater --version 1.2.3
  nodejs-semver-updater --version 1.2.3 \\
    --property electron-builder.json:/buildVersion
`;

/** Runs the command-line interface and formats its file-level update summary. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      package: { type: "string", short: "p", default: "package.json" },
      property: { type: "string", multiple: true },
      "create-missing-properties": { type: "boolean", default: false },
      version: { type: "string", short: "v" },
      "strip-leading-v": { type: "boolean", default: false },
      "allow-non-semver": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(help);
    return;
  }

  if (values.version === undefined) {
    throw new Error("--version is required. Run with --help for usage.");
  }

  const version =
    values["strip-leading-v"] && values.version.startsWith("v")
      ? values.version.slice(1)
      : values.version;
  const additionalVersionProperties = (values.property ?? []).map((property) =>
    parseAdditionalVersionProperty(property, values["create-missing-properties"]),
  );
  const result = await updateNodeProjectVersion({
    packagePath: values.package ?? "package.json",
    version,
    additionalVersionProperties,
    validateSemver: !values["allow-non-semver"],
    dryRun: values["dry-run"],
  });

  const verb = values["dry-run"] ? "Would update" : "Updated";
  process.stdout.write(`${verb} ${result.properties.length} version propert${result.properties.length === 1 ? "y" : "ies"}:\n`);
  for (const property of result.properties) {
    const previous = property.previousVersion ?? "(unset)";
    process.stdout.write(
      `  ${property.filePath} ${property.jsonPointer}: ${previous} -> ${result.version}${property.changed ? "" : " (unchanged)"}\n`,
    );
  }
}

/**
 * Parses a repeated `--property` value without treating Windows drive-letter
 * colons as delimiters. The separator is the colon directly before a JSON
 * Pointer, such as `metadata.json:/release/version`.
 */
function parseAdditionalVersionProperty(value: string, create: boolean): JsonVersionProperty {
  const separator = value.indexOf(":/");
  if (separator <= 0) {
    throw new Error(`--property must use <file:/json-pointer>; received ${JSON.stringify(value)}.`);
  }

  return {
    filePath: value.slice(0, separator),
    jsonPointer: value.slice(separator + 1),
    ...(create ? { create: true } : {}),
  };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`nodejs-semver-updater: ${message}\n`);
  process.exitCode = 1;
});
