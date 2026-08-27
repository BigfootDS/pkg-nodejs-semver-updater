import { readFile, writeFile } from "node:fs/promises";
import { isSemanticVersion } from "./semver.js";

type JsonObject = Record<string, unknown>;

/**
 * Describes an additional JSON string property to update alongside package version.
 *
 * `jsonPointer` uses the [RFC 6901 JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901)
 * format. For example, `/appVersion` targets a root property and
 * `/release/version` targets a nested property. The file must contain a JSON object.
 */
export interface JsonVersionProperty {
  /** Path to a JSON configuration file. */
  filePath: string;
  /** JSON Pointer identifying the version string within `filePath`. */
  jsonPointer: string;
  /**
   * Exact string to write instead of the package version.
   *
   * This is useful for display-version fields whose host application accepts a
   * richer format than npm accepts in `package.json.version`.
   */
  value?: string;
  /** Add the final property when its parent object exists but it is currently missing. */
  create?: boolean;
}

/** Configures one atomic Node.js project version update. */
export interface UpdateNodeProjectVersionOptions {
  /** Path to the primary Node.js package manifest. @defaultValue `package.json` */
  packagePath?: string;
  /** Version written to `package.json` and properties without an explicit `value`. */
  version: string;
  /** JSON version strings that mirror the package version or receive explicit values. */
  additionalVersionProperties?: readonly JsonVersionProperty[];
  /** Validate the supplied version using Semantic Versioning rules. @defaultValue true */
  validateSemver?: boolean;
  /** Calculate all updates without writing any JSON files. */
  dryRun?: boolean;
}

/** Reports the outcome for one configured JSON version property. */
export interface UpdatedJsonVersionProperty {
  filePath: string;
  jsonPointer: string;
  previousVersion?: string;
  /** String written to this individual JSON property. */
  version: string;
  changed: boolean;
}

/** Reports the combined result of updating the package manifest and configured properties. */
export interface UpdateNodeProjectVersionResult {
  packagePath: string;
  previousVersion?: string;
  version: string;
  changed: boolean;
  properties: readonly UpdatedJsonVersionProperty[];
}

interface JsonDocument {
  original: string;
  value: JsonObject;
  changed: boolean;
}

interface ParsedJsonPointer {
  pointer: string;
  tokens: readonly string[];
}

const packageVersionPointer = "/version";
const unsafePropertyNames = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Updates a Node.js package version and optional duplicate JSON version strings.
 *
 * All configured files are read and validated before any write occurs. Existing
 * JSON indentation, line-ending style, and final-newline choice are preserved
 * when a file changes. Extra properties must contain strings, which keeps this
 * updater focused on semantic application versions rather than build counters.
 *
 * @throws When a file is not valid JSON, a JSON Pointer is invalid, or a target
 * property is missing without `create: true`.
 */
export async function updateNodeProjectVersion(
  options: UpdateNodeProjectVersionOptions,
): Promise<UpdateNodeProjectVersionResult> {
  const packagePath = options.packagePath ?? "package.json";
  const properties: readonly JsonVersionProperty[] = [
    { filePath: packagePath, jsonPointer: packageVersionPointer },
    ...(options.additionalVersionProperties ?? []),
  ];
  validateOptions(options, packagePath, properties);

  const documents = new Map<string, JsonDocument>();
  const updates: UpdatedJsonVersionProperty[] = [];

  for (const property of properties) {
    const document = await getDocument(documents, property.filePath);
    const pointer = parseJsonPointer(property.jsonPointer);
    const existing = getJsonPointerValue(document.value, pointer);

    if (existing.exists && typeof existing.value !== "string") {
      throw new Error(
        `${describeProperty(property)} must contain a string version; received ${JSON.stringify(existing.value)}.`,
      );
    }

    if (!existing.exists && property.create !== true) {
      throw new Error(`${describeProperty(property)} does not exist. Pass create: true to add it.`);
    }

    const previousVersion = existing.value as string | undefined;
    const version = property.value ?? options.version;
    const changed = previousVersion !== version;
    if (changed) {
      setJsonPointerValue(document.value, pointer, version, property.create === true);
      document.changed = true;
    }

    updates.push({
      filePath: property.filePath,
      jsonPointer: property.jsonPointer,
      ...(previousVersion === undefined ? {} : { previousVersion }),
      version,
      changed,
    });
  }

  if (!options.dryRun) {
    for (const [filePath, document] of documents) {
      if (document.changed) {
        await writeFile(filePath, renderJson(document.value, document.original), "utf8");
      }
    }
  }

  const packageUpdate = updates[0];
  if (packageUpdate === undefined) {
    throw new Error("The package version target was not created.");
  }

  return {
    packagePath,
    ...(packageUpdate.previousVersion === undefined ? {} : { previousVersion: packageUpdate.previousVersion }),
    version: options.version,
    changed: updates.some((update) => update.changed),
    properties: updates,
  };
}

function validateOptions(
  options: UpdateNodeProjectVersionOptions,
  packagePath: string,
  properties: readonly JsonVersionProperty[],
): void {
  if (packagePath.trim().length === 0) throw new Error("packagePath must not be empty.");
  if (options.version.trim().length === 0) throw new Error("version must not be empty.");
  if (options.validateSemver !== false && !isSemanticVersion(options.version)) {
    throw new Error(`version must be a valid semantic version; received ${JSON.stringify(options.version)}.`);
  }

  const seenProperties = new Set<string>();
  for (const property of properties) {
    if (property.filePath.trim().length === 0) throw new Error("filePath must not be empty.");
    parseJsonPointer(property.jsonPointer);
    if (property.value !== undefined && property.value.trim().length === 0) {
      throw new Error(`${describeProperty(property)} value must not be empty when supplied.`);
    }

    const identity = `${property.filePath}\0${property.jsonPointer}`;
    if (seenProperties.has(identity)) {
      throw new Error(`${describeProperty(property)} was configured more than once.`);
    }
    seenProperties.add(identity);
  }
}

async function getDocument(documents: Map<string, JsonDocument>, filePath: string): Promise<JsonDocument> {
  const existing = documents.get(filePath);
  if (existing !== undefined) return existing;

  const original = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(original) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${JSON.stringify(filePath)} is not valid JSON: ${reason}`);
  }

  if (!isJsonObject(parsed)) {
    throw new Error(`${JSON.stringify(filePath)} must contain a JSON object at its root.`);
  }

  const document = { original, value: parsed, changed: false };
  documents.set(filePath, document);
  return document;
}

function parseJsonPointer(pointer: string): ParsedJsonPointer {
  if (pointer.length === 0 || !pointer.startsWith("/")) {
    throw new Error(`jsonPointer must start with / and identify a property; received ${JSON.stringify(pointer)}.`);
  }

  const tokens = pointer.slice(1).split("/").map((token) => decodeJsonPointerToken(token, pointer));
  if (tokens.some((token) => unsafePropertyNames.has(token))) {
    throw new Error(`jsonPointer must not target a prototype property; received ${JSON.stringify(pointer)}.`);
  }

  return { pointer, tokens };
}

function decodeJsonPointerToken(token: string, pointer: string): string {
  if (/~(?:[^01]|$)/.test(token)) {
    throw new Error(`jsonPointer contains an invalid escape sequence: ${JSON.stringify(pointer)}.`);
  }

  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function getJsonPointerValue(
  value: JsonObject,
  pointer: ParsedJsonPointer,
): { exists: boolean; value?: unknown } {
  let current: JsonObject = value;

  for (let index = 0; index < pointer.tokens.length; index += 1) {
    const token = pointer.tokens[index];
    if (token === undefined) throw new Error(`jsonPointer is invalid: ${JSON.stringify(pointer.pointer)}.`);
    if (!Object.hasOwn(current, token)) return { exists: false };

    const next = current[token];
    if (index === pointer.tokens.length - 1) return { exists: true, value: next };
    if (!isJsonObject(next)) {
      throw new Error(`jsonPointer parent is not an object: ${JSON.stringify(pointer.pointer)}.`);
    }
    current = next;
  }

  throw new Error(`jsonPointer is invalid: ${JSON.stringify(pointer.pointer)}.`);
}

function setJsonPointerValue(
  value: JsonObject,
  pointer: ParsedJsonPointer,
  version: string,
  create: boolean,
): void {
  let current: JsonObject = value;

  for (let index = 0; index < pointer.tokens.length - 1; index += 1) {
    const token = pointer.tokens[index];
    if (token === undefined || !Object.hasOwn(current, token) || !isJsonObject(current[token])) {
      throw new Error(`jsonPointer parent is not an object: ${JSON.stringify(pointer.pointer)}.`);
    }
    current = current[token] as JsonObject;
  }

  const finalToken = pointer.tokens.at(-1);
  if (finalToken === undefined) throw new Error(`jsonPointer is invalid: ${JSON.stringify(pointer.pointer)}.`);
  if (!create && !Object.hasOwn(current, finalToken)) {
    throw new Error(`jsonPointer does not exist: ${JSON.stringify(pointer.pointer)}.`);
  }
  current[finalToken] = version;
}

function renderJson(value: JsonObject, original: string): string {
  const indentation = /\n([\t ]+)"(?:[^"\\]|\\.)+"\s*:/.exec(original)?.[1] ?? "  ";
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = original.endsWith("\n");
  const rendered = JSON.stringify(value, undefined, indentation).replace(/\n/g, newline);
  return trailingNewline ? `${rendered}${newline}` : rendered;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeProperty(property: JsonVersionProperty): string {
  return `${JSON.stringify(property.filePath)} at ${JSON.stringify(property.jsonPointer)}`;
}
