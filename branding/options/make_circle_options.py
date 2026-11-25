import math, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

def orb_defs(id, cx, cy, r, stops, glow):
    s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return (f'<radialGradient id="{id}b" gradientUnits="userSpaceOnUse" cx="{cx-0.29*r:.2f}" cy="{cy-0.41*r:.2f}" r="{1.59*r:.2f}">{s}</radialGradient>'
            f'<radialGradient id="{id}g" gradientUnits="userSpaceOnUse" cx="{cx+0.246*r:.2f}" cy="{cy+0.661*r:.2f}" r="{1.13*r:.2f}"><stop offset="0" stop-color="{glow}"/><stop offset="1" stop-color="{glow}" stop-opacity="0"/></radialGradient>'
            f'<radialGradient id="{id}s" gradientUnits="userSpaceOnUse" cx="{cx-0.331*r:.2f}" cy="{cy-0.456*r:.2f}" r="{0.62*r:.2f}"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".25" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>')

def orb(id, cx, cy, r, shine=True):
    o = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{id}b)"/><circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{id}g)"/>'
    if shine:
        o += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{id}s)"/>'
    return o

def svg(defs, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Bibi Office">\n  <defs>{defs}</defs>\n  {body}\n</svg>\n'

INDIGO_STOPS = [(0, '#c7d2fe'), (.38, '#818cf8'), (.76, '#4f46e5'), (1, '#312e81')]
DARK = '<linearGradient id="tile" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#26206b"/><stop offset="1" stop-color="#0f0b2e"/></linearGradient>'
BLUE = '<linearGradient id="tile" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#3730a3"/></linearGradient>'

# M: glossy indigo orb with an office window reflected in it
cx, cy, r = 32, 33, 19
pane = '<linearGradient id="pane" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>'
clip = f'<clipPath id="orbclip"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath>'
panes = ''.join(f'<rect x="{x}" y="{y}" width="6.6" height="6.6" rx="1.8" fill="url(#pane)"/>' for x, y in [(21.5, 21), (29.1, 21), (21.5, 28.6), (29.1, 28.6)])
M = orb('m', cx, cy, r, shine=False) + f'<g clip-path="url(#orbclip)">{panes}</g>'
open('M-window-orb.svg', 'w').write(svg(DARK + pane + clip + orb_defs('m', cx, cy, r, INDIGO_STOPS, '#a78bfa'), '<rect width="64" height="64" rx="16" fill="url(#tile)"/>' + M))

# N: gold sun rising over a desk
cx, cy, r = 32, 35, 17
rays = ''.join(f'<path d="M{32+23*math.cos(math.radians(a)):.2f} {35+23*math.sin(math.radians(a)):.2f}L{32+28*math.cos(math.radians(a)):.2f} {35+28*math.sin(math.radians(a)):.2f}" stroke="#fde68a" stroke-opacity=".8" stroke-width="2.6" stroke-linecap="round"/>' for a in (-150, -120, -90, -60, -30))
desk = '<path d="M0 41.5H64V64H0Z" fill="#2e2a8c"/><path d="M0 41.5H64" stroke="#a5b4fc" stroke-opacity=".7" stroke-width="1.6"/>'
GOLD = [(0, '#fff7d6'), (.38, '#fcd34d'), (.76, '#f59e0b'), (1, '#b45309')]
tk = '<clipPath id="tk"><rect width="64" height="64" rx="16"/></clipPath>'
open('N-sunrise-orb.svg', 'w').write(svg(BLUE + tk + orb_defs('n', cx, cy, r, GOLD, '#fde68a'),
    '<g clip-path="url(#tk)"><rect width="64" height="64" fill="url(#tile)"/>' + orb('n', cx, cy, r) + rays + desk + '</g>'))

# O: planet with an orbiting ring and a moon
cx, cy, r = 32, 32, 15
TEAL = [(0, '#d9f99d'), (.34, '#5eead4'), (.72, '#4f46e5'), (1, '#1e1b4b')]
ring_back = '<ellipse cx="32" cy="32" rx="27" ry="9.5" transform="rotate(-24 32 32)" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3.2"/>'
a = math.radians(-24)
lx, ly = 32 - 27 * math.cos(a), 32 - 27 * math.sin(a)
rx_, ry_ = 32 + 27 * math.cos(a), 32 + 27 * math.sin(a)
ring_front = f'<path d="M{lx:.2f} {ly:.2f}A27 9.5 -24 0 0 {rx_:.2f} {ry_:.2f}" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>'
moon = f'<circle cx="{rx_-1.5:.2f}" cy="{ry_-1.2:.2f}" r="4" fill="#fbbf24"/>'
O = ring_back + orb('o', cx, cy, r) + ring_front + moon
open('O-planet-orbit.svg', 'w').write(svg(DARK + orb_defs('o', cx, cy, r, TEAL, '#5eead4'), '<rect width="64" height="64" rx="16" fill="url(#tile)"/>' + O))

# P: clock-face orb on a light tile (10:10, a smile)
cx, cy, r = 32, 32, 22
LIGHT = '<linearGradient id="tile" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#eef2ff"/><stop offset="1" stop-color="#c7d2fe"/></linearGradient>'
INDIGO2 = [(0, '#a5b4fc'), (.38, '#6366f1'), (.76, '#4338ca'), (1, '#1e1b4b')]
hands = ('<path d="M32 32L24 26.6M32 32L41.5 26.6" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>'
         '<circle cx="32" cy="32" r="2.6" fill="#fbbf24"/>'
         '<circle cx="32" cy="14.6" r="1.7" fill="#fff" fill-opacity=".9"/><circle cx="49.4" cy="32" r="1.7" fill="#fff" fill-opacity=".9"/>'
         '<circle cx="32" cy="49.4" r="1.7" fill="#fff" fill-opacity=".9"/><circle cx="14.6" cy="32" r="1.7" fill="#fff" fill-opacity=".9"/>')
open('P-clock-orb.svg', 'w').write(svg(LIGHT + orb_defs('p', cx, cy, r, INDIGO2, '#818cf8'), '<rect width="64" height="64" rx="16" fill="url(#tile)"/>' + orb('p', cx, cy, r) + hands))
print("ok")
