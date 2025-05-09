import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import createVehicle from "./car";

let currentNightAlpha = 0;

function isInsideAnyBuilding(x, z, buildingTops) {
    const margin = 0; // 
    if (!buildingTops) return false;
    for (let i = 0; i < buildingTops.length; i++) {
        const bt = buildingTops[i];
        const dx = x - bt.x;
        const dz = z - bt.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < bt.radius + margin) {
            return true;
        }
    }
    return false;
}

const volumetric_vertex_shader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const volumetric_fragment_shader = `
  uniform float intensity;
  varying vec2 vUv;
  void main() {
    float alpha = smoothstep(0.0, 0.4, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
    gl_FragColor = vec4(vec3(1.0, 0.95, 0.8) * intensity, alpha * intensity);
  }
`;
// class for scene managment

class World {
    constructor() {
        this.areas = {};
        this.firstArea = null;
    }

    addArea(area) {
        this.areas[area.name] = area;
        if (!this.firstArea) {
            this.firstArea = area;
        }
    }

    createArea(name) {
        this.addArea(new WorldArea(name, this));
    }

    getFirst() {
        return this.firstArea;
    }

    getAreaByName(name) {
        if (name in this.areas) return this.areas[name];
        else {
            console.log("thats not quite right");
            return -1;
        }
    }
}

class WorldArea extends THREE.Scene {
    constructor(name) {
        super();
        this.name = name;
    }
}


// World Layout Elelments
// Building Functions
function randomColor(min = 0.6, max = 1.0) {
    const r = min + Math.random() * (max - min);
    const g = min + Math.random() * (max - min);
    const b = min + Math.random() * (max - min);
    return new THREE.Color(r, g, b);
}

function getDayNightAlpha(phase) {
    let dayAlpha = 0;
    let nightAlpha = 0;

    if (phase < 0.25) {
        const t = phase / 0.25;
        dayAlpha = t;
        nightAlpha = 1 - t;
    } else if (phase < 0.5) {
        dayAlpha = 1;
        nightAlpha = 0;
    } else if (phase < 0.75) {
        const t = (phase - 0.5) / 0.25;
        dayAlpha = 1 - t;
        nightAlpha = t;
    } else {
        dayAlpha = 0;
        nightAlpha = 1;
    }

    return { dayAlpha, nightAlpha };
}



const neonColors = [0xff00ff, 0x00ffff, 0xff3366, 0x33ff33, 0xff6600, 0x0066ff,
    0xffff00, 0xff9900, 0x9900ff, 0x00ff99, 0x6600ff, 0xff0066];
const neon_colors = neonColors;

const flickering_lights = [];
const disco_balls = [];
const mirror_materials_pool = [];
const decorative_cubes = [];

// Physical Interaction
const floor = [];
const walls = [];

class CyberpunkSceneBuilder {
    // Replace the building_materials section in the CyberpunkSceneBuilder constructor with:

    constructor(scene) {
        this.scene = scene;
        this.elapsed_time = 0;
        this.buildingTops = [];
        this.smokeParticles = [];
        this.vehicles = [];
        this.clock = new THREE.Clock();

        // Load brick texture
        const textureLoader = new THREE.TextureLoader();
        const brickTexture = textureLoader.load('brick.jpg');
        brickTexture.repeat.set(100, 100);
        brickTexture.wrapS = THREE.RepeatWrapping;
        brickTexture.wrapT = THREE.RepeatWrapping;

        // Building materials with textures
        this.building_materials = [];
        for (let i = 0; i < 3; i++) {
            const material = new THREE.MeshStandardMaterial({
                map: brickTexture,
            });

            this.building_materials.push(material);
        }

        const glow_edge_material = new THREE.MeshStandardMaterial({
            map: brickTexture,
            color: 0x222222,
            emissive: 0x666688,
            emissiveIntensity: 1.0,
            metalness: 0.7,
            roughness: 0.5,
        });
        glow_edge_material.map.repeat.set(0.8, 0.8);
        this.building_materials.push(glow_edge_material);

        // Door materials
        this.door_material = new THREE.MeshPhongMaterial({
            color: 0x333333,
            specular: 0x666666,
            shininess: 50,
        });

        this.door_frame_material = new THREE.MeshPhongMaterial({
            color: 0x555555,
            specular: 0x999999,
            shininess: 80,
        });

        this.advertisement_banners = [];
        this.init_shared_shaders();
    }

    init_shared_shaders() {
        this.ad_uniforms = {
            adTexture: { value: null },
            imageTexture: { value: null },
            time: { value: 0 },
        };

        this.ad_material = new THREE.ShaderMaterial({
            uniforms: this.ad_uniforms,
            vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
            fragmentShader: `
            uniform sampler2D adTexture;
            uniform sampler2D imageTexture;
            uniform float time;
            varying vec2 vUv;
            void main() {
                if (vUv.y > 0.7) {
                    vec2 scroll_uv = vUv;
                    scroll_uv.x = fract(scroll_uv.x - time * 0.1);
                    vec2 text_uv = vec2(scroll_uv.x, (vUv.y - 0.7) / 0.3);
                    vec4 tex_color = texture2D(adTexture, text_uv);
                    float glow = 0.7 + 0.3 * sin(time * 2.0);
                    tex_color.rgb *= glow;
                    gl_FragColor = tex_color;
                } else {
                    vec2 img_uv = vUv;
                    img_uv.x = fract(img_uv.x - time * 0.05);
                    vec2 mapped_img_uv = vec2(img_uv.x, img_uv.y / 0.7);
                    vec4 img_color = texture2D(imageTexture, mapped_img_uv);
                    gl_FragColor = img_color;
                }
            }
        `,
            transparent: true,
            side: THREE.DoubleSide,
        });

        this.create_default_ad_textures();
    }

    create_default_ad_textures() {
        const text_canvas = document.createElement("canvas");
        text_canvas.width = 512;
        text_canvas.height = 128;
        const text_ctx = text_canvas.getContext("2d");

        const text_gradient = text_ctx.createLinearGradient(0, 0, text_canvas.width, 0);
        text_gradient.addColorStop(0, "#ff00ff");
        text_gradient.addColorStop(0.33, "#00ffff");
        text_gradient.addColorStop(0.66, "#ffff00");
        text_gradient.addColorStop(1, "#ff00ff");

        text_ctx.fillStyle = text_gradient;
        text_ctx.fillRect(0, 0, text_canvas.width, text_canvas.height);
        text_ctx.font = "bold 70px Neo Tokyo";
        text_ctx.textAlign = "center";
        text_ctx.textBaseline = "middle";
        text_ctx.fillStyle = "white";
        text_ctx.fillText("CYBER CITY ", text_canvas.width / 2, text_canvas.height / 2);

        const ad_texture = new THREE.CanvasTexture(text_canvas);
        ad_texture.wrapS = THREE.RepeatWrapping;
        ad_texture.wrapT = THREE.RepeatWrapping;
        this.ad_uniforms.adTexture.value = ad_texture;

        const fallback_canvas = document.createElement("canvas");
        fallback_canvas.width = 512;
        fallback_canvas.height = 384;
        const fallback_ctx = fallback_canvas.getContext("2d");
        fallback_ctx.fillStyle = "#550055";
        fallback_ctx.fillRect(0, 0, fallback_canvas.width, fallback_canvas.height);

        const fallback_texture = new THREE.CanvasTexture(fallback_canvas);
        fallback_texture.wrapS = THREE.RepeatWrapping;
        fallback_texture.wrapT = THREE.ClampToEdgeWrapping;
        this.ad_uniforms.imageTexture.value = fallback_texture;

        // Optionally load an external texture
        // const texture_loader = new THREE.TextureLoader();
        // texture_loader.load("./assets/adImage.png", ...);
    }

    createCity() {
        this.createGround();
        this.createBuildings();
        this.createLights();
        this.createSmoke();
    }

    createGround() {
        const groundGeo = new THREE.PlaneGeometry(500, 500, 50, 50);
        const textureLoader = new THREE.TextureLoader();
        const concreteTexture = textureLoader.load('concrete.jpg');
        concreteTexture.wrapS = THREE.RepeatWrapping;
        concreteTexture.wrapT = THREE.RepeatWrapping;
        concreteTexture.repeat.set(100, 100);
        const groundMat = new THREE.MeshStandardMaterial({
            map: concreteTexture,
        });
        groundMat.normalMap = textureLoader.load('concretenormal.jpg');
        groundMat.normalScale.set(.1, .1);
        groundMat.roughnessMap = textureLoader.load('concreterough.jpg');
        groundMat.roughnessMap.wrapS = THREE.RepeatWrapping;
        groundMat.roughnessMap.wrapT = THREE.RepeatWrapping;
        groundMat.roughnessMap.repeat.set(100, 100);

        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        const puddleCount = 30;
        for (let i = 0; i < puddleCount; i++) {
            const shape = new THREE.Shape();
            const pointCount = 8 + Math.floor(Math.random() * 5);
            const angleStep = (Math.PI * 2) / pointCount;
            const baseRadius = 2 + Math.random() * 9;

            shape.moveTo(baseRadius, 0);
            for (let p = 1; p < pointCount; p++) {
                const angle = p * angleStep;
                const r = baseRadius + (Math.random() - 0.5) * 1.5;
                const x = Math.cos(angle) * r;
                const y = Math.sin(angle) * r;
                shape.lineTo(x, y);
            }
            shape.closePath();

            const puddleGeo = new THREE.ShapeGeometry(shape, 32);
            const puddleMat = new THREE.MeshStandardMaterial({
                color: 0x111111,
                metalness: 0.1,
                roughness: 0.2,
                transparent: true,
                opacity: 0.5,
            });

            const puddle = new THREE.Mesh(puddleGeo, puddleMat);
            puddle.rotation.x = -Math.PI / 2;
            puddle.position.y = 0.01;

            const range = 200;
            puddle.position.x = (Math.random() - 0.5) * range;
            puddle.position.z = (Math.random() - 0.5) * range;

            this.scene.add(puddle);
        }
        floor.push(ground);
    }

    createBuildings() {
        const gridSize = 4;
        const spacing = 20;
        for (let i = -gridSize; i <= gridSize; i++) {
            for (let j = -gridSize; j <= gridSize; j++) {
                if (Math.random() > 0.7) {
                    const x = i * spacing + (Math.random() - 0.5) * spacing * 0.5;
                    const z = j * spacing + (Math.random() - 0.5) * spacing * 0.5;
                    this.createBuilding(x, z);
                }
            }
        }
    }

    createBuilding(x, z) {
        const width = 5 + Math.random() * 10;
        const height = 20 + Math.pow(Math.random(), 2) * 70;
        const depth = 5 + Math.random() * 10;

        const building = new THREE.Group();

        // Floor height and door parameters
        const floor_height = 3;
        const door_height = Math.min(floor_height * 1.2, 4);
        const door_width = Math.min(width * 0.4, 3);

        // Advertisement banner parameters
        const can_have_ad = height > 20 && Math.random() > 0.3;
        const actually_has_ad = can_have_ad && Math.random() > 0.5;
        const ad_banner_height = actually_has_ad ? (height / 3) : 0;
        const ad_banner_position = height / 2 - ad_banner_height / 2;

        // Select building material
        const building_material_index = Math.floor(Math.random() * this.building_materials.length);
        const buildingMat = this.building_materials[0].clone();

        if (buildingMat.map) {
            const textureScale = Math.max(width, depth) / 4;
            buildingMat.map.repeat.set(textureScale, height / 8);
        }

        // Main building
        const mainGeo = new THREE.BoxGeometry(width, height, depth);
        const mainMesh = new THREE.Mesh(mainGeo, buildingMat);
        building.add(mainMesh);

        // Building edges
        const edgesGeometry = new THREE.EdgesGeometry(mainGeo);
        const edgesLine = new THREE.LineSegments(
            edgesGeometry,
            new THREE.LineBasicMaterial({ color: 0x00ffff })
        );
        building.add(edgesLine);

        // Rest of the method remains the same...

        // Create door and door frame
        this.create_building_door(
            building,
            width,
            height,
            depth,
            door_width,
            door_height
        );

        // Create windows
        this.create_building_windows(
            building,
            width,
            height,
            depth,
            door_height,
            ad_banner_position,
            ad_banner_height
        );

        // Create advertisement banner if applicable
        if (actually_has_ad) {
            this.create_advertisement_banner(
                building,
                width,
                depth,
                ad_banner_position,
                ad_banner_height
            );
        }

        // Create roof details if no ad banner
        if (!actually_has_ad) {
            this.create_roof_details(building, width, height, depth);
        }

        building.position.set(x, height / 2, z);

        // Store building top for smoke emitters
        const buildingTop = {
            x: x,
            y: height + 1, // a meter above building
            z: z,
            radius: Math.max(width, depth) / 2 + 2  //
        };
        this.buildingTops.push(buildingTop);

        if (!this.buildingTops) this.buildingTops = [];
        this.buildingTops.push(buildingTop);

        building.traverse((obj) => {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
                walls.push(obj);
            }
        });

        this.scene.add(building);
    }

    create_building_door(building_group, total_width, total_height, total_depth, door_width, door_height) {
        const door_geometry = new THREE.PlaneGeometry(door_width, door_height);
        const front_door = new THREE.Mesh(door_geometry, this.door_material);
        front_door.position.set(0, -total_height / 2 + door_height / 2, total_depth / 2 + 0.05);
        building_group.add(front_door);

        this.create_door_frame(building_group, total_width, total_height, total_depth, door_width, door_height);
        this.create_door_neon(building_group, total_width, total_height, total_depth, door_width, door_height);
    }

    create_door_frame(building_group, total_width, total_height, total_depth, door_width, door_height) {
        const frame_thickness = 0.2;
        const frame_width = 0.3;
        const door_z = total_depth / 2 + 0.1;

        const top_frame = new THREE.Mesh(
            new THREE.BoxGeometry(door_width * 1.1, frame_width, frame_thickness),
            this.door_frame_material
        );

        top_frame.position.set(0, -total_height / 2 + door_height, door_z);
        building_group.add(top_frame);

        const left_frame = new THREE.Mesh(
            new THREE.BoxGeometry(frame_width, door_height, frame_thickness),
            this.door_frame_material
        );
        left_frame.position.set(-door_width * 0.55, -total_height / 2 + door_height / 2, door_z);
        building_group.add(left_frame);

        const right_frame = new THREE.Mesh(
            new THREE.BoxGeometry(frame_width, door_height, frame_thickness),
            this.door_frame_material
        );
        right_frame.position.set(door_width * 0.55, -total_height / 2 + door_height / 2, door_z);
        building_group.add(right_frame);
    }

    create_door_neon(building_group, total_width, total_height, total_depth, door_width, door_height) {
        const neon_color = 0xff00ff;
        const neon_material = new THREE.LineBasicMaterial({
            color: neon_color,
            depthTest: true,
        });

        const door_z = total_depth / 2 + 0.22;
        const top_neon_geometry = new THREE.BufferGeometry();
        top_neon_geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
                [
                    -door_width * 0.55,
                    -total_height / 2 + door_height,
                    door_z,
                    door_width * 0.55,
                    -total_height / 2 + door_height,
                    door_z,
                ],
                3
            )
        );
        const top_neon = new THREE.Line(top_neon_geometry, neon_material);
        building_group.add(top_neon);

        const left_neon_geometry = new THREE.BufferGeometry();
        left_neon_geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
                [
                    -door_width * 0.55,
                    -total_height / 2,
                    door_z,
                    -door_width * 0.55,
                    -total_height / 2 + door_height,
                    door_z,
                ],
                3
            )
        );
        const left_neon = new THREE.Line(left_neon_geometry, neon_material);
        building_group.add(left_neon);

        const right_neon_geometry = new THREE.BufferGeometry();
        right_neon_geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
                [
                    door_width * 0.55,
                    -total_height / 2,
                    door_z,
                    door_width * 0.55,
                    -total_height / 2 + door_height,
                    door_z,
                ],
                3
            )
        );
        const right_neon = new THREE.Line(right_neon_geometry, neon_material);
        building_group.add(right_neon);
    }

    create_building_windows(building_group, total_width, total_height, total_depth, door_zone, ad_banner_position, ad_banner_zone) {
        const window_spacing = 2;
        const window_start_y = -total_height / 2 + door_zone + 1;
        const window_end_y = ad_banner_zone > 0 ? (total_height / 2 - ad_banner_zone) : (total_height / 2 - 1);

        const window_size = 1;
        const inner_window_size = window_size * 0.8;
        const window_base_geometry = new THREE.BoxGeometry(window_size, window_size, 0.1);
        const inner_window_geometry = new THREE.PlaneGeometry(inner_window_size, inner_window_size);

        const window_frame_material = new THREE.MeshStandardMaterial({
            color: 0x333333,
            metalness: 0.8,
            roughness: 0.2
        });

        const window_materials = [];
        for (let i = 0; i < neonColors.length; i++) {
            const w_color = neonColors[i];
            const w_material = new THREE.MeshPhongMaterial({
                color: w_color,
                emissive: w_color,
                emissiveIntensity: 2.5,
                transparent: true,
                opacity: 0.95,
            });
            window_materials.push(w_material);
        }

        const facing_directions = [
            { axis: "z", offset: total_depth / 2 + 0.05, rotation: 0 },
            { axis: "x", offset: total_width / 2 + 0.05, rotation: Math.PI / 2 },
            { axis: "z", offset: -total_depth / 2 - 0.05, rotation: Math.PI },
            { axis: "x", offset: -total_width / 2 - 0.05, rotation: -Math.PI / 2 },
        ];

        const window_positions = [];
        facing_directions.forEach((dir) => {
            const face_width = (dir.axis === "z") ? total_width : total_depth;
            for (let local_y = window_start_y; local_y < window_end_y; local_y += window_spacing) {
                for (let offset = -face_width / 2 + 1; offset < face_width / 2 - 1; offset += window_spacing) {
                    if (Math.random() > 0.6) {
                        const position_vec = new THREE.Vector3();
                        if (dir.axis === "z") {
                            position_vec.set(offset, local_y, dir.offset);
                        } else {
                            position_vec.set(dir.offset, local_y, offset);
                        }
                        const mat_idx = Math.floor(Math.random() * window_materials.length);
                        window_positions.push({
                            position: position_vec,
                            rotation: dir.rotation,
                            material_index: mat_idx
                        });
                    }
                }
            }
        });

        const max_windows = Math.min(window_positions.length, 300);
        const selected_windows = window_positions.slice(0, max_windows);

        let frame_count = 0;
        const max_frames = 300;

        selected_windows.forEach((win_data) => {
            if (frame_count < max_frames) {
                const frame_mesh = new THREE.Mesh(window_base_geometry, window_frame_material);
                frame_mesh.position.copy(win_data.position);
                frame_mesh.rotation.y = win_data.rotation;
                building_group.add(frame_mesh);
                frame_count++;
            }

            const mat_index = win_data.material_index;
            const inner_window = new THREE.Mesh(inner_window_geometry, window_materials[mat_index]);
            const new_pos = win_data.position.clone();

            if (win_data.rotation === 0) new_pos.z += 0.06;
            else if (win_data.rotation === Math.PI) new_pos.z -= 0.06;
            else if (win_data.rotation === Math.PI / 2) new_pos.x += 0.06;
            else if (win_data.rotation === -Math.PI / 2) new_pos.x -= 0.06;

            inner_window.position.copy(new_pos);
            inner_window.rotation.y = win_data.rotation;
            building_group.add(inner_window);
        });
    }

    create_advertisement_banner(building_group, total_width, total_depth, position_val, banner_height) {
        const create_ad_face = (w, h, x_pos, z_pos, rotation_val) => {
            const ad_geometry = new THREE.PlaneGeometry(w, h);
            const ad_mesh = new THREE.Mesh(ad_geometry, this.ad_material);
            ad_mesh.position.set(x_pos, position_val, z_pos);
            ad_mesh.rotation.y = rotation_val;
            building_group.add(ad_mesh);

            return ad_mesh;
        };

        create_ad_face(total_width * 0.9, banner_height, 0, total_depth / 2 + 0.1, 0);
        create_ad_face(total_depth * 0.9, banner_height, total_width / 2 + 0.1, 0, Math.PI / 2);
        create_ad_face(total_width * 0.9, banner_height, 0, -total_depth / 2 - 0.1, Math.PI);
        create_ad_face(total_depth * 0.9, banner_height, -total_width / 2 - 0.1, 0, -Math.PI / 2);
    }

    create_roof_details(building_group, total_width, total_height, total_depth) {
        if (total_height < 20 || Math.random() > 0.7) return;
        const antenna_height = 2 + Math.random() * 3;
        const antenna_geometry = new THREE.CylinderGeometry(0.1, 0.1, antenna_height, 4);
        const antenna_material = new THREE.MeshPhongMaterial({ color: 0x888888 });
        const antenna_mesh = new THREE.Mesh(antenna_geometry, antenna_material);
        antenna_mesh.position.set(0, total_height / 2 + antenna_height / 2, 0);
        building_group.add(antenna_mesh);
    }

    createLights() {
        this.ambientLight = new THREE.AmbientLight(0xE6EAFF, 0.3);
        this.scene.add(this.ambientLight);

        const sunGeo = new THREE.SphereGeometry(10, 16, 16);
        const sunMat = new THREE.MeshPhongMaterial({
            color: 0xF85A3E,
            emissive: 0xF85A3E,
            emissiveIntensity: 0.4
        });
        this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
        this.sunMesh.castShadow = false;
        this.sunMesh.position.set(0, 200, 0);
        this.scene.add(this.sunMesh);

        this.sunLight = new THREE.DirectionalLight(0xfff2b0, 1.0);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.set(1024, 1024);
        this.sunLight.shadow.camera.far = 1000;
        this.sunLight.shadow.camera.left = -300;
        this.sunLight.shadow.camera.right = 300;
        this.sunLight.shadow.camera.top = 300;
        this.sunLight.shadow.camera.bottom = -300;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = 1000;
        this.scene.add(this.sunLight);

        const moonGeo = new THREE.SphereGeometry(8, 16, 16);
        const moonMat = new THREE.MeshPhongMaterial({
            color: 0xb0b0ff,
            emissive: 0x7777ff,
            emissiveIntensity: 0.2
        });
        this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
        this.moonMesh.castShadow = false;
        this.moonMesh.position.set(0, -200, 0);
        this.scene.add(this.moonMesh);

        this.moonLight = new THREE.DirectionalLight(0xccddff, 0.5);
        this.moonLight.castShadow = true;
        this.moonLight.shadow.mapSize.set(1024, 1024);
        this.moonLight.shadow.camera.far = 1000;
        this.moonLight.shadow.camera.left = -300;
        this.moonLight.shadow.camera.right = 300;
        this.moonLight.shadow.camera.top = 300;
        this.moonLight.shadow.camera.bottom = -300;
        this.moonLight.shadow.camera.near = 1;
        this.moonLight.shadow.camera.far = 1000;
        this.scene.add(this.moonLight);
    }

    spawnSmokeEmitter(x, y, z) {
        const smokeGeo = new THREE.PlaneGeometry(2, 2);
        const smokeMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const smokeMesh = new THREE.Mesh(smokeGeo, smokeMat);
        smokeMesh.position.set(x, y, z);
        smokeMesh.lookAt(x, y + 1, z);

        smokeMesh.userData.velY = 0.01 + Math.random() * 0.01;
        smokeMesh.userData.life = 9999;

        this.scene.add(smokeMesh);
        this.smokeParticles.push(smokeMesh);
    }

    createSmoke() {
        this.smokeParticles = [];
        if (!this.buildingTops) return;

        for (let i = 0; i < this.buildingTops.length; i++) {
            if (Math.random() > 0.5) {
                const top = this.buildingTops[i];
                this.spawnSmokeEmitter(top.x, top.y, top.z);
            }
        }
    }

    Vehicles() {
        this.vehicles = [];
        this.clock = new THREE.Clock();

        for (let i = 0; i < 30; i++) {
            const position = new THREE.Vector3(
                (Math.random() - 0.5) * 300,
                20 + Math.random() * 50,
                (Math.random() - 0.5) * 300
            );
            const phase = Math.random() * Math.PI * 2;
            const vehicle = this.createVehicle(position, phase);
            this.scene.add(vehicle);
            this.vehicles.push(vehicle);
        }
    }

    createVehicle(position, phase) {
        const vehicle = new THREE.Group();
        const body_color = 0x0000ff;
        const body_geometry = new THREE.BoxGeometry(2, 0.5, 4);
        const body_material = new THREE.MeshStandardMaterial({
            color: body_color,
            metalness: 1.0,
            roughness: 0.1,
        });
        const body = new THREE.Mesh(body_geometry, body_material);
        body.position.y = -0.1;
        vehicle.add(body);

        const bumper_geometry = new THREE.BoxGeometry(2.1, 0.3, 0.2);
        const bumper = new THREE.Mesh(bumper_geometry, body_material);
        bumper.position.set(0, -0.2, 2.2);
        vehicle.add(bumper);

        const top_geometry = new THREE.BoxGeometry(1.8, 0.5, 3);
        const top = new THREE.Mesh(top_geometry, body_material);
        top.position.set(0, 0.55, -0.2);
        vehicle.add(top);

        // car's light
        const headlight_geometry = new THREE.SphereGeometry(0.18, 16, 12);
        headlight_geometry.scale(1.2, 0.8, 1);
        const headlight_material = new THREE.MeshStandardMaterial({
            color: 0xffffaa,
            emissive: 0xffffaa,
            emissiveIntensity: 1
        });

        const left_headlight = new THREE.Mesh(headlight_geometry, headlight_material);
        left_headlight.position.set(-0.7, 0, 2.25);
        vehicle.add(left_headlight);

        const right_headlight = left_headlight.clone();
        right_headlight.position.set(0.7, 0, 2.25);
        vehicle.add(right_headlight);

        const taillight_geometry = new THREE.BoxGeometry(0.6, 0.15, 0.05);
        const taillight_material = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 1
        });

        // car's light
        const left_taillight = new THREE.Mesh(taillight_geometry, taillight_material);
        left_taillight.position.set(-0.7, 0, -2.25);
        vehicle.add(left_taillight);
        const right_taillight = left_taillight.clone();
        right_taillight.position.set(0.7, 0, -2.25);
        vehicle.add(right_taillight);
        const center_taillight_geometry = new THREE.BoxGeometry(1.4, 0.08, 0.03);
        const center_taillight = new THREE.Mesh(center_taillight_geometry, taillight_material);
        center_taillight.position.set(0, 0, -2.25);
        vehicle.add(center_taillight);

        // spotlights
        const spot_left = new THREE.SpotLight(0xffffee, 0.8, 18, Math.PI / 7, 0.4, 1);
        spot_left.position.copy(left_headlight.position);
        spot_left.target.position.set(left_headlight.position.x + 0.3, left_headlight.position.y, left_headlight.position.z + 6);
        vehicle.add(spot_left);
        vehicle.add(spot_left.target);

        const spot_right = new THREE.SpotLight(0xffffee, 0.8, 18, Math.PI / 7, 0.4, 1);
        spot_right.position.copy(right_headlight.position);
        spot_right.target.position.set(right_headlight.position.x - 0.3, right_headlight.position.y, right_headlight.position.z + 6);
        vehicle.add(spot_right);
        vehicle.add(spot_right.target);

        spot_left.userData.originalIntensity = spot_left.intensity;
        spot_right.userData.originalIntensity = spot_right.intensity;

        // beam
        const beam_geometry = new THREE.ConeGeometry(0.45, 6, 12, 1, true);
        beam_geometry.rotateX(-Math.PI / 2);
        beam_geometry.translate(0, 0, 3);

        const beam_material = new THREE.ShaderMaterial({
            uniforms: {
                intensity: { value: 0.7 }
            },
            vertexShader: volumetric_vertex_shader,
            fragmentShader: volumetric_fragment_shader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });

        const left_beam = new THREE.Mesh(beam_geometry, beam_material);
        left_beam.rotation.y = Math.PI / 30;
        left_headlight.add(left_beam);
        spot_left.userData.light_beam = left_beam;

        const right_beam = new THREE.Mesh(beam_geometry.clone(), beam_material.clone());
        right_beam.rotation.y = -Math.PI / 30;
        right_headlight.add(right_beam);
        spot_right.userData.light_beam = right_beam;

        // Set vehicle position
        if (position) {
            vehicle.position.copy(position);
        } else {
            vehicle.position.set(
                (Math.random() - 0.5) * 300,
                20 + Math.random() * 30,
                (Math.random() - 0.5) * 300
            );
        }

        vehicle.userData.initial_position = vehicle.position.clone();
        vehicle.userData.speed = 10 + Math.random() * 15;
        vehicle.userData.phase = phase || Math.random() * Math.PI * 2;

        // Set shadows for all meshes
        vehicle.traverse((obj) => {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
            }
        });

        return vehicle;
    }

    updateVehicles() {
        const elapsed_time = this.clock.getElapsedTime();

        this.vehicles.forEach(vehicle => {
            const time = elapsed_time * 0.5 + vehicle.userData.phase;

            vehicle.position.x = vehicle.userData.initial_position.x + Math.sin(time) * 25;
            vehicle.position.z = vehicle.userData.initial_position.z + Math.sin(time * 0.7) * 15;

            const next_time = time + 0.01;
            const next_x = vehicle.userData.initial_position.x + Math.sin(next_time) * 25;
            const next_z = vehicle.userData.initial_position.z + Math.sin(next_time * 0.7) * 15;
            vehicle.lookAt(next_x, vehicle.position.y, next_z);
            vehicle.traverse(obj => {
                if (obj.isSpotLight) {
                    if (obj.userData.originalIntensity !== undefined) {
                        obj.intensity = obj.userData.originalIntensity * currentNightAlpha;
                    }
                    if (obj.userData.light_beam) {
                        obj.userData.light_beam.material.uniforms.intensity.value = currentNightAlpha;
                    }
                }
            });
        });
    }

    updateSmoke() {
        if (!this.smokeParticles) return;
        this.smokeParticles.forEach(s => {
            s.position.y += s.userData.velY;

            s.material.opacity = 0.2 + Math.random() * 0.1;
            if (s.position.y > 50) {
                s.position.y = s.position.y - 50;
            }
        });
    }

    updateDayNightCycle(delta) {
        if (!this.sunMesh || !this.moonMesh || !this.sunLight || !this.moonLight || !this.ambientLight) return;

        this.dayNightTimer = (this.dayNightTimer || 0) + delta;
        const cycleLength = 60;
        if (this.dayNightTimer > cycleLength) {
            this.dayNightTimer -= cycleLength;
        }

        const phase = this.dayNightTimer / cycleLength;
        const { dayAlpha, nightAlpha } = getDayNightAlpha(phase);
        const dayAmb = 0.3;
        const nightAmb = 0.05;
        this.ambientLight.intensity = dayAmb * dayAlpha + nightAmb * nightAlpha;

        const daySky = new THREE.Color(0x4287f5);
        const nightSky = new THREE.Color(0x000011);
        const skyR = daySky.r * dayAlpha + nightSky.r * nightAlpha;
        const skyG = daySky.g * dayAlpha + nightSky.g * nightAlpha;
        const skyB = daySky.b * dayAlpha + nightSky.b * nightAlpha;
        this.scene.background = new THREE.Color(skyR, skyG, skyB);
        currentNightAlpha = nightAlpha;
        function getParabolaPos(t) {
            const x = -200 + 400 * t;
            const y = 120 - (x * x) / 400;
            return new THREE.Vector3(x, y, 0);
        }

        const halfPhase = phase * 2.0;
        if (halfPhase < 1.0) {
            const sunT = halfPhase;
            const sunPos = getParabolaPos(sunT);
            this.sunMesh.position.copy(sunPos);
            this.sunLight.position.copy(sunPos);
            this.sunLight.intensity = 1.2 * dayAlpha;
        } else {
            this.sunMesh.position.set(0, -999, 0);
            this.sunLight.position.set(0, -999, 0);
            this.sunLight.intensity = 0;
        }

        if (halfPhase >= 1.0) {
            const moonT = halfPhase - 1.0;
            const moonPos = getParabolaPos(moonT);
            this.moonMesh.position.copy(moonPos);
            this.moonLight.position.copy(moonPos);
            this.moonLight.intensity = 0.8 * nightAlpha;
        } else {
            this.moonMesh.position.set(0, -999, 0);
            this.moonLight.position.set(0, -999, 0);
            this.moonLight.intensity = 0;
        }
    }

    update(delta_time) {
        this.elapsed_time += delta_time;
        if (this.ad_uniforms) {
            this.ad_uniforms.time.value += delta_time;
        }
    }
}

function create_decorative_cubes(scene) {
    for (let i = 0; i < 10; i++) {
        const cube_size = 0.8 + Math.random() * 1.5;
        const cube_geometry = new THREE.BoxGeometry(cube_size, cube_size, cube_size);
        const cube_color = neon_colors[Math.floor(Math.random() * neon_colors.length)];

        const cube_material = new THREE.MeshStandardMaterial({
            color: cube_color,
            emissive: cube_color,
            emissiveIntensity: 1.0,
            roughness: 0.3,
            metalness: 0.7
        });

        const cubeMesh = new THREE.Mesh(cube_geometry, cube_material);

        let posX, posZ;
        do {
            posX = (Math.random() - 0.5) * 400;
            posZ = (Math.random() - 0.5) * 400;
        } while (isInsideAnyBuilding(posX, posZ, cityBuilder.buildingTops));

        const cube_height = 3 + Math.random() * 4;  
        cubeMesh.position.set(posX, cube_height, posZ);

        cubeMesh.castShadow = true;
        scene.add(cubeMesh);

        const cube_light = new THREE.PointLight(cube_color, 2.0, 8);
        cube_light.position.copy(cubeMesh.position);
        scene.add(cube_light);

        decorative_cubes.push({
            cube: cubeMesh,
            light: cube_light,
            material: cube_material,
            original_color: new THREE.Color(cube_color),
            original_height: cube_height,
            float_speed: 0.3 + Math.random() * 0.7,
            float_amplitude: 0.5 + Math.random() * 1.5,
            rotation_speed: (Math.random() - 0.5) * 0.02,
            color_change_speed: 0.1 + Math.random() * 0.3
        });
    }
}

function update_decorative_cubes(elapsed_time) {
    decorative_cubes.forEach(obj => {
        if (currentNightAlpha < 0.1) {
   
            obj.cube.position.y = obj.original_height;
  
            obj.material.color.copy(obj.original_color);
            obj.material.emissive.copy(obj.original_color);
            obj.light.intensity = 0;
        } else {
    
            const float_y = Math.sin(elapsed_time * obj.float_speed) * obj.float_amplitude;
            obj.cube.position.y = obj.original_height + float_y;
            obj.cube.rotation.x += obj.rotation_speed;
            obj.cube.rotation.y += obj.rotation_speed * 1.3;

            const time = elapsed_time * obj.color_change_speed;
            const hue = (Math.sin(time) + 1) / 2;
            const color = new THREE.Color().setHSL(hue, 1, 0.5);
            obj.material.color.copy(color);
            obj.material.emissive.copy(color);

            obj.light.position.copy(obj.cube.position);
            obj.light.color = color;
            obj.light.intensity = 2.0 * currentNightAlpha;
        }
    });
}

class DiscoBall {
    constructor(scene, x_position, y_position, z_position, material_type = 1, shadow_enabled = true) {
        this.scene = scene;
        this.position = { x: x_position, y: y_position, z: z_position };
        this.rotation_speed = (Math.random() - 0.5) * 0.01;
        this.float_speed = 0.2 + Math.random() * 0.4;
        this.float_amplitude = 0.8 + Math.random() * 1.2;
        this.original_height = y_position;
        this.material_type = material_type;
        this.color_change_speed = 0.2 + Math.random() * 0.3;
        this.mirror_color_change_speed = 0.1 + Math.random() * 0.2;
        this.shadow_enabled = shadow_enabled;
        this.base_color = neon_colors[Math.floor(Math.random() * neon_colors.length)];
        this.secondary_color = neon_colors[Math.floor(Math.random() * neon_colors.length)];
        this.mirror_blocks = [];
        this.extra_lights = [];
        this.create_ball();
        disco_balls.push(this);
    }

    create_ball() {
        const ball_radius = 2.0 + Math.random() * 1.0;
        const ball_geometry = new THREE.SphereGeometry(ball_radius, 32, 32);

        let ball_material;
        switch (this.material_type) {
            case 1:
                ball_material = new THREE.MeshStandardMaterial({
                    color: 0x888888,
                    roughness: 0.0,
                    metalness: 1.0
                });
                break;
            case 2:
                ball_material = new THREE.MeshPhysicalMaterial({
                    color: 0xffffff,
                    transmission: 0.5,
                    roughness: 0.05,
                    ior: 1.5,
                    thickness: 0.5,
                    clearcoat: 1.0,
                    clearcoatRoughness: 0.1
                });
                break;
            case 3:
                ball_material = new THREE.MeshPhongMaterial({
                    color: 0xffffff,
                    specular: 0xffffff,
                    shininess: 100,
                    reflectivity: 1.0
                });
                break;
            case 4:
                const rainbowTex = create_rainbow_texture();
                ball_material = new THREE.MeshStandardMaterial({
                    map: rainbowTex,
                    roughness: 0.3,
                    metalness: 0.8
                });
                break;
            case 5:
                ball_material = new THREE.MeshPhysicalMaterial({
                    color: 0x888888,
                    roughness: 0.1,
                    metalness: 1.0,
                    emissive: 0x222222,
                    clearcoat: 1.0,
                    clearcoatRoughness: 0.0
                });
                break;
            default:
                ball_material = new THREE.MeshStandardMaterial({
                    color: 0x888888,
                    roughness: 0.2,
                    metalness: 1.0
                });
        }

        this.ball = new THREE.Mesh(ball_geometry, ball_material);
        this.ball.castShadow = true;
        this.ball.position.set(this.position.x, this.position.y, this.position.z);
        this.scene.add(this.ball);


        this.ball_light = new THREE.PointLight(this.base_color, 8.0, 50);
        this.ball_light.castShadow = this.shadow_enabled;
        this.ball.add(this.ball_light);


        const directions = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, -1)
        ];
        directions.forEach((dir, index) => {
            const spot_light = new THREE.SpotLight(this.secondary_color, 5.0);
            spot_light.position.set(0, 0, 0);
            spot_light.target.position.copy(dir.multiplyScalar(10));
            spot_light.angle = Math.PI / 4;
            spot_light.penumbra = 0.5;
            spot_light.distance = 40;
            spot_light.decay = 1.5;
            spot_light.castShadow = false;
            this.ball.add(spot_light);
            this.ball.add(spot_light.target);
            this.extra_lights.push(spot_light);
        });

        this.create_mirror_blocks(ball_radius);
    }

    create_mirror_blocks(radius) {

        const mirror_count = (this.material_type === 4 || this.material_type === 5) ? 20 : 40;
        for (let i = 0; i < mirror_count; i++) {
            const phi = Math.acos(-1 + (2 * i) / mirror_count);
            const theta = Math.sqrt(mirror_count * Math.PI) * phi;
            const x = Math.sin(phi) * Math.cos(theta);
            const y = Math.sin(phi) * Math.sin(theta);
            const z = Math.cos(phi);

            const colorIndex = Math.floor(Math.random() * neon_colors.length);
            const color = neon_colors[colorIndex];

            const mirror_geometry = new THREE.BoxGeometry(0.4, 0.4, 0.05);
            const mirror_material = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 1.5,
                roughness: 0.1,
                metalness: 0.9
            });

            const mirror = new THREE.Mesh(mirror_geometry, mirror_material);
            mirror.position.set(x * radius, y * radius, z * radius);
            mirror.lookAt(0, 0, 0);
            this.ball.add(mirror);

            this.mirror_blocks.push({
                mesh: mirror,
                base_color: color
            });
        }
    }

    update(elapsedTime) {
        // Use currentNightAlpha instead of window.isNightState
        if (currentNightAlpha < 0.1) {
            // Daytime - turn off lights
            this.ball_light.intensity = 0;
            this.extra_lights.forEach(light => light.intensity = 0);
            return;
        }

        const breathingSpeed = 2.0;
        const baseIntensityBall = 8.0;
        const breathing = 0.5 + 0.5 * Math.sin(elapsedTime * breathingSpeed);


        this.ball.rotation.y += this.rotation_speed;
        this.ball.rotation.x += this.rotation_speed * 0.7;
        const float_y = Math.sin(elapsedTime * this.float_speed) * this.float_amplitude;
        this.ball.position.y = this.original_height + float_y;


        const t = elapsedTime * this.color_change_speed;
        const hue = (Math.sin(t) + 1) / 2;
        const color = new THREE.Color().setHSL(hue, 1, 0.5);

   
        this.ball_light.color = color;
        this.ball_light.intensity = baseIntensityBall * breathing * currentNightAlpha;

        this.extra_lights.forEach((light, index) => {
            const offset_hue = (hue + index * 0.25) % 1.0;
            const offset_color = new THREE.Color().setHSL(offset_hue, 1, 0.5);
            light.color = offset_color;
            light.intensity = 5.0 * breathing * currentNightAlpha;
        });


        this.mirror_blocks.forEach((block, idx) => {
            const t2 = elapsedTime * 0.5 + idx * 0.1;
            const flicker = Math.sin(t2) * 0.5 + 1.0;
            block.mesh.material.emissiveIntensity = 1.5 * flicker * currentNightAlpha;
        });
    }
}
function getValidDiscoPosition(buildingTops) {
    let posX, posZ;
    do {
        posX = (Math.random() - 0.5) * 400;
        posZ = (Math.random() - 0.5) * 400;
    } while (isInsideAnyBuilding(posX, posZ, buildingTops));
    const posY = 15 + Math.random() * 10;
    return { x: posX, y: posY, z: posZ };
}

function create_rainbow_texture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');


    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, 'red');
    gradient.addColorStop(0.17, 'orange');
    gradient.addColorStop(0.33, 'yellow');
    gradient.addColorStop(0.5, 'green');
    gradient.addColorStop(0.67, 'blue');
    gradient.addColorStop(0.83, 'indigo');
    gradient.addColorStop(1, 'violet');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    return new THREE.CanvasTexture(canvas);
}

function update_disco_lights(elapsed_time) {
    disco_balls.forEach(disco => {
        disco.update(elapsed_time);
    });
}
function createRainSystem() {
    const particleCount = 2000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 200;
        positions[i + 1] = Math.random() * 200;
        positions[i + 2] = (Math.random() - 0.5) * 200;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
            uTime: { value: 0.0 },
        },
        vertexShader: `
      uniform float uTime;
      void main() {
        // Move raindrops downward a bit in the vertex shader for a watery stretch
        vec3 newPosition = position;
        // Stretch the raindrop
        newPosition.y -= mod(uTime * 10.0, 50.0);
  
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        gl_PointSize = 2.0; 
      }
    `,
        fragmentShader: `
      void main() {
        gl_FragColor = vec4(0.8, 0.8, 1.0, 0.6);
      }
    `
    });

    return new THREE.Points(geometry, material);
}

function updateRain(rainSystem) {
    const positions = rainSystem.geometry.attributes.position.array;
    const mat = rainSystem.material;
    if (mat.uniforms && mat.uniforms.uTime) {
        mat.uniforms.uTime.value += 0.05;
    }

    for (let i = 1; i < positions.length; i += 3) {
        positions[i] -= 2;
        if (positions[i] < 0) {
            positions[i] = 200;
        }
    }
    rainSystem.geometry.attributes.position.needsUpdate = true;
}

const TestWorld = new World();
//Add first Scene to TestWorld
TestWorld.createArea("basics");
TestWorld.createArea("scene2");
//Get scenes to add to and update them
TestWorld.getAreaByName("scene2").background = new THREE.Color(0x0000ff);
//console.log(TestWorld.firstArea.name)
TestWorld.createArea("main");

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

const renderer = new THREE.WebGLRenderer();
renderer.shadowMap.enabled = true;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);

const composer = new EffectComposer(renderer);
const renderScene = new RenderPass(TestWorld.getAreaByName("main"), camera);
composer.addPass(renderScene);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.2,  // strength
    0.4,  // radius
    0.85  // threshold
);
composer.addPass(bloomPass);


// game constants
//const velocity = new THREE.Vector3()
//const gravity = -0.002
const speed = 0.1;
const raycaster = new THREE.Raycaster();

// create Player Elements///////////////////////////////////////////
class Player extends THREE.Mesh {
    constructor({ width, height, depth, color = "#00ff00" }) {
        super(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshStandardMaterial({ color })
        );

        this.Box = new THREE.Box3();

        this.width = width;
        this.height = height;
        this.depth = depth;

        this.velocity = new THREE.Vector3();
        this.gravity = -0.007;

        // Attack
        //this.cubeAttacks = [];
        this.forwardDir = new THREE.Vector3();
        //this.lastHitboxTime = 0;
        //this.hitboxCooldown = 0.5;
        
        //PunchParticles
        this.punchParticles = [];
    
        //Car interaction
        this.insideCar = false;
    }

    update(ground, walls, forwardDir, deltaTime) {
        this.forwardDir.copy(forwardDir).negate();
        const prevX = this.position.x;
        const prevZ = this.position.z;

        if (this.insideCar) {
            return;
        }

        this.Box.setFromObject(this);

        // Check horizontal collisions
        const horizontalRaycaster = new THREE.Raycaster();
        horizontalRaycaster.set(
            this.position,
            new THREE.Vector3(this.velocity.x, 0, this.velocity.z).normalize()
        );
        const horizontalIntersects = horizontalRaycaster.intersectObjects(walls);

        this.position.x += this.velocity.x;
        this.position.z += this.velocity.z;

        if (
            horizontalIntersects.length > 0 &&
            horizontalIntersects[0].distance < 0.5
        ) {
            // If collision, go back to previous position
            this.position.x = prevX;
            this.position.z = prevZ;
        }
        this.Box.setFromObject(this);

        // update gravity
        this.velocity.y += this.gravity;
        this.position.y += this.velocity.y;

        // Raycasting to detect ground
        raycaster.set(
            new THREE.Vector3(
                this.position.x,
                this.position.y + 0.5,
                this.position.z
            ),
            new THREE.Vector3(0, -1, 0)
        );
        const intersects = raycaster.intersectObjects(ground);

        //touch ground
        if (intersects.length > 0) {
            const groundY = intersects[0].point.y;
            if (cube.position.y - 0.5 < groundY) {
                // on ground
                cube.position.y = groundY + 0.5; // Adjust cube to sit on ground
                this.velocity.y = 0; // Reset gravity
            }
        } else {
            // very simple solution to keep cube on floor
            this.position.x -= this.velocity.x;
            this.position.z -= this.velocity.z;
            this.position.y -= this.velocity.y;
            this.velocity.y -= this.gravity;
        }

        //Handle Particles
        for (let i = this.punchParticles.length - 1; i >= 0; i--) {
            if (!this.punchParticles[i].update(deltaTime)) {
                //console.log("bye")
                TestWorld.getAreaByName(activeScene).remove(this.punchParticles[i].points);
                this.punchParticles.splice(i, 1);
            }
        }
    }

    CreatePunchAttack(hitables) {
        //console.log("punch")
        for (let i = 0; i < 250; i++) {
          this.punchParticles.push(new PunchParticle(this.position.clone(), this.forwardDir));
        }
        
        // create sphere hitbox and compare it with hitables. If collision call hitable hit() method
      }
    
      interactObject(interactables) {
        if (this.insideCar) {
          this.position.x += 3; // could move to more realistic position
          this.visible = true;
          this.insideCar = false;
          return;
        }
    
        for (let i = 0; i < interactables.length; i++) {
          let distance = this.position.distanceTo(interactables[i].getPosition());
          if (!(distance < 3)) {
            continue;
          }
          switch (interactables[i].type) {
            case "car":
            this.position.copy(interactables[i].getPosition());
            this.visible = false;
            this.insideCar = true;
          }
        }
      }
    
      getForwardDir() {
        return this.forwardDir;
      }
}

//Punch Effect ////////////////////////////////////////////////////////////////////////
const coneAngle = Math.PI / 12; // 15-degree cone spread
class PunchParticle {
constructor(position, direction) {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.PointsMaterial({
        color: 0xb5b5b5, 
        size: Math.random() * 0.6 + 0.2, // Random size between 0.2 - 0.8
        transparent: true,
        opacity: 1.0
    });

    this.factor = 0;

    // Create a single vertex for this particle
    this.positions = new Float32Array([position.x, position.y, position.z]);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    this.points = new THREE.Points(this.geometry, this.material);
    TestWorld.getAreaByName(activeScene).add(this.points);

    // Generate random direction within a cone facing the given direction
    this.velocity = this.getConeDirection(direction, coneAngle);
    
    this.particleSpeed = (Math.random() * (0.2 - 0.001) + 0.001)*(coneAngle/this.factor);
    this.velocity.multiplyScalar(this.particleSpeed);
    
    this.lifetime = (Math.random() * (0.5 - 0.1) + 0.1)*(this.factor/coneAngle); // Particle lifetime in seconds
    //console.log(this.lifetime)
}

// Generates a random direction within a cone pointing in a specified direction
getConeDirection(baseDirection, maxAngle) {
    const theta = Math.random() * maxAngle; // Random angle from center axis
    this.factor = theta;
    const phi = Math.random() * Math.PI * 2; // Full circle around axis

    // Convert spherical coordinates to Cartesian
    const x = Math.sin(theta) * Math.cos(phi);
    const y = Math.cos(theta);
    const z = Math.sin(theta) * Math.sin(phi);

    const randomDir = new THREE.Vector3(x, y, z).normalize();

    // Rotate the random direction to align with the base direction
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), baseDirection.normalize());
    randomDir.applyQuaternion(quaternion);

    return randomDir;
}

update(deltaTime) {
    this.positions[0] += this.velocity.x * deltaTime * 60;
    this.positions[1] += this.velocity.y * deltaTime * 60;
    this.positions[2] += this.velocity.z * deltaTime * 60;

    this.geometry.attributes.position.needsUpdate = true;

    // Decrease size and fade out over time
    this.lifetime -= deltaTime;
    this.material.size *= 0.95; // Shrink
    this.material.opacity = Math.max(0, this.lifetime); // Fade out

    return this.lifetime > 0; // Return false if particle should be removed
}
}

//Destructable car//////////////////////////////////////////////////////////////////////
const hitables = [];
const interactables = [];

// car wobble when hit
// car smoke when low health
// car flames when destroyed

// when near car, triangle appears above
// ride car when e clicked

class Car {
  constructor() {
    this.type = "car";
    this.vehicle = createVehicle({x: 3, y: 0.77, z: 3},1);
    TestWorld.getAreaByName('main').add(this.vehicle);
    //this.vehicle.position.x += 3;
    //this.vehicle.clear();
    this.carPointer = new InteractablePointer();
  }

  getPosition() {
    return this.vehicle.position;
  }

  updateVehicle(player) {
    // Pointer logic
    // Check Distance to Car
    const distance = player.position.distanceTo(this.vehicle.position);
    if (distance < 3) {
      this.carPointer.setVisibility(true);

      // Set pointer position
      this.carPointer.movPointer(this.vehicle.position.x, this.vehicle.position.y + 1.5, this.vehicle.position.z);
      
      // make face the camera
      this.carPointer.lookAt(camera.position);
    } else {
      this.carPointer.visible = false;
    }
  }
}

const pointerGeometry = new THREE.BufferGeometry();
const vertices = new Float32Array([
  0.5, 0.5, 0,  // T
  -0.5, 0.5, 0, // BL
  0, -0.5, 0,   // BR
]);
pointerGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
const pointerMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide });

class InteractablePointer extends THREE.Mesh {
  constructor() {
    super(pointerGeometry, pointerMaterial)
    this.rotation.x = -Math.PI / 2; // Rotate to point downward
    this.visible = false; // Hidden initially
    TestWorld.getAreaByName("main").add(this);
  }

  movPointer(x, y, z) {
    this.position.set(x, y + 1.5, z);
  }

  setVisibility(Vis) {
    this.visible = Vis;
  }
}

const car = new Car();
hitables.push(car);
interactables.push(car);

// Initialize cyberpunk city in the main scene
const cityBuilder = new CyberpunkSceneBuilder(TestWorld.getAreaByName("main"));
cityBuilder.createCity();
cityBuilder.Vehicles();

const rainSystem = createRainSystem();
TestWorld.getAreaByName("main").add(rainSystem);


create_decorative_cubes(TestWorld.getAreaByName("main"));

const sceneBasics = TestWorld.getAreaByName("main");
let pos = getValidDiscoPosition(cityBuilder.buildingTops);
new DiscoBall(sceneBasics, pos.x, pos.y, pos.z, 1, true);
pos = getValidDiscoPosition(cityBuilder.buildingTops);
new DiscoBall(sceneBasics, pos.x, pos.y, pos.z, 2, true);
pos = getValidDiscoPosition(cityBuilder.buildingTops);
new DiscoBall(sceneBasics, pos.x, pos.y, pos.z, 3, true);
pos = getValidDiscoPosition(cityBuilder.buildingTops);
new DiscoBall(sceneBasics, pos.x, pos.y, pos.z, 4, true);
pos = getValidDiscoPosition(cityBuilder.buildingTops);
new DiscoBall(sceneBasics, pos.x, pos.y, pos.z, 5, true);

class Floor {
    constructor() { }
}

class Ground extends THREE.Mesh {
    constructor({ width, depth, color = "#0000ff" }) {
        super(
            new THREE.PlaneGeometry(width, depth),
            new THREE.MeshStandardMaterial({ color })
        );
        this.rotateX(-Math.PI / 2);
    }
}

function createGround(
    origin,
    orientation,
    grid,
    { floating = true, walls = false }
) {
    // origin is a pont of the first ground location
    // orientation is a normal vector that determines the angle of the origin ground space
    // grid is a matrix of arbitrary size
}

class Portal extends THREE.Mesh {
    constructor({ width, height, XZdirection, x, y, z, destination }) {
        //create rectangle, move to location, set destination, set visibility
        super(
            new THREE.BoxGeometry(width, height, 0.5),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        this.position.set(x, y, z); // Move it Move it.
        this.destination = destination;
        this.rotateY(XZdirection).rotateZ(Math.PI / 2); // XZ direction taken in radians
        this.Box = new THREE.Box3();
        this.Box.setFromObject(this);
    }

    update() {
        //this.Box.setFromObject(this)
    }
}
// main player
const cube = new Player({ width: 1, height: 1, depth: 1 });
cube.castShadow = true;
TestWorld.getAreaByName("main").add(cube);


camera.position.z = 5;

const keys = {
    a: { pressed: false, value: 0 },
    d: { pressed: false, value: 0 },
    w: { pressed: false, value: 0 },
    s: { pressed: false, value: 0 },
    space: { pressed: false, value: 0 },
};

// kontrols
window.addEventListener("keydown", (event) => {
    //console.log(event.key)
    //let speed = 0.03
    switch (event.key.toUpperCase()) {
        case "A":
            keys.a.pressed = true;
            keys.a.value = -speed;
            break;
        case "D":
            keys.d.pressed = true;
            keys.d.value = speed;
            break;
        case "W":
            keys.w.pressed = true;
            keys.w.value = -speed;
            break;
        case "S":
            keys.s.pressed = true;
            keys.s.value = speed;
            break;
        case "E":
            cube.interactObject(interactables);
    }
});

window.addEventListener("keyup", (event) => {
    switch (event.key.toUpperCase()) {
        case "A":
            keys.a.pressed = false;
            keys.a.value = 0;
            break;
        case "D":
            keys.d.pressed = false;
            keys.d.value = 0;
            break;
        case "W":
            keys.w.pressed = false;
            keys.w.value = 0;
            break;
        case "S":
            keys.s.pressed = false;
            keys.s.value = 0;
            break;
    }
});

// Attack
//renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.domElement.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      cube.CreatePunchAttack(hitables)
    }
});

let activeScene = "main";

let cameraDistance = 10;
let cameraYaw = 0;
let cameraPitch = 0;
const pitchLimit = 1;

let isPointerLocked = false;
renderer.domElement.addEventListener("click", () => {
    if (!isPointerLocked) {
        renderer.domElement.requestPointerLock();
    }
});

document.addEventListener("pointerlockchange", () => {
    isPointerLocked = document.pointerLockElement === renderer.domElement;
});

document.addEventListener("mousemove", (e) => {
    if (isPointerLocked) {
        const sensitivity = 0.003;

        cameraYaw -= e.movementX * sensitivity;
        cameraPitch += e.movementY * sensitivity;

        if (cameraPitch > pitchLimit) cameraPitch = pitchLimit;
        if (cameraPitch < -pitchLimit) cameraPitch = -pitchLimit;
    }
});
renderer.domElement.addEventListener("wheel", (event) => {
    const zoomSensitivity = 0.01;
    cameraDistance += event.deltaY * zoomSensitivity;
    cameraDistance = Math.max(2, Math.min(50, cameraDistance));
    event.preventDefault();
});

const dayNightClock = new THREE.Clock();

let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    const delta = dayNightClock.getDelta();
    cityBuilder.updateDayNightCycle(delta);
    composer.render();

    let currentTime = dayNightClock.getElapsedTime();
    const deltaTime = (currentTime - lastTime);
    lastTime = currentTime;

    //camera control section:
    const offsetX = cameraDistance * Math.cos(cameraPitch) * Math.sin(cameraYaw);
    const offsetY = cameraDistance * Math.sin(cameraPitch);
    const offsetZ = cameraDistance * Math.cos(cameraPitch) * Math.cos(cameraYaw);

    const cubeCenter = new THREE.Vector3().copy(cube.position);

    camera.position.set(
        cubeCenter.x + offsetX,
        cubeCenter.y + offsetY,
        cubeCenter.z + offsetZ
    );

    if (camera.position.y < 0.2) {
        camera.position.y = 0.2;
    }

    const forwardVec = new THREE.Vector3(
        Math.sin(cameraYaw),
        0,
        Math.cos(cameraYaw)
    ).normalize();
    const rightVec = new THREE.Vector3();
    const upVec = new THREE.Vector3();
    const lookDirectionOffset = new THREE.Vector3();
    const lookDirection = new THREE.Vector3().copy(forwardVec).add(lookDirectionOffset);
    const lookTarget = new THREE.Vector3().copy(cubeCenter).add(lookDirection);

    rightVec.crossVectors(new THREE.Vector3(0, 1, 0), forwardVec).normalize();
    upVec.crossVectors(forwardVec, rightVec).normalize();
    camera.lookAt(lookTarget);
    if (forwardVec.length() > 0.1) {
        const targetRotation = Math.atan2(forwardVec.x, forwardVec.z);
        cube.rotation.y = targetRotation;
    }

    const forwardAmount = keys.w.value + keys.s.value;
    const strafeAmount = keys.d.value + keys.a.value;

    const moveVec = new THREE.Vector3();
    moveVec.addScaledVector(forwardVec, forwardAmount);
    moveVec.addScaledVector(rightVec, strafeAmount);

    cube.velocity.x += (moveVec.x - cube.velocity.x) * 0.3;
    cube.velocity.z += (moveVec.z - cube.velocity.z) * 0.3;

    cube.update(floor, walls, forwardVec, deltaTime);
    car.updateVehicle(cube);

    //updateRain(rainSystem);
    cityBuilder.updateVehicles();

    update_decorative_cubes(dayNightClock.getElapsedTime());


    update_disco_lights(dayNightClock.getElapsedTime());

    cityBuilder.update(delta);

    renderer.render(TestWorld.getAreaByName(activeScene), camera);

    cityBuilder.update(delta);

    /*
    // Exit Object intersection, we didnt define any exits
    for (let i = 0; i < exits.length; i++) {
        if (cube.Box.intersectsBox(exits[i].Box)) {
            activeScene = exits[i].destination;
        }
    }
    */

}

animate();