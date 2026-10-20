"""sharecards_layer: a page gets its own card's tags, or keeps its card and gains the missing ones."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import sharecards_layer as sc  # noqa: E402

PAGE = ('<!DOCTYPE html><html><head><title>ADHD · มดแดง Mot Dang</title>'
        '<meta property="og:title" content="ADHD"><meta property="og:description" content="d">\n'
        '<meta property="og:image" content="https://motdang.net/card.png">'
        '<meta name="twitter:card" content="summary_large_image"></head><body></body></html>')


def emit(docs):
    with contextlib.redirect_stdout(io.StringIO()):
        return sc.emit(docs)


class Emit(unittest.TestCase):
    def setUp(self):
        self.t = Path(tempfile.mkdtemp())
        self.docs, self.src = self.t / "docs", self.t / "p"
        self.docs.mkdir()
        self.src.mkdir()
        (self.src / "adhd.jpg").write_bytes(b"jpg")
        (self.docs / "adhd.html").write_text(PAGE)
        (self.docs / "sites" / "x").mkdir(parents=True)
        (self.docs / "sites" / "x" / "index.html").write_text(
            PAGE.replace("card.png", "sites/x/card.jpg"))
        self.cards = {
            "/adhd.html": {"img": "adhd.jpg", "alt": "Card: ADHD", "title": "ADHD"},
            "/sites/x/": {"alt": "Card: X", "w": 1200, "h": 630},
            "/gone.html": {"img": "adhd.jpg", "alt": "Card: gone"},
            "/nopic.html": {"img": "nopic.jpg", "alt": "Card: nopic"},
        }
        (self.docs / "nopic.html").write_text(PAGE)
        self._m, self._s = sc.MANIFEST, sc.SRC
        sc.MANIFEST = self.t / "m.json"
        sc.MANIFEST.write_text(json.dumps({"cards": self.cards}))
        sc.SRC = self.src

    def tearDown(self):
        sc.MANIFEST, sc.SRC = self._m, self._s

    def test_card_replaces_the_shared_image_and_adds_the_tags(self):
        n, missing, stale = emit(self.docs)
        h = (self.docs / "adhd.html").read_text()
        self.assertEqual(h.count('property="og:image"'), 1)
        self.assertIn('og:image" content="https://motdang.net/og/p/adhd.jpg"', h)
        self.assertIn('og:image:alt" content="Card: ADHD"', h)
        self.assertIn('og:image:width" content="1200"', h)
        self.assertIn('name="twitter:card" content="summary_large_image"', h)
        self.assertNotIn("card.png", h)
        self.assertTrue((self.docs / "og" / "p" / "adhd.jpg").is_file())
        self.assertEqual((n, missing, stale), (2, 1, 0))

    def test_a_page_with_its_own_card_keeps_the_image(self):
        emit(self.docs)
        h = (self.docs / "sites" / "x" / "index.html").read_text()
        self.assertIn('og:image" content="https://motdang.net/sites/x/card.jpg"', h)
        self.assertIn('og:image:alt" content="Card: X"', h)
        self.assertFalse((self.docs / "og" / "p" / "x.jpg").exists())

    def test_a_card_not_drawn_leaves_the_page_alone(self):
        emit(self.docs)
        self.assertEqual((self.docs / "nopic.html").read_text(), PAGE)

    def test_second_run_changes_nothing(self):
        emit(self.docs)
        before = {p: p.read_text() for p in self.docs.rglob("*.html")}
        n, _, _ = emit(self.docs)
        self.assertEqual(n, 0)
        self.assertEqual(before, {p: p.read_text() for p in self.docs.rglob("*.html")})

    def test_a_changed_title_is_counted_as_stale(self):
        (self.docs / "adhd.html").write_text(PAGE.replace("ADHD", "Something else"))
        _, _, stale = emit(self.docs)
        self.assertEqual(stale, 1)

    def test_a_page_without_a_head_tag_is_stamped_inside_its_head(self):
        bare = ('<!doctype html><html lang="en"><meta charset="utf-8"><title>Ghost</title>'
                '<meta name="description" content="d"><style>p{}</style><body><header>h</header></body>')
        (self.docs / "ghost").mkdir()
        (self.docs / "ghost" / "index.html").write_text(bare)
        self.cards["/ghost/"] = {"img": "adhd.jpg", "alt": "Card: Ghost"}
        sc.MANIFEST.write_text(json.dumps({"cards": self.cards}))
        emit(self.docs)
        h = (self.docs / "ghost" / "index.html").read_text()
        self.assertIn('og:image" content="https://motdang.net/og/p/adhd.jpg"', h)
        self.assertLess(h.index("og:image:alt"), h.index("<body>"))
        self.assertIn('og:title" content="Ghost"', h)
        self.assertIn('og:description" content="d"', h)

    def test_alt_is_escaped(self):
        self.assertIn("&quot;", sc.tags("https://x/y.jpg", 'say "hi"', 1200, 630))


class Wiring(unittest.TestCase):
    def test_build_runs_it_after_the_pages_are_written(self):
        src = (ROOT / "build.py").read_text()
        self.assertIn('layers.run("sharecards.emit"', src)
        self.assertLess(src.index('layers.run("share.inject"'), src.index('layers.run("sharecards.emit"'))
        self.assertLess(src.index('layers.run("sharecards.emit"'), src.index("layers.finish()"))


if __name__ == "__main__":
    unittest.main()
