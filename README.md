# head-scroll.js

> Scroll any element using head tilt — powered by MediaPipe FaceMesh.  
> One script tag. No dependencies. Works everywhere.

[![MIT License](https://img.shields.io/badge/license-MIT-00f5ff?style=flat-square)](LICENSE)
[![Demo](https://img.shields.io/badge/demo-live-39ff14?style=flat-square)](https://YOUR_USERNAME.github.io/head-scroll/demo/)

---

## What it does

`head-scroll.js` uses your webcam and **MediaPipe FaceMesh** to track the tilt of your head in real time.  
When you tilt your head down → scroll down. Tilt up → scroll up.  
Speed is proportional to tilt angle. A configurable **dead zone** prevents accidental scrolling.

**All processing is local — no video data ever leaves your browser.**

---

## Quick Start

### Option 1 — CDN (fastest)

```html
<!-- Add before </body> -->
<script src="https://cdn.jsdelivr.net/gh/YOUR_USERNAME/head-scroll/head-scroll.js"></script>

<script>
  const hs = new HeadScroll();
  hs.start();  // asks for camera, auto-calibrates, scrolls window
</script>
```

### Option 2 — Download

```bash
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/head-scroll/main/head-scroll.js
```

Then include locally:

```html
<script src="./head-scroll.js"></script>
```

### Option 3 — npm

```bash
npm install head-scroll
```

```js
import HeadScroll from 'head-scroll';

const hs = new HeadScroll();
hs.start();
```

> **Note:** Must be served over `https://` or `localhost`.  
> Camera access is blocked on `file://` URLs.

---

## Usage Examples

### Minimal — scroll window

```js
const hs = new HeadScroll();
hs.start();
```

### Scroll a specific element

```js
const hs = new HeadScroll({
  target:    document.getElementById('my-list'),
  threshold: 0.03,   // more sensitive (default: 0.04)
  maxSpeed:  12,     // slower scroll  (default: 18)
});
hs.start();
```

### Headless + callbacks (React / game integration)

```js
const hs = new HeadScroll({
  showHUD: false,

  onCalibrated: (neutralY) => {
    console.log('Ready! Neutral Y:', neutralY);
  },

  onFrame: ({ delta, scrolling }) => {
    // scrolling === 'up' | 'down' | 'none'
    if (scrolling === 'down') nextCard();
    if (scrolling === 'up')   prevCard();
  },

  onStatus: (type, msg) => {
    // type === 'ok' | 'loading' | 'error'
    updateMyStatusUI(type, msg);
  },
});

hs.start();
```

### Manual calibration

```js
const hs = new HeadScroll({ autoCalibrate: false });
await hs.start();

document.getElementById('cal-btn').addEventListener('click', async () => {
  const neutralY = await hs.calibrate();
  console.log('Calibrated to Y =', neutralY);
});
```

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `target` | `Element` | `null` | Element to scroll. `null` = window. |
| `threshold` | `number` | `0.04` | Dead-zone (0–1). Smaller = more sensitive. |
| `maxSpeed` | `number` | `18` | Max scroll speed (px/frame). |
| `calibrationFrames` | `number` | `90` | Frames to sample (~3 sec at 30 fps). |
| `autoCalibrate` | `boolean` | `true` | Auto-calibrate on first face detection. |
| `showHUD` | `boolean` | `true` | Show draggable status widget. |
| `mediapipeCDN` | `string` | jsdelivr | Override for self-hosting MediaPipe. |
| `onStatus` | `function` | `null` | `(type, message)` — called on status change. |
| `onFrame` | `function` | `null` | `({ noseY, neutralY, delta, scrolling })` — called every frame. |
| `onCalibrated` | `function` | `null` | `(neutralY)` — called after calibration. |

---

## Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Request camera, load MediaPipe, begin tracking. |
| `stop()` | `void` | Stop tracking, release camera, remove HUD. |
| `calibrate()` | `Promise<number>` | Trigger calibration. Resolves with `neutralY`. |
| `setNeutralY(y)` | `void` | Manually override neutral position. |

---

## How It Works

1. Requests webcam via `getUserMedia`
2. Loads MediaPipe FaceMesh (468 facial landmarks)
3. Tracks **landmark #4** (nose tip) across frames
4. Computes delta from the calibrated neutral Y position
5. If `|delta| > threshold` → scrolls proportionally to delta magnitude

```
Tilt Down:  noseY increases  → delta > 0  → scroll down
Tilt Up:    noseY decreases  → delta < 0  → scroll up
Dead zone:  |delta| < 0.04   → no scroll
```

---

## Calibration

During calibration the library samples `calibrationFrames` frames and averages the nose Y position.  
This becomes the personal neutral baseline for that session.

- By default, calibration triggers **automatically** ~0.5s after the first face is detected.
- Call `hs.calibrate()` any time to recalibrate (e.g. after changing sitting position).
- Or set `autoCalibrate: false` and manage it yourself.

---

## Browser Support

Works in any browser that supports `getUserMedia` over a **secure context** (`https://` or `localhost`):

| Browser | Min Version |
|---------|-------------|
| Chrome  | 60+ |
| Edge    | 79+ |
| Firefox | 36+ |
| Safari  | 11+ |

---

## Repository Structure

```
head-scroll/
├── head-scroll.js      ← Main library (UMD, ~12 KB)
├── demo/
│   └── index.html      ← Interactive demo + docs
├── examples/
│   ├── basic.html      ← Minimal example
│   ├── element.html    ← Scroll a specific element
│   └── callbacks.html  ← onFrame / onCalibrated usage
├── README.md
├── LICENSE
└── package.json
```

---

## Serving Locally

```bash
# Python
python -m http.server 8080

# Node
npx serve .

# Then open:
# http://localhost:8080/demo/
```

---

## License

MIT © YOUR_NAME
