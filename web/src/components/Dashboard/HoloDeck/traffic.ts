import * as THREE from 'three';
import { tokenHexInt } from '../../../lib/vizTokens';
import { TRAFFIC_CONFIG, type TrafficType } from './config';
import { trafficVertexShader, trafficFragmentShader } from './shaders';

interface TrafficSlot {
  active: boolean;
  curveIndex: number;
  progress: number;
  speed: number;
  trafficType: TrafficType;
}

interface ServiceTrafficSlot {
  active: boolean;
  curveIndex: number;
  progress: number;
  speed: number;
}

export class TrafficManager {
  private trafficPool: TrafficSlot[];
  private serviceTrafficPool: ServiceTrafficSlot[];
  private trafficInstancedMesh!: THREE.InstancedMesh;
  private trafficColors!: THREE.InstancedBufferAttribute;
  private serviceTrafficMesh!: THREE.InstancedMesh;
  private trafficDummy = new THREE.Object3D();
  private lastTrafficSpawnTime = 0;
  private lastServiceSpawnTime = 0;
  private activeTrafficCount = 0;
  private activeServiceTrafficCount = 0;

  constructor() {
    this.trafficPool = Array.from({ length: TRAFFIC_CONFIG.MAX_TRAFFIC }, () => ({
      active: false,
      curveIndex: 0,
      progress: 0,
      speed: 0,
      trafficType: 'healthy'
    }));

    this.serviceTrafficPool = Array.from({ length: TRAFFIC_CONFIG.MAX_SERVICE_TRAFFIC }, () => ({
      active: false,
      curveIndex: 0,
      progress: 0,
      speed: 0
    }));
  }

  init(scene: THREE.Scene) {
    const { MAX_TRAFFIC, MAX_SERVICE_TRAFFIC } = TRAFFIC_CONFIG;

    // --- MAIN TRAFFIC ---
    const packetGeom = new THREE.SphereGeometry(0.15, 8, 8);
    const colorArray = new Float32Array(MAX_TRAFFIC * 3);
    const defaultColor = new THREE.Color(TRAFFIC_CONFIG.colors.healthy);
    for (let i = 0; i < MAX_TRAFFIC; i++) {
      colorArray[i * 3] = defaultColor.r;
      colorArray[i * 3 + 1] = defaultColor.g;
      colorArray[i * 3 + 2] = defaultColor.b;
    }
    this.trafficColors = new THREE.InstancedBufferAttribute(colorArray, 3);
    packetGeom.setAttribute('instanceColor', this.trafficColors);

    const packetMat = new THREE.ShaderMaterial({
      vertexShader: trafficVertexShader,
      fragmentShader: trafficFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.trafficInstancedMesh = new THREE.InstancedMesh(packetGeom, packetMat, MAX_TRAFFIC);
    this.trafficInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Hide all
    const hideMatrix = new THREE.Matrix4().makeTranslation(0, -1000, 0);
    for (let i = 0; i < MAX_TRAFFIC; i++) {
      this.trafficInstancedMesh.setMatrixAt(i, hideMatrix);
    }
    scene.add(this.trafficInstancedMesh);

    // --- SERVICE TRAFFIC ---
    const servicePacketGeom = new THREE.SphereGeometry(0.12, 6, 6);
    const servicePacketMat = new THREE.MeshBasicMaterial({ color: tokenHexInt('violet') });
    this.serviceTrafficMesh = new THREE.InstancedMesh(servicePacketGeom, servicePacketMat, MAX_SERVICE_TRAFFIC);
    this.serviceTrafficMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_SERVICE_TRAFFIC; i++) {
      this.serviceTrafficMesh.setMatrixAt(i, hideMatrix);
    }
    scene.add(this.serviceTrafficMesh);
  }

  spawn(curves: THREE.QuadraticBezierCurve3[], serviceCurves: THREE.QuadraticBezierCurve3[]) {
    const now = performance.now();

    // Main Traffic
    if (curves.length > 0 && now - this.lastTrafficSpawnTime > TRAFFIC_CONFIG.TRAFFIC_SPAWN_INTERVAL) {
      const maxActive = Math.min(TRAFFIC_CONFIG.MAX_TRAFFIC, Math.max(10, curves.length * 0.3));
      if (this.activeTrafficCount < maxActive) {
        for (let i = 0; i < TRAFFIC_CONFIG.MAX_TRAFFIC; i++) {
          if (!this.trafficPool[i].active) {
            const type = this.pickTrafficType();
            const color = new THREE.Color(TRAFFIC_CONFIG.colors[type]);
            this.trafficPool[i].active = true;
            this.trafficPool[i].curveIndex = Math.floor(Math.random() * curves.length);
            this.trafficPool[i].progress = 0;
            this.trafficPool[i].speed = 0.5 + Math.random() * 0.5;
            this.trafficPool[i].trafficType = type;
            this.trafficColors.setXYZ(i, color.r, color.g, color.b);
            this.trafficColors.needsUpdate = true;
            this.activeTrafficCount++;
            this.lastTrafficSpawnTime = now;
            break;
          }
        }
      }
    }

    // Service Traffic
    if (serviceCurves.length > 0 && now - this.lastServiceSpawnTime > TRAFFIC_CONFIG.SERVICE_SPAWN_INTERVAL) {
      const maxActive = Math.min(TRAFFIC_CONFIG.MAX_SERVICE_TRAFFIC * 0.4, serviceCurves.length * 2);
      if (this.activeServiceTrafficCount < maxActive) {
        for (let i = 0; i < TRAFFIC_CONFIG.MAX_SERVICE_TRAFFIC; i++) {
          if (!this.serviceTrafficPool[i].active) {
            this.serviceTrafficPool[i].active = true;
            this.serviceTrafficPool[i].curveIndex = Math.floor(Math.random() * serviceCurves.length);
            this.serviceTrafficPool[i].progress = 0;
            this.serviceTrafficPool[i].speed = 0.3 + Math.random() * 0.3;
            this.activeServiceTrafficCount++;
            this.lastServiceSpawnTime = now;
            break;
          }
        }
      }
    }
  }

  update(delta: number, curves: THREE.QuadraticBezierCurve3[], serviceCurves: THREE.QuadraticBezierCurve3[]) {
    let mainUpdate = false;
    const hidePos = new THREE.Vector3(0, -1000, 0);

    for (let i = 0; i < TRAFFIC_CONFIG.MAX_TRAFFIC; i++) {
      const slot = this.trafficPool[i];
      if (slot.active) {
        slot.progress += slot.speed * delta * 0.5;
        if (slot.progress >= 1) {
          slot.active = false;
          this.activeTrafficCount--;
          this.trafficDummy.position.copy(hidePos);
          this.trafficDummy.updateMatrix();
          this.trafficInstancedMesh.setMatrixAt(i, this.trafficDummy.matrix);
          mainUpdate = true;
        } else if (curves[slot.curveIndex]) {
          const pos = curves[slot.curveIndex].getPoint(slot.progress);
          this.trafficDummy.position.copy(pos);
          this.trafficDummy.updateMatrix();
          this.trafficInstancedMesh.setMatrixAt(i, this.trafficDummy.matrix);
          mainUpdate = true;
        }
      }
    }
    if (mainUpdate) this.trafficInstancedMesh.instanceMatrix.needsUpdate = true;

    let serviceUpdate = false;
    for (let i = 0; i < TRAFFIC_CONFIG.MAX_SERVICE_TRAFFIC; i++) {
      const slot = this.serviceTrafficPool[i];
      if (slot.active) {
        slot.progress += slot.speed * delta * 0.4;
        if (slot.progress >= 1) {
          slot.active = false;
          this.activeServiceTrafficCount--;
          this.trafficDummy.position.copy(hidePos);
          this.trafficDummy.updateMatrix();
          this.serviceTrafficMesh.setMatrixAt(i, this.trafficDummy.matrix);
          serviceUpdate = true;
        } else if (serviceCurves[slot.curveIndex]) {
          const pos = serviceCurves[slot.curveIndex].getPoint(slot.progress);
          this.trafficDummy.position.copy(pos);
          this.trafficDummy.updateMatrix();
          this.serviceTrafficMesh.setMatrixAt(i, this.trafficDummy.matrix);
          serviceUpdate = true;
        }
      }
    }
    if (serviceUpdate) this.serviceTrafficMesh.instanceMatrix.needsUpdate = true;
  }

  reset() {
    for (let i = 0; i < TRAFFIC_CONFIG.MAX_TRAFFIC; i++) this.trafficPool[i].active = false;
    for (let i = 0; i < TRAFFIC_CONFIG.MAX_SERVICE_TRAFFIC; i++) this.serviceTrafficPool[i].active = false;
    this.activeTrafficCount = 0;
    this.activeServiceTrafficCount = 0;
  }

  dispose() {
    this.trafficInstancedMesh.dispose();
    this.serviceTrafficMesh.dispose();
  }

  private pickTrafficType(): TrafficType {
    const rand = Math.random();
    const weights = TRAFFIC_CONFIG.typeWeights;
    let cumulative = 0;
    cumulative += weights.healthy;
    if (rand < cumulative) return 'healthy';
    cumulative += weights.warning;
    if (rand < cumulative) return 'warning';
    cumulative += weights.error;
    if (rand < cumulative) return 'error';
    return 'internal';
  }
}
