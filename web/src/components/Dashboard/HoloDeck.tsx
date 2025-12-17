import { Component, onMount, onCleanup, createEffect, createSignal, Show } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';

interface Props {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
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

  // State for popups
  const [hoverInfo, setHoverInfo] = createSignal<{ title: string; type: string; x: number; y: number } | null>(null);

  // Scene Objects
  const objectMap = new Map<string, THREE.Object3D>();
  
  // Traffic System
  interface TrafficPacket {
      mesh: THREE.Mesh;
      curve: THREE.QuadraticBezierCurve3;
      progress: number;
      speed: number;
  }
  let traffic: TrafficPacket[] = [];
  let curves: THREE.QuadraticBezierCurve3[] = [];
  
  let gridMaterial: THREE.ShaderMaterial;
  let dustParticles: THREE.Points;

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
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(containerRef.clientWidth, containerRef.clientHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.15;
    bloomPass.strength = 1.2; 
    bloomPass.radius = 0.4;

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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    scene.add(ambientLight);
    
    // Main spotlight from top
    const spotLight = new THREE.SpotLight(0x00f0ff, 0.5);
    spotLight.position.set(0, 50, 0);
    spotLight.angle = Math.PI / 4;
    scene.add(spotLight);

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

    // --- DUST PARTICLES ---
    const dustCount = 800;
    const dustGeom = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    for(let i=0; i<dustCount*3; i++) {
        dustPos[i] = (Math.random() - 0.5) * 100;
        if (i%3===1) dustPos[i] = Math.random() * 40; // Y only positive
    }
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
        color: 0x00f0ff,
        size: 0.15,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending
    });
    dustParticles = new THREE.Points(dustGeom, dustMat);
    scene.add(dustParticles);


    // --- EVENTS ---
    const onMouseMove = (event: MouseEvent) => {
        if (!containerRef) return;
        const rect = containerRef.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        
        const hit = intersects.find(i => {
           let obj: THREE.Object3D | null = i.object;
           while(obj) {
               if (obj.userData && (obj.userData.type === 'node' || obj.userData.type === 'pod')) return true;
               obj = obj.parent;
           }
           return false;
        });
        
        if (hit) {
            containerRef.style.cursor = 'pointer';
            let obj = hit.object;
            while(obj && !obj.userData.type) {
                if (obj.parent) obj = obj.parent;
                else break;
            }

            if (obj && obj.userData.label) {
                 setHoverInfo({
                    title: obj.userData.label,
                    type: obj.userData.type,
                    x: event.clientX - rect.left + 15,
                    y: event.clientY - rect.top
                });
                controls.autoRotate = false;
            }
        } else {
            containerRef.style.cursor = 'default';
            setHoverInfo(null);
            controls.autoRotate = true;
        }
    };
    containerRef.addEventListener('mousemove', onMouseMove);

    // --- ANIMATION LOOP ---
    const clock = new THREE.Clock();
    
    // Reusable packet geometry
    const packetGeom = new THREE.SphereGeometry(0.15, 8, 8);
    const packetMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const spawnTraffic = () => {
         // High traffic rate
         if (curves.length > 0 && traffic.length < 80 && Math.random() > 0.85) {
             const curve = curves[Math.floor(Math.random() * curves.length)];
             const mesh = new THREE.Mesh(packetGeom, packetMat);
             scene.add(mesh);
             traffic.push({
                 mesh,
                 curve,
                 progress: 0,
                 speed: 0.8 + Math.random() * 0.8
             });
         }
    };

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      // Update uniforms
      gridMaterial.uniforms.uTime.value = time;

      controls.update();

      // Spawn traffic
      spawnTraffic();

      // Animate Traffic
      for (let i = traffic.length - 1; i >= 0; i--) {
          const t = traffic[i];
          t.progress += t.speed * delta * 0.5;
          if (t.progress >= 1) {
              scene.remove(t.mesh);
              traffic.splice(i, 1);
          } else {
              const pos = t.curve.getPoint(t.progress);
              t.mesh.position.copy(pos);
          }
      }
      
      // Floating animation for nodes
      objectMap.forEach(obj => {
          if (obj.userData.type === 'node') {
              // Pulse the scanner ring
              const scanner = obj.getObjectByName('scanner') as THREE.Mesh;
              if (scanner) {
                  scanner.scale.setScalar(1 + Math.sin(time * 2) * 0.2);
                  if (scanner.material) {
                     (scanner.material as THREE.MeshBasicMaterial).opacity = 0.5 - Math.sin(time * 2) * 0.2;
                  }
              }
              // Rotate Core
              const core = obj.getObjectByName('core');
              if (core) {
                  core.rotation.y += delta;
                  core.rotation.x += delta * 0.5;
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
      });
      
      // Animate Dust
      dustParticles.rotation.y = time * 0.05;

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
    // Note: We use a manual effect tracking external props to rebuild the scene
    createEffect(() => {
        // Clear logic
        while(dataGroup.children.length > 0){ 
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
         curves = [];
         traffic.forEach(t => scene.remove(t.mesh));
         traffic = [];

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
             tower.position.y = towerH/2 + 0.25;
             
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
             core.name = 'core';
             tower.add(core);

             group.add(tower);
             
             // Scanner Ring
             const scannerGeom = new THREE.RingGeometry(2.8, 3, 32);
             scannerGeom.rotateX(-Math.PI/2);
             const scanner = new THREE.Mesh(
                 scannerGeom,
                 new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
             );
             scanner.position.y = 0.3;
             scanner.name = 'scanner';
             group.add(scanner);

             dataGroup.add(group);
             objectMap.set(`node-${node.metadata.name}`, group);
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
             objectMap.set(`pod-${pod.metadata.name}`, mesh);
             
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
    });


    onCleanup(() => {
        window.removeEventListener('resize', handleResize);
        containerRef?.removeEventListener('mousemove', onMouseMove);
        cancelAnimationFrame(animationId);
        renderer.dispose();
        composer.dispose();
        if (containerRef) containerRef.innerHTML = '';
        objectMap.clear();
        traffic = [];
    });
  });

  return (
    <div class="relative h-full w-full overflow-hidden">
        <div ref={containerRef} class="h-full w-full bg-[#030508]" />
        
        {/* HUD Popup */}
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
                        
                        <div class="rounded-sm border border-neon-cyan/30 bg-black/90 p-2 text-xs backdrop-blur-md shadow-[0_0_15px_rgba(0,240,255,0.2)]">
                            <div class="flex items-center gap-2 mb-1 border-b border-white/10 pb-1">
                                <div class="h-1.5 w-1.5 rounded-full bg-neon-cyan animate-pulse"></div>
                                <div class="font-bold text-neon-cyan uppercase tracking-wider">{info().type}</div>
                            </div>
                            <div class="font-mono text-white/90">{info().title}</div>
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
