class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

function xml(body, headers = {}) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', ...headers },
    body,
  };
}

function binary(buffer, contentType, headers = {}) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': contentType, ...headers },
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
}

function header(event, name) {
  return (event.headers || {})[name.toLowerCase()];
}

function bodyBuffer(event) {
  if (!event.body) return Buffer.alloc(0);
  return Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
}

function bodyJson(event) {
  const raw = bodyBuffer(event).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

// CloudFront sets CloudFront-Viewer-Address ("ip:port") and clients can't forge it.
// When the site sits behind the Cloudflare proxy (proxy/), CloudFront only sees the
// proxy's address, so the proxy sends the visitor's IP in X-Client-Ip together with
// the shared PROXY_SECRET; that header is trusted only when the secret matches.
// Locally there's no CloudFront, so fall back to the socket address.
function clientIp(event, proxySecret = '') {
  if (proxySecret && header(event, 'x-proxy-secret') === proxySecret) {
    const forwarded = (header(event, 'x-client-ip') || '').trim();
    if (forwarded) return forwarded;
  }
  const viewer = header(event, 'cloudfront-viewer-address');
  if (viewer) return viewer.slice(0, viewer.lastIndexOf(':'));
  return event.requestContext?.http?.sourceIp || 'unknown';
}

module.exports = { HttpError, json, xml, binary, header, bodyBuffer, bodyJson, clientIp };
