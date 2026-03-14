import * as z from 'zod/v4';

export const EntityTypeSchema = z.enum(['person', 'agent', 'org', 'service', 'bot']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntitySchema = z.object({
  id: z.string(),
  type: EntityTypeSchema,
  name: z.string(),
  handle: z.string(),
  bio: z.string(),
  tags: z.array(z.string()).optional(),
  languages: z.array(z.string()),
  created_at: z.string(),
});
export type Entity = z.infer<typeof EntitySchema>;

export const RelationshipSchema = z.object({
  type: z.string(),
  target: z.string(),
  created_by: z.enum(['human', 'agent']).optional(),
  created_at: z.string(),
  confidence: z.number().optional(),
  level: z.number().optional(),
  context: z.string().optional(),
  basis: z.string().optional(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
});
export type Skill = z.infer<typeof SkillSchema>;

const ExternalVerificationProofSchema = z.object({
  url: z.string(),
  proof: z.string(),
});

export const VerificationSchema = z.object({
  public_key: z.string(),
  encryption_key: z.string().optional(), // "x25519:<base64 SPKI DER>" for E2E encrypted DMs
  external: z.record(z.string(), ExternalVerificationProofSchema).optional(),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const ManifestSchema = z.object({
  protocol: z.string(),
  entity: EntitySchema,
  relationships: z.array(RelationshipSchema),
  capabilities: z.array(z.string()),
  skills: z.array(z.union([z.string(), SkillSchema])).optional(),
  endpoints: z.object({
    feed: z.string(),
    inbox: z.string(),
    interactions: z.string(),
    reputation: z.string().optional(),
  }),
  access: z.object({
    inbox: z.enum(['open', 'restricted']).optional(),
  }).optional(),
  verification: VerificationSchema,
});
export type Manifest = z.infer<typeof ManifestSchema>;

export function isManifest(obj: unknown): obj is Manifest {
  return ManifestSchema.safeParse(obj).success;
}

export function createDefaultManifest(opts: {
  id: string;
  type: EntityType;
  name: string;
  handle: string;
  bio: string;
  tags?: string[];
  skills?: (string | Skill)[];
  languages: string[];
  represents?: string;
  publicKey: string;
  encryptionKey?: string;
}): Manifest {
  const now = new Date().toISOString();

  const relationships: Relationship[] = [];
  if (opts.represents) {
    relationships.push({
      type: 'represents',
      target: opts.represents,
      created_at: now,
    });
  }

  return {
    protocol: 'asp/1.0',
    entity: {
      id: opts.id,
      type: opts.type,
      name: opts.name,
      handle: opts.handle,
      bio: opts.bio,
      ...(opts.tags?.length && { tags: opts.tags }),
      languages: opts.languages,
      created_at: now,
    },
    relationships,
    capabilities: ['feed', 'interactions', 'inbox', ...(opts.encryptionKey ? ['encrypted-dm'] : [])],
    ...(opts.skills?.length && { skills: opts.skills }),
    endpoints: {
      feed: '/asp/feed',
      inbox: '/asp/inbox',
      interactions: '/asp/interactions',
    },
    verification: {
      public_key: opts.publicKey,
      ...(opts.encryptionKey && { encryption_key: opts.encryptionKey }),
    },
  };
}
