// One place for both hosted providers: their stored keys, and the projects those keys reach. P1, P2
import type { OrcaWorkerApi } from 'orca/worker'
import type { CloudProject, Provider, ProviderView } from '../../protocol'
import { addKey, clearKeys, listKeys, tokensOf } from './keys'
import { listProjects as listNeon } from './neon'
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
