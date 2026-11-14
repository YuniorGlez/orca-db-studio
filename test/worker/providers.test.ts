// Seam B: the hosted providers' keys and the projects they reach, with the network stubbed.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mockHost, mountWorker } from 'orca/testing'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Provider } from '../../src/protocol'
import * as worker from '../../src/worker/index'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'db-studio-provider-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

interface Answer {
  status?: number
  body: unknown
}

/** A stand-in for fetch: each path answers with the body listed for it. */
function stubNetwork(routes: Record<string, Answer>) {
  const seen: string[] = []
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = new URL(String(input))
    const key = url.pathname + (url.search || '')
    seen.push(key)
    const answer = routes[key] ?? { status: 404, body: {} }
    const status = answer.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => answer.body,
    }
  })
  return seen
}

const NEON_PROJECTS = {
  body: {
    projects: [
      { id: 'p1', name: 'shop', region_id: 'aws-eu-central-1', pg_version: 17 },
      { id: 'p2', name: 'analytics', region_id: 'aws-us-east-1', pg_version: 16 },
    ],
  },
}

async function start() {
  const host = mockHost()
  const w = await mountWorker(worker, { host })
  return { host, w }
}

async function envFile(name: string, contents: string): Promise<string> {
  const path = join(root, name)
  await writeFile(path, contents)
  return path
}

function addKey(w: Awaited<ReturnType<typeof start>>['w'], provider: Provider, value: string) {
  return w.request('provider.addKey', { provider, value })
}

describe('provider keys', () => {
  test('stores the token written in a .env file it is given by path', async () => {
    const seen = stubNetwork({ '/api/v2/projects': NEON_PROJECTS })
    const { host, w } = await start()
    const path = await envFile(
      '.env',
      'DATABASE_URL=postgres://x\nNEON_API_KEY=napi_abc123def456\n',
    )

    const view = await addKey(w, 'neon', path)

    expect(view.keys).toEqual([{ masked: 'napi_ab…f456' }])
    expect(view.projects.map((p) => p.name)).toEqual(['analytics', 'shop'])
    expect(view.projects[0]?.detail).toBe('aws-us-east-1 · PG 16')
    expect(seen).toEqual(['/api/v2/projects'])
    // The token lives in secrets, never in the storage a settings backup would copy.
    expect(JSON.stringify(host.data().storage)).not.toContain('napi_abc123def456')
    expect(JSON.stringify(host.data().secrets)).toContain('napi_abc123def456')
    await w.deactivate()
  })

  test('accepts the token pasted straight into the field', async () => {
    stubNetwork({ '/api/v2/projects': NEON_PROJECTS })
    const { w } = await start()

    const view = await addKey(w, 'neon', 'napi_pastedtoken1234')

    expect(view.keys).toHaveLength(1)
    expect(view.projects).toHaveLength(2)
    await w.deactivate()
  })

  test('refuses a file that holds no token for that provider', async () => {
    stubNetwork({})
    const { w } = await start()
    const path = await envFile('.env', 'DATABASE_URL=postgres://x\n')

    await expect(addKey(w, 'neon', path)).rejects.toThrow(/no contiene un token de neon/)
    await w.deactivate()
  })

  test('refuses a path that cannot be read', async () => {
    stubNetwork({})
    const { w } = await start()

    await expect(addKey(w, 'supabase', join(root, 'nope.env'))).rejects.toThrow(/No se pudo leer/)
    await w.deactivate()
  })

  test('a refused key is kept out of the list but the stored one stays, with why', async () => {
    stubNetwork({ '/api/v2/projects': { status: 401, body: {} } })
    const { w } = await start()
    await addKey(w, 'neon', 'napi_abc123def456')

    const view = await w.request('provider.view', { provider: 'neon' })

    expect(view.keys).toHaveLength(1)
    expect(view.projects).toEqual([])
    expect(view.error).toMatch(/rechazó la API key/)
    await w.deactivate()
  })

  test('two keys reaching the same project list it once', async () => {
    stubNetwork({ '/api/v2/projects': NEON_PROJECTS })
    const { w } = await start()
    await addKey(w, 'neon', 'napi_first123456789')

    const view = await addKey(w, 'neon', 'napi_second12345678')

    expect(view.keys).toHaveLength(2)
    expect(view.projects.map((p) => p.id)).toEqual(['p2', 'p1'])
    await w.deactivate()
  })

  test('removing the keys leaves the provider empty', async () => {
    stubNetwork({ '/api/v2/projects': NEON_PROJECTS })
    const { w } = await start()
    await addKey(w, 'neon', 'napi_abc123def456')

    const view = await w.request('provider.clearKeys', { provider: 'neon' })

    expect(view).toEqual({ keys: [], projects: [] })
    await w.deactivate()
  })

  test('supabase lists its projects with the token', async () => {
    const seen = stubNetwork({
      '/v1/projects': {
        body: [
          { ref: 'abc', name: 'pioneros', region: 'eu-central-1', status: 'ACTIVE_HEALTHY' },
          { ref: 'def', name: 'sonicflow', region: 'eu-west-1', status: 'PAUSED' },
        ],
      },
    })
    const { w } = await start()

    const view = await addKey(w, 'supabase', 'sbp_token123456789')

    expect(view.projects).toEqual([
      { id: 'abc', name: 'pioneros', detail: 'eu-central-1 · active_healthy' },
      { id: 'def', name: 'sonicflow', detail: 'eu-west-1 · paused' },
    ])
    expect(seen).toEqual(['/v1/projects'])
    await w.deactivate()
  })

  test('a provider without keys asks for nothing over the network', async () => {
    const seen = stubNetwork({})
    const { w } = await start()

    const view = await w.request('provider.view', { provider: 'neon' })

    expect(view).toEqual({ keys: [], projects: [] })
    expect(seen).toEqual([])
    await w.deactivate()
  })
})
