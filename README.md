# PokeWheel

Stream-friendly raffle wheel with a two-stage draw flow:
1. Weighted energy spin (so every entrant has equal overall odds).
2. Pause on selected energy + pool size.
3. Transition into the name spin for that pool.

Built as a dependency-free static app and optimized for large pools (50,000+ entrants; default cap is 200,000).

## Run

### Desktop app (recommended)

This project now includes an Electron wrapper so it can run as a native desktop app on Windows/Mac.

```bash
cd /path/to/PokeWheel
npm install
npm start
```

To package installers:

```bash
npm run dist
```

Windows-only quick commands:

```bash
npm run dist:win           # NSIS installer (.exe) on Windows
npm run dist:win-portable  # Portable Windows .exe
npm run share:zip          # Zip web bundle (macOS/Linux), for manual file-sharing
```

- Windows installer: produces `dist/*.exe`
- macOS: produces `dist/*.dmg`

### Browser

Open `index.html` from the repository root in any modern browser.

If your browser blocks local script execution from `file://`, run a local server instead:

```bash
cd /path/to/PokeWheel
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Usage

1. Paste usernames (one per line) into the entry box.
2. Click `Load Entrants`.
3. Click `Spin Two-Stage Draw` to run the raffle.
4. Optionally export winners as CSV.

## Notes

- Exact duplicate lines are removed automatically before loading.
- Winners are removed automatically after each draw (no repeat winners).
- Energy assignment is balanced by design.
  - If entrant count is divisible by the number of energies, buckets are exactly equal.
  - Otherwise, bucket sizes differ by at most 1.
- The stage uses a single wheel that transitions between energy and name modes.
- Optional custom art slots:
  - Top-right of wheel: `assets/art-top-right.png`

## License

Copyright © 2026 Shane Copenhagen. All Rights Reserved.
