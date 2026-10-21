# qp-crew

Live: **https://jaykk99.github.io/qp-crew/**

Crew tracker for **Quonset Place**: add quoters and workers, create jobs, move jobs through a 6-stage status pipeline (assigned, in progress, done, customer confirmed, payable, paid). Workers build at $25/hr and nobody gets paid until the customer confirms.

## Features

- **Schedule tab**: weekly shift planner per crew member with overlap warnings and week totals
- **Time logging**: clock in/out on build jobs; hours and pay auto-computed from logged time
- **Crew profiles**: per-person stats (jobs, logged hours, awaiting pay, paid out, upcoming shifts)
- **Jobs**: search, status filter, sorting by date/customer, quote-to-build conversion, duplication, overdue warnings
- **Dashboard**: pipeline counts, owed/paid totals, 14-day payout chart, upcoming shifts, crew hours leaderboard, activity log
- **Job costs**: per-job customer price, material expenses, and profit-margin math (price minus labor minus materials) with a margins card on the dashboard
- **Overtime**: configurable OT rule (off / after 8h per day / after 40h per week) computed from clock-in logs and split across jobs; OT hours/pay shown on crew profiles
- **Invoices**: print-friendly per-job invoice (labor lines, materials, total due, payment status)
- **Job photos**: attach site photos (downscaled, device storage only)
- **Crew search**: name/phone search plus role filter on the crew list
- **Data check**: integrity report on the backup card (orphan refs, negative money, duplicate ids)
- **Data backup**: export/import JSON, erase-all, print-friendly job sheets

## Stack

Single static `index.html` with inline CSS/JS. All data lives in the browser's `localStorage` (key `qp_crew_v1`); nothing is sent to any server.

## Run it

Open `index.html` in a browser.

Deployed via GitHub Pages on pushes to `master`.
