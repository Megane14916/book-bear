import { createHash } from 'node:crypto'
import { z } from 'zod'

export const evidenceChars = 600
const evidence = z.string().trim().min(1).max(500)
const permissionEntry = z.object({
  openBdDescription: z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/), evidence, embedding: z.literal(true), workersAi: z.literal(true),
  }).strict().optional(),
  ownContent: z.object({ text: z.string().trim().min(1).max(evidenceChars), evidence, workersAi: z.literal(true) }).strict().optional(),
}).strict().refine((entry) => entry.openBdDescription || entry.ownContent)
export const evidencePermissions = z.record(z.string().regex(/^(?:97[89]\d{10}|[A-Z]{2}\d{7}[\dX])$/), permissionEntry)
export type EvidencePermissions = z.infer<typeof evidencePermissions>
export type EmbeddingSource = 'licensed_description' | 'bibliographic_metadata' | 'own_content' | 'none'

export function selectEvidence(isbn: string | null, description: string | null | undefined, permissions: EvidencePermissions,
  fallback: { own?: string; metadata?: string; key?: string } = {},
): { input: string | null; embeddingSource: EmbeddingSource; descriptionPermissionConfirmed: boolean } {
  const permission = isbn ? permissions[isbn] : undefined
  // An ISBN-bound digest ensures a changed publisher description is reviewed again.
  const digest = description && createHash('sha256').update(description).digest('hex')
  const descriptionPermissionConfirmed = Boolean(digest && permission?.openBdDescription?.sha256 === digest)
  if (description && descriptionPermissionConfirmed && description.length <= evidenceChars) {
    return { input: description, embeddingSource: 'licensed_description', descriptionPermissionConfirmed }
  }
  const own = permission?.ownContent?.text ?? (fallback.key ? permissions[fallback.key]?.ownContent?.text : undefined) ?? fallback.own
  if (own) return { input: own, embeddingSource: 'own_content', descriptionPermissionConfirmed }
  if (fallback.metadata) return { input: fallback.metadata.slice(0, evidenceChars), embeddingSource: 'bibliographic_metadata', descriptionPermissionConfirmed }
  return { input: null, embeddingSource: 'none', descriptionPermissionConfirmed }
}
