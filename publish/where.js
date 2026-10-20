/* ---- WHEN THE NETWORK'S GUESS COUNTS (Nan, 2026-10-20) --------------------
 * "Tolou is <15 km from me." Cloudflare placed her Chiang Mai wifi in Thoeng,
 * Chiang Rai province, 150 km off, and every page followed it: the front page
 * turned to Chiang Rai, a place page said "~163 km", search ranked by
 * distance from Thoeng. A desktop or a wifi connection has no GPS, so the
 * guess is all most pages get.
 *
 * A guess is taken only when it lands within GUESS_KM of a city the site
 * covers — the cities it draws maps and weather for. Anywhere else it is "not
 * known": the meta carries no coordinates, /find has no pin, and each page
 * falls back to its own default city and draws no distance. A fix from the
 * reader's device is not a guess and is never filtered here. */

export const CITIES = {
  cm: { lat: 18.7883, lon: 98.9853 },    // Chiang Mai, Tha Phae Gate
  cr: { lat: 19.9105, lon: 99.8406 },    // Chiang Rai, the clock tower
  pth: { lat: 14.0208, lon: 100.5250 },  // Pathum Thani
  pp: { lat: 11.5564, lon: 104.9282 },   // Phnom Penh
};
export const GUESS_KM = 30;

export function km(a, b) {
  const dLat = (a.lat - b.lat) * 111.32;
  const dLon = (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/* The covered city a position is in, or "" when it is in none. */
export function cityOf(p) {
  let best = "", d = Infinity;
  for (const [k, c] of Object.entries(CITIES)) {
    const x = km(p, c);
    if (x < d) { d = x; best = k; }
  }
  return d <= GUESS_KM ? best : "";
}

/* request.cf → { lat, lon, city, place } when the guess counts, else null. */
export function trustedGuess(cf) {
  const lat = Number(cf && cf.latitude), lon = Number(cf && cf.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(lat || lon)) return null;
  const place = cityOf({ lat, lon });
  return place ? { lat, lon, city: (cf && cf.city) || "", place } : null;
}
