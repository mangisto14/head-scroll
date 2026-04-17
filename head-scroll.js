/*!
 * head-scroll.js v1.0.0
 * Scroll any element using head tilt — powered by MediaPipe FaceMesh
 * https://github.com/YOUR_USERNAME/head-scroll
 * MIT License
 */

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? module.exports = factory()
    : typeof define === 'function' && define.amd
      ? define(factory)
      : (global.HeadScroll = factory());
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {

  'use strict';

  // ─────────────────────────────────────────
  //  Default Options
  // ─────────────────────────────────────────

  const DEFAULTS = {
    /** Element to scroll. Defaults to window. */
    target: null,

    /** Tilt threshold (0–1) before scrolling begins. Smaller = more sensitive. */
    threshold: 0.04,

    /** Maximum scroll speed in px per frame. */
    maxSpeed: 18,

    /** Number of frames to sample during calibration. */
    calibrationFrames: 90,

    /** Automatically calibrate on first face detection. */
    autoCalibrate: true,

    /** Show the built-in HUD overlay. */
    showHUD: true,

    /** MediaPipe CDN base URL (override for self-hosting). */
    mediapipeCDN: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/',

    /** Use eye gaze direction (up/down) instead of head tilt. Requires iris landmarks. */
    eyeGaze: false,

    /** Gaze ratio dead-zone threshold (0–1). Used when eyeGaze is true. */
    gazeThreshold: 0.08,

    /** Called when status changes. Receives (status: string, message: string). */
    onStatus: null,

    /** Called every frame with face data. Receives ({ noseY, neutralY, delta, scrolling }). */
    onFrame: null,

    /** Called once when calibration completes. Receives (neutralY: number). */
    onCalibrated: null,
  };

  // ─────────────────────────────────────────
  //  HeadScroll Class
  // ─────────────────────────────────────────

  /**
   * @class HeadScroll
   * @description Enables hands-free scrolling via head tilt using MediaPipe FaceMesh.
   *
   * @example
   * // Minimal setup — scrolls window
   * const hs = new HeadScroll();
   * hs.start();
   *
   * @example
   * // Scroll a specific element, custom threshold
   * const hs = new HeadScroll({
   *   target: document.getElementById('my-list'),
   *   threshold: 0.03,
   *   maxSpeed: 12,
   * });
   * hs.start();
   *
   * @example
   * // Headless (no HUD) with event callbacks
   * const hs = new HeadScroll({
   *   showHUD: false,
   *   onCalibrated: (y) => console.log('Neutral Y:', y),
   *   onFrame: ({ delta, scrolling }) => {
   *     if (scrolling === 'down') myElement.classList.add('active');
   *   },
   * });
   * hs.start();
   */
  class HeadScroll {

    /**
     * @param {object} [options] - Configuration options.
     * @param {HTMLElement|null}  [options.target=null]            - Element to scroll (null = window).
     * @param {number}            [options.threshold=0.04]         - Dead-zone threshold (0–1).
     * @param {number}            [options.maxSpeed=18]            - Max px/frame scroll speed.
     * @param {number}            [options.calibrationFrames=90]   - Frames to sample during calibration.
     * @param {boolean}           [options.autoCalibrate=true]     - Auto-calibrate on first face.
     * @param {boolean}           [options.showHUD=true]           - Show the built-in HUD overlay.
     * @param {string}            [options.mediapipeCDN]           - Custom CDN base URL.
     * @param {function}          [options.onStatus]               - Status change callback.
     * @param {function}          [options.onFrame]                - Per-frame data callback.
     * @param {function}          [options.onCalibrated]           - Calibration complete callback.
     */
    constructor(options = {}) {
      this.opts       = Object.assign({}, DEFAULTS, options);
      this.neutralY   = null;
      this.lastNoseY  = 0.5;
      this._running   = false;
      this._calFrames = [];
      this._calibrating = false;
      this._autoCalDone = false;
      this._faceMesh  = null;
      this._camera    = null;
      this._video     = null;
      this._hud       = null;
    }

    // ── Public API ──────────────────────────

    /**
     * Start head-scroll: request camera, load MediaPipe, begin tracking.
     * @returns {Promise<void>}
     */
    async start() {
      if (this._running) return;
      this._running = true;
      this._setStatus('loading', 'Requesting camera…');

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 320, height: 240 },
        });

        this._video = document.createElement('video');
        this._video.srcObject = stream;
        this._video.autoplay = true;
        this._video.playsInline = true;
        this._video.muted = true;
        this._video.style.display = 'none';
        document.body.appendChild(this._video);

        if (this.opts.showHUD) this._buildHUD();

        this._setStatus('loading', 'Loading MediaPipe…');
        await this._loadMediaPipe();
        this._setStatus('ok', 'Tracking active');

      } catch (err) {
        this._running = false;
        this._setStatus('error', err.message);
        throw err;
      }
    }

    /**
     * Stop tracking and clean up all resources.
     */
    stop() {
      this._running = false;
      if (this._camera)  { try { this._camera.stop(); } catch(e){} }
      if (this._video)   { this._video.srcObject?.getTracks().forEach(t => t.stop()); this._video.remove(); }
      if (this._hud)     this._hud.remove();
      this._faceMesh = null;
      this._camera   = null;
      this._video    = null;
      this._hud      = null;
    }

    /**
     * Trigger calibration: samples `calibrationFrames` frames and sets neutral Y.
     * @returns {Promise<number>} Resolves with the calibrated neutralY value.
     */
    calibrate() {
      return new Promise((resolve) => {
        this._calFrames  = [];
        this._calibrating = true;
        this._calResolve = resolve;
        this._setStatus('loading', 'Calibrating…');
        this._updateHUDCalState(true);
      });
    }

    /**
     * Manually set the neutral Y value without re-calibrating.
     * @param {number} y - Normalised Y position (0–1).
     */
    setNeutralY(y) {
      this.neutralY = y;
    }

    /** @returns {boolean} Whether tracking is currently active. */
    get isRunning() { return this._running; }

    /** @returns {number|null} Current neutral Y (null if not calibrated). */
    get neutral() { return this.neutralY; }

    // ── MediaPipe ───────────────────────────

    _loadMediaPipe() {
      return new Promise((resolve, reject) => {
        const load = (src) => new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = src; s.crossOrigin = 'anonymous';
          s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
          document.head.appendChild(s);
        });

        const cdn = this.opts.mediapipeCDN;
        const camCDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';

        const alreadyLoaded = typeof window.FaceMesh !== 'undefined';

        (alreadyLoaded ? Promise.resolve() : Promise.all([
          load(cdn + 'face_mesh.js'),
          load(camCDN),
        ]))
        .then(() => {
          this._faceMesh = new window.FaceMesh({
            locateFile: f => cdn + f,
          });
          this._faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: this.opts.eyeGaze,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.5,
          });
          this._faceMesh.onResults(r => this._onResults(r));

          this._camera = new window.Camera(this._video, {
            onFrame: async () => {
              if (this._running && this._faceMesh) {
                await this._faceMesh.send({ image: this._video });
              }
            },
            width: 320, height: 240,
          });
          this._camera.start();
          resolve();
        })
        .catch(reject);
      });
    }

    _getGazeRatio(lm) {
      // Requires refineLandmarks: true — iris centers at indices 468 (left) and 473 (right)
      const leftIris  = lm[468];
      const rightIris = lm[473];
      if (!leftIris || !rightIris) return null;

      // Eye vertical bounds: upper eyelid top / lower eyelid bottom
      // Left eye: top=159, bottom=145  |  Right eye: top=386, bottom=374
      const leftH  = lm[145].y - lm[159].y;
      const rightH = lm[374].y - lm[386].y;

      // Skip frame if eyes are nearly closed (blink)
      if (leftH < 0.008 || rightH < 0.008) return null;

      const leftRatio  = (leftIris.y  - lm[159].y) / leftH;
      const rightRatio = (rightIris.y - lm[386].y) / rightH;
      return (leftRatio + rightRatio) / 2;
    }

    _onResults(results) {
      const lm = results.multiFaceLandmarks?.[0];

      if (this._hud) this._drawHUDCanvas(results.image, lm);

      if (!lm) {
        this._updateHUDStatus(false);
        return;
      }

      let trackY;
      if (this.opts.eyeGaze) {
        const ratio = this._getGazeRatio(lm);
        if (ratio === null) return; // blinking — skip frame
        trackY = ratio;
      } else {
        trackY = lm[4].y;
      }
      this.lastNoseY = trackY;

      // Auto-calibrate once
      if (this.opts.autoCalibrate && !this._autoCalDone && this.neutralY === null) {
        this._autoCalDone = true;
        setTimeout(() => this.calibrate(), 500);
      }

      // Sample for calibration
      if (this._calibrating) {
        this._calFrames.push(trackY);
        if (this._calFrames.length >= this.opts.calibrationFrames) {
          this._finishCalibration();
        }
      }

      if (this.neutralY === null) return;

      const delta = trackY - this.neutralY;
      const threshold = this.opts.eyeGaze ? this.opts.gazeThreshold : this.opts.threshold;
      const { maxSpeed } = this.opts;
      let scrolling = 'none';

      if (delta > threshold) {
        scrolling = 'down';
        const speed = Math.min((delta - threshold) / 0.06, 1) * maxSpeed;
        this._scroll(speed);
      } else if (delta < -threshold) {
        scrolling = 'up';
        const speed = Math.min((-delta - threshold) / 0.06, 1) * maxSpeed;
        this._scroll(-speed);
      }

      if (this.opts.onFrame) {
        const frameData = this.opts.eyeGaze
          ? { gazeRatio: trackY, neutralY: this.neutralY, delta, scrolling }
          : { noseY: trackY,    neutralY: this.neutralY, delta, scrolling };
        this.opts.onFrame(frameData);
      }

      if (this._hud) this._updateHUDData({ delta, scrolling });
    }

    _finishCalibration() {
      this.neutralY     = this._calFrames.reduce((a, b) => a + b, 0) / this._calFrames.length;
      this._calibrating = false;
      this._calFrames   = [];
      const label = this.opts.eyeGaze ? 'Gaze' : 'Y';
      this._setStatus('ok', `Calibrated (${label}=${this.neutralY.toFixed(3)})`);
      this._updateHUDCalState(false);
      if (this.opts.onCalibrated) this.opts.onCalibrated(this.neutralY);
      if (this._calResolve) { this._calResolve(this.neutralY); this._calResolve = null; }
    }

    _scroll(px) {
      const t = this.opts.target;
      if (t) {
        t.scrollTop += px;
      } else {
        window.scrollBy(0, px);
      }
    }

    // ── Status ──────────────────────────────

    _setStatus(type, msg) {
      if (this.opts.onStatus) this.opts.onStatus(type, msg);
      if (this._hud) this._updateHUDStatus(type, msg);
    }

    // ── HUD ─────────────────────────────────

    _buildHUD() {
      const hud = document.createElement('div');
      hud.id = '__head-scroll-hud__';
      hud.innerHTML = `
        <style>
          #__head-scroll-hud__ {
            position: fixed; bottom: 20px; left: 20px; z-index: 99999;
            width: 200px; background: rgba(4,8,16,0.92);
            border: 1px solid rgba(0,245,255,0.25); border-radius: 6px;
            font-family: 'Share Tech Mono', 'Courier New', monospace;
            font-size: 10px; color: #c8d8e8;
            backdrop-filter: blur(8px);
            box-shadow: 0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(0,245,255,0.1);
            overflow: hidden; user-select: none;
          }
          #__head-scroll-hud__ .hs-header {
            padding: 8px 10px; border-bottom: 1px solid rgba(0,245,255,0.15);
            display: flex; align-items: center; gap: 6px; cursor: move;
          }
          #__head-scroll-hud__ .hs-dot {
            width: 6px; height: 6px; border-radius: 50%; background: #3a5068;
            flex-shrink: 0; transition: all 0.3s;
          }
          #__head-scroll-hud__ .hs-dot.ok    { background: #39ff14; box-shadow: 0 0 6px #39ff14; animation: hs-blink 2s infinite; }
          #__head-scroll-hud__ .hs-dot.loading{ background: #ffaa00; box-shadow: 0 0 6px #ffaa00; animation: hs-blink 0.5s infinite; }
          #__head-scroll-hud__ .hs-dot.error  { background: #ff3355; box-shadow: 0 0 6px #ff3355; }
          @keyframes hs-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
          #__head-scroll-hud__ .hs-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.7; }
          #__head-scroll-hud__ .hs-close { opacity: 0.4; cursor: pointer; font-size: 12px; }
          #__head-scroll-hud__ .hs-close:hover { opacity: 1; }
          #__head-scroll-hud__ .hs-canvas-wrap { position: relative; background: #000; }
          #__head-scroll-hud__ canvas { width: 100%; display: block; transform: scaleX(-1); }
          #__head-scroll-hud__ .hs-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
          #__head-scroll-hud__ .hs-row { display: flex; justify-content: space-between; }
          #__head-scroll-hud__ .hs-label { color: rgba(0,245,255,0.5); }
          #__head-scroll-hud__ .hs-val { color: #00f5ff; }
          #__head-scroll-hud__ .hs-bar-outer {
            height: 6px; background: rgba(0,0,0,0.5); border: 1px solid rgba(0,245,255,0.15);
            border-radius: 3px; overflow: hidden; position: relative;
          }
          #__head-scroll-hud__ .hs-bar-inner {
            height: 100%; width: 50%; position: absolute; left: 0;
            background: rgba(0,245,255,0.3); transition: width 0.08s, background 0.1s;
          }
          #__head-scroll-hud__ .hs-bar-center {
            position: absolute; left: 50%; top: -1px; bottom: -1px;
            width: 1px; background: rgba(255,255,255,0.2);
          }
          #__head-scroll-hud__ .hs-btn {
            width: 100%; background: transparent; border: 1px solid rgba(0,245,255,0.4);
            color: #00f5ff; font-family: inherit; font-size: 9px; letter-spacing: 1px;
            padding: 5px; cursor: pointer; text-transform: uppercase; border-radius: 2px;
            transition: all 0.2s;
          }
          #__head-scroll-hud__ .hs-btn:hover { background: rgba(0,245,255,0.08); }
          #__head-scroll-hud__ .hs-scroll-ind {
            text-align: center; font-size: 14px; height: 18px; line-height: 18px;
            color: rgba(0,245,255,0.2); transition: all 0.1s;
          }
          #__head-scroll-hud__ .hs-scroll-ind.up   { color: #00f5ff; text-shadow: 0 0 8px #00f5ff; }
          #__head-scroll-hud__ .hs-scroll-ind.down  { color: #ff3355; text-shadow: 0 0 8px #ff3355; }
        </style>
        <div class="hs-header">
          <div class="hs-dot loading" id="hs-dot"></div>
          <div class="hs-msg" id="hs-msg">Initializing…</div>
          <div class="hs-close" id="hs-close">✕</div>
        </div>
        <div class="hs-canvas-wrap">
          <canvas id="hs-canvas" width="200" height="150"></canvas>
        </div>
        <div class="hs-body">
          <div class="hs-row">
            <span class="hs-label">MODE</span>
            <span class="hs-val" id="hs-mode">—</span>
          </div>
          <div class="hs-row">
            <span class="hs-label">DELTA</span>
            <span class="hs-val" id="hs-delta">—</span>
          </div>
          <div class="hs-bar-outer">
            <div class="hs-bar-inner" id="hs-bar"></div>
            <div class="hs-bar-center"></div>
          </div>
          <div class="hs-scroll-ind" id="hs-dir">●</div>
          <button class="hs-btn" id="hs-cal-btn">⚙ Calibrate</button>
        </div>
      `;

      document.body.appendChild(hud);
      this._hud = hud;

      const modeEl = hud.querySelector('#hs-mode');
      if (modeEl) modeEl.textContent = this.opts.eyeGaze ? 'EYE GAZE' : 'HEAD TILT';

      // Close
      hud.querySelector('#hs-close').onclick = () => this.stop();

      // Calibrate
      hud.querySelector('#hs-cal-btn').onclick = () => this.calibrate();

      // Draggable
      this._makeDraggable(hud, hud.querySelector('.hs-header'));
    }

    _drawHUDCanvas(image, landmarks) {
      const canvas = this._hud?.querySelector('#hs-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (landmarks) {
        if (this.opts.eyeGaze) {
          // Draw iris center circles for both eyes
          [468, 473].forEach(idx => {
            const pt = landmarks[idx];
            if (!pt) return;
            ctx.beginPath();
            ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0,245,255,0.9)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          });
        } else {
          const nose = landmarks[4];
          ctx.beginPath();
          ctx.arc(nose.x * canvas.width, nose.y * canvas.height, 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(57,255,20,0.9)';
          ctx.fill();
        }
      }
    }

    _updateHUDStatus(type, msg) {
      if (!this._hud) return;
      const dot = this._hud.querySelector('#hs-dot');
      const msgEl = this._hud.querySelector('#hs-msg');
      if (dot) dot.className = 'hs-dot ' + (type === true ? 'ok' : type === false ? 'error' : type);
      if (msgEl && msg) msgEl.textContent = msg;
    }

    _updateHUDData({ delta, scrolling }) {
      if (!this._hud) return;
      const threshold = this.opts.threshold;

      const deltaEl = this._hud.querySelector('#hs-delta');
      const barEl   = this._hud.querySelector('#hs-bar');
      const dirEl   = this._hud.querySelector('#hs-dir');

      if (deltaEl) deltaEl.textContent = (delta >= 0 ? '+' : '') + delta.toFixed(4);

      if (barEl) {
        const pct = Math.min(Math.max(delta / 0.12 * 50 + 50, 0), 100);
        barEl.style.width = pct + '%';
        barEl.style.background = scrolling === 'down'
          ? 'rgba(255,51,85,0.6)'
          : scrolling === 'up'
            ? 'rgba(0,245,255,0.6)'
            : 'rgba(0,245,255,0.2)';
      }

      if (dirEl) {
        dirEl.className = 'hs-scroll-ind ' + (scrolling === 'up' ? 'up' : scrolling === 'down' ? 'down' : '');
        dirEl.textContent = scrolling === 'up' ? '▲' : scrolling === 'down' ? '▼' : '●';
      }
    }

    _updateHUDCalState(active) {
      const btn = this._hud?.querySelector('#hs-cal-btn');
      if (btn) btn.textContent = active ? '● Sampling…' : '⚙ Calibrate';
    }

    _makeDraggable(el, handle) {
      let ox = 0, oy = 0, mx = 0, my = 0;
      handle.onmousedown = (e) => {
        e.preventDefault();
        ox = e.clientX; oy = e.clientY;
        document.onmousemove = (e2) => {
          mx = ox - e2.clientX; my = oy - e2.clientY;
          ox = e2.clientX; oy = e2.clientY;
          el.style.left = (el.offsetLeft - mx) + 'px';
          el.style.top  = (el.offsetTop  - my) + 'px';
          el.style.bottom = 'auto';
        };
        document.onmouseup = () => {
          document.onmousemove = null;
          document.onmouseup   = null;
        };
      };
    }
  }

  return HeadScroll;
}));
