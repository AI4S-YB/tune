import type { ApiConfig, ApiConfigDraft } from '../types/api-config'

const BASE = '/api/llm-configs'

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export const apiConfigsApi = {
  list(): Promise<ApiConfig[]> {
    return request<{ configs: ApiConfig[] }>(BASE + '/').then((r) => r.configs)
  },

  create(data: ApiConfigDraft): Promise<ApiConfig> {
    return request(BASE + '/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  get(id: string): Promise<ApiConfig> {
    return request(`${BASE}/${id}`)
  },

  update(id: string, data: Partial<ApiConfigDraft>): Promise<ApiConfig> {
    return request(`${BASE}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  delete(id: string): Promise<void> {
    return request(`${BASE}/${id}`, { method: 'DELETE' })
  },

  /** Test a saved config by ID */
  testSaved(id: string): Promise<{ ok: boolean; response?: string; error?: string }> {
    return request(`${BASE}/${id}/test`, { method: 'POST' })
  },

  /** Test an unsaved config from form values */
  testUnsaved(data: ApiConfigDraft): Promise<{ ok: boolean; response?: string; error?: string }> {
    return request(`${BASE}/test`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  setActive(id: string): Promise<{ ok: boolean }> {
    return request(`${BASE}/active`, {
      method: 'PUT',
      body: JSON.stringify({ config_id: id }),
    })
  },
}
