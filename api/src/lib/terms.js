// Terms sort as "<year>-<n>" where Spring=1, Summer=2, Fall=3, so a plain
// string sort (or a descending DynamoDB query) lists newest terms first.
const SEASONS = ['Spring', 'Summer', 'Fall'];

function parseTerm(input) {
  if (!input) return null;
  const text = String(input).trim();

  const keyMatch = text.match(/^(\d{4})-([123])$/);
  if (keyMatch) {
    const year = Number(keyMatch[1]);
    const season = SEASONS[Number(keyMatch[2]) - 1];
    return { year, season, key: text, label: `${season} ${year}` };
  }

  const labelMatch = text.match(/^(spring|summer|fall)[\s_-]*(\d{4})$/i);
  if (!labelMatch) return null;
  const season = labelMatch[1][0].toUpperCase() + labelMatch[1].slice(1).toLowerCase();
  const year = Number(labelMatch[2]);
  return { year, season, key: `${year}-${SEASONS.indexOf(season) + 1}`, label: `${season} ${year}` };
}

// "cs 310", "CS-310", "cs310" -> "CS310"
function normalizeCourse(input) {
  if (!input) return null;
  const match = String(input).trim().match(/^([A-Za-z]{2,4})\s*-?\s*(\d{3}[A-Za-z]?)$/);
  return match ? `${match[1].toUpperCase()}${match[2].toUpperCase()}` : null;
}

// "CS310" -> "CS 310"
function displayCourse(code) {
  const match = String(code).match(/^([A-Z]+)(\d.*)$/);
  return match ? `${match[1]} ${match[2]}` : code;
}

module.exports = { parseTerm, normalizeCourse, displayCourse, SEASONS };
