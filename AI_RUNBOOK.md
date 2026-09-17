# ChatGPT Scheduled Maintenance Runbook

This repository is maintained primarily by a ChatGPT scheduled task using the built-in GitHub connector. GitHub Actions remains a deterministic validation/manual fallback. The scheduled task must not depend on AgentDock, the user's computer, or any local path.

## Mission

Keep `data/games.json` accurate and compatible with the existing frontend for all supported games. Do not merely rerun the collector: independently detect stale facts, source-format changes, expired banners, newly announced previews/releases, and broken parsers, then repair the code and regenerate the data.

Supported games:

- 原神 (`genshin`)
- 崩坏：星穹铁道 (`starrail`)
- 崩坏3 (`honkai3`)
- 绝区零 (`zzz`)
- 鸣潮 (`wuwa`)
- 明日方舟：终末地 (`endfield`)
- 异环 (`yh`)
- 蔚蓝档案（日服） (`bluearchive_jp`)
- 星塔旅人（国服） (`stellasora_cn`)

## Daily execution procedure

1. Use the ChatGPT GitHub connector to reread the repository default branch and its latest commit. Read at least `README.md`, `AI_RUNBOOK.md`, `data/games.json`, `src/`, `tests/`, and `.github/workflows/`. Never substitute AgentDock, a local clone, git CLI, or the user's computer for connector access.
2. Independently audit public information for every supported game. Prefer official game websites, official APIs, official community/news posts, and official authenticated social accounts. Search the web when needed. Check at minimum:
   - current version/update and actual start time;
   - next version/update and whether its date is confirmed or inferred;
   - preview/special-program announcement/publication state;
   - current version headline content;
   - current UP/banner characters and exact start/end times.
3. Maintain each game's `sources` array. Every source entry must contain `title`, non-empty `url`, `type` (`official_api`, `official`, `official_community`, or `secondary`), non-empty `claims`, and ISO 8601 `checked_at`. Record only URLs actually used to verify the run; deduplicate identical URLs. Prefer official sources and do not add filler links.
4. Compare audited facts with adapter source code and the generated `data/games.json`. Pay special attention to hard-coded values in `src/main.py` and adapters. Expired banner data, historical content presented as current, a newly announced preview missed by the parser, or a collector that erases `sources` counts as a defect even if collection otherwise appears healthy.
5. When facts or source formats changed, fix the adapter/parser or narrowly scoped fallback source-of-truth through the GitHub connector. Prefer durable parsing over one-off hard-coding. A hard-coded value is allowed only when backed by a current source and clearly scoped to that release. Never invent a launch date, banner, character, or preview state.
6. Add/update regression tests for parser bugs, version transitions, `sources` preservation/validation, stale banners, version-number ordering, and collection safety whenever practical. Preserve all existing frontend fields and their types; `sources` is additive.
7. Validate the final JSON before publishing:
   - exactly 9 supported games are present;
   - no supported game was silently dropped;
   - all legacy top-level fields remain present;
   - every game has a valid `sources` array;
   - source URLs are non-empty and `checked_at` parses as ISO 8601;
   - confirmed facts are not replaced by weaker estimates;
   - current version start dates are not in the future;
   - day counters are never negative;
   - expired banners do not remain populated as though current;
   - a future preview never becomes the current release by accident;
   - `3.9` sorts before `3.10`;
   - a partial collector failure cannot overwrite the last complete JSON.
8. Before writing, reread the latest default-branch head. If the remote changed during the run, incorporate only compatible changes; never force-push and never overwrite unrelated parallel work.
9. Review the final diff and exclude temporary files, logs, credentials, caches, or environment-specific artifacts.
10. Use GitHub Actions/CI when the connector exposes the required action. If direct workflow dispatch is unavailable, rely on push-triggered CI for source/test/data changes and inspect its actual run/status. Do not claim tests ran when no execution environment was available.
11. Only after validation succeeds, create a meaningful commit and fast-forward the default branch through the GitHub connector. If no substantive change exists, do not manufacture an empty commit.
12. Report all nine games, main source URLs, changed facts/code, tests/CI results, commit hash, push status, and remaining uncertainty.

## Evidence and confidence rules

- Prefer official sources. Third-party wikis, aggregators, Reddit, search snippets, and fan posts may help discovery but must not override an available official source.
- Distinguish confirmed dates from estimates. Existing cycle logic may remain as an explicit estimate, but must never be described as official confirmation.
- Do not treat a preview/live-stream date as the version launch date.
- If official sources disagree or are temporarily unreachable, preserve the last known-good verified data rather than replacing it with a guess.
- Never publish partial collection results after one adapter fails.
- Never change the JSON contract merely to make collection easier; this repository feeds an existing frontend.

## Repository roles

- `src/games/*.py`: source-specific collectors/parsers.
- `src/main.py`: normalization, compatibility fields, source metadata, and limited fallbacks.
- `tests/`: regression protection for parsing and collection safety.
- `data/games.json`: generated publication artifact, not the sole source of truth.
- `.github/workflows/collect.yml`: manual fallback collector.
- `.github/workflows/ci.yml`: push/PR regression validation for collector/data changes.
