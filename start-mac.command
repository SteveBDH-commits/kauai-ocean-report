#!/bin/bash
# Double-click to start the Kauai ocean report test page.
# Edit the email below (NWS asks API users to identify themselves), then save.
export NWS_USER_AGENT="KauaiBeachGuide (add-your-email@example.com)"

cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org , install it, then double-click this file again."
  read -r -p "Press Return to close."
  exit 1
fi
node src/serve.mjs --open
echo
echo "The test page has stopped."
read -r -p "Press Return to close."
