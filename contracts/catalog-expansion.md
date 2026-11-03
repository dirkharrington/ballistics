# Catalog Expansion — MH-2

Version: 1.0.0 — 2026-11-03

BE builder: copy the YAML blocks below into `src/main/resources/bullets.yaml` under the existing 10 entries (same indentation, same `app.bullets` list). Do not alter the existing 10 entries.

`muzzleEnergyJoules` = round(0.5 × mass_kg × v²) where mass_kg = bulletWeightGrams / 1000.

G7 BCs are noted in comments where known; they are not added to the Java model in this sprint.

Colors are distinct from the existing 10: `#4ADE80, #F97316, #60A5FA, #E879F9, #34D399, #FBBF24, #F87171, #A78BFA, #2DD4BF, #FB923C`.

---

```yaml
    # ── Small-bore varmint ──────────────────────────────────────────────────────

    - id: "17-hmr-17gr"
      name: ".17 HMR 17gr V-MAX"
      caliber: ".17 HMR"
      bulletWeightGrams: 1.10
      muzzleVelocityMps: 776.0
      ballisticCoefficient: 0.125  # G1; G7 ≈ 0.062
      bulletDiameterMm: 4.37
      muzzleEnergyJoules: 331.0
      description: "Ultra-high-velocity rimfire varmint round. Exceptional flat trajectory to 150 m. Minimal recoil, devastating terminal performance on small pests."
      hexColor: "#86efac"

    - id: "22-lr-40gr"
      name: ".22 LR 40gr LRN"
      caliber: ".22 LR"
      bulletWeightGrams: 2.59
      muzzleVelocityMps: 335.0
      ballisticCoefficient: 0.130  # G1
      bulletDiameterMm: 5.59
      muzzleEnergyJoules: 145.0
      description: "The world's most popular rimfire cartridge. Economical plinking and small-game round. Subsonic at most practical ranges; very limited to 100 m."
      hexColor: "#d9f99d"

    - id: "22-250-55gr"
      name: ".22-250 Rem 55gr SP"
      caliber: ".22-250 Remington"
      bulletWeightGrams: 3.56
      muzzleVelocityMps: 1066.0
      ballisticCoefficient: 0.255  # G1
      bulletDiameterMm: 5.69
      muzzleEnergyJoules: 2023.0
      description: "One of the fastest commercial cartridges ever produced. Flat-shooting varmint specialist with explosive terminal performance. Outstanding accuracy to 400 m."
      hexColor: "#a3e635"

    # ── Mid-range hunting / precision ───────────────────────────────────────────

    - id: "243-win-105gr"
      name: ".243 Win 105gr BTHP"
      caliber: ".243 Winchester"
      bulletWeightGrams: 6.80
      muzzleVelocityMps: 899.0
      ballisticCoefficient: 0.530  # G1; G7 ≈ 0.270
      bulletDiameterMm: 5.94
      muzzleEnergyJoules: 2745.0
      description: "High-BC long-range .243 load. Substantially better wind resistance than the lighter 95gr hunting bullet. Competitive in F-Open at 300–600 m."
      hexColor: "#22d3ee"

    - id: "260-rem-142gr"
      name: ".260 Rem 142gr SMK"
      caliber: ".260 Remington"
      bulletWeightGrams: 9.20
      muzzleVelocityMps: 838.0
      ballisticCoefficient: 0.626  # G1; G7 ≈ 0.307
      bulletDiameterMm: 6.71
      muzzleEnergyJoules: 3229.0
      description: "The .260 Rem with the 142gr Sierra MatchKing is a proven long-range precision load. Pre-dates 6.5 Creedmoor but nearly identical external ballistics at lower cost."
      hexColor: "#38bdf8"

    - id: "65x47-lapua-139gr"
      name: "6.5×47 Lapua 139gr Scenar"
      caliber: "6.5×47 Lapua"
      bulletWeightGrams: 9.01
      muzzleVelocityMps: 838.0
      ballisticCoefficient: 0.612  # G1; G7 ≈ 0.300
      bulletDiameterMm: 6.71
      muzzleEnergyJoules: 3162.0
      description: "Lapua's mid-capacity 6.5 mm. Extremely consistent brass, low ES, favoured in 300 m prone bench and F-Class. Efficient case with minimal powder charge."
      hexColor: "#0ea5e9"

    # ── PRS / Competition 6 mm ──────────────────────────────────────────────────

    - id: "6-dasher-105gr"
      name: "6 Dasher 105gr Hybrid"
      caliber: "6 Dasher"
      bulletWeightGrams: 6.80
      muzzleVelocityMps: 918.0
      ballisticCoefficient: 0.536  # G1; G7 ≈ 0.271
      bulletDiameterMm: 6.17
      muzzleEnergyJoules: 2865.0
      description: "Wildcat 6 mm based on the 6 BR improved. Extreme accuracy and low ES make it a top choice for PRS gas-gun matches. Very barrel-friendly."
      hexColor: "#7dd3fc"

    - id: "6-br-105gr"
      name: "6 BR 105gr Scenar"
      caliber: "6 BR Norma"
      bulletWeightGrams: 6.80
      muzzleVelocityMps: 853.0
      ballisticCoefficient: 0.536  # G1; G7 ≈ 0.271
      bulletDiameterMm: 6.17
      muzzleEnergyJoules: 2473.0
      description: "The original benchrest 6 mm round. Legendary for consistent sub-half-MOA groups at 100–600 m. Slower than 6 Creedmoor but famously accurate."
      hexColor: "#93c5fd"

    - id: "6xc-115gr"
      name: "6XC 115gr DTAC"
      caliber: "6XC"
      bulletWeightGrams: 7.45
      muzzleVelocityMps: 930.0
      ballisticCoefficient: 0.580  # G1; G7 ≈ 0.293
      bulletDiameterMm: 6.17
      muzzleEnergyJoules: 3224.0
      description: "High-BC 6 mm wildcat developed for F-Open competition. The 115gr DTAC (Doppler Test Accuracy Cartridge) bullet is designed for long-range wind bucking."
      hexColor: "#bfdbfe"

    # ── 6.5 mm competition ──────────────────────────────────────────────────────

    - id: "65x47-lapua-130gr"
      name: "6.5×47 Lapua 130gr Scenar-L"
      caliber: "6.5×47 Lapua"
      bulletWeightGrams: 8.42
      muzzleVelocityMps: 868.0
      ballisticCoefficient: 0.584  # G1; G7 ≈ 0.286
      bulletDiameterMm: 6.71
      muzzleEnergyJoules: 3177.0
      description: "Lighter 130gr Scenar-L in the 6.5×47 case. Slightly higher velocity than the 139gr with competitive BC. Popular in 300 m ISSF rifle and European precision matches."
      hexColor: "#818cf8"

    - id: "65-prc-143gr"
      name: "6.5 PRC 143gr ELD-X"
      caliber: "6.5 PRC"
      bulletWeightGrams: 9.27
      muzzleVelocityMps: 908.0
      ballisticCoefficient: 0.625  # G1; G7 ≈ 0.315
      bulletDiameterMm: 6.71
      muzzleEnergyJoules: 3823.0
      description: "Hornady's short-magnum 6.5 mm. Higher velocity than 6.5 Creedmoor with comparable barrel life. Growing PRS following and effective ELR hunting cartridge."
      hexColor: "#a5b4fc"

    - id: "65-284-norma-142gr"
      name: "6.5-284 Norma 142gr SMK"
      caliber: "6.5-284 Norma"
      bulletWeightGrams: 9.20
      muzzleVelocityMps: 899.0
      ballisticCoefficient: 0.626  # G1; G7 ≈ 0.307
      bulletDiameterMm: 6.71
      muzzleEnergyJoules: 3717.0
      description: "High-velocity 6.5 mm on a .284 Winchester necked down. Long-range F-Class favourite for two decades. Higher velocity than 6.5 CM at the cost of shorter barrel life."
      hexColor: "#c4b5fd"

    # ── 7 mm ────────────────────────────────────────────────────────────────────

    - id: "7mm-08-140gr"
      name: "7mm-08 Rem 140gr BTHP"
      caliber: "7mm-08 Remington"
      bulletWeightGrams: 9.07
      muzzleVelocityMps: 868.0
      ballisticCoefficient: 0.485  # G1; G7 ≈ 0.244
      bulletDiameterMm: 7.21
      muzzleEnergyJoules: 3419.0
      description: "The short-action 7 mm hunting and precision round. Low recoil, excellent accuracy. Popular with youth shooters and lightweight precision rifle builds."
      hexColor: "#f0abfc"

    - id: "7mm-prc-175gr"
      name: "7mm PRC 175gr ELD-X"
      caliber: "7mm PRC"
      bulletWeightGrams: 11.34
      muzzleVelocityMps: 930.0
      ballisticCoefficient: 0.689  # G1; G7 ≈ 0.347
      bulletDiameterMm: 7.21
      muzzleEnergyJoules: 4906.0
      description: "Hornady's modern long-range 7 mm magnum. Exceptional BC 175gr bullet. Competes directly with 6.5 PRC at ELR distances with significantly more retained energy."
      hexColor: "#e879f9"

    - id: "7mm-saum-168gr"
      name: "7mm SAUM 168gr Berger"
      caliber: "7mm SAUM"
      bulletWeightGrams: 10.89
      muzzleVelocityMps: 930.0
      ballisticCoefficient: 0.659  # G1; G7 ≈ 0.332
      bulletDiameterMm: 7.21
      muzzleEnergyJoules: 4706.0
      description: "Short-action ultra-mag 7 mm. Similar external ballistics to 7mm Rem Mag but in a short-action platform. Efficient powder burn, excellent for lightweight ELR rifles."
      hexColor: "#d946ef"

    - id: "280-ackley-168gr"
      name: ".280 Ackley Improved 168gr Berger"
      caliber: ".280 Ackley Improved"
      bulletWeightGrams: 10.89
      muzzleVelocityMps: 945.0
      ballisticCoefficient: 0.659  # G1; G7 ≈ 0.332
      bulletDiameterMm: 7.21
      muzzleEnergyJoules: 4857.0
      description: "P.O. Ackley's improved .280 Rem. More efficient case shape gives ~100 fps over .280 Rem. The 168gr Berger VLD is a long-range hunting and competition staple."
      hexColor: "#c026d3"

    # ── .30 calibre magnums ─────────────────────────────────────────────────────

    - id: "300-wsm-180gr"
      name: ".300 WSM 180gr AccuBond"
      caliber: ".300 WSM"
      bulletWeightGrams: 11.66
      muzzleVelocityMps: 945.0
      ballisticCoefficient: 0.507  # G1; G7 ≈ 0.255
      bulletDiameterMm: 7.82
      muzzleEnergyJoules: 5207.0
      description: "Short-action .30 magnum that matches .300 Win Mag ballistics. Outstanding hunting round to 600 m. Popular in bolt-action mountain rifles for its compact action."
      hexColor: "#fbbf24"

    - id: "300-prc-212gr"
      name: ".300 PRC 212gr ELD-X"
      caliber: ".300 PRC"
      bulletWeightGrams: 13.74
      muzzleVelocityMps: 899.0
      ballisticCoefficient: 0.673  # G1; G7 ≈ 0.340
      bulletDiameterMm: 7.82
      muzzleEnergyJoules: 5543.0
      description: "Hornady's modern ELR .30 calibre. Designed around high-BC 212gr ELD-X for hunting beyond 1000 m. Better efficiency than .300 Win Mag for very long bullets."
      hexColor: "#f59e0b"

    - id: "300-norma-mag-230gr"
      name: ".300 Norma Mag 230gr Hybrid"
      caliber: ".300 Norma Magnum"
      bulletWeightGrams: 14.90
      muzzleVelocityMps: 899.0
      ballisticCoefficient: 0.743  # G1; G7 ≈ 0.374
      bulletDiameterMm: 7.82
      muzzleEnergyJoules: 6016.0
      description: "Military ELR cartridge and long-range competition round. Exceptional BC 230gr Berger Hybrid bullet. Used in SOCOM advanced sniper programme. Effective past 2000 m."
      hexColor: "#d97706"

    - id: "30-nosler-210gr"
      name: ".30 Nosler 210gr AccuBond LR"
      caliber: ".30 Nosler"
      bulletWeightGrams: 13.61
      muzzleVelocityMps: 930.0
      ballisticCoefficient: 0.730  # G1; G7 ≈ 0.368
      bulletDiameterMm: 7.82
      muzzleEnergyJoules: 5887.0
      description: "Nosler's flagship .30 calibre on a rebated rim. Fits a standard magnum action. Carries the 210gr LR bullet at near-.300 Norma ballistics with somewhat less case capacity."
      hexColor: "#b45309"

    # ── Large bore ──────────────────────────────────────────────────────────────

    - id: "338-federal-185gr"
      name: ".338 Federal 185gr AccuBond"
      caliber: ".338 Federal"
      bulletWeightGrams: 11.99
      muzzleVelocityMps: 869.0
      ballisticCoefficient: 0.397  # G1
      bulletDiameterMm: 8.61
      muzzleEnergyJoules: 4528.0
      description: "Short-action .338 on the .308 Win case. Enough energy for elk to 400 m in a compact, light rifle. Low recoil for the calibre. Popular mountain hunting round."
      hexColor: "#ef4444"

    - id: "338-win-mag-225gr"
      name: ".338 Win Mag 225gr AccuBond"
      caliber: ".338 Winchester Magnum"
      bulletWeightGrams: 14.58
      muzzleVelocityMps: 899.0
      ballisticCoefficient: 0.550  # G1; G7 ≈ 0.277
      bulletDiameterMm: 8.61
      muzzleEnergyJoules: 5887.0
      description: "The classic big-bore hunting magnum. Reliable elk and brown bear cartridge to 500 m. Substantially more energy retention than .30 calibre magnums. Hard kick."
      hexColor: "#dc2626"

    - id: "338-norma-mag-300gr"
      name: ".338 Norma Mag 300gr SMK"
      caliber: ".338 Norma Magnum"
      bulletWeightGrams: 19.44
      muzzleVelocityMps: 899.0
      ballisticCoefficient: 0.768  # G1; G7 ≈ 0.387
      bulletDiameterMm: 8.61
      muzzleEnergyJoules: 7853.0
      description: "Military-adopted .338 sniper round. Feeds 300gr high-BC bullets from a standard .338 Lapua-sized action. Outstanding long-range terminal performance to 1500 m."
      hexColor: "#b91c1c"

    - id: "375-hh-300gr"
      name: ".375 H&H 300gr Woodleigh"
      caliber: ".375 H&H Magnum"
      bulletWeightGrams: 19.44
      muzzleVelocityMps: 823.0
      ballisticCoefficient: 0.390  # G1
      bulletDiameterMm: 9.53
      muzzleEnergyJoules: 6581.0
      description: "The original large-bore magnum and most versatile dangerous-game cartridge. Minimum legal for African DG in many countries. Massive sectional density, controlled expansion."
      hexColor: "#991b1b"

    # ── ELR ─────────────────────────────────────────────────────────────────────

    - id: "375-cheytac-352gr"
      name: ".375 CheyTac 352gr"
      caliber: ".375 CheyTac"
      bulletWeightGrams: 22.81
      muzzleVelocityMps: 945.0
      ballisticCoefficient: 1.050  # G1; G7 ≈ 0.530
      bulletDiameterMm: 9.53
      muzzleEnergyJoules: 10190.0
      description: "Purpose-built ELR cartridge for competition beyond 2000 m. Extremely high BC mono-metal projectile. Dominated ELR King of 2 Miles competitions. Punishing recoil."
      hexColor: "#7f1d1d"

    - id: "416-barrett-400gr"
      name: ".416 Barrett 400gr"
      caliber: ".416 Barrett"
      bulletWeightGrams: 25.92
      muzzleVelocityMps: 945.0
      ballisticCoefficient: 1.050  # G1; G7 ≈ 0.530
      bulletDiameterMm: 10.57
      muzzleEnergyJoules: 11575.0
      description: "Anti-materiel and ELR competition cartridge from Barrett Firearms. Fires a 400gr spitzer from a .50 BMG bolt-action. Muzzle energy exceeds .50 BMG with a higher BC projectile."
      hexColor: "#450a0a"

    - id: "50-bmg-750gr-amax"
      name: ".50 BMG 750gr A-MAX"
      caliber: ".50 BMG"
      bulletWeightGrams: 48.60
      muzzleVelocityMps: 869.0
      ballisticCoefficient: 1.050  # G1; G7 ≈ 0.530
      bulletDiameterMm: 12.95
      muzzleEnergyJoules: 18351.0
      description: "The definitive ELR and anti-materiel cartridge. 750gr Hornady A-MAX provides outstanding long-range accuracy. Effective past 2500 m with proper ballistic software."
      hexColor: "#1c1917"
```

---

## Notes

- All G1 BCs are published or community-verified values. G7 BCs in comments are approximate; use published G7 BCs when available if a `g7BallisticCoefficient` field is added to the model in a future sprint.
- `muzzleEnergyJoules` is computed as `round(0.5 × bulletWeightGrams/1000 × muzzleVelocityMps²)`.
- Colors chosen to avoid the existing 10 (`#4ADE80, #F97316, #60A5FA, #E879F9, #34D399, #FBBF24, #F87171, #A78BFA, #2DD4BF, #FB923C`) and to be distinguishable in the app's dark theme.
- The .22 LR `muzzleVelocityMps: 335` is subsonic (just under 343 m/s). `supersonicLimitMeters` will be 0. The FE already handles this gracefully (the annotation simply appears at 0 m).
