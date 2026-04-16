/**
 * Integration Adapter Interface
 *
 * Every integration must implement this interface.
 * Drop a new adapter in /adapters/{slug}/index.ts to register it.
 */

export interface IntegrationConfig {
  [key: string]: unknown
}

export interface IntegrationTestResult {
  success: boolean
  message: string
}

export interface IntegrationAdapter {
  /** Unique slug matching the database record */
  slug: string
  /** Human-readable name */
  name: string
  /** Category for grouping in UI */
  category: string
  /** Description for the card */
  description: string
  /** URL to logo image */
  logoUrl?: string
  /** List of capabilities this adapter provides */
  capabilities: string[]
  /** Fields required for connection (rendered as form in UI) */
  configFields: ConfigField[]

  /** Validate and store credentials */
  connect(config: IntegrationConfig): Promise<IntegrationTestResult>
  /** Remove credentials and deactivate */
  disconnect(): Promise<void>
  /** Ping the external service */
  test(config: IntegrationConfig): Promise<IntegrationTestResult>
  /** Pull or push data */
  sync(config: IntegrationConfig): Promise<{ synced: number; errors: number; message: string }>
  /** Process incoming webhook data */
  handleInbound(payload: unknown, headers: Record<string, string>): Promise<{ processed: boolean; message: string }>
}

export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'url' | 'email' | 'number' | 'select' | 'toggle'
  placeholder?: string
  required?: boolean
  helpText?: string
  options?: { value: string; label: string }[] // for select type
}
