const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

module.exports = {
  tableName: process.env.TABLE_NAME || 'SyllabusSearcher',
  region: process.env.AWS_REGION || 'us-east-1',
  dynamoEndpoint: process.env.DYNAMODB_ENDPOINT || undefined,

  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
  mongoDb: process.env.MONGODB_DB || 'syllabus_searcher',

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  adminEmails: list(process.env.ADMIN_EMAILS),

  azureEndpoint: (process.env.AZURE_DI_ENDPOINT || '').replace(/\/$/, ''),
  azureKey: process.env.AZURE_DI_KEY || '',

  // AI check of uploads (src/lib/ai.js). Free tiers only; off when no key is set.
  aiProvider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
  aiModel: process.env.AI_MODEL || '',
  aiApiKey: process.env.AI_API_KEY || '',
  aiFallbackProvider: (process.env.AI_FALLBACK_PROVIDER || '').toLowerCase(),
  aiFallbackModel: process.env.AI_FALLBACK_MODEL || '',
  aiFallbackApiKey: process.env.AI_FALLBACK_API_KEY || '',

  // Virus scan with ClamAV (src/lib/virusscan.js). Set where a clamd daemon runs
  // (Docker Compose); empty in Lambda, where scripts/virus-scan.js scans from Actions.
  clamavHost: process.env.CLAMAV_HOST || '',
  clamavPort: Number(process.env.CLAMAV_PORT || 3310),

  // "Refresh now" on /admin starts the Scrape syllabi workflow (src/lib/github.js).
  // Off unless all three are set. SITE_ENVIRONMENT is "production" or "staging".
  githubToken: process.env.GITHUB_DISPATCH_TOKEN || '',
  githubRepo: process.env.GITHUB_REPO || '',
  siteEnvironment: process.env.SITE_ENVIRONMENT || '',

  originSecret: process.env.ORIGIN_SECRET || '',
  ipHashSalt: process.env.IP_HASH_SALT || '',
  uploadsPerHour: Number(process.env.UPLOADS_PER_HOUR || 5),

  // Departments always covered, even before the scraper loads GMU's catalog of every
  // department into MongoDB (repos/departments.js).
  departments: ['CS'],
  // Lambda responses cap at 6 MB and base64 adds a third, so files stay under 4 MB.
  maxFileBytes: 4 * 1024 * 1024,
};
