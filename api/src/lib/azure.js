// Azure AI Document Intelligence (F0 free tier) reads an uploaded PDF so the
// reviewer can see which course codes and terms it mentions. Optional: when the
// endpoint/key aren't set, uploads still work without it.
const config = require('../config');

const API_VERSION = '2024-11-30';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summarize(content) {
  const unique = (values) => [...new Set(values)];
  return {
    courseCodes: unique((content.match(/\b[A-Z]{2,4}\s?-?\d{3}\b/g) || []).map((c) => c.replace(/[\s-]/g, ''))).slice(0, 10),
    terms: unique(content.match(/\b(Spring|Summer|Fall)\s+20\d{2}\b/gi) || []).slice(0, 5),
    preview: content.slice(0, 500),
  };
}

async function analyzeSyllabus(buffer, { fetchImpl = fetch, timeoutMs = 10000, pollMs = 1000 } = {}) {
  if (!config.azureEndpoint || !config.azureKey) return null;

  try {
    const start = await fetchImpl(
      `${config.azureEndpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', 'Ocp-Apim-Subscription-Key': config.azureKey },
        body: buffer,
      }
    );
    if (start.status !== 202) return { error: `Azure returned ${start.status}` };

    const operation = start.headers.get('operation-location');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const poll = await fetchImpl(operation, { headers: { 'Ocp-Apim-Subscription-Key': config.azureKey } });
      const result = await poll.json();
      if (result.status === 'succeeded') return summarize(result.analyzeResult?.content || '');
      if (result.status === 'failed') return { error: 'Azure analysis failed' };
    }
    return { error: 'Azure analysis timed out' };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { analyzeSyllabus, summarize };
