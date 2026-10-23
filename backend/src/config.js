const env = process.env;

const splitList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const isProduction = env.NODE_ENV === 'production';
const rawPort = env.PORT || '4000';

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV || 'development',
  isProduction,
  port: /^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN,
  version: '2.0.0',
  mongoUri: env.MONGODB_URI || '',
  mongoDbName: env.MONGODB_DB_NAME || 'agristore',
  firebase: Object.freeze({
    projectId: env.FIREBASE_PROJECT_ID || '',
    clientEmail: env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: String(env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  }),
  adminEmails: new Set(splitList(env.ADMIN_EMAILS).map((email) => email.toLowerCase())),
  moderateListings: env.MODERATE_LISTINGS === 'true',
  corsOrigins: new Set([
    ...splitList(env.CORS_ORIGIN),
    ...(!isProduction ? ['http://localhost:5173'] : [])
  ]),
  r2: Object.freeze({
    accountId: env.R2_ACCOUNT_ID || '',
    accessKeyId: env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
    bucketName: env.R2_BUCKET_NAME || '',
    publicBaseUrl: env.R2_PUBLIC_BASE_URL || ''
  })
});

export function assertRuntimeConfig(runtimeConfig = config) {
  if (runtimeConfig.isProduction && !runtimeConfig.mongoUri) {
    throw new Error('MONGODB_URI is required when NODE_ENV=production.');
  }
  if (!Number.isInteger(runtimeConfig.port) || runtimeConfig.port < 1 || runtimeConfig.port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  for (const origin of runtimeConfig.corsOrigins) {
    if (origin === '*') {
      throw new Error('CORS_ORIGIN entries must be exact origins, not wildcards or URLs with paths.');
    }
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Every CORS_ORIGIN entry must be a valid origin URL.');
    }
    if (parsed.origin !== origin || parsed.pathname !== '/') {
      throw new Error('CORS_ORIGIN entries must be exact origins, not wildcards or URLs with paths.');
    }
  }
}
