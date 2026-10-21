# Portfolio site — “The Engineering Playground”

Source for **https://mdibua.github.io/MdIbuA/**. (`README.md` in this repo is the GitHub profile README, not site docs.)

Plain HTML, CSS and JavaScript. No framework, no build step, no runtime dependencies, no trackers.

## Structure

```
index.html              All content (semantic HTML; complete without JavaScript)
404.html                GitHub Pages not-found page
assets/css/main.css     Design tokens, layout, components, responsive and reduced-motion rules
assets/js/main.js       Progressive enhancement: system map, project traces, filters,
                        command menu (Ctrl/⌘+K or /), mobile nav, scroll reveals, copy email
assets/fonts/           Self-hosted, subset woff2: Bricolage Grotesque, Geist, Geist Mono (SIL OFL)
assets/img/             Portrait (webp + jpg fallback), favicon, touch icon, social preview
robots.txt, sitemap.xml, site.webmanifest
.github/workflows/static.yml   Deploys the repo to GitHub Pages on every push to main
```

## Preview locally

Any static server works. From the repo root:

```bash
npx serve .            # or: python3 -m http.server 8080
```

Then open the printed URL. Opening `index.html` straight from disk also works, apart from the 404 page.

## Deploy

GitHub Pages is already wired up: `.github/workflows/static.yml` publishes the repo root on every push to `main`.
Under **Settings → Pages**, the source must be set to **GitHub Actions**.

Note: `profile-3d.yml` commits to `main` every day, so the site also redeploys daily. That's harmless.

Moving to a custom domain? Update the canonical URL, the `og:*` URLs and the JSON-LD block in `index.html`, plus `robots.txt` and `sitemap.xml`.

## Editing content

- **Projects:** each featured case study is an `<article class="case">` in `#work`. Its `data-tags` (`ai fullstack cloud data`) drive the filters. Smaller builds are `.index__row` items.
- **System map:** node positions live in the inline `--x/--y` styles, and edges are `<line data-edge="a-b">` using the same 0–100 coordinates. Node descriptions and project traces are in `NODES` and `FLOWS` at the top of `assets/js/main.js`.
- **Command menu:** the `COMMANDS` array in `main.js`.
- **Skills:** `is-built` means the skill was used in a project on the page; `is-studied` means coursework or training.

## Content rules

Every claim on the page is backed by a public repository, a published article, or information the owner supplied.
Metrics are quoted only when the evaluation is in the source (e.g. the CryptoPulse BTC notebook).
Keep it that way: no unverified accuracy figures, user counts or impact numbers.
