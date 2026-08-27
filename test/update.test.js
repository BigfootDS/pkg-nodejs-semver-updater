const assert = require("node:assert/strict");
const { execFile: execFileCallback } = require("node:child_process");
const { mkdtemp, readFile, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");
const test = require("node:test");

const { isSemanticVersion, updateNodeProjectVersion } = require("../dist/index.js");
const execFile = promisify(execFileCallback);

async function createProject(files) {
  const directory = await mkdtemp(join(tmpdir(), "nodejs-semver-updater-"));
  await Promise.all(
    Object.entries(files).map(([name, content]) => writeFile(join(directory, name), content, "utf8")),
  );
  return {
    directory,
    packagePath: join(directory, "package.json"),
  };
}

test("updates package.json without changing unrelated properties", async () => {
  const { packagePath } = await createProject({
    "package.json": '{\n  "name": "example",\n  "version": "1.0.0",\n  "private": true\n}\n',
  });

  const result = await updateNodeProjectVersion({ packagePath, version: "1.2.3" });

  assert.deepEqual(result, {
    packagePath,
    previousVersion: "1.0.0",
    version: "1.2.3",
    changed: true,
    properties: [
      {
        filePath: packagePath,
        jsonPointer: "/version",
        previousVersion: "1.0.0",
        version: "1.2.3",
        changed: true,
      },
    ],
  });
  assert.equal(
    await readFile(packagePath, "utf8"),
    '{\n  "name": "example",\n  "version": "1.2.3",\n  "private": true\n}\n',
  );
});

test("updates additional nested JSON version properties", async () => {
  const { directory, packagePath } = await createProject({
    "package.json": '{\n  "name": "example",\n  "version": "1.0.0"\n}\n',
    "version-metadata.json": '{\n  "appVersion": "1.0.0",\n  "release": {\n    "version": "1.0.0"\n  }\n}\n',
  });
  const metadataPath = join(directory, "version-metadata.json");

  const result = await updateNodeProjectVersion({
    packagePath,
    version: "1.2.3-beta.1",
    additionalVersionProperties: [
      { filePath: metadataPath, jsonPointer: "/appVersion" },
      { filePath: metadataPath, jsonPointer: "/release/version" },
    ],
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.properties.map((property) => property.previousVersion), ["1.0.0", "1.0.0", "1.0.0"]);
  assert.deepEqual(JSON.parse(await readFile(packagePath, "utf8")), { name: "example", version: "1.2.3-beta.1" });
  assert.deepEqual(JSON.parse(await readFile(metadataPath, "utf8")), {
    appVersion: "1.2.3-beta.1",
    release: { version: "1.2.3-beta.1" },
  });
});

test("updates JSON Pointer properties whose names contain a slash", async () => {
  const { directory, packagePath } = await createProject({
    "package.json": '{"name":"example","version":"1.0.0"}\n',
    "metadata.json": '{"release/version":"1.0.0"}\n',
  });
  const metadataPath = join(directory, "metadata.json");

  await updateNodeProjectVersion({
    packagePath,
    version: "1.2.3",
    additionalVersionProperties: [{ filePath: metadataPath, jsonPointer: "/release~1version" }],
  });

  assert.equal(JSON.parse(await readFile(metadataPath, "utf8"))["release/version"], "1.2.3");
});

test("creates an explicitly configured missing final property", async () => {
  const { directory, packagePath } = await createProject({
    "package.json": '{"name":"example","version":"1.0.0"}\n',
    "metadata.json": '{"release":{}}\n',
  });
  const metadataPath = join(directory, "metadata.json");

  await updateNodeProjectVersion({
    packagePath,
    version: "1.2.3",
    additionalVersionProperties: [
      { filePath: metadataPath, jsonPointer: "/release/version", create: true },
    ],
  });

  assert.deepEqual(JSON.parse(await readFile(metadataPath, "utf8")), { release: { version: "1.2.3" } });
});

test("does not write package or additional files during a dry run", async () => {
  const packageContent = '{\r\n\t"name": "example",\r\n\t"version": "1.0.0"\r\n}\r\n';
  const metadataContent = '{\r\n\t"appVersion": "1.0.0"\r\n}\r\n';
  const { directory, packagePath } = await createProject({
    "package.json": packageContent,
    "metadata.json": metadataContent,
  });
  const metadataPath = join(directory, "metadata.json");

  const result = await updateNodeProjectVersion({
    packagePath,
    version: "1.2.3",
    additionalVersionProperties: [{ filePath: metadataPath, jsonPointer: "/appVersion" }],
    dryRun: true,
  });

  assert.equal(result.changed, true);
  assert.equal(await readFile(packagePath, "utf8"), packageContent);
  assert.equal(await readFile(metadataPath, "utf8"), metadataContent);
});

test("rejects invalid versions and unsafe or missing properties", async () => {
  const { directory, packagePath } = await createProject({
    "package.json": '{"name":"example","version":"1.0.0"}\n',
    "metadata.json": '{"release":{}}\n',
  });
  const metadataPath = join(directory, "metadata.json");

  await assert.rejects(updateNodeProjectVersion({ packagePath, version: "v1.2.3" }), /valid semantic version/);
  await assert.rejects(
    updateNodeProjectVersion({
      packagePath,
      version: "1.2.3",
      additionalVersionProperties: [{ filePath: metadataPath, jsonPointer: "/release/version" }],
    }),
    /does not exist/,
  );
  await assert.rejects(
    updateNodeProjectVersion({
      packagePath,
      version: "1.2.3",
      additionalVersionProperties: [{ filePath: metadataPath, jsonPointer: "/__proto__/version", create: true }],
    }),
    /must not target a prototype property/,
  );
});

test("validates strict Semantic Versioning 2.0.0 versions without a dependency", () => {
  for (const version of ["0.0.0", "1.2.3", "1.2.3-beta.1", "1.2.3-rc.1+build.42"]) {
    assert.equal(isSemanticVersion(version), true, version);
  }

  for (const version of ["1.2", "01.2.3", "1.02.3", "1.2.03", "v1.2.3", "1.2.3-01", "1.2.3+"]) {
    assert.equal(isSemanticVersion(version), false, version);
  }
});

test("allows custom version strings when requested", async () => {
  const { packagePath } = await createProject({
    "package.json": '{"name":"example","version":"1.0.0"}\n',
  });

  await updateNodeProjectVersion({
    packagePath,
    version: "2026.08-nightly",
    validateSemver: false,
  });

  assert.equal(JSON.parse(await readFile(packagePath, "utf8")).version, "2026.08-nightly");
});

test("writes an explicit display version without weakening package version validation", async () => {
  const { packagePath } = await createProject({
    "package.json": '{"name":"example","version":"1.0.0","gameVersion":"Version 1.0.0 beta"}\n',
  });

  await updateNodeProjectVersion({
    packagePath,
    version: "1.2.3",
    additionalVersionProperties: [{
      filePath: packagePath,
      jsonPointer: "/gameVersion",
      value: "Version 1.2.3 beta",
    }],
  });

  assert.deepEqual(JSON.parse(await readFile(packagePath, "utf8")), {
    name: "example",
    version: "1.2.3",
    gameVersion: "Version 1.2.3 beta",
  });
});

test("the command-line interface updates configured JSON properties", async () => {
  const { directory, packagePath } = await createProject({
    "package.json": '{"name":"example","version":"1.0.0"}\n',
    "metadata.json": '{"appVersion":"1.0.0"}\n',
  });
  const metadataPath = join(directory, "metadata.json");

  await execFile(process.execPath, [
    "dist/cli.js",
    "--package", packagePath,
    "--version", "v2.0.0",
    "--strip-leading-v",
    "--property", `${metadataPath}:/appVersion`,
  ]);

  assert.equal(JSON.parse(await readFile(packagePath, "utf8")).version, "2.0.0");
  assert.equal(JSON.parse(await readFile(metadataPath, "utf8")).appVersion, "2.0.0");
});
