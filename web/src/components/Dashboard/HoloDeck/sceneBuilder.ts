import * as THREE from 'three';
import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import { filterLabelSelectorMatches } from '../../../lib/fiAccel';
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
  const podResourceID = (pod: K8sPod) => `pod-${pod.metadata.namespace || 'default'}-${pod.metadata.name}`;
  const serviceResourceID = (service: K8sService) => `service-${service.metadata.namespace || 'default'}-${service.metadata.name}`;
  const cloneMaterial = <T extends THREE.Material>(material: T): T => material.clone() as T;

  // 1. Create Nodes
  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const x = Math.cos(angle) * nodeRadius;
    const z = Math.sin(angle) * nodeRadius;

    const isReady = node.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
    const colorHex = isReady ? HOLO_THEME.colors.node.ready : HOLO_THEME.colors.node.error;
    
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const nodeID = `node-${node.metadata.name}`;
    group.userData = { type: 'node', label: node.metadata.name, resourceId: nodeID };

    const baseHelper = new THREE.Mesh(sharedGeoms.nodeBase, sharedMats.nodeBase);
    group.add(baseHelper);

    const towerH = 6;
    const towerMat = cloneMaterial(sharedMats.nodeTower as THREE.MeshStandardMaterial);
    const tower = new THREE.Mesh(sharedGeoms.nodeTower, towerMat);
    tower.position.y = towerH / 2 + 0.25;

    const edges = new THREE.LineSegments(sharedGeoms.nodeEdges, getEdgeMat(ctx, colorHex));
    tower.add(edges);

    const core = new THREE.Mesh(sharedGeoms.nodeCore, getCoreMat(ctx, colorHex));
    tower.add(core);
    group.add(tower);

    const scannerMat = cloneMaterial(getScannerMat(ctx, colorHex));
    const scanner = new THREE.Mesh(sharedGeoms.nodeScanner, scannerMat);
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

    scannerMat.userData.originalOpacity = scannerMat.opacity;
    towerMat.userData.originalOpacity = towerMat.opacity;
    group.userData.filterableMaterials = [scannerMat, towerMat];

    dataGroup.add(group);
    objectMap.set(nodeID, group);
    dataMap.set(nodeID, node);
  });

  // 2. Create Pods
  const podsByNamespace = new Map<string, K8sPod[]>();
  const podLabelSetsByNamespace = new Map<string, Array<Record<string, string> | undefined>>();
  const podObjectsByID = new Map<string, THREE.Object3D>();
  const podLinePointsByColor = new Map<number, THREE.Vector3[]>();
  const POINTS_PER_POD_CURVE = 16;

  pods.forEach((pod, i) => {
    const ns = pod.metadata.namespace || 'default';
    if (!podsByNamespace.has(ns)) podsByNamespace.set(ns, []);
    podsByNamespace.get(ns)!.push(pod);
    if (!podLabelSetsByNamespace.has(ns)) podLabelSetsByNamespace.set(ns, []);
    podLabelSetsByNamespace.get(ns)!.push(pod.metadata.labels);

    if (i > 150) return;

    const assignedNodeName = pod.spec.nodeName;
    const assignedNodeObj = objectMap.get(`node-${assignedNodeName}`);

    const angle = (i * 137.5) * (Math.PI / 180);
    let px = 0, pz = 0, py = 4 + (i % 5) * 0.7;

    if (assignedNodeObj) {
      const dist = 3 + (i % 6) * 1.5;
      const offsetAngle = angle + ((i % 7) * 0.08);
      px = assignedNodeObj.position.x + Math.cos(offsetAngle) * dist;
      pz = assignedNodeObj.position.z + Math.sin(offsetAngle) * dist;
    } else {
      px = Math.cos(angle) * (i * 0.5);
      pz = Math.sin(angle) * (i * 0.5);
    }

    const status = pod.status.phase;
    const pColor = status === 'Running' ? HOLO_THEME.colors.pod.running : (status === 'Pending' ? HOLO_THEME.colors.pod.pending : HOLO_THEME.colors.pod.error);

    const podMat = cloneMaterial(getPodMat(ctx, pColor));
    const mesh = new THREE.Mesh(sharedGeoms.pod, podMat);
    mesh.position.set(px, py, pz);

    const podID = podResourceID(pod);
    podMat.userData.originalOpacity = podMat.opacity ?? 1;
    mesh.userData = {
      type: 'pod',
      label: pod.metadata.name,
      resourceId: podID,
      initialY: py,
      filterableMaterials: [podMat]
    };

    dataGroup.add(mesh);
    objectMap.set(podID, mesh);
    podObjectsByID.set(podID, mesh);
    dataMap.set(podID, pod);

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

    const hexMat = cloneMaterial(sharedMats.hex as THREE.MeshStandardMaterial);
    const hexEdgeMat = cloneMaterial(sharedMats.hexEdges as THREE.LineBasicMaterial);
    const glowRingMat = cloneMaterial(sharedMats.glowRing as THREE.MeshBasicMaterial);
    const hexMesh = new THREE.Mesh(sharedGeoms.hex, hexMat);
    hexMesh.add(new THREE.LineSegments(sharedGeoms.hexEdges, hexEdgeMat));
    const glowRing = new THREE.Mesh(sharedGeoms.glowRing, glowRingMat);
    glowRing.position.y = 1.5 + 0.1;
    hexMesh.add(glowRing);

    const serviceID = serviceResourceID(svc);
    hexMesh.position.set(x, sy, z);
    hexMat.userData.originalOpacity = hexMat.opacity ?? 1;
    hexEdgeMat.userData.originalOpacity = hexEdgeMat.opacity ?? 1;
    glowRingMat.userData.originalOpacity = glowRingMat.opacity ?? 1;
    hexMesh.userData = {
      type: 'service',
      label: svc.metadata.name,
      resourceId: serviceID,
      initialY: sy,
      filterableMaterials: [hexMat, hexEdgeMat, glowRingMat],
    };

    dataGroup.add(hexMesh);
    objectMap.set(serviceID, hexMesh);
    dataMap.set(serviceID, svc);

    const matchingPodIds: string[] = [];
    const svcPos = new THREE.Vector3(x, sy, z);
    const namespacePods = podsByNamespace.get(svc.metadata.namespace || 'default') || [];
    const namespacePodLabelSets = podLabelSetsByNamespace.get(svc.metadata.namespace || 'default') || [];
    const podCandidates: { podId: string; dist: number; obj: THREE.Object3D }[] = [];

    const matchingIndexes = filterLabelSelectorMatches(svc.spec.selector, namespacePodLabelSets);
    matchingIndexes.forEach((podIndex) => {
      const pod = namespacePods[podIndex];
      if (!pod) return;
      const podID = podResourceID(pod);
      const podObj = podObjectsByID.get(podID);
      if (podObj) {
        const dist = svcPos.distanceTo(podObj.position);
        podCandidates.push({ podId: podID, dist, obj: podObj });
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

    serviceToPodsMap.set(serviceID, matchingPodIds);
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
