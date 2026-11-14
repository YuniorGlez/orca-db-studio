// Whether a query document must offer the connection chooser, and what it tells the person. Q1
import type { ConnectionEntry, ConnectionList } from '../protocol'

export interface ChooserState {
  needsChoice: boolean
  notice: string | undefined
}

/** Every connection a document may name: saved connections, then worktree connections. */
export function connectionEntries(list: ConnectionList): ConnectionEntry[] {
  return [...list.saved, ...list.worktrees]
}

/**
 * `entries` is undefined when the registry could not be listed: the document's own line then
 * stands until `connection.info` says otherwise.
 */
export function chooserState(
  ref: string | undefined,
  entries: ConnectionEntry[] | undefined,
  readOnly: boolean,
): ChooserState {
  const stale = ref !== undefined && entries !== undefined && !entries.some((e) => e.ref === ref)
  const needsChoice = ref === undefined || stale
  let notice: string | undefined
  if (!needsChoice) notice = undefined
  else if (readOnly)
    notice = 'Este fichero es de solo lectura, así que no se le puede escribir una conexión.'
  else if (stale) notice = `La conexión ${ref} ya no existe. Elige otra.`
  else if (entries?.length === 0)
    notice = 'Aún no hay conexiones. Añade una en el panel de DB Studio.'
  return { needsChoice, notice }
}
