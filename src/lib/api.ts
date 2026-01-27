export type AppConfiguration = {
  version: string
  features: string[]
}

export async function fetchConfiguration(): Promise<AppConfiguration> {
  const response = await fetch('/api/get_configuration', { method: 'POST' })
  if (!response.ok) {
    throw new Error('Failed to fetch configuration')
  }
  return response.json()
}
