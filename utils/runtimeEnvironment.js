const trim = (value) => String(value ?? "").trim();

export const SERVER_VERSION = "9_20_14";

const hasStagingRuntimeSignal = () => {
  const values = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.FRONTEND_BASE_URL,
    process.env.GOOGLE_REDIRECT_URI,
  ]
    .map((value) => trim(value).toLowerCase())
    .filter(Boolean);

  return values.some((value) => value.includes("staging"));
};

export const getAppEnvironment = () => {
  const explicit = trim(process.env.APP_ENV).toLowerCase();
  if (explicit) return explicit;
  if (hasStagingRuntimeSignal()) return "staging";
  return process.env.VERCEL ? "production" : "development";
};

export const isStagingEnvironment = () => getAppEnvironment() === "staging";

const normalizeOrigin = (value) => {
  const raw = trim(value);
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
};

export const getMongoDatabaseName = (uri = process.env.MONGODB_URL) => {
  const raw = trim(uri);
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    return decodeURIComponent(String(parsed.pathname || "").replace(/^\//, "")).trim();
  } catch {
    const withoutQuery = raw.split("?")[0];
    const slash = withoutQuery.lastIndexOf("/");
    return slash >= 0 ? decodeURIComponent(withoutQuery.slice(slash + 1)).trim() : "";
  }
};

export const getRedisUrl = () => {
  if (isStagingEnvironment()) {
    const url = trim(process.env.STAGING_REDIS_URL);
    if (!url) throw new Error("STAGING_REDIS_URL is not set");
    return url;
  }

  const url = trim(process.env.REDIS_URL);
  if (!url) throw new Error("REDIS_URL is not set");
  return url;
};

export const getBlobReadWriteToken = () => {
  if (isStagingEnvironment()) {
    const token = trim(process.env.STAGING_BLOB_READ_WRITE_TOKEN);
    if (!token) throw new Error("STAGING_BLOB_READ_WRITE_TOKEN is not set");
    return token;
  }

  const token = trim(process.env.BLOB_READ_WRITE_TOKEN);
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  return token;
};

export const getGoogleDriveRootFolderId = () => {
  // Staging deliberately ignores any configured root id. With the restricted
  // drive.file scope, a manually-created/pre-existing folder id may be invisible
  // to the OAuth app even when the signed-in account owns it. More importantly,
  // ignoring a stale value prevents staging from ever being pinned to a production
  // or manually-created Drive folder. Staging resolves/creates UNIS-STAGING by name.
  if (isStagingEnvironment()) return "";
  return trim(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
};

export const getGoogleDriveRootFolderName = () => {
  const configured = trim(process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME);
  if (configured) return configured;
  return isStagingEnvironment() ? "UNIS-STAGING" : "UNIS";
};

export const getCorsAllowedOrigins = () => {
  const origins = new Set();
  const frontend = normalizeOrigin(process.env.FRONTEND_BASE_URL);
  if (frontend) origins.add(frontend);

  for (const entry of trim(process.env.CORS_ALLOWED_ORIGINS).split(",")) {
    const origin = normalizeOrigin(entry);
    if (origin) origins.add(origin);
  }

  if (getAppEnvironment() === "development") {
    origins.add("http://localhost:5173");
    origins.add("http://localhost:3000");
  }

  return [...origins];
};

const requireValue = (name) => {
  const value = trim(process.env[name]);
  if (!value) throw new Error(`[environment] ${name} is required`);
  return value;
};

const requireSecretLength = (name, minLength = 32) => {
  const value = requireValue(name);
  if (value.length < minLength) {
    throw new Error(`[environment] ${name} must be at least ${minLength} characters`);
  }
  return value;
};

export const validateRuntimeEnvironment = () => {
  const environment = getAppEnvironment();
  const valid = new Set(["production", "staging", "development"]);
  if (!valid.has(environment)) {
    throw new Error(`[environment] APP_ENV must be production, staging, or development (received: ${environment})`);
  }

  if (hasStagingRuntimeSignal() && environment !== "staging") {
    throw new Error(
      `[STAGING SAFETY BLOCK] runtime looks like staging but APP_ENV resolved to '${environment}'`
    );
  }

  const mongoUrl = requireValue("MONGODB_URL");
  const databaseName = getMongoDatabaseName(mongoUrl);

  requireValue("JWT_SECRET");
  if (environment !== "staging") requireValue("REDIS_URL");

  if (environment === "staging") {
    if (!databaseName) {
      throw new Error("[STAGING SAFETY BLOCK] MONGODB_URL must include an explicit staging database name");
    }
    const expectedDb = trim(process.env.UNIS_STAGING_DB_NAME) || "unisDB_staging";
    if (databaseName !== expectedDb) {
      throw new Error(
        `[STAGING SAFETY BLOCK] MONGODB_URL targets '${databaseName}', expected '${expectedDb}'`
      );
    }

    const frontendOrigin = normalizeOrigin(requireValue("FRONTEND_BASE_URL"));
    if (frontendOrigin !== "https://staging.unis.org.in") {
      throw new Error(
        `[STAGING SAFETY BLOCK] FRONTEND_BASE_URL must be https://staging.unis.org.in (received: ${frontendOrigin || "empty"})`
      );
    }

    const redirectUri = requireValue("GOOGLE_REDIRECT_URI");
    const redirectOrigin = normalizeOrigin(redirectUri);
    let redirectPath = "";
    try {
      redirectPath = new URL(redirectUri).pathname.replace(/\/+$/, "");
    } catch {
      redirectPath = "";
    }
    if (
      redirectOrigin !== "https://staging-api.unis.org.in" ||
      redirectPath !== "/api/integrations/google-drive/callback"
    ) {
      throw new Error(
        "[STAGING SAFETY BLOCK] GOOGLE_REDIRECT_URI must be " +
          "https://staging-api.unis.org.in/api/integrations/google-drive/callback"
      );
    }

    requireValue("GOOGLE_CLIENT_ID");
    requireValue("GOOGLE_CLIENT_SECRET");

    // GOOGLE_DRIVE_ROOT_FOLDER_ID is intentionally optional in staging.
    // With drive.file scope, the app can safely create/find its own UNIS-STAGING
    // root when a pre-created folder is not visible to the OAuth application.
    const expectedRootName = getGoogleDriveRootFolderName();
    if (expectedRootName !== "UNIS-STAGING") {
      throw new Error(
        `[STAGING SAFETY BLOCK] GOOGLE_DRIVE_ROOT_FOLDER_NAME must be UNIS-STAGING (received: ${expectedRootName})`
      );
    }

    requireSecretLength("JWT_SECRET", 32);
    requireSecretLength("INTEGRATION_ENC_SECRET", 32);

    // Staging deliberately ignores production resource variables for Redis/Blob.
    // Dedicated names make accidental reuse of live resources much harder.
    requireValue("STAGING_REDIS_URL");
    requireValue("STAGING_BLOB_READ_WRITE_TOKEN");
  }

  return {
    environment,
    databaseName,
    driveRootConfigured: !!getGoogleDriveRootFolderId(),
    corsAllowedOrigins: getCorsAllowedOrigins(),
  };
};
