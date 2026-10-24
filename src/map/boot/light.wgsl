struct Params {
  resolution: vec2f,
  time: f32,
}

@group(0) @binding(0) var<uniform> params: Params;

// A softly folded ribbon of light. The centre stays quiet for the title.
@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = params.resolution.x / max(params.resolution.y, 1.0);
  let point = (uv - 0.5) * vec2f(aspect, 1.0);
  let time = params.time * 0.13;
  let ink = vec3f(0.063, 0.075, 0.067);
  let silver = vec3f(0.62, 0.68, 0.57);
  let glow = exp(-length((point - vec2f(0.0, 0.2)) * vec2f(1.0, 1.8)) * 4.0);
  var color = ink + vec3f(0.026, 0.039, 0.028) * glow;

  let curve = point.y - 0.23 + point.x * point.x * 0.3;
  let fold = sin(point.x * 2.4 + time) * 0.04 + sin(point.x * 4.1 - time * 0.7) * 0.015;
  let ribbon = curve + fold;
  let envelope = exp(-point.x * point.x * 0.9);
  let body = exp(-pow(ribbon * 14.0, 2.0));
  let edge = exp(-abs(ribbon) * 180.0);
  let silk = pow(sin(ribbon * 130.0 + point.x * 2.0 + time) * 0.5 + 0.5, 7.0);
  let light = (body * 0.07 + edge * 0.15 + silk * body * 0.09) * envelope;
  color += silver * light;
  color += silver * exp(-abs(ribbon + 0.045) * 45.0) * envelope * 0.025;

  let vignette = 1.0 - smoothstep(0.4, 1.2, length(point * vec2f(0.7, 1.0)));
  return vec4f(mix(ink, color, vignette), 1.0);
}
