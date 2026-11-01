// Same rules as the API (api/src/lib/terms.js): "cs 310", "CS-310", "cs310" -> "CS310".
export function normalizeCourse(input) {
  const match = String(input || '')
    .trim()
    .match(/^([A-Za-z]{2,4})\s*-?\s*(\d{3}[A-Za-z]?)$/);
  return match ? `${match[1].toUpperCase()}${match[2].toUpperCase()}` : null;
}

// "CS310" -> "CS 310"
export function displayCourse(code) {
  const match = String(code).match(/^([A-Z]+)(\d.*)$/);
  return match ? `${match[1]} ${match[2]}` : code;
}
