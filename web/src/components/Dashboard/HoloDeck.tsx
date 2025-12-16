import { Component, onMount, onCleanup, createEffect } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';

interface Props {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
}

const HoloDeck: Component<Props> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let animationId: number;
  let particles: THREE.Points;

  // Track created objects to avoid recreation
  const objectMap = new Map<string, THREE.Object3D>();

  onMount(() => {
    if (!containerRef) return;

    // --- SCENE SETUP ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#050a14');
    scene.fog = new THREE.FogExp2(0x050a14, 0.02);

    camera = new THREE.PerspectiveCamera(60, containerRef.clientWidth / containerRef.clientHeight, 0.1, 1000);
    camera.position.set(15, 12, 15);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.clientWidth, containerRef.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    controls.maxPolarAngle = Math.PI / 2 - 0.1; // Don't go below floor

    // --- LIGHTING ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x00d9ff, 1);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0xa855f7, 2, 50); // Purple glow
    pointLight.position.set(0, 5, 0);
    scene.add(pointLight);

    // --- CYBER GRID FLOORS ---
    // Main grid
    const gridHelper = new THREE.GridHelper(100, 50, 0x00d9ff, 0x0a1628);
    // Make grid transparent
    if (!Array.isArray(gridHelper.material)) {
        (gridHelper.material as THREE.Material).transparent = true;
        (gridHelper.material as THREE.Material).opacity = 0.2;
    }
    scene.add(gridHelper);

    // Secondary sub-grid
    const subGrid = new THREE.GridHelper(100, 10, 0xa855f7, 0x000000);
    subGrid.position.y = -0.01;
    scene.add(subGrid);

    // Creates stars/data particles
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 200;
    const posArray = new Float32Array(particlesCount * 3);
    for(let i = 0; i < particlesCount * 3; i++) {
        posArray[i] = (Math.random() - 0.5) * 60; // Spread 60
    }
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particlesMaterial = new THREE.PointsMaterial({
        size: 0.1,
        color: 0x00d9ff,
        transparent: true,
        opacity: 0.8,
    });
    particles = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particles);


    // --- ANIMATION LOOP ---
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();

      // Rotate particles slightly
      if (particles) {
          particles.rotation.y += 0.001;
      }

      // Pulse nodes (if any)
      const time = Date.now() * 0.001;
      objectMap.forEach((obj) => {
          if (obj.userData.type === 'node') {
              obj.position.y = 2 + Math.sin(time + obj.id) * 0.2; // Floating effect
          }
      });

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
        if (!containerRef) return;
        camera.aspect = containerRef.clientWidth / containerRef.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(containerRef.clientWidth, containerRef.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    onCleanup(() => {
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animationId);
        renderer.dispose();
        if (containerRef) containerRef.innerHTML = '';
        objectMap.clear();
    });
  });

  // --- DATA VISUALIZATION LOGIC ---
  createEffect(() => {
     // NOTE: Naive implementation: If node count changes, just rebuild the scene elements.
     // In a real app, we'd diff.
     const currentNodes = props.nodes;
     
     // Remove old nodes from scene
     objectMap.forEach((obj) => scene?.remove(obj));
     objectMap.clear();

     if (currentNodes.length === 0) return;

     const radius = Math.max(10, currentNodes.length * 2);
     
     currentNodes.forEach((node, i) => {
         // Circular Node Layout
         const angle = (i / currentNodes.length) * Math.PI * 2;
         const x = Math.cos(angle) * radius;
         const z = Math.sin(angle) * radius;
         
         const id = node.metadata?.uid || `node-${i}`;
         
         // Visuals: Server Pillar
         const visualGroup = new THREE.Group();
         visualGroup.position.set(x, 2, z);
         visualGroup.userData = { type: 'node' };

         // Styling based on status
         const isReady = node.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
         const color = isReady ? 0x00d9ff : 0xff0055;

         // Geometry
         const geometry = new THREE.BoxGeometry(1.5, 4, 1.5);
         const material = new THREE.MeshPhongMaterial({ 
             color: color, 
             transparent: true, 
             opacity: 0.9,
             emissive: color,
             emissiveIntensity: 0.2,
         });
         const mesh = new THREE.Mesh(geometry, material);
         visualGroup.add(mesh);

         // Wireframe overlay
         const edges = new THREE.EdgesGeometry(geometry);
         const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true }));
         visualGroup.add(line);
         
         // Looking at center
         visualGroup.lookAt(0, 2, 0);

         scene?.add(visualGroup);
         objectMap.set(id, visualGroup);
     });
     
     // Pods Visualization (Orbiting the center or parent nodes)
     // For demo, let's put them in an inner ring
     const pods = props.pods;
     if (pods.length > 0) {
        const podRingRadius = radius * 0.6;
        pods.forEach((pod, i) => {
             // Only show up to 50 pods to avoid clutter in this simple view
             if (i > 50) return;

             const angle = (i / Math.min(pods.length, 50)) * Math.PI * 2;
             const x = Math.cos(angle) * podRingRadius;
             const z = Math.sin(angle) * podRingRadius;
             const y = 2 + Math.random() * 2; // Random height

             const geometry = new THREE.OctahedronGeometry(0.3);
             const material = new THREE.MeshBasicMaterial({ color: 0xa855f7 });
             const mesh = new THREE.Mesh(geometry, material);
             mesh.position.set(x, y, z);
             
             scene?.add(mesh);
             objectMap.set(pod.metadata?.uid || `pod-${i}`, mesh);
        });
     }
  });

  return <div ref={containerRef} class="h-full w-full" />;
};

export default HoloDeck;
