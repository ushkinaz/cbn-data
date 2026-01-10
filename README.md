# C:BN DATA VAULT — WASTELAND DATA TERMINAL v2.42

```
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

  SYSTEM ONLINE // ACCESS PENDING // UPLINK ESTABLISHED

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ ROOT@BUNKER:~/DATA/CBN                                                       [●][●][●] ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃                                                                                        ┃
┃  > Initializing data vault access                                                 [OK] ┃
┃  > Decrypting asset manifest                                                    [FAIL] ┃
┃  > Retrying with backup protocol                                                  [OK] ┃
┃                                                                                        ┃
┃        ██╗    ██╗ █████╗ ███████╗████████╗███████╗██╗       █████╗ ███╗   ██╗██████╗   ┃
┃        ██║    ██║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██║      ██╔══██╗████╗  ██║██╔══██╗  ┃
┃        ██║ █╗ ██║███████║███████╗   ██║   █████╗  ██║      ███████║██╔██╗ ██║██║  ██║  ┃
┃        ██║███╗██║██╔══██║╚════██║   ██║   ██╔══╝  ██║      ██╔══██║██║╚██╗██║██║  ██║  ┃
┃        ╚███╔███╔╝██║  ██║███████║   ██║   ███████╗███████╗ ██║  ██║██║ ╚████║██████╔╝  ┃
┃         ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚══════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝   ┃
┃                                                                                        ┃
┃                             D A T A   T E R M I N A L                                  ┃
┃                                                                                        ┃
┃  CLASSIFIED ACCESS: Complete Cataclysm: Bright Nights data mirror. JSON game objects,  ┃
┃  translation files, GFX assets, and build metadata. Optimized for bandwidth-starved    ┃
┃  survivors with Brotli compression and WebP graphics. No towels required, recommended. ┃
┃                                                                                        ┃
┃  [STATUS] ● ONLINE  ● SECURE  ● HOT                                                    ┃
┃                                                                                        ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
```

---

## // SYSTEM STATUS //

### ▼ MIRROR STATE

| **Parameter** | **Value**      | **Status** |
| ------------- | -------------- | ---------- |
| Data Sync     | Every 12 hours | ◉          |
| Compression   | Brotli         | ◉          |
| Uptime        | 99.9% stable   | ◉          |

### ▼ ASSET VAULT

| **Parameter** | **Value**        | **Status** |
| ------------- | ---------------- | ---------- |
| Graphics      | WebP optimized   | ◉          |
| Translations  | Multi-lang ready | ◉          |
| Builds        | 450-day history  | ◉          |

---

---

## // SURVIVOR PROTOCOL //

```
╔════════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                        ║
║  ⚠ WARNING ⚠                                                                           ║
║                                                                                        ║
║  Always start with /builds.json to get available dates, then navigate to /data/DATE/   ║
║  for your target build.                                                                ║
║                                                                                        ║
║  Check the guide at https://cbn-guide.pages.dev/ for integration examples.             ║
║                                                                                        ║
╚════════════════════════════════════════════════════════════════════════════════════════╝
```

## // DATA ENDPOINTS //

### █ BUILD INDEX

**Master manifest with metadata for every build snapshot. Your starting point for temporal navigation.**

```
/builds.json
```

### █ GAME OBJECTS

**Complete game database: items, monsters, vehicles, recipes. Everything the wasteland knows.**

```
/data/{RELEASE}/all.json
```

### █ MOD CATALOG

**Full mod repository with metadata. No scavenging required, just direct access.**

```
/data/{RELEASE}/all_mods.json
```

### █ TRANSLATIONS

**Localized strings for international survivors. Multi-language wasteland support.**

```
/data/{RELEASE}/lang/fr.json
```

### █ GFX ASSETS

**WebP-compressed tilesets and sprites. Bandwidth optimized for slow uplinks.**

```
/data/{RELEASE}/gfx/
```

### █ COMPRESSION

**All JSON files are Brotli-compressed. Saves ~90% bandwidth. Cloudflare handles delivery.**

```
Content-Encoding: br
```

---

## // TERMINAL COMMANDS //

### ▼ QUICKSTART EXAMPLES

```bash
# Fetch build index
curl -s https://cbn-data.pages.dev/builds.json | jq '.[]'

# Download complete game data
curl -s https://cbn-data.pages.dev/data/{RELEASE}/all.json -o all.json

# Get Chinese translations with pinyin
curl -s https://cbn-data.pages.dev/data/{RELEASE}/lang/zh_CN_pinyin.json -o zh_CN_pinyin.json

# List available builds
curl -s https://cbn-data.pages.dev/builds.json | jq '.[].build_number'
```

---

## // FREQUENTLY ASKED //

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ▼ IS THIS SAFE?                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│ Data pulled directly from official Cataclysm: Bright Nights releases. No zombies,      │
│ just bytes. Cloudflare Pages hosting ensures high availability.                        │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ▼ WHY SO MANY FILES?                                                                   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│ Historical builds preserved for modding, debugging, and temporal archaeology.          │
│ Retention policy prunes ancient snapshots automatically.                               │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ▼ CAN I CACHE THIS?                                                                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│ Yes. Cache aggressively. Headers already set for optimal CDN behavior. Treat it        │
│ like canned goods—store and forget.                                                    │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ▼ COMPRESSION DETAILS?                                                                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│ All JSON files served Brotli-compressed via Cloudflare headers. ~90% size reduction.   │
│ No client-side decompression needed.                                                   │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## // CURRENT SPONSORS //

```
╔══════════════════════════════════════════╗  ╔══════════════════════════════════════════╗
║ █ ARTHUR DENT                            ║  ║ █ FORD PREFECT                           ║
║ Reluctant Survivor                       ║  ║ Bored Expert                             ║
╠══════════════════════════════════════════╣  ╠══════════════════════════════════════════╣
║                                          ║  ║                                          ║
║ Lost in nested containers. Keeps         ║  ║ Suffers from static spawn fatigue.       ║
║ losing aspirin inside three layers       ║  ║ Craves exotic NPCs and a sub-ether       ║
║ of plastic bags.                         ║  ║ network.                                 ║
║                                          ║  ║                                          ║
║ Morale: Leaping                          ║  ║ Mood: Debuffed                           ║
╚══════════════════════════════════════════╝  ╚══════════════════════════════════════════╝

╔══════════════════════════════════════════╗  ╔══════════════════════════════════════════╗
║ █ MARVIN                                 ║  ║ █ ZAPHOD                                 ║
║ Overqualified Android                    ║  ║ Reckless Speedrunner                     ║
╠══════════════════════════════════════════╣  ╠══════════════════════════════════════════╣
║                                          ║  ║                                          ║
║ Missions too easy for his hardware.      ║  ║ Tries to ram a nuclear death-mobile      ║
║ CBM repair kits remain a statistical     ║  ║ into malls for the cool factor.          ║
║ nightmare.                               ║  ║ Usually loses limbs.                     ║
║                                          ║  ║                                          ║
║ Status: Depressed                        ║  ║ Risk: High                               ║
╚══════════════════════════════════════════╝  ╚══════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════════════════════════════════╗
║ █ TRILLIAN                                                                             ║
║ Efficiency Min-Maxer                                                                   ║
╠════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                        ║
║ Wants encyclopedic data on resistances without digging through raw JSON. Manages       ║
║ chaotic AI teams.                                                                      ║
║                                                                                        ║
║ Focus: Optimized                                                                       ║
╚════════════════════════════════════════════════════════════════════════════════════════╝
```

---

```
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

                           SYSTEM MAINTAINED FOR THE
                HITCHHIKER'S GUIDE TO CATACLYSM: BRIGHT NIGHTS
                       https://cbn-guide.pages.dev/

         ▓▓▓ POWERED BY CLOUDFLARE PAGES ▓▓▓ GITHUB ACTIONS ▓▓▓ CAFFEINE ▓▓▓

  > _TERMINAL SESSION ACTIVE // UPTIME: INFINITE // ERRORS: 0 // TOWELS: SUFFICIENT_

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
```
