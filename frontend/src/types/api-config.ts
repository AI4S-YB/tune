export interface ApiConfig {
  id: string
  name: string
  provider: string
  api_style: 'openai_compatible' | 'openai' | 'anthropic' | string
  base_url: string | null
  model_name: string
  api_key: string        // masked as "***" in list responses; empty string = unchanged on update
  enabled: boolean
  timeout: number
  max_retries: number
  endpoint_path: string | null
  extra_headers: Record<string, string>
  extra_params: Record<string, unknown>
  remark: string | null
  created_at: string
  updated_at: string
}

export type ApiConfigDraft = Omit<ApiConfig, 'id' | 'created_at' | 'updated_at'>
