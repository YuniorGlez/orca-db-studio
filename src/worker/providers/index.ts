// One place for both hosted providers: their accounts, and the projects those accounts reach.
// P1, P2
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
import {
  connectionUri,
  listDatabases,
  listProjects as listNeon,
  accountLabel as neonLabel,
} from './neon'
import { listProjects as listSupabase, accountLabel as supabaseLabel } from './supabase'

const LISTERS: Record<Provider, (keys: string[]) => Promise<CloudProject[]>> = {
  neon: listNeon,
  supabase: listSupabase,
}

const LABELS: Record<Provider, (token: string) => Promise<string>> = {
  neon: neonLabel,
  supabase: supabaseLabel,
}

/** The account whose projects are listed: the one the panel picked, else the first stored. */
async function tokenFor(
  orca: OrcaWorkerApi,
  provider: Provider,
  keyId?: string,
): Promise<{ token: string; selected: string } | undefined> {
  const keys = await listKeys(orca, provider)
  const wanted = keyId ? keys.find((key) => key.id === keyId) : keys[0]
  if (!wanted) return undefined
  const [token] = await tokensOf(orca, provider, wanted.id)
  return token ? { token, selected: wanted.id } : undefined
}

async function view(
  orca: OrcaWorkerApi,
  provider: Provider,
  keyId?: string,
): Promise<ProviderView> {
  const keys = await listKeys(orca, provider)
  const chosen = await tokenFor(orca, provider, keyId)
  if (!chosen) return { keys, projects: [] }
  try {
    return { keys, selected: chosen.selected, projects: await LISTERS[provider]([chosen.token]) }
  } catch (error) {
    // A refused key must not hide the accounts already stored: it has to be replaceable.
    return {
      keys,
      selected: chosen.selected,
      projects: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function providerView(
  orca: OrcaWorkerApi,
  provider: Provider,
  keyId?: string,
): Promise<ProviderView> {
  return view(orca, provider, keyId)
}

/** Adds an account and shows its projects, so the selector lands on the one just added. */
export async function addProviderKey(
  orca: OrcaWorkerApi,
  provider: Provider,
  value: string,
): Promise<ProviderView> {
  await addKey(orca, provider, value, LABELS[provider])
  const keys = await listKeys(orca, provider)
  return view(orca, provider, keys[keys.length - 1]?.id)
}

export async function clearProviderKeys(
  orca: OrcaWorkerApi,
  provider: Provider,
  keyId?: string,
): Promise<ProviderView> {
  await clearKeys(orca, provider, keyId)
  return view(orca, provider)
}

/** The databases of one project, read when the person asks for them. */
export async function databasesOf(
  orca: OrcaWorkerApi,
  provider: Provider,
  projectId: string,
  keyId?: string,
): Promise<CloudDatabase[]> {
  const chosen = await tokenFor(orca, provider, keyId)
  if (!chosen) throw new Error('Guarda primero un token para este proveedor')
  if (provider !== 'neon') {
    throw new Error('Para Supabase falta la contraseña de la base: se añade en el siguiente paso')
  }
  return listDatabases([chosen.token], projectId)
}

/** Opens a provider's database as a connection: the API hands over the full string. */
export async function connectCloud(
  orca: OrcaWorkerApi,
  provider: Provider,
  projectId: string,
  databaseName: string,
  keyId?: string,
): Promise<ConnectionEntry> {
  if (provider !== 'neon') {
    throw new Error('Para Supabase falta la contraseña de la base: se añade en el siguiente paso')
  }
  const chosen = await tokenFor(orca, provider, keyId)
  if (!chosen) throw new Error('Guarda primero un token para este proveedor')
  const tokens = [chosen.token]
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
