import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

/** Where the worker is published, in dev and in the build alike. */
const PDF_WORKER_FILE = 'pdf.worker.min.mjs'

/**
 * Publishes pdf.js's worker as a plain file rather than a module.
 *
 * Anything Vite serves through the module pipeline gets an import of its HMR
 * client prepended. That client loads happily inside a worker — every global it
 * touches at module scope is guarded — but `handleMessage` is not: on a CSS
 * update it reaches straight for `document.querySelectorAll('link')`, and a
 * worker has no `document`. The rejection surfaces as a bare "document is not
 * defined" attributed to pdf.js, a long way from what actually caused it.
 *
 * `publicDir` is the one route Vite never transforms, in dev or in the build, so
 * the worker is copied there from the installed package. Copying rather than
 * committing it keeps it pinned to whatever pdfjs-dist is installed; the copy is
 * gitignored.
 */
function pdfWorker(): Plugin {
  return {
    name: 'pdf-worker',
    config(config) {
      const publicDir = join(
        config.root ?? process.cwd(),
        typeof config.publicDir === 'string' ? config.publicDir : 'public',
      )
      const source = createRequire(import.meta.url).resolve(
        `pdfjs-dist/build/${PDF_WORKER_FILE}`,
      )
      mkdirSync(publicDir, { recursive: true })
      copyFileSync(source, join(publicDir, PDF_WORKER_FILE))
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    pdfWorker(),
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
})

export default config
