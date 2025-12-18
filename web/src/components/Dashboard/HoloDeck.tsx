import { Component, onMount, onCleanup, createEffect, createSignal, Show } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';
import { metricsStore, getNodeMetrics, getUsageColor } from '../../stores/metrics';

// Quality presets for performance tuning
export type QualityLevel = 'low' | 'medium' | 'high';

interface QualitySettings {
  dustParticleCount: number;
  maxTrafficPackets: number;
  bloomEnabled: boolean;
  particleSize: number;
}

const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: { dustParticleCount: 200, maxTrafficPackets: 20, bloomEnabled: false, particleSize: 0.2 },
  medium: { dustParticleCount: 600, maxTrafficPackets: 50, bloomEnabled: true, particleSize: 0.15 },
  high: { dustParticleCount: 1200, maxTrafficPackets: 80, bloomEnabled: true, particleSize: 0.12 }
};

export interface HoloDeckFilter {
  namespace?: string;
  status?: string[];
  nodeName?: string;
  searchTerm?: string;
}

interface Props {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
  quality?: QualityLevel;
  filter?: HoloDeckFilter;
  onSelect?: (item: { type: 'node' | 'pod' | 'service'; data: K8sNode | K8sPod | K8sService } | null) => void;
}

// Shader for the "Holographic" floor
const gridVertexShader = `
varying vec3 vWorldPosition;
void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const gridFragmentShader = `
varying vec3 vWorldPosition;
uniform float uTime;
uniform vec3 uColor;

void main() {
    float dist = length(vWorldPosition.xz);
    float alpha = 1.0 - smoothstep(20.0, 80.0, dist);
    
    // Grid pattern
    float gridSize = 4.0;
    float subGridSize = 1.0;
    float lineThickness = 0.02;
    
    // Main Grid
    float x = abs(fract(vWorldPosition.x / gridSize - 0.5) - 0.5);
    float z = abs(fract(vWorldPosition.z / gridSize - 0.5) - 0.5);
    float grid = step(0.5 - lineThickness, x) + step(0.5 - lineThickness, z);
    
    // Sub Grid
    float sx = abs(fract(vWorldPosition.x / subGridSize - 0.5) - 0.5);
    float sz = abs(fract(vWorldPosition.z / subGridSize - 0.5) - 0.5);
    float subGrid = step(0.5 - lineThickness, sx) + step(0.5 - lineThickness, sz);
    
    // Radial Scan
    float scanDist = mod(uTime * 10.0, 100.0);
    float scanWidth = 2.0;
    float scan = smoothstep(scanDist - scanWidth, scanDist, dist) * (1.0 - smoothstep(scanDist, scanDist + 0.1, dist));
    
    vec3 color = uColor;
    
    // Mix grids
    float combinedGrid = max(grid, subGrid * 0.3);
    
    // Add scan highlights
    combinedGrid += scan * 2.0;
    
    if (combinedGrid <= 0.01) discard;

    gl_FragColor = vec4(color, alpha * combinedGrid * 0.8);
}
`;

const HoloDeck: Component<Props> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let composer: EffectComposer;
  let animationId: number;
  let raycaster: THREE.Raycaster;
  let mouse: THREE.Vector2;

  // Quality settings
  const getQuality = () => QUALITY_PRESETS[props.quality || 'high'];

  // State for popups and selection
  const [hoverInfo, setHoverInfo] = createSignal<{
    title: string;
    type: string;
    x: number;
    y: number;
    namespace?: string;
    status?: string;
    podCount?: number;
  } | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  // Scene Objects - stores both 3D object and source data
  const objectMap = new Map<string, THREE.Object3D>();
  const dataMap = new Map<string, K8sNode | K8sPod | K8sService>(); // Maps object ID to K8s data
  const matchesFilterMap = new Map<string, boolean>(); // Track which objects match filter
  const serviceToPodsMap = new Map<string, string[]>(); // Maps service ID to matching pod IDs

  // Filter matching helpers
  const podMatchesFilter = (pod: K8sPod, filter?: HoloDeckFilter): boolean => {
    if (!filter) return true;
    if (filter.namespace && pod.metadata.namespace !== filter.namespace) return false;
    if (filter.status && filter.status.length > 0 && !filter.status.includes(pod.status.phase)) return false;
    if (filter.nodeName && pod.spec.nodeName !== filter.nodeName) return false;
    if (filter.searchTerm) {
      const term = filter.searchTerm.toLowerCase();
      const nameMatch = pod.metadata.name.toLowerCase().includes(term);
      const nsMatch = pod.metadata.namespace?.toLowerCase().includes(term);
      if (!nameMatch && !nsMatch) return false;
    }
    return true;
  };

  const nodeMatchesFilter = (node: K8sNode, filter?: HoloDeckFilter): boolean => {
    if (!filter) return true;
    if (filter.nodeName && node.metadata.name !== filter.nodeName) return false;
    // If filtering by namespace, show nodes that have matching pods
    if (filter.namespace) {
      const hasMatchingPod = props.pods.some(p =>
        p.spec.nodeName === node.metadata.name && p.metadata.namespace === filter.namespace
      );
      if (!hasMatchingPod) return false;
    }
    if (filter.searchTerm) {
      const term = filter.searchTerm.toLowerCase();
      const nameMatch = node.metadata.name.toLowerCase().includes(term);
      // Also match if any pods on this node match
      const hasPodMatch = props.pods.some(p =>
        p.spec.nodeName === node.metadata.name &&
        (p.metadata.name.toLowerCase().includes(term) || p.metadata.namespace?.toLowerCase().includes(term))
      );
      if (!nameMatch && !hasPodMatch) return false;
    }
    return true;
  };

  // Apply visual filtering to objects
  const applyFilterVisuals = () => {
    const filter = props.filter;
    objectMap.forEach((obj, id) => {
      const data = dataMap.get(id);
      if (!data) return;

      const isNode = id.startsWith('node-');
      const matches = isNode
        ? nodeMatchesFilter(data as K8sNode, filter)
        : podMatchesFilter(data as K8sPod, filter);

      matchesFilterMap.set(id, matches);

      // Apply opacity based on match
      obj.traverse(child => {
        if (child instanceof THREE.Mesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(mat => {
            if ('opacity' in mat) {
              const baseMat = mat as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
              baseMat.transparent = true;
              baseMat.opacity = matches ? (baseMat.userData.originalOpacity ?? 1) : 0.15;
              // Store original opacity on first pass
              if (baseMat.userData.originalOpacity === undefined) {
                baseMat.userData.originalOpacity = baseMat.opacity;
              }
            }
          });
        }
        if (child instanceof THREE.Line && child.material) {
          const lineMat = child.material as THREE.LineBasicMaterial;
          lineMat.opacity = matches ? (lineMat.userData.originalOpacity ?? 0.15) : 0.03;
          if (lineMat.userData.originalOpacity === undefined) {
            lineMat.userData.originalOpacity = lineMat.opacity;
          }
        }
      });
    });
  };

  // Traffic System with InstancedMesh for GPU efficiency
  const MAX_TRAFFIC = 100; // Fixed pool size
  interface TrafficSlot {
      active: boolean;
      curveIndex: number;
      progress: number;
      speed: number;
  }
  const trafficPool: TrafficSlot[] = Array.from({ length: MAX_TRAFFIC }, () => ({
      active: false,
      curveIndex: 0,
      progress: 0,
      speed: 0
  }));
  let trafficInstancedMesh: THREE.InstancedMesh;
  let trafficMatrix = new THREE.Matrix4();
  let trafficDummy = new THREE.Object3D();
  let curves: THREE.QuadraticBezierCurve3[] = [];
  let activeTrafficCount = 0;

  // Service Traffic System (purple particles for service connections)
  const MAX_SERVICE_TRAFFIC = 60;
  interface ServiceTrafficSlot {
    active: boolean;
    curveIndex: number;
    progress: number;
    speed: number;
  }
  const serviceTrafficPool: ServiceTrafficSlot[] = Array.from({ length: MAX_SERVICE_TRAFFIC }, () => ({
    active: false,
    curveIndex: 0,
    progress: 0,
    speed: 0
  }));
  let serviceTrafficMesh: THREE.InstancedMesh;
  let serviceCurves: THREE.QuadraticBezierCurve3[] = [];
  let activeServiceTrafficCount = 0;

  // Cached core ring references (avoid getObjectByName per frame)
  let coreRings: THREE.Mesh[] = [];

  let gridMaterial: THREE.ShaderMaterial;
  let dustParticles: THREE.Points;
  let bloomPass: UnrealBloomPass;

  onMount(() => {
    if (!containerRef) return;

    // --- SETUP ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#030508');
    scene.fog = new THREE.FogExp2(0x030508, 0.012);

    camera = new THREE.PerspectiveCamera(60, containerRef.clientWidth / containerRef.clientHeight, 0.1, 1000);
    camera.position.set(25, 20, 25);

    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(containerRef.clientWidth, containerRef.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 1.2;
    containerRef.appendChild(renderer.domElement);

    // --- POST PROCESSING (BLOOM) ---
    const quality = getQuality();
    const renderScene = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(containerRef.clientWidth, containerRef.clientHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.15;
    bloomPass.strength = quality.bloomEnabled ? 1.2 : 0;
    bloomPass.radius = 0.4;
    bloomPass.enabled = quality.bloomEnabled;

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // --- CONTROLS ---
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 80;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;

    // --- RAYCASTER ---
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // --- DATA GROUP ---
    const dataGroup = new THREE.Group();
    scene.add(dataGroup);

    // --- LIGHTS ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.08);
    scene.add(ambientLight);
    
    // Main spotlight from top
    const spotLight = new THREE.SpotLight(0x00f0ff, 0.4);
    spotLight.position.set(0, 60, 0);
    spotLight.angle = Math.PI / 5;
    spotLight.penumbra = 0.5;
    scene.add(spotLight);
    
    // Central Core Structure
    const coreGroup = new THREE.Group();

    // Central pillar
    const pillarGeom = new THREE.CylinderGeometry(0.3, 0.5, 8, 8);
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.3 });
    const pillar = new THREE.Mesh(pillarGeom, pillarMat);
    pillar.position.y = 4;
    coreGroup.add(pillar);

    // Orbiting rings - cache references for animation loop
    coreRings = [];
    for (let i = 0; i < 3; i++) {
        const ringGeom = new THREE.TorusGeometry(2 + i * 1.5, 0.02, 8, 64);
        const ringMat = new THREE.MeshBasicMaterial({ color: i === 1 ? 0xa855f7 : 0x00f0ff, transparent: true, opacity: 0.6 });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = Math.PI / 2 + (i * 0.2);
        ring.position.y = 3 + i * 2;
        coreRings.push(ring); // Cache reference instead of using name lookup
        coreGroup.add(ring);
    }

    scene.add(coreGroup);

    // --- CUSTOM GRID ---
    gridMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0x00f0ff) }
        },
        vertexShader: gridVertexShader,
        fragmentShader: gridFragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    
    const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), gridMaterial);
    gridPlane.rotation.x = -Math.PI / 2;
    scene.add(gridPlane);

    // --- DUST PARTICLES (quality-adjusted) ---
    const dustCount = quality.dustParticleCount;
    const dustGeom = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    const dustColors = new Float32Array(dustCount * 3);
    const cyanColor = new THREE.Color(0x00f0ff);
    const purpleColor = new THREE.Color(0xa855f7);

    for (let i = 0; i < dustCount; i++) {
        dustPos[i * 3] = (Math.random() - 0.5) * 120;
        dustPos[i * 3 + 1] = Math.random() * 50;
        dustPos[i * 3 + 2] = (Math.random() - 0.5) * 120;

        const color = Math.random() > 0.8 ? purpleColor : cyanColor;
        dustColors[i * 3] = color.r;
        dustColors[i * 3 + 1] = color.g;
        dustColors[i * 3 + 2] = color.b;
    }
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeom.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));

    const dustMat = new THREE.PointsMaterial({
        size: quality.particleSize,
        transparent: true,
        opacity: 0.5,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    });
    dustParticles = new THREE.Points(dustGeom, dustMat);
    scene.add(dustParticles);

    // --- TRAFFIC INSTANCED MESH (GPU-efficient) ---
    const packetGeom = new THREE.SphereGeometry(0.15, 8, 8);
    const packetMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    trafficInstancedMesh = new THREE.InstancedMesh(packetGeom, packetMat, MAX_TRAFFIC);
    trafficInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Hide all instances initially by setting them far away
    const hideMatrix = new THREE.Matrix4().makeTranslation(0, -1000, 0);
    for (let i = 0; i < MAX_TRAFFIC; i++) {
        trafficInstancedMesh.setMatrixAt(i, hideMatrix);
    }
    trafficInstancedMesh.instanceMatrix.needsUpdate = true;
    scene.add(trafficInstancedMesh);

    // --- SERVICE TRAFFIC INSTANCED MESH (purple particles) ---
    const servicePacketGeom = new THREE.SphereGeometry(0.12, 6, 6);
    const servicePacketMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 }); // Purple
    serviceTrafficMesh = new THREE.InstancedMesh(servicePacketGeom, servicePacketMat, MAX_SERVICE_TRAFFIC);
    serviceTrafficMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_SERVICE_TRAFFIC; i++) {
        serviceTrafficMesh.setMatrixAt(i, hideMatrix);
    }
    serviceTrafficMesh.instanceMatrix.needsUpdate = true;
    scene.add(serviceTrafficMesh);


    // --- EVENTS ---
    const findHitObject = (intersects: THREE.Intersection[]) => {
        for (const i of intersects) {
            let obj: THREE.Object3D | null = i.object;
            while (obj) {
                if (obj.userData && (obj.userData.type === 'node' || obj.userData.type === 'pod' || obj.userData.type === 'service')) {
                    return obj;
                }
                obj = obj.parent;
            }
        }
        return null;
    };

    const onMouseMove = (event: MouseEvent) => {
        if (!containerRef) return;
        const rect = containerRef.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        const hitObj = findHitObject(intersects);

        // Check if hit object passes filter
        const objId = hitObj?.userData.type === 'node'
            ? `node-${hitObj.userData.label}`
            : hitObj?.userData.type === 'pod'
            ? `pod-${hitObj.userData.label}`
            : hitObj?.userData.type === 'service'
            ? `service-${hitObj.userData.label}`
            : null;
        const matchesFilter = objId ? (matchesFilterMap.get(objId) ?? true) : false;

        if (hitObj && hitObj.userData.label && matchesFilter) {
            containerRef.style.cursor = 'pointer';
            const objId = hitObj.userData.type === 'node'
                ? `node-${hitObj.userData.label}`
                : hitObj.userData.type === 'pod'
                ? `pod-${hitObj.userData.label}`
                : `service-${hitObj.userData.label}`;
            const data = dataMap.get(objId);

            // Enhanced tooltip info
            const info: typeof hoverInfo extends () => infer T ? NonNullable<T> : never = {
                title: hitObj.userData.label,
                type: hitObj.userData.type,
                x: event.clientX - rect.left + 15,
                y: event.clientY - rect.top
            };

            if (hitObj.userData.type === 'node' && data) {
                const node = data as K8sNode;
                const isReady = node.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
                info.status = isReady ? 'Ready' : 'NotReady';
                // Count pods on this node
                const podCount = props.pods.filter(p => p.spec.nodeName === node.metadata.name).length;
                info.podCount = podCount;
            } else if (hitObj.userData.type === 'pod' && data) {
                const pod = data as K8sPod;
                info.namespace = pod.metadata.namespace;
                info.status = pod.status.phase;
            } else if (hitObj.userData.type === 'service' && data) {
                const svc = data as K8sService;
                info.namespace = svc.metadata.namespace;
                info.status = svc.spec.type;
                // Count matching pods
                const matchingPods = serviceToPodsMap.get(objId) || [];
                info.podCount = matchingPods.length;
            }

            setHoverInfo(info);
            controls.autoRotate = false;
        } else {
            containerRef.style.cursor = 'default';
            setHoverInfo(null);
            if (!selectedId()) {
                controls.autoRotate = true;
            }
        }
    };

    const onClick = (event: MouseEvent) => {
        if (!containerRef) return;
        const rect = containerRef.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        const hitObj = findHitObject(intersects);

        // Check if hit object passes filter
        const clickObjId = hitObj?.userData.type === 'node'
            ? `node-${hitObj.userData.label}`
            : hitObj?.userData.type === 'pod'
            ? `pod-${hitObj.userData.label}`
            : hitObj?.userData.type === 'service'
            ? `service-${hitObj.userData.label}`
            : null;
        const clickMatchesFilter = clickObjId ? (matchesFilterMap.get(clickObjId) ?? true) : false;

        if (hitObj && hitObj.userData.label && clickMatchesFilter) {
            const objId = hitObj.userData.type === 'node'
                ? `node-${hitObj.userData.label}`
                : hitObj.userData.type === 'pod'
                ? `pod-${hitObj.userData.label}`
                : `service-${hitObj.userData.label}`;
            const data = dataMap.get(objId);

            setSelectedId(objId);
            controls.autoRotate = false;

            if (props.onSelect && data) {
                props.onSelect({
                    type: hitObj.userData.type as 'node' | 'pod' | 'service',
                    data
                });
            }
        } else {
            setSelectedId(null);
            controls.autoRotate = true;
            props.onSelect?.(null);
        }
    };

    containerRef.addEventListener('mousemove', onMouseMove);
    containerRef.addEventListener('click', onClick);

    // --- ANIMATION LOOP ---
    const clock = new THREE.Clock();
    const maxTraffic = quality.maxTrafficPackets;
    const hidePosition = new THREE.Vector3(0, -1000, 0);

    // Object pool traffic spawning (no array mutations)
    const spawnTraffic = () => {
        if (curves.length === 0 || activeTrafficCount >= maxTraffic) return;
        if (Math.random() > 0.85) {
            // Find an inactive slot
            for (let i = 0; i < MAX_TRAFFIC; i++) {
                if (!trafficPool[i].active) {
                    trafficPool[i].active = true;
                    trafficPool[i].curveIndex = Math.floor(Math.random() * curves.length);
                    trafficPool[i].progress = 0;
                    trafficPool[i].speed = 0.8 + Math.random() * 0.8;
                    activeTrafficCount++;
                    break;
                }
            }
        }
    };

    // Update traffic using InstancedMesh (GPU-efficient)
    const updateTraffic = (delta: number) => {
        let needsUpdate = false;
        for (let i = 0; i < MAX_TRAFFIC; i++) {
            const slot = trafficPool[i];
            if (slot.active) {
                slot.progress += slot.speed * delta * 0.5;
                if (slot.progress >= 1) {
                    // Deactivate and hide
                    slot.active = false;
                    activeTrafficCount--;
                    trafficDummy.position.copy(hidePosition);
                    trafficDummy.updateMatrix();
                    trafficInstancedMesh.setMatrixAt(i, trafficDummy.matrix);
                    needsUpdate = true;
                } else if (curves[slot.curveIndex]) {
                    // Update position
                    const pos = curves[slot.curveIndex].getPoint(slot.progress);
                    trafficDummy.position.copy(pos);
                    trafficDummy.updateMatrix();
                    trafficInstancedMesh.setMatrixAt(i, trafficDummy.matrix);
                    needsUpdate = true;
                }
            }
        }
        if (needsUpdate) {
            trafficInstancedMesh.instanceMatrix.needsUpdate = true;
        }
    };

    // Spawn service traffic (purple particles)
    const spawnServiceTraffic = () => {
        if (serviceCurves.length === 0 || activeServiceTrafficCount >= MAX_SERVICE_TRAFFIC * 0.6) return;
        if (Math.random() > 0.9) {
            for (let i = 0; i < MAX_SERVICE_TRAFFIC; i++) {
                if (!serviceTrafficPool[i].active) {
                    serviceTrafficPool[i].active = true;
                    serviceTrafficPool[i].curveIndex = Math.floor(Math.random() * serviceCurves.length);
                    serviceTrafficPool[i].progress = 0;
                    serviceTrafficPool[i].speed = 0.5 + Math.random() * 0.5;
                    activeServiceTrafficCount++;
                    break;
                }
            }
        }
    };

    // Update service traffic
    const updateServiceTraffic = (delta: number) => {
        let needsUpdate = false;
        for (let i = 0; i < MAX_SERVICE_TRAFFIC; i++) {
            const slot = serviceTrafficPool[i];
            if (slot.active) {
                slot.progress += slot.speed * delta * 0.4;
                if (slot.progress >= 1) {
                    slot.active = false;
                    activeServiceTrafficCount--;
                    trafficDummy.position.copy(hidePosition);
                    trafficDummy.updateMatrix();
                    serviceTrafficMesh.setMatrixAt(i, trafficDummy.matrix);
                    needsUpdate = true;
                } else if (serviceCurves[slot.curveIndex]) {
                    const pos = serviceCurves[slot.curveIndex].getPoint(slot.progress);
                    trafficDummy.position.copy(pos);
                    trafficDummy.updateMatrix();
                    serviceTrafficMesh.setMatrixAt(i, trafficDummy.matrix);
                    needsUpdate = true;
                }
            }
        }
        if (needsUpdate) {
            serviceTrafficMesh.instanceMatrix.needsUpdate = true;
        }
    };

    const animate = () => {
        animationId = requestAnimationFrame(animate);
        const delta = clock.getDelta();
        const time = clock.getElapsedTime();

        // Update uniforms
        gridMaterial.uniforms.uTime.value = time;

        controls.update();

        // Spawn and update traffic using object pool
        spawnTraffic();
        updateTraffic(delta);

        // Spawn and update service traffic (purple)
        spawnServiceTraffic();
        updateServiceTraffic(delta);

        // Animate objects (cached refs where possible)
        objectMap.forEach(obj => {
            if (obj.userData.type === 'node') {
                // Use cached scanner/core refs stored in userData
                const scanner = obj.userData.scannerRef as THREE.Mesh | undefined;
                if (scanner) {
                    scanner.scale.setScalar(1 + Math.sin(time * 2) * 0.2);
                    if (scanner.material) {
                        (scanner.material as THREE.MeshBasicMaterial).opacity = 0.5 - Math.sin(time * 2) * 0.2;
                    }
                }
                const core = obj.userData.coreRef as THREE.Object3D | undefined;
                if (core) {
                    core.rotation.y += delta;
                    core.rotation.x += delta * 0.5;
                }

                // Update resource meter rings based on metrics
                const nodeName = obj.userData.nodeName as string | undefined;
                const cpuRing = obj.userData.cpuRingRef as THREE.Mesh | undefined;
                const memRing = obj.userData.memRingRef as THREE.Mesh | undefined;

                if (nodeName && (cpuRing || memRing)) {
                    const metrics = getNodeMetrics(nodeName);
                    if (metrics) {
                        // Update CPU ring
                        if (cpuRing) {
                            const cpuAngle = (metrics.cpuUsage / 100) * Math.PI * 2;
                            cpuRing.geometry.dispose();
                            cpuRing.geometry = new THREE.RingGeometry(3.3, 3.5, 32, 1, 0, cpuAngle);
                            cpuRing.geometry.rotateX(-Math.PI / 2);
                            // Color based on usage
                            const cpuColor = metrics.cpuUsage < 50 ? 0x0aff68 : metrics.cpuUsage < 80 ? 0xfcee0a : 0xff003c;
                            (cpuRing.material as THREE.MeshBasicMaterial).color.setHex(cpuColor);
                        }
                        // Update Memory ring
                        if (memRing) {
                            const memAngle = (metrics.memoryPercent / 100) * Math.PI * 2;
                            memRing.geometry.dispose();
                            memRing.geometry = new THREE.RingGeometry(3.0, 3.2, 32, 1, 0, memAngle);
                            memRing.geometry.rotateX(-Math.PI / 2);
                            // Color based on usage
                            const memColor = metrics.memoryPercent < 50 ? 0x00f0ff : metrics.memoryPercent < 80 ? 0xfcee0a : 0xff003c;
                            (memRing.material as THREE.MeshBasicMaterial).color.setHex(memColor);
                        }
                    }
                }
            }
            if (obj.userData.type === 'pod') {
                obj.rotation.x += delta * 0.5;
                obj.rotation.y += delta * 0.3;
                // Bobbing
                if (obj.userData.initialY) {
                    obj.position.y = obj.userData.initialY + Math.sin(time + (obj.id % 20)) * 0.3;
                }
            }
            if (obj.userData.type === 'service') {
                // Slow rotation for service hexagons
                obj.rotation.y += delta * 0.2;
                // Gentle floating
                if (obj.userData.initialY) {
                    obj.position.y = obj.userData.initialY + Math.sin(time * 0.8 + (obj.id % 10)) * 0.4;
                }
            }
        });

        // Animate Dust
        dustParticles.rotation.y = time * 0.03;

        // Animate Central Core Rings (using cached refs - no getObjectByName)
        for (let i = 0; i < coreRings.length; i++) {
            const ring = coreRings[i];
            ring.rotation.z = time * (0.2 + i * 0.1) * (i % 2 === 0 ? 1 : -1);
            ring.position.y = 3 + i * 2 + Math.sin(time + i) * 0.3;
        }

        composer.render();
    };
    animate();

    const handleResize = () => {
        if (!containerRef) return;
        camera.aspect = containerRef.clientWidth / containerRef.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(containerRef.clientWidth, containerRef.clientHeight);
        composer.setSize(containerRef.clientWidth, containerRef.clientHeight);
    };
    window.addEventListener('resize', handleResize);
    
    // --- SCENE BUILDER (EFFECT) ---
    // Rebuild scene when props change, with data caching for enhanced tooltips
    createEffect(() => {
        // Clear existing objects
        while (dataGroup.children.length > 0) {
            const child = dataGroup.children[0];
            dataGroup.remove(child);
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                const mesh = child as THREE.Mesh;
                if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
                else mesh.material.dispose();
            }
        }
        objectMap.clear();
        dataMap.clear();
        serviceToPodsMap.clear();
        curves = [];
        serviceCurves = [];

        // Reset traffic pool (no mesh cleanup needed - InstancedMesh handles it)
        for (let i = 0; i < MAX_TRAFFIC; i++) {
            trafficPool[i].active = false;
        }
        activeTrafficCount = 0;

        // Reset service traffic pool
        for (let i = 0; i < MAX_SERVICE_TRAFFIC; i++) {
            serviceTrafficPool[i].active = false;
        }
        activeServiceTrafficCount = 0;

        const currentNodes = props.nodes;
        const currentPods = props.pods;

        if (currentNodes.length === 0) return;

        const nodeRadius = Math.max(12, currentNodes.length * 5);

        // 1. Create Nodes (Servers)
        currentNodes.forEach((node, i) => {
            const angle = (i / currentNodes.length) * Math.PI * 2;
            const x = Math.cos(angle) * nodeRadius;
            const z = Math.sin(angle) * nodeRadius;

            const isReady = node.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
            const colorHex = isReady ? 0x00f0ff : 0xff0055;
            const color = new THREE.Color(colorHex);

            const group = new THREE.Group();
            group.position.set(x, 0, z);
            group.userData = { type: 'node', label: node.metadata.name };

            // Base Platform
            const baseHelper = new THREE.Mesh(
                new THREE.CylinderGeometry(2.5, 3, 0.5, 8),
                new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.8 })
            );
            group.add(baseHelper);

            // Main Tower Structure
            const towerH = 6;
            const towerW = 2;
            const tower = new THREE.Mesh(
                new THREE.BoxGeometry(towerW, towerH, towerW),
                new THREE.MeshStandardMaterial({
                    color: 0x050a10,
                    transparent: true,
                    opacity: 0.6,
                    roughness: 0.1
                })
            );
            tower.position.y = towerH / 2 + 0.25;

            // Edges
            const edges = new THREE.LineSegments(
                new THREE.EdgesGeometry(tower.geometry),
                new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.5 })
            );
            tower.add(edges);

            // Animated Core
            const core = new THREE.Mesh(
                new THREE.OctahedronGeometry(0.8),
                new THREE.MeshBasicMaterial({ color: color, wireframe: true })
            );
            tower.add(core);
            group.add(tower);

            // Scanner Ring
            const scannerGeom = new THREE.RingGeometry(2.8, 3, 32);
            scannerGeom.rotateX(-Math.PI / 2);
            const scanner = new THREE.Mesh(
                scannerGeom,
                new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
            );
            scanner.position.y = 0.3;
            group.add(scanner);

            // Resource Meter Rings (CPU outer, Memory inner)
            const createResourceRing = (innerRadius: number, outerRadius: number, height: number, colorHex: number) => {
              const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 32, 1, 0, Math.PI * 2);
              geometry.rotateX(-Math.PI / 2);
              const material = new THREE.MeshBasicMaterial({
                color: colorHex,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.6
              });
              const ring = new THREE.Mesh(geometry, material);
              ring.position.y = height;
              return ring;
            };

            // CPU ring (outer, at top of tower)
            const cpuRingBg = createResourceRing(3.3, 3.5, towerH + 0.5, 0x222222);
            group.add(cpuRingBg);

            // Memory ring (inner, at top of tower)
            const memRingBg = createResourceRing(3.0, 3.2, towerH + 0.5, 0x222222);
            group.add(memRingBg);

            // Create progress rings (will be updated in animation loop)
            const cpuRingProgress = createResourceRing(3.3, 3.5, towerH + 0.52, 0x0aff68);
            cpuRingProgress.geometry.dispose();
            cpuRingProgress.geometry = new THREE.RingGeometry(3.3, 3.5, 32, 1, 0, 0); // Start at 0
            cpuRingProgress.geometry.rotateX(-Math.PI / 2);
            group.add(cpuRingProgress);

            const memRingProgress = createResourceRing(3.0, 3.2, towerH + 0.52, 0x00f0ff);
            memRingProgress.geometry.dispose();
            memRingProgress.geometry = new THREE.RingGeometry(3.0, 3.2, 32, 1, 0, 0); // Start at 0
            memRingProgress.geometry.rotateX(-Math.PI / 2);
            group.add(memRingProgress);

            // Cache refs in userData for animation loop (avoid getObjectByName)
            group.userData.scannerRef = scanner;
            group.userData.coreRef = core;
            group.userData.cpuRingRef = cpuRingProgress;
            group.userData.memRingRef = memRingProgress;
            group.userData.nodeName = node.metadata.name;

            dataGroup.add(group);
            const nodeId = `node-${node.metadata.name}`;
            objectMap.set(nodeId, group);
            dataMap.set(nodeId, node); // Store K8s data for tooltips
        });

        // 2. Create Pods
        currentPods.forEach((pod, i) => {
            if (i > 150) return;

            const assignedNodeName = pod.spec.nodeName;
            const assignedNodeObj = objectMap.get(`node-${assignedNodeName}`);

            const angle = (i * 137.5) * (Math.PI / 180);
            let px = 0, pz = 0, py = 4 + Math.random() * 4;

            if (assignedNodeObj) {
                const dist = 3 + (i % 6) * 1.5;
                const offsetAngle = angle + (Math.random() * 0.5);
                px = assignedNodeObj.position.x + Math.cos(offsetAngle) * dist;
                pz = assignedNodeObj.position.z + Math.sin(offsetAngle) * dist;
            } else {
                px = Math.cos(angle) * (i * 0.5);
                pz = Math.sin(angle) * (i * 0.5);
            }

            const status = pod.status.phase;
            const pColor = status === 'Running' ? 0x22c55e : (status === 'Pending' ? 0xeab308 : 0xef4444);

            const geom = new THREE.DodecahedronGeometry(0.4);
            const mat = new THREE.MeshStandardMaterial({
                color: pColor,
                emissive: pColor,
                emissiveIntensity: 0.8,
                roughness: 0.1,
                metalness: 0.9
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(px, py, pz);
            mesh.userData = { type: 'pod', label: pod.metadata.name, initialY: py };

            dataGroup.add(mesh);
            const podId = `pod-${pod.metadata.name}`;
            objectMap.set(podId, mesh);
            dataMap.set(podId, pod); // Store K8s data for tooltips

            // Connections
            if (assignedNodeObj) {
                const start = new THREE.Vector3(px, py, pz);
                const end = assignedNodeObj.position.clone().add(new THREE.Vector3(0, 5, 0));

                const mid = start.clone().add(end).multiplyScalar(0.5);
                mid.y += start.distanceTo(end) * 0.3;

                const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
                const points = curve.getPoints(24);
                const line = new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints(points),
                    new THREE.LineBasicMaterial({ color: pColor, transparent: true, opacity: 0.15 })
                );

                dataGroup.add(line);
                curves.push(curve);
            }
        });

        // 3. Create Services (Hexagonal Prisms)
        const currentServices = props.services;
        const serviceRadius = nodeRadius + 8; // Place services outside the node ring

        // Helper: Check if pod matches service selector
        const podMatchesSelector = (pod: K8sPod, selector: Record<string, string> | undefined): boolean => {
            if (!selector) return false;
            const podLabels = pod.metadata.labels || {};
            return Object.entries(selector).every(([key, value]) => podLabels[key] === value);
        };

        currentServices.forEach((svc, i) => {
            // Skip kubernetes system service
            if (svc.metadata.name === 'kubernetes' && svc.metadata.namespace === 'default') return;

            // Position services in an outer ring
            const angle = (i / Math.max(currentServices.length, 1)) * Math.PI * 2 + Math.PI / 4;
            const x = Math.cos(angle) * serviceRadius;
            const z = Math.sin(angle) * serviceRadius;
            const sy = 8 + (i % 3) * 2; // Stagger heights

            // Create hexagonal prism geometry
            const hexRadius = 1.2;
            const hexHeight = 1.5;
            const hexShape = new THREE.Shape();
            for (let j = 0; j < 6; j++) {
                const hexAngle = (j / 6) * Math.PI * 2 - Math.PI / 6;
                const hx = Math.cos(hexAngle) * hexRadius;
                const hz = Math.sin(hexAngle) * hexRadius;
                if (j === 0) hexShape.moveTo(hx, hz);
                else hexShape.lineTo(hx, hz);
            }
            hexShape.closePath();

            const extrudeSettings = { depth: hexHeight, bevelEnabled: false };
            const hexGeom = new THREE.ExtrudeGeometry(hexShape, extrudeSettings);
            hexGeom.rotateX(-Math.PI / 2);
            hexGeom.translate(0, hexHeight / 2, 0);

            const svcColor = 0xa855f7; // Purple for services
            const hexMat = new THREE.MeshStandardMaterial({
                color: svcColor,
                transparent: true,
                opacity: 0.7,
                emissive: svcColor,
                emissiveIntensity: 0.3,
                roughness: 0.2,
                metalness: 0.8
            });
            const hexMesh = new THREE.Mesh(hexGeom, hexMat);

            // Add wireframe edges
            const hexEdges = new THREE.LineSegments(
                new THREE.EdgesGeometry(hexGeom),
                new THREE.LineBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.6 })
            );
            hexMesh.add(hexEdges);

            // Add inner glow ring
            const glowRingGeom = new THREE.RingGeometry(hexRadius * 0.6, hexRadius * 0.8, 6);
            glowRingGeom.rotateX(-Math.PI / 2);
            const glowRing = new THREE.Mesh(
                glowRingGeom,
                new THREE.MeshBasicMaterial({ color: svcColor, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
            );
            glowRing.position.y = hexHeight + 0.1;
            hexMesh.add(glowRing);

            hexMesh.position.set(x, sy, z);
            hexMesh.userData = { type: 'service', label: svc.metadata.name, initialY: sy };

            dataGroup.add(hexMesh);
            const svcId = `service-${svc.metadata.name}`;
            objectMap.set(svcId, hexMesh);
            dataMap.set(svcId, svc);
            matchesFilterMap.set(svcId, true); // Services always visible for now

            // Find matching pods and create connections
            const matchingPodIds: string[] = [];
            currentPods.forEach((pod) => {
                if (pod.metadata.namespace === svc.metadata.namespace && podMatchesSelector(pod, svc.spec.selector)) {
                    const podId = `pod-${pod.metadata.name}`;
                    matchingPodIds.push(podId);

                    // Get pod position
                    const podObj = objectMap.get(podId);
                    if (podObj) {
                        const svcPos = new THREE.Vector3(x, sy, z);
                        const podPos = podObj.position.clone();

                        // Create bezier curve from service to pod
                        const mid = svcPos.clone().add(podPos).multiplyScalar(0.5);
                        mid.y += 3; // Arc upward

                        const svcCurve = new THREE.QuadraticBezierCurve3(svcPos, mid, podPos);
                        serviceCurves.push(svcCurve);

                        // Draw dashed connection line
                        const linePoints = svcCurve.getPoints(20);
                        const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
                        const lineMat = new THREE.LineDashedMaterial({
                            color: 0xa855f7,
                            transparent: true,
                            opacity: 0.25,
                            dashSize: 0.3,
                            gapSize: 0.2
                        });
                        const svcLine = new THREE.Line(lineGeom, lineMat);
                        svcLine.computeLineDistances();
                        dataGroup.add(svcLine);
                    }
                }
            });

            serviceToPodsMap.set(svcId, matchingPodIds);
        });

        // Apply initial filter state
        applyFilterVisuals();
    });

    // Watch for filter changes and apply visual updates
    createEffect(() => {
        // Access filter prop to track it
        const filter = props.filter;
        // Only run if objectMap is populated (after scene build)
        if (objectMap.size > 0) {
            applyFilterVisuals();
        }
    });


    onCleanup(() => {
        window.removeEventListener('resize', handleResize);
        containerRef?.removeEventListener('mousemove', onMouseMove);
        containerRef?.removeEventListener('click', onClick);
        cancelAnimationFrame(animationId);
        renderer.dispose();
        composer.dispose();
        trafficInstancedMesh.dispose();
        serviceTrafficMesh.dispose();
        if (containerRef) containerRef.innerHTML = '';
        objectMap.clear();
        dataMap.clear();
        matchesFilterMap.clear();
        serviceToPodsMap.clear();
        coreRings = [];
    });
  });

  return (
    <div class="relative h-full w-full overflow-hidden">
        <div ref={containerRef} class="h-full w-full bg-[#030508]" />
        
        {/* HUD Popup - Enhanced Tooltip */}
        <Show when={hoverInfo()}>
            {info => (
                <div
                    class="absolute pointer-events-none z-20"
                    style={{
                        left: `${info().x}px`,
                        top: `${info().y}px`,
                    }}
                >
                    <div class="relative ml-4 mt-4">
                        {/* Connecting Line */}
                        <div class="absolute -left-4 -top-4 h-4 w-4 border-l border-t border-neon-cyan/50"></div>

                        <div class="rounded-sm border border-neon-cyan/30 bg-black/90 p-2 text-xs backdrop-blur-md shadow-[0_0_15px_rgba(0,240,255,0.2)] min-w-[140px]">
                            <div class="flex items-center gap-2 mb-1 border-b border-white/10 pb-1">
                                <div class="h-1.5 w-1.5 rounded-full bg-neon-cyan animate-pulse"></div>
                                <div class="font-bold text-neon-cyan uppercase tracking-wider">{info().type}</div>
                            </div>
                            <div class="font-mono text-white/90 mb-1">{info().title}</div>

                            {/* Enhanced info for nodes */}
                            <Show when={info().type === 'node' && info().status}>
                                <div class="flex items-center gap-2 text-[10px] mt-1 pt-1 border-t border-white/5">
                                    <span class={`px-1 rounded ${info().status === 'Ready' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                        {info().status}
                                    </span>
                                    <Show when={info().podCount !== undefined}>
                                        <span class="text-text-dim">{info().podCount} pods</span>
                                    </Show>
                                </div>
                            </Show>

                            {/* Enhanced info for pods */}
                            <Show when={info().type === 'pod'}>
                                <div class="text-[10px] mt-1 pt-1 border-t border-white/5 space-y-0.5">
                                    <Show when={info().namespace}>
                                        <div class="text-text-dim">ns: <span class="text-neon-purple">{info().namespace}</span></div>
                                    </Show>
                                    <Show when={info().status}>
                                        <div class={`inline-block px-1 rounded ${
                                            info().status === 'Running' ? 'bg-green-500/20 text-green-400' :
                                            info().status === 'Pending' ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-red-500/20 text-red-400'
                                        }`}>
                                            {info().status}
                                        </div>
                                    </Show>
                                </div>
                            </Show>

                            {/* Enhanced info for services */}
                            <Show when={info().type === 'service'}>
                                <div class="text-[10px] mt-1 pt-1 border-t border-white/5 space-y-0.5">
                                    <Show when={info().namespace}>
                                        <div class="text-text-dim">ns: <span class="text-neon-purple">{info().namespace}</span></div>
                                    </Show>
                                    <Show when={info().status}>
                                        <div class="inline-block px-1 rounded bg-purple-500/20 text-purple-400">
                                            {info().status}
                                        </div>
                                    </Show>
                                    <Show when={info().podCount !== undefined}>
                                        <div class="text-text-dim">{info().podCount} matching pods</div>
                                    </Show>
                                </div>
                            </Show>

                            <div class="text-[9px] text-text-dim mt-1 opacity-60">Click to select</div>
                        </div>
                    </div>
                </div>
            )}
        </Show>
        
        {/* Overlay Title */}
        <div class="absolute top-6 left-1/2 -translate-x-1/2 text-center pointer-events-none select-none">
            <h2 class="text-[10px] font-mono tracking-[0.4em] text-neon-cyan/60 uppercase mb-1 animate-pulse">Realtime Cluster Topology</h2>
            <div class="text-2xl font-bold font-display text-white tracking-widest drop-shadow-[0_0_15px_rgba(0,217,255,0.6)]">HOLO-DECK</div>
            <div class="flex justify-center gap-1 mt-2">
                <div class="h-1 w-8 bg-neon-cyan/50"></div>
                <div class="h-1 w-2 bg-neon-purple/50"></div>
                <div class="h-1 w-2 bg-neon-cyan/50"></div>
            </div>
        </div>
    </div>
  );
};

export default HoloDeck;
