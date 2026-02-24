import * as THREE from 'three';
import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import { HOLO_THEME } from './config';
import { arcRingVertexShader, arcRingFragmentShader } from './shaders';
import { markShared } from './utils';

export interface SceneContext {
  dataGroup: THREE.Group;
  objectMap: Map<string, THREE.Object3D>;
  dataMap: Map<string, K8sNode | K8sPod | K8sService>;
  serviceToPodsMap: Map<string, string[]>;
  sharedGeoms: Record<string, THREE.BufferGeometry>;
  sharedMats: Record<string, THREE.Material>;
  coreMatCache: Map<number, THREE.MeshBasicMaterial>;
  scannerMatCache: Map<number, THREE.MeshBasicMaterial>;
  edgeMatCache: Map<number, THREE.LineBasicMaterial>;
  podMatCache: Map<string, THREE.MeshStandardMaterial>;
  podLineMatCache: Map<number, THREE.LineBasicMaterial>;
}

export function buildScene(
  ctx: SceneContext,
  nodes: K8sNode[],
  pods: K8sPod[],
  services: K8sService[]
) {
  const { dataGroup, objectMap, dataMap, serviceToPodsMap, sharedGeoms, sharedMats } = ctx;
  const curves: THREE.QuadraticBezierCurve3[] = [];
  const serviceCurves: THREE.QuadraticBezierCurve3[] = [];

  if (nodes.length === 0) return { curves, serviceCurves };

  const nodeRadius = Math.max(HOLO_THEME.dimensions.nodeRadius, nodes.length * 5);

  // 1. Create Nodes
  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const x = Math.cos(angle) * nodeRadius;
    const z = Math.sin(angle) * nodeRadius;

    const isReady = node.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
    const colorHex = isReady ? HOLO_THEME.colors.node.ready : HOLO_THEME.colors.node.error;
    
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.userData = { type: 'node', label: node.metadata.name };

    const baseHelper = new THREE.Mesh(sharedGeoms.nodeBase, sharedMats.nodeBase);
    group.add(baseHelper);

    const towerH = 6;
    const tower = new THREE.Mesh(sharedGeoms.nodeTower, sharedMats.nodeTower);
    tower.position.y = towerH / 2 + 0.25;

    const edges = new THREE.LineSegments(sharedGeoms.nodeEdges, getEdgeMat(ctx, colorHex));
    tower.add(edges);

    const core = new THREE.Mesh(sharedGeoms.nodeCore, getCoreMat(ctx, colorHex));
    tower.add(core);
    group.add(tower);

    const scanner = new THREE.Mesh(sharedGeoms.nodeScanner, getScannerMat(ctx, colorHex));
    scanner.position.y = 0.3;
    group.add(scanner);

    const cpuRingBg = new THREE.Mesh(sharedGeoms.cpuRingBg, sharedMats.ringBg);
    cpuRingBg.position.y = towerH + 0.5;
    group.add(cpuRingBg);

    const memRingBg = new THREE.Mesh(sharedGeoms.memRingBg, sharedMats.ringBg);
    memRingBg.position.y = towerH + 0.5;
    group.add(memRingBg);

    const cpuRingProgress = createShaderRing(sharedGeoms.cpuProgress, towerH + 0.52, HOLO_THEME.colors.rings.cpu);
    group.add(cpuRingProgress);

    const memRingProgress = createShaderRing(sharedGeoms.memProgress, towerH + 0.52, HOLO_THEME.colors.rings.mem);
    group.add(memRingProgress);

    group.userData.scannerRef = scanner;
    group.userData.coreRef = core;
    group.userData.cpuRingRef = cpuRingProgress;
    group.userData.memRingRef = memRingProgress;
    group.userData.nodeName = node.metadata.name;

    const scannerMat = scanner.material as THREE.MeshBasicMaterial;
    const towerMat = tower.material as THREE.MeshStandardMaterial;
    scannerMat.userData.originalOpacity = scannerMat.opacity;
    towerMat.userData.originalOpacity = towerMat.opacity;
    group.userData.filterableMaterials = [scannerMat, towerMat];

    dataGroup.add(group);
    const nodeId = `node-${node.metadata.name}`;
    objectMap.set(nodeId, group);
    dataMap.set(nodeId, node);
  });

  // 2. Create Pods
  const podsByNamespace = new Map<string, K8sPod[]>();
  const podObjectsByName = new Map<string, THREE.Object3D>();
  const podLinePointsByColor = new Map<number, THREE.Vector3[]>();
  const POINTS_PER_POD_CURVE = 16;

  pods.forEach((pod, i) => {
    const ns = pod.metadata.namespace || 'default';
    if (!podsByNamespace.has(ns)) podsByNamespace.set(ns, []);
    podsByNamespace.get(ns)!.push(pod);

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
    const pColor = status === 'Running' ? HOLO_THEME.colors.pod.running : (status === 'Pending' ? HOLO_THEME.colors.pod.pending : HOLO_THEME.colors.pod.error);

    const podMat = getPodMat(ctx, pColor);
    const mesh = new THREE.Mesh(sharedGeoms.pod, podMat);
    mesh.position.set(px, py, pz);

    podMat.userData.originalOpacity = podMat.opacity ?? 1;
    mesh.userData = {
      type: 'pod',
      label: pod.metadata.name,
      initialY: py,
      filterableMaterials: [podMat]
    };

    dataGroup.add(mesh);
    const podId = `pod-${pod.metadata.name}`;
    objectMap.set(podId, mesh);
    podObjectsByName.set(pod.metadata.name, mesh);
    dataMap.set(podId, pod);

    if (assignedNodeObj) {
      const start = new THREE.Vector3(px, py, pz);
      const end = assignedNodeObj.position.clone().add(new THREE.Vector3(0, 5, 0));
      const mid = start.clone().add(end).multiplyScalar(0.5);
      mid.y += start.distanceTo(end) * 0.3;

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const points = curve.getPoints(POINTS_PER_POD_CURVE);

      if (!podLinePointsByColor.has(pColor)) {
        podLinePointsByColor.set(pColor, []);
      }
      const colorPoints = podLinePointsByColor.get(pColor)!;
      colorPoints.push(...points);
      colorPoints.push(new THREE.Vector3(NaN, NaN, NaN));

      curves.push(curve);
    }
  });

  podLinePointsByColor.forEach((points, colorHex) => {
    if (points.length > 1) {
      points.pop();
      const batchedGeom = new THREE.BufferGeometry().setFromPoints(points);
      const batchedLine = new THREE.LineSegments(batchedGeom, getPodLineMat(ctx, colorHex));
      dataGroup.add(batchedLine);
    }
  });

  // 3. Create Services
  const serviceRadius = nodeRadius + HOLO_THEME.dimensions.serviceRingOffset;
  services.forEach((svc, i) => {
    if (svc.metadata.name === 'kubernetes' && svc.metadata.namespace === 'default') return;

    const angle = (i / Math.max(services.length, 1)) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(angle) * serviceRadius;
    const z = Math.sin(angle) * serviceRadius;
    const sy = 8 + (i % 3) * 2;

    const hexMesh = new THREE.Mesh(sharedGeoms.hex, sharedMats.hex);
    hexMesh.add(new THREE.LineSegments(sharedGeoms.hexEdges, sharedMats.hexEdges));
    const glowRing = new THREE.Mesh(sharedGeoms.glowRing, sharedMats.glowRing);
    glowRing.position.y = 1.5 + 0.1;
    hexMesh.add(glowRing);

    hexMesh.position.set(x, sy, z);
    hexMesh.userData = { type: 'service', label: svc.metadata.name, initialY: sy };

    dataGroup.add(hexMesh);
    const svcId = `service-${svc.metadata.name}`;
    objectMap.set(svcId, hexMesh);
    dataMap.set(svcId, svc);

    const matchingPodIds: string[] = [];
    const svcPos = new THREE.Vector3(x, sy, z);
    const namespacePods = podsByNamespace.get(svc.metadata.namespace || 'default') || [];
    const podCandidates: { podId: string; dist: number; obj: THREE.Object3D }[] = [];
    
    namespacePods.forEach(pod => {
      if (podMatchesSelector(pod, svc.spec.selector)) {
        const podObj = podObjectsByName.get(pod.metadata.name);
        if (podObj) {
          const dist = svcPos.distanceTo(podObj.position);
          podCandidates.push({ podId: `pod-${pod.metadata.name}`, dist, obj: podObj });
        }
      }
    });

    podCandidates.sort((a, b) => a.dist - b.dist);
    podCandidates.slice(0, 5).forEach(({ podId, obj: podObj }) => {
      matchingPodIds.push(podId);
      const podPos = podObj.position.clone();
      const dist = svcPos.distanceTo(podPos);
      const mid = svcPos.clone().add(podPos).multiplyScalar(0.5);
      mid.y += Math.min(5, dist * 0.15);
      serviceCurves.push(new THREE.QuadraticBezierCurve3(svcPos, mid, podPos));
    });

    serviceToPodsMap.set(svcId, matchingPodIds);
  });

  if (serviceCurves.length > 0) {
    const allLinePoints: THREE.Vector3[] = [];
    serviceCurves.forEach(curve => {
      allLinePoints.push(...curve.getPoints(16));
      allLinePoints.push(new THREE.Vector3(NaN, NaN, NaN));
    });
    allLinePoints.pop();
    const mergedLineGeom = new THREE.BufferGeometry().setFromPoints(allLinePoints);
    const mergedLineMat = new THREE.LineBasicMaterial({
      color: HOLO_THEME.colors.service.primary,
      transparent: true,
      opacity: 0.2
    });
    dataGroup.add(new THREE.LineSegments(mergedLineGeom, mergedLineMat));
  }

  return { curves, serviceCurves };
}

// --- Internal Helpers ---

function getCoreMat(ctx: SceneContext, colorHex: number) {
  if (!ctx.coreMatCache.has(colorHex)) {
    ctx.coreMatCache.set(colorHex, markShared(new THREE.MeshBasicMaterial({ color: colorHex, wireframe: true })));
  }
  return ctx.coreMatCache.get(colorHex)!;
}

function getScannerMat(ctx: SceneContext, colorHex: number) {
  if (!ctx.scannerMatCache.has(colorHex)) {
    ctx.scannerMatCache.set(colorHex, markShared(new THREE.MeshBasicMaterial({ 
      color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.5 
    })));
  }
  return ctx.scannerMatCache.get(colorHex)!;
}

function getEdgeMat(ctx: SceneContext, colorHex: number) {
  if (!ctx.edgeMatCache.has(colorHex)) {
    ctx.edgeMatCache.set(colorHex, markShared(new THREE.LineBasicMaterial({ 
      color: colorHex, transparent: true, opacity: 0.5 
    })));
  }
  return ctx.edgeMatCache.get(colorHex)!;
}

function getPodMat(ctx: SceneContext, colorHex: number) {
  const key = colorHex.toString(16);
  if (!ctx.podMatCache.has(key)) {
    ctx.podMatCache.set(key, markShared(new THREE.MeshStandardMaterial({
      color: colorHex, emissive: colorHex, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.9
    })));
  }
  return ctx.podMatCache.get(key)!;
}

function getPodLineMat(ctx: SceneContext, colorHex: number) {
  if (!ctx.podLineMatCache.has(colorHex)) {
    ctx.podLineMatCache.set(colorHex, markShared(new THREE.LineBasicMaterial({ 
      color: colorHex, transparent: true, opacity: 0.15 
    })));
  }
  return ctx.podLineMatCache.get(colorHex)!;
}

function createShaderRing(geometry: THREE.BufferGeometry, height: number, colorHex: number) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0.0 },
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: 0.85 }
    },
    vertexShader: arcRingVertexShader,
    fragmentShader: arcRingFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.position.y = height;
  return ring;
}

function podMatchesSelector(pod: K8sPod, selector: Record<string, string> | undefined): boolean {
  if (!selector) return false;
  const podLabels = pod.metadata.labels || {};
  return Object.entries(selector).every(([key, value]) => podLabels[key] === value);
}
