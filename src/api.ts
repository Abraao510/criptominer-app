export type ApiInit = RequestInit & { signal?: AbortSignal }

export async function requestApi<T>(path: string, init: ApiInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

  const raw = await response.text()
  let payload: unknown = null
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = raw
    }
  }

  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'detail' in payload
      ? String(payload.detail)
      : typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error)
        : `A API respondeu com status ${response.status}.`
    throw new Error(`${init.method ?? 'GET'} ${path}: ${detail}`)
  }

  return payload as T
}

export async function requestApiOptional<T>(path: string, init: ApiInit = {}): Promise<T | null> {
  try {
    return await requestApi<T>(path, init)
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) return null
    throw error
  }
}

export async function setNetwork(mode: 'BTC' | 'ETH') {
  return requestApi('/set_network', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })
}

export async function setEngine(active: boolean) {
  return requestApi(active ? '/start' : '/stop', { method: 'POST' })
}

export async function resetEngine() {
  return requestApi('/reset', { method: 'POST' })
}
