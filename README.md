# Mammaw's Notes

A gentle, private journal for visits with an elderly loved one, plus (coming in Part 2) a few simple screens to show them during a visit.

This repo holds **only the app code**. It holds no names, notes, songs, or photos. Everything personal is typed into the app by the person using it and stays in that device's own storage (IndexedDB). A fresh copy opens empty, so any family can use it.

## What's here

| File | What it does |
|---|---|
| `index.html` | The page |
| `app.js` | The app: people, the four kinds of notes, timeline, search, backup |
| `db.js` | On-device storage (IndexedDB) |
| `styles.css` | The look |
| `sw.js` | Lets the app open with no internet once it has loaded |
| `manifest.webmanifest`, `icons/` | Lets it be added to an iPhone Home Screen like an app |
| `tests/` | Browser tests with made-up people only. The app never loads these. |

## Part 1: the journal (built)

- People: add more than one, each with a name, what you call them, a photo, a playlist link, and a song list. Each person's notes are separate.
- Four kinds of notes: Visits, Songs, Things they said (stored exactly as typed, never corrected), Photos (with a "Show in Photo Book" switch).
- One timeline per person, newest first, with filters and search.
- Edit anything. Deleting asks first and offers Undo.
- Backup: save one person to one file (photos included) and open it on another device. This is also how notes move between phone and computer. Opening a backup never touches anyone else; if the person is already there, it asks whether to replace or keep both.
- Photos are shrunk to JPEG, at most 1600 px on the long side, before they're stored.

## Part 2: caregiver screens (not built yet)

Who's Here cards, Photo Book, one-button music. Waits for approval of Part 1.

## Running the tests

Needs Google Chrome and Node.

```
cd tests
npm install
npm test
```

`npm run icons` redraws the PNG icons from `icons/icon.svg`.

## Releasing a change

When any app file changes, raise the number in `CACHE` at the top of `sw.js` (for example `mammaws-notes-v2`). That tells phones to pick up the new copy.
