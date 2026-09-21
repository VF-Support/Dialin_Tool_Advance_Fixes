# DIC Ops — Training & Case Board (plain website)

A plain HTML/CSS/JS website — no Node, no npm, no build step. Open it and it
works.

## Opening it

**Just double-click `index.html`.** It'll open in your browser and everything
works: guides, editing, images, and the pending case board (in local mode,
saved to that browser only, until Firestore is turned on — see below).

If double-clicking ever behaves oddly in your browser (some browsers restrict
things when opened via `file://`), the fix is to serve the folder instead of
opening the file directly — still no build step, just a plain file server:

- **Easiest:** install the free "Web Server for Chrome" extension, or in VS
  Code use the "Live Server" extension, point it at this folder, and open the
  URL it gives you.
- **Command line (if you have Python):** `cd` into this folder and run
  `python3 -m http.server 8000`, then open `http://localhost:8000`.

## Putting it on a real URL for your team

Upload the whole folder as-is to any static host — Firebase Hosting, Netlify,
GitHub Pages, a company web server, etc. There's nothing to build; it's just
files. For Firebase Hosting specifically:

```
npm install -g firebase-tools
firebase login
firebase init hosting     # point the public directory at this folder
firebase deploy
```

## What's inside

- **All Guides** — all 24 procedures from the training workbook (Log Pull
  Steps, JIRA Ticket Creation, Malformed Batch, XPI Patch, C18 Reload, etc.),
  grouped by category in the sidebar, each with its original screenshots
  embedded directly in the page (no separate image files to lose or block).
- **DIC Completion Rate** — a training progress matrix: one row per
  procedure, one column per agent, click any cell to mark it done or not
  yet. Each agent's column shows a live percentage and progress bar, plus an
  overall team-readiness number at the top. Add new agents as people join,
  add new tasks as new procedures roll out, rename or remove either one.
  Seeded with the team's existing progress from the training workbook.
- **New Guide** — write a brand-new procedure from scratch (title, category,
  steps, screenshots) using the same editor as everything else. It shows up
  in the sidebar and search right alongside the workbook guides, and can be
  deleted entirely if you don't need it anymore (workbook guides can only be
  reset to original, not deleted, since they came from the training file).
- **Edit button** on every guide — rewrite any line, mark lines as
  commands/code (monospace styling), reorder or delete lines, replace or add
  screenshots, and reset back to the original workbook content at any time.
  Edits save to your browser automatically (`localStorage`).
- **Pending Case Board** (the "Pending Case Board" link in the sidebar) — log
  a case with its type (Log Pull, DF, Patch, Malformed Batch, 0 Byte
  BatchClose/Config, JIRA Ticket, or a custom type), case number, callback
  info, site name, and status. A green banner tells the team when there's
  nothing pending. Filter by status, case type, date (today / last 7 days /
  a specific day / all time), or search. Every time someone marks a case
  Pending or Done, they're asked to enter their name first, so there's always
  a record of who touched it and when (see "N updates" on each case).

## Firebase (shared, synced case tracking)

Your Firebase project is already wired up in `firebase-config.js` (project:
`dialin-tool`). Two things to check in the
[Firebase console](https://console.firebase.google.com/project/dialin-tool):

1. **Create a Firestore Database** (this app uses Cloud Firestore, not the
   Realtime Database that got set up by default). Go to
   **Build → Firestore Database → Create database**.
2. **Set security rules** so your team can read/write cases (Firestore →
   Rules tab):

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /dicCases/{caseId} {
         allow read, write: if true; // tighten this once you add sign-in
       }
     }
   }
   ```

Once that's done, every visitor's case updates sync live through Firestore —
no code changes needed. The header shows "Synced via Firebase" when it's
working, or "Local mode" if it can't reach Firebase (e.g. no internet, or the
CDN script got blocked) — in that case, it just quietly keeps working with
that browser's local storage instead.

Guide *content edits* stay local to each person's browser on purpose, since
usually only one or two admins maintain the guides. If you'd like those
synced through Firebase too, that's a small follow-up — just ask.

## File structure

```
index.html            page shell — loads all the scripts below
styles.css            all styling (dark "ops console" theme)
data.js               guide content, with every screenshot embedded
                       directly in the file (as base64) so there's no
                       separate images folder that can go missing
firebase-config.js    your Firebase project keys
guide-service.js      guide read/write (localStorage-backed)
case-service.js       case board read/write (Firestore or localStorage)
completion-service.js training completion matrix (localStorage-backed)
icons.js              small inline icon set (no external icon library)
app.js                all page logic and rendering
```

## Troubleshooting

**Images not showing up?** They shouldn't be able to go missing anymore —
every screenshot is embedded directly inside `data.js` as part of the page
itself, not a separate file. If you still see broken images, open the
browser's dev tools (F12) → Console tab, and check for red errors; that
usually points at what's actually wrong (e.g. `data.js` didn't fully
download/extract, or got corrupted/truncated).

**Page loads blank?** Make sure you're opening `index.html` from a folder you
fully extracted the zip into — not from inside the zip itself, and not from
a Windows temp folder that just previews the archive contents.
