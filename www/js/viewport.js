/* viewport.js — Three.js scene with Blender-style controls */

class Viewport {
    constructor(canvas) {
        this.canvas = canvas;
        this.objects = {};          // id -> THREE.Mesh
        this.selectedId = null;
        this._clickCallback = null;

        this._initRenderer();
        this._initScene();
        this._initCamera();
        this._initLights();
        this._initControls();

        this.animate();
    }

    // -------------------------------------------------------------------------
    // Init helpers
    // -------------------------------------------------------------------------

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this._updateSize();
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);
        this.scene.fog = new THREE.Fog(0x1a1a1a, 30, 80);

        const grid = new THREE.GridHelper(20, 20, 0x333344, 0x222233);
        grid.name = '__grid__';
        this.scene.add(grid);
    }

    _initCamera() {
        const w = this.canvas.clientWidth  || 800;
        const h = this.canvas.clientHeight || 600;
        this.camera = new THREE.PerspectiveCamera(55, w / h, 0.01, 200);
        this.camera.position.set(6, 5, 8);

        // Orbit state
        this._target    = new THREE.Vector3(0, 0, 0);
        this._spherical = new THREE.Spherical();
        this._spherical.setFromVector3(
            this.camera.position.clone().sub(this._target)
        );
        this.camera.lookAt(this._target);
    }

    _initLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.45);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffffff, 0.9);
        sun.position.set(8, 12, 6);
        sun.castShadow = true;
        sun.shadow.mapSize.width  = 1024;
        sun.shadow.mapSize.height = 1024;
        this.scene.add(sun);

        const fill = new THREE.DirectionalLight(0x8899ff, 0.25);
        fill.position.set(-6, 4, -4);
        this.scene.add(fill);
    }

    _initControls() {
        this._mouse         = { x: 0, y: 0 };
        this._middleDown    = false;
        this._shiftDown     = false;
        this._lastMouse     = { x: 0, y: 0 };

        const c = this.canvas;

        c.addEventListener('mousedown',  (e) => this._onMouseDown(e));
        c.addEventListener('mouseup',    (e) => this._onMouseUp(e));
        c.addEventListener('mousemove',  (e) => this._onMouseMove(e));
        c.addEventListener('wheel',      (e) => this._onWheel(e), { passive: false });
        c.addEventListener('contextmenu',(e) => e.preventDefault());
        c.addEventListener('click',      (e) => this._onCanvasClick(e));

        window.addEventListener('keydown', (e) => this._onKeyDown(e));
        window.addEventListener('keyup',   (e) => { if (e.key === 'Shift') this._shiftDown = false; });
        window.addEventListener('resize',  () => this.resize());
    }

    // -------------------------------------------------------------------------
    // Mouse / keyboard control
    // -------------------------------------------------------------------------

    _onMouseDown(e) {
        if (e.button === 1) {
            e.preventDefault();
            this._middleDown = true;
            this._lastMouse  = { x: e.clientX, y: e.clientY };
        }
        if (e.key === 'Shift' || e.shiftKey) this._shiftDown = true;
    }

    _onMouseUp(e) {
        if (e.button === 1) this._middleDown = false;
    }

    _onMouseMove(e) {
        this._shiftDown = e.shiftKey;

        if (!this._middleDown) return;

        const dx = e.clientX - this._lastMouse.x;
        const dy = e.clientY - this._lastMouse.y;
        this._lastMouse = { x: e.clientX, y: e.clientY };

        if (this._shiftDown) {
            this._pan(dx, dy);
        } else {
            this._orbit(dx, dy);
        }
    }

    _orbit(dx, dy) {
        const speed = 0.005;
        this._spherical.theta -= dx * speed;
        this._spherical.phi   -= dy * speed;
        // Clamp vertical
        this._spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this._spherical.phi));
        this._updateCameraFromSpherical();
    }

    _pan(dx, dy) {
        const speed = 0.01 * (this._spherical.radius * 0.15);

        const right = new THREE.Vector3();
        const up    = new THREE.Vector3();
        this.camera.getWorldDirection(right);   // actually fwd — reuse
        right.crossVectors(right, this.camera.up).normalize();
        up.copy(this.camera.up);

        this._target.addScaledVector(right, -dx * speed);
        this._target.addScaledVector(up,     dy * speed);
        this._updateCameraFromSpherical();
    }

    _onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.12 : 0.89;
        this._spherical.radius = Math.max(0.5, Math.min(100, this._spherical.radius * factor));
        this._updateCameraFromSpherical();
    }

    _updateCameraFromSpherical() {
        const pos = new THREE.Vector3();
        pos.setFromSpherical(this._spherical);
        pos.add(this._target);
        this.camera.position.copy(pos);
        this.camera.lookAt(this._target);
    }

    _onKeyDown(e) {
        if (e.key === 'Shift') { this._shiftDown = true; return; }

        // Blender numpad preset views
        switch (e.key) {
            case '1': this._setView(0,  1,  8);  break;  // front
            case '3': this._setView(8,  1,  0);  break;  // right side
            case '7': this._setView(0,  8,  0.01); break; // top
            case '0': this._setView(6,  5,  8);  break;  // perspective reset
        }
    }

    _setView(x, y, z) {
        this._target.set(0, 0, 0);
        const dir = new THREE.Vector3(x, y, z);
        this._spherical.setFromVector3(dir);
        this._updateCameraFromSpherical();
    }

    // -------------------------------------------------------------------------
    // Click picking
    // -------------------------------------------------------------------------

    _onCanvasClick(e) {
        // Ignore clicks that moved the camera (middle button drag)
        if (!this._clickCallback) return;

        const rect   = this.canvas.getBoundingClientRect();
        const ndcX   = ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
        const ndcY   = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);

        const meshes = Object.values(this.objects);
        const hits   = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
            const mesh = hits[0].object;
            const id   = Object.keys(this.objects).find(k => this.objects[k] === mesh);
            if (id) this._clickCallback(id);
        }
    }

    onObjectClick(callback) {
        this._clickCallback = callback;
    }

    // -------------------------------------------------------------------------
    // Scene loading
    // -------------------------------------------------------------------------

    loadScene(sceneJson) {
        // Remove old objects (keep lights and grid)
        Object.values(this.objects).forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        this.objects   = {};
        this.selectedId = null;

        (sceneJson.objects || []).forEach(obj => {
            const mesh = this._buildMesh(obj);
            if (mesh) {
                mesh.userData.sceneId = obj.id;
                mesh.receiveShadow = true;
                mesh.castShadow    = true;
                this.scene.add(mesh);
                this.objects[obj.id] = mesh;
            }
        });
    }

    _buildMesh(obj) {
        let geometry;
        switch (obj.type) {
            case 'cube':
                geometry = new THREE.BoxGeometry(1, 1, 1);
                break;
            case 'sphere':
                geometry = new THREE.SphereGeometry(0.5, 32, 16);
                break;
            case 'plane':
                geometry = new THREE.PlaneGeometry(1, 1);
                break;
            case 'cylinder':
                geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
                break;
            default:
                console.warn('Unknown object type:', obj.type);
                return null;
        }

        const material = new THREE.MeshStandardMaterial({
            color:     new THREE.Color(obj.color || '#888888'),
            roughness: 0.55,
            metalness: 0.15,
        });

        const mesh = new THREE.Mesh(geometry, material);

        // Position
        const p = obj.position || [0, 0, 0];
        mesh.position.set(p[0], p[1], p[2]);

        // Rotation (Euler XYZ, radians)
        const r = obj.rotation || [0, 0, 0];
        mesh.rotation.set(r[0], r[1], r[2]);

        // Flat plane: rotate so it lies on XZ plane
        if (obj.type === 'plane') {
            mesh.rotation.x = -Math.PI / 2;
        }

        // Scale
        const s = obj.scale || [1, 1, 1];
        mesh.scale.set(s[0], s[1], s[2]);

        return mesh;
    }

    // -------------------------------------------------------------------------
    // Selection highlight
    // -------------------------------------------------------------------------

    selectObject(objectId) {
        // Clear previous highlight
        Object.entries(this.objects).forEach(([id, mesh]) => {
            mesh.material.emissive.setHex(0x000000);
            mesh.material.emissiveIntensity = 0;
        });

        this.selectedId = objectId;

        if (objectId && this.objects[objectId]) {
            const mesh = this.objects[objectId];
            mesh.material.emissive.setHex(0x4a9eff);
            mesh.material.emissiveIntensity = 0.25;
        }
    }

    // -------------------------------------------------------------------------
    // Data binding
    // -------------------------------------------------------------------------

    setBinding(objectId, property, value) {
        const mesh = this.objects[objectId];
        if (!mesh) return;

        const parts = property.split('.');   // e.g. ['rotation', 'y']
        if (parts.length !== 2) return;

        const [group, axis] = parts;
        if (!['x', 'y', 'z'].includes(axis)) return;

        switch (group) {
            case 'rotation':
                mesh.rotation[axis] = value;
                break;
            case 'position':
                mesh.position[axis] = value;
                break;
            case 'scale':
                mesh.scale[axis] = Math.max(0.001, value);
                break;
        }
    }

    // -------------------------------------------------------------------------
    // Resize & render loop
    // -------------------------------------------------------------------------

    resize() {
        this._updateSize();
    }

    _updateSize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (w === 0 || h === 0) return;

        this.renderer.setSize(w, h, false);

        if (this.camera) {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.renderer.render(this.scene, this.camera);
    }
}
