#!/bin/bash
cd "$(dirname "$0")"
(python3 -m http.server 8123 >/dev/null 2>&1 &) ; sleep 1
xdg-open http://localhost:8123/index.html 2>/dev/null || open http://localhost:8123/index.html
