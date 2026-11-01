// Turns the text items pdf.js finds on a page into plain lines for the review card.
// Each item is a run of text; hasEOL marks the end of a line.
export function pageText(items) {
  return items
    .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
