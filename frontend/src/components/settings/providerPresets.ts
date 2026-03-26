export interface ProviderPreset {
  label: string
  provider: string
  apiStyle: 'openai_compatible' | 'openai' | 'anthropic'
  baseUrl?: string
  modelSuggestion: string
  hideBaseUrl?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // International
  {
    label: 'Anthropic',
    provider: 'anthropic',
    apiStyle: 'anthropic',
    modelSuggestion: 'claude-sonnet-4-6',
    hideBaseUrl: true,
  },
  {
    label: 'OpenAI',
    provider: 'openai',
    apiStyle: 'openai',
    modelSuggestion: 'gpt-4o',
    hideBaseUrl: true,
  },
  {
    label: 'Google Gemini',
    provider: 'gemini',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelSuggestion: 'gemini-2.0-flash',
  },
  {
    label: 'xAI / Grok',
    provider: 'xai',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.x.ai/v1',
    modelSuggestion: 'grok-3',
  },
  {
    label: 'Groq',
    provider: 'groq',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelSuggestion: 'llama-3.3-70b-versatile',
  },
  {
    label: 'Mistral',
    provider: 'mistral',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    modelSuggestion: 'mistral-large-latest',
  },
  {
    label: 'OpenRouter',
    provider: 'openrouter',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelSuggestion: 'anthropic/claude-3.7-sonnet',
  },
  {
    label: 'Together AI',
    provider: 'together',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.together.xyz/v1',
    modelSuggestion: 'meta-llama/Llama-3-70b-chat-hf',
  },
  // Domestic Chinese
  {
    label: 'DeepSeek',
    provider: 'deepseek',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    modelSuggestion: 'deepseek-chat',
  },
  {
    label: 'Qwen / 阿里云百炼',
    provider: 'qwen',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelSuggestion: 'qwen-max',
  },
  {
    label: 'Zhipu / 智谱 AI',
    provider: 'zhipu',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelSuggestion: 'glm-4',
  },
  {
    label: 'Moonshot / Kimi',
    provider: 'kimi',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelSuggestion: 'moonshot-v1-8k',
  },
  {
    label: '火山方舟 / Volcengine',
    provider: 'volcengine',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelSuggestion: 'doubao-pro-32k',
  },
  {
    label: '腾讯混元',
    provider: 'hunyuan',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    modelSuggestion: 'hunyuan-pro',
  },
  {
    label: 'MiniMax',
    provider: 'minimax',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.minimax.chat/v1',
    modelSuggestion: 'abab6.5s-chat',
  },
  {
    label: '零一万物 (Yi)',
    provider: 'yi',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    modelSuggestion: 'yi-large',
  },
  {
    label: '硅基流动 (SiliconFlow)',
    provider: 'siliconflow',
    apiStyle: 'openai_compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    modelSuggestion: 'deepseek-ai/DeepSeek-V3',
  },
  // Custom / Proxy
  {
    label: '自定义 / 代理',
    provider: 'custom',
    apiStyle: 'openai_compatible',
    baseUrl: '',
    modelSuggestion: '',
  },
]
