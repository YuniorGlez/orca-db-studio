// Asks which workspace gets a new query document when the focused one is ambiguous. E1
import { Button, Card, List, ListItem, read, Stack, Text } from 'orca'
import { cancelWorkspaceQuestion, openTable, workspaceQuestion } from './state'

export function WorkspacePicker() {
  const question = read(workspaceQuestion)
  if (!question) return null
  return (
    <Card title="¿En qué espacio de trabajo lo abro?">
      <Stack gap="sm">
        <Text muted>El documento de consulta de {question.table.table} va en .db-studio/.</Text>
        <List label="Espacios de trabajo">
          {question.workspaces.map((workspace) => (
            <ListItem
              key={workspace.id}
              title={workspace.name}
              icon="folder"
              onPress={() => openTable(question.table, workspace.id)}
            />
          ))}
        </List>
        <Button variant="ghost" onPress={cancelWorkspaceQuestion}>
          Cancelar
        </Button>
      </Stack>
    </Card>
  )
}
