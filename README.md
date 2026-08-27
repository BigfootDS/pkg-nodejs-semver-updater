# Node.js SemVer Updater

Update a Node.js project's `package.json` version and any related JSON version fields from the command line or TypeScript. The package has no runtime dependencies and validates Semantic Versioning 2.0.0 itself.

`package.json` is always updated. Use additional JSON properties when a project also keeps a version in its own JSON configuration file.

## Install and run

Run the CLI without adding it to your project:

```sh
npx --yes @bigfootds/nodejs-semver-updater --version 1.2.3
```

By default, this updates `./package.json`.

```sh
npx --yes @bigfootds/nodejs-semver-updater \
  --package apps/desktop/package.json \
  --version 1.2.3
```

### Additional JSON version properties

Use `--property <file-path>:<json-pointer>` once per additional version field. JSON Pointers follow [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901), so nested properties use `/` separators.

```sh
npx --yes @bigfootds/nodejs-semver-updater \
  --version 1.2.3 \
  --property electron-builder.json:/buildVersion \
  --property version-metadata.json:/release/version
```

The command validates every target before writing any file. A configured property must already exist and contain a string, unless `--create-missing-properties` is supplied. That option can create only the final property in a path; its parent object must already exist.

```sh
npx --yes @bigfootds/nodejs-semver-updater \
  --version 1.2.3 \
  --property version-metadata.json:/release/version \
  --create-missing-properties
```

### CLI options

| Option | Description |
| --- | --- |
| `--version <version>` | Required target version. Must be valid SemVer unless `--allow-non-semver` is used. |
| `--package <path>` | `package.json` to update. Defaults to `package.json`. |
| `--property <file:pointer>` | Additional JSON version property. Repeat for each property. |
| `--create-missing-properties` | Permit creation of the final configured JSON property. |
| `--allow-non-semver` | Accept a custom version string, such as an internal build number. |
| `--dry-run` | Validate and report changes without writing files. |
| `--help` | Show command help. |

## TypeScript API

```ts
import { updateNodeProjectVersion } from "@bigfootds/nodejs-semver-updater";

const result = await updateNodeProjectVersion({
  version: "1.2.3",
  packagePath: "apps/desktop/package.json",
  additionalVersionProperties: [
    { filePath: "electron-builder.json", jsonPointer: "/buildVersion" },
    { filePath: "version-metadata.json", jsonPointer: "/release/version" },
  ],
});

console.log(result.changed);
```

Set `validateSemver: false` to accept version strings outside Semantic Versioning, and `dryRun: true` to inspect planned changes without writing them.

## Electron, Capacitor and native configuration

For standard Electron Builder projects, the app version comes from `package.json` by default, so no extra configuration is needed. See Electron Builder's [configuration reference](https://www.electron.build/configuration.html) for projects that override that default.

Some Electron or Capacitor projects keep duplicate version strings in their own JSON configuration. Configure these with `additionalVersionProperties` or repeated `--property` options. This package intentionally does not modify JavaScript, TypeScript, YAML, XML, Gradle or plist files. Keep those values derived from `package.json`, update them with a platform-specific tool, or add an explicit workflow step for them.

## GitHub Actions

Use the CLI in a workflow after checking out the repository:

```yaml
- uses: actions/checkout@v6

- uses: actions/setup-node@v6
  with:
    node-version: 20.x

- run: npx --yes @bigfootds/nodejs-semver-updater --version 1.2.3
```

Commit the resulting project files in a later step if the workflow should retain the version bump.

## Development

Requires Node.js 20 or newer.

```sh
npm ci
npm test
npm run pack:check
```

The test suite covers the TypeScript API and the built CLI. The CI workflow verifies Node.js 20, 22 and 24.

## Releases

The `cd.yml` workflow creates npm releases from conventional commits pushed to `main`. Its first publish is deliberately manual so that npm Trusted Publishing can be configured against an existing package and repository. After that, configure npm Trusted Publishing for this repository and let the workflow create version commits, `v*` tags, npm releases and GitHub releases.
