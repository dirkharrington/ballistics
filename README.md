# Ballistics Visualizer

[![CI](https://github.com/dirkharrington/ballistics/actions/workflows/ci.yml/badge.svg)](https://github.com/dirkharrington/ballistics/actions/workflows/ci.yml)

A physics-accurate external ballistics calculator and trajectory visualizer. Compare up to ten rifle cartridges side-by-side across drop, velocity, retained energy, and wind drift — out to 2,000 metres.

![Ballistics Visualizer UI](docs/screenshots/ui-overview.png)

---

## Table of Contents

- [Features](#features)
- [Physics Model](#physics-model)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Bullet Catalog](#bullet-catalog)
- [Architecture](#architecture)
- [Testing](#testing)
- [Project Structure](#project-structure)

---

## Features

| Feature | Detail |
|---|---|
| **Multi-round comparison** | Select any combination of the 10 built-in cartridges and plot them on the same axes |
| **Custom round** | Enter your own weight, muzzle velocity, G1 BC, and diameter |
| **Four charts** | Bullet drop (cm), velocity (m/s), energy (J), wind drift (cm) vs. range |
| **Data table** | Full tabular output — range, drop, velocity, energy, wind drift, time of flight |
| **CSV / PNG export** | Download the data table as CSV or any chart as a PNG |
| **Configurable conditions** | Zero range, max range, step interval, wind speed, altitude, temperature |
| **Offline capable** | Service Worker caches all assets; app loads and runs fully offline after first visit |

---

## Physics Model

The trajectory solver uses a **4th-order Runge-Kutta (RK4)** integrator at 0.5 ms timesteps, implemented in TypeScript at `app/physics/engine.ts`.

### Drag

The G1 drag function is implemented as a piecewise-linear interpolation over the 41-point Ingalls/Siacci table, covering 0–4,000 fps.

```
Cd = interpolate_G1(|v|) × ρ/BC
```

where `ρ` is the air density ratio corrected for altitude and temperature (standard ISA atmosphere model).

### Atmosphere model

```
pressureRatio = (1 − 6.876×10⁻⁶ × altFt)^5.256
tempRatio     = (459.67 + T_std_at_alt) / (459.67 + T_actual)
ρ             = pressureRatio × tempRatio
```

### Zero-angle solver

A 64-iteration bisection converges the launch angle until the bullet crosses the line-of-sight at the zero range, accounting for sight height (default 38.1 mm / 1.5 in).

### Wind drift

Uses the Pejsa time-of-flight method. Lateral drift is proportional to the difference between actual TOF and vacuum TOF at the same range, eliminating the constant-velocity approximation.

```
drift = windSpeed_fps × (TOF_actual − rangeYd × 3 / (mv × cos θ)) × 12
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (physics engine) + Vanilla JavaScript ES6 modules (UI) |
| Build tool | Vite 6 |
| Charts | Chart.js 4 (tree-shaken) |
| Fonts | Orbitron, Rajdhani, Share Tech Mono |
| Tests | Jest 29 + jsdom (100 / 100 / 100 / 100 Istanbul) |
| CI | GitHub Actions (`frontend-build` job: Jest + Vite + Trivy + CodeQL) |
| Offline | Service Worker — precaches all Vite-hashed assets on install |

---

## Getting Started

**Prerequisites:** Node.js 18+

```bash
git clone https://github.com/dirkharrington/ballistics.git
cd ballistics
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Build for production

```bash
npm run build
```

Output is written to `dist/`. Serve `dist/` from any static host (e.g. GitHub Pages, Netlify, a plain `nginx`).

### Run tests

```bash
npm test
```

---

## Bullet Catalog

The catalog lives in [`app/data/bullets.yaml`](app/data/bullets.yaml) and is the single source of truth for the physics engine. Adding a round requires no code changes.

| Round | BC (G1) | MV (m/s) | Weight (g) |
|---|---|---|---|
| .223 Rem 55gr FMJ | 0.243 | 987.6 | 3.56 |
| .243 Win 95gr BT | 0.379 | 920.0 | 6.16 |
| .270 Win 130gr AccuBond | 0.480 | 939.0 | 8.42 |
| .30-06 Spfld 150gr | 0.435 | 887.0 | 9.72 |
| .308 Win 168gr BTHP | 0.475 | 807.7 | 10.89 |
| .300 Win Mag 190gr SMK | 0.533 | 930.0 | 12.31 |
| .338 Lapua 250gr SMK | 0.587 | 905.0 | 16.20 |
| 6mm Creedmoor 108gr Hybrid | 0.536 | 885.0 | 7.00 |
| 6.5 Creedmoor 140gr ELD | 0.646 | 826.0 | 9.07 |
| 7mm Rem Mag 160gr Partition | 0.531 | 930.0 | 10.36 |

### Adding a round

Edit `app/data/bullets.yaml` and add an entry following this schema:

```yaml
- id: "my-custom-round"          # unique kebab-case identifier
  name: "My Custom Round"
  caliber: "7mm"
  bulletWeightGrams: 10.36
  muzzleVelocityMps: 900.0
  ballisticCoefficient: 0.520
  bulletDiameterMm: 7.21
  muzzleEnergyJoules: 4200.0
  description: "Description shown in the UI tooltip."
  hexColor: "#FF6B6B"            # must be quoted — # starts a YAML comment
```

Then re-run `npm run build`. The new round is bundled into the app automatically.

---

## Architecture

Ballistics Visualizer is a **pure-browser single-page application** with no server-side component.

```
ballistics/
  app/                    ← Vite root
    ├── index.html
    ├── ballistics.js     ← UI orchestration (ES6 module)
    ├── physics/
    │   └── engine.ts     ← Synchronous RK4 integrator (TypeScript)
    ├── data/
    │   └── bullets.yaml  ← Bullet catalog (bundled at build time via Vite plugin)
    └── sw.js             ← Service Worker (caches all assets for offline use)
          │
          ▼
  dist/                   ← Vite build output (static files; deploy anywhere)
```

**Build pipeline:**  
`npm run build` → Vite bundles `app/` → content-hashed JS/CSS/font assets in `dist/`.

**Physics pipeline:**  
`simulate(bullet, params)` in `engine.ts` runs synchronously on the main thread. All inputs come from the in-memory bullet catalog (bundled at build time) or from the UI form; no network requests are made at runtime.

**Offline:**  
`sw.js` intercepts all fetches. After the first full page load every asset is cached; subsequent visits — including with the network offline — load instantly from the Service Worker cache.

---

## Testing

```bash
npm test
```

### Coverage thresholds (Jest / Istanbul)

All four gates are enforced in every CI run — a failure blocks the build.

| Metric | Threshold |
|---|---|
| Statements | 100 % |
| Branches | 100 % |
| Functions | 100 % |
| Lines | 100 % |

### Test suites

| File | What it covers |
|---|---|
| `tests/physics-engine.test.js` | RK4 physics, zero-angle accuracy, G1 table boundary values, atmosphere model |
| `tests/ballistics.test.js` | UI orchestration, chart rendering, form state, CSV/PNG export |
| `tests/sw.test.js` | Service Worker install, fetch intercept, cache strategies |
| `tests/tools.test.js` | Unit utilities |
| `tests/url-state.test.js` | URL-encoded state round-trips |
| `tests/custom-rounds.test.js` | Custom-round persistence and validation |
| `tests/drag-csv.test.js` | CSV drag-and-drop custom drag table parsing |
| `tests/e2e/app.e2e.test.js` | Puppeteer end-to-end smoke tests |

---

## Project Structure

```
ballistics/
├── vite.config.js                     # Vite config + virtual:bullet-catalog plugin
├── package.json                       # JS deps, Jest config, npm scripts
├── tsconfig.json                      # TypeScript config (physics engine)
│
├── app/                               # Application source (Vite root)
│   ├── index.html
│   ├── ballistics.js                  # ES6 module — UI, physics calls, charts
│   ├── ballistics.css
│   ├── sw.js                          # Service worker (offline / asset caching)
│   ├── tools.js
│   ├── url-state.js
│   ├── custom-rounds.js
│   ├── drag-csv.js
│   ├── fonts/                         # Orbitron, Rajdhani, Share Tech Mono woff2
│   ├── physics/
│   │   ├── engine.ts                  # RK4 integrator + G1/G7 drag + atmosphere
│   │   └── types.ts
│   ├── data/
│   │   ├── bullets.yaml               # Canonical bullet catalog (bundled at build time)
│   │   └── physics-tables.yaml        # G1/G7 drag tables + atmosphere constants
│   └── public/                        # Copied to dist/ root verbatim
│       ├── apple-touch-icon.png
│       ├── favicon.svg
│       └── manifest.json
│
├── tests/                             # Jest unit test suite
│   ├── ballistics.test.js
│   ├── physics-engine.test.js
│   ├── sw.test.js
│   ├── tools.test.js
│   ├── url-state.test.js
│   ├── custom-rounds.test.js
│   ├── drag-csv.test.js
│   ├── e2e/
│   │   └── app.e2e.test.js            # Puppeteer end-to-end tests
│   ├── fixtures/
│   │   └── spa1-golden.json
│   └── __mocks__/
│       ├── bullet-catalog.js          # Jest mock for virtual:bullet-catalog
│       └── chart.js                   # Jest mock for Chart.js
│
├── contracts/                         # Architecture Decision Records + design docs
│
└── dist/                              # Vite build output (gitignored; deployed by CI)
```
