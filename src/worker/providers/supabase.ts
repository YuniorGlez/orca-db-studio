// Supabase: the projects a personal access token can reach, through the Management API. Provider P2
import type { CloudProject } from '../../protocol'

const BASE = 'https://api.supabase.com/v1'

interface SupabaseProject {
  ref?: string
  id?: string
  name?: string
  region?: string
  status?: string
  database?: { version?: string }
}

async function get<T>(token: string, path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
  } catch (error) {
    throw new Error(`No se pudo hablar con Supabase: ${(error as Error).message}`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Supabase rechazó el token (401). Revisa que sea un personal access token.')
  }
  if (!response.ok) throw new Error(`Supabase respondió ${response.status}`)
  return (await response.json()) as T
}

/** Every project the token reaches, once each. */
export async function listProjects(tokens: string[]): Promise<CloudProject[]> {
  const byRef = new Map<string, CloudProject>()
  for (const token of tokens) {
    const projects = await get<SupabaseProject[]>(token, '/projects')
    for (const project of projects) {
      const ref = project.ref ?? project.id
      if (!ref || byRef.has(ref)) continue
      byRef.set(ref, {
        id: ref,
        name: project.name ?? ref,
        detail: [project.region, project.status?.toLowerCase(), project.database?.version]
          .filter(Boolean)
          .join(' · '),
      })
    }
  }
  return [...byRef.values()].sort((a, b) => a.name.localeCompare(b.name, undefined))
}
