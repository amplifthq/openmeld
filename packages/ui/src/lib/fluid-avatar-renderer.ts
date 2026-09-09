import { FRAG, VERT } from "./fluid-avatar-shader";

// One GPU context per page. Avatar elements own only small 2D canvases.
const RESOLUTION = 128;
const CACHE_LIMIT = 64;
const frames = new Map<string, HTMLCanvasElement>();
type Renderer = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  time: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
};
let renderer: Renderer | null | undefined;
const active = new Set<(deltaSeconds: number) => void>();
let raf = 0;
let lastFrame = 0;

export function fluidAvatarColor(seed: string): string {
  let hash = 2_166_136_261;
  for (const char of seed.normalize("NFC").trim()) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV spreads similar names across the palette.
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16_777_619);
  }
  // 36 restrained hues: predictable contrast and reusable static frames.
  // biome-ignore lint/suspicious/noBitwiseOperators: Interpret the hash as unsigned.
  const hue = ((hash >>> 0) % 36) * 10;
  const saturation = 0.38;
  const lightness = 0.53;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(
      255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
    )
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function initialize(): Renderer | null {
  const canvas = document.createElement("canvas");
  canvas.width = RESOLUTION;
  canvas.height = RESOLUTION;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) {
    return null;
  }
  const shaders = [
    gl.createShader(gl.VERTEX_SHADER),
    gl.createShader(gl.FRAGMENT_SHADER),
  ];
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const [vertex, fragment] = shaders;
  if (!(program && buffer && vertex && fragment)) {
    for (const shader of shaders) {
      gl.deleteShader(shader);
    }
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  for (const [shader, source] of [
    [vertex, VERT],
    [fragment, FRAG],
  ] as const) {
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  for (const shader of shaders) {
    if (shader) {
      gl.deleteShader(shader);
    }
  }
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook.
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, RESOLUTION, RESOLUTION);
  gl.uniform2f(
    gl.getUniformLocation(program, "u_resolution"),
    RESOLUTION,
    RESOLUTION
  );
  const result = {
    canvas,
    gl,
    time: gl.getUniformLocation(program, "u_time"),
    color: gl.getUniformLocation(program, "u_color"),
  };
  canvas.addEventListener("webglcontextlost", () => {
    // Keep the last copied frames; do not repeatedly allocate failing contexts.
    renderer = null;
  });
  return result;
}

export function drawFluidAvatar(
  target: HTMLCanvasElement,
  color: string,
  time = 0
): boolean {
  const context = target.getContext("2d");
  if (!context) {
    return false;
  }
  const cached = time === 0 ? frames.get(color) : undefined;
  if (cached) {
    context.drawImage(cached, 0, 0, target.width, target.height);
    return true;
  }
  if (renderer === undefined) {
    renderer = initialize();
  }
  if (!renderer) {
    return false;
  }
  const { gl, canvas } = renderer;
  gl.uniform3f(
    renderer.color,
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255
  );
  gl.uniform1f(renderer.time, time);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (gl.isContextLost()) {
    return false;
  }
  context.drawImage(canvas, 0, 0, target.width, target.height);
  if (time === 0) {
    const frame = document.createElement("canvas");
    frame.width = RESOLUTION;
    frame.height = RESOLUTION;
    frame.getContext("2d")?.drawImage(canvas, 0, 0);
    if (frames.size >= CACHE_LIMIT) {
      const oldest = frames.keys().next().value;
      if (oldest) {
        frames.delete(oldest);
      }
    }
    frames.set(color, frame);
  }
  return true;
}

function tick(now: number) {
  raf = 0;
  if (document.hidden || active.size === 0) {
    return;
  }
  if (now - lastFrame >= 1000 / 30) {
    const remainder = (now - lastFrame) % (1000 / 30);
    const deltaSeconds = Math.min(now - lastFrame - remainder, 100) / 1000;
    lastFrame = now - remainder;
    for (const draw of active) {
      draw(deltaSeconds);
    }
  }
  if (active.size && !document.hidden) {
    raf = requestAnimationFrame(tick);
  }
}

function resume() {
  if (!document.hidden && active.size && !raf) {
    lastFrame = performance.now();
    raf = requestAnimationFrame(tick);
  }
}
function visibilityChanged() {
  if (document.hidden) {
    cancelAnimationFrame(raf);
    raf = 0;
  } else {
    resume();
  }
}

export function animateFluidAvatar(
  draw: (deltaSeconds: number) => void
): () => void {
  if (active.size === 0) {
    document.addEventListener("visibilitychange", visibilityChanged);
  }
  active.add(draw);
  resume();
  return () => {
    active.delete(draw);
    if (active.size === 0) {
      cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener("visibilitychange", visibilityChanged);
    }
  };
}
