// Forwards each request to the CloudFront distribution for this hostname and passes
// the visitor's IP (X-Client-Ip) with a shared secret so the API rate-limits uploads
// per visitor instead of per Cloudflare address.
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const origin = env.ORIGINS?.[url.hostname];
		if (!origin) return new Response('Unknown host', { status: 404 });

		const headers = new Headers(request.headers);
		headers.delete('x-client-ip');
		headers.delete('x-proxy-secret');
		const ip = request.headers.get('cf-connecting-ip');
		if (ip && env.PROXY_SECRET) {
			headers.set('x-client-ip', ip);
			headers.set('x-proxy-secret', env.PROXY_SECRET);
		}

		const upstream = new URL(url.pathname + url.search, `https://${origin}`);
		const hasBody = !['GET', 'HEAD'].includes(request.method);
		const res = await fetch(upstream, {
			method: request.method,
			headers,
			body: hasBody ? request.body : undefined,
			redirect: 'manual',
		});

		const out = new Response(res.body, res);
		const location = out.headers.get('location');
		if (location?.startsWith(`https://${origin}`)) {
			out.headers.set('location', `https://${url.hostname}${location.slice(origin.length + 8)}`);
		}
		return out;
	},
};
