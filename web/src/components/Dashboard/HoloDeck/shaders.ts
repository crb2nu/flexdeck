// Shaders for HoloDeck visualization

// Shader for animated arc rings (GPU-efficient - no geometry recreation)
export const arcRingVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const arcRingFragmentShader = `
uniform float uProgress;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;

void main() {
    // Convert UV to polar coordinates centered
    vec2 centered = vUv - 0.5;
    float angle = atan(centered.y, centered.x) + 3.14159;
    float normalizedAngle = angle / (2.0 * 3.14159);

    // Show arc based on progress (0-1)
    float arcVisible = step(normalizedAngle, uProgress);

    // Anti-aliased edge with glow
    float edgeDist = abs(normalizedAngle - uProgress);
    float edgeGlow = smoothstep(0.05, 0.0, edgeDist) * arcVisible;
    float alpha = arcVisible * 0.8 + edgeGlow * 0.4;

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(uColor, alpha * uOpacity);
}
`;

// Shader for the "Holographic" floor
export const gridVertexShader = `
varying vec3 vWorldPosition;
void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const gridFragmentShader = `
varying vec3 vWorldPosition;
uniform float uTime;
uniform vec3 uColor;

void main() {
    float dist = length(vWorldPosition.xz);
    float alpha = 1.0 - smoothstep(20.0, 90.0, dist);

    // Grid pattern with enhanced visuals
    float gridSize = 4.0;
    float subGridSize = 1.0;
    float lineThickness = 0.015;

    // Main Grid with anti-aliasing
    float x = abs(fract(vWorldPosition.x / gridSize - 0.5) - 0.5);
    float z = abs(fract(vWorldPosition.z / gridSize - 0.5) - 0.5);
    float grid = smoothstep(0.5 - lineThickness - 0.01, 0.5 - lineThickness, x) +
                 smoothstep(0.5 - lineThickness - 0.01, 0.5 - lineThickness, z);

    // Sub Grid (finer detail)
    float sx = abs(fract(vWorldPosition.x / subGridSize - 0.5) - 0.5);
    float sz = abs(fract(vWorldPosition.z / subGridSize - 0.5) - 0.5);
    float subGrid = smoothstep(0.5 - lineThickness - 0.005, 0.5 - lineThickness, sx) +
                    smoothstep(0.5 - lineThickness - 0.005, 0.5 - lineThickness, sz);

    // Single subtle radial pulse ring (reduced from 3 for less visual noise)
    float pulse1 = mod(uTime * 3.0, 120.0);
    float pulseWidth = 2.5;
    float ring1 = smoothstep(pulse1 - pulseWidth, pulse1, dist) * (1.0 - smoothstep(pulse1, pulse1 + 1.0, dist));
    float rings = ring1 * 0.25;

    // Subtle central glow with slow pulse
    float centerGlow = exp(-dist * 0.1) * (0.12 + 0.04 * sin(uTime * 0.8));

    // Combine effects
    vec3 color = uColor;
    vec3 accentColor = vec3(0.66, 0.33, 0.97); // Purple accent

    // Mix grids with enhanced blending
    float combinedGrid = max(grid * 0.9, subGrid * 0.2);

    // Add pulse rings with color variation
    combinedGrid += rings;

    // Add center glow
    combinedGrid += centerGlow;

    if (combinedGrid <= 0.01) discard;

    // Color blend - add purple tint to rings
    vec3 finalColor = mix(color, accentColor, rings * 0.5 + centerGlow * 0.3);

    gl_FragColor = vec4(finalColor, alpha * min(combinedGrid, 1.0) * 0.85);
}
`;

// Health ring shader for Cluster Health Hub - shows arc based on health percentage
export const healthRingVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const healthRingFragmentShader = `
uniform float uProgress;
uniform vec3 uColor;
uniform float uTime;
uniform float uPulseSpeed;
varying vec2 vUv;

void main() {
    vec2 centered = vUv - 0.5;
    float angle = atan(centered.y, centered.x) + 3.14159;
    float normalizedAngle = angle / (2.0 * 3.14159);

    float arcVisible = step(normalizedAngle, uProgress);

    // Subtle breathing pulse
    float pulse = 0.85 + 0.15 * sin(uTime * uPulseSpeed);

    // Soft glow at the arc edge
    float edgeDist = abs(normalizedAngle - uProgress);
    float edgeGlow = smoothstep(0.03, 0.0, edgeDist) * arcVisible * 0.5;

    float alpha = (arcVisible * 0.6 + edgeGlow) * pulse;

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(uColor, alpha);
}
`;

// Traffic particle shaders - support per-instance colors
export const trafficVertexShader = `
attribute vec3 instanceColor;
varying vec3 vColor;
varying float vDepth;

void main() {
    vColor = instanceColor;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const trafficFragmentShader = `
varying vec3 vColor;
varying float vDepth;

void main() {
    // Soft sphere falloff
    vec2 centered = gl_PointCoord - 0.5;
    float dist = length(centered);
    float alpha = smoothstep(0.5, 0.15, dist);

    // Depth-based fade for particles further away
    float depthFade = clamp(1.0 - vDepth / 100.0, 0.3, 1.0);

    gl_FragColor = vec4(vColor, alpha * 0.7 * depthFade);
}
`;
