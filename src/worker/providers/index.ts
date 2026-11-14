// One place for both hosted providers: their stored keys, and the projects those keys reach. P1, P2
import type { OrcaWorkerApi } from 'orca/worker'
import type {
  CloudDatabase,
  CloudProject,
  ConnectionEntry,
  Provider,
  ProviderView,
} from '../../protocol'
import { addCloud } from '../cloud-connections'
import { addKey, clearKeys, listKeys, tokensOf } from './keys'
import { connectionUri, listDatabases, listProjects as listNeon } from './neon'
import { listProjects as listSupabase } from './supabase'

const LISTERS: Record<Provider, (keys: string[]) => Promise<CloudProject[]>> = {
  neon: listNeon,
  supabase: listSupabase,
}

async function view(orca: OrcaWorkerApi, provider: Provider): Promise<ProviderView> {
  const keys = await listKeys(orca, provider)
  if (keys.length === 0) return { keys, projects: [] }
  const tokens = await tokensOf(orca, provider)
  try {
    return { keys, projects: await LISTERS[provider](tokens) }
  } catch (error) {
    // A refused key must not hide the keys already stored: the person has to be able to replace it.
    return { keys, projects: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export function providerView(orca: OrcaWorkerApi, provider: Provider): Promise<ProviderView> {
  return view(orca, provider)
}

export async function addProviderKey(
  orca: OrcaWorkerApi,
  provider: Provider,
  value: string,
): Promise<ProviderView> {
  await addKey(orca, provider, value)
  return view(orca, provider)
}

export async function clearProviderKeys(
  orca: OrcaWorkerApi,
  provider: Provider,
): Promise<ProviderView> {
  await clearKeys(orca, provider)
  return view(orca, provider)
}

/** The databases of one project, read when the person asks for them. */
export async function databasesOf(
  orca: OrcaWorkerApi,
  provider: Provider,
  projectId: string,
): Promise<CloudDatabase[]> {
  const tokens = await tokensOf(orca, provider)
  if (tokens.length === 0) throw new Error('Guarda primero un token para este proveedor')
  if (provider !== 'neon') {
    throw new Error('Para Supabase falta la contraseña de la base: se añade en el siguiente paso')
  }
  return listDatabases(tokens, projectId)
}

/** Opens a provider's database as a connection: the API hands over the full string. */
export async function connectCloud(
  orca: OrcaWorkerApi,
  provider: Provider,
  projectId: string,
  databaseName: string,
): Promise<ConnectionEntry> {
  if (provider !== 'neon') {
    throw new Error('Para Supabase falta la contraseña de la base: se añade en el siguiente paso')
  }
  const tokens = await tokensOf(orca, provider)
  if (tokens.length === 0) throw new Error('Guarda primero un token para este proveedor')
  const databases = await listDatabases(tokens, projectId)
  const database = databases.find((candidate) => candidate.name === databaseName)
  if (!database) throw new Error(`La base ${databaseName} ya no está en ese proyecto`)
  const uri = await connectionUri(tokens, projectId, database)
  const projectName = (await listNeon(tokens)).find((p) => p.id === projectId)?.name ?? projectId
  const parsed = new URL(uri.replace(/^postgres(ql)?:\/\//, 'http://'))
  return addCloud(
    orca,
    {
      provider,
      projectId,
      database: database.name,
      name: `${projectName} · ${database.name}`,
      detail: `${parsed.host}${parsed.pathname}`,
    },
    uri,
  )
}
