#!/usr/bin/env bash
# Reads each "published" package back from the npm registry and fails if any
# is missing. Input: the `published-packages` output of changesets/action, i.e.
# a JSON array of {"name": "...", "version": "..."}, in $PUBLISHED.
# The registry is queried directly with curl: `npm view` caches locally, and
# a new version takes ~70s to be served after `npm publish` (measured, #402;
# 2.5 min across the five packages on 2026-11-16).
set -u

# The caller only runs this when changesets reported a publication, so an empty
# input means the list did not reach us rather than "nothing was published" —
# a renamed or misspelled output name reads as "" in a GitHub expression, which
# is how #412 went unnoticed. Say so, instead of just "required".
if [ -z "${PUBLISHED:-}" ]; then
  echo "::error::PUBLISHED is empty. Packages were published but the list did not reach this step — check the output name in release.yml against the pinned changesets/action (v2: published-packages)."
  exit 1
fi
ATTEMPTS="${ATTEMPTS:-12}"   # 12 x 15s = 3 min
DELAY="${DELAY:-15}"
REGISTRY="${REGISTRY:-https://registry.npmjs.org}"

# jq inside the process substitution below cannot fail the script: check here
# that the input parses and lists at least one package, else we'd pass vacuously.
# The type is checked as well as the count. A valid JSON scalar — `"x"` — has a
# `length` of its own, so it would clear a bare count check and only fail later,
# inside that process substitution, where the loop would simply not run and this
# script would exit 0 having verified nothing. `-1` folds that into the same
# branch as an empty array.
count=$(jq 'if type == "array" then length else -1 end' <<<"$PUBLISHED") ||
  { echo "::error::PUBLISHED is not valid JSON"; exit 1; }
if [ "$count" -lt 1 ] 2>/dev/null; then
  echo "::error::PUBLISHED is not a non-empty JSON array of packages (type: $(jq -c 'type' <<<"$PUBLISHED" 2>/dev/null || echo unknown))"
  exit 1
fi

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
