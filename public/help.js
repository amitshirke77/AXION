"use strict";
// AXION help content. Each section lists who sees it:
//   all · internal (admin, editor, contributor) · edit (admin, editor) · admin · client
window.AXION_HELP = [
{ id: "start", t: "Getting started", for: ["internal"], b: `
<p>AXION tracks action items for PeopleOCity, Expenova and UKB IT Solutions. Every client, and every team within a client, has its own container of actions. The Overall view rolls them all up.</p>
<h4>Signing in</h4>
<ul>
<li><b>Email and password.</b> Your first password comes from an invite link sent by the admin. The link works for 7 days.</li>
<li><b>Sign in with Microsoft</b>, when shown. It works only if the admin has given your exact work email a login.</li>
<li><b>Forgot password?</b> on the sign-in page emails you a reset link that works for 2 hours.</li>
<li>You stay signed in for 30 days on the same browser. After 10 wrong passwords, sign-in is paused for 15 minutes.</li>
</ul>
<h4>Finding your way around</h4>
<ul>
<li><b>Overall view</b>: numbers and health for everything you can see.</li>
<li><b>Companies</b> in the left menu: open a company, client or team to see its actions. The red badge counts items past their due date; the grey badge counts open items.</li>
<li><b>Weekly updates</b>: prepare and send the weekly status email.</li>
<li><b>People &amp; setup</b>: the people directory, structure and settings. Admins and editors manage it; contributors can look.</li>
<li><b>Account</b> (bottom of the menu): change your password or sign out.</li>
<li>On a phone, the menu is the drop-down at the top of the page.</li>
</ul>` },

{ id: "client-start", t: "Getting started", for: ["client"], b: `
<p>This page shows the action items the team has shared with you, with their progress, next steps and dates.</p>
<ul>
<li><b>Overview</b> lists the shared items and their numbers. Click a number to see those items.</li>
<li><b>Open any item</b> to read its progress updates and post a comment or question. The team sees your comment straight away on that item.</li>
<li>Tick <b>⛔ This is a blocker</b> when something is stopping progress; your comment is highlighted in red for the team.</li>
<li>Each item shows its latest shared update. A blue <b>New</b> marker means there's something you haven't opened yet.</li>
<li>Only items and updates the team has marked as shared appear here, plus items you raise yourself. Internal notes are never shown.</li>
<li>Expenova items don't show due dates in this view; the next step and its date show instead.</li>
<li><b>Account</b> (bottom of the menu, or top-right on a phone) lets you change your password or sign out.</li>
</ul>` },

{ id: "client-own", t: "Tracking your own work", for: ["client"], b: `
<p>You can use AXION for your own project tracking as well as following the team's work.</p>
<ol>
<li>Press <b>New action</b>.</li>
<li>Enter the action, optional context, priority, next best action and date, and due date.</li>
<li>You're the Accountable and Responsible person to start with. Add colleagues from your organisation if you like.</li>
<li>Press <b>Create action</b>.</li>
</ol>
<ul>
<li><b>🔒 Private.</b> Your item is visible only to you and to colleagues you name on it. The team can't see it.</li>
<li><b>Sharing with the team.</b> Add someone from the team as Accountable or Responsible and the item is shared with them; they can update it and post progress. You keep seeing it and can still edit it.</li>
<li>You can edit, update and close your own items at any time, and set repeat reminders for recurring work.</li>
</ul>` },

{ id: "client-items", t: "Reading the shared items", for: ["client"], b: `
<table class="htbl">
<tr><td><b>Open actions</b></td><td>Shared items still in progress.</td></tr>
<tr><td><b>Blocked</b></td><td>Items currently held up by a blocker.</td></tr>
<tr><td><b>Open P1 / P2</b></td><td>Items marked Critical or High priority.</td></tr>
<tr><td><b>Closed last week</b></td><td>Items completed between last Monday and Sunday.</td></tr>
</table>
<p>Click a number to list those items. Each item shows:</p>
<ul>
<li><b>NBA, next best action</b>: the next step the team will take.</li>
<li><b>NBD, next best date</b>: when that step is planned.</li>
<li><b>A and R</b>: the person Accountable for the outcome and the people Responsible for the work.</li>
<li><b>Priority</b>: P1 Critical, P2 High, P3 Medium, P4 Low.</li>
<li><b>Status</b>: Not started, In progress, Awaiting input, Blocked, Done or Cancelled.</li>
</ul>
<p>Open an item to read the progress updates shared with you and post a comment. The <b>Comfortable / Compact</b> switch changes how much fits on screen.</p>` },

{ id: "dashboard", t: "Reading the dashboard", for: ["internal"], b: `
<h4>The numbers</h4>
<table class="htbl">
<tr><td><b>Open actions</b></td><td>Everything not yet Done or Cancelled.</td></tr>
<tr><td><b>Past due date</b></td><td>Open items whose final due date has passed.</td></tr>
<tr><td><b>Blocked</b></td><td>Open items whose status is Blocked, usually because someone posted a blocker.</td></tr>
<tr><td><b>Open P1 / P2</b></td><td>Open items marked Critical or High.</td></tr>
<tr><td><b>Due in 7 days</b></td><td>Open items due within the next week.</td></tr>
<tr><td><b>Updates pending</b></td><td>Items whose progress update is overdue (see <a data-help="updating">Updating your items</a>).</td></tr>
<tr><td><b>Repeat reminders due</b></td><td>Recurring items whose next occurrence is coming up.</td></tr>
<tr><td><b>Closed last week</b></td><td>Items marked Done between last Monday and Sunday.</td></tr>
</table>
<p>Click any number to see exactly those items. Click the <b>✕</b> on the filter chip to clear it. The numbers count <b>main tasks only</b>; sub-task progress shows on each main task as “Sub-tasks 2/3”.</p>
<h4>By company, client and team</h4>
<p>The table shows the same numbers for each container. Click a row to open it, or a number to open that list. The coloured dot is the health:</p>
<ul><li><b>Red</b>: a P1 is late, or more than 20% of open items are late.</li><li><b>Amber</b>: anything is late or an update is pending.</li><li><b>Green</b>: on track.</li></ul>
<h4>Needs attention</h4>
<p>Late items, open P1s, items whose next best date has passed, overdue progress updates and repeat reminders that are due, most urgent first.</p>
<h4>Comfortable or Compact</h4>
<p>The switch at the top of each dashboard changes how much fits on screen. Compact hides the labels under each item and shows a coloured dot instead: red for late or blocked, amber for a missed next-best date or a pending update, blue for a reminder due. Hover over the title to see all its flags. Your choice is remembered on that browser.</p>` },

{ id: "items", t: "What's in an action item", for: ["internal"], b: `
<table class="htbl">
<tr><td><b>Reference</b></td><td>Made from the client and team codes, e.g. <code>CUSTCAP-021</code> or <code>ALB-ACR-004</code>. Sub-tasks add a number: <code>CUSTCAP-021.1</code>.</td></tr>
<tr><td><b>Action item and context</b></td><td>What needs doing, plus optional background.</td></tr>
<tr><td><b>Company, client, team</b></td><td>The container the item belongs to.</td></tr>
<tr><td><b>Type</b></td><td>Quarterly meeting, monthly meeting, ad-hoc meeting, deliverable and so on. Meeting types suggest a matching repeat.</td></tr>
<tr><td><b>Priority</b></td><td><b>P1 Critical</b>: business or client impact now, daily follow-up. <b>P2 High</b>: needed this week. <b>P3 Medium</b>: planned within the month. <b>P4 Low</b>: nice to have.</td></tr>
<tr><td><b>Status</b></td><td>Not started, In progress, Awaiting input, Blocked, Done, Cancelled.</td></tr>
<tr><td><b>NBA: next best action</b></td><td>The single next step that moves the item forward. Required while the item is open.</td></tr>
<tr><td><b>NBD: next best date</b></td><td>When that next step should happen. Required while open. A passed NBD shows as “NBD passed”.</td></tr>
<tr><td><b>Final due date</b></td><td>When the whole item must be finished.</td></tr>
<tr><td><b>Progress updates</b></td><td>How often the Responsible person must post an update: not required, or every 3, 7 or 14 days.</td></tr>
</table>
<h4>ARCI: who does what</h4>
<ul>
<li><b>A, Accountable</b>: owns the outcome. One person. Only they can close the item.</li>
<li><b>R, Responsible</b>: does the work and posts the progress updates. Gets the reminder emails.</li>
<li><b>C, Consulted</b>: gives input before decisions. Can post updates.</li>
<li><b>I, Informed</b>: kept in the loop through the weekly update.</li>
</ul>` },

{ id: "create", t: "Creating an action", for: ["edit"], b: `
<ol>
<li>Open the company, client or team the action belongs to, then press <b>New action</b>. The container is filled in for you; you can change it.</li>
<li>Fill in the title, type, priority, next best action and date, and the final due date.</li>
<li>Pick the Accountable person and at least one Responsible person. <b>+ Add someone to the directory</b> adds a new person on the spot.</li>
<li>Set repeats for meetings and ongoing work (see <a data-help="repeat">Repeat reminders</a>).</li>
<li>For Expenova clients with client updates on, tick <b>Include this item in client-facing weekly updates</b> if the client should see it.</li>
<li>Press <b>Create action</b>. The reference is assigned and the creation is logged in the update trail.</li>
</ol>
<p><b>Long deadlines.</b> When the due date is more than 14 days away, progress updates are required (every 7 days by default; you can choose 3 or 14). This keeps a running trail until the item is closed.</p>` },

{ id: "updating", t: "Updating your items", for: ["internal"], b: `
<p>Open an item by clicking it anywhere in the tracker, or from the link in a reminder email.</p>
<h4>Changing the item</h4>
<ul>
<li><b>Admins and editors</b> can change every field on items in their companies and clients.</li>
<li><b>Contributors</b> can change the status, next best action, next best date and repeat cycle on items where they are Accountable, Responsible or Consulted. Other fields are greyed out.</li>
<li>Press <b>Save changes</b>. Changes to status, priority, dates, people and the next best action are written into the update trail automatically.</li>
</ul>
<h4>The update trail</h4>
<ul>
<li><b>Progress update</b>: what happened since the last update, what's next, any blockers. Posting one resets the update clock, so “Update due” disappears.</li>
<li><b>Comment</b>: a note or question that doesn't count as a progress update.</li>
<li>Editors can post <b>on behalf of</b> someone, for example after a call.</li>
<li>On client-shared items, tick <b>Visible to client</b> to include that update in client emails and the client's view.</li>
</ul>
<h4>Seeing what's new</h4>
<ul>
<li>Every item in the lists shows its <b>latest entry</b>: whether it's a progress update, comment or blocker, who posted it, how long ago, and the first lines of the text. Progress updates have a blue edge; blockers are red.</li>
<li>A blue <b>New</b> marker means someone else posted since you last opened that item. It clears when you open it. In Compact view it shows as a small blue dot before the title. “New” is remembered per browser.</li>
</ul>
<h4>Reporting a blocker</h4>
<ul>
<li>Tick <b>⛔ This is a blocker</b> before posting a progress update or comment.</li>
<li>The entry is highlighted in red in the trail and on the item in every list.</li>
<li>If you can update the item (its A, R or C, an editor or admin, or the task owner of a sub-task), its status changes to <b>Blocked</b> and the change is logged. Otherwise the red entry flags it for the owner.</li>
<li>Blocked items count in the <b>Blocked</b> number at the top, appear in Needs attention and get their own section in the weekly update and present mode.</li>
<li>When it's cleared, post an update and set the status back to In progress. The blocker note is removed.</li>
<li>A blocker on a sub-task also marks its main task Blocked until the sub-task is cleared (see Sub-tasks).</li>
</ul>
<p><b>Update due</b> appears when an item asks for updates every N days and the last one is older than that. It counts in “Updates pending” and the weekday reminder email until someone posts one.</p>` },

{ id: "closing", t: "Closing an item", for: ["internal"], b: `
<ol>
<li>Set the status to <b>Done</b> (delivered) or <b>Cancelled</b> (no longer needed).</li>
<li>Write a <b>closure note</b>: what was delivered, or why it was cancelled. It's required, and it appears in the closed list and weekly updates.</li>
<li>Press <b>Save changes</b>.</li>
</ol>
<ul>
<li><b>Only the Accountable person</b> (or an admin or editor) can close an item. If you're Responsible or Consulted, choosing Done sends a <b>closure request</b> instead. The Accountable person sees it at the top of the item and confirms.</li>
<li><b>A main task closes only after all its sub-tasks</b> are Done or Cancelled. AXION names the ones still open.</li>
<li>To <b>reopen</b> an item, set the status back to an open one. The reopening is logged.</li>
</ul>` },

{ id: "subtasks", t: "Sub-tasks", for: ["internal"], b: `
<p>Split a larger action into pieces and give each piece to a different person.</p>
<h4>Adding sub-tasks</h4>
<ol>
<li>Open the main task and scroll to <b>Sub-tasks</b>.</li>
<li>Type the sub-task, choose who it's assigned to and the due date, then press <b>Add sub-task</b>.</li>
</ol>
<ul>
<li><b>Who can add them:</b> the task owner (the main task's Accountable person), even with Contributor access, plus editors and admins.</li>
<li><b>Who can be assigned:</b> only people in the same company as the main task, or group-wide people. Client contacts can't be assigned.</li>
<li>A sub-task is a full item for the person assigned: its own reference (e.g. <code>CUSTCAP-021.1</code>), status, next step and dates, update trail and reminder emails. It stays in the main task's client and team.</li>
<li>The task owner can edit, reassign or close their sub-tasks.</li>
<li>Sub-tasks go one level deep: a sub-task can't have sub-tasks of its own.</li>
<li><b>Blocked sub-tasks block the main task.</b> When a sub-task is marked Blocked (by a blocker post or by setting its status), the main task switches to Blocked too, with a note naming the sub-task. When no sub-tasks are blocked any more, the main task returns to its earlier status, unless it also has a blocker of its own.</li>
</ul>
<h4>Closing the main task</h4>
<p>The main task can't be set to Done or Cancelled until every sub-task is Done or Cancelled. When the last one closes, the owner is told the main task can now be closed. Adding and finishing sub-tasks is noted in the main task's trail.</p>
<p>In lists, sub-tasks appear indented under their main task, and the main task shows “Sub-tasks 1/3”. Dashboard numbers count main tasks only.</p>` },

{ id: "repeat", t: "Repeat reminders (ongoing items)", for: ["internal"], b: `
<p>Use repeats for meetings and recurring work, such as a monthly review, a quarterly business review or a daily sheet update.</p>
<ul>
<li><b>Repeats</b>: daily, weekly, fortnightly, monthly, quarterly, half-yearly or yearly. Choosing a meeting type suggests the matching frequency.</li>
<li><b>Next occurrence</b>: the date of the next meeting or cycle.</li>
<li><b>Remind</b>: on the day, or 1, 2, 3 or 7 days before. The item shows “Reminder” and counts in “Repeat reminders due” from then.</li>
<li>After each meeting or cycle, open the item and press <b>Mark cycle done</b>. It logs the cycle in the trail and moves the next date forward. The item itself stays open.</li>
</ul>` },

{ id: "search", t: "Searching and filtering", for: ["internal"], b: `
<ul>
<li>In any company, client or team, the search box looks through references, titles, context and next best actions.</li>
<li>Filter by status (open, closed, all or one status), priority, type and person. The person filter matches anyone in the ARCI.</li>
<li>The closed panel at the bottom switches between <b>last week</b> and <b>this week</b>. <b>Copy</b> puts the list on your clipboard for an email or chat.</li>
<li>Links in reminder emails open the item directly.</li>
</ul>` },

{ id: "weekly", t: "Weekly updates", for: ["internal"], b: `
<ol>
<li>Open <b>Weekly updates</b>, or press <b>Weekly update for this</b> on a client or team page.</li>
<li><b>Covering</b>: everything, one company, one client or one team.</li>
<li><b>Audience</b>: <i>Internal team</i>, or <i>Client</i> for clients with client updates switched on. The client version includes only items marked client-visible and updates marked visible to client.</li>
<li><b>Period</b>: the 7 days ending on a date. <b>Last week</b> picks Monday to Sunday.</li>
<li><b>To</b> is suggested from the Accountable, Responsible and Informed people on the items. Edit it freely. Add Cc and adjust the subject.</li>
<li>Check the <b>Preview</b>: closed items with their outcomes, late items, P1/P2 focus, what's coming up, new items, pending updates and repeat meetings.</li>
<li>Press <b>Send email</b> (sent from the tracker, replies come to you) or <b>Copy email text</b> to paste into Outlook.</li>
</ol>
<p>Every sent or copied update is recorded in the <b>Sent log</b>. Expenova summaries leave out due dates.</p>` },

{ id: "minutes", t: "Minutes of meeting (PDF)", for: ["internal"], b: `
<p>Record a meeting and send everyone a PDF of the minutes with the action items agreed.</p>
<ol>
<li>Open <b>Meetings &amp; minutes</b> and press <b>New minutes</b>, or press <b>Minutes</b> on a client or team page to start with that client filled in.</li>
<li>Enter the title, type, date, time and venue. Add attendees from the directory, plus anyone else by name or email, and any apologies.</li>
<li>Write the <b>agenda</b>, <b>discussion</b> and <b>decisions</b>, one point per line. Lines starting with “-” become bullets.</li>
<li><b>Action items:</b> add existing open actions one by one or with <b>Add all open here</b>, or create a <b>new action</b> on the spot (title, owner, due date). New actions are created in the tracker straight away, marked as coming from this meeting.</li>
<li>Choose the <b>PDF version</b>: <i>Internal</i> includes every linked action and internal updates; <i>Client</i> includes only client-visible actions and updates (for clients with client updates on).</li>
<li><b>Download PDF</b> to save or print it, or fill in <b>Email the PDF</b> and press <b>Send PDF</b>. Recipients are suggested from the attendees; replies come to you. Each send is logged on the minutes.</li>
</ol>
<ul>
<li>The PDF carries the company logo (PeopleOCity, Expenova or UKB IT Solutions), the meeting details, attendees, sections and an action table with owner, next step, next best date, due date and status. Expenova minutes leave out due dates, as other summaries do.</li>
<li>Admins and editors for that client create and edit minutes. Contributors can read and download minutes for their companies or meetings they attended. Clients don't see the Meetings page; they get the PDF by email.</li>
</ul>` },

{ id: "present", t: "Present mode", for: ["all"], b: `
<p>Press <b>Present</b> on any dashboard to show it as full-screen slides for a review meeting: the headline numbers, health of each area, closed items, late items, focus items and what's coming up.</p>
<ul>
<li>Next slide: <b>→</b>, <b>Space</b> or <b>Page Down</b>. Previous: <b>←</b> or <b>Page Up</b>. First and last: <b>Home</b> and <b>End</b>.</li>
<li><b>Full screen</b> hides the browser. <b>Esc</b> or <b>Done</b> leaves.</li>
<li>The slides cover whatever page you pressed Present on: everything, a company, a client or a team.</li>
</ul>` },

{ id: "emails", t: "Automatic emails", for: ["internal"], b: `
<h4>Weekday update reminders (about 9:45 AM)</h4>
<p>Each weekday morning, people get one email listing their open items that need attention, with a link to each item. An item is included when it's past its due date, its next best date has passed, or its progress update is overdue.</p>
<ul>
<li>The email goes to the Responsible people, or to the Accountable person if no one is Responsible.</li>
<li>The same item isn't chased again for 3 days, or for its update interval if that's longer.</li>
<li>You only get these emails if you have a login, an email address in the directory, and email update requests switched on for you.</li>
</ul>
<h4>Monday summary (about 8:30 AM)</h4>
<p>Admins get a summary of the previous week: closed items, past-due items, open P1/P2 and updates owed. It counts main tasks only.</p>
<p>Both emails are switched on or off by an admin under People &amp; setup. They start switched off.</p>` },

{ id: "access", t: "Access levels", for: ["internal"], b: `
<table class="htbl">
<tr><td><b>Admin</b></td><td>Sees and changes everything, including logins, structure, settings and System status.</td></tr>
<tr><td><b>Editor</b></td><td>Creates and edits actions in the companies, clients or teams ticked for them.</td></tr>
<tr><td><b>Contributor</b></td><td>Sees the ticked companies or clients plus any item they're named on. Updates status, next step and dates, and posts progress, on items where they're A, R or C. Adds and manages sub-tasks on items they own.</td></tr>
<tr><td><b>Client view</b></td><td>Sees only items shared with their own client and only updates marked visible to client. Can post comments. Internal notes, update cadence and Expenova due dates are never sent to them. Can also raise their own items for their own project tracking: these are private to the client until they assign someone from the team, and then that person and the team (by normal access) see them, labelled “Raised by client”.</td></tr>
</table>` },

{ id: "admin-people", t: "Admin: people and logins", for: ["admin"], b: `
<h4>Finding people</h4>
<ul>
<li>Filter the directory by <b>company</b>, then <b>client</b>, then <b>team</b>: each list only offers what belongs to the one before it. Also filter by <b>role</b>, <b>our team or client contacts</b>, <b>login access</b> and <b>active or inactive</b>, or search by name, email or role.</li>
<li><b>View by</b> groups the list by company, client &amp; team, role, login access or team / client.</li>
<li>In an action item, the Accountable, Responsible, Consulted and Informed lists are grouped the same way: that team first, then the client, the company, group-wide people, and other companies last.</li>
</ul>
<h4>Adding someone to the directory</h4>
<ol>
<li>People &amp; setup → <b>Add person</b>. Enter name, email and role. If you've filtered the directory to a company, client or team, the form starts with those filled in.</li>
<li>Choose <b>internal</b> or <b>client</b>, and their company, client and team (leave company as Group-wide for people who work across companies).</li>
<li><b>Email update requests</b>: switch off for people who shouldn't get the weekday reminder.</li>
</ol>
<p>People in the directory can be named on items even without a login.</p>
<h4>Giving a login</h4>
<ol>
<li>Press <b>Edit</b> on the person, then go to <b>Login access</b>.</li>
<li>Choose the access level and tick the companies, clients or teams they can see (not needed for admins or client logins).</li>
<li>Press <b>Save access</b>, then <b>Email invite</b> or <b>Get invite link</b> to send it yourself. The invite works for 7 days.</li>
</ol>
<p>To <b>remove a login</b>, set Access to <b>No login</b> and press Save access. That signs the person out everywhere and blocks access. They stay in the directory, and items they're on are unchanged.</p>
<p>Microsoft sign-in works for anyone whose exact email has a login, once Microsoft sign-in is set up on the server.</p>` },

{ id: "admin-setup", t: "Admin: structure and settings", for: ["admin"], b: `
<ul>
<li><b>Companies, clients, teams</b>: add clients (with their reference code) and teams. Tick <b>client updates</b> for clients that receive client-facing weekly emails.</li>
<li><b>Action types</b>: add or remove types such as “Board review”.</li>
<li><b>Sign-in &amp; automatic emails</b>: switch the weekday reminders and Monday summary on or off. <b>Preview who'd get reminders</b> shows the list without sending. <b>Send reminders now</b> and <b>Send summary now</b> ask you to press twice.</li>
<li>Only admins can delete an action. A main task with sub-tasks can't be deleted until its sub-tasks are deleted.</li>
</ul>` },

{ id: "admin-status", t: "Admin: System status", for: ["admin"], b: `
<ul>
<li><b>Health</b>: whether the database, monitoring, email, Microsoft sign-in and the server keys are working. <b>Test email</b> checks the mail server login without sending anything.</li>
<li><b>Scheduled jobs</b>: when the weekday reminders and Monday summary last ran, and whether each is switched on.</li>
<li><b>Last 24 hours</b>: server errors, browser errors and slow requests. A red badge on the menu item shows server errors.</li>
<li><b>History</b>: <i>Activity</i> lists sign-ins, failed sign-ins, password changes, invites, access changes and every item created, edited or deleted (with the fields that changed). <i>Errors</i>, <i>Slow requests</i> and <i>Scheduled jobs</i> have their own tabs. History is kept for 180 days.</li>
</ul>` },

{ id: "account", t: "Your account and password", for: ["all"], b: `
<ul>
<li><b>Account</b> → change your password (at least 10 characters). Changing it signs you out on other devices.</li>
<li><b>Sign out</b> is under Account, or at the bottom of the menu.</li>
<li>Forgot it? Use <b>Forgot password?</b> on the sign-in page.</li>
</ul>` },

{ id: "client-faq", t: "Questions", for: ["client"], b: `
<dl class="hfaq">
<dt>I expected to see an item that isn't here.</dt><dd>Only items the team has shared with you appear. Ask your contact at the team to share it.</dd>
<dt>Can the team see the items I create?</dt><dd>Not until you assign someone from the team to them. Until then they're private to you and the colleagues you name.</dd>
<dt>Who sees my comments?</dt><dd>The team working on that item. Comments are posted on the item's trail.</dd>
<dt>Why is there no due date on some items?</dt><dd>For these items the team shares the next step and its planned date instead of the final due date.</dd>
<dt>An error says “Reference …”.</dt><dd>Send the reference to your contact at the team so they can look into it.</dd>
</dl>` },

{ id: "about", t: "About AXION and disclaimer", for: ["all"], b: `
<p>AXION is an internal tool used by PeopleOCity LLP, Expenova BPO Solutions and UKB IT Solutions to track action items with their own teams and the clients they work with.</p>
<ul>
<li><b>Not a commercial product.</b> AXION is not sold, licensed or offered as a product or service to anyone. Access is given by invitation, only to people working with these companies.</li>
<li><b>Internal, non-commercial use only.</b> Client logins are provided so clients can follow and comment on shared work, and track their own items, as part of the existing relationship. They are not a paid service.</li>
<li><b>Name.</b> “AXION” is an internal project name. It is not used as a trademark or trade name, and no claim is made to, or infringement intended of, any trademark, trade name or copyright belonging to others. Any similarity to other names or products is unintentional.</li>
</ul>` },

{ id: "faq", t: "Troubleshooting", for: ["internal"], b: `
<dl class="hfaq">
<dt>A field is greyed out.</dt><dd>Your access level doesn't allow changing it on this item. Contributors can change status, next step and dates on items where they're A, R or C. Ask an editor or admin for anything else.</dd>
<dt>I can't close an item.</dt><dd>Only the Accountable person can close it; others send a closure request. A main task also can't close while it has open sub-tasks.</dd>
<dt>I'm not getting reminder emails.</dt><dd>You need a login, an email in the directory and email update requests switched on, and the admin must have switched reminders on. Check your junk folder for the tracker's address.</dd>
<dt>I can't see an item someone mentioned.</dt><dd>You see only the companies and clients ticked for you, plus items you're named on. Ask an admin to widen your access or add you to the item.</dd>
<dt>An error says “Reference …”.</dt><dd>Send the reference to your admin. It points to the exact request in System status and the server logs.</dd>
<dt>The page looks out of date.</dt><dd>Changes by others appear within a few seconds. Reload the page if it still looks stale.</dd>
</dl>` },
];
