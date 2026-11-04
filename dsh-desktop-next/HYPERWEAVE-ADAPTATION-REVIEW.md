# DSH Desktop adaptation review for HyperWeave

## Upstream snapshot

- Repository: `https://github.com/anywhere-labs/dsh-desktop`
- Source commit: `117e4899132553b230cafd902d78c0f8f0020132`
- Review scope: `dsh-desktop-next` Electron main process, window and shell integration, preferences, Host/Harness runtime, plugin bridges and markets, update transport, telemetry, and the production HyperWeave package.

The earlier Electron wrapper under HyperWeave's `frontend/desktop` has been removed, along with its duplicate Electron build dependencies. The HyperWeave frontend remains the platform web application served from the configured origin; this repository is the single desktop application and packaging path.

The source checkout remains an independent working fork based on the pinned upstream commit. The upstream MIT notice is retained as `LICENSE.upstream` in the source and in the packaged application. Dependency review for the HyperWeave binary is based on the isolated packaging input: the ASAR contains only the bundled HyperWeave main process, preload bridge, local UI, package metadata, and upstream/React notices; Electron and Chromium notices are explicitly copied into the application resources beside the ASAR on every platform. DSH Host, market, telemetry, and updater dependencies are not copied into that package. Re-run this review when adding runtime dependencies or changing the package file allowlist.

## Module decisions

| DSH area | Decision | HyperWeave implementation |
| --- | --- | --- |
| Electron lifecycle and `BrowserWindow` | Reuse the Electron approach; keep a separate entry point | `src/hyperweave/main.ts` creates a sandboxed window with context isolation and Node integration disabled. |
| Navigation and renderer networking | Replace DSH policy | Navigation, popups, redirects, and `webRequest` are restricted to the configured HyperWeave origin; `data:` is allowed for renderer-local content. |
| Local settings and profiles | Do not reuse user-managed DSH profiles | Administrators provide `HYPERWEAVE_PLATFORM_URL` or provision `hyperweave-desktop.json` in Electron `userData`. Authentication and Agent profiles remain platform-owned. |
| Tray, native menus, shortcuts, window-state recovery | Not included in the remote-first first release | The client uses normal OS window controls and lifecycle. Add native integrations only when a HyperWeave workflow needs them. |
| `NextDesktopRuntime`, Host process, DeepSeek Harness, terminal, local tools | Exclude | The HyperWeave entry imports none of these modules. Tasks are submitted to the platform, where Deep Agents executes inside the platform sandbox. |
| DSH plugin IPC/extension bridge and community/official markets | Exclude and replace with platform-owned capabilities | Skills and business plugins are managed and authorized by HyperWeave. The client loads these through the same configured platform origin; it does not install arbitrary local packages or scripts. |
| DSH updater and release endpoints | Exclude | No DSH update checker or download endpoint is bundled or started. The first release receives application updates through the organization’s managed distribution process; automatic updates are not implemented. |
| DSH telemetry and crash reporting | Exclude | The HyperWeave entry does not import DSH telemetry or reporting modules. No DSH telemetry endpoint is allowed by the renderer network policy. |
| Reusable visual UI | Build a local desktop workbench; use platform APIs | The packaged renderer has first-party login, role Agent, capability catalog, file upload, task progress, approval, follow-up, and artifact screens. It does not load the HyperWeave console. |

## Runtime and network boundary

- `src/hyperweave/main.ts` is a separate Electron entry point. The package staging script includes only its compiled output, the local workbench, the narrow preload bridge, and required metadata/licensing.
- The first release has no local Agent runtime. `src/hyperweave/agent-runtime.ts` is the task-provider boundary used by the main-process IPC; its platform provider submits `agentProfileId` and `knowledgeBaseIds` to the existing task contract.
- The configured platform must use HTTPS, except loopback development addresses. The local renderer cannot make network requests. The main process accepts only `/api/` paths on the configured origin, refuses redirects, and blocks external navigation, new windows, and non-local renderer requests.
- There is no desktop auto-update service in this build. This avoids introducing a second service URL before HyperWeave defines a platform-managed update manifest and artifact contract.

## License and packaging check

The HyperWeave app is staged into `.hyperweave-package` rather than packaging the DSH workspace. The build-only `sharp` tool renders the HyperWeave mark into Windows ICO, macOS ICNS, and Linux PNG assets; it is not a runtime dependency of the staged package. `scripts/verify-hyperweave-package.mjs` checks those icon containers, the local UI/preload allowlist, and that upstream, React/Scheduler, Electron, and Chromium license files are included. Electron/Chromium notices are explicit `extraResources`; the verifier reads their contents from the ASAR parent directory, including macOS `Contents/Resources`. Other build-only tools such as Electron Builder and `@electron/asar` are absent from the runtime package. This is a focused check of the produced HyperWeave desktop artifact, not a legal audit of every dependency in the upstream DSH development workspace.

## Verification status

Scope update (2026-11-04): the user deferred business plugins because their architecture may change. Further business-plugin implementation and live publication/execution/revocation acceptance are outside the current desktop delivery scope. Existing interfaces remain for later reassessment; a Kata environment is not required to accept this desktop delivery. Role Agents, Skills, document handling and remote platform tasks remain in scope.

Windows, Linux and macOS build/package verification and the Electron smoke passed for implementation commit `9343b76` in [CI run 41833207337](https://github.com/razr001/hyperweave-desktop/actions/runs/41833207337). The packaged Windows executable also passed the network/authentication smoke, including concurrent API/download token refresh, session expiry, logout races and platform-bound session restoration. The package check verifies the ASAR allowlist and license files; the Electron smoke uses local HTTP fixtures and is separate from live-platform acceptance. Subsequent implementation changes must pass their own CI run.

A local HyperWeave deployment with an isolated PostgreSQL database and test tenant has been created. Live acceptance has exercised desktop authentication, persisted role profiles, independently reviewed Skills, authorized catalog/binding checks, PDF upload/indexing, selected knowledge retrieval, platform task execution, input, approval, and text artifact download. `HYPERWEAVE.md` describes the opt-in scripts and credential handling. No credentials or local service logs are published in this repository.

Deferred business-plugin publication, execution and revocation remain unverified. The existing backend implementation requires Kata, but that architecture must be reassessed before resuming this work. Unknown-plugin binding rejection and unit-level authorization checks do not substitute for future live acceptance. Signed installers and automatic application updates are not supplied by the current build workflow.
