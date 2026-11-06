const { createScrapeTrigger } = require('../src/lib/github');

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
const RUNS = {
  workflow_runs: [
    { event: 'workflow_dispatch', display_title: 'Scrape syllabi (staging)', status: 'in_progress', conclusion: null },
    {
      event: 'workflow_dispatch',
      display_title: 'Scrape syllabi (production)',
      status: 'completed',
      conclusion: 'success',
      run_started_at: '2026-11-05T19:00:00Z',
      html_url: 'https://github.com/o/r/actions/runs/1',
    },
    { event: 'schedule', display_title: 'Scrape syllabi', status: 'completed', conclusion: 'success' },
  ],
};

function trigger(fetchImpl, options = {}) {
  return createScrapeTrigger({ token: 't0ken', repo: 'o/r', environment: 'production', fetchImpl, ...options });
}

test('is off without a token, repo or environment', async () => {
  const fetchImpl = jest.fn();
  const off = createScrapeTrigger({ token: '', repo: 'o/r', environment: 'production', fetchImpl });
  expect(off.enabled).toBe(false);
  expect(await off.latest()).toEqual({ enabled: false, environment: 'production', run: null });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("reads the latest run for this site, skipping the other site's runs", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(reply(200, RUNS));
  const result = await trigger(fetchImpl).latest();
  expect(fetchImpl.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/actions/workflows/scrape.yml/runs?per_page=20');
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer t0ken');
  expect(result.run).toEqual({
    status: 'completed',
    conclusion: 'success',
    running: false,
    event: 'workflow_dispatch',
    startedAt: '2026-11-05T19:00:00Z',
    url: 'https://github.com/o/r/actions/runs/1',
  });
});

test('counts the weekly scheduled run for either site', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(reply(200, { workflow_runs: [RUNS.workflow_runs[2]] }));
  const { run } = await trigger(fetchImpl, { environment: 'staging' }).latest();
  expect(run.event).toBe('schedule');
});

test('starts the workflow on main for this site', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(reply(204));
  await trigger(fetchImpl).start();
  const [url, options] = fetchImpl.mock.calls[0];
  expect(url).toBe('https://api.github.com/repos/o/r/actions/workflows/scrape.yml/dispatches');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({ ref: 'main', inputs: { environment: 'production' } });
});

test("passes on GitHub's error message", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(reply(403, { message: 'Resource not accessible by personal access token' }));
  await expect(trigger(fetchImpl).start()).rejects.toThrow('GitHub answered 403: Resource not accessible by personal access token');
});
