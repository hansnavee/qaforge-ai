# Browser Session Flow — QAForge AI

## Sequence

1. User starts execution
2. Worker launches isolated Playwright container
3. Browser opens application login URL
4. UI shows: log in manually; credentials never collected
5. User logs in inside the browser window
6. User clicks Continue
7. Authentication Agent detects success (URL change, login form gone, user menu present)
8. Cookies/tokens stay in memory only
9. Remaining agents run against authenticated session
10. Browser session destroyed; no credential persistence

## Detection heuristics

Layered: URL leave login path, absence of login form, presence of account UI, user Continue confirmation, authenticated network responses — never persist tokens to the database.
