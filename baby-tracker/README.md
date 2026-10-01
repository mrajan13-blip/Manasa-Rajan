# Baby Tracker

A shared baby tracker for two parents (or more caregivers). It covers sleep, feeding, diapers and growth, with WHO growth charts.

- **Sleep**: start a live timer ("Woke up" ends it), or add a past sleep with start and end times.
- **Feeding**: breastfeeding with left/right side timers (they keep running if you close the app), or a bottle with an amount and contents (breast milk / formula / mixed).
- **Diapers**: wet, dirty, both or dry.
- **More**: pumping, medicine / temperature, solid foods, and milestones and "baby firsts".
- **Growth**: weight, length and head circumference plotted on the **WHO Child Growth Standards** for 0–36 months (3rd/15th/50th/85th/97th percentiles). Each measurement shows its percentile.
- **Sharing**: in the Family tab, tap *Invite partner* and send them the code or link. They sign up with it and join your family. Everyone in a family sees and logs for the same children. The app refreshes every 20 seconds and whenever you reopen it.
- Today dashboard (time since the last feed, diaper and sleep, plus today's totals), a day-by-day history, multiple children, lb/oz/in or kg/ml/cm, dark mode, and "Add to Home Screen" (PWA).

## Importing from Nara Baby

1. In Nara, go to the Activity screen, tap your child's avatar, then **Export Data**. You get one CSV per child.
2. Here, go to **Family → Import Nara CSV**, choose the file and the child, and tap **Preview**. It shows how many sleeps, feeds, diapers and growth entries it found, the date range, and any rows it couldn't read. Nothing is saved yet.
3. Tap **Import**.

| Nara | Imported as |
| --- | --- |
| Breastfeed | Breast feed with left/right durations and the side you ended on |
| Bottle Feed | Bottle with amount, breast milk / formula / mixed (keeping the split), and formula brand |
| Combo Feed | A breast feed and a bottle at the same time |
| Diaper | Wet / dirty / both / dry, plus stool color, texture, blowout and rash |
| Growth | Weight, length and head circumference (lb/in converted to kg/cm) |
| Sleep | Sleep with start and end |
| Pump | Pumping session with left/right (or total) volume and duration |
| Medical | Medicine and dose, and/or temperature |
| Solid Feed | Foods and meal (breakfast/lunch/dinner/snack) |
| Milestone, Baby First | Milestone or "first" with its description |

Nara volumes in fluid ounces (`FLOZ`) are converted to ml. A combo feed with no bottle amount imports as just the breastfeed.

Before importing, the preview warns if Nara's birth date or sex doesn't match the child you picked. It also shows which family member each Nara caregiver will be credited to. Names match on full name, or on first name ("Stephen Bapana" matches an account named "Stephen"). **Have your partner join before importing** so their entries are credited to them.

Each entry keeps Nara's activity id. Importing the same file again, or a newer export, only adds what's new. Entries are credited to the family member whose name matches Nara's "Created By Caregiver", or otherwise to whoever ran the import.

The column mapping follows Nara's export format (`Type`, `Start Date/time (Epoch)`, `[Bottle Feed] Volume`, …). If Nara changes the format, the preview lists the rows it couldn't read instead of importing bad data.

## Run it

Requires Node.js 22.13+ and has no npm dependencies. It uses the built-in `node:sqlite`.

```sh
cd baby-tracker
npm start          # http://localhost:3000
npm test
```

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/baby-tracker.db` | SQLite file (keep it on a persistent disk) |
| `COOKIE_SECURE` | unset | Set to `1` when served over HTTPS |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy so rate limiting uses `X-Forwarded-For` |
| `ALLOWED_EMAILS` | unset | Comma-separated emails. When set, only these addresses can ever create an account |
| `OPEN_SIGNUP` | unset | Set to `1` to let anyone sign up without an invite (not recommended) |

To share it with your spouse, the app has to run somewhere you can both reach. Any Node host with a persistent disk works (Render, Fly.io, Railway, a home server). Serve it over HTTPS and set `COOKIE_SECURE=1`.

## Privacy and security

Only people you invite can see your data:

- **Invite-only sign-up.** The first account can be created freely. After that, a new account needs a single-use invite code from an existing member (codes expire after 7 days). For a hard lock, set `ALLOWED_EMAILS=you@example.com,partner@example.com`. Then nobody else can register, even with a code.
- **Family isolation.** Every request checks that the child or entry belongs to the signed-in user's family. Other accounts get "not found".
- **Removing someone.** Family tab → Remove. They're signed out on every device immediately and lose access to all children and logs.
- **Passwords** are hashed with scrypt. Sessions are random tokens stored hashed, in `HttpOnly`, `SameSite=Lax` cookies that last 90 days. Sign-in, sign-up and invite attempts are rate-limited per IP. Writes require a JSON content type, which blocks cross-site form attacks.

What you need to do when hosting:

1. **Serve it only over HTTPS** and set `COOKIE_SECURE=1`. Most hosts (Render, Fly.io, Railway) provide HTTPS automatically.
2. **Create your account first**, right after deploying, then invite your partner. Or set `ALLOWED_EMAILS` before the first deploy so no one can get there first.
3. **Protect and back up the database file** (`DB_PATH`). It holds all the data. Use the host's encrypted persistent disk and snapshot backups, and don't commit it to git (`data/` is ignored).

Not built yet: password reset (if you forget your password, the only fix is editing the database), two-factor sign-in, and a "sign out other devices" button.

## Layout

```
server.js            entry point
lib/app.js           HTTP routes, auth, family sharing
lib/db.js            SQLite schema
lib/validate.js      event validation (sleep / feed / diaper / growth)
lib/nara.js          Nara Baby CSV export parser and mapping
public/              the web app (vanilla JS modules, no build step)
public/growth.js     LMS percentile math, shared by the browser and the tests
public/growth-data.js  WHO LMS tables (generated by scripts/extract_who_data.py)
```

## Growth data

`public/growth-data.js` holds the WHO Child Growth Standards (2006) LMS parameters for weight-for-age, length/height-for-age and head-circumference-for-age, months 0–36, for boys and girls. The values were extracted from the BSD-licensed `pygrowup` package. The CDC recommends the WHO standards for children under 2. Percentiles are computed with the standard LMS method. They are informational and are not medical advice.
