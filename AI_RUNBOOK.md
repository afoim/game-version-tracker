# ChatGPT Scheduled Maintenance Runbook

This repository is maintained primarily by a ChatGPT scheduled task. GitHub Actions remains a manual deterministic fallback only.

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

1. Use AgentDock on `C:\Users\acofo\Documents\GitHub\game-version-tracker`.
2. Inspect `git status --short --branch` before changing anything. Never overwrite unrelated local user changes. If unrelated changes exist, stop before editing and report the blocker.
3. Run `git fetch --all --prune`, then fast-forward the current branch with `git pull --ff-only` when safe.
4. Run `python -m unittest discover -s tests -v`.
5. Run `python src/main.py` once to get the deterministic collector baseline. A collector failure is a debugging signal, not a reason to publish partial data.
6. Independently audit public information for every supported game. Prefer official game websites, official APIs, official community/news posts, and official social announcements. Search the web when needed. Check at minimum:
   - current version/update and actual start time;
   - next version/update and whether its date is confirmed or inferred;
   - preview/special-program announcement state;
   - current version headline content;
   - current UP/banner characters and exact start/end times.
7. Compare the audited facts with both adapter source code and the generated `data/games.json`. Pay special attention to hard-coded values in `src/main.py` and adapters. Expired banner data, historical content presented as current, or a newly announced version missed by the parser counts as a defect even when `python src/main.py` exits 0.
8. When facts or source formats changed, fix the adapter/parser or fallback source-of-truth in code. Prefer durable parsing over one-off hard-coding. If no stable machine-readable source exists, a narrowly scoped hard-coded value is allowed only when backed by a current official source and clearly commented. Never invent a launch date, banner, character, or preview status.
9. Add or update regression tests for parser bugs and version-transition logic whenever practical. Preserve all existing frontend fields and their types.
10. Run the full tests again, then run `python src/main.py` again.
11. Validate the final JSON before publishing:
    - exactly 9 supported games are present;
    - no supported game was silently dropped;
    - required top-level fields remain present;
    - confirmed facts are not replaced by weaker estimates;
    - current version start dates are not in the future;
    - expired banners are not left looking current merely because a fallback was stale;
    - `current_version_days`, `days_to_next_version`, and banner remaining days are consistent with dates;
    - a future preview never becomes the current release by accident.
12. Review `git diff`. Do not include unrelated files, temporary logs, credentials, caches, or environment-specific artifacts.
13. Only if tests and validation pass, commit the meaningful changes. Use a concise message such as `chore: refresh game data` or `fix: update <game> collector`.
14. Push the current branch to its configured upstream. Never force-push. If push is rejected, fetch/rebase only when it is safe and conflict-free; otherwise report the blocker instead of discarding remote work.
15. Report a compact maintenance summary: games changed, code fixes made, tests run, commit hash, push result, and any uncertainty that still needs human review. If nothing changed, do not create an empty commit.

## Evidence and confidence rules

- Prefer official sources. Third-party wikis, aggregators, Reddit, search snippets, and fan posts may help discovery but must not be the sole basis for changing authoritative dates or banner data when an official source is available.
- Distinguish confirmed dates from estimates. Existing 42-day cycle logic may remain as an explicit estimate, but must never be described as official confirmation.
- If official sources disagree or are temporarily unreachable, preserve the last known-good published data rather than replacing it with a guess. Report the uncertainty.
- Never publish partial collection results after one adapter fails.
- Never change the JSON contract merely to make collection easier; this repository feeds an existing frontend.

## Repository roles

- `src/games/*.py`: source-specific collectors/parsers.
- `src/main.py`: normalization, compatibility fields, and limited fallbacks.
- `tests/`: regression protection for parsing and collection safety.
- `data/games.json`: generated publication artifact, not the primary source of truth.
- `.github/workflows/collect.yml`: manual fallback collector; ChatGPT scheduled maintenance is the primary scheduler.
