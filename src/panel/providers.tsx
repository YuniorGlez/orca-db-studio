// The Neon and Supabase tabs: where the token goes, and what it reaches. P1, P2
import { Badge, Button, Callout, Input, Row, read, Select, Skeleton, Stack, Text } from 'orca'
import type { Provider } from '../protocol'
import {
  addProviderKey,
  clearProviderKeys,
  connectBusy,
  loadDatabases,
  loadProvider,
  openDatabase,
  providerAccount,
  providerBusy,
  providerDatabases,
  providerInput,
  providerNotice,
  providerViews,
  selectAccount,
  typeProviderInput,
} from './provider-state'

interface ProviderCopy {
  title: string
  hint: string
  placeholder: string
  where: string
}

const COPY: Record<Provider, ProviderCopy> = {
  neon: {
    title: 'Neon',
    hint: 'Pega tu API key de Neon o la ruta de un fichero .env que la tenga (NEON_API_KEY=…).',
    placeholder: 'napi_… o /Users/tu/proyecto/.env',
    where: 'Neon → Account settings → API keys',
  },
  supabase: {
    title: 'Supabase',
    hint: 'Pega un personal access token de Supabase o la ruta de un fichero .env que lo tenga.',
    placeholder: 'sbp_… o /Users/tu/proyecto/.env',
    where: 'Supabase → Account → Access tokens',
  },
}

/**
 * What the selector calls an account: its name, and the masked token only when that name is the
 * mask itself (the API could not say which account it was).
 */
function accountLabel(key: { label: string; masked: string }): string {
  return key.label === key.masked ? key.masked : key.label
}

/** The date a project was created, short: `12 nov`, with the year only when it is not this one. */
function shortDate(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

interface ProviderPanelProps {
  provider: Provider
}

export function ProviderPanel({ provider }: ProviderPanelProps) {
  const copy = COPY[provider]
  const view = read(providerViews)[provider]
  const busy = read(providerBusy) === provider
  const keys = view.status === 'loaded' ? view.value.keys : []
  const projects = view.status === 'loaded' ? view.value.projects : []

  const selected =
    read(providerAccount)[provider] ?? (view.status === 'loaded' ? view.value.selected : undefined)

  return (
    <Stack gap="sm">
      {keys.length === 0 ? null : (
        <Select
          label="Cuenta"
          value={selected ?? keys[0]?.id ?? ''}
          options={keys.map((key) => ({ value: key.id, label: accountLabel(key) }))}
          onChange={(value) => void selectAccount(provider, value)}
        />
      )}
      <Text muted>{copy.hint}</Text>
      <Input
        label="Token o ruta al .env"
        placeholder={copy.placeholder}
        value={read(providerInput)[provider]}
        onChange={(value) => typeProviderInput(provider, value)}
      />
      <Row gap="sm" justify="end">
        {keys.length === 0 ? null : (
          <>
            <Button
              variant="ghost"
              tone="danger"
              disabled={busy}
              onPress={() => clearProviderKeys(provider)}
            >
              Quitar esta cuenta
            </Button>
            <Button disabled={busy} onPress={() => loadProvider(provider)}>
              Actualizar
            </Button>
          </>
        )}
        <Button tone="accent" disabled={busy} onPress={() => addProviderKey(provider)}>
          Guardar token
        </Button>
      </Row>

      {view.status === 'loading' || busy ? (
        <Skeleton lines={2} label={`Consultando ${copy.title}`} />
      ) : null}

      {view.status === 'error' ? (
        <Callout tone="danger" title={`No se pudo leer ${copy.title}`}>
          {view.error}
        </Callout>
      ) : null}

      {view.status === 'loaded' && view.value.error !== undefined ? (
        <Callout tone="warning" title={`${copy.title} no aceptó la petición`}>
          {view.value.error}
        </Callout>
      ) : null}

      {keys.length === 0 ? (
        <Text muted>
          Sin token todavía. Se guarda cifrado en Orca, no en los ajustes del plugin. Se saca en{' '}
          {copy.where}.
        </Text>
      ) : null}

      {keys.map((key) => (
        <Text key={key.masked} muted>
          Token guardado: {key.masked}
        </Text>
      ))}

      {projects.length === 0 ? null : (
        <>
          <Text>{`${projects.length} proyecto(s) a tu alcance`}</Text>
          {projects.map((project) => {
            const key = `${provider}:${project.id}`
            const databases = read(providerDatabases)[key]
            return (
              <Stack key={key} gap="xs">
                <Row justify="between" align="center" gap="sm">
                  <Stack gap="none">
                    <Text>{project.name}</Text>
                    <Text muted>
                      {[project.detail || project.id, shortDate(project.createdAt)]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </Stack>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => void loadDatabases(provider, project.id)}
                  >
                    Ver ramas y bases
                  </Button>
                </Row>
                {databases?.status === 'loading' ? (
                  <Skeleton lines={1} label={`Ramas de ${project.name}`} />
                ) : null}
                {databases?.status === 'error' ? (
                  <Callout tone="danger" title="No se pudieron leer las ramas">
                    {databases.error}
                  </Callout>
                ) : null}
                {databases?.status === 'loaded'
                  ? databases.value.map((branch) => (
                      <Stack key={`${key}:${branch.id}`} gap="xs">
                        <Row gap="xs" align="center">
                          <Badge tone={branch.isDefault ? 'accent' : 'neutral'}>
                            {branch.isDefault ? 'Rama por defecto' : 'Rama'}
                          </Badge>
                          <Text>{branch.name}</Text>
                        </Row>
                        {branch.detail ? <Text muted>{branch.detail}</Text> : null}
                        {branch.databases.length === 0 ? (
                          <Text muted>Esta rama no tiene bases.</Text>
                        ) : null}
                        {branch.databases.map((database) => (
                          <Row
                            key={`${key}:${branch.id}:${database.name}`}
                            justify="between"
                            align="center"
                            gap="sm"
                          >
                            <Stack gap="none">
                              <Text>{database.name}</Text>
                              <Text muted>{database.role}</Text>
                            </Stack>
                            <Button
                              size="sm"
                              disabled={read(connectBusy) === key}
                              onPress={() =>
                                void openDatabase(provider, project.id, database.name, branch.id)
                              }
                            >
                              Abrir
                            </Button>
                          </Row>
                        ))}
                      </Stack>
                    ))
                  : null}
              </Stack>
            )
          })}
        </>
      )}

      {read(providerNotice) ? (
        <Callout tone="success" title="Conexión añadida">
          {read(providerNotice)}
        </Callout>
      ) : null}
    </Stack>
  )
}
