// Input text hygiene for synthesis.

// C0/C1 controls, zero-width/bidi marks, line/paragraph separators, word joiners, BOM.
// Built from code points so the source stays plain ASCII.
const CONTROL_RANGES = [
  [0x0000, 0x001f], [0x007f, 0x009f], [0x200b, 0x200f], [0x2028, 0x2029],
  [0x202a, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff],
];
const CONTROL = new RegExp(`[${CONTROL_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g');
const HIGH_SURROGATE_AT_END = new RegExp(`[${String.fromCharCode(0xd800)}-${String.fromCharCode(0xdbff)}]$`);
const TRAILING_JOINERS = new RegExp(`[\\s,;:${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}-]+$`);

/**
 * Trim, strip control characters, collapse whitespace and cap the length (cutting at a word
 * boundary when possible).
 * @returns {{text: string, truncated: boolean}}
 */
export function cleanText(input, maxLen) {
  if (typeof input !== 'string') return { text: '', truncated: false };
  let text = input.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  let truncated = false;
  if (text.length > maxLen) {
    truncated = true;
    let cut = text.slice(0, maxLen);
    const space = cut.lastIndexOf(' ');
    if (space > maxLen * 0.6) cut = cut.slice(0, space);
    text = cut.replace(HIGH_SURROGATE_AT_END, '').replace(TRAILING_JOINERS, '').trim();
  }
  return { text, truncated };
}

/** True when the text has something pronounceable (a letter or digit). */
export function hasWords(text) {
  return /[\p{L}\p{N}]/u.test(text);
}
