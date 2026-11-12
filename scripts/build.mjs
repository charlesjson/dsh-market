import { rmSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true })
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { stdio: 'inherit' })
copyFileSync(new URL('../src/interactive-client.js', import.meta.url), new URL('../dist/interactive-client.js', import.meta.url))
