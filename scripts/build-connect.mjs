// Rebuild the README contact buttons: node scripts/build-connect.mjs
// Uses the existing Space Grotesk outlines and Skill Icons brand marks.
import { readFile, writeFile } from 'node:fs/promises';

const fonts = JSON.parse(await readFile(new URL('./font-paths.json', import.meta.url), 'utf8'));
const icons = JSON.parse(await readFile(new URL('./connect-icons.json', import.meta.url), 'utf8'));
const font = fonts['SpaceGrotesk-700'];
const contacts = [
  { key: 'email', label: 'Gmail' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'github', label: 'GitHub' },
];

const number = value => Number(value.toFixed(6));
const textWidth = (text, size) => [...text].reduce((sum, c) => sum + font.glyphs[c].a, 0) * size / font.units;

// All three labels have visible y bounds -14..714 in this outlined font.
// Position their actual visible center on the icon center, not their baseline.
function label(text, x, centerY, size, centered = false) {
  let cursor = centered ? x - textWidth(text, size) / 2 : x;
  const scale = size / font.units;
  const baseline = centerY + 350 * scale;
  const glyphs = [...text].map(c => {
    const glyph = font.glyphs[c];
    const path = `<path d="${glyph.d}" transform="translate(${number(cursor)} ${number(baseline)}) scale(${number(scale)} ${number(-scale)})"/>`;
    cursor += glyph.a * scale;
    return path;
  }).join('');
  return `<g fill="#F4F7FF" aria-label="${text}">${glyphs}</g>`;
}

function icon(key, x, centerY, size) {
  const y = centerY - size / 2;
  if (key === 'email') {
    // Original geometric envelope; its visible bounds are centered at (12, 12).
    return `<g transform="translate(${number(x)} ${number(y)}) scale(${number(size / 24)})" fill="none" stroke="#F4F7FF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3.5" width="22" height="17" rx="3"/><path d="m2 5 10 8 10-8"/></g>`;
  }
  const box = key === 'github' ? [28, 28, 200] : [38, 38, 180];
  return `<g fill="#F4F7FF" transform="translate(${number(x)} ${number(y)}) scale(${number(size / box[2])}) translate(${-box[0]} ${-box[1]})">${icons[key].map(d => `<path d="${d}"/>`).join('')}</g>`;
}

for (const mobile of [false, true]) {
  // Match the artwork's existing content insets: 42/1200 and 28/560.
  // The desktop and mobile source artwork is exported at 1.1x resolution.
  const width = mobile ? 616 : 1320;
  const height = mobile ? 160 : 141;
  const inset = mobile ? 30.8 : 46.2;
  const gap = mobile ? 18 : 26.4;
  const cellWidth = width / 3;
  const cardWidth = (width - inset * 2 - gap * 2) / 3;

  for (const [index, contact] of contacts.entries()) {
    // Offset the artwork inside each equal-width image so that the first and
    // last card edges align with the headings, while preserving equal gaps.
    const x = inset + index * (cardWidth + gap) - index * cellWidth;
    const centerX = x + cardWidth / 2;
    const content = mobile
      ? icon(contact.key, centerX - 17, 62, 34) + label(contact.label, centerX, 106, 24, true)
      : icon(contact.key, x + 28, 70.5, 34) + label(contact.label, x + 80, 70.5, 39) +
        `<g transform="translate(${number(x + cardWidth - 49)} 59.5)" fill="none" stroke="#8492FF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 18 4M4 4h14v14"/></g>`;
    const cardHeight = mobile ? 144 : 125;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${number(cellWidth)}" height="${height}" viewBox="0 0 ${number(cellWidth)} ${height}" role="img" aria-labelledby="title desc"><title id="title">${contact.label}</title><desc id="desc">Connect with Vihanga Thathsara on ${contact.label}.</desc><defs><linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#16213A"/><stop offset="1" stop-color="#0E1628"/></linearGradient></defs><path fill="#090E1C" d="M0 0H${number(cellWidth)}V${height}H0Z"/><rect x="${number(x)}" y="8" width="${number(cardWidth)}" height="${cardHeight}" rx="${mobile ? 22 : 28}" fill="url(#panel)" stroke="#24324D" stroke-width="1.2"/>${content}</svg>\n`;
    const filename = `modern-link-${contact.key}${mobile ? '-mobile' : ''}.svg`;
    await writeFile(new URL(`../assets/${filename}`, import.meta.url), svg);
    console.log(filename);
  }
}
