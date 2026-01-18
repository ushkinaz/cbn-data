# C:BN - WASTELAND DATA VAULT v2.42

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ ROOT@BUNKER:~/DATA/CBN                                                             [☠] ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃                                                                                        ┃
┃     ██╗    ██╗ █████╗ ███████╗████████╗███████╗██╗       █████╗ ███╗   ██╗██████╗      ┃
┃     ██║    ██║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██║      ██╔══██╗████╗  ██║██╔══██╗     ┃
┃     ██║ █╗ ██║███████║███████╗   ██║   █████╗  ██║      ███████║██╔██╗ ██║██║  ██║     ┃
┃     ██║███╗██║██╔══██║╚════██║   ██║   ██╔══╝  ██║      ██╔══██║██║╚██╗██║██║  ██║     ┃
┃     ╚███╔███╔╝██║  ██║███████║   ██║   ███████╗███████╗ ██║  ██║██║ ╚████║██████╔╝     ┃
┃      ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚══════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝      ┃
┃                                                                                        ┃
┃                                  D A T A   V A U L T                                   ┃
┃                                                                                        ┃
┃      Complete Cataclysm: Bright Nights data mirror. JSON game objects, translation     ┃
┃        files, GFX assets, and build metadata. Optimized with Brotli compression        ┃
┃                                   and WebP graphics.                                   ┃
┃                          No towels required, but recommended.                          ┃
┃                                                                                        ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

---

## SURVIVOR PROTOCOL

Always start with `/builds.json` to get available dates, then navigate to `/data/RELEASE/` for your target build.
Check the guide at https://cbn-guide.pages.dev/ for real life examples.

---

## TERMINAL COMMANDS

Fetch build index:

```sh
http https://cbn-data.pages.dev/builds.json | jq '.[]'
```

List available builds:

```sh
http https://cbn-data.pages.dev/builds.json | jq '.[].build_number'
```

Download complete game data:

```sh
http https://cbn-data.pages.dev/data/v0.9.1/all.json -o all.json
```

Get Chinese translations with pinyin for latest stable:

```sh
http https://cbn-data.pages.dev/data/stable/lang/zh_CN_pinyin.json -o zh_CN_pinyin.json
```

List all guns, with fancy search interface:

```sh
http https://cbn-data.pages.dev/data/nightly/all.json | \
  jq -c '.data[] | select(.type == "GUN")' | \
  fzf --style full --preview 'echo {} | jq --color-output .'
```

---

```
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                               SYSTEM MAINTAINED FOR THE
                    HITCHHIKER'S GUIDE TO CATACLYSM: BRIGHT NIGHTS
                             https://cbn-guide.pages.dev/

          ▓▓▓ POWERED BY CLOUDFLARE PAGES ▓▓▓ GITHUB ACTIONS ▓▓▓ CAFFEINE ▓▓▓

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
```
