// Generate repository-owned SVG cards from the public GitHub profile.
// Node.js 22+, no dependencies. GITHUB_TOKEN is provided by GitHub Actions.
// Tokens are used only in API request headers and are never written to assets.
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ASSETS = new URL('../assets/', import.meta.url);
const DAY = 86_400_000;
const PALETTE = ['#1C2A2C', '#374D32', '#5F7C3B', '#95BD4F', '#CBF56A'];
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

const THEME = { bg:'#090F11', panel:'#111A1C', line:'#2C3839', ink:'#F2F1E8', muted:'#9CAEB0', lime:'#CBF56A', blue:'#83CFCF', orange:'#F2AB78' };
const SANS = 'Arial, Helvetica, sans-serif';
const MONO = 'DejaVu Sans Mono, monospace';
const tx = (x,y,value,size=16,color=THEME.ink,weight=400,extra='') => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" ${extra}>${escapeXml(value)}</text>`;
const rule = (x1,y1,x2,y2,color=THEME.line) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}"/>`;
const box = (x,y,w,h,fill=THEME.panel,stroke=THEME.line) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}"/>`;

function svg(width,height,title,body,description='Public data from GitHub.') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(description)}</desc>${box(.5,.5,width-1,height-1,THEME.bg)}<g font-family="${SANS}">${body}</g></svg>\n`;
}

export function overviewSvg(data, mobile=false) {
  const joined = new Date(data.user.created_at).toLocaleDateString('en-GB', { timeZone:'UTC',day:'2-digit',month:'short',year:'numeric' });
  const stars = data.repos.reduce((sum,repo)=>sum+Number(repo.stargazers_count||0),0);
  const metrics = [
    ['PUBLIC REPOSITORIES',data.user.public_repos,THEME.lime],['FOLLOWERS',data.user.followers,THEME.blue],
    ['STARS RECEIVED',stars,THEME.orange],['CONTRIBUTIONS / YEAR',data.calendar.total,THEME.ink]
  ];
  const w=mobile?560:1120, h=mobile?439:252;
  let body=tx(26,37,'GitHub Overview',28,THEME.ink,700);
  body+=tx(mobile?26:1094,mobile?66:36,`Joined ${joined}`,16,THEME.muted,400,mobile?'':'text-anchor="end"');
  body+=rule(26,mobile?87:61,w-26,mobile?87:61);
  metrics.forEach(([label,value,color],i)=>{
    const x=26+(mobile?i%2*267:i*273), y=mobile?108+Math.floor(i/2)*134:84;
    body+=tx(x,y+13,label,mobile?14:15,THEME.muted,700);
    body+=tx(x,y+77,formatNumber(value),57,color,700);
    body+=rule(x,y+95,x+(mobile?241:247),y+95);
  });
  if(mobile)body+=tx(26,h-23,`Updated ${timestamp(data.now)}`,15,THEME.muted);
  if(!mobile)body+=tx(w-26,h-23,`Updated ${timestamp(data.now)}`,15,THEME.muted,400,'text-anchor="end"');
  return svg(w,h,'Public GitHub telemetry',body,`${data.user.public_repos} public repositories. ${data.user.followers} followers. ${stars} stars received. ${data.calendar.total} contributions in the displayed 365-day window. Joined ${joined}.`);
}

export function languagesSvg(data, mobile=false) {
  const rows=languageShares(data.languages);
  if(!rows.length)return svg(mobile?560:1120,160,'Source distribution',tx(26,40,'Most Used Languages',25,THEME.ink,700)+tx(26,98,'Language data appears after source code is published.',15,THEME.muted));
  const w=mobile?560:1120, h=mobile?585:326;
  let body=tx(26,38,'Most Used Languages',28,THEME.ink,700);
  const cx=mobile?280:157, cy=mobile?178:168, r=mobile?87:80, c=2*Math.PI*r;
  let offset=0;
  rows.forEach(row=>{
    const length=row.percent/100*c;
    body+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${row.color}" stroke-width="17" stroke-dasharray="${length} ${c-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset+=length;
  });
  body+=tx(cx,cy+1,`${rows[0].percent.toFixed(1)}%`,mobile?34:32,THEME.ink,700,'text-anchor="middle"');
  body+=tx(cx,cy+29,rows[0].name.toUpperCase(),14,THEME.lime,700,`text-anchor="middle" font-family="${MONO}"`);
  if(mobile)body+=tx(280,293,'Largest public source share',17,THEME.muted,400,'text-anchor="middle"');
  else body+=rule(302,83,302,261);
  rows.forEach((row,i)=>{
    const x=mobile?26+i%2*267:340+i%2*383;
    const y=mobile?335+Math.floor(i/2)*54:98+Math.floor(i/2)*47;
    const barW=mobile?230:335;
    body+=`<circle cx="${x+4}" cy="${y-5}" r="4" fill="${row.color}"/>`;
    body+=tx(x+17,y,row.name,mobile?18:19,THEME.ink,600);
    body+=tx(x+barW,y,`${row.percent.toFixed(1)}%`,17,THEME.muted,400,'text-anchor="end"');
    body+=box(x,y+12,barW,4,'#233033','#233033');
    body+=box(x,y+12,Math.max(1,barW*row.percent/100),4,row.color,row.color);
  });
  body+=rule(26,h-49,w-26,h-49);
  body+=tx(26,h-25,mobile?'Public code bytes · Forks / profile excluded':'Public code bytes · Forks and profile repository excluded',mobile?15:17,THEME.muted);
  return svg(w,h,'Languages in public source repositories',body,rows.map(row=>`${row.name} ${row.percent.toFixed(1)} percent`).join('. ')+'. These are code-byte shares, not proficiency scores.');
}

function activityCells(days,{x,y,step,size}) {
  const first=dateMs(days[0].date), start=first-new Date(first).getUTCDay()*DAY;
  const max=Math.max(1,...days.map(day=>day.count));
  const months=new Map();
  const cells=days.map(day=>{
    const time=dateMs(day.date),offset=Math.round((time-start)/DAY),col=Math.floor(offset/7),row=offset%7,date=new Date(time);
    if((date.getUTCDate()<=7&&row===0)||offset<7){
      const month=date.toLocaleDateString('en-US',{timeZone:'UTC',month:'short'});
      if(!months.has(month+'-'+date.getUTCFullYear()))months.set(month+'-'+date.getUTCFullYear(),{col,month});
    }
    const level=day.count===0?0:Math.min(4,Math.max(1,Math.ceil(day.count/max*4)));
    return `<rect x="${x+col*step}" y="${y+row*step}" width="${size}" height="${size}" rx="1" fill="${PALETTE[level]}"><title>${day.date}: ${day.count} contributions</title></rect>`;
  }).join('');
  const labels=[...months.values()].map(({col,month})=>tx(x+col*step,y-13,month,14,THEME.muted)).join('');
  return labels+cells;
}

export function contributionsSvg(data, mobile=false) {
  const {days,total,current,longest}=data.calendar;
  const w=mobile?560:1120,h=mobile?474:352;
  let body=tx(26,37,'Contributions',28,THEME.ink,700);
  body+=tx(26,66,mobile?`${formatNumber(total)} contributions · 365-day window`:`${formatNumber(total)} contributions · ${days[0].date} → ${days.at(-1).date}`,16,THEME.muted);
  const metricY=mobile?110:27;
  [ ['CURRENT STREAK',current,THEME.lime], ['BEST IN WINDOW',longest,THEME.blue] ].forEach(([label,value,color],i)=>{
    const x=mobile?26+i*267:778+i*171;
    body+=tx(x,metricY,label,15,THEME.muted,700);
    body+=tx(x,metricY+34,`${value} ${value===1?'day':'days'}`,31,color,700);
  });
  if(mobile){
    body+=rule(26,163,534,163)+tx(26,188,'LAST 91 DAYS',15,THEME.lime,700,`font-family="${MONO}"`);
    body+=activityCells(days.slice(-91),{x:82,y:220,step:29,size:23});
    body+=tx(26,433,'Calendar: last 91 days. Streaks: displayed year.',15,THEME.muted);
  } else {
    // A real 90-day waveform adds a second view of the contribution counts.
    const recent=days.slice(-90), max=Math.max(1,...recent.map(day=>day.count));
    const points=recent.map((day,i)=>`${200+i*10},${131-day.count/max*39}`).join(' ');
    body+=tx(26,115,'Last 90 days',16,THEME.lime,700,`font-family="${MONO}"`)+rule(200,132,1090,132);
    body+=`<polyline points="${points}" fill="none" stroke="${THEME.lime}" stroke-width="1.6"/>`;
    body+=activityCells(days,{x:73,y:180,step:18,size:14});
    body+=tx(28,207,'M',11,THEME.muted)+tx(28,243,'W',11,THEME.muted)+tx(28,279,'F',11,THEME.muted);
    body+=`<style>@media(prefers-reduced-motion:reduce){.scanner{display:none}}</style><rect class="scanner" x="73" y="178" width="2" height="126" fill="${THEME.lime}" opacity=".4"><animate attributeName="x" values="73;1026;73" dur="24s" repeatCount="indefinite"/></rect>`;
    body+=tx(26,329,'Streaks within the displayed year',16,THEME.muted);
    body+=tx(890,329,'LESS',14,THEME.muted);
    PALETTE.forEach((color,i)=>{body+=box(932+i*21,317,14,14,color,color);});
    body+=tx(1045,329,'MORE',14,THEME.muted);
  }
  return svg(w,h,'Public contribution calendar and streaks',body,`${total} contributions from ${days[0].date} to ${days.at(-1).date}. Current streak ${current} days; best streak in the displayed year ${longest} days. ${mobile?'The mobile calendar displays the latest 91 days.':'The waveform displays the latest 90 days; the grid displays 365 days.'}`);
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
    'contributions.svg': contributionsSvg(data),
    'github-overview-mobile.svg': overviewSvg(data, true),
    'languages-mobile.svg': languagesSvg(data, true),
    'contributions-mobile.svg': contributionsSvg(data, true)
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
