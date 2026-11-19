import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * `@owneraio/finp2p-nodejs-skeleton-adapter/durable` exists so a plugin can
 * author durable flows without loading the adapter runtime. The root entry
 * point pulls in Express, pg, winston, keccak and secp256k1 — the last two
 * build natively — and a plugin that wants the flow runner alone should not
 * have to take any of that.
 *
 * Nothing about that is enforced by the type system, and one convenient
 * `import { logger } from '../helpers'` would quietly undo it. These tests are
 * the guard.
 */
describe('the durable entry point stays light', () => {
  const src = (...parts: string[]) =>
    readFileSync(join(__dirname, '..', '..', 'src', ...parts), 'utf8')

  const pkg = () => JSON.parse(src('..', 'package.json')) as {
    exports: Record<string, { types: string; default: string }>
    typesVersions: Record<string, Record<string, string[]>>
  }

  /** Comments are stripped first: these files document their own usage with
   *  an `import ... from '@owneraio/...'` example, which is not an import. */
  const importsOf = (text: string): string[] => {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    return [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
  }

  test('the flow runner imports only the step models', () => {
    expect(importsOf(src('workflows', 'durable.ts'))).toEqual(['../models/steps'])
  })

  test('the step models import nothing at all', () => {
    expect(importsOf(src('models', 'steps.ts'))).toEqual([])
  })

  test('the entry point re-exports only those two modules', () => {
    expect(new Set(importsOf(src('durable.ts'))))
      .toEqual(new Set(['./workflows/durable', './models/steps']))
  })

  test('the package exposes it as a subpath', () => {
    expect(pkg().exports['./durable'])
      .toEqual({ types: './dist/durable.d.ts', default: './dist/durable.js' })
  })

  /**
   * `exports` is invisible to TypeScript under `moduleResolution: "node"`,
   * which every plugin in finp2p-ethereum-tools still uses: the import
   * resolves at run time and `tsc` reports TS2307. `typesVersions` is the
   * fallback it does read, so every subpath needs an entry or it is
   * unusable from those projects.
   */
  test('every subpath has a typesVersions entry, so older tsc resolves it', () => {
    const { exports: map, typesVersions } = pkg()
    const subpaths = Object.keys(map).filter((k) => k !== '.').map((k) => k.replace('./', ''))

    expect(subpaths.length).toBeGreaterThan(0)
    for (const subpath of subpaths) {
      expect(typesVersions['*'][subpath]).toEqual([map[`./${subpath}`].types.replace('./', '')])
    }
  })
})
