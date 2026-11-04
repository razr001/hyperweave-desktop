import { HyperWeaveClient } from './client.ts'

export interface AgentTaskInput {
  readonly agentProfileId?: string
  readonly sessionId: string
  readonly requestId: string
  readonly prompt: string
  readonly knowledgeBaseIds?: readonly string[]
}

export interface AgentTaskReceipt {
  readonly id: string
  readonly state: string
  readonly sessionId: string
  readonly requestId: string
}

/** Stable client contract: implementations may be remote or local in a later release. */
export interface AgentExecutionProvider {
  readonly kind: 'platform' | 'local'
  submit(input: AgentTaskInput): Promise<AgentTaskReceipt>
}

/** First-release provider. Deep Agents runs on HyperWeave; this process never executes agent tools. */
export class HyperWeaveAgentProvider implements AgentExecutionProvider {
  readonly kind = 'platform' as const

  constructor(private readonly api: HyperWeaveClient) {}

  submit(input: AgentTaskInput): Promise<AgentTaskReceipt> {
    return this.api.request('/api/agent/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  }
}
