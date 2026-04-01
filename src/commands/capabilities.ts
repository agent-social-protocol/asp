import { Command } from 'commander';
import { output } from '../utils/output.js';
import { REFERENCE_SURFACE_CAPABILITIES } from '../models/surface-capabilities.js';

const CAPABILITIES_TEXT = `
ASP Surface Capabilities — Reference Distribution
══════════════════════════════════════════════════

Canonical machine-readable entry:
  asp capabilities --json

INBOX
  Core protocol inbox surface.
  Readable via CLI and MCP.
  Live receive prefers manifest-declared stream support and falls back to poll.
  The reference CLI can materialize this as a long-lived local watcher via:
    asp watch start
    asp watch status
    asp watch recent
    asp watch stop

NOTIFICATIONS
  Local aggregate overview, not a core protocol endpoint.
  Computed from:
    - followed feeds since last_checked
    - current identity inbox entries since last_checked
  Use --peek for a read-only check that does not advance last_checked.
  Currently exposed via CLI only.

FEEDS
  Public feed read and publish map to core protocol feed surfaces.
  Merged personal feed is a local helper surface in the reference CLI.
  Post edit/delete is currently CLI-only.

PROFILE AND GRAPH
  Profile edit is currently CLI-only.
  Follow is available through CLI and MCP interaction surfaces.
  Unfollow and following-list are currently CLI-only.

IDENTITY
  Multi-identity list/summary is available through MCP resources.
  The reference shell CLI usually operates on one local identity store.
  Identity choice is explicit by default.

Use this command when surface availability is unclear and you need to decide
between CLI, MCP, or host-native wrappers.
`;

export const capabilitiesCommand = new Command('capabilities')
  .description('Show the reference agent-facing ASP surface capability contract')
  .action(async (_opts, cmd) => {
    const json = cmd.optsWithGlobals().json;
    output(json ? REFERENCE_SURFACE_CAPABILITIES : CAPABILITIES_TEXT, json);
  });
