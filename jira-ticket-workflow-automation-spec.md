# Jira Ticket Workflow Automation

## Technical Specification for Cursor IDE

**Project:** Pactap Jira Automation\
**Jira site:** `https://pactap-ecosystem.atlassian.net`\
**Example issue:** `PP3-3198`\
**Platform:** Jira Cloud\
**API version:** Jira Cloud REST API v3\
**Document purpose:** Give Cursor a clear implementation plan for a
small Node.js/Express service that automates Jira status transitions and
worklog entry.

------------------------------------------------------------------------

## 1. Objective

Build a small backend API that reduces repetitive manual Jira ticket
updates.

For the first version, automate only:

1.  Move a ticket through its configured status workflow.
2.  Record the number of hours worked using Jira **Log Work** (a
    worklog).
3.  Record those hours against a date supplied by the caller.

Do not build a large admin UI, database, scheduler, browser automation,
or unrelated Jira features in this phase.

The service should use Jira Cloud REST API v3 directly. Do not use
Selenium, Playwright, browser clicks, or scrape Jira's web interface.

## 2. Confirmed Normal Ticket workflow

The user supplied this start-to-end sequence for a normal ticket:

    Order Status supplied by user
  ------- -------------------------------
        1 In progres
        2 Done codded & Merged
        3 Build created - Dev. Env
        4 Build Depllyed - Dev. Env
        5 Testing Initiated - Dev. Env
        6 Testing Completed - Dev. Env
        7 Live - Dev. Env
        8 Build Deployed- Stagging. Env

These names are copied from the user's description and may contain
spelling differences. Do not silently rename or correct Jira statuses in
API calls. Before implementation/testing, fetch the actual transitions
for a real issue and confirm the exact Jira status names and transition
IDs.

**Important workflow rule:** The supplied list is the intended business
sequence, not proof that Jira permits every transition from every
preceding status. Jira controls which transitions are currently
available. The implementation must query available transitions at each
step and only execute a transition that Jira currently exposes. If a
requested next status is not available, stop and return a clear error
with the current status and available transitions. Do not attempt to
bypass workflow rules.

The user described this as the normal-ticket flow. Other ticket types
also exist, including a "bugged/locked" flow and a "re-open ticket"
flow. Their exact names, statuses, and sequences have not yet been
provided. Do not invent those workflows. Keep the design configurable so
they can be added later.

## 3. Scope

### Included in version 1

-   Jira Cloud authentication from backend environment variables.
-   Read issue details and current status.
-   Read available transitions for an issue.
-   Transition an issue through the configured normal-ticket sequence.
-   Create a worklog using supplied duration and date.
-   Return per-step results and the final issue status.
-   Validate input and handle Jira errors.
-   Provide a dry-run/preview option if practical.

### Explicitly out of scope for version 1

-   Assigning the ticket to a user.
-   Changing story points or estimates.
-   Comments unrelated to the worklog.
-   Bulk processing.
-   Scheduled automation.
-   Browser/UI automation.
-   Bugged/locked and reopened workflows until their exact sequences are
    confirmed.
-   Database persistence or a frontend.

Note: "Assign hours" is interpreted as **Log Work / create a worklog**,
because the requirement is to record hours against a specific date. This
is different from setting Original Estimate or Remaining Estimate.

## 4. Suggested API contract

### Endpoint

`POST /api/jira/tickets/normal/execute`

### Example request

``` json
{
  "ticketKey": "PP3-3198",
  "hours": 4,
  "workDate": "2026-11-09",
  "worklogComment": "Development and testing work",
  "executeWorkflow": true,
  "dryRun": false
}
```

### Field definitions

  ---------------------------------------------------------------------------------
  Field               Type                          Required Description
  ------------------- ---------------- --------------------- ----------------------
  `ticketKey`         string                             Yes Jira issue key,
                                                             e.g. `PP3-3198`

  `hours`             number                             Yes Hours to record. Must
                                                             be greater than zero.

  `workDate`          string                             Yes Date the work was
                                                             performed,
                                                             `YYYY-MM-DD`.

  `worklogComment`    string                              No Worklog
                                                             description/comment.

  `executeWorkflow`   boolean                             No Whether to execute the
                                                             normal workflow.
                                                             Default `true`.

  `dryRun`            boolean                             No Preview actions
                                                             without changing Jira.
                                                             Default `false`.
  ---------------------------------------------------------------------------------

Use a configurable worklog start time, defaulting to a safe configured
time (for example `09:00:00`) in the Jira site's configured timezone. Do
not assume the server timezone is the Jira user's timezone. Confirm the
Jira site's timezone before production use.

Convert `hours` into a Jira duration such as `4h` or `1h 30m`. Validate
fractional hours and round/convert to seconds consistently. Do not
accept zero or negative durations.

### Important worklog date behavior

Jira's worklog API accepts a `started` timestamp, not just a date. Build
this timestamp from `workDate`, the configured worklog start time, and
the configured Jira timezone. Serialize it in the format required by
Jira REST API v3, including the appropriate offset. Do not use
`new Date(workDate)` blindly because timezone conversion can shift the
calendar date.

Jira time tracking must be enabled, and the API user needs the relevant
project permissions, including **Browse Projects** and **Work on
Issues**.

### Example success response

``` json
{
  "success": true,
  "ticketKey": "PP3-3198",
  "workflow": "NORMAL",
  "worklog": {
    "success": true,
    "hours": 4,
    "workDate": "2026-11-09",
    "jiraWorklogId": "123456"
  },
  "workflowExecution": {
    "success": true,
    "completedSteps": [
      {
        "status": "Done codded & Merged",
        "success": true
      },
      {
        "status": "Build created - Dev. Env",
        "success": true
      }
    ],
    "finalStatus": "Build created - Dev. Env"
  }
}
```

The statuses in this sample response are illustrative only. The
implementation must return actual Jira status names.

### Example partial-failure response

``` json
{
  "success": false,
  "ticketKey": "PP3-3198",
  "workflow": "NORMAL",
  "worklog": {
    "success": true,
    "hours": 4,
    "workDate": "2026-11-09",
    "jiraWorklogId": "123456"
  },
  "workflowExecution": {
    "success": false,
    "completedSteps": [
      {
        "status": "Done codded & Merged",
        "success": true
      }
    ],
    "failedAt": "Build created - Dev. Env",
    "currentStatus": "Done codded & Merged",
    "availableTransitions": ["Other Jira-provided transition names"],
    "error": "Requested transition is not currently available."
  }
}
```

Do not claim rollback. Jira transitions and worklogs are separate
operations and may not be reversible. Report exactly which operations
succeeded and failed.

## 5. Workflow execution algorithm

For `executeWorkflow: true`:

1.  Validate the request.
2.  Fetch the issue using `GET /rest/api/3/issue/{issueKey}`.
3.  Read its current status and issue type.
4.  Confirm the issue is eligible for the normal-ticket workflow. Do not
    apply the normal flow to a bug/locked or reopened ticket unless
    explicitly configured.
5.  Determine the next expected status from the configured normal
    workflow sequence.
6.  Fetch currently available transitions using
    `GET /rest/api/3/issue/{issueKey}/transitions`.
7.  Match the expected target status against the returned transition
    destination status. Use the returned transition ID, not a guessed
    ID.
8.  Execute one transition using
    `POST /rest/api/3/issue/{issueKey}/transitions`.
9.  Fetch the issue again to verify the actual current status.
10. Repeat steps 5--9 until the configured target/end of the workflow is
    reached.
11. If a transition is missing, stop immediately and return the current
    status and Jira-provided available transitions.
12. Create the worklog at the appropriate point in the process,
    according to the agreed order below.
13. Return a detailed result for every operation.

**Recommended ordering:** Validate issue and all inputs first;
preview/check workflow feasibility; then execute workflow and worklog.
Because a long workflow can fail partway, make the execution result
explicit. Decide whether worklog should be created before or after
transitions and document that decision. A safe initial implementation
may create the worklog only after all requested transitions succeed, but
if the workflow fails, the user may still want the work hours recorded.
Make this behavior explicit in the API contract rather than silently
losing worklog data.

**Do not create a duplicate worklog automatically on retry.** If a
request times out after Jira may have accepted the worklog, check
existing worklogs or return an uncertain result for manual verification
before retrying. Do not blindly repeat a POST.

### Starting status handling

The supplied sequence begins with `In progres`. If the ticket is already
at a later status, the API must not restart it from the beginning or
move it backwards. It should identify the current position in the
configured sequence and continue from the next step, or reject the
request if the status is not part of the configured sequence.

If the current status is the final configured status, return a
successful no-op for the workflow portion and report that no transition
was needed.

## 6. Jira Cloud API operations

Use the Jira site's base URL:

`https://pactap-ecosystem.atlassian.net`

Relevant REST API v3 operations:

  -----------------------------------------------------------------------------------------
  Purpose                             Method and endpoint
  ----------------------------------- -----------------------------------------------------
  Get issue details/current status    `GET /rest/api/3/issue/{issueIdOrKey}`

  Get available transitions           `GET /rest/api/3/issue/{issueIdOrKey}/transitions`

  Perform a transition                `POST /rest/api/3/issue/{issueIdOrKey}/transitions`

  Add worklog                         `POST /rest/api/3/issue/{issueIdOrKey}/worklog`

  Read issue worklogs (verification)  `GET /rest/api/3/issue/{issueIdOrKey}/worklog`
  -----------------------------------------------------------------------------------------

Transition request body:

``` json
{
  "transition": {
    "id": "TRANSITION_ID_RETURNED_BY_JIRA"
  }
}
```

Worklog request body (example only; generate `started` with the
configured timezone and actual supplied date):

``` json
{
  "timeSpent": "4h",
  "started": "2026-11-09T09:00:00.000+0530",
  "comment": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Development and testing work"
          }
        ]
      }
    ]
  }
}
```

The comment field uses Atlassian Document Format (ADF) in REST API v3.
It may be omitted if no comment is provided.

## 7. Authentication and security

For a simple internal proof of concept, Jira Cloud supports Basic
authentication using an Atlassian account email address and an API
token. Store credentials only on the backend.

Example `.env`:

``` env
JIRA_BASE_URL=https://pactap-ecosystem.atlassian.net
JIRA_EMAIL=your-company-email@example.com
JIRA_API_TOKEN=your_api_token
JIRA_TIMEZONE=Asia/Kolkata
PORT=3000
```

Never: - Put the API token in frontend code. - Commit `.env` to source
control. - Print tokens or Authorization headers in logs. - Ask the user
to paste a real token into source code or a chat. - Return credentials
in API responses.

Use a dedicated company-approved Jira automation account if permitted.
Give it only the Jira permissions required for issue viewing,
transitions, and work logging. For a long-lived production integration,
assess OAuth 2.0 (3LO) or an approved Atlassian app integration with the
company administrator.

## 8. Suggested Node.js project structure

``` text
jira-ticket-automation/
├── src/
│   ├── config/
│   │   └── jira.config.js
│   ├── controllers/
│   │   └── ticket.controller.js
│   ├── routes/
│   │   └── ticket.routes.js
│   ├── services/
│   │   ├── jira.client.js
│   │   ├── issue.service.js
│   │   ├── transition.service.js
│   │   ├── workflow.service.js
│   │   └── worklog.service.js
│   ├── workflows/
│   │   └── normal.workflow.js
│   ├── validators/
│   │   └── ticket.validator.js
│   ├── middleware/
│   │   └── error.middleware.js
│   └── app.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

Keep workflow sequences in configuration, not scattered through
controller logic. Use a shared Jira HTTP client with timeout handling
and sanitized errors.

## 9. Future workflow support

The architecture should support named workflows, for example:

``` js
const workflows = {
  NORMAL: {
    issueTypes: ["Task", "Story"], // Confirm actual Jira issue type names before enabling
    statuses: [
      "In progres",
      "Done codded & Merged",
      "Build created - Dev. Env",
      "Build Depllyed - Dev. Env",
      "Testing Initiated - Dev. Env",
      "Testing Completed - Dev. Env",
      "Live - Dev. Env",
      "Build Deployed- Stagging. Env"
    ]
  }
};
```

The `issueTypes` list above is a placeholder and must not be treated as
confirmed. Prefer explicit workflow selection in the request until
issue-type mapping is confirmed.

Later, add separately configured workflows such as: - `BUG_LOCKED` ---
exact meaning, statuses, and sequence to be supplied by the user. -
`REOPEN` --- exact starting status, target status, and sequence to be
supplied by the user.

Do not infer these flows from the normal-ticket sequence. A reopened
ticket may require a different transition path and may not require a
worklog on every run.

## 10. Validation and error handling

Validate: - `ticketKey` matches the expected Jira issue-key format. -
`hours` is numeric and greater than zero. - `workDate` is a valid
calendar date in `YYYY-MM-DD` format. - `worklogComment` is a string
within a reasonable length. - The issue exists and is accessible. - The
current status is in the selected workflow sequence, unless an explicit
supported starting rule exists. - The requested next transition is
available from Jira.

Handle and report: - `400`: invalid request or Jira validation error. -
`401`: invalid authentication. - `403`: insufficient Jira permissions. -
`404`: issue not found or not visible to the API user. - `409`: workflow
conflict where applicable. - `429`: Jira rate limit; respect
`Retry-After` if returned. - `5xx` / network timeout: Jira or network
failure.

Do not blindly retry non-idempotent operations such as adding a worklog
or transitioning an issue. Verify the resulting issue state before
deciding whether to retry.

## 11. Dry-run behavior

When `dryRun: true`: - Fetch the issue and current status. - Fetch the
available transitions. - Calculate the expected transition path as far
as Jira's currently available transitions permit. - Validate the worklog
date and duration. - Do not transition the issue. - Do not create a
worklog. - Return a preview of the operations and any blocker.

Because future transitions may depend on earlier transitions, the dry
run may not be able to prove the entire path in advance. State this
limitation in the response.

## 12. Testing checklist

Use a non-production/test issue first.

-   [ ] Valid normal ticket at the first workflow status.
-   [ ] Ticket already at an intermediate workflow status.
-   [ ] Ticket already at the final workflow status.
-   [ ] Requested next transition is unavailable.
-   [ ] Issue key does not exist.
-   [ ] API token is invalid.
-   [ ] API user lacks Transition Issues permission.
-   [ ] API user lacks Work on Issues permission.
-   [ ] Valid worklog duration and date.
-   [ ] Invalid date, such as an impossible calendar date.
-   [ ] Fractional hours, such as `1.5`.
-   [ ] Workflow succeeds but worklog fails.
-   [ ] Worklog succeeds but workflow fails, if that execution order is
    selected.
-   [ ] Request timeout after a transition or worklog POST; verify state
    before retrying.
-   [ ] Dry-run causes no Jira changes.
-   [ ] Verify the worklog appears on the requested calendar date in
    Jira.

## 13. Questions to confirm before production

1.  Are the eight supplied normal-ticket statuses the complete workflow,
    and are they written exactly as shown in Jira?
2.  Should one API call move the ticket through all eight statuses, or
    should the caller specify a target status and move only as far as
    that target?
3.  Should hours be logged once per API request, or do you need separate
    hours/date entries for multiple days?
4.  What time of day should be used for the worklog timestamp? The
    request currently supplies a date only.
5.  What are the exact workflows and status sequences for
    "bugged/locked" and "re-open ticket"?
6.  Should worklog creation happen before or after status transitions?
    What should happen to the worklog if the workflow fails partway?

Do not block the initial proof of concept on future workflow
definitions. Implement and test the normal workflow first, while keeping
the workflow configuration extensible.

## 14. Official Atlassian references

-   Jira Cloud REST API v3 overview and authentication:\
    https://developer.atlassian.com/cloud/jira/platform/rest/v3/\
-   Jira issue operations, including get transitions and transition
    issue:\
    https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/\
-   Jira issue worklogs, including add worklog and required
    permissions:\
    https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/\
-   Atlassian Basic authentication for REST APIs:\
    https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/

------------------------------------------------------------------------

# Instructions for Cursor

Read this specification and inspect the existing repository before
coding. If the repository already has an established Node.js/Express
structure, follow its conventions rather than duplicating architecture.

Implement the smallest working version for the confirmed normal-ticket
workflow only. First create a diagnostic/test script or endpoint that
reads issue `PP3-3198`, displays its current status and available
transitions, and does not modify anything. Use that output to validate
exact Jira status names and transition IDs with the project owner.

Then implement the workflow execution and worklog endpoint,
environment-based credentials, input validation, safe error handling,
and tests. Do not hardcode transition IDs. Do not invent Bug/Locked or
Reopen workflows. Do not expose the Jira API token. Do not run a real
transition or create a real worklog until the user explicitly enables
execution and confirms the test issue/date/hours.

At the end, provide: 1. Files created/changed. 2. Environment variables
required (without real secret values). 3. How to run locally. 4. Example
request. 5. Test results. 6. Any Jira permissions or workflow details
still needed.
