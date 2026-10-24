#!/usr/bin/env python3
"""The cast: brand avatars for the motdang web comics and reels.

One character so far — ไก่ชน · Gai Chon (Michael Peacock). The avatar is drawn
here as SVG, in parts, so an expression is a change of brows, eyes and mouth on
the same head rather than a second drawing that drifts from the first.

    python3 make_cast.py            # SVG always; PNGs too if Chrome is found

Writes assets/cast/gai-chon/:
    gai-chon-<expr>.svg / .png      avatar, 1080 square, full-bleed red.
                                    Everything that identifies him sits inside
                                    the inscribed circle, so a platform's round
                                    crop takes nothing but background.
    gai-chon-<expr>-400.png         profile-size
    gai-chon-bug.svg / .png         the grinning head in a ringed disc,
                                    transparent outside, 256 square — a reel's corner
    gai-chon-plate.png              lower-third name plate, 1080 x 240, transparent
    sheet.png                       every expression on one sheet, for checking

Why Chrome and not Pillow: the name plate is Thai, and a browser shapes Thai
correctly by definition (same reason as make_og_cards.py).

The palette is the site's: --ant #c13a2e behind him (it is also the red of the
portraits he was drawn from), --ink #2a1e16 for every line, --gold for the
piping. No emblem of any organisation is drawn on the cap; the pin is a comb.
On his chest, the พระสมเด็จ he wears, in a gold case on a long gold chain.
"""
import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets" / "cast" / "gai-chon"
FONTS = ROOT / "assets" / "fonts"

CHROMES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium",
    shutil.which("chromium") or "",
    shutil.which("chromium-browser") or "",
    shutil.which("google-chrome") or "",
]

INK = "#2a1e16"
RED = "#c13a2e"
RED_DEEP = "#8f2a21"
RED_RAY = "#b5352a"
COMB = "#ec4a31"
COMB_HI = "#ff7a55"
GOLD = "#f3c34b"
GOLD_DEEP = "#c08a2d"
SKIN = "#f4c7a4"
SKIN_SH = "#e3a684"
BLUSH = "#ee9c88"
STACHE = "#dcb67c"
STACHE_SH = "#a8793f"
BROW = "#c99a5c"
IRIS = "#3f7fb8"
CAP = "#1e1a17"
SHIRT = "#2b2522"
TEE = "#f7f2e8"
LENS = "#3a2f28"

# where the avatar hangs the character: raised and eased back so the amulet
# on his chest stays inside the round crop and the comb still clears the top
CHAR_Y, CHAR_S = 420, 1.00

HANG, HANG_S = 985, .85  # the amulet's bail, in character units, and its size

W = 10  # the one line weight; the bug scales it, nothing else changes it

EXPRS = ("grin", "deadpan", "shock", "crow", "ride")

TITLES = {
    "grin": "ไก่ชน ยิ้ม / Gai Chon, grinning",
    "deadpan": "ไก่ชน หน้านิ่ง / Gai Chon, deadpan",
    "shock": "ไก่ชน ตกใจ / Gai Chon, startled",
    "crow": "ไก่ชน ขัน / Gai Chon, crowing",
    "ride": "ไก่ชน ใส่แว่นขี่รถ / Gai Chon in riding shades",
}


def mirror(d, fill, stroke=INK, sw=W, extra=""):
    """A shape drawn once on the viewer's right and reflected onto the left."""
    body = (f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" '
            f'stroke-linejoin="round" stroke-linecap="round"{extra}/>')
    return body + f'<g transform="translate(1024 0) scale(-1 1)">{body}</g>'


def background():
    rays = []
    for i in range(0, 24, 2):
        a0, a1 = i * 15, (i + 1) * 15
        rays.append(f'<path d="M512 470 L{_polar(a0)} L{_polar(a1)} Z"/>')
    return (f'<rect width="1024" height="1024" fill="{RED}"/>'
            f'<g fill="{RED_RAY}">{"".join(rays)}</g>')


def _polar(deg, r=1100, cx=512, cy=470):
    import math
    t = math.radians(deg)
    return f"{cx + r * math.cos(t):.0f} {cy + r * math.sin(t):.0f}"


def shoulders():
    return (
        # shirt
        f'<path d="M120 1110 C130 900 230 838 418 806 L512 842 L606 806 '
        f'C794 838 894 900 904 1110 Z" fill="{SHIRT}" stroke="{INK}" stroke-width="{W}" '
        f'stroke-linejoin="round"/>'
        # neck
        f'<path d="M436 690 L440 826 C470 852 554 852 584 826 L588 690 Z" '
        f'fill="{SKIN}" stroke="{INK}" stroke-width="{W}" stroke-linejoin="round"/>'
        f'<path d="M442 730 C480 772 544 772 582 730 L584 770 C550 796 474 796 440 770 Z" '
        f'fill="{SKIN_SH}"/>'
        # tee at the throat, then the open collar over it
        f'<path d="M432 822 C466 856 558 856 592 822 L512 930 Z" fill="{TEE}" '
        f'stroke="{INK}" stroke-width="{W}" stroke-linejoin="round"/>'
        f'<path d="M418 806 L380 846 L444 900 L512 936 L436 820 Z" fill="{SHIRT}" '
        f'stroke="{INK}" stroke-width="{W}" stroke-linejoin="round"/>'
        f'<path d="M606 806 L644 846 L580 900 L512 936 L588 820 Z" fill="{SHIRT}" '
        f'stroke="{INK}" stroke-width="{W}" stroke-linejoin="round"/>'
        f'<g stroke="#4a403a" stroke-width="6" fill="none" stroke-linecap="round">'
        f'<path d="M512 950 L512 1110"/><path d="M300 900 C290 950 288 990 290 1110"/>'
        f'<path d="M724 900 C734 950 736 990 734 1110"/></g>'
        f'<circle cx="512" cy="975" r="8" fill="#4a403a"/>'
    )


def amulet():
    """พระสมเด็จ on a gold chain: a powder tablet in a gold case, the seated
    Buddha under the bell arch on a three-tier base. Low on the chest, on a
    long chain; it sits inside the round crop (tests/test_cast.py)."""
    # hangs low on the chest, below where a crucifix is worn
    chain = f'M448 806 C452 880 484 {HANG - 8} 512 {HANG}'
    tablet = "#efe6cf"
    relief = "#b09a6c"
    return (
        mirror(chain, "none", stroke=GOLD_DEEP, sw=7)
        + mirror(chain, "none", stroke=GOLD, sw=3)
        # the pendant is drawn at full size and hung at HANG_S from the chain's foot
        + f'<g transform="translate(512 {HANG}) scale({HANG_S}) translate(-512 -856)">'
        + f'<circle cx="512" cy="864" r="8" fill="none" stroke="{GOLD_DEEP}" stroke-width="5"/>'
        + f'<rect x="478" y="870" width="68" height="92" rx="9" fill="{GOLD}" '
          f'stroke="{INK}" stroke-width="6"/>'
        + f'<rect x="487" y="879" width="50" height="74" rx="3" fill="{tablet}" '
          f'stroke="{GOLD_DEEP}" stroke-width="3"/>'
        # the bell arch
        + f'<path d="M492 948 C492 912 500 892 512 888 C524 892 532 912 532 948" '
          f'fill="none" stroke="{relief}" stroke-width="3" stroke-linecap="round"/>'
        # seated Buddha: head, body, lap
        + f'<circle cx="512" cy="905" r="5" fill="{relief}"/>'
        + f'<path d="M502 930 C503 917 507 911 512 911 C517 911 521 917 522 930 Z" '
          f'fill="{relief}"/>'
        + f'<ellipse cx="512" cy="930" rx="13" ry="4" fill="{relief}"/>'
        # three tiers
        + f'<g fill="{relief}"><rect x="500" y="936" width="24" height="3"/>'
          f'<rect x="496" y="941" width="32" height="3"/>'
          f'<rect x="492" y="946" width="40" height="3"/></g>'
        # glass over it
        + '<path d="M492 900 L506 884" stroke="#fff" stroke-width="4" '
          'stroke-linecap="round" opacity=".7"/></g>'
    )


def head():
    ear = ('M676 452 C714 438 730 470 726 506 C722 548 702 574 674 568 Z')
    return (
        mirror(ear, SKIN)
        + mirror('M684 480 C704 478 708 510 698 536', "none", sw=6)
        # face
        + f'<path d="M352 330 C336 400 330 470 336 540 C344 630 392 712 448 750 '
          f'C480 772 544 772 576 750 C632 712 680 630 688 540 '
          f'C694 470 688 400 672 330 Z" fill="{SKIN}" stroke="{INK}" '
          f'stroke-width="{W}" stroke-linejoin="round"/>'
        # cropped hair at the temples, under the cap
        + mirror('M672 336 C680 380 682 410 678 440 L662 440 C664 400 662 370 654 338 Z',
                 "#b9a98e", sw=0)
        # jaw shadow and chin
        + f'<path d="M372 610 C392 676 424 718 456 736 C430 700 404 660 388 612 Z" '
          f'fill="{SKIN_SH}" opacity=".8"/>'
        + f'<path d="M652 610 C632 676 600 718 568 736 C594 700 620 660 636 612 Z" '
          f'fill="{SKIN_SH}" opacity=".8"/>'
        + f'<path d="M500 738 C506 744 518 744 524 738" fill="none" stroke="{INK}" '
          f'stroke-width="5" stroke-linecap="round"/>'
        # cheeks
        + f'<ellipse cx="408" cy="560" rx="38" ry="24" fill="{BLUSH}" opacity=".6"/>'
        + f'<ellipse cx="616" cy="560" rx="38" ry="24" fill="{BLUSH}" opacity=".6"/>'
    )


def nose():
    return (f'<path d="M530 492 C536 524 548 548 548 566 C548 580 530 586 520 580" '
            f'fill="{SKIN_SH}" stroke="none"/>'
            f'<path d="M502 486 C498 520 490 546 482 566 C474 588 494 600 512 594 '
            f'C530 600 552 588 542 566" fill="none" stroke="{INK}" stroke-width="7" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')


def comb():
    d = ('M424 236 C400 196 428 160 458 186 C446 134 492 112 508 164 '
         'C510 104 566 100 560 160 C578 118 626 126 610 184 '
         'C640 166 662 198 624 238 Z')
    hi = ('M452 176 C452 160 468 158 474 172 M510 150 C512 132 530 128 534 146 '
          'M566 150 C574 136 594 138 594 152')
    return (f'<g transform="translate(0 36)">'
            f'<path d="{d}" fill="{COMB}" stroke="{INK}" stroke-width="{W}" '
            f'stroke-linejoin="round"/>'
            f'<path d="{hi}" fill="none" stroke="{COMB_HI}" stroke-width="9" '
            f'stroke-linecap="round"/></g>')


def cap():
    body = ('M334 354 C336 310 340 280 360 262 C424 244 472 238 512 250 '
            'C556 238 612 240 668 254 C688 276 692 310 694 354 '
            'C612 330 418 330 334 354 Z')
    return (
        f'<g transform="rotate(-7 512 310)">'
        f'<path d="{body}" fill="{CAP}" stroke="{INK}" stroke-width="{W}" '
        f'stroke-linejoin="round"/>'
        f'<path d="M512 254 L512 334" stroke="#3b342f" stroke-width="7" '
        f'stroke-linecap="round"/>'
        f'<path d="M362 270 C424 252 472 246 512 258 C556 246 612 248 666 262" '
        f'fill="none" stroke="{GOLD}" stroke-width="7" stroke-linecap="round"/>'
        f'<path d="M346 344 C426 322 602 322 684 344" fill="none" stroke="{GOLD}" '
        f'stroke-width="8" stroke-linecap="round"/>'
        # the pin: a comb on a gold disc, where a badge would sit
        f'<circle cx="424" cy="306" r="24" fill="{GOLD}" stroke="{GOLD_DEEP}" '
        f'stroke-width="5"/>'
        f'<path d="M408 316 C402 304 410 294 418 302 C414 286 430 282 430 296 '
        f'C434 282 450 286 442 302 C452 298 456 310 446 318 Z" fill="{COMB}" '
        f'stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>'
        f'</g>'
    )


def mustache(expr):
    # the handlebar, right half; tips lift further when he is pleased
    lift = {"grin": 0, "ride": 0, "crow": -10, "deadpan": 14, "shock": 22}[expr]
    d = ('M512 606 C550 586 612 588 658 608 '
         f'C704 628 740 {626 + lift} 762 {600 + lift} '
         f'C782 {576 + lift} 772 {546 + lift} 750 {550 + lift} '
         f'C734 {552 + lift} 728 {566 + lift} 738 {574 + lift} '
         f'C744 {566 + lift} 756 {566 + lift} 758 {578 + lift} '
         f'C760 {596 + lift} 744 {616 + lift} 716 {634 + lift} '
         'C690 652 650 664 604 662 C568 660 538 652 512 644 Z')
    strands = ('M540 612 C580 606 620 612 650 628 M548 630 C590 628 630 636 670 644 '
               f'M680 634 C704 {632 + lift} 724 {624 + lift} 740 {608 + lift}')
    return (mirror(d, STACHE)
            + mirror(strands, "none", stroke=STACHE_SH, sw=5)
            + f'<path d="M500 604 C506 596 518 596 524 604" fill="none" '
              f'stroke="{STACHE_SH}" stroke-width="5" stroke-linecap="round"/>')


def mouth(expr):
    if expr in ("grin", "ride"):
        return (f'<path d="M438 640 C458 718 566 718 586 640 Z" fill="#7a2a22" '
                f'stroke="{INK}" stroke-width="{W}" stroke-linejoin="round"/>'
                f'<path d="M448 648 C470 676 554 676 576 648 L576 640 L448 640 Z" '
                f'fill="{TEE}"/>'
                f'<path d="M478 700 C500 690 524 690 546 700 C530 712 494 712 478 700 Z" '
                f'fill="#d8665a"/>')
    if expr == "deadpan":
        return (f'<path d="M478 676 L546 672" stroke="{INK}" stroke-width="8" '
                f'stroke-linecap="round"/>')
    if expr == "shock":
        return (f'<ellipse cx="512" cy="688" rx="22" ry="30" fill="#5a1f19" '
                f'stroke="{INK}" stroke-width="{W}"/>')
    # crow — the beak open all the way
    return (f'<path d="M444 640 C444 740 580 740 580 640 Z" fill="#5a1f19" '
            f'stroke="{INK}" stroke-width="{W}" stroke-linejoin="round"/>'
            f'<path d="M476 710 C496 694 528 694 548 710 C530 728 494 728 476 710 Z" '
            f'fill="#d8665a"/>'
            f'<path d="M454 646 L570 646 L566 662 L458 662 Z" fill="{TEE}"/>')


def brows(expr):
    d = {
        "grin": 'M562 420 C588 404 626 402 652 416 L650 432 C624 422 590 424 566 436 Z',
        "ride": 'M562 404 C588 388 626 386 652 400 L650 416 C624 406 590 408 566 420 Z',
        "deadpan": 'M560 438 C590 432 624 432 654 436 L654 452 C624 448 590 448 560 454 Z',
        "shock": 'M566 386 C590 362 628 360 652 376 L648 392 C624 380 592 384 570 402 Z',
        "crow": 'M560 448 C590 424 624 414 654 412 L656 428 C626 432 594 444 566 464 Z',
    }[expr]
    return mirror(d, BROW, stroke=INK, sw=5)


def eyes(expr):
    if expr == "ride":
        return aviators()
    if expr == "crow":
        return mirror('M566 474 L610 488 L566 504', "none", sw=W)
    if expr == "shock":
        eye = (f'<ellipse cx="606" cy="480" rx="34" ry="38" fill="#fff" stroke="{INK}" '
               f'stroke-width="{W - 2}"/><circle cx="606" cy="484" r="9" fill="{INK}"/>')
        return eye + f'<g transform="translate(1024 0) scale(-1 1)">{eye}</g>'
    eye = (f'<path d="M566 482 C580 458 628 456 646 480 C628 498 582 500 566 482 Z" '
           f'fill="#fff" stroke="{INK}" stroke-width="{W - 3}" stroke-linejoin="round"/>'
           f'<circle cx="604" cy="480" r="15" fill="{IRIS}"/>'
           f'<circle cx="604" cy="480" r="7" fill="{INK}"/>'
           f'<circle cx="609" cy="475" r="4" fill="#fff"/>')
    if expr == "deadpan":
        eye += (f'<path d="M560 482 C576 460 630 458 652 480 L652 462 L560 462 Z" '
                f'fill="{SKIN}"/>'
                f'<path d="M562 478 L650 476" stroke="{INK}" stroke-width="{W - 2}" '
                f'stroke-linecap="round"/>')
    else:  # the smile pushes the lower lid up
        eye += (f'<path d="M570 500 C590 490 622 490 642 500" fill="none" stroke="{INK}" '
                f'stroke-width="5" stroke-linecap="round"/>')
    return eye + f'<g transform="translate(1024 0) scale(-1 1)">{eye}</g>'


def aviators():
    lens = 'M530 452 L648 446 C668 446 674 470 662 504 C650 536 600 544 572 530 C546 516 530 486 530 452 Z'
    return (mirror(lens, LENS, sw=W - 2)
            + mirror('M556 466 C580 460 610 460 628 464', "none", stroke="#8a7a6e", sw=6)
            + f'<path d="M494 456 C504 448 520 448 530 456" fill="none" stroke="{GOLD_DEEP}" '
              f'stroke-width="7"/>'
            + mirror('M648 450 L684 466', "none", stroke=GOLD_DEEP, sw=7))


def extras(expr):
    if expr == "shock":
        return (f'<path d="M700 360 C690 384 700 400 712 400 C724 400 732 384 712 352 Z" '
                f'fill="#bfe3f5" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>'
                f'<g stroke="{GOLD}" stroke-width="12" stroke-linecap="round">'
                f'<path d="M228 330 L278 360"/><path d="M206 420 L266 428"/>'
                f'<path d="M796 330 L746 360"/><path d="M818 420 L758 428"/></g>')
    if expr == "crow":
        return (f'<g stroke="{GOLD}" stroke-width="14" stroke-linecap="round" fill="none">'
                f'<path d="M232 580 C212 620 212 660 232 700"/>'
                f'<path d="M190 560 C160 620 160 680 190 740"/>'
                f'<path d="M792 580 C812 620 812 660 792 700"/>'
                f'<path d="M834 560 C864 620 864 680 834 740"/></g>')
    return ""


def character(expr):
    return (shoulders() + amulet() + head() + brows(expr) + eyes(expr) + nose()
            + mouth(expr) + mustache(expr) + comb() + cap() + extras(expr))


def avatar_svg(expr):
    # the character is lifted and enlarged so the face owns the frame; the comb
    # stays inside the inscribed circle (checked in tests/test_cast.py)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'role="img" aria-label="{TITLES[expr]}"><title>{TITLES[expr]}</title>'
            f'{background()}'
            f'<g transform="translate(512 {CHAR_Y}) scale({CHAR_S}) translate(-512 -500)">'
            f'{character(expr)}</g></svg>\n')


def bug_svg():
    """The mark for a reel's corner: the grinning head in a ringed disc,
    transparent outside it. The mustache alone was tried and read as a hat
    floating over a moustache with nobody between them."""
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="122 110 780 780" '
            'role="img" aria-label="ไก่ชน / Gai Chon"><title>ไก่ชน / Gai Chon</title>'
            '<defs><clipPath id="disc"><circle cx="512" cy="500" r="376"/></clipPath>'
            '</defs><g clip-path="url(#disc)">' + background()
            + '<g transform="translate(512 540) scale(1.14) translate(-512 -500)">'
            + character("grin") + '</g></g>'
            f'<circle cx="512" cy="500" r="376" fill="none" stroke="{INK}" '
            f'stroke-width="18"/></svg>\n')


PLATE_HTML = """<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:P;font-weight:600;src:url("{fonts}/prompt-600-thai.woff2")}}
@font-face{{font-family:P;font-weight:600;src:url("{fonts}/prompt-600-latin.woff2")}}
@font-face{{font-family:P;font-weight:400;src:url("{fonts}/prompt-400-latin.woff2")}}
html,body{{margin:0;background:transparent}}
.plate{{position:absolute;left:24px;top:24px;height:192px;display:flex;align-items:center;
 background:{ink};border:6px solid {gold};border-radius:96px;padding:0 56px 0 0;
 box-shadow:0 8px 0 {red_deep}}}
.plate img{{width:204px;height:204px;margin:-12px 20px -12px -12px}}
.th{{font:600 76px/1 P;color:#fffdf7;letter-spacing:.01em}}
.en{{font:600 36px/1.1 P;color:{gold};margin-top:10px;letter-spacing:.06em}}
</style><div class="plate"><img src="{bug}" alt="">
<div><div class="th">ไก่ชน</div><div class="en">GAI CHON · motdang.net</div></div></div>
"""


def find_chrome():
    for c in CHROMES:
        if c and Path(c).exists():
            return c
    return None


def shoot(chrome, src, dest, w, h, transparent=False):
    cmd = [chrome, "--headless", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
           "--force-device-scale-factor=1", f"--window-size={w},{h + 120}",
           "--screenshot=" + str(dest)]
    if transparent:
        cmd.append("--default-background-color=00000000")
    subprocess.run(cmd + [src.as_uri()], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _crop(dest, w, h)


def _crop(dest, w, h):
    try:
        from PIL import Image
    except ImportError:
        return  # left tall; the drawing sits at the top
    im = Image.open(dest)
    im.crop((0, 0, w, h)).save(dest, optimize=True)


def svg_page(svg, size):
    return (f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;'
            f'background:transparent}}svg{{display:block;width:{size}px;height:{size}px}}'
            f'</style>{svg}')


def sheet_page():
    cells = "".join(
        f'<figure><img src="gai-chon-{e}.svg"><figcaption>{e}</figcaption></figure>'
        for e in EXPRS)
    return ('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#faf5ea;'
            'display:flex;flex-wrap:wrap;gap:24px;padding:24px;width:1296px;'
            'font:600 22px sans-serif;color:#2a1e16}figure{margin:0;text-align:center}'
            'img{width:400px;height:400px;display:block;border-radius:50%}'
            '.sq img{border-radius:0}</style>' + cells
            + '<figure class="sq"><img src="gai-chon-grin.svg"><figcaption>grin, square'
              '</figcaption></figure>'
            + '<figure><img src="gai-chon-bug.svg" style="width:64px;height:64px;'
              'border-radius:0;margin:40px auto"><figcaption>bug at 64 px</figcaption>'
              '</figure><figure><img src="gai-chon-bug.svg" style="width:160px;'
              'height:160px;border-radius:0;margin:40px auto"><figcaption>bug at 160 px'
              '</figcaption></figure><figure style="background:#555;padding:12px">'
              '<img src="gai-chon-plate.png" style="width:1080px;height:240px;'
              'border-radius:0"><figcaption style="color:#fff">plate over footage'
              '</figcaption></figure>')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--svg-only", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for e in EXPRS:
        (OUT / f"gai-chon-{e}.svg").write_text(avatar_svg(e), encoding="utf-8")
    (OUT / "gai-chon-bug.svg").write_text(bug_svg(), encoding="utf-8")
    print(f"svg -> {OUT.relative_to(ROOT)}")
    chrome = None if args.svg_only else find_chrome()
    if not chrome:
        print("no Chrome — SVG only" if not args.svg_only else "SVG only")
        return
    tmp = Path(tempfile.mkdtemp(prefix="cast-"))
    try:
        for e in EXPRS:
            svg = avatar_svg(e)
            for size, name in ((1080, f"gai-chon-{e}.png"), (400, f"gai-chon-{e}-400.png")):
                src = tmp / f"{e}-{size}.html"
                src.write_text(svg_page(svg, size), encoding="utf-8")
                shoot(chrome, src, OUT / name, size, size)
        src = tmp / "bug.html"
        src.write_text(svg_page(bug_svg(), 256), encoding="utf-8")
        shoot(chrome, src, OUT / "gai-chon-bug.png", 256, 256, transparent=True)
        src = tmp / "plate.html"
        src.write_text(PLATE_HTML.format(
            fonts=FONTS.as_uri(), bug=(OUT / "gai-chon-bug.svg").as_uri(), ink=INK,
            gold=GOLD, red_deep=RED_DEEP), encoding="utf-8")
        shoot(chrome, src, OUT / "gai-chon-plate.png", 1080, 240, transparent=True)
        src = OUT / "_sheet.html"
        src.write_text(sheet_page(), encoding="utf-8")
        shoot(chrome, src, OUT / "sheet.png", 1344, 1600)
        src.unlink()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"png -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
