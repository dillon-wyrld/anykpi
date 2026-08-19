# README assets

Stills and the five-view tour GIF are captured from the **seeded `demo` workspace** — the same fictional people the app ships with. Do not replace them with mockups or marketing composites.

## Recapture

```bash
pnpm install
pnpm exec playwright install chromium
pnpm db:init
pnpm readme:assets
```

`pnpm readme:assets` starts `pnpm dev` if nothing is listening on `http://localhost:3000` (override with `BASE_URL`). It writes:

| File | What |
| --- | --- |
| `dotplot.png` | Hero still — Dot Plot above the fold |
| `cohorts.png` | Cohorts |
| `wbr.png` | Weekly Business Review |
| `calendar.png` | Calendar (read-only) |
| `pmf.png` | PMF+ |
| `tour.gif` | Short tour that clicks through all five views |

## GIF

Playwright records a Chromium video of the tour (Dot Plot → Cohorts → WBR → Calendar → PMF+). The script then encodes `tour.gif` with `ffmpeg`:

```bash
ffmpeg -y -ss 1.25 -i tour.webm \
  -vf "fps=8,scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 docs/assets/tour.gif
```

If video recording fails, the script falls back to a slideshow of the five stills (same `ffmpeg` palette). If `ffmpeg` is missing entirely, it writes `PLACEHOLDER.md` instead of inventing a GIF — install ffmpeg and re-run.

### Manual recapture (optional)

1. `pnpm db:init && pnpm dev`
2. Open `/dashboard?workspace=demo&view=dotplot`
3. Record the five sidebar views in order (about two seconds each)
4. Encode with the `ffmpeg` command above, or drop frames in `docs/assets/` and re-run `pnpm readme:assets`
