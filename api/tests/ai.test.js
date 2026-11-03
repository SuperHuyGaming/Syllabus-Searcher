const config = require('../src/config');
const { checkUpload, redact, parseAnswer } = require('../src/lib/ai');
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
