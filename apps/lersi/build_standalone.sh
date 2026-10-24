#!/bin/sh
# Wraps index.html (written in artifact form: no doctype/head/body) into a file
# that opens straight from a phone's Downloads folder or a LINE chat.
cd "$(dirname "$0")"
{ printf '<!doctype html><html lang="th"><head><meta charset="utf-8">\n'
  sed -n '1,/<\/style>/p' index.html
  printf '</head><body>\n'
  sed -n '/<\/style>/,$p' index.html | tail -n +2
  printf '</body></html>\n'; } > lersi.html
