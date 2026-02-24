import { Component, onMount, onCleanup, createEffect, createSignal, createMemo, Show, untrack } from 'solid-js';
import * as THREE from 'three';
import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import { getNodeMetrics, metricsStore } from '../../../stores/metrics';
import { formatBytes, formatPercent } from '../../../lib/format';
import {
    QUALITY_PRESETS,
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
  type HoloDeckFilter
} from './derivedState';
import { TrafficManager } from './traffic';
import { HoloEngine } from './engine';
import { buildScene, type SceneContext } from './sceneBuilder';

export type { HoloDeckFilter } from './derivedState';

interface Props {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
  quality?: QualityLevel;
  filter?: HoloDeckFilter;
  onSelect?: (item: { type: 'node' | 'pod' | 'service'; data: K8sNode | K8sPod | K8sService } | null) => void;
}

const HoloDeck: Component<Props> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let engine: HoloEngine;
  let traffic: TrafficManager;
  let animationId: number;
  const clock = new THREE.Clock();

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

  let curves: THREE.QuadraticBezierCurve3[] = [];
  let serviceCurves: THREE.QuadraticBezierCurve3[] = [];

  const sceneDataKey = createMemo<string>(() => {
    const nodeCount = props.nodes.length;
    const podCount = props.pods.length;
    const svcCount = props.services.length;
    const nodeHash = props.nodes.map(n => n.metadata.name).join(',');
    return `${nodeCount}|${podCount}|${svcCount}|${nodeHash}`;
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

  const applyFilterVisuals = () => {
    const filter = props.filter;
    objectMap.forEach((obj, id) => {
      const data = dataMap.get(id);
      if (!data) return;
      const matches = id.startsWith('node-') ? nodeMatchesFilter(data as K8sNode, props.pods, filter) : podMatchesFilter(data as K8sPod, filter);
      matchesFilterMap.set(id, matches);
      const mats = obj.userData.filterableMaterials as THREE.Material[];
      if (mats) {
        mats.forEach(m => {
          (m as any).transparent = true;
          (m as any).opacity = matches ? (m.userData.originalOpacity ?? 1) : 0.15;
        });
      }
    });
  };

  onMount(() => {
    if (!containerRef) return;
    engine = new HoloEngine(containerRef, props.quality || 'high');
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
    const onMouseMove = (e: MouseEvent) => {
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
      if (hit && hit.userData.label && (matchesFilterMap.get(hit.userData.type === 'node' ? `node-${hit.userData.label}` : hit.userData.type === 'pod' ? `pod-${hit.userData.label}` : `service-${hit.userData.label}`) ?? true)) {
        containerRef!.style.cursor = 'pointer';
        setHoverInfo({ title: hit.userData.label, type: hit.userData.type, x: e.clientX - rect.left + 15, y: e.clientY - rect.top });
        engine.controls.autoRotate = false;
      } else {
        containerRef!.style.cursor = 'default'; setHoverInfo(null);
        if (!selectedId()) engine.controls.autoRotate = true;
      }
    };

    const onClick = (e: MouseEvent) => {
      engine.raycaster.setFromCamera(engine.mouse, engine.camera);
      const intersects = engine.raycaster.intersectObject(dataGroup, true);
      let hit: any = null;
      for (const i of intersects) {
        let o: any = i.object; while(o && !o.userData?.type) o = o.parent;
        if (o) { hit = o; break; }
      }
      if (hit) {
        const id = `${hit.userData.type}-${hit.userData.label}`;
        setSelectedId(id);
        if (props.onSelect) props.onSelect({ type: hit.userData.type, data: dataMap.get(id)! });
      } else {
        setSelectedId(null); props.onSelect?.(null);
      }
    };

    containerRef.addEventListener('mousemove', onMouseMove);
    containerRef.addEventListener('click', onClick);

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.1);
      const time = clock.getElapsedTime();
      engine.gridMaterial.uniforms.uTime.value = time;
      engine.controls.update();
      traffic.spawn(curves, serviceCurves);
      traffic.update(delta, curves, serviceCurves);

      const f = engine.renderer.info.render.frame;
      for (const obj of objectMap.values()) {
        if (obj.userData.type === 'node') {
          if (f % 2 === 0 && obj.userData.scannerRef) {
            const s = obj.userData.scannerRef;
            const scale = 1 + Math.sin(time * 2) * 0.15;
            s.scale.setScalar(scale);
            s.material.opacity = 0.4 - Math.sin(time * 2) * 0.15;
          }
          if (obj.userData.coreRef) {
            obj.userData.coreRef.rotation.y += delta * 0.8;
            obj.userData.coreRef.rotation.x += delta * 0.4;
          }
          if (f % 60 === 0 && obj.userData.nodeName) {
            const m = getNodeMetrics(obj.userData.nodeName);
            if (m) {
              if (obj.userData.cpuRingRef) obj.userData.cpuRingRef.material.uniforms.uProgress.value = m.cpuUsage / 100;
              if (obj.userData.memRingRef) obj.userData.memRingRef.material.uniforms.uProgress.value = m.memoryPercent / 100;
            }
          }
        } else if (obj.userData.type === 'pod') {
          obj.rotation.x += delta * 0.3; obj.rotation.y += delta * 0.2;
          if (obj.userData.initialY) obj.position.y = obj.userData.initialY + Math.sin(time * 0.8 + (obj.id % 20)) * 0.2;
        } else if (obj.userData.type === 'service') {
          obj.rotation.y += delta * 0.15;
          if (obj.userData.initialY) obj.position.y = obj.userData.initialY + Math.sin(time * 0.6 + (obj.id % 10)) * 0.3;
        }
      }

      engine.dustParticles.rotation.y = time * 0.03;
      if (healthOrb) { healthOrb.rotation.y = time * 0.1; healthOrb.scale.setScalar(1 + Math.sin(time * 0.5) * 0.08); }
      healthRingMaterials.forEach(m => m.uniforms.uTime.value = time);
      coreRings.forEach(r => r.rotation.z = time * 0.05);

      engine.composer.render();
      animationId = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    onCleanup(() => {
      window.removeEventListener('resize', handleResize);
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

  createEffect(() => {
    const key = sceneDataKey();
    untrack(() => {
      while(dataGroup.children.length > 0) { const c = dataGroup.children[0]; dataGroup.remove(c); disposeObject(c); }
      objectMap.clear(); dataMap.clear(); serviceToPodsMap.clear();
      const ctx: SceneContext = { dataGroup, objectMap, dataMap, serviceToPodsMap, sharedGeoms, sharedMats, coreMatCache, scannerMatCache, edgeMatCache, podMatCache, podLineMatCache };
      const res = buildScene(ctx, props.nodes, props.pods, props.services);
      curves = res.curves; serviceCurves = res.serviceCurves;
      applyFilterVisuals();
    });
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
                        <div class="absolute -left-4 -top-4 h-4 w-4 border-l border-t border-neon-cyan/50" />
                        <div class="rounded-sm border border-neon-cyan/30 bg-black/90 p-2 text-xs backdrop-blur-md shadow-[0_0_15px_rgba(0,240,255,0.2)] min-w-[140px]">
                            <div class="flex items-center gap-2 mb-1 border-b border-white/10 pb-1">
                                <div class="h-1.5 w-1.5 rounded-full bg-neon-cyan animate-pulse" />
                                <div class="font-bold text-neon-cyan uppercase tracking-wider">{info().type}</div>
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
                                    <Show when={info().namespace}><div class="text-text-dim">ns: <span class="text-neon-purple">{info().namespace}</span></div></Show>
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
            <div class="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-5 py-4 backdrop-blur-md shadow-[0_0_25px_rgba(0,240,255,0.18)]">
                <div class="text-[9px] uppercase tracking-[0.4em] text-neon-cyan/70">Cluster Core</div>
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
    </div>
  );
};

export default HoloDeck;
