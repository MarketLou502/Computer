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
- Nothing else to configure after install — `BootReceiver` launches the
  dashboard on boot, and Home/Back deliberately behave like they would for
  any normal app (see "Home/Back behavior" below), so there's no HOME-role
  step to worry about.
- Watch logs live with `adb logcat | grep -i echodash` while testing
  reconnect/retry behavior (e.g. turn off the Mac Mini's Wi-Fi mid-session).

## Jailbreak steps (crown → LineageOS)

Real brick risk — this isn't a "follow along casually" process. Treat the
[crown XDA thread](https://xdaforums.com/t/unlock-root-twrp-unbrick-amazon-echo-show-8-1st-gen-2019-crown.4766687/)
as the live source of truth for exact current download links/file versions;
what's below is the verified sequence, not a substitute for checking there.

**Before starting:** Kindle Fire USB Driver (Windows), Android SDK Platform
Tools, `amonet-crown.zip` (crown-specific — not `checkers`/`cronos`, those
are Echo Show 5), the crown-specific `boot-root.img`, LineageOS 18.1 for
crown (bengris32), **MindTheGapps** (for Play Store access — see the
Home/Back redesign above for why this matters now), a micro-USB cable.
Two ways to brick it: using the wrong model's `boot-root.img`, or wiping
anything beyond system/data/cache in TWRP.

1. **Firmware, then go offline.** Complete FireOS setup, update until on
   exactly **6.5.7.1**, then disconnect Wi-Fi so it can't patch the exploit
   out from under you.
2. **Run the exploit.** Pull power, hold all three top buttons, apply power
   (shows "FASTBOOT mode"). Connect micro-USB. From an elevated command
   prompt in the `amonet-crown` folder: `fastbrick.bat`, confirm **YES**.
   Reboots into TWRP on its own.
3. **Unlock bootloader flags.** Pull power, hold **Mute**, apply power
   ("Hacked fastboot mode"). `fastboot devices` to confirm detection, then
   `fastboot oem flags 61`, `fastboot flash boot boot-root.img` (crown
   file), `fastboot reboot`. Let it boot to FireOS home once, pull power.
4. **Flash LineageOS + MindTheGapps.** Hold **Volume Up**, apply power
   (TWRP again). `adb push` both the LineageOS zip and the MindTheGapps zip
   to `/sdcard/`. In TWRP: **Wipe → Advanced Wipe** → check only **System,
   Data, Cache** → confirm. Back to TWRP home → **Install** → select the
   LineageOS zip → **Install Image** → without rebooting yet, **Install**
   again → select the MindTheGapps zip → **Install Image** → then **Reboot**,
   swipe to confirm. First boot shows LineageOS's white welcome screen.
5. **Enable dev access.** Walk through setup. **Settings → About Tablet** →
   tap build number 7×. **Settings → System → Advanced → Developer Options**
   → enable USB Debugging, approve the on-device prompt. `adb devices` from
   the laptop to confirm.
6. **Install `kiosk-app`.** `cd kiosk-app && ./gradlew assembleDebug`, then
   `adb install -r app/build/outputs/apk/debug/app-debug.apk`. No HOME-role
   setup needed — see the Home/Back redesign above. Long-press the dashboard
   to open the config dialog and point it at the Mac Mini's OpenClaw URL +
   token.
7. **Screen/power tweaks.** Settings → Display → screen timeout: Never;
   disable Daydream/screensaver. Switch `adb` to Wi-Fi (`adb tcpip 5555`
   once over USB, then `adb connect <device-ip>:5555`) so future updates
   don't need the cable.

Root (Magisk) is optional and skippable — nothing `kiosk-app` does needs it,
every command above runs over plain `adb shell`.

## "crown" jailbreak quirks that affect a kiosk app

- **Home/Back behavior is deliberate, not a gap.** `MainActivity` doesn't
  override Back or Home — leaving the dashboard via either drops you on
  LineageOS's real home screen, same as any normal app, and reopening the
  dashboard is just tapping its icon like any other app. This was a
  conscious design choice (see git history) over the alternative — making
  `kiosk-app` the HOME app and swallowing Back/Home so the dashboard could
  never be left accidentally — once it was clear the goal was "easy for
  anyone in the house to step in and out of," not "locked down."
- **Amazon's launcher isn't a concern on this plan.** `com.amazon.paladin` /
  the Alexa home UI only exists on *rooted stock FireOS* — this project's
  jailbreak plan does a full LineageOS flash, which wipes FireOS entirely,
  Paladin included. Nothing re-grabs the foreground here. (If a future
  reinstall ever ends up on rooted stock FireOS instead, that package would
  need disabling — `adb shell pm disable-user --user 0 com.amazon.paladin`
  — but that's not this project's path.)
- **`BootReceiver` is the only auto-launch mechanism, not a backup.** Since
  `kiosk-app` deliberately isn't registered as HOME, Android has no built-in
  reason to launch it on boot — `BootReceiver`'s `BOOT_COMPLETED` listener is
  what makes the dashboard the first thing shown after a reboot.
- **Screen timeout / screensaver is a separate setting from what this app
  controls.** `FLAG_KEEP_SCREEN_ON` keeps the screen alive while
  `MainActivity` is in the foreground, but also turn off Android's own
  screen-timeout in Settings → Display (set to "Never") and, on LineageOS,
  disable Daydream/screensaver — otherwise a system-level screensaver can
  still cover the dashboard even with the activity flag set.
- **Play Services aren't required by anything here, but the plan flashes
  MindTheGapps anyway.** `kiosk-app` itself never depends on GMS/Play
  Services — the dashboard is a plain WebView, nothing about it needs Google
  APIs. MindTheGapps is purely so the device is a usable general-purpose
  tablet (Play Store access) when someone steps out of the dashboard, per
  the Home/Back redesign above — see the jailbreak steps for where it gets
  flashed. If you later want push-triggered wake (OpenClaw nudging the
  screen the instant a goal is checked off remotely, say), GApps being
  present opens up FCM as an option; a persistent WebSocket in the WebView's
  JS works either way (device is always plugged in, never idles into Doze
  the way a battery phone would). Start with polling (already implemented
  in `app.js`); only add a WebSocket if 30–60s staleness on the
  calendar/health widgets actually bothers you.

## Planned: voice control ("Computer")

Not built yet — pending hardware purchase. Independent track: doesn't block
or get blocked by the kiosk/jailbreak work above. Decision and research
captured here so it doesn't need to be re-litigated later.

### Decision: don't use the Echo Show's own mic/speaker

Investigated first, rejected on evidence, not guesswork:

- LineageOS builds for crown have a known mic bug — records fine once per
  boot, then goes silent on the second attempt until the device is rebooted
  or the audio server restarted. Some builds also shipped with the mic too
  quiet until later fixes ([XDA LineageOS 18.1 thread for crown](https://xdaforums.com/t/rom-unofficial-11-crown-lineageos-18-1-for-the-amazon-echo-show-8-2019.4766709/)).
- No prior art: the most directly comparable community project — jailbreaking
  crown specifically to run as a Home Assistant touchscreen dashboard —
  covers jailbreaking and dashboard apps in depth but never touches voice; a
  reader asking how to get the speaker working got no real answer
  ([Home Assistant: The Complete Echo Show Jailbreak Guide](https://www.derekseaman.com/2025/11/home-assistant-hacking-your-echo-show-5-and-8.html)).

Conclusion: the mic/speaker are gated behind Amazon's proprietary DSP
firmware that was never reverse-engineered for these ROMs — same story as
camera support on most jailbroken IoT devices. Not worth fighting.

### Decision: Home Assistant Voice Preview Edition, custom-flashed

Same "thin client, brains stay centralized" philosophy as the kiosk itself —
add a second, purpose-built thin client for voice rather than overloading the
display device. Wall-powered via USB-C, not battery — see the power note
below for why that's a deliberate choice, not an oversight.

- **Hardware: Home Assistant Voice Preview Edition** (~$69 MSRP; buy from an
  [authorized distributor](https://www.home-assistant.io/voice-pe/) — Seeed
  Studio doesn't ship to the US, [ameriDroid](https://ameridroid.com/products/home-assistant-voice-preview-edition/)
  does). Official Nabu Casa/Home Assistant hardware, not a hobbyist dev
  board: real enclosure, physical mute switch, LED ring, dual mic array —
  built specifically to sit visibly in a home rather than look like an
  exposed circuit board.
  - Considered and passed over: **M5Stack Atom VoiceS3R** (~$14.50, single
    integrated dev-kit cube) and **AtomS3R + Echo Pyramid base** (~$40–50,
    RGB-lit speaker base for the Atom module) — both fully capable
    technically (same chip family, same wake-word engine), but neither
    matches the "looks like it belongs on the counter" bar once quality —
    not just cost — became the priority.
  - Voice PE only ships three wake words in its official app ("Okay Nabu" /
    "Hey Jarvis" / "Hey Mycroft"), which is why it was passed over
    initially. It's back in because the wake-word gap turned out to be a
    config limitation, not a hardware one — see below.
- **Wake word: "Computer."** An official, pre-trained **`microWakeWord`**
  model — a correction from the first two passes at this section, which
  planned first around `openWakeWord`, then around a cheaper board under the
  assumption Voice PE couldn't run a custom word at all. Neither held up:
  `openWakeWord` (source of the original pre-trained "hey computer" model)
  generally can't run locally on an ESP32 at all — it needs the device to
  continuously stream raw audio over Wi-Fi to a server that does the
  matching remotely. `microWakeWord` is the engine that actually runs
  on-chip, sending audio only once the word is heard, and it has its own
  separate official model simply called "Computer"
  ([esphome/micro-wake-word-models](https://github.com/esphome/micro-wake-word-models)).
  Voice PE runs this exact same engine under the hood — Nabu Casa's app just
  only exposes 3 of the possible model files in its dropdown. Nothing about
  the firmware itself restricts it to those three: `micro_wake_word`'s
  ESPHome config is just a line referencing a model file, and the device
  flashes over USB-C through ESPHome's standard browser-based installer —
  no soldering, one-time effort. A community project publishes exactly this
  for Voice PE ([MorningstarOwl/wake-word-models](https://github.com/MorningstarOwl/wake-word-models),
  "Micro Wake Word models compatible with the Home Assistant Voice PE") —
  swap its config to point at the official "Computer" model instead of one
  of the three defaults, reflash, done.

### Power: wall-powered, not battery — checked, not assumed

Looked into a battery pack (M5Stack's own "Atomic Battery Base," 200mAh,
~$6) so this could sit cordless on the island. Real-world numbers from the
community: about **1 hour of runtime for ~20 voice interactions** on that
battery — continuous mic sampling plus a Wi-Fi radio that has to stay
reachable is an inherently power-hungry combination, the same reason no
commercial smart speaker (Echo, Nest, HomePod, Voice PE) runs untethered.
Sticking with USB-C wall power as the primary source; a battery base could
still be added later purely as a brief-outage buffer, not as how it runs
day to day.

### Backend architecture

```
kitchen satellite (Home Assistant Voice PE, custom-flashed, Wi-Fi only, wall-powered)
  → on-device wake word ("Computer", microWakeWord, runs on the ESP32-S3 itself)
  → streams command audio over LAN to Whisper (STT, Docker container on the Mac Mini)
  → Home Assistant Assist (intent matching)
  → calls OpenClaw's existing /api/* routes — same surface the dashboard uses
  → Piper (TTS, Docker container) generates the spoken reply
  → played back on the satellite's own speaker
```

Runs as Docker Compose on the Mac Mini, alongside OpenClaw: Home Assistant
Container + Whisper + Piper, wired together via HA's Assist pipeline
settings. No separate wake-word server container needed — that's the point
of the on-device engine (this simplifies the earlier plan, which assumed an
`openWakeWord` container). Docker Desktop on macOS doesn't do local mDNS
auto-discovery as cleanly as Linux, so first-time pairing of the satellite
may need the Mac Mini's IP entered manually rather than relying on discovery.

### What's not built yet (this feature specifically)

- Hardware purchase — Home Assistant Voice Preview Edition, ~$69, via
  [ameriDroid](https://ameridroid.com/products/home-assistant-voice-preview-edition/)
  (Seeed Studio doesn't ship to the US).
- The one-time custom reflash to swap in the "Computer" `microWakeWord`
  model in place of the three stock options — see
  [MorningstarOwl/wake-word-models](https://github.com/MorningstarOwl/wake-word-models).
- The Docker Compose stack on the Mac Mini (Home Assistant + Whisper +
  Piper).
- The bridge from Home Assistant Assist intents to OpenClaw's `/api/*` routes
  — a new caller of the same routes the dashboard already needs, no new
  OpenClaw surface beyond what's already planned below.
- A personalization pass, only if accuracy ends up needing it once it's in
  daily use — real recordings from the kitchen fed through `microWakeWord`'s
  own training tooling. Not assumed necessary up front, since "Computer"
  ships as an official curated model rather than something trained from
  scratch.

## What's not built yet

- The OpenClaw-side `/api/*` routes themselves — `app.js`'s top comment
  documents the exact request/response shape each widget expects.
- A real launcher icon — actually matters now (unlike when this app was
  planned as the HOME replacement): it's what someone taps in the app drawer
  to get back to the dashboard after stepping away from it.
- Anything beyond polling for freshness (see the WebSocket note above) — not
  needed until polling actually feels stale in practice.
- Voice control — see "Planned: voice control" above.
