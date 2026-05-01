// Off-frame tracker. Stores last seen bbox + timestamp. When the target is
// not visible, computes which edge it likely exited and the angle of an
// arrow that points from the screen center toward that exit.

export class OffFrameTracker {
  constructor() {
    this.last = null; // { bbox: [x,y,w,h], t, vx, vy }
    this.history = [];
  }

  reset() {
    this.last = null;
    this.history = [];
  }

  update(bbox) {
    const now = performance.now();
    if (!bbox) return;
    if (this.last) {
      const dt = Math.max(1, now - this.last.t);
      const cx = bbox[0] + bbox[2] / 2;
      const cy = bbox[1] + bbox[3] / 2;
      const lcx = this.last.bbox[0] + this.last.bbox[2] / 2;
      const lcy = this.last.bbox[1] + this.last.bbox[3] / 2;
      this.last = {
        bbox,
        t: now,
        vx: (cx - lcx) / dt,
        vy: (cy - lcy) / dt
      };
    } else {
      this.last = { bbox, t: now, vx: 0, vy: 0 };
    }
  }

  // Given current frame size, return { dir, dx, dy, x, y } for an arrow
  // (in viewport-relative pixel coords) pointing at the off-frame target,
  // or null if there's no recent track.
  getArrow(viewW, viewH) {
    if (!this.last) return null;
    const age = performance.now() - this.last.t;
    if (age > 4000) return null;
    const [x, y, w, h] = this.last.bbox;
    // Project last position forward by velocity (capped) for a smarter arrow.
    const cx = x + w / 2 + Math.max(-200, Math.min(200, this.last.vx * age * 0.5));
    const cy = y + h / 2 + Math.max(-200, Math.min(200, this.last.vy * age * 0.5));

    const dx = cx - viewW / 2;
    const dy = cy - viewH / 2;

    const angle = Math.atan2(dy, dx); // radians from +x axis

    // 8-way directional symbol
    const a = (angle * 180) / Math.PI;
    let dir = '→';
    if (a >= -22.5 && a < 22.5) dir = '→';
    else if (a >= 22.5 && a < 67.5) dir = '↘';
    else if (a >= 67.5 && a < 112.5) dir = '↓';
    else if (a >= 112.5 && a < 157.5) dir = '↙';
    else if (a >= 157.5 || a < -157.5) dir = '←';
    else if (a >= -157.5 && a < -112.5) dir = '↖';
    else if (a >= -112.5 && a < -67.5) dir = '↑';
    else if (a >= -67.5 && a < -22.5) dir = '↗';

    // Position the arrow on the viewport edge along the direction toward target.
    const margin = 36;
    const halfW = viewW / 2 - margin;
    const halfH = viewH / 2 - margin;
    const tX = Math.cos(angle), tY = Math.sin(angle);
    const sx = halfW / Math.max(0.0001, Math.abs(tX));
    const sy = halfH / Math.max(0.0001, Math.abs(tY));
    const s = Math.min(sx, sy);
    const px = viewW / 2 + tX * s;
    const py = viewH / 2 + tY * s;

    return { dir, x: px, y: py, age };
  }
}
