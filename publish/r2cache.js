/* An R2 read through the data centre's own cache. A fresh isolate used to
 * spend 120–360 ms reading the dictionary, the thesaurus, the site register
 * and the calendar from the bucket before it could answer (Server-Timing,
 * 2026-10-03); the colo cache hands the same bytes back in a few
 * milliseconds. The result answers .json() and .text() like an R2 object. */
export async function cachedGet(env, key, ttl = 600, ver = "") {
  let cache = null, req = null;
  try {
    cache = caches.default;
    /* `ver` (an etag) names the copy, so a rebuilt file is a new key and a
     * long ttl cannot hand back a stale one. */
    req = new Request("https://motdang.net/__r2cache/" + key + (ver ? "?v=" + encodeURIComponent(ver) : ""));
    const hit = await cache.match(req);
    if (hit) return hit;
  } catch { cache = null; }                       // no Cache API (tests, local): read the bucket
  const o = env.SITE ? await env.SITE.get(key) : null;
  if (!o || !cache) return o;
  const body = await o.arrayBuffer();
  if (cache) {
    try {
      await cache.put(req, new Response(body, { headers: { "cache-control": `public, max-age=${ttl}` } }));
    } catch { /* the answer stands without the copy */ }
  }
  return new Response(body);
}
