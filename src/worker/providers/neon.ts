// Neon: the projects an API key can reach, through the console API. Provider P1
import type { CloudProject } from '../../protocol'

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
}

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

/** Every project the keys reach, once each: two keys of one org list the same project. */
export async function listProjects(keys: string[]): Promise<CloudProject[]> {
  const byId = new Map<string, CloudProject>()
  for (const key of keys) {
    const { projects = [] } = await get<NeonProjects>(key, '/projects')
    for (const project of projects) {
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
