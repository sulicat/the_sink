/* viewport.js — Three.js scene with Blender-style controls */

class Viewport {
    constructor(canvas) {
        this.canvas    = canvas;
        this.objects   = {};   // id -> THREE.Object3D (Mesh or Group)
        this.selectedId = null;
        this._clickCallback = null;

        this._initRenderer();
        this._initScene();
        this._initCamera();
        this._initLights();
        this._initControls();
        this.animate();
    }

    // ---- Init ---------------------------------------------------------------

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputEncoding = THREE.sRGBEncoding;  // correct colour for GLTF
        this._updateSize();
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);
        // No fog — it clips skyboxes
        const grid = new THREE.GridHelper(20, 20, 0x333344, 0x222233);
        grid.name = '__grid__';
        this.scene.add(grid);
    }

    _initCamera() {
        const w = this.canvas.clientWidth  || 800;
        const h = this.canvas.clientHeight || 600;
        this.camera = new THREE.PerspectiveCamera(55, w / h, 0.01, 1000);
        this.camera.position.set(6, 5, 8);
        this._target    = new THREE.Vector3(0, 0, 0);
        this._spherical = new THREE.Spherical();
        this._spherical.setFromVector3(this.camera.position.clone().sub(this._target));
        this.camera.lookAt(this._target);
    }

    _initLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
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
        this._middleDown = false;
        this._shiftDown  = false;
        this._lastMouse  = { x: 0, y: 0 };
        const c = this.canvas;
        c.addEventListener('mousedown',   e => this._onMouseDown(e));
        c.addEventListener('mouseup',     e => this._onMouseUp(e));
        c.addEventListener('mousemove',   e => this._onMouseMove(e));
        c.addEventListener('wheel',       e => this._onWheel(e), { passive: false });
        c.addEventListener('contextmenu', e => e.preventDefault());
        c.addEventListener('click',       e => this._onCanvasClick(e));
        window.addEventListener('keydown', e => this._onKeyDown(e));
        window.addEventListener('keyup',   e => { if (e.key === 'Shift') this._shiftDown = false; });
        window.addEventListener('resize',  () => this.resize());
    }

    // ---- Mouse / keyboard ---------------------------------------------------

    _onMouseDown(e) {
        if (e.button === 1) {
            e.preventDefault();
            this._middleDown = true;
            this._lastMouse  = { x: e.clientX, y: e.clientY };
        }
        if (e.shiftKey) this._shiftDown = true;
    }
    _onMouseUp(e)   { if (e.button === 1) this._middleDown = false; }
    _onMouseMove(e) {
        this._shiftDown = e.shiftKey;
        if (!this._middleDown) return;
        const dx = e.clientX - this._lastMouse.x;
        const dy = e.clientY - this._lastMouse.y;
        this._lastMouse = { x: e.clientX, y: e.clientY };
        this._shiftDown ? this._pan(dx, dy) : this._orbit(dx, dy);
    }

    _orbit(dx, dy) {
        this._spherical.theta -= dx * 0.005;
        this._spherical.phi   -= dy * 0.005;
        this._spherical.phi    = Math.max(0.05, Math.min(Math.PI - 0.05, this._spherical.phi));
        this._updateCameraFromSpherical();
    }
    _pan(dx, dy) {
        const speed = 0.01 * (this._spherical.radius * 0.15);
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(right);
        right.crossVectors(right, this.camera.up).normalize();
        this._target.addScaledVector(right, -dx * speed);
        this._target.addScaledVector(this.camera.up, dy * speed);
        this._updateCameraFromSpherical();
    }
    _onWheel(e) {
        e.preventDefault();
        const f = e.deltaY > 0 ? 1.12 : 0.89;
        this._spherical.radius = Math.max(0.5, Math.min(500, this._spherical.radius * f));
        this._updateCameraFromSpherical();
    }
    _updateCameraFromSpherical() {
        const pos = new THREE.Vector3().setFromSpherical(this._spherical).add(this._target);
        this.camera.position.copy(pos);
        this.camera.lookAt(this._target);
    }
    _onKeyDown(e) {
        if (e.key === 'Shift') this._shiftDown = true;
    }

    // ---- Click picking ------------------------------------------------------

    _onCanvasClick(e) {
        if (!this._clickCallback) return;
        const rect = this.canvas.getBoundingClientRect();
        const ndcX =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        const ndcY = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);

        // Collect all pickable meshes and remember which root object they belong to
        const meshes  = [];
        const meshMap = new Map(); // mesh -> rootId
        Object.entries(this.objects).forEach(([id, obj]) => {
            obj.traverse(child => {
                if (child.isMesh) { meshes.push(child); meshMap.set(child, id); }
            });
        });

        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
            const id = meshMap.get(hits[0].object);
            if (id) this._clickCallback(id);
        }
    }

    onObjectClick(cb) { this._clickCallback = cb; }

    // ---- Scene loading ------------------------------------------------------

    loadScene(sceneJson) {
        // Dispose and remove existing objects
        Object.values(this.objects).forEach(obj => {
            this.scene.remove(obj);
            obj.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => {
                        Object.values(m).forEach(v => { if (v && v.isTexture) v.dispose(); });
                        m.dispose();
                    });
                }
            });
        });
        this.objects    = {};
        this.selectedId = null;

        // Grid — hide when scene has its own ground plane / skybox
        const grid = this.scene.getObjectByName('__grid__');
        if (grid) grid.visible = !sceneJson.skybox;

        // Skybox
        if (sceneJson.skybox) {
            this._loadSkybox(sceneJson.skybox);
        } else {
            this.scene.background = new THREE.Color(0x1a1a1a);
        }

        // Objects
        (sceneJson.objects || []).forEach(obj => {
            if (obj.type === 'gltf') {
                this._loadGLTF(obj);
            } else {
                const mesh = this._buildMesh(obj);
                if (mesh) {
                    mesh.receiveShadow = true;
                    mesh.castShadow    = true;
                    this.scene.add(mesh);
                    this.objects[obj.id] = mesh;
                }
            }
        });
    }

    _loadSkybox(url) {
        new THREE.TextureLoader().load(url, texture => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.encoding = THREE.sRGBEncoding;
            this.scene.background = texture;
        });
    }

    _loadGLTF(obj) {
        if (typeof THREE.GLTFLoader === 'undefined') {
            console.warn('GLTFLoader not available');
            return;
        }
        const loader = new THREE.GLTFLoader();
        loader.load(obj.url, gltf => {
            const model = gltf.scene;
            const p = obj.position || [0, 0, 0];
            const r = obj.rotation || [0, 0, 0];
            const s = obj.scale    || [1, 1, 1];

            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow    = true;
                    child.receiveShadow = true;
                }
            });

            // Apply scale first so the bounding box is in world units
            model.scale.set(s[0], s[1], s[2]);

            // Find the bounding box center in the model's parent space
            const box    = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());

            // Shift the model so its bbox center sits at the pivot's origin.
            // This makes all rotation/scale bindings act on the visual centre.
            model.position.sub(center);

            // Place the pivot so the model appears at exactly the JSON position.
            // (pivot world position = intended position + the centre offset we removed)
            const pivot = new THREE.Group();
            pivot.position.set(p[0] + center.x, p[1] + center.y, p[2] + center.z);
            pivot.rotation.set(
                THREE.MathUtils.degToRad(r[0]),
                THREE.MathUtils.degToRad(r[1]),
                THREE.MathUtils.degToRad(r[2])
            );

            pivot.add(model);
            this.scene.add(pivot);
            this.objects[obj.id] = pivot;
        }, undefined, err => {
            console.error('GLTF load error for', obj.url, err);
        });
    }

    _buildMesh(obj) {
        let geometry;
        switch (obj.type) {
            case 'cube':     geometry = new THREE.BoxGeometry(1, 1, 1);          break;
            case 'sphere':   geometry = new THREE.SphereGeometry(0.5, 32, 16);  break;
            case 'plane':    geometry = new THREE.PlaneGeometry(1, 1);           break;
            case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
            default: console.warn('Unknown type:', obj.type); return null;
        }

        const matProps = {
            color:     new THREE.Color(obj.color || '#888888'),
            roughness: 0.55,
            metalness: 0.15,
        };

        if (obj.texture) {
            const tex = new THREE.TextureLoader().load(obj.texture);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.encoding = THREE.sRGBEncoding;
            matProps.map = tex;
        }

        const material = new THREE.MeshStandardMaterial(matProps);
        const mesh     = new THREE.Mesh(geometry, material);

        const p = obj.position || [0, 0, 0];
        mesh.position.set(p[0], p[1], p[2]);

        const r = obj.rotation || [0, 0, 0];
        if (obj.type === 'plane') {
            mesh.rotation.set(-Math.PI / 2, 0, 0);
        } else {
            mesh.rotation.set(
                THREE.MathUtils.degToRad(r[0]),
                THREE.MathUtils.degToRad(r[1]),
                THREE.MathUtils.degToRad(r[2])
            );
        }

        const s = obj.scale || [1, 1, 1];
        mesh.scale.set(s[0], s[1], s[2]);

        return mesh;
    }

    // ---- Selection ----------------------------------------------------------

    selectObject(objectId) {
        Object.values(this.objects).forEach(obj => {
            obj.traverse(child => {
                if (!child.isMesh) return;
                if (child.material.emissive) child.material.emissive.setHex(0x000000);
                child.material.emissiveIntensity = 0;
            });
        });
        this.selectedId = objectId;
        if (objectId && this.objects[objectId]) {
            this.objects[objectId].traverse(child => {
                if (!child.isMesh) return;
                if (child.material.emissive) child.material.emissive.setHex(0x4a9eff);
                child.material.emissiveIntensity = 0.25;
            });
        }
    }

    // ---- Data binding -------------------------------------------------------

    setBinding(objectId, property, value) {
        const obj = this.objects[objectId];
        if (!obj) return;
        const parts = property.split('.');
        if (parts.length !== 2) return;
        const [group, axis] = parts;
        if (!['x', 'y', 'z'].includes(axis)) return;
        switch (group) {
            case 'rotation': obj.rotation[axis] = value; break;
            case 'position': obj.position[axis] = value; break;
            case 'scale':    obj.scale[axis]    = Math.max(0.001, value); break;
        }
    }

    // ---- Resize & render loop -----------------------------------------------

    resize() { this._updateSize(); }

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
