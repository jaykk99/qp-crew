# qp-crew

Live: **https://jaykk99.github.io/qp-crew/**

Crew tracker for **Quonset Place**: add quoters and workers, create jobs, move jobs through a 6-stage status pipeline (assigned, in progress, done, customer confirmed, payable, paid). Workers build at $25/hr and nobody gets paid until the customer confirms.

## Features

- **Schedule tab**: weekly shift planner per crew member with overlap warnings and week totals
- **Time logging**: clock in/out on build jobs; hours and pay auto-computed from logged time
- **Crew profiles**: per-person stats (jobs, logged hours, awaiting pay, paid out, upcoming shifts)
- **Jobs**: search, status filter, sorting by date/customer
- **Dashboard**: pipeline counts, owed/paid totals, 14-day payout chart, upcoming shifts
- **Data backup**: export/import JSON, erase-all, print-friendly job sheets

## Stack

Single static `index.html` with inline CSS/JS. All data lives in the browser's `localStorage` (key `qp_crew_v1`); nothing is sent to any server.

## Run it

Open `index.html` in a browser.

Deployed via GitHub Pages on pushes to `master`.
