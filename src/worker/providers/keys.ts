// The API keys a hosted provider needs: read from a pasted token or from a file's .env line.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Provider, ProviderKey } from '../../protocol'

/** Where the keys of each provider are kept; a JSON array of tokens, never in storage. */
function secretKey(provider: Provider): string {
  return `provider:${provider}:keys`
}

/** The prefix a token of each provider starts with, when it has one. */
const PREFIXES: Record<Provider, string> = { neon: 'napi_', supabase: 'sbp_' }

/** A token as the person can be shown it: enough to recognise it, never the whole thing. */
export function maskKey(token: string): string {
  if (token.length <= 12) return `${token.slice(0, 2)}…`
  return `${token.slice(0, 7)}…${token.slice(-4)}`
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path
}

/** Whether the text is a path to a file rather than a token: one word, and no spaces or `=`. */
function looksLikePath(text: string): boolean {
  if (/\s|="/.test(text)) return false
  return text.startsWith('/') || text.startsWith('~/') || isAbsolute(text)
}

/** The token a .env text holds: the one with the provider's prefix, else the first key-looking one. */
export function tokenInEnv(text: string, provider: Provider): string | undefined {
  const prefix = PREFIXES[provider]
  let fallback: string | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const name = match[1] ?? ''
    const value = (match[2] ?? '').trim().replace(/^['"]|['"]$/g, '')
    if (!value) continue
    if (value.startsWith(prefix)) return value
    if (fallback === undefined && /(KEY|TOKEN|SECRET)/i.test(name)) fallback = value
  }
  return fallback
}

/**
 * What the person typed in the token field: the token itself, the path to a file that holds it,
 * or the contents of one pasted by mistake. Nothing is stored until it looks usable.
 */
export async function resolveKeyInput(input: string, provider: Provider): Promise<string> {
  const text = input.trim()
  if (!text) throw new Error('Pega un token o la ruta de un fichero con el token')
  const prefix = PREFIXES[provider]
  if (text.startsWith(prefix)) return text
  const envPasted = text.includes('\n') || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(text)
  if (!envPasted && looksLikePath(text)) {
    const path = expandHome(text)
    const contents = await readFile(path, 'utf8').catch(() => {
      throw new Error(`No se pudo leer ${path}`)
    })
    const found = tokenInEnv(contents, provider)
    if (!found) throw new Error(`${path} no contiene un token de ${provider}`)
    return found
  }
  if (envPasted) {
    const found = tokenInEnv(text, provider)
    if (!found) throw new Error(`Eso no parece un token de ${provider}`)
    return found
  }
  // A token without the documented prefix: accepted, the API is the judge.
  return text
}

async function readKeys(orca: OrcaWorkerApi, provider: Provider): Promise<string[]> {
  const raw = await orca.secrets.get(secretKey(provider))
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

async function writeKeys(orca: OrcaWorkerApi, provider: Provider, keys: string[]): Promise<void> {
  if (keys.length === 0) await orca.secrets.delete(secretKey(provider))
  else await orca.secrets.set(secretKey(provider), JSON.stringify(keys))
}

export async function listKeys(orca: OrcaWorkerApi, provider: Provider): Promise<ProviderKey[]> {
  return (await readKeys(orca, provider)).map((token) => ({ masked: maskKey(token) }))
}

/** Stores a key the person just gave; one already stored is not added twice. */
export async function addKey(
  orca: OrcaWorkerApi,
  provider: Provider,
  input: string,
): Promise<ProviderKey[]> {
  const token = await resolveKeyInput(input, provider)
  const keys = await readKeys(orca, provider)
  if (!keys.includes(token)) keys.push(token)
  await writeKeys(orca, provider, keys)
  return listKeys(orca, provider)
}

/** Forgets every key of the provider. */
export async function clearKeys(orca: OrcaWorkerApi, provider: Provider): Promise<void> {
  await writeKeys(orca, provider, [])
}

export function tokensOf(orca: OrcaWorkerApi, provider: Provider): Promise<string[]> {
  return readKeys(orca, provider)
}
