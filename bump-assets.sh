#!/bin/sh
# Stamp every local script/stylesheet with the current build id.
#
# GitHub Pages serves assets with Cache-Control: max-age=600, so for ten
# minutes after a deploy a returning visitor keeps running the previous
# JavaScript against the new HTML. That produced a string of "it still
# doesn't work" reports where the fix was already live. A query string that
# changes per build makes the URL itself new, so the browser cannot reuse
# the old copy.
#
# Run before committing a deploy:  ./bump-assets.sh
set -e
BUILD=$(date -u +%Y%m%d%H%M%S)
cd "$(dirname "$0")"
# Strip any existing ?v=... then append the new one.
perl -pi -e "s{(src=\"js/[^\"?]+)(\?v=[0-9]+)?\"}{\$1?v=$BUILD\"}g" index.html volunteer.html
perl -pi -e "s{(href=\"css/[^\"?]+)(\?v=[0-9]+)?\"}{\$1?v=$BUILD\"}g" index.html volunteer.html
echo "stamped assets with build $BUILD"
