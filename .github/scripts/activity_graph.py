"""Render a contribution activity graph SVG for the profile README.

Replaces the third-party github-readme-activity-graph service: data comes
straight from the GitHub GraphQL API, and the SVG is committed to the
`output` branch by the snake workflow.

Usage: GITHUB_TOKEN=... python activity_graph.py <login> <out.svg> [days]
"""

import datetime as dt
import json
import math
import os
import sys
import urllib.request

QUERY = """
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}
"""

# Matches the README's dark theme.
BG, GRID, AXIS, TEXT, MUTED = "#0D1117", "#21262D", "#30363D", "#E6EDF3", "#8B949E"
LINE, POINT = "#A8FF60", "#FFFFFF"


def fetch(login, days, token):
    end = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    start = (end - dt.timedelta(days=days - 1)).replace(hour=0, minute=0, second=0)
    body = json.dumps({
        "query": QUERY,
        "variables": {"login": login, "from": start.isoformat(), "to": end.isoformat()},
    }).encode()
    req = urllib.request.Request(
        "https://api.github.com/graphql",
        data=body,
        headers={"Authorization": f"bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "activity-graph"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = json.load(res)
    if payload.get("errors"):
        raise SystemExit(f"GraphQL error: {payload['errors']}")
    weeks = payload["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"]
    days_list = [(d["date"], d["contributionCount"]) for w in weeks for d in w["contributionDays"]]
    return days_list[-days:]


def nice_max(v):
    """Round the y-axis ceiling up to 1/2/5 x 10^n so tick labels stay whole."""
    if v <= 4:
        return 4
    mag = 10 ** math.floor(math.log10(v))
    for m in (1, 2, 5, 10):
        if v <= m * mag:
            return m * mag
    return 10 * mag


def render(login, data):
    W, H = 1200, 420
    L, R, T, B = 70, 30, 80, 60
    pw, ph = W - L - R, H - T - B
    counts = [c for _, c in data]
    top = nice_max(max(counts) if counts else 0)
    n = max(len(data) - 1, 1)

    def x(i):
        return L + pw * i / n

    def y(c):
        return T + ph - ph * c / top

    pts = [(x(i), y(c)) for i, (_, c) in enumerate(data)]
    line = " ".join(f"{'M' if i == 0 else 'L'}{px:.1f},{py:.1f}" for i, (px, py) in enumerate(pts))
    area = f"{line} L{pts[-1][0]:.1f},{T + ph} L{pts[0][0]:.1f},{T + ph} Z"

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        f'role="img" aria-labelledby="t d">',
        f'<title id="t">{login} contribution activity</title>',
        f'<desc id="d">Daily contributions for the last {len(data)} days: {sum(counts)} in total.</desc>',
        '<defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{LINE}" stop-opacity="0.35"/>'
        f'<stop offset="1" stop-color="{LINE}" stop-opacity="0"/></linearGradient></defs>',
        f'<rect width="{W}" height="{H}" rx="12" fill="{BG}"/>',
        '<g font-family="Segoe UI, Ubuntu, Helvetica, Arial, sans-serif">',
        f'<text x="{W / 2}" y="42" fill="{TEXT}" font-size="22" font-weight="600" text-anchor="middle">'
        f'Contribution activity — last {len(data)} days</text>',
        f'<text x="{W / 2}" y="64" fill="{MUTED}" font-size="14" text-anchor="middle">'
        f'{sum(counts)} contributions · busiest day {max(counts) if counts else 0}</text>',
    ]
    for k in range(5):
        v = top * k / 4
        gy = y(v)
        out.append(f'<line x1="{L}" y1="{gy:.1f}" x2="{W - R}" y2="{gy:.1f}" stroke="{GRID}"/>')
        out.append(f'<text x="{L - 12}" y="{gy + 4:.1f}" fill="{MUTED}" font-size="12" text-anchor="end">'
                   f'{v:g}</text>')
    out.append(f'<line x1="{L}" y1="{T + ph}" x2="{W - R}" y2="{T + ph}" stroke="{AXIS}"/>')
    out.append(f'<path d="{area}" fill="url(#fill)"/>')
    out.append(f'<path d="{line}" fill="none" stroke="{LINE}" stroke-width="2.5" '
               'stroke-linejoin="round" stroke-linecap="round"/>')
    for i, ((px, py), (date, c)) in enumerate(zip(pts, data)):
        out.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="3.5" fill="{POINT}"><title>{date}: {c}</title></circle>')
        out.append(f'<text x="{px:.1f}" y="{T + ph + 22}" fill="{MUTED}" font-size="12" text-anchor="middle">'
                   f'{int(date[8:])}</text>')
    out.append(f'<text x="{L + pw / 2}" y="{H - 12}" fill="{MUTED}" font-size="13" text-anchor="middle">'
               'Day of month</text>')
    out.append(f'<text transform="translate(20 {T + ph / 2}) rotate(-90)" fill="{MUTED}" font-size="13" '
               'text-anchor="middle">Contributions</text>')
    out.append("</g></svg>")
    return "\n".join(out)


def main():
    login, path = sys.argv[1], sys.argv[2]
    days = int(sys.argv[3]) if len(sys.argv) > 3 else 31
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("GITHUB_TOKEN is required")
    data = fetch(login, days, token)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(render(login, data))
    print(f"Wrote {path}: {len(data)} days, {sum(c for _, c in data)} contributions")


if __name__ == "__main__":
    main()
