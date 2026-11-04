interface HyperWeaveBridge {
  session(): Promise<Record<string, unknown> | null>
  login(credentials: { email: string; password: string }): Promise<Record<string, unknown>>
  logout(): Promise<void>
  request<T = unknown>(input: { path: string; method?: string; body?: unknown; headers?: Record<string, string> }): Promise<T>
  submitTask<T = { id: string; state: string }>(input: { agentProfileId?: string; sessionId: string; requestId: string; prompt: string; knowledgeBaseIds?: string[] }): Promise<T>
  upload<T = unknown>(input: { path: string; name: string; mediaType: string; bytes: Uint8Array }): Promise<T>
  download(input: { path: string; fileName: string }): Promise<boolean>
}

interface Window { hyperweave: HyperWeaveBridge }
