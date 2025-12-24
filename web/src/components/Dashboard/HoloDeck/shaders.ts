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

    // Radial pulse rings (multiple concentric)
    float pulse1 = mod(uTime * 8.0, 100.0);
    float pulse2 = mod(uTime * 8.0 + 33.0, 100.0);
    float pulse3 = mod(uTime * 8.0 + 66.0, 100.0);
    float pulseWidth = 1.5;

    float ring1 = smoothstep(pulse1 - pulseWidth, pulse1, dist) * (1.0 - smoothstep(pulse1, pulse1 + 0.3, dist));
    float ring2 = smoothstep(pulse2 - pulseWidth, pulse2, dist) * (1.0 - smoothstep(pulse2, pulse2 + 0.3, dist));
    float ring3 = smoothstep(pulse3 - pulseWidth, pulse3, dist) * (1.0 - smoothstep(pulse3, pulse3 + 0.3, dist));
    float rings = (ring1 + ring2 + ring3) * 0.7;

    // Central glow that pulses
    float centerGlow = exp(-dist * 0.08) * (0.3 + 0.15 * sin(uTime * 2.0));

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
