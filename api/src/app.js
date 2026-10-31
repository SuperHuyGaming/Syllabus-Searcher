const config = require('./config');
const { json, header, HttpError } = require('./lib/http');
const courseRoutes = require('./routes/courses');
const uploadRoutes = require('./routes/uploads');
const adminRoutes = require('./routes/admin');

// Builds the request handler. Dependencies are passed in so tests can use fakes.
function createApp(deps) {
  const routes = [
    {
      method: 'GET',
      path: /^\/api\/health$/,
      // Also used by the keep-alive workflow so Supabase and Atlas don't pause.
      async handler() {
        const checks = await Promise.allSettled([deps.catalog.ping(), deps.files.ping(), deps.uploads.ping()]);
        const [dynamodb, mongodb, supabase] = checks.map((c) => (c.status === 'fulfilled' ? 'ok' : c.reason.message));
        const ok = checks.every((c) => c.status === 'fulfilled');
        return json(ok ? 200 : 503, { dynamodb, mongodb, supabase }, { 'Cache-Control': 'no-store' });
      },
    },
    ...courseRoutes(deps),
    ...uploadRoutes(deps),
    ...adminRoutes(deps),
  ];

  return async function handle(event) {
    const method = event.requestContext?.http?.method || 'GET';
    const path = event.rawPath || '/';

    try {
      if (config.originSecret && header(event, 'x-origin-secret') !== config.originSecret) {
        throw new HttpError(403, 'Forbidden');
      }

      const matching = routes.filter((route) => route.path.test(path));
      if (matching.length === 0) throw new HttpError(404, 'Not found');
      const route = matching.find((r) => r.method === method);
      if (!route) throw new HttpError(405, 'Method not allowed');

      const params = path.match(route.path).slice(1);
      return await route.handler({ event, params, query: event.queryStringParameters || {} });
    } catch (err) {
      if (err instanceof HttpError) return json(err.statusCode, { error: err.message });
      console.error(err);
      return json(500, { error: 'Something went wrong' });
    }
  };
}

module.exports = { createApp };
