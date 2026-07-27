# Echo Show Dashboard

A stationary kiosk dashboard for a jailbroken 1st-gen Echo Show 8 ("crown"),
displaying state owned by OpenClaw on the Mac Mini. Build status is tracked
on the "Echo Show Dashboard" Kanban board in the `Projects/` folder of the
Obsidian vault (`Aaron Obsidian/Aaron/Projects/Echo Show Dashboard.md`) — the
vault is also the data source behind the task-list, daily-goals, and grocery
widgets (see `Computer/README.md` in the vault for the schema).

## Recommendation: WebView kiosk (confirmed)

Your instinct was right — go with a thin native wrapper around a WebView,
not a full native (Kotlin) app. Reasoning:

- **The bottleneck isn't rendering, it's iteration speed.** This dashboard
  will get tweaked constantly (layout, widgets, goal names). A web change is
  edit-and-reload; a native change is a Gradle build + adb install + app
  restart, over USB or a flaky Wi-Fi ADB connection, every single time.
- **The hardware doesn't punish WebView here.** The hard constraint on old,
  weak Android hardware is usually *heavy JS frameworks and animation*, not
  WebView itself — Chrome WebView is a system component the OS already keeps
  resident. A mostly-static dashboard with a handful of DOM updates a minute
  is nowhere near what would make native meaningfully faster. `dashboard-web/`
  is deliberately vanilla JS/CSS with no framework, so it stays light on the
  crown's MediaTek SoC regardless.
- **Single source of truth.** All the real logic (calendar sync, financial
  tracking, task state) already lives in OpenClaw. A WebView keeps the device
  a pure display+input client, matching what you described — no business
  logic drifts onto the device to get out of sync.
- **Where native would actually win, and doesn't apply here:** sub-frame
  touch latency for something like a game or drawing app, complex custom
  Canvas/OpenGL rendering, or deep background-service integration (foreground
  services, push-triggered wake). None of that applies to a plugged-in,
  always-on display that polls a LAN endpoint every 30-300 seconds.
- **The one real WebView downside — long-lived memory bloat** — is mitigated
  cheaply: `MainActivity` force-reloads the WebView every 30 minutes
  (`RELOAD_INTERVAL_MS`), which resets any JS heap/DOM leak growth without a
  visible flicker longer than a normal page load.

If a future widget needs something a WebView genuinely can't do (camera feed,
low-latency sensor readout), add it as a small native module bridged in via
`WebView.addJavascriptInterface` rather than rewriting the whole app.

## Repo layout

```
EchoShowDashboard/
├── kiosk-app/              Android kiosk wrapper (Kotlin, plain Gradle)
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── java/com/aaron/echodash/
│   │   │   ├── MainActivity.kt     fullscreen WebView, retry/reload, config dialog
│   │   │   └── BootReceiver.kt     backup auto-launch on boot
│   │   └── res/
│   │       ├── layout/activity_main.xml   WebView + "Reconnecting…" overlay
│   │       ├── values/{strings,themes}.xml
│   │       └── xml/network_security_config.xml   allows LAN http://
│   ├── app/build.gradle.kts
│   ├── build.gradle.kts
│   └── settings.gradle.kts
└── dashboard-web/           Static dashboard UI — this is what OpenClaw serves
    ├── index.html           layout: goals bar / calendar + 3 task columns / health + financials + grocery
    ├── style.css            dark theme, CSS custom properties, no framework
    └── app.js               fetch() against OpenClaw's REST API, falls back to
                              embedded mock data if the Mac Mini is unreachable
```

`dashboard-web/` is meant to be copied into (or served directly from) wherever
OpenClaw hosts local web assets — it has no build step, it's just three
static files. Point OpenClaw's HTTP server at this folder and implement the
`/api/*` routes `app.js` already calls (see the comments at the top of
`app.js` for the exact shape of each response).

## Auth: shared LAN token

This is LAN-only and single-user, so a shared secret is enough — no OAuth,
no per-request signing:

1. Generate one random token (e.g. `openssl rand -hex 24`) and hardcode it
   into OpenClaw's API middleware — reject any request without a matching
   `Authorization: Bearer <token>` header.
2. Long-press anywhere on the dashboard in the kiosk app to open the
   connection-settings dialog (`MainActivity.showConfigDialog`) and enter the
   dashboard URL + that same token. It's stored in `SharedPreferences`.
3. The kiosk app appends `?token=<token>` to the initial page load.
   `app.js` reads it out of `location.search` on boot and attaches it as an
   `Authorization: Bearer` header on every subsequent `fetch()` it makes —
   so the token only needs to be typed once on the device, and OpenClaw
   never has to special-case the *first* request differently from the rest.

If you ever expose OpenClaw beyond the LAN (remote access, a phone app),
swap this for real auth first — a static bearer token is only appropriate
because nothing but your home Wi-Fi can reach that port.

## Dev / deploy loop

**Web side (`dashboard-web/`) — iterate here, it's most of the work:**
- Run any static file server pointed at `dashboard-web/` (`python3 -m http.server 8080`,
  or whatever OpenClaw already uses) and open it in a desktop browser at
  1280×800 to match the device's resolution while you iterate on layout.
- Once OpenClaw's `/api/*` routes exist, point the kiosk app at OpenClaw
  directly — no APK rebuild needed for any web-side change, just edit and the
  WebView's next reload (or your own pull-to-refresh gesture, if you add one)
  picks it up.

**Android side (`kiosk-app/`) — only touched when the wrapper itself changes:**
- Open `kiosk-app/` as its own project in Android Studio (or `cd kiosk-app && ./gradlew assembleDebug` from the CLI — run `gradle wrapper` once first if the wrapper jar isn't present).
- **USB, first install:** enable Developer Options + USB debugging on the
  crown device (Settings → About → tap Build Number 7×, then Developer
  Options → USB debugging). `adb devices` should list it once connected.
  `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
- **Over LAN after that (no more cables):** with the device on the same
  Wi-Fi, `adb tcpip 5555` (once, over USB), unplug, then
  `adb connect <device-ip>:5555`. From then on `adb install -r …` and
  `adb logcat` both work wirelessly. Re-run `adb tcpip 5555` if the device
  reboots and drops the pairing.
- After install, if the app isn't already the default launcher:
  `adb shell cmd package set-home-activity com.aaron.echodash/.MainActivity`
  (needs the "set as HOME" step below to have made it eligible first).
- Watch logs live with `adb logcat | grep -i echodash` while testing
  reconnect/retry behavior (e.g. turn off the Mac Mini's Wi-Fi mid-session).

## "crown" jailbreak quirks that affect a kiosk app

- **Amazon's launcher (`com.amazon.paladin` / the Alexa home UI) will keep
  re-grabbing the foreground unless it's dealt with.** Per the crown
  jailbreak's own documented steps, either disable that package outright
  (`adb shell pm disable-user --user 0 com.amazon.paladin`, or the
  equivalent Magisk module if you're on rooted stock FireOS rather than a
  full LineageOS flash) or make sure `kiosk-app` wins the HOME role and stays
  set. `AndroidManifest.xml` already registers `MainActivity` for both
  `CATEGORY_LAUNCHER` and `CATEGORY_HOME` so it's eligible to be picked as
  the default HOME app — set it explicitly with `adb shell cmd package
  set-home-activity com.aaron.echodash/.MainActivity` rather than relying on
  Android's disambiguation dialog (there's no way to tap "always" on a
  device with no other input method once this app is fullscreen).
- **Rooted-stock-FireOS vs. full LineageOS behave differently on boot.** On
  a full LineageOS flash, being the default HOME app is normally sufficient
  — Android launches your HOME app on every boot by design, and
  `BootReceiver` is redundant but harmless. On rooted stock FireOS with the
  bouncer disabled, Amazon's own boot-time services are still present
  underneath and can re-assert the Alexa UI after a reboot even if you
  disabled Paladin — if you see the dashboard get replaced by the Alexa
  screen after a *reboot* specifically (but not otherwise), that's what's
  happening, and the fix is disabling the specific Amazon boot-time
  service/receiver responsible (varies by FireOS build — check the crown
  XDA thread's current list of packages, since Amazon has changed these
  across OTA updates).
- **Screen timeout / screensaver is a separate setting from what this app
  controls.** `FLAG_KEEP_SCREEN_ON` keeps the screen alive while
  `MainActivity` is in the foreground, but also turn off Android's own
  screen-timeout in Settings → Display (set to "Never") and, on LineageOS,
  disable Daydream/screensaver — otherwise a system-level screensaver can
  still cover the dashboard even with the activity flag set.
- **No Play Services assumed.** Nothing here depends on GMS/Play Services —
  intentional, since a LineageOS crown flash may or may not have GApps
  installed. If you later want push-triggered wake (OpenClaw nudging the
  screen the instant a goal is checked off remotely, say), that would need
  either a persistent WebSocket held open in the WebView's JS (works with no
  Play Services, just don't let Doze kill it — not a concern here since the
  device is always plugged in and never idles into Doze the way a battery
  phone would) or FCM if GApps are present. Start with polling
  (already implemented in `app.js`); only add a WebSocket if 30–60s
  staleness on the calendar/health widgets actually bothers you.

## What's not built yet

- The OpenClaw-side `/api/*` routes themselves — `app.js`'s top comment
  documents the exact request/response shape each widget expects.
- A launcher icon (cosmetic only — irrelevant once this app is the default
  HOME app and the app drawer is never seen).
- Anything beyond polling for freshness (see the WebSocket note above) — not
  needed until polling actually feels stale in practice.
