import math, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# ---------- building blocks ----------
def orb_defs(id, cx, cy, r, stops, glow, shine=False):
    s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    d = (f'<radialGradient id="{id}b" gradientUnits="userSpaceOnUse" cx="{cx-0.29*r:.2f}" cy="{cy-0.41*r:.2f}" r="{1.59*r:.2f}">{s}</radialGradient>'
         f'<radialGradient id="{id}g" gradientUnits="userSpaceOnUse" cx="{cx+0.246*r:.2f}" cy="{cy+0.661*r:.2f}" r="{1.13*r:.2f}"><stop offset="0" stop-color="{glow}"/><stop offset="1" stop-color="{glow}" stop-opacity="0"/></radialGradient>'
         f'<clipPath id="{id}c"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath>')
    if shine:
        d += f'<radialGradient id="{id}s" gradientUnits="userSpaceOnUse" cx="{cx-0.331*r:.2f}" cy="{cy-0.456*r:.2f}" r="{0.62*r:.2f}"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    return d

def orb(id, cx, cy, r, shine=False):
    o = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{id}b)"/><circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{id}g)"/>'
    if shine:
        o += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{id}s)"/>'
    return o

def svg(defs, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Bibi Office">\n  <defs>{defs}</defs>\n  {body}\n</svg>\n'

PANE = '<linearGradient id="pane" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>'

def tile(a, b, x1=0, y1=0, x2=0, y2=64):
    return f'<linearGradient id="tile" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'

TILE = '<rect width="64" height="64" rx="16" fill="url(#tile)"/>'

# palettes
INDIGO = ([(0, '#c7d2fe'), (.38, '#818cf8'), (.76, '#4f46e5'), (1, '#312e81')], '#a78bfa')
TEAL = ([(0, '#ccfbf1'), (.38, '#2dd4bf'), (.76, '#0f766e'), (1, '#134e4a')], '#5eead4')
GOLD = ([(0, '#fff7d6'), (.38, '#fcd34d'), (.76, '#f59e0b'), (1, '#b45309')], '#fde68a')
VIOLET = ([(0, '#ede9fe'), (.38, '#a78bfa'), (.76, '#6d28d9'), (1, '#3b0764')], '#c4b5fd')
SKY = ([(0, '#e0f2fe'), (.38, '#38bdf8'), (.76, '#0369a1'), (1, '#082f49')], '#7dd3fc')
NIGHT = ([(0, '#64748b'), (.4, '#1e293b'), (1, '#020617')], '#334155')
DEEP = ([(0, '#a5b4fc'), (.38, '#6366f1'), (.76, '#4338ca'), (1, '#1e1b4b')], '#818cf8')

# window shapes (all drawn inside the orb clip)
def panes(x, y, s=6.6, gap=1.0, n=2, fill='url(#pane)', rx=1.8):
    out = ''
    for i in range(n):
        for j in range(n):
            out += f'<rect x="{x+j*(s+gap):.2f}" y="{y+i*(s+gap):.2f}" width="{s}" height="{s}" rx="{rx}" fill="{fill}"/>'
    return out

def arch(x, y, w, h, fill='url(#pane)', mull='#4f46e5'):
    r = w / 2
    d = f'M{x} {y+h}V{y+r}a{r} {r} 0 0 1 {w} 0V{y+h}Z'
    return (f'<path d="{d}" fill="{fill}"/>'
            f'<path d="M{x+r} {y}V{y+h}M{x} {y+h*0.52}H{x+w}" stroke="{mull}" stroke-opacity=".55" stroke-width="1.5"/>')

def blinds(x, y, w, n=5, gap=3.9, h=2.3):
    return ''.join(f'<rect x="{x}" y="{y+i*gap:.2f}" width="{w}" height="{h}" rx="1.1" fill="#fff" fill-opacity="{0.95-0.13*i:.2f}"/>' for i in range(n))

def skyline(cx, cy, r):
    bars = [(-17, 7, 12), (-10, 6, 18), (-3.5, 7, 9), (3.5, 6, 15), (10, 7, 11)]
    out = ''
    for dx, w, h in bars:
        x = cx + dx; y = cy + r - h
        out += f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h+3}" fill="#1e1b4b" fill-opacity=".62"/>'
        for k in range(int(h // 5)):
            out += f'<rect x="{x+1.4:.1f}" y="{y+1.6+k*5:.1f}" width="1.8" height="2" fill="#fde68a"/>'
            if w > 6:
                out += f'<rect x="{x+4:.1f}" y="{y+1.6+k*5:.1f}" width="1.8" height="2" fill="#fde68a" fill-opacity=".7"/>'
    return out

def clipped(id, inner):
    return f'<g clip-path="url(#{id}c)">{inner}</g>'

files = {}

# W01 Teal glass: teal sphere on deep teal tile, 2x2 panes
cx, cy, r = 32, 33, 19
st, gl = TEAL
files['W01-teal-glass'] = svg(tile('#0f3d3a', '#05201f') + PANE + orb_defs('a', cx, cy, r, st, gl),
    TILE + orb('a', cx, cy, r) + clipped('a', panes(21.5, 21)))

# W02 Golden hour: gold sphere on indigo tile, white panes
st, gl = GOLD
files['W02-golden-hour'] = svg(tile('#6366f1', '#3730a3', 8, 4, 56, 60) + PANE + orb_defs('a', cx, cy, r, st, gl),
    TILE + orb('a', cx, cy, r) + clipped('a', panes(21.5, 21)))

# W03 Arched window: indigo sphere, arched window with mullions
st, gl = INDIGO
files['W03-arched-window'] = svg(tile('#26206b', '#0f0b2e') + PANE + orb_defs('a', cx, cy, r, st, gl),
    TILE + orb('a', cx, cy, r) + clipped('a', arch(22.2, 19.5, 11.2, 15)))

# W04 Blinds: violet sphere reflecting venetian blinds
st, gl = VIOLET
files['W04-blinds'] = svg(tile('#2e1065', '#12052e') + orb_defs('a', cx, cy, r, st, gl),
    TILE + orb('a', cx, cy, r) + clipped('a', blinds(21, 20.5, 14.5)))

# W05 Big window grid: deep-blue sphere on a light tile, 3x3 window
r5 = 21
st, gl = DEEP
files['W05-light-grid'] = svg(tile('#eef2ff', '#c7d2fe') + PANE + orb_defs('a', 32, 32, r5, st, gl),
    TILE + orb('a', 32, 32, r5) + clipped('a', panes(19.3, 18.8, s=4.6, gap=0.9, n=3, rx=1.3)))

# W06 Glass bubble: see-through bubble with a rim light, window reflection
files['W06-glass-bubble'] = svg(tile('#26206b', '#0f0b2e') + PANE +
    '<radialGradient id="bub" gradientUnits="userSpaceOnUse" cx="27" cy="25" r="26"><stop offset="0" stop-color="#c7d2fe" stop-opacity=".55"/><stop offset=".6" stop-color="#6366f1" stop-opacity=".22"/><stop offset="1" stop-color="#a5b4fc" stop-opacity=".5"/></radialGradient>'
    '<clipPath id="bc"><circle cx="32" cy="33" r="19"/></clipPath>',
    TILE + '<circle cx="32" cy="33" r="19" fill="url(#bub)"/><circle cx="32" cy="33" r="18.2" fill="none" stroke="#c7d2fe" stroke-opacity=".85" stroke-width="1.6"/>'
    + '<g clip-path="url(#bc)">' + panes(21.5, 21) + '</g>'
    + '<path d="M40.5 44.5a13 13 0 0 0 7-9" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none" stroke-linecap="round"/>')

# W07 Lit window at night: dark sphere, one amber window glowing, stars on the tile
st, gl = NIGHT
stars = ''.join(f'<circle cx="{x}" cy="{y}" r="{s}" fill="#fff" fill-opacity=".85"/>' for x, y, s in [(11, 13, .9), (52, 12, 1.2), (49, 52, .8), (13, 50, 1)])
files['W07-night-window'] = svg(tile('#1e1b4b', '#0a0820') + orb_defs('a', cx, cy, r, st, gl)
    + '<radialGradient id="lamp" gradientUnits="userSpaceOnUse" cx="28" cy="27" r="14"><stop offset="0" stop-color="#fbbf24" stop-opacity=".55"/><stop offset="1" stop-color="#fbbf24" stop-opacity="0"/></radialGradient>',
    TILE + stars + orb('a', cx, cy, r) + clipped('a', '<circle cx="28" cy="27" r="14" fill="url(#lamp)"/>'
        + panes(21.5, 21, fill='#fbbf24', rx=1.8).replace('fill="#fbbf24"', 'fill="#fbbf24"', 1)
        + '<path d="M28.4 21V34.2M21.5 27.6H34.7" stroke="#0f0b2e" stroke-opacity=".0" stroke-width="0"/>'))

# W08 Two windows: a tall and a small window = a little building in the glass
st, gl = SKY
files['W08-two-windows'] = svg(tile('#1d4ed8', '#1e1b4b', 8, 4, 56, 60) + PANE + orb_defs('a', cx, cy, r, st, gl),
    TILE + orb('a', cx, cy, r) + clipped('a',
        '<rect x="21" y="20" width="9" height="17" rx="2.2" fill="url(#pane)"/>'
        '<rect x="32" y="26" width="7" height="11" rx="2" fill="url(#pane)"/>'
        '<rect x="32" y="20" width="7" height="4.6" rx="1.6" fill="url(#pane)" fill-opacity=".7"/>'))

# W09 Flat badge: no gloss, solid indigo disc, one lit amber pane, white tile
files['W09-flat-badge'] = svg(tile('#ffffff', '#eef2ff'),
    '<rect width="64" height="64" rx="16" fill="url(#tile)"/><rect x=".75" y=".75" width="62.5" height="62.5" rx="15.3" fill="none" stroke="#c7d2fe" stroke-width="1.5"/>'
    '<circle cx="32" cy="32" r="21" fill="#4f46e5"/>'
    '<g fill="#fff"><rect x="21.5" y="20.5" width="9.4" height="9.4" rx="2.4"/><rect x="33.1" y="20.5" width="9.4" height="9.4" rx="2.4"/><rect x="21.5" y="32.1" width="9.4" height="9.4" rx="2.4"/></g>'
    '<rect x="33.1" y="32.1" width="9.4" height="9.4" rx="2.4" fill="#fbbf24"/>')

# W10 City in the orb: skyline with lit windows reflected in the glossy sphere
r10 = 20
st, gl = INDIGO
files['W10-city-orb'] = svg(tile('#3730a3', '#1e1b4b', 8, 4, 56, 60) + orb_defs('a', 32, 32, r10, st, gl, shine=True),
    TILE + orb('a', 32, 32, r10, shine=True) + clipped('a', skyline(32, 32, r10)))

for name, content in files.items():
    open(name + '.svg', 'w', encoding='utf-8').write(content)
print(len(files), "files")
