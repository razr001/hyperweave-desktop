# HyperWeave Desktop mode

The `start:hyperweave` entry is a standalone HyperWeave workbench rendered from local bundled assets. It does not load or wrap the platform console, and it does not import or start the DSH `NextDesktopRuntime`, Host process, Harness profile, or plugin loader. A sandboxed Electron window exposes a narrow IPC bridge; the main process sends authenticated requests only to the administrator-configured HyperWeave origin and denies external navigation and renderer network access.

Configure the platform URL with `HYPERWEAVE_PLATFORM_URL` or create `hyperweave-desktop.json` in Electron's `userData` directory:

```json
{ "platformUrl": "https://hyperweave.example.internal" }
```

Only HTTPS is accepted except for loopback development addresses. API, role Agent profiles, Skills, plugins, knowledge bases, task events, approvals, and artifacts all come from this origin. Email/password login and refresh tokens are handled by the main process; refresh tokens are encrypted with Electron `safeStorage` when the OS provides it. The desktop configuration contains only the platform URL.

For development, build with `yarn workspace dsh-desktop-next build:hyperweave-ui`, then launch with `yarn workspace dsh-desktop-next start:hyperweave`. The local workbench supports platform sign-in, role Agent profiles, approved capability bindings, local file uploads to selected knowledge bases, scoped task submission, task progress, approvals, follow-up input, results, and artifact downloads. Run `yarn workspace dsh-desktop-next verify:hyperweave-network` to launch the actual Electron app against local test servers and verify login, authenticated task submission, allowed platform API access, external request blocking, navigation blocking, and popup denial. To package the HyperWeave-only application, run `yarn workspace dsh-desktop-next dist:hyperweave`, then verify it with `yarn workspace dsh-desktop-next verify:hyperweave-package`. The app version defaults to `0.1.0`; release automation can set `HYPERWEAVE_DESKTOP_VERSION` to a valid semantic version. Packaging uses an isolated project directory with only the HyperWeave entry, preload bridge, local UI assets, product metadata, platform icons, and required licenses; DSH Harness runtime dependencies are not copied into the app.
