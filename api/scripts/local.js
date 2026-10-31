// Runs the Lambda handler behind a plain Node HTTP server for local dev.
// It turns each request into the same event shape a Lambda Function URL sends.
const http = require('node:http');
const { handler } = require('../src/handler');

const port = Number(process.env.PORT || 3001);

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);

    const url = new URL(req.url, `http://${req.headers.host}`);
    const event = {
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      queryStringParameters: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body: Buffer.concat(chunks).toString('base64'),
      isBase64Encoded: true,
      requestContext: { http: { method: req.method, sourceIp: req.socket.remoteAddress } },
    };

    const result = await handler(event);
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body ? Buffer.from(result.body, result.isBase64Encoded ? 'base64' : 'utf8') : undefined);
  })
  .listen(port, () => console.log(`API running at http://localhost:${port}/api/health`));
