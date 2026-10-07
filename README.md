# LOS SANTOS RISING — Blood & Concrete

A complete open-world crime game for the browser, inspired by *Grand Theft Auto: San Andreas*.
Built with **three.js**, vanilla ES modules, no build step, **no external assets**: every building, vehicle,
pedestrian, weapon, texture, sound effect and radio song is generated procedurally at runtime.

```
npm start            # = node server.js 8080
open http://localhost:8080/
```
(Any static file server works: the game is just `index.html` + `src/` + `assets/` + `lib/`.)
Chrome / Edge / Firefox with WebGL2. A mid-range GPU is enough; on slow machines the game lowers shadows / view distance automatically.

## The game
You are **Jay Mercer**, back in Los Santos after five years away because your sister Nia has disappeared.
The story has **24 missions** across two chapters (about 3–4 hours) — turf wars, a bike chase, a tail job, a sniper hit, a
police escape, a harbour heist, an armoured-truck robbery, a showdown with a crooked cop and a finale at Calloway's hillside
estate. **Chapter II: The Hollow Crown** continues the story after Calloway falls: the money behind him surfaces as the
Halcyon Group, and its owner Vivian Wexler will not let the city go without a fight — a funeral defence, a stealth
infiltration, an amphibious retrieval, an anti-air stand-off, a convoy interception, a surveillance chain, a multi-stage
bank heist and a helicopter finale. Plus 4 optional side quests and an open Los Santos to explore:

* **Driving** — 18 vehicle types (sedans, lowriders, muscle/sports cars, SUVs, vans, buses, trucks, limo, taxi, police,
  SWAT van, ambulance, motorbike, bicycle) with arcade physics, handbrake drifts, damage, fires and explosions.
  Police helicopter. Radio with **5 generative stations** (G-funk, synthwave, classic rock, funk/disco, latin) — R / T to tune, X = off.
* **On foot** — walk / sprint (stamina) / crouch / jump / swim, melee combos, bat, knife, pistol, Desert Eagle, shotgun, Micro SMG,
  AK-47, sniper (scope), RPG, grenades, Molotovs, spray can. Lock-on aim assist, headshots, drive-by shooting.
* **Wanted level** (1–6 stars) — witnesses, pursuit cars, roadblocks, SWAT, helicopter; lose them by breaking line of sight,
  using a **Pay 'n' Spray**, or bribe stars. Get **busted** (weapons confiscated) or **wasted** (hospital bill).
* **The city** — 2 × 2 km of procedurally generated Los Santos: Ganton, Idlewood, Jefferson, Downtown skyscrapers, Vinewood hills with a
  switchback road network and the sign, Santa Maria / Verona beaches with the pier, the airport, the docks, the stadium, the river channel, freeways.
  Day/night cycle (24 min/day), weather (clear, smog, cloudy, rain), lit windows, street lamps, headlights, working traffic signals.
* **Living world** — ambient traffic following lanes and obeying signals, pedestrians on sidewalks, panic and fights, gangs in their turf
  (**Emerald Row**, Violet Kings, Los Soles, Blue Line), rival gang raids, recruitable homies (press G near Emerald Row members).
* **Side content** — 4 side quests (after mission 4), random street events (accidents, muggings, chases, drive-bys), Ammu-Nation, food joints (health), safehouse saves, spray-tag collectibles (28), taxi duty (N in a taxi),
  vigilante duty (N in a police car), 3 street races, stats screen, full map with waypoint (M).

### Controls
| | |
|---|---|
| Move / look | `W A S D` / mouse (click the game to capture the mouse) |
| Sprint / jump / crouch | `Shift` / `Space` / `C` |
| Fire / aim | left mouse / hold right mouse |
| Reload / switch weapon | `R` / `Q` `E`, mouse wheel, `1`–`9` |
| Enter / exit / hijack vehicle | `F` |
| Drive | `W` accelerate, `S` brake & reverse, `A D` steer, `Space` handbrake, `H` horn, `C` look back |
| Radio | `R` next, `T` previous, `X` off |
| Drive-by | hold right mouse, then left mouse (pistol / SMG) |
| Map / pause | `M` / `Esc` |
| Skip cutscene | `Enter` |
| Recruit homie / duty | `G` near an Emerald Row member / `N` in a taxi or police car |
| Cheats (type while playing) | `cheatmode` lists them: `hesoyam`, `weaponset`, `aezakmi`, `catchacar`, `nightfall`, `sunrise`, `goodday`, `bigbang` |

Progress is saved at the safehouse (green house marker in Ganton) and automatically after missions (`F5` quick-saves when no mission is running).
Settings (volume, sensitivity, FOV, shadows, view distance) are in the pause menu and persist.

## About the map
The layout of Los Santos is read **from images** at start-up (`assets/map.png`, `zones.png`, `height.png`, `districts.json`,
format documented in `docs/SPEC.md`): roads, water, parks, terrain height, districts and gang territories.
Roads are extracted from the road pixels by skeletonisation into a graph that drives traffic, pedestrians, police routing and the radar.
Buildings and props are then generated procedurally along that road network.

No reference picture of the original map was available while building this, so `tools/make_map.py` **authors a Los Santos–inspired layout**
(coastline, hills, downtown, airport, docks, stadium, river and freeways in their familiar places). To use your own picture instead:

```
python3 tools/import_map.py my_los_santos_map.png --out assets_custom --hills "500,100,120,60"
# open http://localhost:8080/?map=assets_custom/
```
`import_map.py` classifies a top-down map picture (blue water, green parks, roads brighter than their surroundings...) into the game's format.
It is heuristic — check `assets_custom/map_preview.png` and tune with `--roads dark`, `--water R,G,B`, `--zone`, `--hills`, `--districts`.

## Project layout
See `docs/ARCHITECTURE.md` (module map) and `docs/SPEC.md` (conventions & asset formats).
Useful dev tools (need `node server.js 8080` running and Chromium): `node tools/play.js steps.js` (headless scripted play with screenshots),
`node tools/bot.js --from m01 --to m24` (auto-plays the whole story with cheats to catch script errors), `python3 tools/make_map.py` (regenerate the map).

## Credits
Everything in this repository — code, models, textures, story, dialogue, sound and music — was produced by AI (Claude) in a single session.
*Grand Theft Auto* and *San Andreas* belong to Rockstar Games; this is an independent fan-style homage that contains none of their assets, names of characters, or story.
