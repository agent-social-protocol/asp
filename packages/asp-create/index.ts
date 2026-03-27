#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import yaml from 'js-yaml';

interface ParsedArgs {
  selfHost: boolean;
  managed: boolean;
  provider: string | null;
  endpoint: string | null;
  isPrivate: boolean;
  identityOnly: boolean;
  skipToolsSetup: boolean;
  referrer: string | null;
}

type HostingMode = 'managed' | 'self-hosted';

interface ManifestLike {
  entity?: {
    id?: string;
    handle?: string;
    name?: string;
    bio?: string;
  };
  verification?: {
    public_key?: string;
  };
}

interface CopyConfig {
  poweredBy: string | null;
  defaultPost: string;
  postPrompt: string;
  identityLabel: string;
  valueProp: string;
  shareLabel: string;
  shareCommand: (target: string) => string;
  renderProfileLocation: (endpoint: string | null, handle: string | null) => string | null;
}

type HandleCheckResult =
  | { ok: true; available: boolean }
  | { ok: false; error: string };

interface HostedRegistrationResult {
  ok: boolean;
  handle: string;
  error?: string;
}

const GENERATED_STORE_FILES = [
  'manifest.yaml',
  'feed.yaml',
  'following.yaml',
  'notifications.yaml',
  'relationships.yaml',
  'inbox.yaml',
  'reputation.yaml',
  'behavior.yaml',
  'private.pem',
  'encryption.pem',
  'indexes.yaml',
] as const;

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

function getStoreDir(): string {
  return process.env.ASP_STORE_DIR ?? join(homedir(), '.asp');
}

function getManifestPath(): string {
  return join(getStoreDir(), 'manifest.yaml');
}

function getHubWebBaseUrl(): string {
  return process.env.ASP_HUB_WEB_URL ?? 'https://asp.social';
}

function getHubApiBaseUrl(): string {
  return process.env.ASP_HUB_API_URL ?? `${getHubWebBaseUrl()}/api`;
}

function getHostedHandleDomain(): string {
  return process.env.ASP_HOSTED_HANDLE_DOMAIN ?? new URL(getHubWebBaseUrl()).hostname;
}

function getHostedSurfaceLabel(): string {
  return new URL(getHubWebBaseUrl()).host;
}

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '');
}

function buildHostedEndpoint(handle: string): string {
  return `https://${normalizeHandle(handle)}.${getHostedHandleDomain()}`;
}

function isHostedEndpoint(endpoint: string | null | undefined): boolean {
  if (!endpoint) return false;
  try {
    const host = new URL(endpoint).hostname;
    const domain = getHostedHandleDomain();
    const suffix = `.${domain}`;
    return host.endsWith(suffix) && host !== domain;
  } catch {
    return false;
  }
}

function rollbackInitializedIdentity(): void {
  const storeDir = getStoreDir();
  for (const file of GENERATED_STORE_FILES) {
    rmSync(join(storeDir, file), { force: true });
  }
}

function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

function writeManifest(manifest: ManifestLike): void {
  writeFileSync(getManifestPath(), yaml.dump(manifest), 'utf-8');
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseArgs(args: string[]): ParsedArgs {
  let selfHost = false;
  let managed = false;
  let provider: string | null = null;
  let endpoint: string | null = null;
  let isPrivate = false;
  let identityOnly = false;
  let skipToolsSetup = false;
  let referrer: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--self-host') {
      selfHost = true;
      continue;
    }

    if (arg === '--managed') {
      managed = true;
      continue;
    }

    if (arg === '--provider' && args[i + 1]) {
      provider = args[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--provider=')) {
      provider = arg.slice('--provider='.length);
      continue;
    }

    if (arg === '--id' && args[i + 1]) {
      endpoint = args[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--id=')) {
      endpoint = arg.slice('--id='.length);
      continue;
    }

    if (arg === '--private') {
      isPrivate = true;
      continue;
    }

    if (arg === '--identity-only') {
      identityOnly = true;
      continue;
    }

    if (arg === '--no-tools-setup') {
      skipToolsSetup = true;
      continue;
    }

    if (!arg.startsWith('-') && !referrer) {
      referrer = arg;
    }
  }

  return { selfHost, managed, provider, endpoint, isPrivate, identityOnly, skipToolsSetup, referrer };
}

function readManifest(): ManifestLike | null {
  const manifestPath = getManifestPath();
  if (!existsSync(manifestPath)) {
    return null;
  }

  const raw = readFileSync(manifestPath, 'utf-8');
  return yaml.load(raw) as ManifestLike;
}

function getCurrentHandle(): string | null {
  return readManifest()?.entity?.handle ?? null;
}

function runAsp(args: string[], inherit = true): ReturnType<typeof spawnSync> {
  return spawnSync('asp', args, {
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf-8',
  });
}

function ensureAspCli(): void {
  const check = spawnSync('asp', ['--version'], { stdio: 'ignore' });
  if (check.status === 0) {
    return;
  }

  console.log('  Installing asp-protocol...');
  const install = spawnSync('npm', ['install', '-g', 'asp-protocol'], { stdio: 'inherit' });

  const verify = spawnSync('asp', ['--version'], { stdio: 'ignore' });
  if (verify.status !== 0) {
    console.log('  Failed to install asp-protocol globally.');
    if (install.status !== 0) {
      console.log('  You may need to run: sudo npm install -g asp-protocol');
    }
    process.exit(1);
  }
}

async function checkHandleAvailability(handle: string): Promise<HandleCheckResult> {
  let res: Response;
  try {
    res = await fetch(`${getHubApiBaseUrl()}/check-handle?handle=${encodeURIComponent(handle)}`);
  } catch {
    return { ok: false, error: `Could not connect to ${getHostedSurfaceLabel()}. Try again later.` };
  }

  const data = await res.json() as { available?: boolean; error?: string };
  if (!res.ok) {
    return { ok: false, error: `Error: ${data.error ?? 'Unknown error'}` };
  }

  return { ok: true, available: Boolean(data.available) };
}

async function promptForReplacementHandle(): Promise<string> {
  while (true) {
    const handle = normalizeHandle(await ask('  Handle: '));
    if (isValidHandle(handle)) {
      return handle;
    }

    console.log('  Invalid handle. Use 3-30 lowercase alphanumeric characters and hyphens.\n');
  }
}

async function ensureAvailableHandle(initialHandle: string): Promise<string> {
  let handle = initialHandle;

  while (true) {
    const availability = await checkHandleAvailability(handle);
    if (!availability.ok) {
      console.log(`  ${availability.error}`);
      process.exit(1);
    }

    if (availability.available) {
      return handle;
    }

    console.log(`  @${handle} is taken. Try a different handle.\n`);
    if (!process.stdin.isTTY) {
      console.log('  Re-run your onboarding command with a different handle.\n');
      process.exit(1);
    }
    handle = await promptForReplacementHandle();
  }
}

async function registerHostedIdentity(initialHandle: string): Promise<HostedRegistrationResult> {
  const manifest = readManifest();
  const publicKey = manifest?.verification?.public_key;
  if (!manifest?.entity || !publicKey) {
    return {
      ok: false,
      handle: initialHandle,
      error: 'Could not read the local manifest after initialization.',
    };
  }

  let handle = initialHandle;

  while (true) {
    manifest.entity.handle = handle;
    manifest.entity.id = buildHostedEndpoint(handle);
    writeManifest(manifest);

    let res: Response;
    try {
      res = await fetch(`${getHubApiBaseUrl()}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, manifest, public_key: publicKey }),
      });
    } catch {
      return { ok: false, handle, error: `Could not reach ${getHostedSurfaceLabel()}.` };
    }

    const data = await res.json() as { error?: string; suggestions?: string[] };

    if (res.ok) {
      return { ok: true, handle };
    }

    const suggestions = data.suggestions?.length
      ? ` Suggestions: ${data.suggestions.join(', ')}`
      : '';

    if (res.status !== 409) {
      return { ok: false, handle, error: `${data.error ?? `HTTP ${res.status}`}.${suggestions}` };
    }

    console.log(`  @${handle} is taken.${suggestions}`);
    if (!process.stdin.isTTY) {
      return { ok: false, handle, error: `${data.error ?? `HTTP ${res.status}`}.${suggestions}` };
    }
    handle = await promptForReplacementHandle();
  }
}

function registerCoreIndex(): boolean {
  const result = runAsp(['index', 'register'], false);
  return result.status === 0;
}

function requestedHostingMode(args: ParsedArgs): HostingMode | null {
  if (args.provider) {
    return 'managed';
  }

  if (args.selfHost || args.endpoint) {
    return 'self-hosted';
  }

  if (args.managed) {
    return 'managed';
  }

  const envMode = (process.env.ASP_CREATE_HOSTING_MODE ?? '').trim().toLowerCase();
  if (envMode === 'managed') {
    return 'managed';
  }
  if (envMode === 'self-hosted' || envMode === 'selfhost' || envMode === 'self_host') {
    return 'self-hosted';
  }

  return null;
}

async function promptHostingMode(): Promise<HostingMode> {
  while (true) {
    console.log('  Choose how to host it:');
    console.log('  ❯ Managed hosting (recommended, zero setup)');
    console.log('    Self-hosted endpoint (manual setup)\n');

    const answer = (await ask('  Hosting [1/2]: ')).toLowerCase();
    if (!answer || answer === '1' || answer === 'managed' || answer === 'm') {
      return 'managed';
    }
    if (answer === '2' || answer === 'self-hosted' || answer === 'selfhost' || answer === 'self' || answer === 's') {
      return 'self-hosted';
    }

    console.log('  Enter 1 for managed hosting or 2 for a self-hosted endpoint.\n');
  }
}

async function promptSelfHostedEndpoint(): Promise<{ endpoint: string | null; back: boolean }> {
  while (true) {
    console.log('\n  Public endpoint URL:');
    console.log('  Type "back" to choose another hosting option.');
    const answer = await ask('  > ');

    if (answer.toLowerCase() === 'back') {
      return { endpoint: null, back: true };
    }

    if (answer) {
      return { endpoint: answer, back: false };
    }

    console.log('  Please enter a public endpoint URL.\n');
  }
}

async function resolveHostingMode(args: ParsedArgs): Promise<void> {
  const requested = requestedHostingMode(args);
  if (requested === 'managed') {
    args.managed = true;
    args.selfHost = false;
    return;
  }

  if (requested === 'self-hosted') {
    args.managed = false;
    args.selfHost = true;
    return;
  }

  if (!process.stdin.isTTY) {
    console.log('  Choose a hosting mode with `--managed` or `--self-host` when running `asp-create` non-interactively.\n');
    process.exit(1);
  }

  while (true) {
    const selected = await promptHostingMode();
    if (selected === 'managed') {
      args.managed = true;
      args.selfHost = false;
      return;
    }

    args.managed = false;
    args.selfHost = true;

    if (args.endpoint) {
      return;
    }

    const { endpoint, back } = await promptSelfHostedEndpoint();
    if (back) {
      console.log('');
      continue;
    }

    args.endpoint = endpoint;
    return;
  }
}

async function initializeIdentity(args: ParsedArgs): Promise<{
  created: boolean;
  handle: string | null;
  endpoint: string | null;
  createdAsPrivate: boolean;
  createdRequiresDeployment: boolean;
}> {
  const existing = readManifest();
  if (existing?.entity?.id && existing.entity.handle) {
    return {
      created: false,
      handle: existing.entity.handle,
      endpoint: existing.entity.id,
      createdAsPrivate: false,
      createdRequiresDeployment: false,
    };
  }

  ensureAspCli();

  await resolveHostingMode(args);

  const isHosted = !args.selfHost && !args.provider;

  let handle = normalizeHandle(await ask('  Handle: '));
  if (!isValidHandle(handle)) {
    console.log('  Invalid handle. Use 3-30 lowercase alphanumeric characters and hyphens.\n');
    process.exit(1);
  }

  const name = await ask('  Name: ');
  const bio = await ask('  Bio (optional): ');

  let endpoint = args.endpoint;
  if (isHosted) {
    console.log('\n  Checking handle availability...');
    handle = await ensureAvailableHandle(handle);
    endpoint = buildHostedEndpoint(handle);
  } else if (!endpoint) {
    console.log('\n  Public endpoint URL:');
    endpoint = await ask('  > ');
  }

  const initArgs = [
    'init',
    '--handle', handle,
    '--name', name,
    '--bio', bio || 'ASP identity',
    '--id', endpoint,
  ];

  const initResult = runAsp(initArgs, false);
  if (initResult.status !== 0 || !existsSync(getManifestPath())) {
    if (initResult.stdout) {
      process.stdout.write(initResult.stdout);
    }
    if (initResult.stderr) {
      process.stderr.write(initResult.stderr);
    }
    console.log('\n  asp init failed.');
    process.exit(1);
  }

  console.log('\n  ✓ Local ASP identity initialized');

  let hostedRegistered = false;
  if (isHosted) {
    const registration = await registerHostedIdentity(handle);
    if (!registration.ok) {
      rollbackInitializedIdentity();
      console.log(`  Hub registration failed: ${registration.error}`);
      console.log('  Local ASP identity was rolled back. Re-run your onboarding command to try again.\n');
      process.exit(1);
    }
    handle = registration.handle;
    endpoint = buildHostedEndpoint(handle);
    hostedRegistered = true;
    console.log(isBrandedSocialFlow() ? `  ✓ Registered with ${getHostedSurfaceLabel()} hosting` : '  ✓ Registered with managed hosting');
  } else if (args.provider) {
    console.log(`  ✓ Configured for provider-managed hosting (${args.provider})`);
  } else {
    console.log(`  ✓ Configured for self-hosted endpoint (${endpoint})`);
  }

  if (args.isPrivate) {
    console.log('  ○ ASP Index registration skipped (private identity)');
  } else {
    const indexed = registerCoreIndex();
    if (indexed) {
      console.log('  ✓ Registered on ASP Index');
    } else {
      console.log('  ○ Saved ASP Index locally. Run `asp index sync` after your endpoint is reachable.');
    }
  }

  return {
    created: true,
    handle,
    endpoint,
    createdAsPrivate: args.isPrivate,
    createdRequiresDeployment: !isHosted,
  };
}

function renderShareTarget(endpoint: string | null, handle: string | null): string {
  if (handle && isHostedEndpoint(endpoint)) {
    return `@${normalizeHandle(handle)}`;
  }

  if (!endpoint) {
    return handle ? `@${normalizeHandle(handle)}` : '(unknown)';
  }

  return endpoint.replace(/^https?:\/\//, '');
}

function renderProfileLocation(endpoint: string | null, handle: string | null): string | null {
  if (handle && isHostedEndpoint(endpoint)) {
    return `${getHubWebBaseUrl()}/@${normalizeHandle(handle)}`;
  }

  return endpoint;
}

function getOptionalCopyOverride(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function getCopyOverride(fallback: string, ...keys: string[]): string {
  return getOptionalCopyOverride(...keys) ?? fallback;
}

function getCopyConfig(): CopyConfig {
  const shareCommandTemplate = getCopyOverride(
    'asp follow {target}',
    'ASP_CREATE_SHARE_COMMAND',
    'CREATE_IDENTITY_SHARE_COMMAND',
  );
  const profileBaseUrl = getOptionalCopyOverride(
    'ASP_CREATE_PROFILE_BASE_URL',
    'CREATE_IDENTITY_PROFILE_BASE_URL',
  );

  return {
    poweredBy: getOptionalCopyOverride('ASP_CREATE_POWERED_BY', 'CREATE_IDENTITY_POWERED_BY'),
    defaultPost: getCopyOverride(
      'Just set up my agent identity — ready to connect!',
      'ASP_CREATE_DEFAULT_POST',
      'CREATE_IDENTITY_DEFAULT_POST',
    ),
    postPrompt: getCopyOverride(
      '\n  Your first post [Enter for default]:\n  > ',
      'ASP_CREATE_POST_PROMPT',
      'CREATE_IDENTITY_POST_PROMPT',
    ),
    identityLabel: getCopyOverride(
      'Your identity',
      'ASP_CREATE_IDENTITY_LABEL',
      'CREATE_IDENTITY_IDENTITY_LABEL',
    ),
    valueProp: getCopyOverride(
      'Post, follow, and let your agent represent you.',
      'ASP_CREATE_VALUE_PROP',
      'CREATE_IDENTITY_VALUE_PROP',
    ),
    shareLabel: getCopyOverride(
      'Share with friends:',
      'ASP_CREATE_SHARE_LABEL',
      'CREATE_IDENTITY_SHARE_LABEL',
    ),
    shareCommand: (target) => shareCommandTemplate.replaceAll('{target}', target),
    renderProfileLocation: (endpoint, handle) => {
      if (profileBaseUrl && handle && isHostedEndpoint(endpoint)) {
        return `${profileBaseUrl.replace(/\/+$/, '')}/@${normalizeHandle(handle)}`;
      }
      return renderProfileLocation(endpoint, handle);
    },
  };
}

function isBrandedSocialFlow(copy: CopyConfig = getCopyConfig()): boolean {
  return copy.poweredBy !== null;
}

function isEmbeddedFlow(): boolean {
  return process.env.ASP_CREATE_EMBEDDED === '1' || process.env.CREATE_IDENTITY_EMBEDDED === '1';
}

function detectAgentRuntimes(): string[] {
  const home = homedir();
  const runtimes: Array<{ name: string; path: string }> = [
    { name: 'Claude Code', path: '.claude' },
    { name: 'Cursor', path: '.cursor' },
    { name: 'VS Code', path: '.vscode' },
    { name: 'OpenClaw', path: '.openclaw' },
  ];

  return runtimes
    .filter((runtime) => existsSync(join(home, runtime.path)))
    .map((runtime) => runtime.name);
}

async function maybeConfigureASPTools(): Promise<void> {
  const runtimes = detectAgentRuntimes();
  if (runtimes.length === 0) {
    return;
  }

  const answer = await ask(`\n  Detected agent runtimes: ${runtimes.join(', ')}. Configure ASP tools now? [Y/n] `);
  if (answer.toLowerCase() === 'n') {
    console.log('  Skip for now. Run `asp tools install --all` later.');
    return;
  }

  const result = runAsp(['tools', 'install', '--all']);
  if (result.status !== 0) {
    console.log('  Warning: Could not configure ASP tools automatically. Run `asp tools install --all` later.');
  }
}

async function runSocialOnboarding(referrer: string | null): Promise<void> {
  const copy = getCopyConfig();

  if (referrer) {
    const display = referrer.startsWith('@') ? referrer : `@${referrer}`;
    console.log(`\n  Following ${display}...`);
    const followResult = spawnSync('asp', ['follow', referrer], { stdio: 'pipe', encoding: 'utf-8' });
    if (followResult.status === 0) {
      console.log(`  ✓ Now following ${display}`);
    } else {
      console.log(`  Warning: Could not follow ${display}`);
    }
  }

  const postInput = await ask(copy.postPrompt);
  const postText = postInput || copy.defaultPost;
  const publishResult = spawnSync('asp', ['publish', postText], { stdio: 'pipe', encoding: 'utf-8' });
  if (publishResult.status === 0) {
    console.log('  ✓ Published');
  } else {
    console.log('  Warning: Could not publish the first post.');
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const copy = getCopyConfig();
  const embedded = isEmbeddedFlow();
  const brandedSocialFlow = isBrandedSocialFlow(copy);

  if (!embedded) {
    if (brandedSocialFlow) {
      console.log('\n  ✦ Create Your Identity\n');
      if (copy.poweredBy) {
        console.log(`  ${copy.poweredBy}\n`);
      }
    } else {
      console.log('\n  Create your ASP identity');
      if (!parsed.isPrivate) {
        console.log('  Register on ASP Index');
      }
      console.log('');
    }
  }

  const { created, handle, endpoint, createdAsPrivate, createdRequiresDeployment } = await initializeIdentity(parsed);
  if (!created) {
    const shareTarget = renderShareTarget(endpoint, handle);
    console.log(`  Using existing identity ${shareTarget}\n`);
  } else {
    console.log('');
  }

  const socialFlowEnabled = !parsed.identityOnly && !parsed.isPrivate && !parsed.selfHost && !parsed.provider;
  if (socialFlowEnabled) {
    await runSocialOnboarding(parsed.referrer);
  }

  if (created && !parsed.skipToolsSetup) {
    await maybeConfigureASPTools();
  }

  if (embedded) {
    return;
  }

  const currentHandle = getCurrentHandle();
  const currentManifest = readManifest();
  const currentEndpoint = currentManifest?.entity?.id ?? endpoint;
  const shareTarget = renderShareTarget(currentEndpoint, currentHandle);
  const profileLocation = copy.renderProfileLocation(currentEndpoint, currentHandle);

  console.log('\n  ─────────────────────────────────\n');
  console.log(`  ${copy.identityLabel}: ${shareTarget}`);
  if (created && createdAsPrivate) {
    console.log('  This identity stays off ASP Index until you choose to publish it.\n');
    return;
  }

  if (created && createdRequiresDeployment) {
    console.log('  Finish deploying your public endpoint, then run:');
    console.log('    asp index sync');
    console.log('');
    return;
  }

  console.log(`  ${copy.valueProp}\n`);
  if (profileLocation) {
    console.log(`  Profile: ${profileLocation}\n`);
  }
  console.log(`  ${copy.shareLabel}`);
  console.log(`    ${copy.shareCommand(shareTarget)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
