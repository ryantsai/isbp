# FAQ and troubleshooting

Short answers to the questions people ask most, grouped by topic. Each answer says what to check and links to the
guide with the full steps. If your question isn't here, ask **Ask IT** or [report an issue](employees.md#report-an-issue).

## What you can do here

- [Signing in](#signing-in)
- [Access and permissions](#access-and-permissions)
- [Requests and approvals](#requests-and-approvals)
- [Notifications and language](#notifications-and-language)
- [Tickets and the service desk](#tickets-and-the-service-desk)
- [Ask IT, the assistant and change sets](#ask-it-the-assistant-and-change-sets)
- [Data, jobs and database access](#data-jobs-and-database-access)
- [Integrations](#integrations)

## Signing in

### My account is locked

**Too many failed attempts. Try again in a few minutes.** means ISBP has locked the account for a short time after
several wrong passwords. Wait and try again. If you forgot a local password, ask the service desk to set a new one; if
you sign in with your company account (**Sign in with …**), reset it there. See [Sign in](README.md#sign-in).

### ISBP asks me to choose a new password when I sign in

Your administrator gave you a password (for a new account, or after setting one for you) and asked you to replace it.
Enter the password you were given as the **Current password**, then a **New password** of at least 10 characters
twice, and select **Change password**. Until you do, ISBP brings you back to **Choose a new password** each time you
open it. See [Sign in](README.md#sign-in).

### It says my account has not been set up

**Your account has not been set up in this platform yet.** means your company account works, but ISBP has no person
for you. Ask the service desk or an identity administrator to add you. **This account is not active. Contact your
administrator.** means your account is pre-boarded, suspended or offboarded.

### I was signed out

**Your session has expired. Please sign in again.** appears when your session has ended, or when your sessions were
signed out (for example after a password change, or with **Sign out other sessions** on another device). Sign in again. To stay signed in on your own device, tick
**Keep me signed in on this device**.

## Access and permissions

### I can't see a page or a button

ISBP shows only what your roles allow. Pages you can't use are missing from the sidebar, and opening one directly
shows **You don't have access to this page.**

1. Open **Profile & preferences → My access** to see your roles.
2. If you need more, [request access](employees.md#request-access-to-an-application-or-a-role) if the role is
   requestable, or ask your manager or an administrator.

Some examples of who needs what: the **Service desk** pages need the **Service desk agent** role; **Integrations**
needs **Integrations administrator** or **Integrations viewer**; the **Assistant** button needs **Assistant user**.
If you see **This page does not exist or the module is disabled.**, an administrator has turned that area off in
**Administration → Modules**.

### Can I request access for a new colleague who hasn't started yet?

Yes. Once HR has added them as **Pre-boarded**, choose **Someone else** in **Request access** and pick them: they're
marked **Pre-boarded**. When the request is approved, the access is granted and works from the moment HR selects
**Onboard** on their first day. See
[A new joiner starts on Monday](how-it-fits-our-work.md#scenario-a-new-joiner-starts-on-monday).

Pre-boarded people appear only to their manager and to people who administer access for their department; if they
don't appear, check that HR set you as their **Manager**. **This person is suspended. Reactivate them first.** and **This person has been offboarded.** mean the
person's account is suspended or closed: no new access can be requested for them.

## Requests and approvals

### My request is stuck. Who is it waiting for?

Open the request from **Requests → My requests**. The **Approval path** shows each step; the current one says
**Waiting for** and names the approvers. The row in **My requests** also shows **Waiting for …** with their pictures.

- Approval steps have deadlines. Approvers get reminders, and depending on the workflow the request is escalated
  (for example to the manager's manager) when the deadline passes.
- If an approver is away, their out-of-office delegate gets new approvals. You can contact the approver directly, or
  ask the service desk.
- Administrators see every running approval in **Administration → Workflows → Running & history**, with the step it's
  **Waiting at**.

### The approval path says "Skipped — nobody to ask"

The workflow found nobody for that step (for example, you have no manager in your profile) and was set to skip it. If
the review step says **Nobody can approve this step — the request would be rejected**, don't send the request: ask
the service desk to fix your manager or the role's owner first.

### It says "No approval workflow is set up for this yet."

The request needs an approval workflow that hasn't been published. Ask an administrator to publish one in
**Administration → Workflows**. See [Administrators](administrators.md).

### It says "There's already an open request for this access."

You (or someone for you) already asked for that role and it's still waiting. Open it from **My requests**; withdraw it
first if you want to send a different request.

### The access was approved but I don't have it yet

Granting happens a few moments after the last approval. Reload the request: its message should start with **Access granted**. If it
says **Couldn't be granted**, the role was deleted or the person is no longer active; ask the service desk.

### An approval I wanted to decide says "This approval has already been handled."

Someone else on the step decided first (many steps accept the first answer), or the request was withdrawn. It's now
under **Approvals → Decided by me** only if you decided it.

### I'm going on leave. How do my approvals keep moving?

Schedule out-of-office in **Profile & preferences → Out of office**: new approvals go to the colleague you choose. See
[Set up out-of-office](employees.md#set-up-out-of-office-before-you-go-on-leave).

### A form isn't in the portal

A form appears under **Requests → What do you need?** only when all of these are true. Ask a workflow administrator
to check them in **Administration → Forms**:

- It is published (its status shows **Published v…**, not **Draft**).
- **Accepting requests** is on (otherwise it shows **Paused**).
- Its **Audience** is **Everyone**, or **Specific groups** that include you.
- Its approval workflow is published.

See [Administrators](administrators.md).

## Notifications and language

### I'm not getting notifications

1. Check **Profile & preferences → Notifications**: the type must be on for **In-app** or **Email**.
2. If the page says email notifications aren't set up on this platform yet, you only get notifications in the app.
   An administrator turns email on in **Administration → Notifications → Email**.
3. Notifications to Microsoft Teams or Slack go to team channels that an administrator configures in
   **Administration → Notifications → Channels**, not to you personally.
4. Administrators can check what was sent and what failed in **Administration → Notifications → Delivery log**.

See [Choose which notifications you get](employees.md#choose-which-notifications-you-get).

### Which language are notifications and emails in?

Yours. Each notification is written in the recipient's language when it's sent, so changing your **Language** affects
new notifications, not old ones. Messages posted to a Teams or Slack channel use that channel's **Message language**.

### Dates and times look wrong

Set your **Time zone** in **Profile & preferences → Preferences**, or select **Use this device's time zone**.

## Tickets and the service desk

### My ticket was resolved, but it's still broken

Open the ticket, select **No, it's still broken**, say **What's still wrong?** and select **Reopen the ticket**. The
service desk is notified. See [Confirm a fix](employees.md#confirm-a-fix-and-rate-the-service).

### Where is the ticket Ask IT raised for me?

Under **Requests → My requests**, like any ticket you report. Ask IT also links it (**View ticket**) in the
conversation.

## Ask IT, the assistant and change sets

### Ask IT says "Builtin · no LLM"

No AI language model is configured. Ask IT still works: it answers from knowledge-base search, similar tickets and
templates, and it can still prepare a ticket. **Language model** means an AI model writes the answers. An
administrator chooses the model in **Administration → AI**. See [Assistant and AI](assistant-and-ai.md).

### The assistant only offers guided templates

With no AI chat model configured, the assistant offers **Guided templates** (such as **Approval chain**, **Request
form**, **Custom field**, **SLA targets** and **HTTP health check**) instead of free text. If it says **No guided
templates for what you can change**, you don't have access to any configuration it can change.

### It says "This month's AI budget has been used up."

The monthly AI budget set by administrators (**Administration → AI → Privacy & budget**) is spent, so the AI model
isn't called until the next month or until an administrator raises the budget. You can still raise a ticket.

### A change set says "Someone changed this configuration after the change set was prepared."

This is the `CHANGE_SET_STALE` error. Someone edited the same workflow, form or setting after the change set was
prepared, so applying it would overwrite their work.

1. Open the change set in **Administration → Change sets**.
2. Select **Refresh**: the change set now uses the current versions.
3. Review the differences and the **Dry run**, then apply or request a review again.

### It says "You can't apply this change set yourself"

Applying it needs permissions you don't hold. Select **Request review**: an approver who holds them reviews it in
**Approvals**, and approving applies it.

### A change set can't be rolled back

Rolling back undoes every change in one go, so it's refused when one of the objects was changed since, or when the
change set deleted something (a delete can't be undone automatically). Make the correction with a new change set
instead. See [Assistant and AI](assistant-and-ai.md).

## Data, jobs and database access

### A scheduled job failed

1. Open **Scheduled jobs → Runs**, filter on **Failed** and open the run. **Why it failed** shows the error.
2. Fix the cause (for example a database connection that can't be reached), then select **Run again**.
3. If the job failed several times in a row, it was switched off (**… was disabled**): open it and select **Enable**.

Job owners get **Runs of my jobs that fail** notifications when the job's alerts are on. See
[Data and automation](data-and-automation.md).

### "Scripts can't run here: no sandbox is configured, or the image isn't allowed."

Script jobs run in isolated containers that an administrator must configure. Ask a platform administrator. See
[Data and automation](data-and-automation.md).

### I can't see my database password any more

**This password was already shown or has expired.** The password is shown once, for 7 days after the account was
created. Ask a DBA to reset it.

### A production deployment was refused: "A production deployment needs an approved change."

Production deployments need a change approved by the CAB (**Scheduled** or **Implementing**), named on the
deployment or linked to the release, and sometimes within its planned window. Link the approved change, or, if you're a
change manager, raise one with **Raise a change**. See [Changes and releases](changes-and-releases.md).

## Integrations

### There's a sync conflict

The same field changed in ISBP and in ServiceDesk Plus or Azure DevOps Server since the last sync, and the profile
asks a person to decide.

1. Go to **Administration → Integrations → Sync conflicts**.
2. Select **Resolve** on the conflict.
3. For each field, choose **Keep ISBP's value** or **Keep the value from …**, or **Keep both as they are**, then
   select **Apply**.

You need permission to resolve sync conflicts (the **Integrations administrator** role). See
[Integrations](integrations.md).

### "The connected system refused the connection's credentials."

The API key or personal access token stored for the connection is wrong or expired. An integration administrator
updates it in the connection's settings.

### "This connection uses plain HTTP, which isn't encrypted."

Connections use HTTPS by default. Use the system's HTTPS address; only if that's impossible, an administrator can turn
on **Allow insecure HTTP** for the connection (the switch is audited).

## How it connects

- Start: [Start here](README.md). Terms: [Glossary](glossary.md).
- Full steps: [Employees](employees.md), [Administrators](administrators.md) and the other role guides.
