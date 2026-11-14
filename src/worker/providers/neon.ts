// Neon: the projects an API key can reach, through the console API. Provider P1
import type { CloudDatabase, CloudProject } from '../../protocol'

const BASE = 'https://console.neon.tech/api/v2'

interface NeonProject {
  id?: string
  name?: string
  region_id?: string
  pg_version?: number
  org_id?: string
}

interface NeonProjects {
  projects?: NeonProject[]
  /** The cursor of the next page; the API answers ten projects unless `limit` says otherwise. */
  pagination?: { cursor?: string }
}

/** Neon pages its projects, so a big account needs a few calls; this is the most it will do. */
const PAGE_LIMIT = 100
const MAX_PAGES = 20

async function get<T>(key: string, path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
  } catch (error) {
    throw new Error(`No se pudo hablar con Neon: ${(error as Error).message}`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Neon rechazó la API key (401). Revisa que sea de tu organización.')
  }
  if (!response.ok) throw new Error(`Neon respondió ${response.status}`)
  return (await response.json()) as T
}

/** Every project one key reaches, following the API's cursor to the last page. */
async function projectsOf(key: string): Promise<NeonProject[]> {
  const byId = new Map<string, NeonProject>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) query.set('cursor', cursor)
    const body = await get<NeonProjects>(key, `/projects?${query.toString()}`)
    const batch = body.projects ?? []
    for (const project of batch) if (project.id) byId.set(project.id, project)
    const next = body.pagination?.cursor
    // The last page repeats its cursor, and an empty page means there is nothing after it.
    if (batch.length === 0 || !next || next === cursor) break
    cursor = next
  }
  return [...byId.values()]
}

/** Every project the keys reach, once each: two keys of one org list the same project. */
export async function listProjects(keys: string[]): Promise<CloudProject[]> {
  const byId = new Map<string, CloudProject>()
  for (const key of keys) {
    for (const project of await projectsOf(key)) {
      if (!project.id || byId.has(project.id)) continue
      byId.set(project.id, {
        id: project.id,
        name: project.name ?? project.id,
        detail: [project.region_id, project.pg_version ? `PG ${project.pg_version}` : undefined]
          .filter(Boolean)
          .join(' · '),
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined))
}

interface NeonBranch {
  id?: string
  name?: string
  default?: boolean
}

interface NeonDatabase {
  name?: string
  owner_name?: string
}

async function firstKeyThatAnswers<T>(
  keys: string[],
  read: (key: string) => Promise<T>,
): Promise<T> {
  let last: Error | undefined
  for (const key of keys) {
    try {
      return await read(key)
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw last ?? new Error('No hay ninguna API key de Neon guardada')
}

/** The databases of a project, on its default branch: the branch is what holds them. */
export async function listDatabases(keys: string[], projectId: string): Promise<CloudDatabase[]> {
  return firstKeyThatAnswers(keys, async (key) => {
    const { branches = [] } = await get<{ branches?: NeonBranch[] }>(
      key,
      `/projects/${encodeURIComponent(projectId)}/branches`,
    )
    const branch = branches.find((b) => b.default) ?? branches[0]
    if (!branch?.id) return []
    const { databases = [] } = await get<{ databases?: NeonDatabase[] }>(
      key,
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}/databases`,
    )
    return databases
      .filter((database) => database.name)
      .map((database) => ({
        name: database.name ?? '',
        role: database.owner_name ?? 'neondb_owner',
        branch: branch.name,
      }))
  })
}

/** The full connection string of one database, password included: the API hands it over. */
export async function connectionUri(
  keys: string[],
  projectId: string,
  database: CloudDatabase,
): Promise<string> {
  return firstKeyThatAnswers(keys, async (key) => {
    const query = new URLSearchParams({ database_name: database.name, role_name: database.role })
    const { uri } = await get<{ uri?: string }>(
      key,
      `/projects/${encodeURIComponent(projectId)}/connection_uri?${query.toString()}`,
    )
    if (!uri) throw new Error('Neon no devolvió una cadena de conexión para esa base')
    return uri
  })
}

interface NeonUser {
  email?: string
  name?: string
}

interface NeonOrganizations {
  organizations?: { id?: string; name?: string }[]
}

/**
 * How the selector names the account a token belongs to: its email when the key is personal, the
 * organization's name when it is an organization key (those cannot read `/users/me`).
 */
export async function accountLabel(key: string): Promise<string> {
  const user = await get<NeonUser>(key, '/users/me').catch(() => undefined)
  if (user?.email) return user.email
  const { organizations = [] } = await get<NeonOrganizations>(key, '/users/me/organizations')
  const names = organizations.map((org) => org.name).filter((name): name is string => !!name)
  const [first = '', ...rest] = names
  if (!first) throw new Error('Neon no dijo a qué cuenta pertenece la key')
  return rest.length === 0 ? first : `${first} +${rest.length}`
}
