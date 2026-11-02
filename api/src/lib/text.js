// Plain text of an uploaded file, for the AI check. PDFs are read with unpdf
// (a small serverless build of pdf.js); HTML pages have their tags removed.
// unpdf is an ES module, so it's loaded with import() the first time it's needed.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function htmlText(html) {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    });
}

// Collapses runs of spaces but keeps line breaks, which help the model see headings.
const tidy = (text) =>
  text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();

async function pdfText(buffer) {
  const { extractText } = await import('unpdf');
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return text;
}

async function fileText(buffer, contentType) {
  const raw = String(contentType).startsWith('text/html') ? htmlText(buffer.toString('utf8')) : await pdfText(buffer);
  return tidy(raw);
}

module.exports = { fileText, htmlText };
