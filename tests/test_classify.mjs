/** Real User-Agent strings, checked against what we claim about them. */
import { classify } from '../publish/classify.js';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const REAL_CHROME = { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' };

const CASES = [
  // --- AI ------------------------------------------------------------------
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ai', 'ClaudeBot'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36; compatible; Claude-User/1.0; +Claude-User@anthropic.com', 'ai', 'Claude-User'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'ai', 'GPTBot'],
  ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', 'ai', 'OAI-SearchBot'],
  ['Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36 PerplexityBot/1.0', 'ai', 'PerplexityBot'],
  ['Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://exa.ai)', 'ai', 'ExaSearchBot'],
  ['ExaBot/1.0', 'ai', 'ExaSearchBot'],
  ['Mozilla/5.0 (compatible; Google-Extended/1.0)', 'ai', 'Google-Extended'],
  ['Mozilla/5.0 (compatible; CCBot/2.0; +https://commoncrawl.org/faq/)', 'ai', 'CCBot'],
  ['Mozilla/5.0 (Linux; Android 8.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/81 Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)', 'ai', 'Bytespider'],
  ['meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', 'ai', 'meta-externalagent'],

  // Google-Extended must win over Googlebot; Applebot-Extended over Applebot.
  ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'search', 'Googlebot'],
  ['Mozilla/5.0 (compatible; Applebot-Extended/0.1; +http://www.apple.com/go/applebot)', 'ai', 'Applebot-Extended'],
  ['Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)', 'search', 'Applebot'],

  // --- search --------------------------------------------------------------
  ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'search', 'bingbot'],
  ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'search', 'YandexBot'],
  ['Mozilla/5.0 (compatible; DuckDuckBot/1.1; https://duckduckgo.com/duckduckbot)', 'search', 'DuckDuckBot'],
  ['Mozilla/5.0 (compatible; archive.org_bot +http://archive.org/details/archive.org_bot)', 'search', 'Internet Archive'],

  // --- link previews -------------------------------------------------------
  ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'social', 'Facebook'],
  ['Twitterbot/1.0', 'social', 'Twitterbot'],
  ['Mozilla/5.0 (compatible; LINE-Poker/1.0)', 'social', 'LINE'],
  ['WhatsApp/2.23.20.0 A', 'social', 'WhatsApp'],

  // --- SEO -----------------------------------------------------------------
  ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'seo', 'AhrefsBot'],
  ['Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)', 'seo', 'SemrushBot'],

  // --- monitors / tools ----------------------------------------------------
  ['Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)', 'monitor', 'UptimeRobot'],
  ['curl/8.4.0', 'tool', 'curl'],
  ['python-requests/2.31.0', 'tool', 'python'],
  ['Go-http-client/2.0', 'tool', 'Go-http-client'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120 Safari/537.36', 'tool', 'headless'],

  // --- humans --------------------------------------------------------------
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1', 'human', 'Safari'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'human', 'Chrome'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120.0.0.0', 'human', 'Edge'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0', 'human', 'Firefox'],
  // A phone opening a link from inside the LINE app — a person, not a crawler.
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.19.0', 'human', 'LINE in-app'],

  // --- edges ---------------------------------------------------------------
  ['', 'none', '(no user-agent)'],
  ['Mozilla/5.0 (compatible; SomeNewCrawler/1.0; +http://example.com)', 'other', 'SomeNewCrawler'],

  // --- a browser's string, not a browser's request (added 2026-09-27) --------
  // The Singapore scraper: stock Chrome strings from Tencent Cloud.
  [CHROME_WIN, 'other', 'data centre · Tencent Cloud', { asn: 132203, headers: new Headers(REAL_CHROME) }],
  // Same string, no Sec-Fetch-* — a script that copied Chrome's User-Agent only.
  [CHROME_WIN, 'other', 'Chrome string, no Chrome', { asn: 9931, headers: new Headers({ accept: 'text/html' }) }],
  // A person: home network, the headers Chrome really sends.
  [CHROME_WIN, 'human', 'Chrome', { asn: 9931, headers: new Headers(REAL_CHROME) }],
  // Safari 13 predates Sec-Fetch; from a home network it stays a person.
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1', 'human', 'Safari', { asn: 131445, headers: new Headers({ accept: 'text/html' }) }],
  // Chrome on iOS is WebKit and is not held to Chrome's headers.
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1', 'human', 'Chrome', { asn: 131445, headers: new Headers({}) }],
  // Bluesky's link card, as it arrived on 2026-10-12 (3.18.47.21, AWS).
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app) Chrome/W.X.Y.Z Safari/537.36', 'social', 'Bluesky', { asn: 16509, headers: new Headers({}) }],
  ['http.rb/5.2.0 (Mastodon/4.3.0; +https://mastodon.social/)', 'social', 'Mastodon', { asn: 24940, headers: new Headers({}) }],
  // A named crawler keeps its name wherever it runs.
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'ai', 'GPTBot', { asn: 8075, headers: new Headers({}) }],

  // --- made on Cloudflare (added 2026-11-02) ---------------------------------
  // The /search client of 26 Oct–1 Nov: Chrome's string and headers, from a Worker.
  [CHROME_WIN, 'other', 'Cloudflare Worker · example.com', { asn: 13335, headers: new Headers({ ...REAL_CHROME, 'cf-worker': 'example.com' }) }],
  [CHROME_WIN, 'other', 'Cloudflare Worker', { asn: 13335, headers: new Headers({ ...REAL_CHROME, 'cf-connecting-ip': '2a06:98c0:3600::103' }) }],
  [CHROME_WIN, 'other', 'Cloudflare Browser Rendering', { asn: 13335, headers: new Headers({ ...REAL_CHROME, 'cf-brapi-devtools': 'x1' }) }],
  // A person on WARP shares AS13335 and stays a person.
  [CHROME_WIN, 'human', 'Chrome', { asn: 13335, headers: new Headers({ ...REAL_CHROME, 'cf-connecting-ip': '104.28.1.1' }) }],

  // --- our own looking (added 2026-11-02) ------------------------------------
  [CHROME_WIN, 'ours', 'marked browser', { asn: 23969, headers: new Headers({ ...REAL_CHROME, cookie: 'a=b; nb_ours=1' }) }],
  [CHROME_WIN, 'human', 'Chrome', { asn: 23969, headers: new Headers({ ...REAL_CHROME, cookie: 'nb_ours=10' }) }],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120 Safari/537.36', 'ours', 'test tool', { asn: 23969, headers: new Headers({ 'x-nanobot-test': '1' }) }],
  [CHROME_WIN, 'ours', 'local preview', { asn: 23969, headers: new Headers({ ...REAL_CHROME, referer: 'http://localhost:8000/' }) }],
  [CHROME_WIN, 'ours', 'local preview', { asn: 23969, headers: new Headers({ ...REAL_CHROME, referer: 'http://127.0.0.1:8811' }) }],
  [CHROME_WIN, 'human', 'Chrome', { asn: 23969, headers: new Headers({ ...REAL_CHROME, referer: 'https://localhost.example.com/' }) }],
];

let pass = 0;
const fails = [];
for (const [ua, wantCat, wantAgent, seen] of CASES) {
  const got = classify(ua, seen);
  if (got.category === wantCat && got.agent === wantAgent) pass++;
  else fails.push({ ua: ua.slice(0, 66), want: `${wantCat}/${wantAgent}`, got: `${got.category}/${got.agent}` });
}

console.log(`classify: ${pass}/${CASES.length} passed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log(`  ${f.ua}\n     want ${f.want}\n      got ${f.got}`);
  process.exit(1);
}
