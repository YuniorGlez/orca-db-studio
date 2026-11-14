// The hosted providers' tabs: their keys, the projects those keys reach, and which tab is open. P1, P2
import { atom, plugin, read, set } from 'orca'
import type { Provider, ProviderView } from '../protocol'
import type { Loadable } from './state'

/** Which tab of the panel is open; `workspaces` is the connections Orca already knows. */
export type PanelTab = Provider | 'workspaces'

export const activeTab = atom<PanelTab>('panel-tab', 'workspaces', { persist: 'plugin' })

/** What the person has typed in each provider's token field, and nothing else. */
export const providerInput = atom<Record<Provider, string>>({ neon: '', supabase: '' })

export const providerViews = atom<Record<Provider, Loadable<ProviderView>>>({
  neon: { status: 'loading' },
  supabase: { status: 'loading' },
})

export const providerBusy = atom<Provider | null>(null)

function setView(provider: Provider, view: Loadable<ProviderView>): void {
  set(providerViews, { ...read(providerViews), [provider]: view })
}

export function openTab(tab: PanelTab): void {
  set(activeTab, tab)
  if (tab !== 'workspaces') void loadProvider(tab)
}

export function typeProviderInput(provider: Provider, value: string): void {
  set(providerInput, { ...read(providerInput), [provider]: value })
}

async function run(provider: Provider, request: () => Promise<ProviderView>): Promise<void> {
  if (read(providerBusy)) return
  set(providerBusy, provider)
  try {
    setView(provider, { status: 'loaded', value: await request() })
  } catch (error) {
    setView(provider, {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    set(providerBusy, null)
  }
}

/** Reads the keys and the projects again; a provider without keys answers with no projects. */
export function loadProvider(provider: Provider): Promise<void> {
  return run(provider, () => plugin.request('provider.view', { provider }))
}

/** Stores the token or the path that holds it, then lists what it reaches. */
export function addProviderKey(provider: Provider): Promise<void> {
  const value = read(providerInput)[provider].trim()
  if (!value) {
    setView(provider, { status: 'error', error: 'Pega un token o la ruta de un fichero con él' })
    return Promise.resolve()
  }
  return run(provider, async () => {
    const view = await plugin.request('provider.addKey', { provider, value })
    typeProviderInput(provider, '')
    return view
  })
}

export function clearProviderKeys(provider: Provider): Promise<void> {
  return run(provider, () => plugin.request('provider.clearKeys', { provider }))
}
