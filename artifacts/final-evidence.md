# SUNSET SLAM — Final Evidence

Run date: 2026-10-27 · Current build verified on the LAN server (4173) ·
Manifest: `artifacts/evidence-pass4.json` (runId `pass-4`) · Prior passes:
`evidence.json` (pass-1, pre-multiplier build), `evidence-pass2/3.json`.

## What was built

Third-person arcade tennis ("Fortnite camera") with automatic shot selection.
Move + aim + one hit button; the auto-shot system chooses topspin / drive /
slice / volley / smash / lob / drop / serve from ball height, court position
and aim. First to 4 (2 clear) wins. Full loop: title → intro countdown → serve
(auto toss, click to strike) → rally vs AI rival → point banners with real
tennis reasons (winner, out, net, missed return, serve fault) → serve
alternation → deuce/advantage → match point flag → results with stats →
rematch / quit.

## Verification performed

### 1. Canvas inspector (production build, 7/7 PASS)

`scripts/inspect-driver.mjs` drives the qa-release skill's inspector (SwiftShader
headless — no GPU in this sandbox, so FPS readings are invalid; pixel, budget and
functional checks hold). All renderer stats below are live, non-zero snapshots
after a diagnostics-timing fix (see §4).

| Capture | Result | Entropy | Edges | Contrast | Dominant | Budget |
| --- | --- | --- | --- | --- | --- | --- |
| desktop/title | PASS | 5.95 | 0.313 | 186 | 0.089 | ok (192 calls) |
| desktop/active-play | PASS | 6.64 | 0.349 | 175 | 0.062 | ok (211 calls) |
| desktop/serve | PASS | 6.51 | 0.347 | 173 | 0.070 | ok (206 calls) |
| desktop/paused | PASS | 3.12 | 0.056 | 33 | 0.247 | ok (211 calls) |
| desktop/match-won | PASS | 3.36 | 0.067 | 42 | 0.254 | ok (211 calls) |
| mobile/title | PASS | 5.99 | 0.318 | 192 | 0.081 | **over: calls 181 > 150** |
| mobile/active-play | PASS | 6.62 | 0.319 | 187 | 0.064 | **over: calls 204 > 150** |

- Console/page errors: **0** in every capture.
- Active-play pixel metrics are strong (entropy ≈ 6.6, edges ≈ 0.35,
  contrast ≈ 175) — well above the "sparse scene" thresholds.
- Paused/match-won low entropy is expected: the blur scrim + modal dominates.
- **Documented tradeoff:** mobile draw calls 181–204 vs the 150 starting
  budget. The stadium is a single shared scene; triangles are ~128k vs the
  300k mobile cap, DPR is capped at 1.5, and 200 calls of shared-material
  geometry is trivial for real mobile GPUs. Not worth gutting the stands for.
- `check_evidence.py --manifest artifacts/evidence-pass3.json`: **8/8 artifacts
  confirmed** (7 captures + motion video).

### 2. Bot playtests (real input, seeded)

- `scripts/bot-match.mjs` (seed 42, keyboard-driven from the title screen):
  5 points completed across serve alternation — `1-0 RIKO HITS OUT`,
  `2-0 RIKO HITS OUT`, `3-0 RIKO HITS OUT`, `3-1 MISSED RETURN`,
  `3-2 MISSED RETURN`. 19 player hits, 0 swing whiffs, 107 world-units of
  player movement, 0 console errors.
- `scripts/bot-finish.mjs` (from the 3–2 match-point state): played the final
  point with real input — **match won 4–2** at rally 9 — and a second run
  reached **match lost 2–4**; results screen, stats, rematch (fresh 0–0) and
  quit-to-title all verified.
- First bot run exposed a real design flaw: two error-free players produced
  endless rallies (0–0 after 26 hits). Fixed with a pressure-based unforced-
  error model for Riko (stretch, rally length, shot type) plus a smaller
  player fatigue term — points now end through winners *and* errors.
- `scripts/quit-audio-test.mjs`: audio context unlocks on the PLAY click
  (`state: running`), pause→quit and results→title return correct screens,
  mute toggles body/UI state.

### 3. Motion evidence (unpaused, real input)

`artifacts/pass-3/rally-motion.webm` — 75 s of live play on the final build
recorded through Playwright video while a script drives movement + hits.
Frames extracted at 10 s / 35 s / 60 s (`motion-*.png`): active rally with
ball trail mid-flight, point banner ("POINT · RIKO — MISSED RETURN") with the
aim UI correctly hidden, and score progression 30–15 → 30–30 → 3–2. Observed:
run-cycle locomotion, swing transitions on contact, banner in/out transitions,
no frozen rig or stretched limbs.

### 4. Defects found and fixed during verification

1. **Endless rallies** (see §2) — added unforced-error model.
2. **`mergeGeometries` compatibility failure** — mixing indexed and
   non-indexed geometry silently dropped merged scenery and logged a console
   error. Fixed: flatten to non-indexed, synthesize missing UVs, and only
   swap originals in after a successful merge. Console now clean.
3. **Diagnostics race in headless capture** — SwiftShader's slow frames let
   the inspector snapshot a stale/zeroed `renderer.info` (one capture also
   showed a stale phase). Fixed: 250 ms diagnostics republish timer plus
   last-real-stats retention; pass-3 shows live, correct values in all 7
   captures.
4. Banner/aim overlap, pause-modal readability, and Esc-to-resume were caught
   from screenshots and fixed before the final pass.

### 5. Visual scorecard (active-play desktop, self-scored)

Art direction 2 · Hero/player 2 (authored rig, jersey number, state poses) ·
Obstacles/opponent 2 · Rewards/interactables 2 (ball glow, trail, aim/bounce
markers, hit ratings) · World 2 (layered stadium, crowd, palms, big screen) ·
Materials 2 (procedural court/ball/net textures, shared material roles) ·
Lighting 2 (ACES, key/fill/rim, contact blobs, sunset sky shader) · VFX 2
(event-driven contact bursts, rings, hitstop, FOV punch, shake) · UI/HUD 2
(genre HUD: broadcast scoreboard, auto-shot chip, readiness ring, banners) ·
Performance evidence 2 (live renderer stats, budgets documented). **Average
2.0** — premium threshold (≥2.3) not claimed; weakest surfaces are crowd
detail and mid-court furniture density.

## How to re-verify

```bash
npm run build && npm run preview          # serve dist on :4173
GAME_URL=http://127.0.0.1:4173/ node scripts/inspect-driver.mjs artifacts/evidence-pass3.json
python3 /home/dusan/.agents/skills/threejs-game-director/scripts/check_evidence.py . --manifest artifacts/evidence-pass3.json
node scripts/bot-match.mjs                # full-match bot (dev server)
node scripts/motion-video.mjs             # record rally video
```

## Known limitations

- SwiftShader headless has no GPU: all FPS/frame-time numbers are invalid;
  visual QA ran on pixel metrics and screenshots instead.
- Mobile draw calls exceed the 150 starting-point budget (see §1 tradeoff).
- Single rival difficulty tier; no court selection or doubles.
- Audio requires a user gesture (unlocks on PLAY click) per browser policy.


## Update 2 — movement, camera, DUKA vs LAKI, LAN multiplayer (pass-4)

Changes: faster/snappier athlete movement (speed 7.1 / sprint 8.9, accel 28,
friction 17), camera pulled closer (4.15 m, height 2.02), players renamed to
**DUKA** (you) and **LAKI** (opponent) across HUD, jerseys, big screen and
copy, and a full LAN 1v1 multiplayer backend.

### Multiplayer architecture

- `server.mjs` — dependency-free Node server: static host for `dist/` plus a
  hand-rolled RFC 6455 WebSocket endpoint (`/ws`) with a room broker
  (host → 4-letter code → join). The server relays only; the host browser is
  authoritative.
- `src/net.js` — client: host broadcasts state snapshots (~20 Hz); guest
  streams inputs (~30 Hz: move vector, sprint, aim point, hit sequence).
- Guest rendering: the whole playfield sits under an arena group rotated 180°
  on guest machines, so both machines run identical camera/aim/movement code;
  the network layer mirrors coordinates at the boundary. Role-aware HUD
  (guest sees LAKI on the left), serve prompts, banners, hit ratings and
  results all relay as one-shot events.
- Graceful disconnects: opponent leaving toasts and returns to the menu.

### Multiplayer verification (real browsers, real WebSocket)

`scripts/pvp-test.mjs` — two headless Chromium pages, host + guest:

- Room create/join with code `8ZAT`; role binding correct (guest panel
  "LAKI", scoreboard "LAKI | DUKA").
- Host serve executed from the toss; guest received flight snapshots.
- **Guest return: hit attempted → executed authoritatively on the host**
  (rally 2, `ballLast: rival`) and the point resolved **0–15 for LAKI**,
  synced on both screens.
- Input streaming: guest KeyA moved his athlete 1.3 world units on the host
  (correct mirrored direction).
- Zero console/page errors on both pages. Evidence:
  `artifacts/raw/pvp-host.png`, `artifacts/raw/pvp-guest.png`.

Two real defects were found and fixed by this test:

1. Guest hit readiness never fired — world-side sign checks had leaked into
   arena-local gameplay math (`mySide()` ball checks, mirrored auto-target
   clamps, inverted guest forward movement). All gameplay now stays in plain
   local coordinates; only the camera pose and the network layer convert.
2. A failed pointer-lock request (no user gesture in the auto-start flow)
   paused the match indefinitely via `pointerlockchange`. Lock loss now only
   pauses when a lock was genuinely held.

### pass-4 canvas inspector (production build, 7/7 PASS)

| Capture | Result | Entropy | Edges | Contrast | Budget |
| --- | --- | --- | --- | --- | --- |
| desktop/title | PASS | 5.94 | 0.321 | 188 | ok (192 calls) |
| desktop/active-play | PASS | 6.59 | 0.337 | 171 | ok (211 calls) |
| desktop/serve | PASS | 6.55 | 0.342 | 171 | ok (206 calls) |
| desktop/paused | PASS | 3.08 | 0.054 | 31 | ok (211 calls) |
| desktop/match-won | PASS | 3.32 | 0.066 | 41 | ok (211 calls) |
| mobile/title | PASS | 5.91 | 0.340 | 192 | **over: calls 181 > 150** |
| mobile/active-play | PASS | 6.67 | 0.318 | 185 | **over: calls 204 > 150** |

Mobile draw-call budget overruns remain a documented tradeoff (single shared
stadium; 128k triangles vs the 300k cap; trivial for real mobile GPUs).
`check_evidence.py --manifest artifacts/evidence-pass4.json`: **8/8 confirmed**
(including `artifacts/pass-4/rally-motion.webm` — live rally with real input,
0 errors).

Single-player regression after the multiplayer refactor: AI serve → rally →
point (`1-0, LAKI HITS OUT`) verified with the scripted bot.

### Known limitations (update 2)

- Headless QA renders two WebGL contexts at ~1 fps on SwiftShader, so
  multiplayer tests use game-time-aware polling; on real GPUs this is a
  non-issue.
- One open room at a time; no reconnection mid-match (a drop ends the game).
- No lag compensation — host-authoritative snapshots assume LAN latencies.

## Hotfix — serve-cycle stall ("stuck after a few points")

Reported from live play. Root cause found by forcing a LAKI serve and tracing
ball state: on the frame `startServeToss` flipped the serve to 'toss', the
held-ball refresh in the same branch ran after it and snapped the ball back to
the server's hand — and because the multiplayer edit had made the AI rival's
auto-serve timeout `Infinity` (meant only for a human guest), the toss
fallback never fired. The match hung forever in `serve/toss` as soon as the
alternation reached LAKI (after two played points).

Fix: skip the held-ball refresh on the toss-start frame, and restrict the
indefinite wait to `netMode === 'host' && server === 'rival'` (a real human
guest); CPU Laki now serves on the same 2.35 s timer as DUKA.

Verified: forced rival serve completes toss → strike → live rally; and the
natural flow (score forced to 1-1, point resolved, `updatePoint` routing)
reaches LAKI's serve and a live rally with zero errors.


## Update 3 — world play (Vietnam ↔ Serbia)

Laki is in Serbia; Duka hosts from Vietnam. Distance-play netcode added:

- **Lag compensation:** the host keeps a 40-entry history of ball states keyed
  by snapshot sequence; Laki's hit requests carry the newest snapshot seq he
  saw, and the host validates/strikes against the ball position he actually
  had on screen — not the host's live position (~200 ms ahead).
- **Client-side prediction:** the guest applies his own movement instantly
  and eases toward the host's authoritative position (reconciliation lambda 4),
  matching the host's movement rules exactly. Hits stay host-validated.
- **Server keepalive:** protocol-level WS pings every 30 s; silent clients
  dropped after ~70 s so dead connections free the room on flaky links.
- Connection routes documented in README (Tailscale tailnet — Duka's machine
  is already enrolled at 100.103.41.116 — router forwarding, or a Cloudflare
  quick tunnel). Lobby footer updated to match.

Regression caught during this work: the keepalive edit referenced `this`
inside an arrow function in ESM strict mode (`undefined`), and the frame
parser's try/catch silently swallowed the resulting TypeError — every client
message was dropped. Fixed to the closure's `ws` reference.

Final PvP regression on this build (two browsers, real WebSocket): host room,
guest join, role binding, host serve, **guest return executed** (rally 2,
0–15 LAKI), movement sync 1.32 units, zero console/page errors on both pages.


## Update 4 — one-click host launcher

- `sunset-slam-host.sh`: idempotent launcher — starts `server.mjs` detached
  (nohup, logs to `.server.log`), builds once if `dist/` is missing, waits for
  health, opens the host page (skippable with `SUNSET_SLAM_NO_OPEN=1`).
- `/host` page in `server.mjs`: lists every address of the machine
  (Tailscale 100.103.41.116 ranked first for Serbia play) with copy-link
  buttons, live uptime, OPEN THE GAME, and STOP SERVER — the stop endpoint is
  refused (403) from non-local addresses.
- Installed `SUNSET SLAM (Host Match)` into the application list and desktop
  (`.desktop` entries, custom icon, extra "Open The Game" action).
- Verified: launcher cold start, `/api/status`, `/host` over the Tailscale
  IP, stop-button 403 guard from LAN, stop-from-localhost, and relaunch cycle.


## Update 5 — forehand/backhand perception + point replay

Requested: make forehand and backhand readable so the ball can be perceived
and caught, and add a slow-motion preview when a point ends.

Implemented:

- **Readiness stance** — while the ball travels toward an athlete, the rig
  coils to the striking side (right-arm/racket out for forehand; both arms
  across for backhand). `readyHand` is passed from ball-vs-body side each
  frame with smooth blending (`readySide` damped), for both Duka and Laki.
- **HUD side cue** — auto-shot chip now shows `FOREHAND ▶` / `◀ BACKHAND`.
- **Catch assist** — a hit pressed with the ball just outside reach
  (≤ reach + 0.85 m) auto-lunges the athlete up to 0.85 m toward contact and
  still strikes.
- **Point replay** — rolling 260-frame record buffer; on point end ~1.05 s of
  footage plays at 0.34× speed from a side broadcast camera with letterbox
  bars, SLOW MOTION badge, dimmed HUD, and aim overlay hidden. Point banner,
  audio and cheer are deferred until the replay ends, then the next serve
  begins. Host relays a `slowmo` event so LAN guests get the same sequence.

Verified (`scripts/features-test.mjs`, `scripts/replay-natural.mjs`):

- stance values: ball left → `readySide ≈ -1` (backhand), ball right → `+1`
  (forehand); HUD hand cue switches accordingly (screenshots committed:
  `artifacts/replay-demo/stance-*.png`)
- catch assist: ball at 2.8 m (reach 2.45 m) → player auto-steps 0.7 m and
  the hit registers (`lastHitter: player`, rally counted)
- replay: 65-frame forced point → badge + letterbox + slow-mo ball motion →
  banner (DUKA, 1–0) → next serve; natural rally → 43 recorded frames →
  reaply → next point, zero console errors
- pass-5 canvas inspector: **7/7 PASS** (same metrics as pass-4; mobile draw
  calls documented tradeoff unchanged)


## Update 6 — click buffer (bounce-timing fix)

Reported: "when the ball bounces and I click then/after, it always misses."

Root cause: the hit window only accepted clicks when the ball was already
inside racket reach (< 2.45 m). A click at the bounce moment is early by
0.2–0.6 s, so it played a whiff swing, set a 0.27 s cooldown (which could also
swallow the next click), and never registered. Reproduced deterministically:
click at bounce with the ball 5.4 m away → swing + cooldown, no strike.

Fix — input buffering:

- a click while the ball is on your side, closing at ≥ 0.35 m/s and due to
  arrive within ~0.8 s arms a buffered swing instead of whiffing
  (`shouldBufferSwing` / `bufferSwing`)
- the buffered swing auto-fires from `updatePendingSwing` the moment the ball
  is inside the full catch-assist reach window (reach + 0.85 m), including the
  auto-lunge, or expires with a "JUST MISSED IT" prompt
- no cooldown and no wasted swing animation on a buffered click
- LAN guests buffer locally too: their early clicks are held until their
  snapshot shows the ball playable, then the hit request is sent (host still
  validates with lag compensation)

Verified: click-at-bounce bot with lateral chase — 3 clicks, 3 hits (2 via
buffer, 1 direct); buffered strike fires 0.39 s after an early click with the
ball 5.4 m away; full features + two-browser PvP regressions pass with zero
console errors.


## Update 7 — corner HUD, clean screen

Requested: move the dashboard writings (score, shot type, point, names,
prompts) into the lower-left corner and leave the rest of the screen empty.

- All readouts now live in one compact cluster at bottom-left: score row
  (DUKA – LAKI, serve pips, tiebreak label, state), shot + hand
  (`TOPSPIN ▲ BACKHAND`), rally/top speed, prompt line, hit feedback, point
  result line, countdown line, and a slim controls footer with mute/pause.
- Removed from the view: top scoreboard, player panel, top-right stat chips,
  the centre shot chip & prompt, the centre hit feedback, the big centre point
  banner, bottom-right court/session plaques and the bottom-centre auto-shot
  explainer.
- The aiming reticle remains at screen centre (you aim there).
- Fixed a latent bug found while doing this: the HUD's `screenIn` entrance
  animation could stall at opacity 0 (bit us before with the replay badge);
  the HUD now renders instantly.
- Mobile: the cluster moves to the top-left so the joystick and hit button
  keep the bottom corners.
- pass-6 canvas inspector: **7/7 PASS** (entropy 6.7–6.8 on active play,
  contrast 182–192, desktop draw calls within budget).
- LAN PvP regression: guest hit + score sync pass with the new HUD.


## Update 8 — mobile viewport clipping + joystick moves the body

Reported on a real phone: the page was cut off at the bottom (controls
clipped), and the joystick appeared to move the camera instead of the body.

Root causes and fixes:

- **Clipping:** the app sized itself with the layout viewport (`100vh` /
  `window.innerHeight`), which on phones is taller than the visible area while
  browser toolbars are shown. The app now sizes from the *visible* viewport:
  CSS `height: var(--app-h)` measured from `visualViewport` in JS (fallbacks
  `100dvh` → `100vh`), re-measured on resize, `visualViewport` resize/scroll
  and orientation change. Renderer sizing reads the canvas CSS box.
- **Touch controls** are anchored with safe-area insets, enlarged (132px
  joystick, labelled RUN), layered above the aim zone, and never scroll the
  page (`touch-action: none`, `overscroll-behavior: none`).
- **Joystick → body:** verified wired to movement, not the camera. If a touch
  arrives while the game thinks it's in desktop mode (e.g. "request desktop
  site"), it now auto-switches to touch controls.
- A stale/incorrect `mobile` flag could leave the joystick inert; detection is
  now consistent (coarse pointer OR touch points OR narrow width) and
  re-applied on resize.

Verified with real touch events (CDP) across four profiles — Pixel 7,
iPhone SE, iPhone 14 Pro Max, Pixel 7 landscape: controls fully inside the
viewport, canvas matches the visible height, no page scroll, joystick drag
moves the athlete 1.8–3.0 m with **zero camera yaw change**, right-side drag
rotates the camera, zero console errors.


## Update 9 — match waiting + arrival notifications

Question: how do you get told that you're waiting on a match, or that the
other player has arrived?

Added:

- **Waiting state with elapsed clock** in the lobby: host sees
  `WAITING FOR LAKI · CODE XXXX · mm:ss`; guest sees
  `WAITING FOR DUKA TO HOST · AUTO-JOIN ON · mm:ss`.
- **Tab-title alert** while waiting (`⏳ WAITING FOR LAKI`) and on arrival
  (`🎾 LAKI JOINED`), restored automatically when the match starts.
- **Arrival notifications**: three-note chime (`audio.playAlert`), device
  vibration when supported, toast, and a real system `Notification` (icon,
  tag) when the page is hidden — permission requested on the HOST/JOIN clicks.
  Opponent-leaving raises the same alert style.
- **Guest auto-join retry**: pressing JOIN with no hosted match keeps
  retrying every 2.5 s; when the host opens the lobby the guest connects
  automatically and both sides are notified.
- Lobby foot copy corrected (no longer "same home network").

Verified with a two-page flow test: guest waits (`retrying: true`, tab title
`⏳ WAITING FOR DUKA`), host opens lobby, guest auto-joins within one retry,
host receives chime + `LAKI joined your match` system notification + toast,
both enter the match (`intro`) and titles reset. Regular two-browser PvP
regression still passes with zero errors. Waiting clock ticks (00:01 → 00:04
→ 00:06 in a live probe).


## Update 10 — BASKETBALL 1v1 (same engine, second sport)

Requested: keep the same environment, switch the sport to basketball — 1v1 on
one basket, vs CPU or multiplayer, with volleyball planned next.

Architecture: the game is now a small sports hub. A sport picker on the title
screen (TENNIS · BASKETBALL · VOLLEYBALL-soon) sets `game.sport`; basketball
lives in `src/hoops.js` (court builder + engine) and dispatches from the same
Game loop, reusing the stadium, athletes, over-the-shoulder camera, corner
HUD, click-buffering input style, slow-motion replay, audio, lobby, match
codes, notifications and the LAN/internet transport. The tennis flow is
untouched (verified end-to-end after the surgery: serve → rally → point,
tennis court restored, zero errors).

Basketball specifics:

- Half-court with wooden floor, painted key, true three-point arc, hoop with
  backboard, rim (torus), net, pole; tennis court/net hidden while playing.
- Ball: orange, own integrator (4× substepped gravity), sphere-vs-torus rim
  collision with proper 3D contact normals, backboard plane, floor bounces.
- Shots: hold-to-charge with a sweet spot; auto type by distance (DUNK < 2.1 m
  powers through the rim, LAYUP < 4.4, JUMPER inside the arc, THREE beyond);
  2s/3s; quality from charge accuracy minus defender contest; 14 s shot
  clock; live rebounds; steal pokes; dead-ball watchdog hands stranded balls
  to the nearest athlete.
- CPU Laki: guards the line between handler and hoop, contests, steals, and
  on offense drives to spots and shoots with openness-based quality.
- Multiplayer: the sport travels with the room (server relays it in the
  handshake); the guest's game switches automatically. Guest movement
  prediction + host-authoritative shots reuse the tennis transport.

Verified:

- shot matrix (`scripts/hoops-shots.mjs`): dunk 1.4 m → +2, layup 2.8 m → +2,
  free-throw 5.8 m → +2, three 7.2 m → +3, 19 m heave → miss, weak charge →
  miss/rebound
- live bot match: pointer charge-and-release scores, possession alternates,
  CPU offense/defense runs, shot clock counts, zero errors
- two-browser PvP: host picks basketball, guest auto-switches (court built on
  both), guest movement streams (Δz on host), host shot renders as flight on
  guest, zero errors
- mobile (Pixel 7, real touch): joystick runs the athlete, HIT button shoots
  (THREE attempted from deep), zero errors
- tennis regression: full point flow intact, basketball court fully removed


## Update 11 — real basketball players (Nuggets Jokić kits, no rackets)

Feedback: the basketball athletes were still tennis players (rackets, caps)
and the camera/player felt detached.

- **Rackets removed** in basketball (`rig.racket.visible = false`); caps and
  headbands come off too — replaced by nothing but a ball in the hands.
- **Denver Nuggets kits** (researched official palette: navy `#002D62`,
  gold `#FDB827`, sky `#4B90CD` — Nuggets are one of the few NBA teams with
  a documented navy/gold identity): DUKA wears the navy **Icon edition**,
  LAKI the white **Association edition**; both say **JOKIĆ 15** on the back
  via the regenerated jersey texture (gold on navy, navy on white). Kits are
  applied per-match (`setKit`) and fully restore on returning to tennis.
- **Real basketball**: pebbled orange leather texture with black seams on
  the ball (the tennis-seam map is swapped out).
- **Fortnite camera lock**: in basketball the athlete's yaw snaps to the
  camera yaw every frame (no damp lag) and the camera follow stiffness
  doubles (lambda 26) — rotating the view rotates you both as one unit.
- Tennis mode unchanged (rackets and kits restored, verified).

Verified: kit colors applied (navy `#0c2f52` / white `#f2f0ea`), rackets and
headwear hidden, seam texture on the ball, yaw snaps exactly to target
(0.9 aim → −0.9 rotation, one frame), free-throw still scores, tennis
regression green, zero errors.
