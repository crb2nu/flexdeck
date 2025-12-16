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
    float alpha = 1.0 - smoothstep(10.0, 50.0, dist);
    
    // Grid pattern
    float gridSize = 2.0;
    float lineThickness = 0.05;
    
    float x = abs(fract(vWorldPosition.x / gridSize - 0.5) - 0.5);
    float z = abs(fract(vWorldPosition.z / gridSize - 0.5) - 0.5);
    
    float grid = step(0.5 - lineThickness, x) + step(0.5 - lineThickness, z);
    
    // Scanline
    float scan = smoothstep(0.0, 0.5, abs(fract((dist - uTime * 5.0) / 20.0) - 0.5));
    
    vec3 finalColor = uColor * (grid * 0.5 + scan * 0.5);
    
    gl_FragColor = vec4(finalColor, alpha * (grid + scan * 0.5) * 0.5);
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

  onMount(() => {
    if (!containerRef) return;

    // --- SETUP ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#030508'); // Darker background for bloom pop
    scene.fog = new THREE.FogExp2(0x030508, 0.015);

    camera = new THREE.PerspectiveCamera(60, containerRef.clientWidth / containerRef.clientHeight, 0.1, 1000);
    camera.position.set(20, 15, 20);

    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(containerRef.clientWidth, containerRef.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    containerRef.appendChild(renderer.domElement);

    // --- POST PROCESSING (BLOOM) ---
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(containerRef.clientWidth, containerRef.clientHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.2;
    bloomPass.strength = 1.5; // Intense bloom
    bloomPass.radius = 0.5;

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // --- CONTROLS ---
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 60;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    // --- RAYCASTER ---
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // --- LIGHTS ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    scene.add(ambientLight);

    // --- CUSTOM GRID ---
    gridMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0x00d9ff) }
        },
        vertexShader: gridVertexShader,
        fragmentShader: gridFragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    
    // Make grid larger
    const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), gridMaterial);
    gridPlane.rotation.x = -Math.PI / 2;
    scene.add(gridPlane);

    // --- EVENTS ---
    const onMouseMove = (event: MouseEvent) => {
        if (!containerRef) return;
        const rect = containerRef.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        // Raycasting Logic
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        
        // Filter for "interactive" objects (towers or pods)
        const hit = intersects.find(i => {
           // Traverse up to find user data
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
            // Traverse up to find the root object with data
            while(obj && !obj.userData.type) {
                if (obj.parent) obj = obj.parent;
                else break;
            }

            if (obj && obj.userData.label) {
                 setHoverInfo({
                    title: obj.userData.label,
                    type: obj.userData.type,
                    x: event.clientX - rect.left + 10,
                    y: event.clientY - rect.top + 10
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
    const packetGeom = new THREE.SphereGeometry(0.1, 8, 8);
    const packetMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const spawnTraffic = () => {
         // Chance to spawn packet on a random curve
         if (curves.length > 0 && traffic.length < 50 && Math.random() > 0.9) {
             const curve = curves[Math.floor(Math.random() * curves.length)];
             const mesh = new THREE.Mesh(packetGeom, packetMat);
             scene.add(mesh);
             traffic.push({
                 mesh,
                 curve,
                 progress: 0,
                 speed: 0.5 + Math.random() * 0.5 // Speed relative to curve length implies standard time, good enough
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
          t.progress += t.speed * delta;
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
          if (obj.userData.initialY) {
              obj.position.y = obj.userData.initialY + Math.sin(time + (obj.id % 10)) * 0.2;
          }
          if (obj.userData.type === 'pod') {
              obj.rotation.x += delta * 0.5;
              obj.rotation.y += delta * 0.3;
          }
      });

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

  // --- REACTIVE SCENE BUILDER ---
  createEffect(() => {
     const currentNodes = props.nodes;
     const currentPods = props.pods;

     // Helper to clear scene safely
     objectMap.forEach((obj) => {
         scene.remove(obj);
         // recursive dispose?
     });
     objectMap.clear();
     
     // Clear traffic
     traffic.forEach(t => scene.remove(t.mesh));
     traffic = [];
     curves = [];
     
     // Remove old lines (found by userData or specific group)
     // For simplicity, we just clear everything except the permanent lights/grid
     // But wait, lights are static. We just want to remove data objects.
     // We can use a Group for data objects.
     // TODO: Refactor to usage of a 'dataGroup' container would be cleaner, but for now we rely on objectMap clearing.
     // However, lines were not in objectMap in previous code.
     // Let's create a dataGroup.
  });
  
  // Re-run effect with cleaner logic? 
  // Since we are inside createEffect, we can manage a group.
  let dataGroup = new THREE.Group();
  
  onMount(() => {
      scene.add(dataGroup);
  });

  createEffect(() => {
     // Clear previous data
     while(dataGroup.children.length > 0){ 
         const child = dataGroup.children[0];
         dataGroup.remove(child);
         if (child instanceof THREE.Mesh) {
             child.geometry.dispose();
             if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
             else child.material.dispose();
         }
         // Dispose lines
         if ((child as any).isLine) {
             (child as any).geometry.dispose();
         }
     }
     objectMap.clear();
     curves = [];
     traffic = []; // Old traffic meshes are gone because they were in scene root? No, traffic meshes were added to scene.
     // We should add traffic to dataGroup to be clean or manage them.
     // Let's just fix traffic manually or assume restart.

     const currentNodes = props.nodes;
     const currentPods = props.pods;

     if (currentNodes.length === 0) return;

     const nodeRadius = Math.max(10, currentNodes.length * 4);
     
     // 1. Create Nodes (Servers)
     currentNodes.forEach((node, i) => {
         const angle = (i / currentNodes.length) * Math.PI * 2;
         const x = Math.cos(angle) * nodeRadius;
         const z = Math.sin(angle) * nodeRadius;
         
         const isReady = node.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
         const color = new THREE.Color(isReady ? '#00d9ff' : '#ff0055');

         // Complex Server Geometry
         const group = new THREE.Group();
         group.position.set(x, 0, z);
         group.userData = { 
             type: 'node', 
             label: node.metadata.name, 
             initialY: 0 
         };

         // Base Platform
         const baseGeom = new THREE.CylinderGeometry(1.5, 2, 0.5, 6);
         const baseMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.1, metalness: 0.9 });
         const base = new THREE.Mesh(baseGeom, baseMat);
         group.add(base);

         // Main Tower
         const createTower = () => {
             const h = 5;
             const w = 2;
             const box = new THREE.Mesh(
                 new THREE.BoxGeometry(w, h, w),
                 new THREE.MeshStandardMaterial({ 
                     color: '#050a10', 
                     transparent: true, 
                     opacity: 0.8,
                     roughness: 0.2
                 })
             );
             box.position.y = h/2 + 0.25;
             
             // Edges (Neon)
             const edges = new THREE.EdgesGeometry(box.geometry);
             const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: color }));
             box.add(line);
             
             // Internal "Core" (Animated later?)
             const core = new THREE.Mesh(
                 new THREE.BoxGeometry(w*0.5, h*0.8, w*0.5),
                 new THREE.MeshBasicMaterial({ color: color })
             );
             // core.position.y = 0;
             box.add(core); // inside
             
             return box;
         };

         const tower = createTower();
         group.add(tower);
         
         // Floating Halo
         const ringGeom = new THREE.TorusGeometry(2.5, 0.05, 8, 32);
         const ringMat = new THREE.MeshBasicMaterial({ color: color });
         const ring = new THREE.Mesh(ringGeom, ringMat);
         ring.rotation.x = Math.PI / 2;
         ring.position.y = 6;
         group.add(ring);

         dataGroup.add(group);
         objectMap.set(`node-${node.metadata.name}`, group);
     });

     // 2. Create Pods & Connections
     currentPods.forEach((pod, i) => {
         if (i > 150) return; // Limit
         
         const assignedNodeName = pod.spec.nodeName;
         const assignedNodeObj = objectMap.get(`node-${assignedNodeName}`);
         
         let targetPos = new THREE.Vector3(0, 0, 0);
         if (assignedNodeObj) {
            targetPos.copy(assignedNodeObj.position);
         }
         
         // Position pods
         const angle = (i * 137.5) * (Math.PI / 180); // Phylotaxis-ish
         const dist = 3 + (i % 5) * 1.5; // varied distances
         
         // Relative to Node or Center?
         // If assigned, cluster around node.
         let px, pz;
         if (assignedNodeObj) {
             px = targetPos.x + Math.cos(angle) * dist;
             pz = targetPos.z + Math.sin(angle) * dist;
         } else {
             px = Math.cos(angle) * (i * 0.2);
             pz = Math.sin(angle) * (i * 0.2);
         }
         
         const py = 4 + Math.random() * 4;
         
         const status = pod.status.phase;
         const pColor = status === 'Running' ? '#22c55e' : (status === 'Pending' ? '#eab308' : '#ef4444');

         // Pod Mesh
         const geom = new THREE.OctahedronGeometry(0.5);
         const mat = new THREE.MeshStandardMaterial({ 
             color: pColor, 
             emissive: pColor,
             emissiveIntensity: 0.8,
             roughness: 0.1,
             metalness: 0.9
         });
         const mesh = new THREE.Mesh(geom, mat);
         mesh.position.set(px, py, pz);
         mesh.userData = { 
             type: 'pod', 
             label: pod.metadata.name,
             initialY: py 
         };
         
         dataGroup.add(mesh);
         objectMap.set(`pod-${pod.metadata.name}`, mesh);
         
         // Connection Line
         if (assignedNodeObj) {
            const start = new THREE.Vector3(px, py, pz);
            const end = assignedNodeObj.position.clone().add(new THREE.Vector3(0, 5, 0)); // Top of tower
            
            const mid = start.clone().add(end).multiplyScalar(0.5);
            mid.y += (start.distanceTo(end) * 0.2); // Arch height
            
            const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
            const points = curve.getPoints(20);
            const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
            const lineMat = new THREE.LineDashedMaterial({
                color: pColor,
                dashSize: 0.5,
                gapSize: 0.3,
                opacity: 0.2,
                transparent: true
            });
            const line = new THREE.Line(lineGeom, lineMat);
            line.computeLineDistances();
            
            dataGroup.add(line);
            
            curves.push(curve);
         }
     });

  });

  return (
    <div class="relative h-full w-full">
        <div ref={containerRef} class="h-full w-full bg-gradient-to-b from-gray-950 to-black" />
        
        {/* HUD Popup */}
        <Show when={hoverInfo()}>
            {info => (
                <div 
                    class="absolute pointer-events-none z-20 rounded border border-white/20 bg-black/80 p-2 text-xs backdrop-blur-md text-white shadow-xl"
                    style={{ 
                        left: `${info().x}px`, 
                        top: `${info().y}px`,
                        transform: 'translate(10px, 10px)'
                    }}
                >
                    <div class="font-bold text-neon-cyan mb-1 uppercase tracking-wider">{info().type}</div>
                    <div class="font-mono">{info().title}</div>
                </div>
            )}
        </Show>
        
        {/* Overlay Title */}
        <div class="absolute top-6 left-1/2 -translate-x-1/2 text-center pointer-events-none select-none opacity-80">
            <h2 class="text-[10px] font-mono tracking-[0.4em] text-neon-cyan/80 uppercase mb-1">Interactive Simulation</h2>
            <div class="text-xl font-bold font-display text-white tracking-widest drop-shadow-[0_0_10px_rgba(0,217,255,0.5)]">HOLO-DECK</div>
            <div class="h-px w-32 bg-gradient-to-r from-transparent via-neon-cyan to-transparent mx-auto mt-2"></div>
        </div>
    </div>
  );
};

export default HoloDeck;
