/**
 * A small, dependency-free neural field. The canvas should sit in a sized container.
 * initNeural(canvas, { mode: 'interpret', labels: true, interactive: true })
 */
export function initNeural(canvas, opts = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    return { setMode() {}, setPaused() {}, destroy() {} };
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { setMode() {}, setPaused() {}, destroy() {} };

  const doc = canvas.ownerDocument;
  const win = doc.defaultView || window;
  const media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const coarse = win.matchMedia?.('(pointer: coarse)');
  const palettes = {
    interpret: { primary: '#c9ff69', secondary: '#b9a3ff', neutral: '#cbd1c8' },
    safety: { primary: '#b9a3ff', secondary: '#c9ff69', neutral: '#d2cadc' },
    quality: { primary: '#f1f2ed', secondary: '#c9ff69', neutral: '#bdcfc0' },
  };
  const TAU = Math.PI * 2;
  const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
  const initialSize = { width: canvas.width, height: canvas.height };
  const initialStyles = {
    width: canvas.style.width,
    height: canvas.style.height,
    display: canvas.style.display,
  };
  // Explicit CSS sizing also prevents a high-DPI backing store from changing layout.
  if (!canvas.style.width) canvas.style.width = '100%';
  if (!canvas.style.height) canvas.style.height = '100%';
  if (!canvas.style.display) canvas.style.display = 'block';

  let mode = Object.hasOwn(palettes, opts.mode) ? opts.mode : 'interpret';
  let palette = palettes[mode];
  let destroyed = false;
  let visible = true;
  let paused = Boolean(opts.paused);
  let reduced = Boolean(media?.matches);
  let hidden = doc.hidden;
  let mobile = false;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let radius = 1;
  let centerX = 0;
  let centerY = 0;
  let raf = 0;
  let lastTick = 0;
  let lastPaint = 0;
  let elapsed = 0;
  let angle = -0.38;
  let tiltX = 0;
  let tiltY = 0;
  let dirty = true;
  let hovered = -1;
  let nodes = [];
  let edges = [];
  let drawOrder = [];
  let pulseEdges = [];
  let labelNodes = [];
  const sprites = new Map();
  const pointer = { inside: false, touch: false, x: 0, y: 0, nx: 0, ny: 0 };

  function hash(n) {
    const value = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  function activeValue(node) {
    if (mode === 'safety') {
      return 0.1 + 0.9 * clamp((Math.abs(node.y) + node.z * 0.18 - 0.28) / 0.58);
    }
    if (mode === 'quality') {
      return 0.1 + 0.9 * clamp((1 - node.r) * 2.25 + (node.id % 9 === 0 ? 0.56 : 0));
    }
    return 0.15 + 0.85 * Math.exp(-Math.pow(node.y + node.x * 0.32, 2) / 0.105);
  }

  function updateMode(immediate = false) {
    palette = palettes[mode];
    for (const node of nodes) {
      node.target = activeValue(node);
      if (immediate) node.active = node.target;
    }
    pulseEdges = edges
      .filter((edge) => Math.max(nodes[edge.a].target, nodes[edge.b].target) > 0.65)
      .sort((a, b) => a.seed - b.seed)
      .slice(0, mobile ? 5 : 8);

    labelNodes = [];
    const candidates = nodes.slice().sort((a, b) => b.target - a.target);
    for (const node of candidates) {
      if (labelNodes.every((other) =>
        (node.x - other.x) ** 2 + (node.y - other.y) ** 2 + (node.z - other.z) ** 2 > 0.95)) {
        labelNodes.push(node);
      }
      if (labelNodes.length === 4) break;
    }
    dirty = true;
  }

  function buildNetwork(count) {
    nodes = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let id = 0; id < count; id++) {
      const y = 1 - (id / (count - 1)) * 2;
      const circumference = Math.sqrt(1 - y * y);
      const theta = goldenAngle * id + (hash(id + 11) - 0.5) * 0.14;
      const inner = id % 4 === 0;
      const r = inner ? 0.39 + hash(id + 37) * 0.4 : 0.91 + hash(id + 61) * 0.09;
      nodes.push({
        id, r, x: Math.cos(theta) * circumference * r,
        y: y * r, z: Math.sin(theta) * circumference * r,
        px: 0, py: 0, depth: 0, scale: 1,
        active: 0, target: 0, seed: hash(id + 83),
      });
    }

    // Neighbours are computed only when the density changes, never inside a frame.
    // The resulting sparse graph has about 300 edges rather than an all-pairs mesh.
    edges = [];
    const seen = new Set();
    for (const node of nodes) {
      const neighbours = nodes
        .filter((other) => other.id !== node.id)
        .map((other) => ({
          id: other.id,
          distance: (node.x - other.x) ** 2 + (node.y - other.y) ** 2 + (node.z - other.z) ** 2,
        }))
        .sort((a, b) => a.distance - b.distance);
      const degree = node.r < 0.85 ? 4 : 3;
      for (let j = 0; j < degree; j++) {
        const a = Math.min(node.id, neighbours[j].id);
        const b = Math.max(node.id, neighbours[j].id);
        const key = `${a}:${b}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ a, b, seed: hash(a * count + b + 121) });
        }
      }
    }
    drawOrder = nodes.slice();
    updateMode(true);
  }

  function glow(color) {
    if (sprites.has(color)) return sprites.get(color);
    const sprite = doc.createElement('canvas');
    sprite.width = sprite.height = 64;
    const brush = sprite.getContext('2d');
    if (!brush) return null;
    const gradient = brush.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, color + 'c0');
    gradient.addColorStop(0.14, color + '70');
    gradient.addColorStop(0.45, color + '18');
    gradient.addColorStop(1, color + '00');
    brush.fillStyle = gradient;
    brush.fillRect(0, 0, 64, 64);
    sprites.set(color, sprite);
    return sprite;
  }

  function canPaint() {
    return !destroyed && visible && !hidden && width > 0 && height > 0;
  }

  function canAnimate() {
    return canPaint() && !paused && !reduced;
  }

  function schedule() {
    if (canPaint() && !raf) raf = win.requestAnimationFrame(tick);
  }

  function stop() {
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
    lastTick = 0;
  }

  function resize() {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.max(0, Math.round(bounds.width));
    const nextHeight = Math.max(0, Math.round(bounds.height));
    const nextMobile = nextWidth < 540 || Boolean(coarse?.matches);
    const nextDpr = Math.min(win.devicePixelRatio || 1, nextMobile ? 1.75 : 2);
    if (nextWidth === width && nextHeight === height && nextDpr === dpr && nextMobile === mobile && nodes.length) return;
    width = nextWidth;
    height = nextHeight;
    dpr = nextDpr;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    centerX = width * 0.5;
    centerY = height * 0.5;
    radius = Math.min(width * 0.435, height * 0.435);
    if (mobile !== nextMobile || !nodes.length) {
      mobile = nextMobile;
      buildNetwork(mobile ? 80 : 148);
    }
    dirty = true;
    schedule();
  }

  function project(delta) {
    const yAngle = angle + tiltY;
    const xAngle = -0.14 + tiltX;
    const cy = Math.cos(yAngle);
    const sy = Math.sin(yAngle);
    const cx = Math.cos(xAngle);
    const sx = Math.sin(xAngle);
    const activeEase = canAnimate() ? 1 - Math.exp(-delta / 460) : 1;
    for (const node of nodes) {
      const rx = node.x * cy + node.z * sy;
      const rz = node.z * cy - node.x * sy;
      const ry = node.y * cx - rz * sx;
      const depthZ = node.y * sx + rz * cx;
      node.scale = 3.8 / (3.8 - depthZ);
      node.px = centerX + rx * radius * node.scale;
      node.py = centerY + ry * radius * node.scale;
      node.depth = clamp((depthZ + 1) * 0.5);
      node.active += (node.target - node.active) * activeEase;
    }
    drawOrder.sort((a, b) => a.depth - b.depth);

    hovered = -1;
    if (pointer.inside && opts.interactive !== false) {
      let nearest = (mobile ? 42 : 66) ** 2;
      for (const node of nodes) {
        if (node.depth < 0.35) continue;
        const distance = (node.px - pointer.x) ** 2 + (node.py - pointer.y) ** 2;
        if (distance < nearest) {
          hovered = node.id;
          nearest = distance;
        }
      }
    }
  }

  function guides() {
    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = 0.65;
    ctx.globalAlpha = 0.09;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radius * 1.11, radius * 0.36, -0.45, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.055;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radius * 1.03, radius * 0.62, 0.92, 0, TAU);
    ctx.stroke();

    ctx.globalAlpha = 0.12;
    ctx.setLineDash([1, 9]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 1.12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI * 0.5;
      const x = centerX + Math.cos(a) * radius * 1.12;
      const y = centerY + Math.sin(a) * radius * 1.12;
      const tangentX = -Math.sin(a) * 3;
      const tangentY = Math.cos(a) * 3;
      ctx.beginPath();
      ctx.moveTo(x - tangentX, y - tangentY);
      ctx.lineTo(x + tangentX, y + tangentY);
      ctx.stroke();
    }
  }

  function draw(delta) {
    ctx.clearRect(0, 0, width, height);
    project(delta);
    guides();
    ctx.lineCap = 'round';

    for (const edge of edges) {
      const a = nodes[edge.a];
      const b = nodes[edge.b];
      const depth = (a.depth + b.depth) * 0.5;
      const activation = (a.active + b.active) * 0.5;
      const selected = hovered === edge.a || hovered === edge.b;
      ctx.strokeStyle = selected ? palette.secondary : activation > 0.49 ? palette.primary : palette.neutral;
      ctx.globalAlpha = selected ? 0.64 : (0.035 + depth ** 1.6 * 0.21) * (0.62 + activation * 0.85);
      ctx.lineWidth = selected ? 1.15 : 0.45 + depth * 0.47;
      ctx.beginPath();
      ctx.moveTo(a.px, a.py);
      ctx.lineTo(b.px, b.py);
      ctx.stroke();
    }

    // Slow, sparse travelling signals; reduced-motion and paused views stay still.
    if (!reduced) {
      const pulseGlow = glow(palette.secondary);
      for (const edge of pulseEdges) {
        const a = nodes[edge.a];
        const b = nodes[edge.b];
        const progress = (elapsed * 0.000105 + edge.seed) % 1;
        const depth = a.depth + (b.depth - a.depth) * progress;
        const envelope = Math.sin(progress * Math.PI);
        const x = a.px + (b.px - a.px) * progress;
        const y = a.py + (b.py - a.py) * progress;
        ctx.globalAlpha = envelope * (0.24 + depth * 0.44);
        if (pulseGlow) ctx.drawImage(pulseGlow, x - 7, y - 7, 14, 14);
        ctx.strokeStyle = palette.secondary;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        const tail = Math.max(0, progress - 0.1);
        ctx.moveTo(a.px + (b.px - a.px) * tail, a.py + (b.py - a.py) * tail);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = palette.secondary;
        ctx.beginPath();
        ctx.arc(x, y, 1.35, 0, TAU);
        ctx.fill();
      }
    }

    const primaryGlow = glow(palette.primary);
    const secondaryGlow = glow(palette.secondary);
    const unit = mobile ? 0.86 : 1;
    for (const node of drawOrder) {
      const selected = node.id === hovered;
      const active = node.active;
      const r = (0.75 + node.depth * 0.72 + active * 0.65) * unit * node.scale;
      if (active > 0.6 || selected) {
        const size = (selected ? 23 : 10 + active * 5) * node.scale;
        ctx.globalAlpha = selected ? 0.95 : (0.17 + node.depth * 0.3) * active;
        const sprite = selected ? secondaryGlow : primaryGlow;
        if (sprite) ctx.drawImage(sprite, node.px - size / 2, node.py - size / 2, size, size);
      }
      ctx.globalAlpha = 0.18 + node.depth * 0.53 + active * 0.25;
      ctx.fillStyle = selected ? palette.secondary : active > 0.48 ? palette.primary : '#f1f2ed';
      ctx.beginPath();
      ctx.arc(node.px, node.py, selected ? r + 0.8 : r, 0, TAU);
      ctx.fill();
    }

    if (opts.labels !== false && !mobile) {
      ctx.font = '9px ui-monospace, SFMono-Regular, Consolas, monospace';
      ctx.textBaseline = 'middle';
      for (const node of labelNodes) {
        if (node.depth < 0.58 || node.id === hovered) continue;
        const side = node.px > centerX ? 1 : -1;
        ctx.globalAlpha = (node.depth - 0.45) * 0.58;
        ctx.strokeStyle = palette.primary;
        ctx.fillStyle = palette.primary;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(node.px + side * 5, node.py - 4);
        ctx.lineTo(node.px + side * 15, node.py - 14);
        ctx.lineTo(node.px + side * 27, node.py - 14);
        ctx.stroke();
        ctx.textAlign = side > 0 ? 'left' : 'right';
        ctx.fillText(`N·${String(node.id).padStart(3, '0')}`, node.px + side * 31, node.py - 14);
      }
    }

    if (hovered >= 0) {
      const node = nodes[hovered];
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = palette.secondary;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(node.px, node.py, 8.5, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI * 0.5;
        ctx.beginPath();
        ctx.moveTo(node.px + Math.cos(a) * 11, node.py + Math.sin(a) * 11);
        ctx.lineTo(node.px + Math.cos(a) * 15, node.py + Math.sin(a) * 15);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    dirty = false;
  }

  function tick(now) {
    raf = 0;
    if (!canPaint()) return;
    const animate = canAnimate();
    const delta = animate && lastTick ? Math.min(now - lastTick, 64) : 0;
    lastTick = animate ? now : 0;
    if (animate) {
      elapsed += delta;
      angle += delta * 0.000034;
      const ease = 1 - Math.exp(-delta / 650);
      const follow = pointer.inside && !pointer.touch;
      tiltX += ((follow ? pointer.ny * 0.13 : 0) - tiltX) * ease;
      tiltY += ((follow ? pointer.nx * 0.2 : 0) - tiltY) * ease;
    }
    const interval = mobile ? 1000 / 30 : 1000 / 40;
    if (dirty || !animate || now - lastPaint >= interval) {
      // Pass the time since the last actual paint to keep mode transitions consistent.
      draw(animate ? Math.min(now - lastPaint, 80) : 0);
      lastPaint = now;
    }
    if (animate) schedule();
  }

  function handlePointer(event) {
    if (opts.interactive === false) return;
    // Touch movement belongs to page scrolling; a tap may still illuminate a node.
    if (event.pointerType === 'touch' && event.type === 'pointermove') return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    pointer.inside = true;
    pointer.touch = event.pointerType === 'touch';
    pointer.x = (event.clientX - bounds.left) * width / bounds.width;
    pointer.y = (event.clientY - bounds.top) * height / bounds.height;
    pointer.nx = clamp((pointer.x - centerX) / (width * 0.5), -1, 1);
    pointer.ny = clamp((pointer.y - centerY) / (height * 0.5), -1, 1);
    dirty = true;
    schedule();
  }

  function leavePointer(event) {
    if (event?.type === 'pointerup' && event.pointerType !== 'touch') return;
    pointer.inside = false;
    dirty = true;
    schedule();
  }

  function visibilityChanged() {
    hidden = doc.hidden;
    if (hidden) stop();
    else {
      dirty = true;
      schedule();
    }
  }

  function motionChanged(event) {
    reduced = event.matches;
    if (reduced) {
      tiltX = tiltY = 0;
      for (const node of nodes) node.active = node.target;
    }
    stop();
    dirty = true;
    schedule();
  }

  const pointerOptions = { passive: true };
  if (opts.interactive !== false) {
    canvas.addEventListener('pointermove', handlePointer, pointerOptions);
    canvas.addEventListener('pointerdown', handlePointer, pointerOptions);
    canvas.addEventListener('pointerleave', leavePointer, pointerOptions);
    canvas.addEventListener('pointerup', leavePointer, pointerOptions);
    canvas.addEventListener('pointercancel', leavePointer, pointerOptions);
  }
  doc.addEventListener('visibilitychange', visibilityChanged);
  win.addEventListener('resize', resize, { passive: true });
  if (media?.addEventListener) media.addEventListener('change', motionChanged);
  else media?.addListener?.(motionChanged);

  const resizeObserver = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
  resizeObserver?.observe(canvas);
  const intersectionObserver = win.IntersectionObserver ? new win.IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target !== canvas) continue;
      visible = entry.isIntersecting;
      if (!visible) stop();
      else {
        dirty = true;
        schedule();
      }
    }
  }, { threshold: 0 }) : null;
  intersectionObserver?.observe(canvas);
  resize();

  return {
    setMode(nextMode) {
      if (destroyed || !Object.hasOwn(palettes, nextMode) || nextMode === mode) return;
      mode = nextMode;
      updateMode(!canAnimate());
      schedule();
    },
    setPaused(nextPaused) {
      if (destroyed) return;
      paused = Boolean(nextPaused);
      stop();
      dirty = true;
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      doc.removeEventListener('visibilitychange', visibilityChanged);
      win.removeEventListener('resize', resize);
      if (media?.removeEventListener) media.removeEventListener('change', motionChanged);
      else media?.removeListener?.(motionChanged);
      canvas.removeEventListener('pointermove', handlePointer);
      canvas.removeEventListener('pointerdown', handlePointer);
      canvas.removeEventListener('pointerleave', leavePointer);
      canvas.removeEventListener('pointerup', leavePointer);
      canvas.removeEventListener('pointercancel', leavePointer);
      ctx.clearRect(0, 0, width, height);
      Object.assign(canvas.style, initialStyles);
      canvas.width = initialSize.width;
      canvas.height = initialSize.height;
      sprites.clear();
      nodes = edges = drawOrder = pulseEdges = labelNodes = [];
    },
  };
}
