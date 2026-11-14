// The Neon and Supabase tabs: where the token goes, and what it reaches. P1, P2
import { Button, Callout, Input, Row, read, Skeleton, Stack, Text } from 'orca'
import type { Provider } from '../protocol'
import {
  addProviderKey,
  clearProviderKeys,
  loadProvider,
  providerBusy,
  providerInput,
  providerViews,
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

interface ProviderPanelProps {
  provider: Provider
}

export function ProviderPanel({ provider }: ProviderPanelProps) {
  const copy = COPY[provider]
  const view = read(providerViews)[provider]
  const busy = read(providerBusy) === provider
  const keys = view.status === 'loaded' ? view.value.keys : []
  const projects = view.status === 'loaded' ? view.value.projects : []

  return (
    <Stack gap="sm">
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
              Quitar tokens
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
          {projects.map((project) => (
            <Stack key={`${provider}:${project.id}`} gap="xs">
              <Text>{project.name}</Text>
              <Text muted>{project.detail || project.id}</Text>
            </Stack>
          ))}
        </>
      )}
    </Stack>
  )
}
