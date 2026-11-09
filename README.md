# Pactap Jira ticket automation

Small Next.js app that moves a Jira Cloud ticket through the workflow that matches its type and current status, then logs work against a date. Jira is called with REST API v3 from the server. Fetch the ticket first; the stop-at list is only the statuses after the one it is on now.

Development statuses:

1. Marked for Development
2. In Progress
3. DONE - CODED & MERGED
4. Build Created - Dev. Env
5. Build Deployed - Dev. Env.
6. Under Testing - DEV. ENV
7. Testing Completed - DEV. ENV
8. Live - DEV. ENV
9. Build Created - STAGE ENV.
10. Build Deployed - Stage ENV.

A task or story already on that list uses the development workflow. A ticket on `Re - Open` goes to `In Progress` and then through the later development statuses. A bug on `BUG LOGGED` goes to `Re - Open`, then `In Progress`, and then through those same later statuses. A ticket already further along stays on its path and is not moved backward.

`Build Created - Dev. Env` is the destination Jira returned from `DONE - CODED & MERGED`. `Build Deployed - Dev. Env.` includes the trailing period Jira uses. `Under Testing - DEV. ENV` is the status reached by the transition named `Testing Initiated - DEV.`. `Testing Completed - DEV. ENV` is the status reached by the transition named `Testing Completed - DEV.`. The workflow matches the destination status, not the transition name. Choosing a later stop still applies every status in between, one transition at a time. Older spellings are still accepted as aliases. `Live - DEV. ENV`, `Build Created - STAGE ENV.`, and `Build Deployed - Stage ENV.` are the names confirmed while testing the regular ticket.

Transition ids are never hardcoded. Each step uses the id Jira returns for the transition whose destination status matches the next configured name.

## Execution order

The workflow runs first. The worklog is created only after every requested transition succeeds.

If a transition is missing, times out, or leaves the ticket on an unexpected status, the worklog is not created. Nothing is rolled back. The response lists the steps that already succeeded. A timed-out transition or worklog is marked uncertain; check the ticket in Jira before retrying. Posts are not retried automatically.

If the ticket is already further along its sequence, the run continues from the next status. It does not restart, and it does not move backward. If it is already on the target status, the workflow is a no-op and the worklog can still be written.

A worklog with the same date, duration, and comment is treated as already recorded and is not created again. The worklog is created with `adjustEstimate=auto`, so logged hours are added to time spent and subtracted from the remaining estimate. Watchers are not notified. Fetching a ticket also shows its original estimate, time already logged, and remaining estimate.

The workflow is chosen from the fetched issue. `BUG LOGGED` uses the bug path. `Re - Open` uses the reopen path unless the issue type is a bug, in which case it stays on the bug path. Any other configured development status uses the development path, or the bug path when the issue type is a bug. A status outside those lists is not moved.

Each person signs in from the home page. The shared setup password comes from `SETUP_PASSWORD` on the server, then a `@pactap.com` email and a Jira API token are checked with Jira and stored in this browser only. A saved account opens `/dashboard`. The Active sprint tab lists only that person's tickets that are not in a stage or production status. Choosing one opens the Move ticket tab with that key. Server environment variables remain a fallback for direct API calls.

## Environment

Copy `.env.example` to `.env.local` and fill in a Jira Cloud email and API token. Do not commit `.env.local`.

| Variable | Purpose |
| --- | --- |
| `JIRA_BASE_URL` | Site URL, for example `https://pactap-ecosystem.atlassian.net` |
| `JIRA_EMAIL` | Atlassian account email for the API user |
| `JIRA_API_TOKEN` | API token for that account |
| `JIRA_TIMEZONE` | IANA timezone used to build the worklog timestamp. Default `Asia/Kolkata` |
| `JIRA_WORKLOG_START_TIME` | Local time used on `workDate`, `HH:mm:ss`. Default `09:00:00` |
| `JIRA_HTTP_TIMEOUT_MS` | Request timeout. Default `20000` |

The API user needs Browse Projects, Transition Issues, and Work on Issues. Confirm the site timezone before relying on the worklog calendar date.

## Run locally

```bash
npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- **Fetch ticket** loads the issue, current status, workflow, and the statuses that come next. It changes nothing.
- **Preview** checks how far the next transition can be verified and shows the worklog that would be created. It changes nothing. Later statuses cannot be proven until Jira exposes them.
- **Execute** asks for confirmation, then updates Jira.

Use a non-production ticket until the status names are confirmed against a live issue.

## Example request

`POST /api/jira/tickets/normal/execute`

```json
{
  "ticketKey": "PP3-3198",
  "hours": 4,
  "workDate": "2026-11-09",
  "worklogComment": "Development and testing work",
  "executeWorkflow": true,
  "dryRun": true
}
```

`targetStatus` is optional. When it is omitted, the run aims for the last status of the workflow selected for that ticket. `executeWorkflow` defaults to `true`. `dryRun` defaults to `false`. Hours may be omitted; no worklog is created in that case.

Read-only check: `GET /api/jira/tickets/PP3-3198/inspect`

Hours such as `1.5` are stored as whole seconds (`5400`, displayed as `1h 30m`). The worklog `started` value is built from `workDate`, `JIRA_WORKLOG_START_TIME`, and `JIRA_TIMEZONE`, so the calendar date is not shifted by the server timezone.

## Tests

`npm test` covers duration conversion, timezone formatting, request validation, workflow continuation, unavailable transitions, dry-run with no writes, duplicate worklog protection, timeout handling, and Jira client auth/rate-limit behavior. It does not call Jira.

No live transition or worklog has been run from this project. Point `.env.local` at a test issue and use Preview, then Read status, before Execute.

## Still needed before production

- Confirm the statuses after `Testing Completed - DEV. ENV` against the next live transition. `Build Created - Dev. Env`, `Build Deployed - Dev. Env.`, `Under Testing - DEV. ENV`, and `Testing Completed - DEV. ENV` are already confirmed.
- Confirm whether one call should always run to the end, or whether callers will usually set `targetStatus`.
- Confirm the worklog clock time. The default is `09:00:00` in `JIRA_TIMEZONE`.
- Confirm whether one worklog per request is enough.
- Confirm the exact Jira text for `BUG LOGGED` and `Re - Open` on a live bug and a live reopen before relying on those paths.
- Decide whether a failed workflow should still keep a worklog. This version does not create one in that case.
- Prefer a dedicated automation account. For a long-lived integration, review OAuth 2.0 (3LO) with an admin instead of a personal API token.
