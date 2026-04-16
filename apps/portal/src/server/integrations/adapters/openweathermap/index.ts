/**
 * OpenWeatherMap Adapter
 *
 * Weather forecast for schedule view and automation triggers.
 */

import type { IntegrationAdapter, IntegrationConfig } from '../../types.js'

const adapter: IntegrationAdapter = {
  slug: 'openweathermap',
  name: 'OpenWeatherMap',
  category: 'Field Operations',
  description: '7-day weather forecast on the schedule view. Rain alerts for dispatchers.',
  capabilities: ['weather_forecast', 'rain_alert'],
  configFields: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, helpText: 'Get a free key at openweathermap.org' },
    { key: 'zipCode', label: 'Zip Code', type: 'text', required: true, placeholder: '34787', helpText: 'Primary service area zip code' },
    { key: 'units', label: 'Units', type: 'select', options: [{ value: 'imperial', label: 'Imperial (°F)' }, { value: 'metric', label: 'Metric (°C)' }] },
  ],

  async connect(config) { return this.test(config) },
  async disconnect() {},

  async test(config) {
    const { apiKey, zipCode } = config as { apiKey: string; zipCode: string }
    if (!apiKey) return { success: false, message: 'API key is required' }

    try {
      const zip = zipCode || '34787'
      const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?zip=${zip},us&units=imperial&appid=${apiKey}`)
      if (res.ok) {
        const data = await res.json() as { name: string; main: { temp: number } }
        return { success: true, message: `Connected! Current: ${data.name} ${Math.round(data.main.temp)}°F` }
      }
      return { success: false, message: `API returned ${res.status}` }
    } catch (err) {
      return { success: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  async sync(config) {
    const { apiKey, zipCode, units } = config as { apiKey: string; zipCode: string; units: string }
    try {
      const res = await fetch(`https://api.openweathermap.org/data/2.5/forecast?zip=${zipCode || '34787'},us&units=${units || 'imperial'}&appid=${apiKey}`)
      if (!res.ok) return { synced: 0, errors: 1, message: `API error ${res.status}` }
      const data = await res.json() as { list: any[] }
      return { synced: data.list.length, errors: 0, message: `Fetched ${data.list.length} forecast entries` }
    } catch {
      return { synced: 0, errors: 1, message: 'Failed to fetch forecast' }
    }
  },

  async handleInbound() {
    return { processed: false, message: 'OpenWeatherMap does not send webhooks' }
  },
}

export default adapter
