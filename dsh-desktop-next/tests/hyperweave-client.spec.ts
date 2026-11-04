import { describe, expect, it, vi } from 'vitest'
import { HyperWeaveApiError, HyperWeaveClient } from '../src/hyperweave/client.ts'
import { HyperWeaveAgentProvider } from '../src/hyperweave/agent-runtime.ts'
import { isAllowedPlatformRequest } from '../src/hyperweave/request-policy.ts'

describe('HyperWeaveClient', () => {
  it('requires HTTPS except for loopback development', () => {
    expect(() => new HyperWeaveClient({ platformUrl: 'http://example.com', credentials: () => undefined }))
      .toThrow('must use HTTPS')
    expect(() => new HyperWeaveClient({ platformUrl: 'http://127.0.0.1:8081', credentials: () => undefined })).not.toThrow()
  })

  it('sends authenticated API requests only to the configured origin and rejects redirects', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const client = new HyperWeaveClient({ platformUrl: 'https://hw.example.test', credentials: () => ({ accessToken: 'session-token' }), fetch: request })

    await expect(client.request('/api/agent/capabilities')).resolves.toEqual({ ok: true })
    const call = request.mock.calls[0]
    expect(call).toBeDefined()
    expect(call?.[0]).toBeInstanceOf(URL)
    expect(String(call?.[0])).toBe('https://hw.example.test/api/agent/capabilities')
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe('Bearer session-token')
    expect(call?.[1]?.redirect).toBe('error')
  })

  it('rejects non-API paths and reports bounded status errors', async () => {
    const client = new HyperWeaveClient({ platformUrl: 'https://hw.example.test', credentials: () => undefined,
      fetch: async () => new Response(null, { status: 403 }) })
    await expect(client.request('/outside')).rejects.toThrow('absolute /api path')
    await expect(client.request('/api/agent/capabilities')).rejects.toBeInstanceOf(HyperWeaveApiError)
  })

  it('submits the platform task contract with selected role and knowledge scope', async () => {
    const request = vi.fn(async () => ({ id: 'task-1', state: 'QUEUED', sessionId: 'session-1', requestId: 'request-1' }))
    const provider = new HyperWeaveAgentProvider({ request } as unknown as HyperWeaveClient)
    await provider.submit({ agentProfileId: 'profile-1', sessionId: 'session-1', requestId: 'request-1',
      prompt: 'Summarize selected files', knowledgeBaseIds: ['kb-1'] })
    expect(request).toHaveBeenCalledWith('/api/agent/tasks', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ agentProfileId: 'profile-1', sessionId: 'session-1', requestId: 'request-1',
        prompt: 'Summarize selected files', knowledgeBaseIds: ['kb-1'] }),
    }))
  })
})

describe('HyperWeave desktop network boundary', () => {
  it('allows only the configured origin and renderer-local data URLs', () => {
    const origin = 'https://hw.example.test'
    expect(isAllowedPlatformRequest(origin, 'https://hw.example.test/api/agent/tasks')).toBe(true)
    expect(isAllowedPlatformRequest(origin, 'blob:https://hw.example.test/123')).toBe(true)
    expect(isAllowedPlatformRequest(origin, 'data:image/svg+xml;base64,AAAA')).toBe(true)
    expect(isAllowedPlatformRequest(origin, 'https://cdn.example.test/app.js')).toBe(false)
    expect(isAllowedPlatformRequest(origin, 'https://hw.example.test.evil.test/api')).toBe(false)
    expect(isAllowedPlatformRequest(origin, 'file:///C:/private.txt')).toBe(false)
    expect(isAllowedPlatformRequest(origin, 'file:///C:/workbench/main.js', 'C:/workbench')).toBe(true)
    expect(isAllowedPlatformRequest(origin, 'file:///C:/private.txt', 'C:/workbench')).toBe(false)
  })
})
