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

  originSecret: process.env.ORIGIN_SECRET || '',
  ipHashSalt: process.env.IP_HASH_SALT || '',
  uploadsPerHour: Number(process.env.UPLOADS_PER_HOUR || 5),

  // Departments the site covers. CS only for now.
  departments: ['CS'],
  // Lambda responses cap at 6 MB and base64 adds a third, so files stay under 4 MB.
  maxFileBytes: 4 * 1024 * 1024,
};
