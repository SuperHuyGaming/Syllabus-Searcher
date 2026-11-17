const { clientIp } = require('../src/lib/http');

const event = (headers) => ({ headers, requestContext: { http: { sourceIp: '10.0.0.9' } } });

describe('clientIp', () => {
  test('uses CloudFront-Viewer-Address without a proxy secret', () => {
    expect(clientIp(event({ 'cloudfront-viewer-address': '203.0.113.5:443' }))).toBe('203.0.113.5');
  });

  test('trusts X-Client-Ip only when the proxy secret matches', () => {
    const headers = {
      'cloudfront-viewer-address': '172.70.1.1:443',
      'x-client-ip': '198.51.100.7',
      'x-proxy-secret': 'right-secret',
    };
    expect(clientIp(event(headers), 'right-secret')).toBe('198.51.100.7');
    expect(clientIp(event(headers), 'other-secret')).toBe('172.70.1.1');
    expect(clientIp(event(headers))).toBe('172.70.1.1');
  });

  test('ignores an empty forwarded IP', () => {
    const headers = { 'cloudfront-viewer-address': '172.70.1.1:443', 'x-client-ip': ' ', 'x-proxy-secret': 's' };
    expect(clientIp(event(headers), 's')).toBe('172.70.1.1');
  });

  test('falls back to the socket address locally', () => {
    expect(clientIp(event({}))).toBe('10.0.0.9');
  });
});
