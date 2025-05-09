import * as THREE from "three";

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

// neon color
const neon_colors = [0xff00ff, 0x00ffff, 0xff3366, 0x33ff33, 0xff6600, 0x0066ff];

// create car
function createVehicle(position, phase) {
    const vehicle = new THREE.Group();

    const body_color = neon_colors[Math.floor(Math.random() * neon_colors.length)];
    const body_geometry = new THREE.BoxGeometry(2.2, 0.8, 4.5);
    const body_material = new THREE.MeshStandardMaterial({
        color: body_color,
        metalness: 1.0,
        roughness: 0.1,
        envMapIntensity: 1.2
    });
    const body = new THREE.Mesh(body_geometry, body_material);
    body.position.y = -0.1;
    vehicle.add(body);

    const bumper_geometry = new THREE.BoxGeometry(2.1, 0.3, 0.2);
    const bumper = new THREE.Mesh(bumper_geometry, body_material);
    bumper.position.set(0, -0.2, 2.2);
    vehicle.add(bumper);

    const top_geometry = new THREE.BoxGeometry(1.8, 0.5, 2.2);
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


    // light 
    const spot_left = new THREE.SpotLight(0xffffee, 0.8, 18, Math.PI / 7, 0.4, 1);
    spot_left.position.copy(left_headlight.position);
    spot_left.target.position.set(left_headlight.position.x + 0.3, left_headlight.position.y, left_headlight.position.z + 6);
    vehicle.add(spot_left);
    vehicle.add(spot_left.target);

    // Flicker
    spot_left.userData = {
        original_intensity: spot_left.intensity,
        flicker_state: 0,
        fade_start: 0,
        fade_duration: 0,
        start_intensity: 0,
        end_intensity: 0,
        next_flicker: Math.random() * 3 + 2
    };

    const spot_right = new THREE.SpotLight(0xffffee, 0.8, 18, Math.PI / 7, 0.4, 1);
    spot_right.position.copy(right_headlight.position);
    spot_right.target.position.set(right_headlight.position.x - 0.3, right_headlight.position.y, right_headlight.position.z + 6);
    vehicle.add(spot_right);
    vehicle.add(spot_right.target);

    spot_right.userData = {
        original_intensity: spot_right.intensity,
        flicker_state: 0,
        fade_start: 0,
        fade_duration: 0,
        start_intensity: 0,
        end_intensity: 0,
        next_flicker: Math.random() * 3 + 2
    };

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

    // wheel, we can deterwine whether add this part
    const wheel_geometry = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 16);
    wheel_geometry.rotateZ(Math.PI / 2);
    const wheel_material = new THREE.MeshStandardMaterial({
        color: 0x222222,
        metalness: 0.5,
        roughness: 0.7
    });

    const front_left_wheel = new THREE.Mesh(wheel_geometry, wheel_material);
    front_left_wheel.position.set(-1.2, -0.4, 1.5);
    vehicle.add(front_left_wheel);
    
    const front_right_wheel = front_left_wheel.clone();
    front_right_wheel.position.set(1.2, -0.4, 1.5);
    vehicle.add(front_right_wheel);
    
    const back_left_wheel = front_left_wheel.clone();
    back_left_wheel.position.set(-1.2, -0.4, -1.5);
    vehicle.add(back_left_wheel);
    
    const back_right_wheel = front_left_wheel.clone();
    back_right_wheel.position.set(1.2, -0.4, -1.5);
    vehicle.add(back_right_wheel);

    // set car's position, need to revise after write the building generator 
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

    return vehicle;
}
export default createVehicle;

// ask gpt how to write this part
const FlickerUtils = {
    startFadeOut: function(child, elapsed_time) {
        const flicker_mode = Math.random();
        const target_intensity = flicker_mode < 0.5 ? 0.3 : 0.0;

        child.userData.flicker_state = 1;
        child.userData.fade_start = elapsed_time;
        child.userData.fade_duration = 5 + Math.random() * 5;
        child.userData.start_intensity = child.intensity;
        child.userData.end_intensity = target_intensity;
    },

    startFadeIn: function(child, elapsed_time) {
        child.userData.flicker_state = 2;
        child.userData.fade_start = elapsed_time;
        child.userData.fade_duration = 5 + Math.random() * 5;
        child.userData.start_intensity = child.intensity;
        child.userData.end_intensity = child.userData.original_intensity;
    },

    updateFlicker: function(child, elapsed_time, THREE) {
        const user_data = child.userData;
        
        if (user_data.flicker_state === 0 && elapsed_time > user_data.next_flicker) {
            this.startFadeOut(child, elapsed_time);
        }

        if (user_data.flicker_state === 1) {
            const progress = (elapsed_time - user_data.fade_start) / user_data.fade_duration;
            
            if (progress >= 1) {
                child.intensity = user_data.end_intensity;
                if (user_data.light_beam) {
                    user_data.light_beam.material.uniforms.intensity.value = user_data.end_intensity;
                }
                this.startFadeIn(child, elapsed_time);
            } else {
                const val = THREE.MathUtils.lerp(user_data.start_intensity, user_data.end_intensity, progress);
                child.intensity = val;
                if (user_data.light_beam) {
                    user_data.light_beam.material.uniforms.intensity.value = val;
                }
            }
        } 
        else if (user_data.flicker_state === 2) {
            const progress = (elapsed_time - user_data.fade_start) / user_data.fade_duration;
            
            if (progress >= 1) {
                child.intensity = user_data.end_intensity;
                if (user_data.light_beam) {
                    user_data.light_beam.material.uniforms.intensity.value = user_data.end_intensity;
                }
                user_data.flicker_state = 0;
                user_data.next_flicker = elapsed_time + Math.random() * 3 + 2;
            } else {
                const val = THREE.MathUtils.lerp(user_data.start_intensity, user_data.end_intensity, progress);
                child.intensity = val;
                if (user_data.light_beam) {
                    user_data.light_beam.material.uniforms.intensity.value = val;
                }
            }
        }
    }
};


function updateVehicle(vehicle, elapsed_time, THREE) {

    const time = elapsed_time * 0.5 + vehicle.userData.phase;
 
    vehicle.position.x = vehicle.userData.initial_position.x + Math.sin(time) * 25;
    vehicle.position.z = vehicle.userData.initial_position.z + Math.sin(time * 0.7) * 15;

    const next_time = time + 0.01;
    const next_x = vehicle.userData.initial_position.x + Math.sin(next_time) * 25;
    const next_z = vehicle.userData.initial_position.z + Math.sin(next_time * 0.7) * 15;
    vehicle.lookAt(next_x, vehicle.position.y, next_z);

    vehicle.children.forEach((child) => {
        if (child.isSpotLight) {
            FlickerUtils.updateFlicker(child, elapsed_time, THREE);
        }
    });
}
//export default updateVehicle;