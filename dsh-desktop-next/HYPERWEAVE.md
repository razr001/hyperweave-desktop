# HyperWeave Desktop mode

The `start:hyperweave` entry is a remote-first desktop client. It does not import or start the DSH `NextDesktopRuntime`, Host process, Harness profile, or plugin loader. It loads the administrator-configured HyperWeave web origin in a sandboxed Electron window, denies new windows and cross-origin navigation, and blocks renderer network requests to every other origin.

Configure the platform URL with `HYPERWEAVE_PLATFORM_URL` or create `hyperweave-desktop.json` in Electron's `userData` directory:

```json
{ "platformUrl": "https://hyperweave.example.internal" }
```

Only HTTPS is accepted except for loopback development addresses. API, Skills, plugins, and the web application all come from this origin. Credentials remain in the platform origin's session and are not stored in the desktop configuration.

For development, build with `yarn workspace dsh-desktop-next build`, then launch with `yarn workspace dsh-desktop-next start:hyperweave`. Run `yarn workspace dsh-desktop-next verify:hyperweave-network` to launch the actual Electron app against local test servers and verify same-origin access, external request blocking, navigation blocking, and popup denial. To package the HyperWeave-only application, run `yarn workspace dsh-desktop-next dist:hyperweave`, then verify it with `yarn workspace dsh-desktop-next verify:hyperweave-package`. The app version defaults to `0.1.0`; release automation can set `HYPERWEAVE_DESKTOP_VERSION` to a valid semantic version. Packaging uses an isolated minimal project directory with only the HyperWeave entry, product metadata, platform icons, and upstream license, so Harness production dependencies are neither searched nor packaged. The ordinary DSH `dev` and `start` commands remain unchanged for upstream development.
