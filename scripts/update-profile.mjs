// Generate repository-owned SVG cards from the public GitHub profile.
// Node.js 22+, no dependencies. GITHUB_TOKEN is provided by GitHub Actions.
// Tokens are used only in API request headers and are never written to assets.
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ASSETS = new URL('../assets/', import.meta.url);
const DAY = 86_400_000;
const PALETTE = ['#162637', '#164E63', '#0E7490', '#06B6D4', '#67E8F9'];
const LANGUAGE_COLORS = {
  Java: '#F89820', JavaScript: '#F7DF1E', TypeScript: '#3178C6',
  HTML: '#E34C26', CSS: '#A78BFA', SCSS: '#C6538C', Python: '#4B8BBE',
  PowerShell: '#5391FE', Kotlin: '#A97BFF', Shell: '#89E051',
  Vue: '#41B883', Dart: '#00B4AB', 'C#': '#88C75D', Other: '#648096'
};

export const escapeXml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
}[c]));
const formatNumber = (value) => new Intl.NumberFormat('en-US').format(value);
const timestamp = (date) => date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const dateMs = (date) => Date.parse(date + 'T00:00:00Z');

export function todayInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1]] = match[2] ?? match[3];
  }
  return result;
}

export function parsePublicCalendar(html) {
  const countsById = new Map();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)) {
    const a = attributes(match[1]);
    const text = match[2].replace(/<[^>]+>/g, ' ').trim();
    const count = text.match(/([\d,]+)\s+contributions?\b/i);
    if (a.for && (/\bNo contributions?\b/i.test(text) || count)) {
      countsById.set(a.for, count ? Number(count[1].replaceAll(',', '')) : 0);
    }
  }
  const days = new Map();
  for (const match of html.matchAll(/<(?:td|rect)\b[^>]*\bdata-date\s*=[^>]*>/gi)) {
    const a = attributes(match[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a['data-date'] || '')) continue;
    const value = a['data-count'] === undefined ? countsById.get(a.id) : Number(a['data-count']);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error('Public calendar markup changed; keeping the last generated cards.');
    }
    days.set(a['data-date'], value);
  }
  if (!days.size) throw new Error('No contribution calendar data was returned.');
  return days;
}

export function calendarWindow(source, end) {
  const last = dateMs(end);
  const first = last - 364 * DAY;
  const days = Array.from({ length: 365 }, (_, index) => {
    const date = new Date(first + index * DAY).toISOString().slice(0, 10);
    return { date, count: source.get(date) ?? 0 };
  });
  let current = 0;
  let index = days.length - 1;
  if (days[index].count === 0) index -= 1; // A streak may continue through yesterday.
  while (index >= 0 && days[index].count > 0) { current += 1; index -= 1; }
  let longest = 0;
  let run = 0;
  for (const day of days) {
    run = day.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { days, current, longest, total: days.reduce((sum, d) => sum + d.count, 0) };
}

export function languageShares(languageTotals) {
  const rows = Object.entries(languageTotals)
    .filter(([, bytes]) => Number.isFinite(bytes) && bytes > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, bytes]) => sum + bytes, 0);
  const visible = rows.length <= 8 ? rows : [
    ...rows.slice(0, 7), ['Other', rows.slice(7).reduce((sum, [, bytes]) => sum + bytes, 0)]
  ];
  return visible.map(([name, bytes]) => ({
    name, bytes, percent: bytes / total * 100,
    color: LANGUAGE_COLORS[name] || '#67E8F9'
  }));
}

function svg(height, title, body, description = title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(description)}</desc>
<rect x="1" y="1" width="1198" height="${height - 2}" rx="18" fill="#0B1220" stroke="#24364C"/>
<g font-family="DejaVu Sans, Arial, sans-serif">${body}</g></svg>\n`;
}

export function overviewSvg(data) {
  const joined = new Date(data.user.created_at).toLocaleDateString('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric'
  });
  const stars = data.repos.reduce((sum, repo) => sum + Number(repo.stargazers_count || 0), 0);
  const cells = [
    ['PUBLIC REPOSITORIES', data.user.public_repos, '#67E8F9'],
    ['FOLLOWERS', data.user.followers, '#A7F3D0'],
    ['STARS RECEIVED', stars, '#FBBF24'],
    ['CONTRIBUTIONS / YEAR', data.calendar.total, '#C4B5FD']
  ];
  const tiles = cells.map(([label, value, color], i) => {
    const x = 28 + i * 290;
    return `<rect x="${x}" y="91" width="274" height="112" rx="12" fill="#111E2F"/>
<rect x="${x + 17}" y="108" width="3" height="21" rx="1.5" fill="${color}"/>
<text x="${x + 30}" y="123" fill="#A5B5C8" font-size="12" font-weight="700" letter-spacing=".7">${label}</text>
<text x="${x + 23}" y="183" fill="${color}" font-size="44" font-weight="700">${formatNumber(value)}</text>`;
  }).join('');
  return svg(248, 'GitHub overview', `
<text x="30" y="38" fill="#F1F5F9" font-size="21" font-weight="700">GitHub / Public Activity</text>
<text x="30" y="64" fill="#8EA4BC" font-size="13">${escapeXml(data.user.login)} · Member since ${joined}</text>
${tiles}
<text x="30" y="229" fill="#7890A9" font-size="12">Public profile data · Contributions cover the displayed 365-day window</text>
<text x="1170" y="229" text-anchor="end" fill="#7890A9" font-size="12">Updated ${timestamp(data.now)}</text>`);
}

export function languagesSvg(data) {
  const rows = languageShares(data.languages);
  if (!rows.length) {
    return svg(170, 'Languages in public repositories', '<text x="30" y="47" fill="#F1F5F9" font-size="21" font-weight="700">Languages in Public Repositories</text><text x="30" y="100" fill="#8EA4BC" font-size="15">Language data will appear after source code is published.</text>');
  }
  let x = 30;
  const bar = rows.map((row) => {
    const width = row.percent * 11.4;
    const segment = `<rect x="${x.toFixed(2)}" y="98" width="${width.toFixed(2)}" height="18" fill="${row.color}"><title>${escapeXml(row.name)}: ${row.percent.toFixed(1)}%</title></rect>`;
    x += width;
    return segment;
  }).join('');
  const legend = rows.map((row, i) => {
    const col = i % 4;
    const y = 160 + Math.floor(i / 4) * 55;
    const x = 30 + col * 289;
    return `<circle cx="${x + 6}" cy="${y - 5}" r="5" fill="${row.color}"/>
<text x="${x + 22}" y="${y}" fill="#DBE7F4" font-size="15" font-weight="600">${escapeXml(row.name)}</text>
<text x="${x + 22}" y="${y + 20}" fill="#8EA4BC" font-size="13">${row.percent.toFixed(1)}% of code bytes</text>`;
  }).join('');
  const height = rows.length <= 4 ? 224 : 280;
  return svg(height, 'Languages in public repositories', `
<text x="30" y="38" fill="#F1F5F9" font-size="21" font-weight="700">Languages / Public Source Code</text>
<text x="30" y="66" fill="#8EA4BC" font-size="13">Aggregated code bytes · Forks and the profile repository excluded</text>
<defs><clipPath id="bar"><rect x="30" y="98" width="1140" height="18" rx="9"/></clipPath></defs>
<g clip-path="url(#bar)">${bar}</g>${legend}
<text x="30" y="${height - 19}" fill="#7890A9" font-size="12">Repository composition is not a measure of skill level.</text>`);
}

export function contributionsSvg(data) {
  const { days, total, current, longest } = data.calendar;
  const first = dateMs(days[0].date);
  const start = first - new Date(first).getUTCDay() * DAY;
  const max = Math.max(1, ...days.map((d) => d.count));
  const cellX = 48;
  const cellY = 117;
  const step = 21;
  const monthLabels = new Map();
  const cells = days.map((day) => {
    const time = dateMs(day.date);
    const offset = Math.round((time - start) / DAY);
    const col = Math.floor(offset / 7);
    const row = offset % 7;
    const date = new Date(time);
    if ((date.getUTCDate() <= 7 && row === 0) || offset < 7) {
      const month = date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
      if (!monthLabels.has(month + '-' + date.getUTCFullYear())) monthLabels.set(month + '-' + date.getUTCFullYear(), { col, month });
    }
    const level = day.count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(day.count / max * 4)));
    return `<rect x="${cellX + col * step}" y="${cellY + row * step}" width="16" height="16" rx="3" fill="${PALETTE[level]}"><title>${day.date}: ${day.count} contributions</title></rect>`;
  }).join('');
  const months = [...monthLabels.values()].map(({ col, month }) => `<text x="${cellX + col * step}" y="102" fill="#8EA4BC" font-size="12">${month}</text>`).join('');
  const legend = PALETTE.map((color, i) => `<rect x="${1030 + i * 22}" y="282" width="16" height="16" rx="3" fill="${color}"/>`).join('');
  return svg(322, 'Contribution calendar', `
<text x="30" y="38" fill="#F1F5F9" font-size="21" font-weight="700">Contributions / Keep Building</text>
<text x="30" y="65" fill="#8EA4BC" font-size="13">${formatNumber(total)} contributions · ${days[0].date} to ${days.at(-1).date}</text>
<text x="833" y="31" fill="#8EA4BC" font-size="11" font-weight="700" letter-spacing="1">CURRENT STREAK</text>
<text x="833" y="65" fill="#67E8F9" font-size="28" font-weight="700">${current} ${current === 1 ? 'day' : 'days'}</text>
<text x="1035" y="31" fill="#8EA4BC" font-size="11" font-weight="700" letter-spacing="1">BEST IN WINDOW</text>
<text x="1035" y="65" fill="#A7F3D0" font-size="28" font-weight="700">${longest} ${longest === 1 ? 'day' : 'days'}</text>
<text x="15" y="151" fill="#7890A9" font-size="10">M</text>
<text x="15" y="193" fill="#7890A9" font-size="10">W</text>
<text x="15" y="235" fill="#7890A9" font-size="10">F</text>
${months}${cells}
<text x="30" y="294" fill="#7890A9" font-size="12">A current streak can continue through yesterday · Best streak is within the displayed year</text>
<text x="991" y="295" fill="#8EA4BC" font-size="11">Less</text>${legend}<text x="1150" y="295" fill="#8EA4BC" font-size="11">More</text>`);
}

export async function collectProfile({ userName, token = '', now = new Date(), timeZone = 'Asia/Colombo' }) {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(userName)) throw new Error('Invalid GitHub username.');
  const userPart = encodeURIComponent(userName);
  const end = todayInZone(now, timeZone);
  const start = new Date(dateMs(end) - 364 * DAY).toISOString().slice(0, 10);

  async function request(url, options = {}, text = false) {
    const headers = { 'User-Agent': 'Repository-Profile-Cards', Accept: text ? 'text/html' : 'application/vnd.github+json', ...options.headers };
    if (token && new URL(url).hostname === 'api.github.com') headers.Authorization = `Bearer ${token}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(25_000) });
        if (!response.ok) {
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
          throw new Error(`GitHub returned HTTP ${response.status} for ${new URL(url).pathname}.`);
        }
        return text ? await response.text() : await response.json();
      } catch (error) {
        if (attempt === 2 || /HTTP (?:4\d\d)/.test(error.message)) throw error;
      }
    }
  }

  const user = await request(`https://api.github.com/users/${userPart}`);
  if (!Number.isInteger(user.followers) || !Number.isInteger(user.public_repos) || !user.created_at) {
    throw new Error('Incomplete public account data; preserving existing cards.');
  }
  const repos = [];
  for (let page = 1; ; page += 1) {
    const rows = await request(`https://api.github.com/users/${userPart}/repos?type=owner&per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new Error('Invalid repository response.');
    repos.push(...rows);
    if (rows.length < 100) break;
  }

  const sourceRepos = repos.filter((repo) => !repo.fork && repo.name.toLowerCase() !== userName.toLowerCase() && repo.size > 0);
  const languages = {};
  for (let i = 0; i < sourceRepos.length; i += 4) {
    const batch = await Promise.all(sourceRepos.slice(i, i + 4).map((repo) =>
      request(`https://api.github.com/repos/${userPart}/${encodeURIComponent(repo.name)}/languages`)));
    for (const totals of batch) {
      for (const [language, bytes] of Object.entries(totals)) {
        if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Invalid language data.');
        languages[language] = (languages[language] || 0) + bytes;
      }
    }
  }

  let source;
  if (token) {
    try {
      const result = await request('https://api.github.com/graphql', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'query($login: String!, $from: DateTime!, $to: DateTime!) { user(login: $login) { contributionsCollection(from: $from, to: $to) { contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }',
          variables: { login: userName, from: `${start}T00:00:00Z`, to: now.toISOString() }
        })
      });
      if (result.errors) throw new Error('GraphQL calendar unavailable.');
      const weeks = result.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
      if (!Array.isArray(weeks) || !weeks.length) throw new Error('Missing calendar weeks.');
      const entries = weeks.flatMap((week) => week.contributionDays.map((day) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isInteger(day.contributionCount) || day.contributionCount < 0) throw new Error('Invalid calendar data.');
        return [day.date, day.contributionCount];
      }));
      if (!entries.length) throw new Error('Empty calendar response.');
      source = new Map(entries);
    } catch {
      console.warn('Using the public contribution calendar as the API fallback.');
    }
  }
  if (!source) {
    const html = await request(`https://github.com/users/${userPart}/contributions?from=${start}&to=${end}`, {}, true);
    source = parsePublicCalendar(html);
  }
  return { user, repos, languages, calendar: calendarWindow(source, end), now, timeZone };
}

export async function writeCards(data) {
  // Collect and render everything before changing any existing output files.
  const cards = {
    'github-overview.svg': overviewSvg(data),
    'languages.svg': languagesSvg(data),
    'contributions.svg': contributionsSvg(data)
  };
  await mkdir(ASSETS, { recursive: true });
  for (const [name, body] of Object.entries(cards)) {
    await writeFile(new URL(name + '.tmp', ASSETS), body, 'utf8');
  }
  for (const name of Object.keys(cards)) {
    await rename(new URL(name + '.tmp', ASSETS), new URL(name, ASSETS));
  }
  return Object.keys(cards);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const userName = process.env.PROFILE_USER || process.env.GITHUB_REPOSITORY?.split('/')[0] || 'VihangaThathsara';
    const data = await collectProfile({
      userName, token: process.env.GITHUB_TOKEN || '',
      timeZone: process.env.PROFILE_TIMEZONE || 'Asia/Colombo'
    });
    const names = await writeCards(data);
    console.log(`Updated ${names.length} cards for ${data.user.login}: ${data.user.public_repos} repositories, ${data.calendar.total} contributions in the displayed window.`);
  } catch (error) {
    console.error(`Profile cards were not refreshed: ${error.message}`);
    process.exitCode = 1;
  }
}
