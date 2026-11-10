#!/usr/bin/env bash
# Reads each "published" package back from the npm registry and fails if any
# is missing. Input: the `publishedPackages` output of changesets/action, i.e.
# a JSON array of {"name": "...", "version": "..."}, in $PUBLISHED.
# The registry is queried directly with curl: `npm view` caches locally, and
# a new version takes ~70s to be served after `npm publish` (measured, #402).
set -u

: "${PUBLISHED:?PUBLISHED (JSON array) is required}"
ATTEMPTS="${ATTEMPTS:-12}"   # 12 x 15s = 3 min
DELAY="${DELAY:-15}"
REGISTRY="${REGISTRY:-https://registry.npmjs.org}"

missing=()
while IFS=$'\t' read -r name version; do
  # Scoped names need the slash encoded: @hevcjs/core -> @hevcjs%2Fcore
  url="$REGISTRY/${name/\//%2F}/$version"
  found=0
  for ((i = 1; i <= ATTEMPTS; i++)); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$url")" = 200 ]; then
      found=1
      break
    fi
    [ "$i" -lt "$ATTEMPTS" ] && sleep "$DELAY"
  done
  if [ "$found" = 1 ]; then
    echo "ok       $name@$version"
  else
    echo "::error::$name@$version was announced as published but is absent from the registry"
    missing+=("$name@$version")
  fi
done < <(jq -r '.[] | [.name, .version] | @tsv' <<<"$PUBLISHED")

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Partial release: ${#missing[@]} package(s) missing: ${missing[*]}"
  echo "Tags and GitHub releases already exist (created by changeset publish) and are not rolled back."
  exit 1
fi
