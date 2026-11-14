// The panel against a stand-in worker: what the person sees and which requests it makes.
import { hostError, mockHost, mount } from 'orca/testing'
import { describe, expect, test } from 'vitest'
import * as panel from '../../src/panel/index'
import { type ConnectionEntry, type SchemaTree, SQLITE_FORM_REQUEST_KEY } from '../../src/protocol'

const SHOP: ConnectionEntry = {
  ref: '/data/shop.db',
  name: 'shop.db',
  detail: 'data',
  origin: 'saved',
}
const API: ConnectionEntry = {
  ref: 'env:DATABASE_URL:w1',
  name: 'api',
  detail: 'app@db:5432/shop',
  origin: 'worktree',
  workspaceId: 'w1',
}

const SHOP_TREE: SchemaTree = {
  schemas: [
    {
      name: 'main',
      objects: [
        { name: 'orders', kind: 'table' },
        { name: 'recent_orders', kind: 'view' },
      ],
    },
  ],
}

const FOUND = {
  files: [{ path: '/work/api/app.db', relativePath: 'app.db', workspaceName: 'api' }],
}

/** The group's tree that holds an item key: the list is one tree per group now. */
function treeWith<T extends { props: Record<string, unknown> }>(
  p: { findAll: (q: { role: string }) => T[] },
  key: string,
): T {
  const tree = p
    .findAll({ role: 'tree' })
    .find((item) =>
      ((item.props.items ?? []) as { key: string }[]).some((child) => child.key === key),
    )
  if (!tree) throw new Error(`ningún árbol tiene ${key}`)
  return tree
}

function treeItems(p: { findAll: (q: { role: string }) => { props: Record<string, unknown> }[] }) {
  return p.findAll({ role: 'tree' }).flatMap(
    (tree) =>
      (tree.props.items ?? []) as {
        key: string
        label: string
        description?: string
        icon?: string
      }[],
  )
}

describe('connections list', () => {
  test('offers a new connection when there are none', async () => {
    const p = await mount(panel, {
      host: mockHost({ requests: { 'connections.list': { saved: [], worktrees: [] } } }),
    })

    expect(p.find({ label: 'No hay conexiones' })).not.toBeNull()
    await p.press({ text: 'Nueva conexión' })
    expect(p.find({ label: 'Nombre' })).not.toBeNull()
  })

  test('groups the connections by where a table would open, marking the active workspace', async () => {
    const p = await mount(panel, {
      host: mockHost({
        requests: {
          'connections.list': {
            saved: [SHOP],
            worktrees: [
              API,
              { ...API, ref: 'env:DATABASE_URL:w2', name: 'web', workspaceId: 'w2' },
            ],
            activeWorkspaceId: 'w1',
          },
        },
      }),
    })

    // One tree per group: the workspace on screen, the other workspaces, and the saved ones.
    expect(p.findAll({ role: 'tree' })).toHaveLength(3)
    expect(p.find({ text: 'Activo' })).not.toBeNull()
    expect(p.find({ text: /Otras carpetas/ })).not.toBeNull()
    expect(p.find({ text: 'Guardadas' })).not.toBeNull()
    expect(
      p
        .findAll({ role: 'tree' })
        .map((tree) => (tree.props.items as { label: string }[]).map((item) => item.label)),
    ).toEqual([['api'], ['web'], ['shop.db']])
  })

  test('a worktree connection without a known active workspace stays in one group', async () => {
    const p = await mount(panel, {
      host: mockHost({ requests: { 'connections.list': { saved: [SHOP], worktrees: [API] } } }),
    })

    expect(p.find({ text: 'Activo' })).toBeNull()
    expect(p.find({ text: /Carpetas abiertas en Orca/ })).not.toBeNull()
    expect(p.findAll({ role: 'tree' })).toHaveLength(2)
  })

  test('each connection is marked with its origin', async () => {
    const p = await mount(panel, {
      host: mockHost({
        requests: {
          'connections.list': { saved: [SHOP], worktrees: [API], activeWorkspaceId: 'w1' },
        },
      }),
    })

    expect(
      p
        .findAll({ role: 'tree' })
        .flatMap((tree) =>
          (tree.props.items as { label: string; description: string; icon: string }[]).map(
            ({ label, description, icon }) => ({ label, description, icon }),
          ),
        ),
    ).toEqual([
      { label: 'api', description: 'app@db:5432/shop', icon: 'branch' },
      { label: 'shop.db', description: 'data', icon: 'database' },
    ])
  })

  test('expanding a connection shows its schemas, tables and views', async () => {
    const host = mockHost({
      requests: {
        'connections.list': { saved: [SHOP], worktrees: [] },
        'explorer.listObjects': SHOP_TREE,
      },
    })
    const p = await mount(panel, { host })
    const tree = { role: 'tree' }
    const connectionKey = JSON.stringify(['connection', SHOP.ref])
    const schemaKey = JSON.stringify(['schema', SHOP.ref, 'main'])

    await p.expand(tree, connectionKey)
    await p.expand(tree, schemaKey)

    expect(p.find({ text: /orders/ })).not.toBeNull()
    expect(p.find({ text: /recent_orders/ })).not.toBeNull()
    expect(host.callsOf('plugin.request')).toContainEqual({
      name: 'explorer.listObjects',
      input: { ref: SHOP.ref },
    })
  })

  test('Enter on a worktree connection opens nothing', async () => {
    const host = mockHost({ requests: { 'connections.list': { saved: [], worktrees: [API] } } })
    const p = await mount(panel, { host })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', API.ref]))

    expect(p.find({ label: 'Nombre' })).toBeNull()
    expect(host.callsOf('plugin.request')).not.toContainEqual(
      expect.objectContaining({ name: 'connection.get' }),
    )
  })
})

describe('SQLite in the connection form', () => {
  const SQLITE_FORM = { name: 'shop.db', engine: 'sqlite' as const, path: '/data/shop.db' }

  async function mountWith(requests: Record<string, unknown> = {}, storage = {}) {
    const host = mockHost({
      storage,
      requests: {
        'connections.list': { saved: [SHOP], worktrees: [] },
        'sqlite.findFiles': FOUND,
        ...requests,
      } as never,
    })
    return { host, p: await mount(panel, { host }) }
  }

  test('choosing SQLite asks for a path instead of a server', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'Nueva conexión' })
    await p.select({ label: 'Motor' }, 'sqlite')

    expect(p.find({ label: 'Ruta' })).not.toBeNull()
    expect(p.find({ label: 'Host' })).toBeNull()
    expect(p.find({ label: 'Contraseña' })).toBeNull()
    expect(p.find({ label: 'Cadena de conexión' })).toBeNull()
  })

  test('saves a pasted path with its name', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.save': (input: unknown) => {
        saved = input
        return SHOP
      },
    })

    await p.press({ label: 'Nueva conexión' })
    await p.select({ label: 'Motor' }, 'sqlite')
    await p.type({ label: 'Nombre' }, 'Shop')
    await p.type({ label: 'Ruta' }, '/data/shop.db')
    await p.press({ text: 'Guardar' })

    expect(saved).toEqual({ form: { name: 'Shop', engine: 'sqlite', path: '/data/shop.db' } })
    expect(p.find({ label: 'Ruta' })).toBeNull()
  })

  test('a file found in the workspaces fills the path, and the name when it is empty', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'Nueva conexión' })
    await p.select({ label: 'Motor' }, 'sqlite')
    await p.press({ text: 'Buscar en los espacios de trabajo' })
    await p.press({ label: 'app.db' })

    expect(p.find({ label: 'Ruta' })?.props.value).toBe('/work/api/app.db')
    expect(p.find({ label: 'Nombre' })?.props.value).toBe('app.db')
  })

  test('shows why a file could not be saved and keeps the form open', async () => {
    const { p } = await mountWith({
      'connection.save': () => {
        throw hostError('action_failed', '/tmp/notes.txt no es una base de datos SQLite')
      },
    })

    await p.press({ label: 'Nueva conexión' })
    await p.select({ label: 'Motor' }, 'sqlite')
    await p.type({ label: 'Nombre' }, 'Notes')
    await p.type({ label: 'Ruta' }, '/tmp/notes.txt')
    await p.press({ text: 'Guardar' })

    expect(p.find({ text: /no es una base de datos SQLite/ })).not.toBeNull()
    expect(p.find({ label: 'Ruta' })).not.toBeNull()
  })

  test('Enter on a saved SQLite file edits it; Delete only forgets the file', async () => {
    let deleted: unknown
    const { p } = await mountWith({
      'connection.get': { form: SQLITE_FORM, hasPassword: false },
      'connection.delete': (input: unknown) => {
        deleted = input
        return {}
      },
    })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', SHOP.ref]))

    expect(p.find({ label: 'Ruta' })?.props.value).toBe('/data/shop.db')
    expect(p.find({ text: /Sigue en el disco/ })).not.toBeNull()
    await p.press({ text: 'Eliminar' })
    expect(deleted).toEqual({ ref: SHOP.ref })
  })

  test('the Open SQLite File command opens the form on SQLite', async () => {
    const { host, p } = await mountWith({}, { [SQLITE_FORM_REQUEST_KEY]: true })

    expect(p.find({ label: 'Motor' })?.props.value).toBe('sqlite')
    expect(p.find({ label: 'Ruta' })).not.toBeNull()
    expect(host.data().storage[SQLITE_FORM_REQUEST_KEY]).toBe(false)
  })

  test('the command opens the form while the panel is open', async () => {
    const { p } = await mountWith()

    await p.post('sqlite.formRequested', {})

    expect(p.find({ label: 'Ruta' })).not.toBeNull()
  })

  test('switching from SQLite to MySQL gives the MySQL port', async () => {
    const { p } = await mountWith()

    await p.post('sqlite.formRequested', {})
    await p.select({ label: 'Motor' }, 'mysql')

    expect(p.find({ label: 'Puerto' })?.props.value).toBe('3306')
  })

  test('the command turns a new form to SQLite, keeping what was typed', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Nombre' }, 'Mine')
    await p.post('sqlite.formRequested', {})

    expect(p.find({ label: 'Motor' })?.props.value).toBe('sqlite')
    expect(p.find({ label: 'Nombre' })?.props.value).toBe('Mine')
  })

  test('the command leaves a connection being edited alone', async () => {
    const PG_EDIT = {
      name: 'Shop DB',
      engine: 'postgres' as const,
      host: 'db.internal',
      port: 5432,
      database: 'shop',
      user: 'app',
    }
    const { p } = await mountWith({ 'connection.get': { form: PG_EDIT, hasPassword: true } })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', SHOP.ref]))
    await p.type({ label: 'Contraseña' }, 'typed')
    await p.post('sqlite.formRequested', {})

    expect(p.find({ label: 'Host' })?.props.value).toBe('db.internal')
    expect(p.find({ label: 'Contraseña' })?.props.value).toBe('typed')
  })
})

describe('provider tabs', () => {
  const SHOP_PROJECT = { id: 'p1', name: 'shop', detail: 'aws-eu-central-1 · PG 17' }

  async function mountWith(requests: Record<string, unknown> = {}) {
    const host = mockHost({
      requests: {
        'connections.list': { saved: [SHOP], worktrees: [] },
        'provider.view': { keys: [], projects: [] },
        ...requests,
      } as never,
    })
    return { host, p: await mount(panel, { host }) }
  }

  test('offers the three tabs and opens on the workspaces one', async () => {
    const { p } = await mountWith()

    expect(p.find({ role: 'tab', text: 'Orca Workspaces' })).not.toBeNull()
    expect(p.find({ role: 'tab', text: 'Neon' })).not.toBeNull()
    expect(p.find({ role: 'tab', text: 'Supabase' })).not.toBeNull()
    expect(p.find({ label: 'Token o ruta al .env' })).toBeNull()
  })

  test('the Neon tab takes a token, or the path of a file that holds it', async () => {
    const asked: unknown[] = []
    const { p } = await mountWith({
      'provider.addKey': (input: unknown) => {
        asked.push(input)
        return { keys: [{ masked: 'napi_ab…f456' }], projects: [SHOP_PROJECT] }
      },
    })

    await p.select({ label: 'Origen de las conexiones' }, 'neon')
    await p.type({ label: 'Token o ruta al .env' }, '/Users/dev/api/.env')
    await p.press({ text: 'Guardar token' })

    expect(asked).toEqual([{ provider: 'neon', value: '/Users/dev/api/.env' }])
    expect(p.find({ text: /napi_ab…f456/ })).not.toBeNull()
    expect(p.find({ text: /shop/ })).not.toBeNull()
  })

  test('says why the provider refused the token', async () => {
    const { p } = await mountWith({
      'provider.view': {
        keys: [{ masked: 'sbp_ab…c789' }],
        projects: [],
        error: 'Supabase rechazó el token (401). Revisa que sea un personal access token.',
      },
    })

    await p.select({ label: 'Origen de las conexiones' }, 'supabase')

    expect(p.find({ text: /Supabase rechazó el token/ })).not.toBeNull()
    expect(p.find({ text: /sbp_ab…c789/ })).not.toBeNull()
  })

  test('lists the stored accounts and switches between them', async () => {
    const asked: unknown[] = []
    const { p } = await mountWith({
      'provider.view': (input: { provider: string; keyId?: string }) => {
        asked.push(input)
        return {
          keys: [
            { id: 'k1', masked: 'napi_ab…f456', label: 'yuniorglez-projects' },
            { id: 'k2', masked: 'napi_cd…e789', label: 'yunior@squaads.com' },
          ],
          selected: input.keyId ?? 'k1',
          projects: [],
        }
      },
    })

    await p.select({ label: 'Origen de las conexiones' }, 'neon')

    const accounts = p.find({ label: 'Cuenta' })
    expect(accounts?.props.options).toEqual([
      { value: 'k1', label: 'yuniorglez-projects · napi_ab…f456' },
      { value: 'k2', label: 'yunior@squaads.com · napi_cd…e789' },
    ])

    await p.select({ label: 'Cuenta' }, 'k2')

    expect(asked.at(-1)).toEqual({ provider: 'neon', keyId: 'k2' })
  })

  test('a provider with no keys explains where to get one', async () => {
    const { p } = await mountWith()

    await p.select({ label: 'Origen de las conexiones' }, 'neon')

    expect(p.find({ text: /Sin token todavía/ })).not.toBeNull()
    expect(p.find({ text: /Account settings/ })).not.toBeNull()
  })
})

describe('opening a table', () => {
  const tree = { role: 'tree' }
  const connectionKey = JSON.stringify(['connection', SHOP.ref])
  const ordersKey = JSON.stringify(['object', SHOP.ref, 'main', 'orders'])

  async function mountShop(open: (input: unknown) => unknown) {
    const host = mockHost({
      requests: {
        'connections.list': { saved: [SHOP], worktrees: [] },
        'explorer.listObjects': {
          schemas: [{ name: 'main', objects: [{ name: 'orders', kind: 'table' }] }],
        },
        'table.open': open as never,
      },
    })
    const p = await mount(panel, {
      host,
      persisted: {
        plugin: {
          'explorer-expanded': [connectionKey, JSON.stringify(['schema', SHOP.ref, 'main'])],
        },
      },
    })
    return { host, p }
  }

  test('asks the worker to open the table that was activated', async () => {
    const { host, p } = await mountShop(() => ({ status: 'opened', path: '.db-studio/orders.sql' }))

    await p.activateItem(tree, ordersKey)

    expect(host.callsOf('plugin.request')).toContainEqual({
      name: 'table.open',
      input: { ref: SHOP.ref, schema: 'main', table: 'orders' },
    })
  })

  test('offers the workspaces when the worker cannot pick one, then opens in the chosen one', async () => {
    const calls: unknown[] = []
    const { p } = await mountShop((input) => {
      calls.push(input)
      return calls.length === 1
        ? { status: 'choose-workspace', workspaces: [{ id: 'w1', name: 'api' }] }
        : { status: 'opened', path: '.db-studio/orders.sql' }
    })

    await p.activateItem(tree, ordersKey)
    await p.press({ label: 'api' })

    expect(calls[1]).toEqual({ ref: SHOP.ref, schema: 'main', table: 'orders', workspaceId: 'w1' })
    expect(p.find({ text: /En qué espacio de trabajo/ })).toBeNull()
  })

  test('shows why the table could not be opened', async () => {
    const { p } = await mountShop(() => {
      throw hostError('action_failed', 'Abre un espacio de trabajo para abrir una tabla')
    })

    await p.activateItem(tree, ordersKey)

    expect(p.find({ text: /Abre un espacio de trabajo para abrir una tabla/ })).not.toBeNull()
  })

  test('says when the table was opened in another workspace', async () => {
    const { p } = await mountShop(() => ({
      status: 'opened',
      path: '.db-studio/orders.sql',
      workspace: { id: 'w1', name: 'generador_propuestas' },
      elsewhere: true,
    }))

    await p.activateItem(tree, ordersKey)

    expect(p.find({ text: /La tabla está en otro espacio de trabajo/ })).not.toBeNull()
    expect(p.find({ text: /generador_propuestas/ })).not.toBeNull()
  })

  test('stays quiet when the table opened where the person already was', async () => {
    const { p } = await mountShop(() => ({
      status: 'opened',
      path: '.db-studio/orders.sql',
      workspace: { id: 'w1', name: 'main' },
      elsewhere: false,
    }))

    await p.activateItem(tree, ordersKey)

    expect(p.find({ text: /La tabla está en otro espacio de trabajo/ })).toBeNull()
  })
})

describe('connection form', () => {
  const PG: ConnectionEntry = {
    ref: 'c1',
    name: 'Shop DB',
    detail: 'app@db.internal:5432/shop',
    origin: 'saved',
  }
  const FORM = {
    name: 'Shop DB',
    engine: 'postgres' as const,
    host: 'db.internal',
    port: 5432,
    database: 'shop',
    user: 'app',
  }

  async function mountWith(requests: Record<string, unknown> = {}) {
    const host = mockHost({
      requests: {
        'connections.list': { saved: [PG], worktrees: [] },
        ...requests,
      } as never,
    })
    return { host, p: await mount(panel, { host }) }
  }

  test('pasting a connection string fills every field it contains', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Cadena de conexión' }, 'postgresql://app:p%40ss@db.internal:6543/shop')

    expect(p.find({ label: 'Host' })?.props.value).toBe('db.internal')
    expect(p.find({ label: 'Puerto' })?.props.value).toBe('6543')
    expect(p.find({ label: 'Base de datos' })?.props.value).toBe('shop')
    expect(p.find({ label: 'Usuario' })?.props.value).toBe('app')
    expect(p.find({ label: 'Contraseña' })?.props.value).toBe('p@ss')
  })

  test('a mysql:// string selects MySQL with its default port', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Cadena de conexión' }, 'mysql://root@localhost/app')

    expect(p.find({ label: 'Motor' })?.props.value).toBe('mysql')
    expect(p.find({ label: 'Puerto' })?.props.value).toBe('3306')
  })

  test('saves the form values and the password through the worker', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.save': (input: unknown) => {
        saved = input
        return PG
      },
    })

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Cadena de conexión' }, 'postgres://app:pw@db.internal/shop')
    await p.type({ label: 'Nombre' }, 'Shop DB')
    await p.press({ text: 'Guardar' })

    expect(saved).toEqual({ form: FORM, password: 'pw' })
    expect(p.find({ label: 'Cadena de conexión' })).toBeNull()
  })

  test('shows why saving failed and keeps the form open', async () => {
    const { p } = await mountWith({
      'connection.save': () => {
        throw hostError('action_failed', 'El almacén de secretos de Orca no está disponible')
      },
    })

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Cadena de conexión' }, 'postgres://app:pw@db.internal/shop')
    await p.type({ label: 'Nombre' }, 'Shop DB')
    await p.press({ text: 'Guardar' })

    expect(p.find({ text: /almacén de secretos/ })).not.toBeNull()
    expect(p.find({ label: 'Host' })).not.toBeNull()
  })

  test('tests the connection and reports the result', async () => {
    const { p } = await mountWith({ 'connection.test': () => ({}) })

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Cadena de conexión' }, 'postgres://app@db.internal/shop')
    await p.type({ label: 'Nombre' }, 'Shop DB')
    await p.press({ text: 'Probar' })

    expect(p.find({ text: /La conexión funciona/ })).not.toBeNull()
  })

  test('edits a saved connection without asking for its password again', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.get': { form: FORM, hasPassword: true },
      'connection.save': (input: unknown) => {
        saved = input
        return PG
      },
    })

    await p.activateItem(
      treeWith(p, JSON.stringify(['connection', 'c1'])),
      JSON.stringify(['connection', 'c1']),
    )
    await p.type({ label: 'Host' }, 'db2.internal', { replace: true })
    await p.press({ text: 'Guardar' })

    expect(saved).toEqual({ ref: 'c1', form: { ...FORM, host: 'db2.internal' } })
  })

  test('deletes a saved connection', async () => {
    let deleted: unknown
    const { p } = await mountWith({
      'connection.get': { form: FORM, hasPassword: false },
      'connection.delete': (input: unknown) => {
        deleted = input
        return {}
      },
    })

    await p.activateItem(
      treeWith(p, JSON.stringify(['connection', 'c1'])),
      JSON.stringify(['connection', 'c1']),
    )
    await p.press({ text: 'Eliminar' })

    expect(deleted).toEqual({ ref: 'c1' })
  })

  test('pasting a string without user or database keeps what was typed', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Base de datos' }, 'shop')
    await p.type({ label: 'Usuario' }, 'app')
    await p.type({ label: 'Cadena de conexión' }, 'postgres://db.internal:5432')

    expect(p.find({ label: 'Host' })?.props.value).toBe('db.internal')
    expect(p.find({ label: 'Base de datos' })?.props.value).toBe('shop')
    expect(p.find({ label: 'Usuario' })?.props.value).toBe('app')
  })

  test('an IPv6 host is filled without its brackets', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Cadena de conexión' }, 'postgres://app@[::1]:5432/shop')

    expect(p.find({ label: 'Host' })?.props.value).toBe('::1')
  })

  test('a failed load of a connection shows the error and opens no form', async () => {
    const { p } = await mountWith({
      'connection.get': () => {
        throw hostError('action_failed', 'secrets store failed')
      },
    })

    await p.activateItem(
      treeWith(p, JSON.stringify(['connection', 'c1'])),
      JSON.stringify(['connection', 'c1']),
    )

    expect(p.find({ text: /secrets store failed/ })).not.toBeNull()
    expect(p.find({ label: 'Host' })).toBeNull()
  })

  test('saving an edit reloads the tables the explorer had cached', async () => {
    let listed = 0
    const { p } = await mountWith({
      'connection.get': { form: FORM, hasPassword: true },
      'connection.save': PG,
      'explorer.listObjects': () => {
        listed += 1
        return { schemas: [] }
      },
    })
    const tree = { role: 'tree' }

    await p.expand(tree, JSON.stringify(['connection', 'c1']))
    await p.activateItem(tree, JSON.stringify(['connection', 'c1']))
    await p.press({ text: 'Guardar' })

    expect(listed).toBe(2)
  })

  test('opens a table on a saved connection', async () => {
    const { host, p } = await mountWith({
      'explorer.listObjects': {
        schemas: [{ name: 'public', objects: [{ name: 'users', kind: 'table' }] }],
      },
      'table.open': { status: 'opened', path: '.db-studio/users.sql' },
    })
    const tree = { role: 'tree' }

    await p.expand(tree, JSON.stringify(['connection', 'c1']))
    await p.expand(tree, JSON.stringify(['schema', 'c1', 'public']))
    await p.activateItem(tree, JSON.stringify(['object', 'c1', 'public', 'users']))

    expect(host.callsOf('plugin.request')).toContainEqual({
      name: 'table.open',
      input: { ref: 'c1', schema: 'public', table: 'users' },
    })
  })

  test('a pasted sslmode fills the encryption field and travels to the worker', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.save': (input: unknown) => {
        saved = input
        return PG
      },
    })

    await p.press({ label: 'Nueva conexión' })
    await p.type(
      { label: 'Cadena de conexión' },
      'postgresql://app:pw@ep-cool-rain.eu-central-1.aws.neon.tech/shop?sslmode=require',
    )
    await p.type({ label: 'Nombre' }, 'Neon')

    // The field follows the URL: that is the whole point of reading the parameter.
    expect(p.find({ label: 'Cifrado' })?.props.value).toBe('require')

    await p.press({ text: 'Guardar' })

    expect(saved).toMatchObject({ form: { engine: 'postgres', ssl: 'require' } })
  })

  test('a failure that names sslmode offers a fix that encrypts and retries', async () => {
    const asked: { form: { ssl?: string } }[] = []
    const { p } = await mountWith({
      'connection.test': (input: { form: { ssl?: string } }) => {
        asked.push(input)
        // What Neon answers to a connection that arrives in the clear.
        if (!input.form.ssl)
          throw hostError('action_failed', 'connection is insecure (try using `sslmode=require`)')
        return {}
      },
    })

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Host' }, 'ep-cool-rain.eu-central-1.aws.neon.tech')
    await p.press({ text: 'Probar' })

    expect(p.find({ text: /connection is insecure/ })).not.toBeNull()
    await p.press({ text: /^Cifrar la conexión/ })

    expect(asked).toHaveLength(2)
    expect(asked[1]).toMatchObject({ form: { ssl: 'require' } })
    expect(p.find({ label: 'Cifrado' })?.props.value).toBe('require')
    expect(p.find({ text: /La conexión funciona/ })).not.toBeNull()
  })
})

describe('environment label', () => {
  const PROD_PG: ConnectionEntry = {
    ref: 'c1',
    name: 'Billing DB',
    detail: 'app@db:5432/billing',
    origin: 'saved',
    label: { environment: 'prod', tone: 'danger' },
  }
  const FORM = {
    name: 'Billing DB',
    engine: 'postgres' as const,
    host: 'db',
    port: 5432,
    database: 'billing',
    user: 'app',
  }

  async function mountWith(requests: Record<string, unknown> = {}) {
    const host = mockHost({
      requests: {
        'connections.list': { saved: [PROD_PG, SHOP], worktrees: [API] },
        ...requests,
      } as never,
    })
    return { host, p: await mount(panel, { host }) }
  }

  test('a connection row starts its description with the label', async () => {
    const { p } = await mountWith()

    // The worktree connection comes first: its group is the one that opens where the person looks.
    expect(treeItems(p).map((item) => item.description)).toEqual([
      'app@db:5432/shop',
      'prod · app@db:5432/billing',
      'data',
    ])
  })

  test('the form starts with no environment and a disabled color', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'Nueva conexión' })

    expect(p.find({ label: 'Entorno' })?.props.value).toBe('none')
    expect(p.find({ label: 'Color' })?.props.disabled).toBe(true)
  })

  test('choosing an environment enables the color and picks its default', async () => {
    const { p } = await mountWith()
    await p.press({ label: 'Nueva conexión' })

    await p.select({ label: 'Entorno' }, 'staging')

    expect(p.find({ label: 'Color' })?.props.disabled).toBeFalsy()
    expect(p.find({ label: 'Color' })?.props.value).toBe('warning')
  })

  test('changing the environment resets a color the person had picked', async () => {
    const { p } = await mountWith()
    await p.press({ label: 'Nueva conexión' })
    await p.select({ label: 'Entorno' }, 'dev')
    await p.select({ label: 'Color' }, 'neutral')

    await p.select({ label: 'Entorno' }, 'prod')

    expect(p.find({ label: 'Color' })?.props.value).toBe('danger')
  })

  test('the color offers Orca five tones', async () => {
    const { p } = await mountWith()
    await p.press({ label: 'Nueva conexión' })

    const options = p.find({ label: 'Color' })?.props.options as { value: string }[]

    expect(options.map((o) => o.value)).toEqual([
      'neutral',
      'accent',
      'success',
      'warning',
      'danger',
    ])
  })

  test('saves the environment and the chosen color with the connection', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.save': (input: unknown) => {
        saved = input
        return PROD_PG
      },
    })

    await p.press({ label: 'Nueva conexión' })
    await p.type({ label: 'Cadena de conexión' }, 'postgres://app@db:5432/billing')
    await p.type({ label: 'Nombre' }, 'Billing DB')
    await p.select({ label: 'Entorno' }, 'prod')
    await p.select({ label: 'Color' }, 'warning')
    await p.press({ text: 'Guardar' })

    expect(saved).toMatchObject({
      form: { name: 'Billing DB', label: { environment: 'prod', tone: 'warning' } },
    })
  })

  test('editing restores the saved environment and color', async () => {
    const { p } = await mountWith({
      'connection.get': {
        form: { ...FORM, label: { environment: 'dev', tone: 'neutral' } },
        hasPassword: true,
      },
    })

    await p.activateItem(
      treeWith(p, JSON.stringify(['connection', 'c1'])),
      JSON.stringify(['connection', 'c1']),
    )

    expect(p.find({ label: 'Entorno' })?.props.value).toBe('dev')
    expect(p.find({ label: 'Color' })?.props.value).toBe('neutral')
  })

  test('a connection saved before labels existed opens with no environment', async () => {
    const { p } = await mountWith({ 'connection.get': { form: FORM, hasPassword: true } })

    await p.activateItem(
      treeWith(p, JSON.stringify(['connection', 'c1'])),
      JSON.stringify(['connection', 'c1']),
    )

    expect(p.find({ label: 'Entorno' })?.props.value).toBe('none')
    expect(p.find({ label: 'Color' })?.props.disabled).toBe(true)
  })

  test('choosing None again removes the label from what is saved', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.get': {
        form: { ...FORM, label: { environment: 'prod', tone: 'danger' } },
        hasPassword: true,
      },
      'connection.save': (input: unknown) => {
        saved = input
        return PROD_PG
      },
    })

    await p.activateItem(
      treeWith(p, JSON.stringify(['connection', 'c1'])),
      JSON.stringify(['connection', 'c1']),
    )
    await p.select({ label: 'Entorno' }, 'none')
    await p.press({ text: 'Guardar' })

    expect(saved).toEqual({ ref: 'c1', form: FORM })
  })

  test('a SQLite file can carry one too', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.save': (input: unknown) => {
        saved = input
        return SHOP
      },
    })

    await p.press({ label: 'Nueva conexión' })
    await p.select({ label: 'Motor' }, 'sqlite')
    await p.type({ label: 'Ruta' }, '/data/shop.db')
    await p.select({ label: 'Entorno' }, 'local')
    await p.press({ text: 'Guardar' })

    expect(saved).toMatchObject({
      form: { engine: 'sqlite', label: { environment: 'local', tone: 'success' } },
    })
  })
})
