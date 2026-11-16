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

# The shape is checked here, not just the count, because `jq` inside the process
# substitution below cannot fail this script: whatever it refuses to read leaves
# the loop unrun, and the script would exit 0 having verified nothing. Measured
# on the version that only counted: `[1]` printed a jq error and exited 0, and
# `[{"name":"@hevcjs/core"}]` queried the registry without a version — the
# packument answers 200, so it printed `ok @hevcjs/core@` and exited 0 for a
# package it never checked. A change in the shape of the action's output, which
# is what #412 was, would land exactly there.
shape=$(jq -r '
  if type != "array" then "not-an-array"
  elif length == 0 then "empty"
  elif any(.[]; (type != "object")
                or ((.name | type) != "string") or (.name == "")
                or ((.version | type) != "string") or (.version == "")) then "bad-entry"
  else "ok" end' <<<"$PUBLISHED") ||
  { echo "::error::PUBLISHED is not valid JSON"; exit 1; }

case "$shape" in
  ok) ;;
  not-an-array)
    echo "::error::PUBLISHED is not a JSON array (type: $(jq -c 'type' <<<"$PUBLISHED"))"
    exit 1 ;;
  empty)
    echo "::error::PUBLISHED lists no package; nothing to verify"
    exit 1 ;;
  bad-entry)
    echo "::error::PUBLISHED has entries without a usable name and version, so nothing can be verified: $(jq -c . <<<"$PUBLISHED" | cut -c1-300)"
    exit 1 ;;
  *)
    # `jq` can succeed while emitting nothing — whitespace-only input clears the
    # `-z` test above and parses to no value at all — or emitting one verdict per
    # document, for input holding several (`1 2`). Both leave `$shape` matching
    # none of the branches above, and without this one the script would fall
    # through to a loop that reads nothing and exit 0, reporting success for a
    # release it never looked at.
    echo "::error::PUBLISHED could not be classified (jq verdict: '$shape'); refusing to report a release as verified"
    exit 1 ;;
esac

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
