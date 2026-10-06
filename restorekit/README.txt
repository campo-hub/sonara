SONARA RESTORE KIT
1. SONARA_RESTORE_PROMPT.md  -> paste into your coding agent (Claude Code etc.) from the repo root
2. docs/PROGRESS.md          -> copy to <repo>/docs/PROGRESS.md (the agent keeps it updated)
3. baseline/                 -> original UI files from the earlier zip (App.jsx, styles.css, Android ui/*.kt, ...)
4. diffs/                    -> exact baseline-to-current differences, used to cherry-pick approved changes
Unpack this kit INSIDE the repo (e.g. <repo>/_restore-kit/) so the agent can read baseline/ and diffs/.
