// "Refresh now" on /admin: starts the Scrape syllabi workflow (.github/workflows/scrape.yml)
// for this site through the GitHub API, and reads back its latest run.
// Needs a fine-grained token with Actions read and write on this repository only.
const config = require('../config');

const API = 'https://api.github.com';
const WORKFLOW = 'scrape.yml';
const RUNNING = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];

function createScrapeTrigger({
  token = config.githubToken,
  repo = config.githubRepo,
  environment = config.siteEnvironment,
  ref = 'main',
  fetchImpl = globalThis.fetch,
} = {}) {
  const enabled = Boolean(token && repo && environment);

  async function call(path, options = {}) {
    const res = await fetchImpl(`${API}/repos/${repo}/actions/workflows/${WORKFLOW}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'syllabus-searcher',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`GitHub answered ${res.status}${body.message ? `: ${body.message}` : ''}`);
    }
    return res.status === 204 ? null : res.json();
  }

  // Manual runs are named "Scrape syllabi (staging)" etc. (run-name in scrape.yml);
  // the weekly scheduled run covers both sites.
  const forThisSite = (run) => run.event === 'schedule' || run.display_title?.includes(`(${environment})`);

  async function latest() {
    if (!enabled) return { enabled, environment: environment || null, run: null };
    const { workflow_runs: runs = [] } = await call('/runs?per_page=20');
    const run = runs.find(forThisSite);
    return {
      enabled,
      environment,
      run: run
        ? {
            status: run.status,
            conclusion: run.conclusion,
            running: RUNNING.includes(run.status),
            event: run.event,
            startedAt: run.run_started_at || run.created_at,
            url: run.html_url,
          }
        : null,
    };
  }

  async function start() {
    await call('/dispatches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, inputs: { environment } }),
    });
  }

  return { enabled, latest, start };
}

module.exports = { createScrapeTrigger };
