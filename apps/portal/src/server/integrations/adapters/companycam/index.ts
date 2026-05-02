/**
 * CompanyCam Adapter
 *
 * Capabilities:
 *  - sync_photos     — pull job photos from CompanyCam projects into the customer portal
 *  - create_project  — create a CompanyCam project when a job is created
 *  - pull_photos     — on-demand fetch of photos for a specific project/job
 *
 * Config fields:
 *  - apiKey      CompanyCam API key (Bearer token)
 *
 * CompanyCam REST API base: https://api.companycam.com/v2
 */

import type { IntegrationAdapter } from '../../types.js'
import prisma from '../../../lib/prisma.js'

const COMPANYCAM_BASE = 'https://api.companycam.com/v2'

type CamPhoto = {
  id: string
  project_id: string
  uri: string
  coordinates?: { lat?: number; lon?: number }
  captured_at?: number
  processing_status?: string
  urls?: { original?: string; large?: string; medium?: string; thumb?: string }[]
  tags?: Array<{ label: string }>
}

type CamProject = {
  id: string
  name: string
  address?: { street_address_1?: string; city?: string; state?: string }
  created_at?: number
  status?: string
}

async function camFetch(
  path: string,
  apiKey: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${COMPANYCAM_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CompanyCam-Version': '2024-01-01',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  let data: unknown
  try {
    data = await res.json()
  } catch {
    data = {}
  }

  return { ok: res.ok, status: res.status, data }
}

const adapter: IntegrationAdapter = {
  slug: 'companycam',
  name: 'CompanyCam',
  category: 'Field Operations',
  description: 'Link job photos from CompanyCam projects.',
  capabilities: ['sync_photos', 'create_project', 'pull_photos'],
  configFields: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText: 'Found in CompanyCam → Account Settings → API. Generate a personal access token.',
    },
  ],

  async connect(config) {
    return this.test(config)
  },

  async disconnect() {},

  async test(config) {
    const { apiKey } = config as { apiKey: string }
    if (!apiKey) return { success: false, message: 'API key is required' }

    try {
      const result = await camFetch('/users/current', apiKey)

      if (result.ok) {
        const user = result.data as { name?: string; email_address?: string; company?: { name?: string } }
        const who = user.name || user.email_address || 'CompanyCam user'
        const company = user.company?.name ? ` (${user.company.name})` : ''
        return { success: true, message: `Connected as ${who}${company}` }
      }

      if (result.status === 401) {
        return { success: false, message: 'Invalid API key — check your CompanyCam credentials' }
      }

      return { success: false, message: `CompanyCam returned ${result.status}` }
    } catch (err) {
      return { success: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  async sync(config) {
    const { apiKey } = config as { apiKey: string }
    if (!apiKey) return { synced: 0, errors: 0, message: 'Not configured' }

    let synced = 0
    let errors = 0

    try {
      // Fetch recent projects from CompanyCam (last 100)
      const projResult = await camFetch('/projects?per_page=100&sort_direction=desc', apiKey)

      if (!projResult.ok) {
        return { synced: 0, errors: 1, message: `Failed to fetch CompanyCam projects (${projResult.status})` }
      }

      const projects = projResult.data as CamProject[]

      for (const project of projects) {
        // Strategy 1: match by project name (full name, then fallback to first word)
        // Strategy 2: if address is available, also try matching by street address suffix
        const streetAddress = project.address?.street_address_1
        const projectName = project.name || ''

        let matchingAccount = await prisma.crmAccount.findFirst({
          where: { name: { equals: projectName, mode: 'insensitive' } },
          select: { id: true, externalCrmId: true },
        })

        if (!matchingAccount && projectName.includes(' ')) {
          // Try partial name match (first + second word gives better specificity than first word alone)
          const firstTwo = projectName.split(' ').slice(0, 2).join(' ')
          matchingAccount = await prisma.crmAccount.findFirst({
            where: { name: { contains: firstTwo, mode: 'insensitive' } },
            select: { id: true, externalCrmId: true },
          })
        }

        if (!matchingAccount && streetAddress) {
          // Strategy 2: normalize and match by street address number + partial street name
          const addrNorm = streetAddress.replace(/[^a-z0-9\s]/gi, '').trim()
          matchingAccount = await prisma.crmAccount.findFirst({
            where: {
              customers: {
                some: {
                  // Customers don't have address in the portal schema; use account name heuristic
                  // This path is a best-effort fallback when name fails
                  firstName: { not: '' },
                },
              },
              name: { contains: addrNorm.split(' ')[0], mode: 'insensitive' },
            },
            select: { id: true, externalCrmId: true },
          })
        }

        if (!matchingAccount?.externalCrmId) {
          if (streetAddress || projectName) {
            console.debug(`[CompanyCam] No CRM match for project "${projectName}" (${streetAddress || 'no address'}) — skipping`)
          }
          continue
        }

        const crmCustomerId = matchingAccount.externalCrmId

        // Fetch photos for this project
        const photoResult = await camFetch(`/projects/${project.id}/photos?per_page=50`, apiKey)
        if (!photoResult.ok) {
          errors++
          continue
        }

        const photos = photoResult.data as CamPhoto[]

        for (const photo of photos) {
          const photoUrl = photo.urls?.[0]?.original || photo.urls?.[0]?.large || photo.uri

          if (!photoUrl) continue

          try {
            // Upsert by fileKey (use companycam photo ID as the key)
            const fileKey = `companycam:${photo.id}`

            const existing = await prisma.portalPhoto.findFirst({
              where: { fileKey },
            })

            if (!existing) {
              await prisma.portalPhoto.create({
                data: {
                  crmCustomerId,
                  fileKey,
                  fileUrl: photoUrl,
                  originalFilename: `companycam_${photo.id}.jpg`,
                  fileSizeBytes: 0,
                  mimeType: 'image/jpeg',
                  caption: photo.tags?.map((t: { label: string }) => t.label).join(', ') || `CompanyCam photo`,
                  source: 'companycam',
                  isVisibleToCustomer: true,
                },
              })
              synced++
            }
          } catch (err) {
            console.error(`[CompanyCam] Failed to save photo ${photo.id}:`, err)
            errors++
          }
        }
      }

      return {
        synced,
        errors,
        message: synced > 0
          ? `Synced ${synced} photo(s) from CompanyCam`
          : 'No new CompanyCam photos to sync',
      }
    } catch (err) {
      return { synced: 0, errors: 1, message: `Sync failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  async handleInbound(payload, _headers) {
    // CompanyCam webhooks: photo_created, photo_deleted, project_created, etc.
    const event = payload as {
      event_type?: string
      payload?: {
        project?: CamProject
        photo?: CamPhoto
      }
    }

    const eventType = event.event_type || ''
    console.log(`[CompanyCam] Inbound event: ${eventType}`)

    if (eventType === 'photo_created') {
      const photo = event.payload?.photo
      const project = event.payload?.project

      if (!photo) return { processed: false, message: 'No photo in payload' }

      const photoUrl = photo.urls?.[0]?.original || photo.urls?.[0]?.large || photo.uri
      if (!photoUrl) return { processed: false, message: 'No photo URL in payload' }

      // Match to a CRM customer via the project name
      const projectName = project?.name || ''

      let crmCustomerId: string | null = null

      if (projectName) {
        const matchingAccount = await prisma.crmAccount.findFirst({
          where: {
            name: {
              contains: projectName.split(' ')[0],
              mode: 'insensitive',
            },
          },
          select: { externalCrmId: true },
        })
        crmCustomerId = matchingAccount?.externalCrmId || null
      }

      if (!crmCustomerId) {
        console.warn(`[CompanyCam] Could not match project "${projectName}" to a CRM customer`)
        return { processed: true, message: `Photo received but no matching customer for project: ${projectName}` }
      }

      const fileKey = `companycam:${photo.id}`

      const existing = await prisma.portalPhoto.findFirst({ where: { fileKey } })
      if (!existing) {
        await prisma.portalPhoto.create({
          data: {
            crmCustomerId,
            fileKey,
            fileUrl: photoUrl,
            originalFilename: `companycam_${photo.id}.jpg`,
            fileSizeBytes: 0,
            mimeType: 'image/jpeg',
            caption: photo.tags?.map((t: { label: string }) => t.label).join(', ') || `CompanyCam photo`,
            source: 'companycam',
            isVisibleToCustomer: true,
          },
        })
        console.log(`[CompanyCam] Photo ${photo.id} saved for customer ${crmCustomerId}`)
      }

      return { processed: true, message: `Photo ${photo.id} synced to customer portal` }
    }

    if (eventType === 'photo_deleted') {
      const photo = event.payload?.photo
      if (photo?.id) {
        await prisma.portalPhoto.updateMany({
          where: { fileKey: `companycam:${photo.id}` },
          data: { deletedAt: new Date() },
        })
        return { processed: true, message: `Photo ${photo.id} removed from portal` }
      }
    }

    return { processed: true, message: `CompanyCam event ${eventType} received` }
  },
}

/**
 * Create a CompanyCam project for a new job.
 * Call from the job creation flow.
 */
export async function createCompanyCamProject(params: {
  apiKey: string
  name: string
  address?: string
  city?: string
  state?: string
  zip?: string
}): Promise<{ projectId: string; projectUrl?: string } | null> {
  try {
    const body: Record<string, unknown> = {
      name: params.name,
    }

    if (params.address) {
      body.address = {
        street_address_1: params.address,
        city: params.city || '',
        state: params.state || '',
        postal_code: params.zip || '',
        country: 'US',
      }
    }

    const result = await camFetch('/projects', params.apiKey, { method: 'POST', body })

    if (!result.ok) {
      console.error('[CompanyCam] Failed to create project:', result.data)
      return null
    }

    const project = result.data as { id: string; public_url?: string }
    console.log(`[CompanyCam] Project created: ${project.id} for job "${params.name}"`)
    return { projectId: project.id, projectUrl: project.public_url }
  } catch (err) {
    console.error('[CompanyCam] createCompanyCamProject error:', err)
    return null
  }
}

export default adapter
