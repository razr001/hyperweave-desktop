/** Starts the HyperWeave-only desktop entry without preparing or launching a Harness Host. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const entry = join(root, 'lib', 'hyperweave-main.js')
if (!existsSync(entry)) throw new Error('Build the desktop first: yarn workspace dsh-desktop-next build')
if (!existsSync(join(root, 'dist', 'hyperweave-ui', 'index.html')))
  throw new Error('Build the HyperWeave workbench first: yarn workspace dsh-desktop-next build:hyperweave-ui')
const require = createRequire(join(root, 'package.json'))
const electron = require('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [entry], { cwd: root, env, stdio: 'inherit' })
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 1 })
