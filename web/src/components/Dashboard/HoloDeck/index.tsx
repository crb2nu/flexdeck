import { Component, onMount, onCleanup, createEffect, createSignal, createMemo, Show, untrack } from 'solid-js';
import * as THREE from 'three';
import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import { diffFiAccelMetrics, getFiAccelMetricsSnapshot, type FiAccelMetricsDelta } from '../../../lib/fiAccel';
import { getNodeMetrics } from '../../../stores/metrics';
import { formatPercent } from '../../../lib/format';
import { isK8sNodeReady } from '../../../lib/k8sStatus';
import {
    HOLO_THEME,
    HEALTH_HUB_CONFIG,
    type QualityLevel,
    type ClusterHealthData
} from './config';
import {
    healthRingVertexShader,
    healthRingFragmentShader,
} from './shaders';
import { disposeObject, markShared } from './utils';
import {
  computeClusterHealth,
  nodeMatchesFilter,
  podMatchesFilter,
  serviceMatchesFilter,
  type HoloDeckFilter
} from './derivedState';
import { TrafficManager } from './traffic';
import { HoloEngine } from './engine';
import { buildScene, computeSceneIds, diffScene, type SceneContext } from './sceneBuilder';

export type { HoloDeckFilter } from './derivedState';

interface Props {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
  topologyVersion?: number;
  styleVersion?: number;
  quality?: QualityLevel;
  filter?: HoloDeckFilter;
  onSelect?: (item: { type: 'node' | 'pod' | 'service'; data: K8sNode | K8sPod | K8sService } | null) => void;
}

type RingMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

interface NodeVisualRef {
  scannerRef?: THREE.Mesh;
  coreRef?: THREE.Object3D;
  cpuRingRef?: RingMesh;
  memRingRef?: RingMesh;
  nodeName?: string;
}

interface PodVisualRef {
  mesh: THREE.Object3D;
  initialY: number;
  waveOffset: number;
}

interface ServiceVisualRef {
  mesh: THREE.Object3D;
  initialY: number;
  waveOffset: number;
}

type HoloNodeUserData = {
  type?: 'node' | 'pod' | 'service';
  scannerRef?: THREE.Mesh;
  coreRef?: THREE.Object3D;
  cpuRingRef?: RingMesh;
  memRingRef?: RingMesh;
  nodeName?: string;
  initialY?: number;
};

interface HoloDeckPerfSnapshot {
  sceneBuildMs: number;
  filterApplyMs: number;
  filterMatchCount: number;
  renderedNodes: number;
  renderedPods: number;
  renderedServices: number;
  podCurves: number;
  serviceCurves: number;
  fiAccelInitState: string;
  fiAccelSelectorCalls: number;
  fiAccelSelectorFallbackCalls: number;
  fiAccelSelectorCandidates: number;
  fiAccelSelectorMs: number;
}

const PERF_QUERY_PARAM = 'topologyPerf';
const PERF_STORAGE_KEY = 'flexdeck.topologyPerf';
const HOLO_PERF_QUERY_PARAM = 'holodeckPerf';
const HOLO_PERF_STORAGE_KEY = 'flexdeck.holodeckPerf';
const EMPTY_FI_ACCEL_DELTA: FiAccelMetricsDelta = {
  initState: 'loading',
  logAnalyzeCalls: 0,
  logAnalyzeFallbackCalls: 0,
  logAnalyzeLines: 0,
  logAnalyzeMs: 0,
  selectorFilterCalls: 0,
  selectorFilterFallbackCalls: 0,
  selectorFilterCandidates: 0,
  selectorFilterMs: 0,
};

const readPerfToggle = (): boolean => {
  if (typeof window === 'undefined') return false;
  const search = new URLSearchParams(window.location.search);
  if (search.get(HOLO_PERF_QUERY_PARAM) === '1' || search.get(PERF_QUERY_PARAM) === '1') return true;
  return window.localStorage.getItem(HOLO_PERF_STORAGE_KEY) === '1'
    || window.localStorage.getItem(PERF_STORAGE_KEY) === '1';
};

const HoloDeck: Component<Props> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let engine: HoloEngine;
  let traffic: TrafficManager;
  let animationId: number;
  const clock = new THREE.Clock();

  // Quality settings with auto-detection
  const getInitialQuality = (): QualityLevel => {
    if (props.quality) return props.quality;
    
    // Heuristic: Default to low on touch devices or small screens
    const isTouch = typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
    const isSmall = typeof window !== 'undefined' && window.innerWidth < 1024;
    
    if (isTouch || isSmall) return 'low';
    return 'high';
  };

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
  const [interactionType, setInteractionType] = createSignal<'mouse' | 'touch'>('mouse');
  const [perfEnabled, setPerfEnabled] = createSignal(false);
  const [perfSnapshot, setPerfSnapshot] = createSignal<HoloDeckPerfSnapshot | null>(null);

  const objectMap = new Map<string, THREE.Object3D>();
  const dataMap = new Map<string, K8sNode | K8sPod | K8sService>();
  const matchesFilterMap = new Map<string, boolean>();
  const serviceToPodsMap = new Map<string, string[]>();
  const dataGroup = new THREE.Group();

  const sharedGeoms: Record<string, THREE.BufferGeometry> = {};
  const sharedMats: Record<string, THREE.Material> = {};
  const coreMatCache = new Map<number, THREE.MeshBasicMaterial>();
  const scannerMatCache = new Map<number, THREE.MeshBasicMaterial>();
  const edgeMatCache = new Map<number, THREE.LineBasicMaterial>();
  const podMatCache = new Map<string, THREE.MeshStandardMaterial>();
  const podLineMatCache = new Map<number, THREE.LineBasicMaterial>();
  const nodeVisuals: NodeVisualRef[] = [];
  const podVisuals: PodVisualRef[] = [];
  const serviceVisuals: ServiceVisualRef[] = [];

  let curves: THREE.QuadraticBezierCurve3[] = [];
  let serviceCurves: THREE.QuadraticBezierCurve3[] = [];
  let lastSceneBuildMs = 0;
  let lastFilterApplyMs = 0;
  let lastFilterMatchCount = 0;
  let lastSceneAccelDelta: FiAccelMetricsDelta = EMPTY_FI_ACCEL_DELTA;

  const sceneTopologyKey = createMemo<string>(() => {
    if (props.topologyVersion !== undefined) {
      return `topology:${props.topologyVersion}`;
    }
    const nodeKey = props.nodes
      .map((node) => node.metadata.name)
      .join(',');
    const podKey = props.pods
      .map((pod) => `${pod.metadata.namespace || 'default'}/${pod.metadata.name}:${pod.spec.nodeName || ''}`)
      .join(',');
    const serviceKey = props.services
      .map((service) => `${service.metadata.namespace || 'default'}/${service.metadata.name}:${JSON.stringify(service.spec.selector || {})}`)
      .join(',');
    return `${nodeKey}|${podKey}|${serviceKey}`;
  });
  const sceneStyleKey = createMemo<string>(() => {
    if (props.styleVersion !== undefined) {
      return `style:${props.styleVersion}`;
    }
    const nodeKey = props.nodes
      .map((node) => {
        const ready = isK8sNodeReady(node) ? '1' : '0';
        return `${node.metadata.name}:${ready}`;
      })
      .join(',');
    const podKey = props.pods
      .map((pod) => `${pod.metadata.namespace || 'default'}/${pod.metadata.name}:${pod.status.phase}`)
      .join(',');
    return `${nodeKey}|${podKey}`;
  });

  const clusterHealth = createMemo<ClusterHealthData>(() => computeClusterHealth(props.nodes, props.pods));
  const healthState = createMemo(() => {
    const h = clusterHealth();
    if (h.healthPercent < HEALTH_HUB_CONFIG.thresholds.critical) return 'critical';
    if (h.healthPercent < HEALTH_HUB_CONFIG.thresholds.warning) return 'warning';
    return 'healthy';
  });

  let healthOrb: THREE.Mesh;
  let healthRingMaterials: THREE.ShaderMaterial[] = [];
  let coreRings: THREE.Mesh[] = [];

  const rebuildVisualRefs = () => {
    nodeVisuals.length = 0;
    podVisuals.length = 0;
    serviceVisuals.length = 0;

    for (const obj of objectMap.values()) {
      const userData = obj.userData as {
        type?: 'node' | 'pod' | 'service';
        scannerRef?: THREE.Mesh;
        coreRef?: THREE.Object3D;
        cpuRingRef?: RingMesh;
        memRingRef?: RingMesh;
        nodeName?: string;
        initialY?: number;
      };

      if (userData.type === 'node') {
        nodeVisuals.push({
          scannerRef: userData.scannerRef,
          coreRef: userData.coreRef,
          cpuRingRef: userData.cpuRingRef,
          memRingRef: userData.memRingRef,
          nodeName: userData.nodeName,
        });
      } else if (userData.type === 'pod' && typeof userData.initialY === 'number') {
        podVisuals.push({
          mesh: obj,
          initialY: userData.initialY,
          waveOffset: obj.id % 20,
        });
      } else if (userData.type === 'service' && typeof userData.initialY === 'number') {
        serviceVisuals.push({
          mesh: obj,
          initialY: userData.initialY,
          waveOffset: obj.id % 10,
        });
      }
    }
  };

  const updateHealthHub = (health: ClusterHealthData) => {
    const state = healthState();
    const color = HEALTH_HUB_CONFIG.colors[state];
    if (healthOrb) (healthOrb.material as THREE.MeshBasicMaterial).color.setHex(color);
    if (healthRingMaterials.length === 3) {
      healthRingMaterials[0].uniforms.uProgress.value = health.apiServerHealthy ? 1.0 : 0.0;
      healthRingMaterials[1].uniforms.uProgress.value = health.controlPlaneHealthy ? 1.0 : 0.0;
      healthRingMaterials[2].uniforms.uProgress.value = health.healthPercent;
      healthRingMaterials[2].uniforms.uColor.value.setHex(color);
      healthRingMaterials[2].uniforms.uPulseSpeed.value = HEALTH_HUB_CONFIG.pulseSpeed[state];
    }
  };

  const publishPerfSnapshot = () => {
    const snapshot: HoloDeckPerfSnapshot = {
      sceneBuildMs: lastSceneBuildMs,
      filterApplyMs: lastFilterApplyMs,
      filterMatchCount: lastFilterMatchCount,
      renderedNodes: nodeVisuals.length,
      renderedPods: podVisuals.length,
      renderedServices: serviceVisuals.length,
      podCurves: curves.length,
      serviceCurves: serviceCurves.length,
      fiAccelInitState: lastSceneAccelDelta.initState,
      fiAccelSelectorCalls: lastSceneAccelDelta.selectorFilterCalls,
      fiAccelSelectorFallbackCalls: lastSceneAccelDelta.selectorFilterFallbackCalls,
      fiAccelSelectorCandidates: lastSceneAccelDelta.selectorFilterCandidates,
      fiAccelSelectorMs: lastSceneAccelDelta.selectorFilterMs,
    };

    if (typeof window !== 'undefined') {
      (window as Window & { __FLEXDECK_HOLODECK_PERF__?: HoloDeckPerfSnapshot }).__FLEXDECK_HOLODECK_PERF__ = snapshot;
    }

    if (perfEnabled()) {
      setPerfSnapshot(snapshot);
    }
  };

  const applyFilterVisuals = () => {
    const filter = props.filter;
    const startedAt = performance.now();
    let matchCount = 0;
    objectMap.forEach((obj, id) => {
      const data = dataMap.get(id);
      if (!data) return;
      const matches = id.startsWith('node-')
        ? nodeMatchesFilter(data as K8sNode, props.pods, filter)
        : id.startsWith('service-')
          ? serviceMatchesFilter(data as K8sService, filter)
          : podMatchesFilter(data as K8sPod, filter);
      matchesFilterMap.set(id, matches);
      if (matches) matchCount++;
      const mats = obj.userData.filterableMaterials as THREE.Material[];
      if (mats) {
        mats.forEach((material) => {
          const filterable = material as THREE.Material & {
            opacity?: number;
            transparent?: boolean;
            userData: Record<string, unknown>;
          };
          filterable.transparent = true;
          filterable.opacity = matches ? Number(filterable.userData.originalOpacity ?? 1) : 0.15;
        });
      }
    });
    lastFilterApplyMs = performance.now() - startedAt;
    lastFilterMatchCount = matchCount;
    publishPerfSnapshot();
  };

  const refreshSceneVisuals = () => {
    if (objectMap.size === 0) return;

    for (const node of props.nodes) {
      const nodeId = `node-${node.metadata.name}`;
      dataMap.set(nodeId, node);
      const object = objectMap.get(nodeId);
      if (!object) continue;
      const userData = object.userData as HoloNodeUserData;
      const nextColor = isK8sNodeReady(node)
        ? HOLO_THEME.colors.node.ready
        : HOLO_THEME.colors.node.error;

      const scannerMaterial = userData.scannerRef?.material as THREE.MeshBasicMaterial | undefined;
      if (scannerMaterial) {
        scannerMaterial.color.setHex(nextColor);
      }

      const coreMaterial = (userData.coreRef as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined;
      if (coreMaterial) {
        coreMaterial.color.setHex(nextColor);
      }

      const tower = userData.coreRef?.parent as THREE.Object3D | undefined;
      const edgeMaterial = tower?.children.find((child) => child instanceof THREE.LineSegments)?.material as
        | THREE.LineBasicMaterial
        | undefined;
      if (edgeMaterial) {
        edgeMaterial.color.setHex(nextColor);
      }
    }

    for (const pod of props.pods) {
      const podId = `pod-${pod.metadata.namespace || 'default'}-${pod.metadata.name}`;
      dataMap.set(podId, pod);
      const object = objectMap.get(podId);
      if (!(object instanceof THREE.Mesh)) continue;
      const nextColor = pod.status.phase === 'Running'
        ? HOLO_THEME.colors.pod.running
        : pod.status.phase === 'Pending'
          ? HOLO_THEME.colors.pod.pending
          : HOLO_THEME.colors.pod.error;
      const material = object.material as THREE.MeshStandardMaterial | undefined;
      if (!material) continue;
      material.color.setHex(nextColor);
      material.emissive.setHex(nextColor);
    }

    for (const service of props.services) {
      dataMap.set(`service-${service.metadata.namespace || 'default'}-${service.metadata.name}`, service);
    }

    applyFilterVisuals();
  };

  onMount(() => {
    if (!containerRef) return;
    const perf = readPerfToggle();
    setPerfEnabled(perf);
    if (perf) {
      console.info('[HoloDeck] Perf HUD enabled. Add ?holodeckPerf=1 or localStorage flexdeck.holodeckPerf=1');
    }
    engine = new HoloEngine(containerRef, getInitialQuality());
    engine.scene.add(dataGroup);

    traffic = new TrafficManager();
    traffic.init(engine.scene);

    // Initial Core Visuals
    const coreGroup = new THREE.Group();
    healthOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(HEALTH_HUB_CONFIG.orbRadius, 1), new THREE.MeshBasicMaterial({ color: HEALTH_HUB_CONFIG.colors.healthy, transparent: true, opacity: 0.4, wireframe: true }));
    healthOrb.position.y = 4;
    coreGroup.add(healthOrb);

    for (let i = 0; i < 3; i++) {
      const radius = HEALTH_HUB_CONFIG.ringRadii[i];
      const mat = new THREE.ShaderMaterial({
        uniforms: { uProgress: { value: 1.0 }, uColor: { value: new THREE.Color(HEALTH_HUB_CONFIG.colors.healthy) }, uTime: { value: 0 }, uPulseSpeed: { value: 0.5 } },
        vertexShader: healthRingVertexShader, fragmentShader: healthRingFragmentShader, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.15, radius, 64).rotateX(-Math.PI / 2), mat);
      ring.position.y = 0.5;
      healthRingMaterials.push(mat);
      coreGroup.add(ring);
    }
    
    const decRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.01, 8, 64), new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.15 }));
    decRing.rotation.x = Math.PI / 2; decRing.position.y = 4;
    coreRings.push(decRing); coreGroup.add(decRing);
    engine.scene.add(coreGroup);

    // --- Init Geoms/Mats ---
    sharedGeoms.nodeBase = markShared(new THREE.CylinderGeometry(2.5, 3, 0.5, 8));
    sharedMats.nodeBase = markShared(new THREE.MeshStandardMaterial({ color: HOLO_THEME.colors.node.base, roughness: 0.2, metalness: 0.8 }));
    sharedGeoms.nodeTower = markShared(new THREE.BoxGeometry(2, 6, 2));
    sharedMats.nodeTower = markShared(new THREE.MeshStandardMaterial({ color: HOLO_THEME.colors.node.tower, transparent: true, opacity: 0.6, roughness: 0.1 }));
    sharedGeoms.nodeEdges = markShared(new THREE.EdgesGeometry(sharedGeoms.nodeTower));
    sharedGeoms.nodeCore = markShared(new THREE.OctahedronGeometry(0.8));
    sharedGeoms.nodeScanner = markShared(new THREE.RingGeometry(2.8, 3, 32).rotateX(-Math.PI / 2));
    sharedGeoms.cpuRingBg = markShared(new THREE.RingGeometry(3.3, 3.5, 32).rotateX(-Math.PI / 2));
    sharedGeoms.memRingBg = markShared(new THREE.RingGeometry(3.0, 3.2, 32).rotateX(-Math.PI / 2));
    sharedMats.ringBg = markShared(new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide, transparent: true, opacity: 0.4 }));
    sharedGeoms.cpuProgress = markShared(new THREE.RingGeometry(3.3, 3.5, 64).rotateX(-Math.PI / 2));
    sharedGeoms.memProgress = markShared(new THREE.RingGeometry(3.0, 3.2, 64).rotateX(-Math.PI / 2));
    sharedGeoms.pod = markShared(new THREE.DodecahedronGeometry(0.4));
    
    const hexS = new THREE.Shape();
    for(let j=0; j<6; j++){ const a = (j/6)*Math.PI*2 - Math.PI/6; const hx=Math.cos(a)*1.2, hz=Math.sin(a)*1.2; if(j===0) hexS.moveTo(hx,hz); else hexS.lineTo(hx,hz); }
    sharedGeoms.hex = markShared(new THREE.ExtrudeGeometry(hexS.closePath(), {depth:1.5, bevelEnabled:false}).rotateX(-Math.PI/2).translate(0, 0.75, 0));
    sharedMats.hex = markShared(new THREE.MeshStandardMaterial({ color: 0xa855f7, transparent: true, opacity: 0.7, emissive: 0xa855f7, emissiveIntensity: 0.3 }));
    sharedGeoms.hexEdges = markShared(new THREE.EdgesGeometry(sharedGeoms.hex));
    sharedMats.hexEdges = markShared(new THREE.LineBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.6 }));
    sharedGeoms.glowRing = markShared(new THREE.RingGeometry(0.7, 1.0, 6).rotateX(-Math.PI/2));
    sharedMats.glowRing = markShared(new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));

    // Interactions
    const onTouchStart = () => setInteractionType('touch');
    const onMouseMove = (e: MouseEvent) => {
      setInteractionType('mouse');
      const rect = containerRef!.getBoundingClientRect();
      engine.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      engine.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      engine.raycaster.setFromCamera(engine.mouse, engine.camera);
      const intersects = engine.raycaster.intersectObject(dataGroup, true);
      let hit: THREE.Object3D | null = null;
      for (const i of intersects) {
        let o: any = i.object; while(o && !o.userData?.type) o = o.parent;
        if (o) { hit = o; break; }
      }
      const resourceId = hit?.userData?.resourceId as string | undefined;
      if (hit && hit.userData.label && (matchesFilterMap.get(resourceId ?? '') ?? true)) {
        containerRef!.style.cursor = 'pointer';
        // Only show hover tooltip for mouse interactions
        if (interactionType() === 'mouse') {
          setHoverInfo({ title: hit.userData.label, type: hit.userData.type, x: e.clientX - rect.left + 15, y: e.clientY - rect.top });
        }
        engine.controls.autoRotate = false;
      } else {
        containerRef!.style.cursor = 'default'; setHoverInfo(null);
        if (!selectedId()) engine.controls.autoRotate = true;
      }
    };

    const onClick = (e: MouseEvent) => {
      const rect = containerRef!.getBoundingClientRect();
      engine.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      engine.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      engine.raycaster.setFromCamera(engine.mouse, engine.camera);
      const intersects = engine.raycaster.intersectObject(dataGroup, true);
      let hit: any = null;
      for (const i of intersects) {
        let o: any = i.object; while(o && !o.userData?.type) o = o.parent;
        if (o) { hit = o; break; }
      }
      if (hit) {
        const id = hit.userData.resourceId as string | undefined;
        if (!id) return;
        setSelectedId(id);
        // Clear hover info immediately on select (especially important for touch)
        setHoverInfo(null);
        if (props.onSelect) props.onSelect({ type: hit.userData.type, data: dataMap.get(id)! });
      } else {
        setSelectedId(null); props.onSelect?.(null);
      }
    };

    containerRef.addEventListener('touchstart', onTouchStart, { passive: true });
    containerRef.addEventListener('mousemove', onMouseMove);
    containerRef.addEventListener('click', onClick);

    let loopRunning = true;
    const animate = () => {
      if (engine.paused) {
        loopRunning = false;
        return;
      }
      const delta = Math.min(clock.getDelta(), 0.1);
      const time = clock.getElapsedTime();
      engine.gridMaterial.uniforms.uTime.value = time;
      engine.controls.update();
      traffic.spawn(curves, serviceCurves);
      traffic.update(delta, curves, serviceCurves);

      const f = engine.renderer.info.render.frame;
      if (f % 2 === 0) {
        const scannerPulse = Math.sin(time * 2);
        const scannerScale = 1 + scannerPulse * 0.15;
        const scannerOpacity = 0.4 - scannerPulse * 0.15;
        for (const node of nodeVisuals) {
          const scanner = node.scannerRef;
          if (!scanner) continue;
          scanner.scale.setScalar(scannerScale);
          (scanner.material as THREE.MeshBasicMaterial).opacity = scannerOpacity;
        }
      }

      const shouldRefreshMetrics = f % 60 === 0;
      for (const node of nodeVisuals) {
        const coreRef = node.coreRef;
        if (coreRef) {
          coreRef.rotation.y += delta * 0.8;
          coreRef.rotation.x += delta * 0.4;
        }

        if (!shouldRefreshMetrics || !node.nodeName) continue;
        const metrics = getNodeMetrics(node.nodeName);
        if (!metrics) continue;

        if (node.cpuRingRef) node.cpuRingRef.material.uniforms.uProgress.value = metrics.cpuUsage / 100;
        if (node.memRingRef) node.memRingRef.material.uniforms.uProgress.value = metrics.memoryPercent / 100;
      }

      for (const pod of podVisuals) {
        const { mesh, initialY, waveOffset } = pod;
        mesh.rotation.x += delta * 0.3;
        mesh.rotation.y += delta * 0.2;
        mesh.position.y = initialY + Math.sin(time * 0.8 + waveOffset) * 0.2;
      }

      for (const service of serviceVisuals) {
        const { mesh, initialY, waveOffset } = service;
        mesh.rotation.y += delta * 0.15;
        mesh.position.y = initialY + Math.sin(time * 0.6 + waveOffset) * 0.3;
      }

      engine.dustParticles.rotation.y = time * 0.03;
      if (healthOrb) { healthOrb.rotation.y = time * 0.1; healthOrb.scale.setScalar(1 + Math.sin(time * 0.5) * 0.08); }
      healthRingMaterials.forEach(m => m.uniforms.uTime.value = time);
      coreRings.forEach(r => r.rotation.z = time * 0.05);

      engine.composer.render();
      animationId = requestAnimationFrame(animate);
    };
    animate();

    let mounted = true;
    const onVisibilityChange = () => {
      if (document.hidden) {
        engine.pause();
      } else if (mounted) {
        engine.resume();
        if (!loopRunning) {
          loopRunning = true;
          clock.getDelta(); // Discard elapsed time while hidden
          animate();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    onCleanup(() => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('resize', handleResize);
      containerRef?.removeEventListener('touchstart', onTouchStart);
      containerRef?.removeEventListener('mousemove', onMouseMove);
      containerRef?.removeEventListener('click', onClick);
      cancelAnimationFrame(animationId);
      engine.dispose();
      traffic.dispose();
      Object.values(sharedGeoms).forEach(g => g.dispose());
      Object.values(sharedMats).forEach(m => m.dispose());
      coreMatCache.forEach(m => m.dispose());
      scannerMatCache.forEach(m => m.dispose());
      edgeMatCache.forEach(m => m.dispose());
      podMatCache.forEach(m => m.dispose());
      podLineMatCache.forEach(m => m.dispose());
    });
  });

  let firstSceneBuild = true;

  createEffect(() => {
    const _sceneKey = sceneTopologyKey();
    untrack(() => {
      const nextIds = computeSceneIds(props.nodes, props.pods, props.services);
      const diff = diffScene(objectMap, nextIds);
      const isMinorUpdate = !firstSceneBuild && diff.removed.size + diff.added.size < diff.unchanged.size;

      if (isMinorUpdate) {
        // Diff-based update: remove departed, add new, reuse unchanged
        for (const id of diff.removed) {
          const obj = objectMap.get(id);
          if (obj) { dataGroup.remove(obj); disposeObject(obj); }
          objectMap.delete(id);
          dataMap.delete(id);
        }

        // Build only the new entities via a full build into a temporary context,
        // then cherry-pick new objects. This reuses the existing buildScene logic.
        if (diff.added.size > 0) {
          const tempGroup = new THREE.Group();
          const tempObjectMap = new Map<string, THREE.Object3D>();
          const tempDataMap = new Map<string, typeof dataMap extends Map<string, infer V> ? V : never>();
          const tempServiceToPodsMap = new Map<string, string[]>();
          const tempCtx: SceneContext = {
            dataGroup: tempGroup, objectMap: tempObjectMap, dataMap: tempDataMap,
            serviceToPodsMap: tempServiceToPodsMap, sharedGeoms, sharedMats,
            coreMatCache, scannerMatCache, edgeMatCache, podMatCache, podLineMatCache,
          };
          const res = buildScene(tempCtx, props.nodes, props.pods, props.services);

          // Adopt only the new objects from the temp build
          for (const id of diff.added) {
            const obj = tempObjectMap.get(id);
            const data = tempDataMap.get(id);
            if (obj) {
              tempGroup.remove(obj);
              dataGroup.add(obj);
              objectMap.set(id, obj);
              if (data) dataMap.set(id, data);
            }
          }
          // Copy service-to-pods mappings for new services
          for (const id of diff.added) {
            if (id.startsWith('service-') && tempServiceToPodsMap.has(id)) {
              serviceToPodsMap.set(id, tempServiceToPodsMap.get(id)!);
            }
          }

          // Dispose leftover temp objects (unchanged entities that were rebuilt unnecessarily)
          while (tempGroup.children.length > 0) {
            const c = tempGroup.children[0];
            tempGroup.remove(c);
            disposeObject(c);
          }

          curves = res.curves;
          serviceCurves = res.serviceCurves;
        }

        rebuildVisualRefs();
        applyFilterVisuals();
      } else {
        // Full rebuild for first mount or major topology changes
        while (dataGroup.children.length > 0) { const c = dataGroup.children[0]; dataGroup.remove(c); disposeObject(c); }
        objectMap.clear(); dataMap.clear(); serviceToPodsMap.clear();
        nodeVisuals.length = 0;
        podVisuals.length = 0;
        serviceVisuals.length = 0;
        const fiAccelBefore = getFiAccelMetricsSnapshot();
        const sceneBuildStartedAt = performance.now();
        const ctx: SceneContext = { dataGroup, objectMap, dataMap, serviceToPodsMap, sharedGeoms, sharedMats, coreMatCache, scannerMatCache, edgeMatCache, podMatCache, podLineMatCache };
        const res = buildScene(ctx, props.nodes, props.pods, props.services);
        lastSceneBuildMs = performance.now() - sceneBuildStartedAt;
        lastSceneAccelDelta = diffFiAccelMetrics(fiAccelBefore, getFiAccelMetricsSnapshot());
        curves = res.curves; serviceCurves = res.serviceCurves;
        rebuildVisualRefs();
        applyFilterVisuals();
        firstSceneBuild = false;
      }
    });
  });

  createEffect(() => {
    const _styleKey = sceneStyleKey();
    untrack(() => {
      refreshSceneVisuals();
    });
  });

  createEffect(() => {
    if (perfEnabled()) {
      publishPerfSnapshot();
    }
  });

  createEffect(() => { void props.filter; if (objectMap.size > 0) applyFilterVisuals(); });
  createEffect(() => { const h = clusterHealth(); if (healthRingMaterials.length > 0) updateHealthHub(h); });

  return (
    <div class="relative h-full w-full overflow-hidden">
        <div ref={containerRef} class="h-full w-full bg-[#030508]" />
        
        {/* Popups & Central Hub (Ported directly from original) */}
        <Show when={hoverInfo()}>
            {info => (
                <div class="absolute pointer-events-none z-20" style={{ left: `${info().x}px`, top: `${info().y}px` }}>
                    <div class="relative ml-4 mt-4">
                        <div class="absolute -left-4 -top-4 h-4 w-4 border-l border-t border-white/20" />
                        <div class="rounded-sm border border-white/15 bg-black/90 p-2 text-xs min-w-[140px]">
                            <div class="flex items-center gap-2 mb-1 border-b border-white/10 pb-1">
                                <div class="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse" />
                                <div class="font-bold text-white uppercase tracking-wider">{info().type}</div>
                            </div>
                            <div class="font-mono text-white/90 mb-1">{info().title}</div>
                            <Show when={info().type === 'node' && info().status}>
                                <div class="flex items-center gap-2 text-[10px] mt-1 pt-1 border-t border-white/5">
                                    <span class={`px-1 rounded ${info().status === 'Ready' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{info().status}</span>
                                    <Show when={info().podCount !== undefined}><span class="text-text-dim">{info().podCount} pods</span></Show>
                                </div>
                            </Show>
                            <Show when={info().type === 'pod'}>
                                <div class="text-[10px] mt-1 pt-1 border-t border-white/5 space-y-0.5">
                                    <Show when={info().namespace}><div class="text-text-dim">ns: <span class="text-text-muted">{info().namespace}</span></div></Show>
                                    <Show when={info().status}><div class={`inline-block px-1 rounded ${info().status === 'Running' ? 'bg-green-500/20 text-green-400' : (info().status === 'Pending' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400')}`}>{info().status}</div></Show>
                                </div>
                            </Show>
                            <div class="text-[9px] text-text-dim mt-1 opacity-60">Click to select</div>
                        </div>
                    </div>
                </div>
            )}
        </Show>

        <div class="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none">
            <div class="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/85 px-5 py-4 shadow-[0_0_25px_rgba(0,240,255,0.18)]">
                <div class="text-[9px] uppercase tracking-[0.4em] text-text-muted">Cluster Core</div>
                <div class="flex items-end gap-2">
                    <span class={`text-3xl font-semibold ${healthState() === 'healthy' ? 'text-status-ok' : (healthState() === 'warning' ? 'text-status-warn' : 'text-status-error')}`}>{formatPercent(clusterHealth().healthPercent * 100, 0)}</span>
                    <span class={`text-[10px] uppercase tracking-wider ${healthState() === 'healthy' ? 'text-status-ok' : (healthState() === 'warning' ? 'text-status-warn' : 'text-status-error')}`}>{healthState().toUpperCase()}</span>
                </div>
                <div class="grid grid-cols-3 gap-3 text-[9px] font-mono text-text-dim">
                    <div class="flex flex-col items-center gap-1"><span class="text-white/50">Nodes</span><span class="text-white/90">{clusterHealth().nodesReady}/{clusterHealth().nodesTotal}</span></div>
                    <div class="flex flex-col items-center gap-1"><span class="text-white/50">Pods</span><span class="text-white/90">{clusterHealth().podsRunning}/{clusterHealth().podsTotal}</span></div>
                    <div class="flex flex-col items-center gap-1"><span class="text-white/50">Services</span><span class="text-white/90">{props.services.length}</span></div>
                </div>
            </div>
        </div>

        <Show when={perfEnabled() && perfSnapshot()}>
            {snapshot => (
                <div class="absolute right-4 top-4 z-10 rounded-md border border-amber-300/40 bg-black/90 p-3 text-[10px] font-mono text-amber-100 pointer-events-none">
                    <div class="mb-1 text-amber-300 uppercase tracking-wider">Holo Perf</div>
                    <div>scene {snapshot().sceneBuildMs.toFixed(1)}ms | filter {snapshot().filterApplyMs.toFixed(2)}ms | visible {snapshot().filterMatchCount}</div>
                    <div>objects n{snapshot().renderedNodes} p{snapshot().renderedPods} s{snapshot().renderedServices} | curves {snapshot().podCurves + snapshot().serviceCurves}</div>
                    <div>fi-accel {snapshot().fiAccelInitState} | selector {snapshot().fiAccelSelectorCalls}x/{snapshot().fiAccelSelectorCandidates} candidates | fallback {snapshot().fiAccelSelectorFallbackCalls} | {snapshot().fiAccelSelectorMs.toFixed(3)}ms</div>
                </div>
            )}
        </Show>
    </div>
  );
};

export default HoloDeck;
