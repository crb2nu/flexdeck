import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { prefersReducedMotion } from '../../../lib/motion';
import { tokenHexInt } from '../../../lib/vizTokens';
import { HOLO_THEME, QUALITY_PRESETS, type QualityLevel } from './config';
import { gridVertexShader, gridFragmentShader } from './shaders';

export class HoloEngine {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: THREE.WebGLRenderer;
  public controls!: OrbitControls;
  public composer!: EffectComposer;
  public bloomPass!: UnrealBloomPass;
  public gridMaterial!: THREE.ShaderMaterial;
  public dustParticles!: THREE.Points;
  public raycaster = new THREE.Raycaster();
  public mouse = new THREE.Vector2();
  public paused = false;

  constructor(private container: HTMLDivElement, qualityLevel: QualityLevel) {
    this.init(qualityLevel);
  }

  private init(qualityLevel: QualityLevel) {
    const quality = QUALITY_PRESETS[qualityLevel];

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(HOLO_THEME.colors.background);
    this.scene.fog = new THREE.FogExp2(HOLO_THEME.colors.background, 0.012);

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
    this.camera.position.set(25, 20, 25);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    // Post-processing
    const renderScene = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.container.clientWidth, this.container.clientHeight), 1.5, 0.4, 0.85);
    this.bloomPass.threshold = 0.15;
    this.bloomPass.strength = quality.bloomEnabled ? 1.2 : 0;
    this.bloomPass.radius = 0.4;
    this.bloomPass.enabled = quality.bloomEnabled;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderScene);
    this.composer.addPass(this.bloomPass);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 80;
    this.controls.autoRotate = !prefersReducedMotion();
    this.controls.autoRotateSpeed = 0.6;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.08);
    this.scene.add(ambientLight);
    const spotLight = new THREE.SpotLight(tokenHexInt('info'), 0.4);
    spotLight.position.set(0, 60, 0);
    this.scene.add(spotLight);

    // Grid
    this.gridMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(tokenHexInt('info')) } },
      vertexShader: gridVertexShader,
      fragmentShader: gridFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), this.gridMaterial);
    gridPlane.rotation.x = -Math.PI / 2;
    this.scene.add(gridPlane);

    // Dust
    this.initDust(quality.dustParticleCount, quality.particleSize);
  }

  private initDust(count: number, size: number) {
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cyan = new THREE.Color(tokenHexInt('info'));
    const purple = new THREE.Color(tokenHexInt('violet'));

    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 50;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      const col = Math.random() > 0.8 ? purple : cyan;
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size, transparent: true, opacity: 0.5, vertexColors: true,
      blending: THREE.AdditiveBlending, sizeAttenuation: true
    });
    this.dustParticles = new THREE.Points(geom, mat);
    this.scene.add(this.dustParticles);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  resize() {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.composer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  dispose() {
    this.renderer.dispose();
    this.composer.dispose();
    this.gridMaterial.dispose();
    this.dustParticles.geometry.dispose();
    (this.dustParticles.material as THREE.Material).dispose();
    this.container.innerHTML = '';
  }
}
