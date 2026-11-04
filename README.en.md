# HyperWeave Desktop

HyperWeave Desktop is a standalone Agent workbench for the HyperWeave platform. Users can create role-based Agents, bind HyperWeave-managed Skills and business plugins, upload selected local files to platform knowledge bases, and follow remote task progress, approvals, results, and artifacts.

Agent tasks always run in an isolated HyperWeave platform sandbox. The desktop client does not start a local Agent, terminal executor, or DeepSeek Harness runtime. Packaged clients send API and catalog requests only to the administrator-configured HyperWeave address; external navigation and renderer network requests are denied.

This project is an independent fork based on the MIT-licensed source of [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop). Upstream and third-party notices are retained. HyperWeave Desktop does not connect to DSH markets, telemetry, or update services.

## Development

Use Node.js `^22.19.0` or `>=24.0.0` and the repository-pinned Yarn 4.18.0 release:

```sh
corepack yarn install --immutable
HYPERWEAVE_PLATFORM_URL=https://hyperweave.example.internal corepack yarn workspace dsh-desktop-next start:hyperweave
```

Windows PowerShell:

```powershell
$env:HYPERWEAVE_PLATFORM_URL = 'https://hyperweave.example.internal'
corepack yarn workspace dsh-desktop-next start:hyperweave
```

Administrators may instead provision `hyperweave-desktop.json` in Electron's `userData` directory:

```json
{ "platformUrl": "https://hyperweave.example.internal" }
```

Only HTTPS platform addresses are accepted, except loopback addresses used during development.

## Verification and packaging

```sh
corepack yarn workspace dsh-desktop-next typecheck
corepack yarn workspace dsh-desktop-next test --run tests/hyperweave-client.spec.ts
corepack yarn workspace dsh-desktop-next verify:hyperweave-network
corepack yarn workspace dsh-desktop-next dist:hyperweave
corepack yarn workspace dsh-desktop-next verify:hyperweave-package
```

Dedicated CI builds and inspects the HyperWeave package on Windows, macOS, and Linux. Linux CI also launches Electron to verify the network boundary. Tasks use the remote HyperWeave runtime; a local Deep Agents runtime is a future execution adapter.

See [`dsh-desktop-next/HYPERWEAVE.md`](dsh-desktop-next/HYPERWEAVE.md) and [`dsh-desktop-next/HYPERWEAVE-ADAPTATION-REVIEW.md`](dsh-desktop-next/HYPERWEAVE-ADAPTATION-REVIEW.md) for architecture and security details.

## License

The project is MIT licensed. Retain upstream copyright notices, [`LICENSE`](LICENSE), the packaged `LICENSE.upstream` and `LICENSES.third-party.txt`, and the Electron/Chromium license files distributed with the application.
