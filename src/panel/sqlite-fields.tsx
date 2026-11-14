// The connection form's fields for a SQLite file: a pasted path, or one found in the workspaces. C3
import { Button, Input, List, ListItem, read, Spinner, Text } from 'orca'
import {
  chooseFoundFile,
  editDraft,
  type FormDraft,
  findInWorkspaces,
  findingFiles,
} from './connection-form-state'
import { foundFiles } from './state'

function FoundFiles() {
  const found = read(foundFiles)
  if (found.status === 'loading') return <Spinner label="Buscando ficheros SQLite" />
  if (found.status === 'error') return <Text tone="danger">{found.error}</Text>
  if (found.value.length === 0)
    return <Text muted>No se han encontrado ficheros SQLite en tus espacios de trabajo.</Text>
  return (
    <List label="Ficheros SQLite en tus espacios de trabajo">
      {found.value.map((file) => (
        <ListItem
          key={file.path}
          title={file.relativePath}
          description={file.workspaceName}
          icon="database"
          onPress={() => chooseFoundFile(file)}
        />
      ))}
    </List>
  )
}

interface SqliteFieldsProps {
  draft: FormDraft
}

export function SqliteFields({ draft }: SqliteFieldsProps) {
  return (
    <>
      <Input
        label="Ruta"
        placeholder="/path/to/database.db"
        value={draft.path}
        onChange={(path) => editDraft({ path })}
      />
      {read(findingFiles) ? (
        <FoundFiles />
      ) : (
        <Button variant="ghost" onPress={findInWorkspaces}>
          Buscar en los espacios de trabajo
        </Button>
      )}
      {draft.ref === undefined ? null : (
        <Text muted>Eliminar solo olvida el fichero. Sigue en el disco.</Text>
      )}
    </>
  )
}
