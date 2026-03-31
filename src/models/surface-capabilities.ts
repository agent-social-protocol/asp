import * as z from 'zod/v4';

export const SurfaceKindSchema = z.enum([
  'protocol-core',
  'protocol-extension',
  'local-aggregate',
  'host-helper',
]);
export type SurfaceKind = z.infer<typeof SurfaceKindSchema>;

export const SurfaceExposureSchema = z.object({
  cli: z.boolean(),
  mcp: z.boolean(),
  native: z.boolean(),
});
export type SurfaceExposure = z.infer<typeof SurfaceExposureSchema>;

export const WatchModeSchema = z.enum(['stream', 'poll', 'none']);
export type WatchMode = z.infer<typeof WatchModeSchema>;

export const WatchSupportSchema = z.object({
  preferred: WatchModeSchema,
  fallback: WatchModeSchema,
});
export type WatchSupport = z.infer<typeof WatchSupportSchema>;

export const SurfaceDescriptorSchema = z.object({
  kind: SurfaceKindSchema,
  manifest_capability: z.string().nullable(),
  endpoint: z.string().nullable(),
  exposure: SurfaceExposureSchema,
  notes: z.string(),
});
export type SurfaceDescriptor = z.infer<typeof SurfaceDescriptorSchema>;

export const InboxSurfaceDescriptorSchema = SurfaceDescriptorSchema.extend({
  watch: WatchSupportSchema,
});
export type InboxSurfaceDescriptor = z.infer<typeof InboxSurfaceDescriptorSchema>;

export const NotificationsSurfaceDescriptorSchema = SurfaceDescriptorSchema.extend({
  source: z.array(z.enum(['following-feed', 'local-inbox', 'last-checked-cursor'])),
});
export type NotificationsSurfaceDescriptor = z.infer<typeof NotificationsSurfaceDescriptorSchema>;

export const IdentitySelectionSchema = z.object({
  mode: z.enum(['explicit', 'elicitation', 'none']),
  notes: z.string(),
});
export type IdentitySelection = z.infer<typeof IdentitySelectionSchema>;

export const SurfaceCapabilitiesSchema = z.object({
  contract: z.literal('asp-surfaces/1'),
  inbox: InboxSurfaceDescriptorSchema,
  notifications: NotificationsSurfaceDescriptorSchema,
  feed: z.object({
    merged_read: SurfaceDescriptorSchema,
    public_read: SurfaceDescriptorSchema,
    publish: SurfaceDescriptorSchema,
    edit_delete: SurfaceDescriptorSchema,
  }),
  profile: z.object({
    edit: SurfaceDescriptorSchema,
  }),
  graph: z.object({
    follow: SurfaceDescriptorSchema,
    unfollow: SurfaceDescriptorSchema,
    following_list: SurfaceDescriptorSchema,
  }),
  identity: z.object({
    list: SurfaceDescriptorSchema,
    select: IdentitySelectionSchema,
  }),
});
export type SurfaceCapabilities = z.infer<typeof SurfaceCapabilitiesSchema>;

export const REFERENCE_SURFACE_CAPABILITIES: SurfaceCapabilities = {
  contract: 'asp-surfaces/1',
  inbox: {
    kind: 'protocol-core',
    manifest_capability: 'inbox',
    endpoint: '/asp/inbox',
    exposure: {
      cli: true,
      mcp: true,
      native: false,
    },
    watch: {
      preferred: 'stream',
      fallback: 'poll',
    },
    notes: 'Core protocol inbox surface. The reference runtime can read it through CLI and MCP. Live receive prefers manifest-declared stream support and otherwise falls back to polling.',
  },
  notifications: {
    kind: 'local-aggregate',
    manifest_capability: null,
    endpoint: null,
    exposure: {
      cli: true,
      mcp: false,
      native: false,
    },
    source: ['following-feed', 'local-inbox', 'last-checked-cursor'],
    notes: 'Notifications are a local overview built from followed feeds plus local inbox entries since last_checked. This is not a core protocol endpoint today.',
  },
  feed: {
    merged_read: {
      kind: 'host-helper',
      manifest_capability: null,
      endpoint: null,
      exposure: {
        cli: true,
        mcp: false,
        native: false,
      },
      notes: 'Merged personal feed is assembled locally from followed entities. It is available through the reference CLI.',
    },
    public_read: {
      kind: 'protocol-core',
      manifest_capability: 'feed',
      endpoint: '/asp/feed',
      exposure: {
        cli: true,
        mcp: true,
        native: false,
      },
      notes: 'Public feed reads map to the protocol feed endpoint and are available in both CLI and MCP surfaces.',
    },
    publish: {
      kind: 'protocol-core',
      manifest_capability: 'feed',
      endpoint: '/asp/feed',
      exposure: {
        cli: true,
        mcp: true,
        native: false,
      },
      notes: 'Publishing uses the protocol feed endpoint and is exposed through both CLI and MCP.',
    },
    edit_delete: {
      kind: 'host-helper',
      manifest_capability: null,
      endpoint: null,
      exposure: {
        cli: true,
        mcp: false,
        native: false,
      },
      notes: 'Post lifecycle management currently exists in the reference CLI only.',
    },
  },
  profile: {
    edit: {
      kind: 'host-helper',
      manifest_capability: null,
      endpoint: null,
      exposure: {
        cli: true,
        mcp: false,
        native: false,
      },
      notes: 'Profile and identity edits are handled by the reference CLI, including hosted sync behavior.',
    },
  },
  graph: {
    follow: {
      kind: 'protocol-extension',
      manifest_capability: null,
      endpoint: null,
      exposure: {
        cli: true,
        mcp: true,
        native: false,
      },
      notes: 'Follow is available in both CLI and MCP via interaction surfaces.',
    },
    unfollow: {
      kind: 'host-helper',
      manifest_capability: null,
      endpoint: null,
      exposure: {
        cli: true,
        mcp: false,
        native: false,
      },
      notes: 'Unfollow is currently available through the reference CLI only.',
    },
    following_list: {
      kind: 'host-helper',
      manifest_capability: null,
      endpoint: null,
      exposure: {
        cli: true,
        mcp: false,
        native: false,
      },
      notes: 'Listing who you follow is currently available through the reference CLI only.',
    },
  },
  identity: {
    list: {
      kind: 'host-helper',
      manifest_capability: null,
      endpoint: null,
      exposure: {
        cli: false,
        mcp: true,
        native: false,
      },
      notes: 'Multi-identity listing and summaries are exposed through MCP resources in the reference distribution. The reference shell CLI typically operates on one local identity store rather than a multi-identity list surface.',
    },
    select: {
      mode: 'explicit',
      notes: 'The reference CLI typically targets one explicit local identity store. MCP hosts may additionally expose multiple identities and elicitation, but agents should not assume that is available unless the host exposes it.',
    },
  },
};
