type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'

type Pattern = string | RegExp | ((...args: unknown[]) => boolean)

type Stream = 'stdout' | 'stderr'

interface SilenceConsoleOptions {
  patterns: Pattern[]
  methods?: ConsoleMethod[]
  streams?: Stream[]
  strict?: boolean
}

const defaultOptions: SilenceConsoleOptions = {
  patterns: [
    'Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.',
    'standardFontDataUrl',
    'Warning: UnknownErrorException: Ensure that the'
  ],
  strict: false
}

function matches(matcher: Pattern, args: unknown[]): boolean {
  if (typeof matcher === 'function') return matcher(...args)

  const text = args
    .map((a) => (typeof a === 'string' ? a : String(a)))
    .join(' ')

  if (typeof matcher === 'string') return text.includes(matcher)
  return matcher.test(text)
}

export function silenceConsole(options = defaultOptions): void {
  const methods = options.methods ?? ['log', 'info', 'warn', 'error', 'debug', 'trace']
  const streams = options.streams ?? ['stdout', 'stderr']

  const spies: Array<ReturnType<typeof vi.spyOn>> = []
  const streamRestores: Array<() => void> = []

  // Installed as the setup file is imported, not from `beforeEach`: every test
  // that loads a PDF does it in `beforeAll`, which runs before the first
  // `beforeEach`, so a patch installed there would miss exactly the warnings
  // this exists to swallow.
  const install = () => {
    for (const method of methods) {
      const original = console[method].bind(console)
      const spy = vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        const silenced = options.patterns.some((p) => matches(p, args))
        if (silenced) return
        if (options.strict) {
          throw new Error(`Unexpected console.${method}: ${args.join(' ')}`)
        }
        original(...args)
      })
      spies.push(spy)
    }

    for (const name of streams) {
      const stream = process[name]
      const original = stream.write.bind(stream)

      // process.*.write has overloads; wrap while preserving the return contract.
      const patched = (
        chunk: string | Uint8Array,
        encodingOrCb?: BufferEncoding | ((err?: Error) => void),
        cb?: (err?: Error) => void,
      ): boolean => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
        const silenced = options.patterns.some((p) => matches(p, [text]))

        if (silenced) {
          // Honor the write callback so callers awaiting the write don't hang.
          const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb
          callback?.()
          return true
        }

        if (options.strict) {
          throw new Error(`Unexpected ${name} write: ${text}`)
        }

        return (original as (...a: unknown[]) => boolean)(chunk, encodingOrCb, cb)
      }

      stream.write = patched as typeof stream.write
      streamRestores.push(() => {
        stream.write = original as typeof stream.write
      })
    }
  }

  const restore = () => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0

    for (const streamRestore of streamRestores) streamRestore()
    streamRestores.length = 0
  }
  

  install()

  // `restoreMocks` and friends can strip the console spies between tests, so
  // reinstate them rather than assuming the first install survives the file.
  beforeEach(() => {
    if (spies.length === 0) install()
  })

  afterAll(restore)
}