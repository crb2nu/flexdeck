import * as THREE from 'three';

// Recursive dispose helper to prevent VRAM leaks
export const disposeObject = (obj: THREE.Object3D) => {
    if (!obj) return;
    
    if (obj.children) {
        for (const child of obj.children) {
            disposeObject(child);
        }
    }

    if (isDisposable(obj)) {
        // Only dispose if NOT shared
        if (obj.geometry && !obj.geometry.userData?.isShared) {
            obj.geometry.dispose();
        }
        
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => !m.userData?.isShared && m.dispose());
            } else {
                if (!obj.material.userData?.isShared) {
                    obj.material.dispose();
                }
            }
        }
    }
};

// Type Guard for disposable objects
function isDisposable(obj: any): obj is { geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[] } {
    return obj && (obj.isMesh || obj.isLine || obj.isPoints);
}

// Helper to mark resource as shared
export const markShared = <T extends THREE.BufferGeometry | THREE.Material>(resource: T): T => {
    resource.userData = { ...resource.userData, isShared: true };
    return resource;
};
