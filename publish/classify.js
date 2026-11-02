/* Who is asking for the page — User-Agent → {category, agent}.
 *
 * PROVENANCE: this file is a copy of traffic-eye/src/classify.js, taken
 * 2026-09-08. traffic-eye is the fleet's collector Worker, which records the
 * same nine categories for every site behind it. It could not be used here as
 * a route: a Cloudflare hostname belongs to exactly one Worker, and
 * motdang.net/* already belongs to this one. So the classifier is vendored and
 * the rows are written from inside the site Worker, into traffic-eye's own
 * `traffic_eye` dataset with the same blob order — one dataset, one dashboard,
 * motdang.net alongside the rest.
 *
 * Keep the two in step. tests/test_classify.mjs is traffic-eye's own test
 * suite pointed at this copy, so a drift shows up as a failing case here.
 */
/**
 * Who is asking for the page.
 *
 * Cloudflare's own bot score is an Enterprise feature — on the free plan there
 * is no score and no bot analytics at all — so the classification has to be
 * ours. That turns out to be the better answer anyway: Cloudflare would tell us
 * "bot", and the question actually worth asking about these sites is *which*
 * bot. An AI crawler reading the wichaa corpus is the point of the project; an
 * SEO scraper hammering it is noise. A single "bot" bucket cannot tell those
 * apart.
 *
 * Matching is on User-Agent alone. That is spoofable, and anything here is a
 * claim rather than a proof — a scraper can say it is Googlebot. Verifying by
 * reverse DNS is possible but costs a lookup on every request, so this stays a
 * self-declaration and the numbers should be read as such.
 */

// Ordered most-specific first: Google-Extended must beat Googlebot, and
// Claude-User (a person asking Claude to fetch a page) is not ClaudeBot (the
// training crawler) even though both say "Claude".
const SIGNATURES = [
  // ---- AI: training crawlers, retrieval agents, and user-triggered fetches --
  ['ai', 'ClaudeBot', /ClaudeBot/i],
  ['ai', 'Claude-User', /Claude-User/i],
  ['ai', 'Claude-SearchBot', /Claude-SearchBot/i],
  ['ai', 'Claude-Web', /Claude-Web/i],
  ['ai', 'anthropic-ai', /anthropic-ai/i],
  ['ai', 'GPTBot', /GPTBot/i],
  ['ai', 'ChatGPT-User', /ChatGPT-User/i],
  ['ai', 'OAI-SearchBot', /OAI-SearchBot/i],
  ['ai', 'PerplexityBot', /PerplexityBot/i],
  // Exa: a search engine whose readers are AI programs; it answers their
  // questions from what this bot reads (first seen here 6 Oct 2026).
  ['ai', 'ExaSearchBot', /\bExa(Search)?Bot\b/i],
  ['ai', 'Perplexity-User', /Perplexity-User/i],
  ['ai', 'Google-Extended', /Google-Extended/i],
  ['ai', 'Applebot-Extended', /Applebot-Extended/i],
  ['ai', 'meta-externalagent', /meta-externalagent|meta-externalfetcher|FacebookBot/i],
  ['ai', 'Bytespider', /Bytespider/i],
  ['ai', 'Amazonbot', /Amazonbot/i],
  ['ai', 'CCBot', /CCBot/i],
  ['ai', 'cohere-ai', /cohere-ai|cohere-training-data-crawler/i],
  ['ai', 'AI2Bot', /AI2Bot/i],
  ['ai', 'Diffbot', /Diffbot/i],
  ['ai', 'YouBot', /YouBot/i],
  ['ai', 'Timpibot', /Timpibot/i],
  ['ai', 'Omgilibot', /omgili/i],
  ['ai', 'ImagesiftBot', /ImagesiftBot/i],
  ['ai', 'Kangaroo Bot', /Kangaroo Bot/i],
  ['ai', 'Webzio', /Webzio-Extended/i],
  ['ai', 'DuckAssistBot', /DuckAssistBot/i],
  ['ai', 'MistralAI-User', /MistralAI/i],

  // ---- search engines -----------------------------------------------------
  ['search', 'Googlebot', /Googlebot|Google-InspectionTool|Storebot-Google/i],
  ['search', 'bingbot', /bingbot|adidxbot|BingPreview/i],
  ['search', 'DuckDuckBot', /DuckDuckBot|DuckDuckGo-Favicons/i],
  ['search', 'YandexBot', /Yandex(Bot|Images|Mobile)/i],
  ['search', 'Baiduspider', /Baiduspider/i],
  ['search', 'Applebot', /Applebot/i],
  ['search', 'PetalBot', /PetalBot/i],
  ['search', 'SeznamBot', /SeznamBot/i],
  ['search', 'Sogou', /Sogou/i],
  ['search', 'Qwantify', /Qwantify|Qwantbot/i],
  ['search', 'Slurp', /Slurp/i],
  ['search', 'Internet Archive', /ia_archiver|archive\.org_bot|Wayback/i],
  ['search', 'Mojeek', /MojeekBot/i],
  ['search', 'Marginalia', /search\.marginalia\.nu/i],

  // ---- link previews. LINE matters here: these sites are shared LINE-first,
  // so LINE fetching an OG card is the shape of a real share, not noise. ------
  // Only LINE's own preview fetchers. Matching a bare "Line/13.19.0" here
  // would swallow the LINE in-app browser, which is a person on a phone who
  // tapped a shared link — the single most common way these sites get opened.
  ['social', 'LINE', /line-poker|Linespider/i],
  ['social', 'Facebook', /facebookexternalhit|facebookcatalog/i],
  ['social', 'Twitterbot', /Twitterbot/i],
  ['social', 'LinkedInBot', /LinkedInBot/i],
  ['social', 'Slackbot', /Slackbot|Slack-ImgProxy/i],
  ['social', 'Discordbot', /Discordbot/i],
  ['social', 'TelegramBot', /TelegramBot/i],
  ['social', 'WhatsApp', /WhatsApp/i],
  ['social', 'Pinterest', /Pinterest/i],
  ['social', 'redditbot', /redditbot/i],
  ['social', 'Skype', /SkypeUriPreview/i],
  ['social', 'VK', /vkShare/i],
  // Bluesky's card fetcher wears a Chrome string from AWS; Mastodon servers
  // fetch as http.rb from wherever the instance is hosted.
  ['social', 'Bluesky', /Bluesky Cardyb/i],
  ['social', 'Mastodon', /\(Mastodon\/[\d.]/],

  // ---- SEO / market-intelligence crawlers: mostly pure cost ---------------
  ['seo', 'AhrefsBot', /AhrefsBot/i],
  ['seo', 'SemrushBot', /Semrush/i],
  ['seo', 'MJ12bot', /MJ12bot/i],
  ['seo', 'DotBot', /DotBot/i],
  ['seo', 'DataForSeoBot', /DataForSeo/i],
  ['seo', 'BLEXBot', /BLEXBot/i],
  ['seo', 'Screaming Frog', /Screaming Frog/i],
  ['seo', 'Barkrowler', /Barkrowler/i],
  ['seo', 'ZoominfoBot', /ZoominfoBot/i],
  ['seo', 'serpstatbot', /serpstatbot/i],
  ['seo', 'SiteAuditBot', /SiteAuditBot/i],
  ['seo', 'Majestic', /MJ12|Majestic/i],

  // ---- uptime monitors ----------------------------------------------------
  ['monitor', 'UptimeRobot', /UptimeRobot/i],
  ['monitor', 'Pingdom', /Pingdom/i],
  ['monitor', 'StatusCake', /StatusCake/i],
  ['monitor', 'Site24x7', /Site24x7/i],
  ['monitor', 'BetterUptime', /Better ?Uptime|betteruptime/i],
  ['monitor', 'HetrixTools', /HetrixTools/i],
  ['monitor', 'GoogleStackdriver', /GoogleStackdriverMonitoring/i],

  // ---- scripts and headless browsers -------------------------------------
  ['tool', 'curl', /^curl\//i],
  ['tool', 'wget', /^Wget/i],
  ['tool', 'python', /python-requests|python-urllib|aiohttp|httpx/i],
  ['tool', 'Go-http-client', /Go-http-client/i],
  ['tool', 'Java', /^Java\//i],
  ['tool', 'okhttp', /okhttp/i],
  ['tool', 'node', /node-fetch|axios|undici/i],
  ['tool', 'perl', /libwww-perl|lwp-trivial/i],
  ['tool', 'Postman', /PostmanRuntime/i],
  ['tool', 'headless', /HeadlessChrome|PhantomJS|Playwright|Puppeteer|Selenium/i],
  ['tool', 'scrapy', /Scrapy/i],
  ['tool', 'http-client', /Apache-HttpClient|Guzzle|WinHttp|RestSharp/i],
];

// Only used to give humans a readable name; order matters (Edge before Chrome,
// Chrome before Safari) because every one of them still says "Safari".
const BROWSERS = [
  ['Edge', /\bEdg(e|A|iOS)?\//],
  ['Opera', /\bOPR\/|\bOpera\//],
  ['Samsung Internet', /SamsungBrowser\//],
  ['LINE in-app', /\bLine\/\d/i],
  ['Facebook in-app', /FBAN|FBAV/],
  ['Firefox', /\bFirefox\//],
  ['Chrome', /\bChrome\/|\bCriOS\//],
  ['Safari', /\bSafari\//],
];

/** Catches self-identifying crawlers that are not on the list above. */
const GENERIC_BOT = /bot\b|crawler|spider|crawl(ing|er)|\bfetch(er)?\b|scrape|feed(fetcher|parser)|monitor|preview/i;

/*
 * A browser's User-Agent from a network where nobody sits at a browser.
 *
 * Added 2026-09-27 for the Singapore scraper: from mid-September it asked
 * motdang.net for ~2,300 pages an hour from Tencent Cloud (AS132203), wearing
 * rotating stock Chrome strings and a forged "Referer: www.google.com", and
 * every one of those rows was filed as a person. The strings rotate, so they
 * cannot be listed; the network they come from does not.
 *
 * Cloud and hosting networks only. Deliberately NOT here: Cloudflare (13335 —
 * WARP users), Akamai (36183 — iCloud Private Relay), Google's own 15169. A
 * person on a VPN that exits through one of these is filed as a machine;
 * that is the cost, and it is small next to a scraper filed as a crowd.
 */
const HOSTING_ASNS = new Map([
  [132203, 'Tencent Cloud'], [45090, 'Tencent Cloud'],
  [45102, 'Alibaba Cloud'], [37963, 'Alibaba Cloud'],
  [136907, 'Huawei Cloud'], [55990, 'Huawei Cloud'],
  [150436, 'BytePlus'], [396986, 'ByteDance'],
  [16509, 'AWS'], [14618, 'AWS'],
  [396982, 'Google Cloud'],
  [8075, 'Microsoft Azure'],
  [31898, 'Oracle Cloud'],
  [32934, 'Meta'],
  [14061, 'DigitalOcean'],
  [63949, 'Linode'],
  [20473, 'Vultr'],
  [24940, 'Hetzner'],
  [16276, 'OVH'],
  [51167, 'Contabo'],
  [12876, 'Scaleway'],
  [60781, 'Leaseweb'], [28753, 'Leaseweb'],
  [9009, 'M247'],
]);

/*
 * A request made by code running on Cloudflare, not by a reader.
 *
 * Added 2026-11-02. From 26 Oct a client on Cloudflare's own network asked
 * motdang.net /search and /suggest up to 54,010 times a day with stock Chrome
 * strings and the Sec-Fetch headers a browser sends, so every row was filed as
 * a person. AS13335 cannot be listed (WARP users share it), but Cloudflare marks
 * these requests itself: a Worker's fetch() carries CF-Worker (the zone that
 * owns the Worker) and, from another zone, CF-Connecting-IP 2a06:98c0:3600::103;
 * Browser Rendering adds cf-brapi-* and cf-biso-devtools. Source:
 * developers.cloudflare.com/fundamentals/reference/http-headers/ and
 * /browser-rendering/reference/automatic-request-headers/, read 2026-11-02.
 */
const WORKER_IP = '2a06:98c0:3600::103';
const BROWSER_RUN = ['cf-brapi-request-id', 'cf-brapi-devtools', 'cf-biso-devtools'];

function cloudflareMade(headers) {
  if (!headers) return null;
  const zone = headers.get('cf-worker');
  if (zone) return `Cloudflare Worker · ${zone.slice(0, 40)}`;
  if (BROWSER_RUN.some((k) => headers.has(k))) return 'Cloudflare Browser Rendering';
  if (headers.get('cf-connecting-ip') === WORKER_IP) return 'Cloudflare Worker';
  return null;
}

/*
 * Our own looking, filed apart so it leaves the people count (2026-11-02):
 * a test tool that sends X-Nanobot-Test, a browser of ours carrying the
 * nb_ours=1 cookie, or a preview page on one of our machines (a localhost
 * referrer).
 */
const LOCAL_REF = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[^/?#]*\.localhost)(:\d+)?(\/|$)/i;

function ours(headers) {
  if (!headers) return null;
  if (headers.has('x-nanobot-test')) return 'test tool';
  if (/(?:^|;\s*)nb_ours=1(?:;|$)/.test(headers.get('cookie') || '')) return 'marked browser';
  if (LOCAL_REF.test(headers.get('referer') || '')) return 'local preview';
  return null;
}

/**
 * A browser-shaped request that is not a browser, or null.
 *
 * Two tells, both about the request rather than the string:
 *  - it comes from a cloud network (HOSTING_ASNS);
 *  - it claims Chrome 80 or later and has no Sec-Fetch-Mode header. Every
 *    Chromium browser has sent Sec-Fetch-* on every HTTPS request since
 *    Chrome 76; a script that copied Chrome's string did not copy those.
 *    Chrome on iOS (CriOS) is WebKit underneath and is left out.
 */
function dressedAsBrowser(ua, seen) {
  if (!seen) return null;
  const made = cloudflareMade(seen.headers);
  if (made) return made;
  const net = HOSTING_ASNS.get(Number(seen.asn));
  if (net) return `data centre · ${net}`;
  const chrome = ua.match(/\bChrome\/(\d+)/);
  if (chrome && Number(chrome[1]) >= 80 && !/CriOS/.test(ua) &&
      seen.headers && !seen.headers.has('sec-fetch-mode')) {
    return 'Chrome string, no Chrome';
  }
  return null;
}

/**
 * @param {string} ua raw User-Agent header
 * @param {{asn?: number, headers?: Headers}} [seen] what else the edge saw.
 *   Optional: with the User-Agent alone the answer is what it always was.
 * @returns {{category: string, agent: string}}
 *   category: ai | search | social | seo | monitor | tool | other | human | none | ours
 */
export function classify(ua, seen) {
  const mine = ours(seen?.headers);
  if (mine) return { category: 'ours', agent: mine };
  if (!ua || !ua.trim()) return { category: 'none', agent: '(no user-agent)' };

  for (const [category, agent, re] of SIGNATURES) {
    if (re.test(ua)) return { category, agent };
  }

  // A browser-shaped UA that also shouts "bot" is a bot wearing a browser
  // string, which is common and worth keeping separate from the named ones.
  if (GENERIC_BOT.test(ua)) {
    return { category: 'other', agent: unnamedBot(ua) };
  }

  if (/^Mozilla\//.test(ua)) {
    const dressed = dressedAsBrowser(ua, seen);
    if (dressed) return { category: 'other', agent: dressed };
    for (const [name, re] of BROWSERS) {
      if (re.test(ua)) return { category: 'human', agent: name };
    }
    return { category: 'human', agent: 'other browser' };
  }

  // Not a browser, not a known tool, does not call itself a bot.
  return { category: 'other', agent: 'unrecognised' };
}

/** Pull a plausible product token out of an unknown bot's UA, for grouping. */
function unnamedBot(ua) {
  const m = ua.match(/([A-Za-z0-9._-]*(?:bot|crawler|spider|fetcher)[A-Za-z0-9._-]*)/i);
  return m ? m[1].slice(0, 40) : 'unnamed bot';
}

/** True when this is a person rather than a machine. */
export function isHuman(category) {
  return category === 'human';
}

export const CATEGORIES = ['human', 'ai', 'search', 'social', 'seo', 'monitor', 'tool', 'other', 'none', 'ours'];
