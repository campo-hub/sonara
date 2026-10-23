# AgriStore Restoration Progress

Legend: **DONE** means run and observed; **CODE-ONLY** means present but not yet verified.

## Phase 0 — Safety and baseline

| Item | Status | Verification |
|---|---|---|
| Site name set to AgriStore | DONE | Confirmed with the user |
| `sonara-music-final` tag and `agri-marketplace` branch | DONE | `git tag --list sonara-music-final`; `git branch --show-current` |
| Backend baseline | DONE | `npm --prefix backend test` — 45 passed, 0 failed |
| Web baseline | DONE | `npm --prefix Web test` — 26 passed, 0 failed |
| Ignore rules for env files and Google service config | DONE | Reviewed `.gitignore`; patterns and `.env.example` exception are present |
| Example env files contain variable names only | DONE | Checked `Web/.env.example` and `backend/.env.example`: assignments are blank |
| Google service config files removed from Git tracking | DONE | `git ls-files` confirms no tracked `.env` or `google-services*.json` files |
| Duplicate Google service config files removed locally | DONE | Confirmed both duplicate paths are absent; primary local file remains |
| Legacy documentation archived | DONE | Improvements plan and old progress moved to `docs/archive/`; abandoned redesign plan was already archived |
| Android marked as frozen legacy music player | DONE | Added `android/FROZEN.md` |

The root package has no `test` script; run the test commands in the backend and Web package directories (or use the `--prefix` commands above).

## Manual security action

The credentials previously present in `backend/.env` must be rotated before deployment:

- Cloudflare dashboard → R2 → Manage R2 API tokens: revoke/rotate the token backing `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
- Google Cloud Console → IAM & Admin → Service Accounts → Keys (or Firebase Console → Project settings → Service accounts): revoke the exposed key identified by `FIREBASE_PRIVATE_KEY_ID` and issue a replacement for `FIREBASE_PRIVATE_KEY`.
- MongoDB Atlas → Database Access: change the password for the database user in `MONGODB_URI`, then update the deployment environment.

Never put replacement credentials in chat, source files, or example env files.

## Existing worktree changes

Three pre-existing modifications in `android/app/src/main/java/com/castmobile/sender/ui/` were present before this task. They are user changes and must remain untouched.

## Next

Phase 1 has not started. Report Phase 0 completion and wait before continuing.
