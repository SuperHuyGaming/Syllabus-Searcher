// Term keys come from the API as "<year>-<n>" (Spring=1, Summer=2, Fall=3).
const SEASONS = ['Spring', 'Summer', 'Fall'];

export function termLabel(key) {
  const [year, n] = key.split('-');
  return `${SEASONS[Number(n) - 1]} ${year}`;
}

// Terms students can pick when uploading: this term back to Fall 2022, newest first.
export function recentTerms(now = new Date(), oldest = '2022-3') {
  const month = now.getMonth();
  let year = now.getFullYear();
  let n = month < 5 ? 1 : month < 8 ? 2 : 3;
  const terms = [];
  for (let key = `${year}-${n}`; key >= oldest; key = `${year}-${n}`) {
    terms.push({ key, label: termLabel(key) });
    n -= 1;
    if (n === 0) {
      n = 3;
      year -= 1;
    }
  }
  return terms;
}

// Groups API offerings by term, newest first, keeping each term's sections in order.
export function groupByTerm(offerings) {
  const groups = new Map();
  for (const offering of offerings) {
    if (!groups.has(offering.termKey)) groups.set(offering.termKey, []);
    groups.get(offering.termKey).push(offering);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([termKey, items]) => ({
      termKey,
      label: termLabel(termKey),
      offerings: items.sort((a, b) => a.section.localeCompare(b.section, 'en', { numeric: true })),
    }));
}

// Every distinct instructor across the offerings, for the professor filter.
export function instructorsOf(offerings) {
  return [...new Set(offerings.flatMap((o) => o.instructors))].sort();
}
