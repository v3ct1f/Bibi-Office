import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

CX, CY, R = 32, 33, 19          # the bubble
GX, GY = 29.2, 28.4             # centre of the window, a little up and left, like the one you liked

def tile_def(a, b):
    return f'<linearGradient id="tile" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'

def bub_def(c1, c2, c3, o1=.5, o2=.22, o3=.5):
    return (f'<radialGradient id="bub" gradientUnits="userSpaceOnUse" cx="27" cy="25" r="26">'
            f'<stop offset="0" stop-color="{c1}" stop-opacity="{o1}"/><stop offset=".6" stop-color="{c2}" stop-opacity="{o2}"/><stop offset="1" stop-color="{c3}" stop-opacity="{o3}"/></radialGradient>')

def pane_def(o1=.95, o2=.35):
    return f'<linearGradient id="pane" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="{o1}"/><stop offset="1" stop-color="#fff" stop-opacity="{o2}"/></linearGradient>'

def grid(cols, rows, w, h, gap, rx, fills=None):
    tw = cols * w + (cols - 1) * gap
    th = rows * h + (rows - 1) * gap
    x0, y0 = GX - tw / 2, GY - th / 2
    out = ''
    for i in range(rows):
        for j in range(cols):
            f = (fills or {}).get((i, j), 'url(#pane)')
            out += f'<rect x="{x0+j*(w+gap):.2f}" y="{y0+i*(h+gap):.2f}" width="{w}" height="{h}" rx="{rx}" fill="{f}"/>'
    return out

def arch(x, y, w, h, fill='url(#pane)'):
    r = w / 2
    return f'<path d="M{x:.2f} {y+h:.2f}V{y+r:.2f}a{r} {r} 0 0 1 {w} 0V{y+h:.2f}Z" fill="{fill}"/>'

def bubble(tile, tint, rim, panes, extra_defs='', extra_before='', extra_after='', crescent='#fff', crescent_o=.55, rim_o=.85, bubble_r=R):
    body = (
        '<rect width="64" height="64" rx="16" fill="url(#tile)"/>' + extra_before +
        f'<circle cx="{CX}" cy="{CY}" r="{bubble_r}" fill="url(#bub)"/>'
        f'<circle cx="{CX}" cy="{CY}" r="{bubble_r-0.8}" fill="none" stroke="{rim}" stroke-opacity="{rim_o}" stroke-width="1.6"/>'
        + panes +
        f'<path d="M40.5 44.5a13 13 0 0 0 7-9" stroke="{crescent}" stroke-opacity="{crescent_o}" stroke-width="2" fill="none" stroke-linecap="round"/>'
        + extra_after
    )
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Bibi Office">\n'
            f'  <defs>{tile}{tint}{pane_def()}{extra_defs}</defs>\n  {body}\n</svg>\n')

INDIGO_TILE = tile_def('#26206b', '#0f0b2e')
INDIGO = bub_def('#c7d2fe', '#6366f1', '#a5b4fc')
files = {}

# 1 Teal
files['G1-teal'] = bubble(tile_def('#0f3d3a', '#05201f'), bub_def('#99f6e4', '#14b8a6', '#5eead4'), '#99f6e4', grid(2, 2, 6.6, 6.6, 1, 1.8))

# 2 Violet
files['G2-violet'] = bubble(tile_def('#2e1065', '#12052e'), bub_def('#ddd6fe', '#8b5cf6', '#c4b5fd', .5, .26, .5), '#ddd6fe', grid(2, 2, 6.6, 6.6, 1, 1.8))

# 3 Light tile: a deeper blue bubble so it shows up on pale
files['G3-light'] = bubble(tile_def('#eef2ff', '#c7d2fe'), bub_def('#a5b4fc', '#6366f1', '#4338ca', .8, .6, .85), '#4338ca',
                           grid(2, 2, 6.6, 6.6, 1, 1.8), crescent_o=.8, rim_o=.9)

# 4 Gold warmth inside the bubble
files['G4-gold'] = bubble(INDIGO_TILE, bub_def('#fde68a', '#f59e0b', '#fcd34d', .5, .2, .6), '#fde68a', grid(2, 2, 6.6, 6.6, 1, 1.8), crescent='#fef3c7')

# 5 Grid of nine small panes
files['G5-nine-panes'] = bubble(INDIGO_TILE, INDIGO, '#c7d2fe', grid(3, 3, 4.6, 4.6, .9, 1.3))

# 6 Two arched windows side by side
aw, ah, ag = 6.4, 14.5, 1.3
ax = GX - (2 * aw + ag) / 2
ay = GY - ah / 2
files['G6-arches'] = bubble(INDIGO_TILE, INDIGO, '#c7d2fe', arch(ax, ay, aw, ah) + arch(ax + aw + ag, ay, aw, ah))

# 7 One big window with a cross
bw = 15.4
bx, by = GX - bw / 2, GY - bw / 2
big = (f'<rect x="{bx:.2f}" y="{by:.2f}" width="{bw}" height="{bw}" rx="3.4" fill="url(#pane)"/>'
       f'<path d="M{GX:.2f} {by+1.2:.2f}V{by+bw-1.2:.2f}M{bx+1.2:.2f} {GY:.2f}H{bx+bw-1.2:.2f}" stroke="#312e81" stroke-opacity=".5" stroke-width="1.5" stroke-linecap="round"/>')
files['G7-big-window'] = bubble(INDIGO_TILE, INDIGO, '#c7d2fe', big)

# 8 One pane lit in amber (a light left on)
lamp = '<radialGradient id="lamp" gradientUnits="userSpaceOnUse" cx="33" cy="32" r="9"><stop offset="0" stop-color="#fbbf24" stop-opacity=".6"/><stop offset="1" stop-color="#fbbf24" stop-opacity="0"/></radialGradient>'
files['G8-one-lit'] = bubble(INDIGO_TILE, INDIGO, '#c7d2fe',
                             '<circle cx="33" cy="32" r="9" fill="url(#lamp)"/>' + grid(2, 2, 6.6, 6.6, 1, 1.8, {(1, 1): '#fbbf24'}), extra_defs=lamp)

# 9 Playful: a little bubble floating nearby and a sparkle
spark = ('<path d="M13 47.5l1.3 3.3 3.3 1.3-3.3 1.3L13 56.7l-1.3-3.3-3.3-1.3 3.3-1.3Z" fill="#fde68a" fill-opacity=".9"/>'
         '<circle cx="50.5" cy="14.5" r="4.2" fill="url(#bub)"/><circle cx="50.5" cy="14.5" r="3.7" fill="none" stroke="#c7d2fe" stroke-opacity=".85" stroke-width="1"/>'
         '<path d="M48.6 14.2a2.2 2.2 0 0 1 1.3-1.5" stroke="#fff" stroke-opacity=".8" stroke-width="1" fill="none" stroke-linecap="round"/>')
files['G9-playful'] = bubble(INDIGO_TILE, INDIGO, '#c7d2fe', grid(2, 2, 6.6, 6.6, 1, 1.8), extra_after=spark)

for name, content in files.items():
    open(name + '.svg', 'w', encoding='utf-8').write(content)
print(len(files), "files")
