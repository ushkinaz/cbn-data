# cbn-data

This repo mirrors the JSON and translation data from nightly and release versions of [Cataclysm: Bright Nights](https://github.com/cataclysmbn/Cataclysm-BN) for use in other projects, most notably the [The Hitchhiker's Guide to the Cataclysm: Bright Nights](https://cbn-guide.pages.dev/). The data is updated automatically every 12 hours.

## Status
[![Pull Cataclysm-BN data](https://github.com/ushkinaz/cbn-data/actions/workflows/pull-data.yml/badge.svg?branch=action)](https://github.com/ushkinaz/cbn-data/actions/workflows/pull-data.yml)
[![Prune Old Data](https://github.com/ushkinaz/cbn-data/actions/workflows/prune-data.yml/badge.svg?branch=action)](https://github.com/ushkinaz/cbn-data/actions/workflows/prune-data.yml)

## Usage

The data is committed to this repository in the `main` branch, while the code for updating the data is in the `action` branch (i.e. this one).

The data is available through `cbn-data.pages.dev` URLs, and you can use it directly in your projects. For example, to get the JSON data for the latest experimental version of the game, you can use the following URL:

```
https://cbn-data.pages.d`ev/data/latest/all.json
```

The structure of the `all.json` file is:

```json5
{
  "build_number": "[tag name, e.g. 2024-05-13]",
  "release": { /* GitHub release data */ },
  "data": [
    /* every JSON object from the game's data files */
  ]
}
```

Each JSON object in the `data` array is a single object from the game's data files, with an additional `__filename` field that contains the path to the file the object was found in and the line numbers.

### Translations

The translation data for a version is available under `data/[version]/lang/[language].json`. For example, to get the French translation for the latest experimental, you can use the following URL:

```
https://cbn-data.pages.dev/data/latest/lang/fr.json
```

The format of the translation files is Jed-compatible, produced with [po2json](https://www.npmjs.com/package/po2json). The keys are the original strings from the game, and the values are the translations.

#### Pinyin

For Chinese translations, there is an additional `zh_*_pinyin.json` file that contains the pinyin for each string. For example, to get the pinyin for the Chinese translation of the latest experimental, you can use the following URL:

```
https://cbn-data.pages.dev/data/latest/lang/zh_CN_pinyin.json
```

This file has the same format as the translation file, except the values are the pinyin for the strings. This can be helpful when implementing search functionality for Chinese translations.

### Tileset gfx

Tileset assets are mirrored under `data/[version]/gfx/` with the same folder layout as the upstream `gfx` directory. The pull-data workflow adds `.webp` copies of PNG tiles via `calibreapp/image-actions`, while keeping the original PNGs untouched.

## Contributing

To clone the repo without also downloading every historical version of the game, use the `--single-branch` option:

```
git clone --single-branch https://github.com/ushkinaz/cbn-data
```

To run the update script locally, you'll need to have Node.js installed. Then you can run:

```
yarn
node pull-data-launcher.js
```

Local runs only pull the raw gfx assets; the PNG-to-WebP conversion happens in the GitHub Actions workflow.
