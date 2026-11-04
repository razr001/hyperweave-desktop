/** Remote-first HyperWeave API boundary. It deliberately has no Harness/Host dependency. */
export interface HyperWeaveCredentials {
  readonly accessToken: string
  readonly refreshToken?: string
}

export interface HyperWeaveLogin {
  readonly email: string
  readonly password: string
}

export interface HyperWeaveSession {
  readonly access_token: string
  readonly refresh_token: string
  readonly user: { readonly id: string; readonly email: string; readonly display_name?: string; readonly role: string }
}

export interface HyperWeaveClientOptions {
  readonly platformUrl: string
  readonly credentials: () => HyperWeaveCredentials | undefined
  readonly fetch?: typeof fetch
}

export class HyperWeaveApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HyperWeaveApiError'
  }
}

/**
 * Calls only the administrator-configured HyperWeave origin. API paths must be
 * relative paths; redirects to a different origin are rejected.
 */
export class HyperWeaveClient {
  private readonly origin: string
  private readonly requestFetch: typeof fetch

  constructor(private readonly options: HyperWeaveClientOptions) {
    const endpoint = new URL(options.platformUrl)
    if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
      throw new TypeError('HyperWeave platform URL must use HTTPS')
    }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new TypeError('HyperWeave platform URL must be an origin or base path without credentials, query, or fragment')
    }
    this.origin = endpoint.origin
    this.requestFetch = options.fetch ?? fetch
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/') || path.startsWith('//')) throw new TypeError('HyperWeave API path must be an absolute /api path')
    const target = new URL(path, this.origin)
    if (target.origin !== this.origin) throw new TypeError('HyperWeave request escaped the configured platform origin')
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    const credentials = this.options.credentials()
    if (credentials) headers.set('Authorization', `Bearer ${credentials.accessToken}`)
    const response = await this.requestFetch(target, { ...init, headers, redirect: 'error' })
    if (!response.ok) throw new HyperWeaveApiError(response.status, `HyperWeave request failed (${response.status})`)
    const payload = await response.json() as T | { code?: number; message?: string; data?: T }
    if (payload && typeof payload === 'object' && 'code' in payload) {
      if (payload.code !== 0) throw new HyperWeaveApiError(response.status, payload.message || 'HyperWeave rejected the request')
      return payload.data as T
    }
    return payload as T
  }

  login(credentials: HyperWeaveLogin): Promise<HyperWeaveSession> {
    return this.request('/api/tenant/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials),
    })
  }

  refresh(refreshToken: string): Promise<HyperWeaveSession> {
    return this.request('/api/tenant/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }),
    })
  }

  currentUser<T>(): Promise<T> {
    return this.request('/api/tenant/auth/me')
  }
}
