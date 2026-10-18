#!/usr/bin/env python3
"""The two inbox steps that write QUEUE.txt on the Desktop, run as their own job.

pull_inbox.sh runs under /bin/zsh, which macOS refuses on ~/Desktop since about
2026-10-11, so bounty_ask.py failed there on 2026-10-18 and two roadworks
changes from 17 Oct never reached QUEUE A. launchd job net.motdang.queue-asks
(08:25, after the 08:20 pull) runs this file with the Homebrew python3.13 that
has Full Disk Access; its children inherit that access.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
rc = 0
for script in ("bounty_ask.py", "roadworks_scout.py"):
    print("-- %s" % script, flush=True)
    rc |= subprocess.call([sys.executable, os.path.join(HERE, script)] + sys.argv[1:], cwd=os.path.dirname(HERE))
sys.exit(rc)
