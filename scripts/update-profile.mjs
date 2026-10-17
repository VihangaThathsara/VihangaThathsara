// Generate repository-owned SVG cards from the public GitHub profile.
// Node.js 22+, no dependencies. GITHUB_TOKEN is provided by GitHub Actions.
// Tokens are used only in API request headers and are never written to assets.
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ASSETS = new URL('../assets/', import.meta.url);
const DAY = 86_400_000;
const PALETTE = ['#1C2943', '#2E407A', '#4F63B7', '#7A8CE8', '#A8BEFF'];
const LANGUAGE_COLORS = {
  Java: '#8492FF', JavaScript: '#F4D66B', TypeScript: '#62B5E8',
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

const FONT_PATHS = JSON.parse(await readFile(new URL('./font-paths.json', import.meta.url), 'utf8'));
const T = {bg:'#090E1C',panel:'#111A2C',line:'#24324D',ink:'#F4F7FF',muted:'#A0AFC8',blue:'#7783FF',cyan:'#6BDDFC'};
const usedGlyphs = new Map();
const tx = (x,y,value,size=18,color=T.ink,weight=400,anchor='start',display=false) => {
  const fontKey = `${display?'SpaceGrotesk':'Manrope'}-${display?(weight>=600?700:500):weight}`;
  const font = FONT_PATHS[fontKey];
  const chars = [...String(value)];
  const scale = size/font.units;
  const width = chars.reduce((sum,c)=>sum+(font.glyphs[c]||font.glyphs['?']).a*scale,0);
  let pos=x-(anchor==='end'?width:anchor==='middle'?width/2:0);
  let body='';
  for(const c of chars){
    const glyph=font.glyphs[c]||font.glyphs['?'];
    const id=`g_${fontKey}_${c.codePointAt(0)}`;
    if(glyph.d){usedGlyphs.set(id,glyph.d);body+=`<use href="#${id}" transform="translate(${pos.toFixed(3)} ${y}) scale(${scale.toFixed(7)} ${(-scale).toFixed(7)})"/>`;}
    pos+=glyph.a*scale;
  }
  return `<g fill="${color}" aria-label="${escapeXml(value)}">${body}</g>`;
};
const rect=(x,y,w,h,fill=T.panel,stroke='none',rx=0)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`;
const rule=(d,color=T.line,width=1)=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const card=(x,y,w,h)=>rect(x,y,w,h,'url(#card)',T.line,22);
const eyebrow=(x,y,label)=>rect(x,y-12,22,2,T.blue)+tx(x+35,y-3,label,14,T.blue,700);
const smallIcon=(kind,x,y,color=T.blue)=>{
  const shapes={
    repo:'M3 7h10l4 4h13v19H3ZM3 7V3h10l4 4',
    followers:'M12 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM2 29v-4c0-8 20-8 20 0v4M23 5c7 0 7 11 0 11M26 20c5 1 5 5 5 9',
    stars:'m16 2 4 9 10 1-7 7 2 11-9-5-9 5 2-11-7-7 10-1Z',
    contributions:'M5 27V15M16 27V6M27 27V0',
    flame:'M17 2c1 7-9 9-8 17 1-5 5-5 6-8 0 7 8 6 8 12 0 6-4 9-9 9S4 29 4 23C4 13 13 10 17 2Z'
  };
  return `<g transform="translate(${x} ${y}) scale(.85)">${rule(shapes[kind],color,1.8)}</g>`;
};

function svg(width,height,title,body,description='Public GitHub data') {
  const glyphs=[...usedGlyphs].map(([id,d])=>`<path id="${id}" d="${d}"/>`).join('');
  usedGlyphs.clear();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(description)}</desc><defs><linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#16213A"/><stop offset="1" stop-color="#0E1628"/></linearGradient><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#7783FF" stop-opacity=".5"/><stop offset="1" stop-color="#7783FF" stop-opacity=".02"/></linearGradient>${glyphs}</defs>${rect(0,0,width,height,T.bg)}${body}</svg>\n`;
}

export function overviewSvg(data,mobile=false){
  const joined=new Date(data.user.created_at).toLocaleDateString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'});
  const stars=data.repos.reduce((sum,r)=>sum+Number(r.stargazers_count||0),0);
  const metrics=[['Public repositories',data.user.public_repos,'repo',T.blue],['Followers',data.user.followers,'followers',T.cyan],['Stars received',stars,'stars','#EFC780'],['Contributions',data.calendar.total,'contributions','#B6A3FF']];
  const w=mobile?560:1200,h=mobile?676:422,x0=mobile?28:42;
  let body=eyebrow(x0,36,'ON GITHUB')+tx(x0,103,'GitHub activity',mobile?41:47,T.ink,700,'start',true);
  metrics.forEach(([label,value,icon,color],i)=>{
    const x=x0+(mobile?i%2*260:i*285),y=mobile?145+Math.floor(i/2)*215:149,cw=mobile?244:261;
    body+=card(x,y,cw,mobile?197:193)+smallIcon(icon,x+23,y+22,color);
    body+=tx(x+23,y+122,formatNumber(value),68,color,700,'start',true)+tx(x+23,y+162,label,mobile?19:18,T.muted,600);
  });
  body+=tx(x0,mobile?610:386,`Joined ${joined}`,mobile?21:18,T.muted);
  body+=tx(mobile?x0:1158,mobile?645:386,`Updated ${timestamp(data.now)}`,mobile?17:16,T.muted,400,mobile?'start':'end');
  body+=rule(`M${x0} ${h-17}H${w-x0}`);
  return svg(w,h,'GitHub activity',body,`${data.user.public_repos} public repositories; ${data.user.followers} followers; ${stars} stars received; ${data.calendar.total} contributions in the displayed 365-day window. Joined ${joined}. Updated ${timestamp(data.now)}.`);
}

export function languagesSvg(data,mobile=false){
  const rows=languageShares(data.languages),w=mobile?560:1200,h=mobile?1020:580,x0=mobile?28:42;
  let body=eyebrow(x0,36,'PUBLIC SOURCE')+tx(x0,103,'Most used languages',mobile?39:47,T.ink,700,'start',true);
  if(!rows.length)return svg(w,240,'Most used languages',body+tx(x0,188,'Public source code will appear here',21,T.muted));
  const cx=mobile?280:226,cy=mobile?300:318,r=mobile?126:127,c=2*Math.PI*r;
  body+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1C2943" stroke-width="24"/>`;
  let offset=0;
  rows.forEach(row=>{
    const length=row.percent/100*c,gap=Math.min(3,length/4);
    body+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${row.color}" stroke-width="24" stroke-dasharray="${Math.max(.2,length-gap)} ${c-Math.max(.2,length-gap)}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset+=length;
  });
  body+=tx(cx,cy-5,`${rows[0].percent.toFixed(1)}%`,49,T.ink,700,'middle',true)+tx(cx,cy+40,rows[0].name,28,T.blue,700,'middle',true)+tx(cx,cy+74,'of public code',17,T.muted,400,'middle');
  if(!mobile)body+=card(427,147,731,347);
  rows.forEach((row,i)=>{
    const x=mobile?28+i%2*260:455+i%2*355,y=mobile?505+Math.floor(i/2)*110:196+Math.floor(i/2)*79,bw=mobile?244:320;
    body+=rect(x,y-14,4,16,row.color,'none',1)+tx(x+14,y,row.name,mobile?22:21,T.ink,600);
    body+=tx(x+bw,y,`${row.percent.toFixed(1)}%`,mobile?20:18,T.muted,600,'end');
    body+=rect(x,y+22,bw,mobile?10:8,'#24324D','none',3)+rect(x,y+22,Math.max(2,bw*row.percent/100),mobile?10:8,row.color,'none',1);
  });
  body+=tx(x0,h-38,'By code size in public repositories',mobile?21:18,T.muted)+rule(`M${x0} ${h-17}H${w-x0}`);
  return svg(w,h,'Most used languages in public repositories',body,rows.map(row=>`${row.name} ${row.percent.toFixed(1)} percent`).join('; ')+'. By code bytes, excluding forks and this profile repository. These percentages describe code distribution, not proficiency.');
}

function activityCells(days,{x,y,step,size}){
  const first=dateMs(days[0].date),start=first-new Date(first).getUTCDay()*DAY;
  const max=Math.max(1,...days.map(d=>d.count)),months=new Map();
  const cells=days.map(day=>{
    const time=dateMs(day.date),offset=Math.round((time-start)/DAY),col=Math.floor(offset/7),row=offset%7,date=new Date(time);
    if((date.getUTCDate()<=7&&row===0)||offset<7){
      const month=date.toLocaleDateString('en-US',{timeZone:'UTC',month:'short'}),key=month+'-'+date.getUTCFullYear();
      if(!months.has(key))months.set(key,{col,month});
    }
    const level=day.count===0?0:Math.min(4,Math.max(1,Math.ceil(day.count/max*4)));
    return `<rect x="${(x+col*step).toFixed(2)}" y="${y+row*step}" width="${size}" height="${size}" rx="3" fill="${PALETTE[level]}"><title>${day.date}: ${day.count} contributions</title></rect>`;
  }).join('');
  return [...months.values()].map(({col,month})=>tx(x+col*step,y-18,month,step>25?18:14,T.muted)).join('')+cells;
}

export function contributionsSvg(data,mobile=false){
  const {days,total,current,longest}=data.calendar,w=mobile?560:1200,h=mobile?884:659,x0=mobile?28:42;
  let body=eyebrow(x0,36,'CONSISTENCY')+tx(x0,103,'Contribution history',mobile?39:47,T.ink,700,'start',true);
  body+=tx(x0,140,mobile?'365 days of public activity':`${days[0].date} to ${days.at(-1).date}`,mobile?22:18,T.muted);
  if(mobile){
    body+=card(28,173,504,121)+smallIcon('contributions',52,197,T.blue)+tx(52,268,formatNumber(total),55,T.blue,700,'start',true)+tx(216,241,'Contributions',24,T.muted,600);
    [['Current streak',current,T.cyan],['Best this year',longest,'#B6A3FF']].forEach(([label,value,color],i)=>{
      const x=28+i*260;body+=card(x,312,244,123)+tx(x+22,350,label,20,T.muted,600)+tx(x+22,402,`${value} ${value===1?'day':'days'}`,36,color,700,'start',true);
    });
    body+=card(28,458,504,389)+tx(51,505,'Last 91 days',24,T.ink,700,'start',true)+activityCells(days.slice(-91),{x:51,y:565,step:34,size:27});
  }else{
    [['Contributions',total,T.blue],['Current streak',`${current} ${current===1?'day':'days'}`,T.cyan],['Best this year',`${longest} ${longest===1?'day':'days'}`,'#B6A3FF']].forEach(([label,value,color],i)=>{
      const x=42+i*380;body+=card(x,177,356,116)+tx(x+24,214,label,18,T.muted,600)+tx(x+24,268,typeof value==='number'?formatNumber(value):value,43,color,700,'start',true);
    });
    body+=card(42,318,1116,244)+activityCells(days,{x:95,y:380,step:19.7,size:15.5});
    body+=tx(62,410,'M',12,T.muted)+tx(62,449,'W',12,T.muted)+tx(62,488,'F',12,T.muted);
    body+=tx(68,536,'Less',14,T.muted);PALETTE.forEach((color,i)=>body+=rect(110+i*21,524,14,14,color,'none',3));body+=tx(224,536,'More',14,T.muted);
    const recent=days.slice(-90),max=Math.max(1,...recent.map(d=>d.count)),points=recent.map((d,i)=>[250+i*10,622-d.count/max*35]);
    body+=tx(44,610,'Recent 90 days',19,T.muted)+rule('M250 624H1140');
    body+=`<path d="M250 624 ${points.map(([x,y])=>`L${x} ${y}`).join(' ')}L1140 624Z" fill="url(#area)"/>`+rule('M'+points.map(([x,y])=>`${x} ${y}`).join('L'),T.blue,1.8);
  }
  body+=rule(`M${x0} ${h-17}H${w-x0}`);
  return svg(w,h,'Contribution history and streaks',body,`${total} contributions from ${days[0].date} to ${days.at(-1).date}. Current streak ${current} days; best streak in this window ${longest} days. ${mobile?'The mobile calendar displays the latest 91 days.':'The calendar displays all 365 days; the area chart displays the latest 90 days.'}`);
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
