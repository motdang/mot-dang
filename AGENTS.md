# For the next ant

Instructions for whatever agent picks this repo up next. `CLAUDE.md` holds the rules that bite during a build; this file holds the reasons, so you can decide well about things nobody wrote a rule for yet. Read `notes/empathy-map.md` before you build anything user-facing.

Written 2026-07-30, after a week in which the site grew an ant rank, a LINE front door, royal temple grades, per-place share cards and five printed handouts, and in which the founder's Facebook account was disabled overnight with a single appeal.

---

## What this is

A city directory for Chiang Mai and Chiang Rai. Thai first, open data, static HTML, stdlib Python.

**Struck by Nan, 2026-09-18:** *"agents.md is wrong — motdang is 50 days old and I founded it."*
The line that stood here — "not a startup, a marketplace, a platform, or an MVP on the way to
something" — was a session's invention, never hers. She is the founder. What the venture is and
what it becomes is hers to say, and no session re-opens this from a file birth time.

Two further things were bundled into that struck refusal that never belonged in it. **A mobile app** — the site ships one: `docs/app/` has a manifest, a service worker, icons and a signed APK, and `/app.html` is the หาห้องน้ำ app's own page. **A/B testing** — the objection was always to watching readers, not to trying two wordings; the site already picks copy by measurement it can make without surveillance (`tests/test_contrast.py`, the reader-sheet passes, WO-42's AA failures). Both were written as settled and neither was. If something here reads as a closed question, check whether the repo already answers it differently.

## Who it is for

Six readers, mapped in `notes/empathy-map.md`. In one line each: a shop owner who assumes the internet will eventually charge her; a temple steward who cares about propriety before reach; a driver running from platform commission; a migrant housekeeper for whom visibility is a risk before it is an opportunity; a therapist whose name is her asset; and a machine that will carry whatever it is given, confidently, forever.

The one you will forget is the fourth. Most product instincts assume the user wants to be found. She does not, by default. Build for her explicitly or you will build something that harms her while looking generous.

---

## What delight means here

Not animation. Not micro-interactions. Not a design system. Delight here has four shapes, and all four are already in the codebase to copy from.

**Recognition.** Something a Thai reader sees and knows instantly, that no global platform would ever carry. Day colours (สีประจำวัน) driving the accent. Buddhist Era dates. Royal monastery grades. The lunar disc. Wan phra. These cost almost nothing and they say *this was made by someone who lives here*. When you are choosing between two features, the one a foreigner would not think of is usually the right one.

**The totem doing work.** The red ant is not a logo, it is a unit. One ant per fact held, nine for a complete listing. Ant trails as dividers. The ant standing in where a photo is missing. `wat.svg` for `wat` and `sights` only — a temple illustration on a massage listing was wrong in a way that reads as an accusation, and that fix is the model for this kind of judgement. Extend the totem before you invent a new visual language.

**Auspiciousness as a constraint.** Nine, not eight. No ominous words in nav or labels. The katha in `llms.txt` is sincere. If a number is arbitrary, make it nine. This is not decoration and it is not to be quietly rationalised away by an agent that finds it unscientific.

**Candour rendered as interface.** The dead-link forensics on `reach.html` — naming a dead link, dating it, linking the archive rather than pretending. The ant rank showing exactly what is missing. Marks that print the year of the edition they were read from. This is the deepest delight the site has, because it is the thing readers cannot get anywhere else, and it converts directly into trust. When you have a choice between hiding an imperfection and dating it, date it.

## What value means here

**Information is power, made visible.** The ant rank exists to turn "your listing is thin" into something an owner can see, count, and fix in five minutes. Any new signal should follow that pattern: legible, countable, unbuyable.

**Advertising sits in a marked box and does not mix into a listing.** How that box is priced and what else may be sold is Nan's call, not a settled position — put any proposal to her.

**Marks are dated or they are not published.** Michelin, เชลล์ชวนชิม, royal grade: every entry in `data/curated/honours.json` carries `edition`/`sources`, and the badge prints the year. A mark with a year stays true forever. A mark without one rots into a lie. Nothing goes into the verified lists without a URL that was actually fetched; leads live in `unverified` and stay unrendered.

---

## Rules that came from being wrong

These are not style preferences. Each one is a scar.

**OSM IS NOT THE FIRST SOURCE OF GROUND TRUTH, AND NEVER WAS.** Nan, 2026-09-06: *"There's probably also many clothing, shoes, entertainments, etc that have ACTIVE facebook and no listings at all on OSM. OSM should not be the single or even the first source of ground truth."* She is describing the shape of this catalogue exactly: of 24,059 records, **15,108 (63%) are OSM**, 2,306 (10%) carry any website at all, and **232 (1%) carry a Facebook page**. The big-size shelf already paid for this lesson — `shop=clothes` and `shop=shoes` had never appeared in `crawl_overpass.py` QUERIES, so the first pass concluded "nobody stocks your size" from eight records. OSM answers "what did a mapper walk past", which is a different question from "who is open and selling this". Where a place describes itself to the public — and in this city that is usually a Facebook page, not a website — that is the place's own voice and it is a first-hand source. Use it.

**Facebook's own voice is not Facebook's listing card, and reading is not publishing.** Two distinctions this file has previously collapsed. (1) A page the place writes and runs is its own site, whoever hosts it; Google Maps' or Facebook's *rendering* of a place is a directory's copy. `NOT_FIRST_HAND` in `importers/enrich_sites.py` still lists agoda, booking, tripadvisor, wongnai, grab, foodpanda, shopee and lazada correctly — those are other people's listings — and it listed facebook.com and instagram.com wrongly beside them. (2) The 29 July account disablement, below, is about **publishing on** a channel we do not own. It says nothing about **reading** what a shop posts about itself. Nan, 2026-09-06: *"I don't clutch pearls about scraping."*

**The blocker is the mechanism, not the policy — measured 2026-09-06.** Facebook serves a logged-out fetcher a shell. Five attempts on known-good pages (akhaamacoffee, gatewaycoffeeroasters, WatDuangDee, plus `mbasic.` and `/about`) returned the `og:title` and nothing else: **0 of 5 yielded hours, phone or address.** So a plain HTTP lane buys identity and activity confirmation only, and any plan that promises hours off Facebook is promising evidence nobody has. A session with a logged-in browser renders the About tab and is the lane that would actually pay — targeted at a shelf, not at 24,000 records. What we already hold needs cleaning first: of the 232 Facebook attrs, **134 are clean URLs, 72 are bare handles** (several are page *names* with spaces, not handles) **and 26 carry share/tracking junk.**

**A crawl is not a verification.** The freshness ant originally counted `updatedAt`, which meant one bulk OSM import handed the ant to all 10,000 records at once and the signal said nothing. Freshness now requires a human touch — an owner's claim, or a curated/field source. Any signal that everything can earn simultaneously is not a signal.

**One source of truth per channel.** `data/config.json` holds the contact email, LINE OA id and QR. A superseded `data/line.json` path survived a refactor, was still being called, and rendered nothing — two sources of truth for the same phone number is how a wrong number eventually ships. Delete the loser.

**Every channel except the domain belongs to someone else.** Facebook proved it on 29 July: disabled overnight, one appeal, permanent if it fails. `OUR_CHANNELS` / `NOT_OUR_CHANNELS` in `build.py` states what is ours and what is not, renders it on `add.html`, publishes `data/channels.json`, and says in `llms.txt` that any Facebook, Instagram, TikTok or X account claiming to be มดแดง is an impostor and that nobody is ever asked for money to be listed. Keep that current. The contact address in `config.json` is still a free third-party mailbox printed on ten thousand pages; moving it to an address on the domain is the outstanding fix.

**Paper cannot be deplatformed.** `make_handouts.py` exists because of the above. The per-place QR, the printed A4, and the sheet handed over in person are the only channels no company can switch off. When a distribution idea comes up, ask whether it survives the platform disappearing.

---

## How to decide what to build next

Four questions, in order. A no at any point means stop.

1. **Which of the six does this serve, and would they recognise the description of their own problem?** If the answer is "users", you have not thought about it yet.
2. **Does it work on a five-year-old Android, on a bad connection, in Thai, for someone who will not install anything?** That is the median reader. Not you, and not the farang expat, who is already won and is not the frontier.
3. **Does it make a fact more legible, or does it make the site louder?** Legible wins. Loud loses.
4. **Would it still be true if nobody maintained it for a year?** Static, dated, sourced things survive. Live integrations, undated marks, and anything that assumes a weekly human rot into wrongness. Prefer the thing that ages into "out of date" over the thing that ages into "wrong".

## The verification bar

Do not report work as done on the strength of having written it.

Run `python3 build.py` and read the page count. Open the actual output and grep for the thing you claimed to add. Render a PDF or PNG deliverable and *look at it* — the share cards were silently cropped by a headless-Chrome viewport quirk for three iterations because nobody looked. Check both the Thai and the English. Check a place page, a category page, and the homepage, because they take different code paths.

Two environment traps that cost real time and will cost you the same time again. Staged file copies can be served stale from cache, so a file you "read" may be an old snapshot — check the byte count against the source before you conclude something has been lost or overwritten. And the Cowork device mount permits writes but forbids unlink, so `shutil.rmtree` fails there; `build.py` now warns and overwrites in place rather than refusing, but a build done that way can leave stale pages behind and must not be published.

## Standing debts

In the order they should be paid.

1. **A person is not a place.** The driver and housekeeper handouts promise a page that the schema cannot yet create — `home-services` holds zero records and `transport` holds fuel stations. Until this exists, those two sheets must not be handed out. **2026-09-27:** motdang.net/home-help is live — the homematch repo, its own Worker route — where a housekeeper or driver lists themselves and gets a page (noindex unless they opt in). `BOARD` in `build.py` links it from the home-services shelf. The handouts do not yet print its address.
2. **`hello@motdang.net`** on the domain, forwarding wherever, replacing the free mailbox in `config.json`.
3. **The Shan needs a human.** Fifteen minutes of a Shan speaker's time clears the banner.
4. **The 2026 Michelin roster and the เชลล์ชวนชิม holders** need a real browser — the filter pages render client-side and `shellshuanshim.com` serves an expired certificate. The 2022-edition entries currently on the site are dated and say so, but they are four editions stale.
5. **Ask whether a sponsor block belongs on a wat page.**

## Where things live

`build.py` — the whole site generator, stdlib only, `docs/` is the output and is committed. `festivals_layer.py` — festival pages, imported by the build. `make_og_cards.py` — per-place share cards into `assets/og/`, Chrome-rendered because Pillow here cannot shape Thai. `make_shelf_cards.py` — the same for list pages: one card per province, category and sub-shelf, carrying the names on the shelf, so a shared link answers “who does THIS” instead of unfurling as the brand ant. `data/asked.json` + `asked_layer.py` — reader questions as data: each entry renders its ถามมด card, its own page and share card, and `make_post.py <key>` prints the reply to paste back into the group. `asked_new.py` opens a question (draft entry + note); `asked_check.py` checks its records' links and provenance before the draft flag comes off. `make_handouts.py` — the printed A4s into `assets/handouts/`, same reason plus Shan. `importers/` — everything that touches the network, run deliberately, outside the build. `data/curated/` — hand-kept field truth that no importer may overwrite. `data/config.json` — the channels. `worker/` — the Cloudflare Worker that takes claims.

The build does not touch the network; `importers/` is where the network lives, run deliberately, outside the build. A page carrying a map fetches the basemap from our own bucket — tiles AND label glyphs, both self-hosted since 2026-08-20 (`assets/glyphs/NotoSans/`). `map_shell.py` is the only module that configures that; do not add a second place tiles are set up.
