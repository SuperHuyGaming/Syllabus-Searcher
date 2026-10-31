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
// Locally there's no CloudFront, so fall back to the socket address.
function clientIp(event) {
  const viewer = header(event, 'cloudfront-viewer-address');
  if (viewer) return viewer.slice(0, viewer.lastIndexOf(':'));
  return event.requestContext?.http?.sourceIp || 'unknown';
}

module.exports = { HttpError, json, binary, header, bodyBuffer, bodyJson, clientIp };
