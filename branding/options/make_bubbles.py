import math, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

CX, CY, R = 32, 33, 19

def pt(r, deg):
    a = math.radians(deg)
    return CX + r * math.cos(a), CY + r * math.sin(a)

def sector(ri, ro, a1, a2):
    """A piece of a ring (annular sector): the shape a window takes when it is reflected around a sphere."""
    x1, y1 = pt(ro, a1); x2, y2 = pt(ro, a2); x3, y3 = pt(ri, a2); x4, y4 = pt(ri, a1)
    return f'M{x1:.2f} {y1:.2f}A{ro} {ro} 0 0 1 {x2:.2f} {y2:.2f}L{x3:.2f} {y3:.2f}A{ri} {ri} 0 0 0 {x4:.2f} {y4:.2f}Z'

def curved_window(ri=5.6, ro=15.4, a1=191, a2=259, gap_a=2.2, gap_r=0.9, **style):
    mid_a = (a1 + a2) / 2
    mid_r = (ri + ro) / 2
    pieces = []
    for (r1, r2) in [(mid_r + gap_r / 2, ro), (ri, mid_r - gap_r / 2)]:
        for (b1, b2) in [(a1, mid_a - gap_a / 2), (mid_a + gap_a / 2, a2)]:
            pieces.append(sector(r1, r2, b1, b2))
    attrs = ' '.join(f'{k.replace("_", "-")}="{v}"' for k, v in style.items())
    return ''.join(f'<path d="{d}" {attrs}/>' for d in pieces)

DEFS_BASE = (
    '<linearGradient id="tile" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#26206b"/><stop offset="1" stop-color="#0f0b2e"/></linearGradient>'
    '<radialGradient id="bub" gradientUnits="userSpaceOnUse" cx="27" cy="26" r="27"><stop offset="0" stop-color="#c7d2fe" stop-opacity=".5"/><stop offset=".6" stop-color="#6366f1" stop-opacity=".22"/><stop offset="1" stop-color="#a5b4fc" stop-opacity=".5"/></radialGradient>'
    # light that passes through the bubble and lands low on the opposite side
    '<radialGradient id="caustic" gradientUnits="userSpaceOnUse" cx="38.5" cy="42" r="11"><stop offset="0" stop-color="#a5f3fc" stop-opacity=".7"/><stop offset=".55" stop-color="#818cf8" stop-opacity=".25"/><stop offset="1" stop-color="#818cf8" stop-opacity="0"/></radialGradient>'
    # thin-film colours on the rim, like a soap bubble
    '<linearGradient id="film" gradientUnits="userSpaceOnUse" x1="14" y1="16" x2="50" y2="52"><stop offset="0" stop-color="#e0e7ff"/><stop offset=".5" stop-color="#a5b4fc"/><stop offset="1" stop-color="#99f6e4"/></linearGradient>'
    '<linearGradient id="glass" gradientUnits="userSpaceOnUse" x1="18" y1="16" x2="38" y2="40"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".38"/></linearGradient>'
    f'<clipPath id="bc"><circle cx="{CX}" cy="{CY}" r="{R}"/></clipPath>'
)

def bubble(window, extra_defs=''):
    body = (
        '<rect width="64" height="64" rx="16" fill="url(#tile)"/>'
        f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#bub)"/>'
        f'<g clip-path="url(#bc)"><circle cx="38.5" cy="42" r="11" fill="url(#caustic)"/>{window}</g>'
        f'<circle cx="{CX}" cy="{CY}" r="{R-0.8}" fill="none" stroke="url(#film)" stroke-opacity=".9" stroke-width="1.6"/>'
        '<path d="M43.5 47.5a13.6 13.6 0 0 0 5.2-6.8" stroke="#fff" stroke-opacity=".6" stroke-width="2" fill="none" stroke-linecap="round"/>'
    )
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Bibi Office">\n  <defs>{DEFS_BASE}{extra_defs}</defs>\n  {body}\n</svg>\n'

files = {}

# B1: window curved around the edge of the bubble, white panes
files['B1-curved-window'] = bubble(curved_window(fill='url(#glass)', stroke='url(#glass)', stroke_width='1.1', stroke_linejoin='round'))

# B2: the same window drawn as thin lines only: delicate and airy
sec = curved_window(fill='none', stroke='#fff', stroke_opacity='.9', stroke_width='1.5', stroke_linejoin='round')
files['B2-line-window'] = bubble(sec)

# B3: a lit window: warm amber panes with a soft glow (someone is working late)
glow = '<radialGradient id="lamp" gradientUnits="userSpaceOnUse" cx="24" cy="23" r="15"><stop offset="0" stop-color="#fbbf24" stop-opacity=".5"/><stop offset="1" stop-color="#fbbf24" stop-opacity="0"/></radialGradient>'
files['B3-lit-window'] = bubble('<circle cx="24" cy="23" r="15" fill="url(#lamp)"/>' + curved_window(fill='#fde68a', fill_opacity='.95', stroke='#fde68a', stroke_width='1.1', stroke_linejoin='round'), glow)

# B4: a soft, slightly blurred straight window, like a real reflection (smaller and fainter than before)
blur = '<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".7"/></filter>'
panes = ''.join(f'<rect x="{x}" y="{y}" width="5" height="5" rx="1.4" fill="#fff" fill-opacity=".78"/>' for x, y in [(21.5, 21.5), (27.2, 21.5), (21.5, 27.2), (27.2, 27.2)])
files['B4-soft-reflection'] = bubble(f'<g filter="url(#soft)" transform="rotate(-14 26 27)">{panes}</g>', blur)

for name, content in files.items():
    open(name + '.svg', 'w', encoding='utf-8').write(content)
print(len(files), "files")
