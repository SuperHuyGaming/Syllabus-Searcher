const config = require('../src/config');
const { checkUpload, summarize, summarizeCourse, cleanSummary, cleanRollup, redact, parseAnswer } = require('../src/lib/ai');
const { htmlText } = require('../src/lib/text');

const DETAILS = { course: 'CS 310', title: 'Data Structures', term: 'Fall 2024', section: '001', instructor: 'Ada Lovelace' };
const TEXT = 'CS 310 Data Structures, Fall 2024, Section 001. Instructor: Dr. Ada Lovelace. Grading: 40% exams.';
const GOOD = {
  isSyllabus: true,
  documentType: 'course syllabus',
  courseCodes: ['CS 310'],
  matches: { course: 'yes', term: 'yes', section: 'yes', instructor: 'yes' },
  personalData: [],
  offensive: false,
  verdict: 'legit',
  reasons: ['A CS 310 syllabus for Fall 2024 taught by Ada Lovelace.'],
};

const gemini = (answer) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) });
const groq = (answer) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) });
const status = (code) => ({ ok: false, status: code, json: async () => ({}) });

const saved = { ...config };
afterEach(() => Object.assign(config, saved));
function useKeys({ fallback = false } = {}) {
  Object.assign(config, { aiProvider: 'gemini', aiModel: '', aiApiKey: 'gem-key' });
  if (fallback) Object.assign(config, { aiFallbackProvider: 'groq', aiFallbackModel: '', aiFallbackApiKey: 'groq-key' });
}

describe('redact', () => {
  test('removes emails, phone numbers and student IDs', () => {
    const { text, count } = redact('Mail ada@gmu.edu or call (703) 993-1000. Student G01234567, SSN 123-45-6789.');
    expect(text).toBe('Mail [email] or call [phone]. Student [student id], SSN [id].');
    expect(count).toBe(4);
  });

  test('leaves course codes, years and room numbers alone', () => {
    expect(redact('CS 310 in Fall 2024, ENGR 1103, 10:30-11:45').count).toBe(0);
  });
});

describe('parseAnswer', () => {
  test('keeps only known fields and values', () => {
    const answer = parseAnswer(
      '```json\n' + JSON.stringify({ ...GOOD, matches: { course: 'maybe' }, reasons: ['a', 2, ''], extra: 'x' }) + '\n```'
    );
    expect(answer.verdict).toBe('legit');
    expect(answer.matches).toEqual({ course: 'unclear', term: 'unclear', section: 'unclear', instructor: 'unclear' });
    expect(answer.reasons).toEqual(['a', '2']);
    expect(answer).not.toHaveProperty('extra');
  });

  test('rejects answers without JSON or a verdict', () => {
    expect(() => parseAnswer('Looks fine to me')).toThrow(/not JSON/);
    expect(() => parseAnswer('{"verdict":"great"}')).toThrow(/no verdict/);
  });
});

describe('checkUpload', () => {
  test('is unavailable without a key and calls nothing', async () => {
    Object.assign(config, { aiApiKey: '', aiFallbackApiKey: '' });
    const fetchImpl = jest.fn();
    const result = await checkUpload(TEXT, DETAILS, { fetchImpl });
    expect(result.unavailable).toMatch(/AI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('sends redacted, truncated text to Gemini and returns its verdict', async () => {
    useKeys();
    const fetchImpl = jest.fn().mockResolvedValue(gemini(GOOD));
    const long = `${TEXT} Email ada@gmu.edu. ${'x'.repeat(30000)}`;
    const result = await checkUpload(long, DETAILS, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/models/gemini-3.5-flash-lite:generateContent');
    expect(init.headers['x-goog-api-key']).toBe('gem-key');
    const prompt = JSON.parse(init.body).contents[0].parts[0].text;
    expect(prompt).toContain('Course: CS 310 (Data Structures)');
    expect(prompt).toContain('[email]');
    expect(prompt).not.toContain('ada@gmu.edu');
    expect(prompt.length).toBeLessThan(21000);

    expect(result).toMatchObject({ verdict: 'legit', provider: 'Gemini', model: 'gemini-3.5-flash-lite', redacted: 1, truncated: true });
    expect(result.reasons).toEqual(GOOD.reasons);
  });

  test('falls back to Groq when Gemini is out of quota', async () => {
    useKeys({ fallback: true });
    const fetchImpl = jest.fn().mockResolvedValueOnce(status(429)).mockResolvedValueOnce(groq(GOOD));
    const result = await checkUpload(TEXT, DETAILS, { fetchImpl });
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe('llama-3.3-70b-versatile');
    expect(result).toMatchObject({ verdict: 'legit', provider: 'Groq' });
  });

  test('says why when every provider fails, without throwing', async () => {
    useKeys({ fallback: true });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) });
    const result = await checkUpload(TEXT, DETAILS, { fetchImpl });
    expect(result.unavailable).toBe('Gemini free quota used up; Groq answer was not JSON.');
  });

  test('a network error or timeout counts as unavailable', async () => {
    useKeys();
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const result = await checkUpload(TEXT, DETAILS, { fetchImpl: jest.fn().mockRejectedValue(timeout) });
    expect(result.unavailable).toBe('Gemini timed out.');
  });

  test('mismatches, personal data and duplicates turn "legit" into "review"', async () => {
    useKeys();
    const answer = { ...GOOD, matches: { ...GOOD.matches, course: 'no' }, personalData: ['A table of student grades'] };
    const result = await checkUpload(TEXT, DETAILS, {
      fetchImpl: jest.fn().mockResolvedValue(gemini(answer)),
      duplicates: [{ section: '001', instructors: ['Lovelace, Ada'] }],
    });
    expect(result.verdict).toBe('review');
    expect(result.reasons).toEqual([
      GOOD.reasons[0],
      "Doesn't match the entered course.",
      'May contain personal data about students.',
      "The site already has this term's section 001 (Lovelace, Ada).",
    ]);
  });

  test('a junk verdict stays junk', async () => {
    useKeys();
    const answer = { ...GOOD, isSyllabus: false, verdict: 'junk', matches: { course: 'no' }, reasons: ['A homework assignment.'] };
    const result = await checkUpload(TEXT, DETAILS, { fetchImpl: jest.fn().mockResolvedValue(gemini(answer)) });
    expect(result.verdict).toBe('junk');
  });

  test('a file with almost no text needs review and is not sent', async () => {
    useKeys();
    const fetchImpl = jest.fn();
    const result = await checkUpload('  Page 1 ', DETAILS, { fetchImpl });
    expect(result.verdict).toBe('review');
    expect(result.reasons[0]).toMatch(/scanned/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('htmlText', () => {
  test('drops scripts, styles and tags and decodes entities', () => {
    const html = '<html><head><title>x</title></head><script>alert(1)</script><p>CS&nbsp;483 &amp; more&#33;</p><p>Next</p></html>';
    expect(htmlText(html).replace(/\s+/g, ' ').trim()).toBe('CS 483 & more! Next');
  });
});

const SUMMARY = {
  overview: 'Data structures in Java.',
  prerequisites: 'CS 211 with a C or better.',
  grading: [
    { item: 'Projects', weight: '40%' },
    { item: 'Exams', weight: '60%' },
  ],
  policies: { lateWork: 'Two late days.', attendance: 'Not graded.', aiUse: 'Not allowed on projects.' },
  topics: ['Lists', 'Trees', 'Hash tables'],
  tools: ['Java', 'Gradescope'],
  textbooks: ['Data Structures, Weiss'],
  workload: ['5 projects', '2 midterms and a final'],
};

describe('cleanSummary', () => {
  test('keeps known fields, trims lists and fills in missing ones', () => {
    const clean = cleanSummary({
      overview: '  About trees. ',
      topics: Array.from({ length: 20 }, (_, i) => `Topic ${i}`),
      grading: [{ item: 'Exams', weight: 50 }, { weight: '10%' }, 'junk'],
      policies: { aiUse: 'Ask first.', other: 'x' },
      extra: 'x',
    });
    expect(clean.overview).toBe('About trees.');
    expect(clean.topics).toHaveLength(12);
    expect(clean.grading).toEqual([{ item: 'Exams', weight: '50' }]);
    expect(clean.policies).toEqual({ lateWork: '', attendance: '', aiUse: 'Ask first.' });
    expect(clean.tools).toEqual([]);
    expect(clean).not.toHaveProperty('extra');
  });

  test('copes with nothing at all', () => {
    expect(cleanSummary(null).topics).toEqual([]);
  });
});

describe('summarize', () => {
  test('sends redacted text and returns a clean summary', async () => {
    useKeys();
    const fetchImpl = jest.fn().mockResolvedValue(gemini({ ...SUMMARY, extra: 'x' }));
    const result = await summarize(`${TEXT} Email ada@gmu.edu for help.`, { fetchImpl });
    expect(result).toEqual(expect.objectContaining({ summary: SUMMARY, provider: 'Gemini', model: 'gemini-3.5-flash-lite' }));
    expect(result.generatedAt).toEqual(expect.any(String));
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(sent).toContain('[email]');
    expect(sent).not.toContain('ada@gmu.edu');
  });

  test('falls back to Groq, and turns down an empty answer', async () => {
    useKeys({ fallback: true });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(gemini({ overview: '', topics: [] }))
      .mockResolvedValueOnce(groq(SUMMARY));
    const result = await summarize(TEXT, { fetchImpl });
    expect(result.provider).toBe('Groq');
    expect(result.summary.topics).toEqual(SUMMARY.topics);
  });

  test('is unavailable without a key, without text, or when every provider fails', async () => {
    Object.assign(config, { aiApiKey: '', aiFallbackApiKey: '' });
    expect((await summarize(TEXT)).unavailable).toMatch(/AI_API_KEY/);
    useKeys();
    const fetchImpl = jest.fn().mockResolvedValue(status(429));
    expect((await summarize('tiny', { fetchImpl })).unavailable).toMatch(/Almost no text/);
    expect((await summarize(TEXT, { fetchImpl })).unavailable).toBe('Gemini free quota used up.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('summarizeCourse', () => {
  const COURSE = { display: 'CS 310', title: 'Data Structures' };
  const SOURCES = [
    { label: 'Fall 2024, Lovelace, Ada', summary: SUMMARY },
    { label: 'Spring 2024, Hopper, Grace', summary: { ...SUMMARY, tools: ['Python'] } },
  ];
  const ROLLUP = {
    overview: 'Across these syllabi, CS 310 usually covers lists and trees.',
    topics: ['Lists', 'Trees'],
    tools: ['Java'],
    textbooks: [],
    grading: [{ item: 'Projects', weight: '30-40%' }],
    workload: ['5 projects'],
    differences: ['Hopper, Grace uses Python.'],
  };

  test('sends every syllabus summary with its label and returns a clean rollup', async () => {
    useKeys();
    const fetchImpl = jest.fn().mockResolvedValue(gemini({ ...ROLLUP, extra: 'x' }));
    const result = await summarizeCourse(COURSE, SOURCES, { fetchImpl });
    expect(result).toEqual(expect.objectContaining({ rollup: ROLLUP, provider: 'Gemini' }));
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(sent).toContain('Course: CS 310 (Data Structures)');
    expect(sent).toContain('## Spring 2024, Hopper, Grace');
    expect(sent).toContain('"Python"');
  });

  test('needs two syllabi, a key and a usable answer', async () => {
    Object.assign(config, { aiApiKey: '', aiFallbackApiKey: '' });
    expect((await summarizeCourse(COURSE, SOURCES)).unavailable).toMatch(/AI_API_KEY/);
    useKeys();
    const fetchImpl = jest.fn().mockResolvedValue(gemini({ overview: '', topics: [] }));
    expect((await summarizeCourse(COURSE, SOURCES.slice(0, 1), { fetchImpl })).unavailable).toMatch(/two/);
    expect((await summarizeCourse(COURSE, SOURCES, { fetchImpl })).unavailable).toBe('Gemini answer had no rollup.');
  });

  test('cleanRollup keeps known fields and caps the lists', () => {
    const clean = cleanRollup({ overview: ' x ', differences: Array.from({ length: 9 }, (_, i) => `d${i}`), policies: {} });
    expect(clean.overview).toBe('x');
    expect(clean.differences).toHaveLength(6);
    expect(clean.topics).toEqual([]);
    expect(clean).not.toHaveProperty('policies');
  });
});
