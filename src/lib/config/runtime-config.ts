/**
 * Process-start runtime validation.
 *
 * This module is intentionally dependency-free so Next configuration,
 * server instrumentation, validation tooling, and unit tests all evaluate
 * the exact same safety rules.
 */

export const ISOLATED_MODE_ENV = "NEXUS_ISOLATED_TEST";
export const VALIDATION_DATABASE_MARKER = "nexus_validation";

export const PROVIDER_KIND_ENV = {
  auth: "NEXUS_AUTH_PROVIDER",
  hubspot: "NEXUS_HUBSPOT_PROVIDER",
  netsuite: "NEXUS_NETSUITE_PROVIDER",
  artifacts: "NEXUS_ARTIFACT_PROVIDER",
  realtime: "NEXUS_REALTIME_PROVIDER",
} as const;

export type ProviderName = keyof typeof PROVIDER_KIND_ENV;
export type ProviderKind = "production" | "isolated";

export type RuntimeSafety = {
  mode: "production" | "isolated";
  providers: Record<ProviderName, ProviderKind>;
  database?: {
    host: string;
    name: string;
  };
  allowedNetworkHosts: ReadonlySet<string>;
};

const LOCAL_DATABASE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "nexus-validation-db",
]);

const FORBIDDEN_ISOLATED_CREDENTIALS = [
  "CLERK_SECRET_KEY",
  "HUBSPOT_ACCESS_TOKEN",
  "HUBSPOT_WRITE_ACCESS_TOKEN",
  "HUBSPOT_DEV_ACCESS_TOKEN",
  "NETSUITE_ACCOUNT_ID",
  "NETSUITE_CONSUMER_KEY",
  "NETSUITE_CONSUMER_SECRET",
  "NETSUITE_TOKEN_ID",
  "NETSUITE_TOKEN_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function nonEmpty(env: NodeJS.ProcessEnv, key: string): boolean {
  return typeof env[key] === "string" && env[key]!.trim().length > 0;
}

function parseDatabaseUrl(raw: string): { host: string; name: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("[runtime-config] validation database URL is invalid");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `[runtime-config] validation database protocol must be postgres/postgresql (got ${parsed.protocol})`,
    );
  }
  const host = parsed.hostname.toLowerCase();
  const name = parsed.pathname.replace(/^\/+/, "").toLowerCase();
  if (!host || !name) {
    throw new Error("[runtime-config] validation database host and name are required");
  }
  return { host, name };
}

function readProviderKinds(
  env: NodeJS.ProcessEnv,
  isolated: boolean,
): Record<ProviderName, ProviderKind> {
  const providers = {} as Record<ProviderName, ProviderKind>;
  for (const [name, envName] of Object.entries(PROVIDER_KIND_ENV) as Array<
    [ProviderName, (typeof PROVIDER_KIND_ENV)[ProviderName]]
  >) {
    const raw = env[envName]?.trim().toLowerCase();
    if (raw !== undefined && raw !== "production" && raw !== "isolated") {
      throw new Error(
        `[runtime-config] ${envName} must be 'production' or 'isolated'`,
      );
    }
    const kind = (raw ?? "production") as ProviderKind;
    if (isolated && kind !== "isolated") {
      throw new Error(
        `[runtime-config] isolated mode requires ${envName}=isolated`,
      );
    }
    if (!isolated && kind === "isolated") {
      throw new Error(
        `[runtime-config] ${envName}=isolated requires ${ISOLATED_MODE_ENV}=1`,
      );
    }
    providers[name] = kind;
  }
  return providers;
}

export function assertRuntimeSafety(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeSafety {
  const isolated = env[ISOLATED_MODE_ENV] === "1";
  const providers = readProviderKinds(env, isolated);

  if (!isolated) {
    if (nonEmpty(env, "NEXUS_VALIDATION_IDENTITY")) {
      throw new Error(
        "[runtime-config] NEXUS_VALIDATION_IDENTITY requires isolated mode",
      );
    }
    return {
      mode: "production",
      providers,
      allowedNetworkHosts: new Set(),
    };
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "[runtime-config] isolated mode is forbidden when NODE_ENV=production",
    );
  }
  if (env.VERCEL_ENV === "production") {
    throw new Error(
      "[runtime-config] isolated mode is forbidden when VERCEL_ENV=production",
    );
  }

  const validationIdentity = env.NEXUS_VALIDATION_IDENTITY ?? "pm";
  if (!["pm", "admin", "unauthorized"].includes(validationIdentity)) {
    throw new Error(
      "[runtime-config] NEXUS_VALIDATION_IDENTITY must be pm, admin, or unauthorized",
    );
  }

  const leaked = FORBIDDEN_ISOLATED_CREDENTIALS.filter((key) =>
    nonEmpty(env, key),
  );
  if (leaked.length > 0) {
    throw new Error(
      `[runtime-config] isolated mode refuses external credentials: ${leaked.join(", ")}`,
    );
  }

  const rawDatabaseUrl = env.DATABASE_URL?.trim();
  const rawDirectUrl = env.DIRECT_URL?.trim();
  if (!rawDatabaseUrl) {
    throw new Error("[runtime-config] isolated mode requires DATABASE_URL");
  }
  const database = parseDatabaseUrl(rawDatabaseUrl);
  if (!LOCAL_DATABASE_HOSTS.has(database.host)) {
    throw new Error(
      `[runtime-config] isolated database host is not local: ${database.host}`,
    );
  }
  if (!database.name.includes(VALIDATION_DATABASE_MARKER)) {
    throw new Error(
      `[runtime-config] isolated database name must contain '${VALIDATION_DATABASE_MARKER}'`,
    );
  }

  if (rawDirectUrl) {
    const direct = parseDatabaseUrl(rawDirectUrl);
    if (!LOCAL_DATABASE_HOSTS.has(direct.host)) {
      throw new Error(
        `[runtime-config] isolated DIRECT_URL host is not local: ${direct.host}`,
      );
    }
    if (!direct.name.includes(VALIDATION_DATABASE_MARKER)) {
      throw new Error(
        `[runtime-config] isolated DIRECT_URL database name must contain '${VALIDATION_DATABASE_MARKER}'`,
      );
    }
  }

  return {
    mode: "isolated",
    providers,
    database,
    allowedNetworkHosts: new Set(LOCAL_DATABASE_HOSTS),
  };
}

export function isLoopbackNetworkUrl(
  value: string | URL,
  allowedHosts: ReadonlySet<string> = LOCAL_DATABASE_HOSTS,
): boolean {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    return false;
  }
  return allowedHosts.has(url.hostname.toLowerCase());
}

export function isolatedCredentialNames(): readonly string[] {
  return FORBIDDEN_ISOLATED_CREDENTIALS;
}
