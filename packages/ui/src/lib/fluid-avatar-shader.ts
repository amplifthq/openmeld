// Adapted from Rare UI Fluid Orb by Swami Malode.
// https://github.com/swamimalode07/rare-ui/blob/b3efd6c290884a852b7af39d34df99a762dbbf3f/components/ui/fluid-orb.tsx
// Free to use and modify; do not resell as a component kit.
export const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.38;

  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );

  vec2 p = vec2(uv.x * 1.8, uv.y * 1.0) + drift * 0.85;

  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + 1.2 * q);

  float g = clamp(1.0 - uv.y, 0.0, 1.0);
  float anchor = smoothstep(0.0, 0.3, uv.y);
  float shade = clamp(g + (f - 0.5) * 1.05 * anchor, 0.0, 1.0);

  vec3 tint = mix(vec3(0.95, 0.96, 0.98), u_color, 0.18);
  vec3 light = mix(tint, u_color, 0.55);
  vec3 dark = u_color;

  vec3 col = tint;
  col = mix(col, light, smoothstep(0.20, 0.46, shade));
  col = mix(col, dark, smoothstep(0.48, 0.83, shade));

  // Shape is clipped by the avatar element, supporting circles and rounded squares.
  float edge = 1.0;

  gl_FragColor = vec4(col * edge, edge);
}
`;
