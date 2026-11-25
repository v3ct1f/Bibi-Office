"""The three plan icons: Starter = the glass bubble, Business = teal bubble with a halo ring, Complete = gold-warm bubble."""
import os, shutil
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, '..', '..'))
os.chdir(here)

starter = open('W06-glass-bubble.svg', encoding='utf-8').read()
complete = open('G4-gold.svg', encoding='utf-8').read()

# Business: the teal bubble plus a thin halo ring around it (a step up from Starter)
teal = open('G1-teal.svg', encoding='utf-8').read()
tile_rect = '<rect width="64" height="64" rx="16" fill="url(#tile)"/>'
assert tile_rect in teal
halo = '<circle cx="32" cy="33" r="23.4" fill="none" stroke="#5eead4" stroke-opacity=".6" stroke-width="1.3"/>'
business = teal.replace(tile_rect, tile_rect + halo, 1)

plans = {'starter': starter, 'business': business, 'complete': complete}
os.makedirs(os.path.join(root, 'branding', 'plans'), exist_ok=True)
for key, svg in plans.items():
    open(os.path.join(root, 'branding', 'plans', f'icon-{key}.svg'), 'w', encoding='utf-8').write(svg)
    open(os.path.join(root, 'apps', 'web', 'public', f'favicon-{key}.svg'), 'w', encoding='utf-8').write(svg)
# The icon for pages that don't belong to a business (sign-in, plans, program admin): the Starter bubble.
open(os.path.join(root, 'apps', 'web', 'public', 'favicon.svg'), 'w', encoding='utf-8').write(starter)
print('plan icons written')
