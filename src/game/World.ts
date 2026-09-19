import * as THREE from "three";
import { WAVE_GLSL, waveHeight } from "./waves";
import type { LevelTheme } from "./Levels";
import { randRange } from "./utils";

const FOG_NEAR = 45;
const FOG_FAR = 190;
const MARKER_X = 9.6; // the glowing edge buoys that line the racing corridor
const MARKER_COUNT = 22;
const MARKER_SPACING = 12;

function hsl(h: number, s: number, l: number): THREE.Color {
  return new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, s, l, THREE.SRGBColorSpace);
}

/** Every color that changes from one level's "world" to the next. Eased in place so a level-up grades smoothly. */
export class Palette {
  fog = new THREE.Color();
  zenith = new THREE.Color();
  deep = new THREE.Color();
  shallow = new THREE.Color();
  sun = new THREE.Color();
  mountain = new THREE.Color();
  accent = new THREE.Color();

  setTheme(theme: LevelTheme) {
    const h = theme.hue;
    this.fog.copy(hsl(h, 0.85, 0.17));
    this.zenith.copy(hsl(h, 0.8, 0.05));
    this.deep.copy(hsl(h, 0.75, 0.045));
    this.shallow.copy(hsl(h + 8, 0.9, 0.12));
    this.sun.copy(hsl(h + 30, 1, 0.62));
    this.mountain.copy(hsl(h, 0.7, 0.06));
    this.accent.set(theme.accent);
  }

  copy(o: Palette) {
    this.fog.copy(o.fog);
    this.zenith.copy(o.zenith);
    this.deep.copy(o.deep);
    this.shallow.copy(o.shallow);
    this.sun.copy(o.sun);
    this.mountain.copy(o.mountain);
    this.accent.copy(o.accent);
  }

  easeTo(o: Palette, k: number) {
    this.fog.lerp(o.fog, k);
    this.zenith.lerp(o.zenith, k);
    this.deep.lerp(o.deep, k);
    this.shallow.lerp(o.shallow, k);
    this.sun.lerp(o.sun, k);
    this.mountain.lerp(o.mountain, k);
    this.accent.lerp(o.accent, k);
  }
}

const waterVert = /* glsl */ `
${WAVE_GLSL}
uniform float uScroll;
uniform float uTime;
varying vec3 vWorld;
varying float vH;
varying vec2 vPat;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float u = w.z - uScroll;
  float h = waveHeight(w.x, u, uTime);
  w.y += h;
  vWorld = w.xyz;
  vH = h;
  vPat = vec2(w.x, u);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const waterFrag = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uGrid;
uniform vec3 uFog;
uniform vec3 uSun;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
varying vec3 vWorld;
varying float vH;
varying vec2 vPat;
void main() {
  float dist = distance(cameraPosition, vWorld);
  vec3 base = mix(uDeep, uShallow, smoothstep(-0.45, 0.5, vH));

  // faint neon grid printed on the swell - a stable structure to read speed from
  vec2 g = vPat / 4.0;
  vec2 gr = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(0.0001));
  float line = 1.0 - min(min(gr.x, gr.y), 1.0);
  line *= 1.0 - smoothstep(60.0, 150.0, dist);

  float crest = smoothstep(0.2, 0.5, vH);
  float rip = sin(vPat.y * 2.3 + vPat.x * 1.7 + uTime * 2.0) * sin(vPat.x * 1.1 - vPat.y * 1.9 - uTime * 1.3);
  rip = smoothstep(0.75, 1.0, rip) * 0.05;

  vec3 col = base + uGrid * (line * 0.55 + crest * 0.12 + rip);

  // glitter path under the sun
  float glit = exp(-abs(vWorld.x) * 0.05) * smoothstep(30.0, 140.0, dist);
  glit *= 0.5 + 0.5 * sin(vPat.y * 1.3 + vPat.x * 2.9 + uTime * 3.0);
  col += uSun * glit * 0.3;

  float f = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFog, f);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const skyFrag = /* glsl */ `
uniform vec3 uFog;
uniform vec3 uZenith;
uniform vec3 uSun;
varying vec3 vDir;
void main() {
  float y = vDir.y;
  vec3 col = mix(uFog, uZenith, smoothstep(0.0, 0.55, y));
  float front = smoothstep(-0.2, 1.0, -vDir.z);
  float glow = exp(-abs(y) * 9.0);
  col += uSun * glow * 0.45 * front;

  // big synthwave sun sitting on the horizon, sliced by widening gaps
  if (vDir.z < 0.0 && y > 0.0) {
    vec2 p = vec2(vDir.x, y) / -vDir.z;
    vec2 c = vec2(0.0, 0.13);
    float R = 0.2;
    float d = length(p - c);
    float disc = smoothstep(R, R - 0.008, d);
    float py = p.y - c.y;
    float t = clamp(-py / R, 0.0, 1.0);
    float stripes = step(t * 0.7, fract(p.y * 26.0));
    disc *= mix(1.0, stripes, step(py, 0.0));
    col += uSun * exp(-d * 4.0) * 0.22;
    col = mix(col, uSun * 1.5, disc);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Island {
  group: THREE.Group;
  z: number;
  x: number;
}

/**
 * Everything static around the racing lane: the water, the sky, distant
 * mountains, drifting palm islands, the edge buoys and speed streaks.
 * It owns the level palette and eases it toward whatever theme is current.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly palette = new Palette();
  private target = new Palette();

  private fog: THREE.Fog;
  private water: THREE.Mesh;
  private waterMat: THREE.ShaderMaterial;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private mountains: THREE.Mesh;
  private mountainMat: THREE.MeshBasicMaterial;
  private ridge: THREE.LineLoop;
  private ridgeMat: THREE.LineBasicMaterial;
  private markers: THREE.InstancedMesh;
  private markerMat: THREE.MeshBasicMaterial;
  private islands: Island[] = [];
  private islandMat: THREE.MeshStandardMaterial;
  private palmMat: THREE.MeshStandardMaterial;
  private streaks: THREE.LineSegments;
  private streakMat: THREE.LineBasicMaterial;
  private streakData: Float32Array;
  private rng: () => number;
  private dummy = new THREE.Object3D();

  constructor(rng: () => number) {
    this.rng = rng;
    this.palette.setTheme({ name: "", accent: "#ff2fd6", hue: 300 });
    this.target.copy(this.palette);

    this.fog = new THREE.Fog(this.palette.fog.clone(), FOG_NEAR, FOG_FAR);
    this.scene.fog = this.fog;

    // ---- lights
    this.scene.add(new THREE.HemisphereLight(0x8a7cff, 0x120a24, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-6, 10, 8);
    this.scene.add(key);

    // ---- water
    const waterGeo = new THREE.PlaneGeometry(200, 330, 100, 165);
    waterGeo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: waterVert,
      fragmentShader: waterFrag,
      uniforms: {
        uScroll: { value: 0 },
        uTime: { value: 0 },
        uDeep: { value: this.palette.deep },
        uShallow: { value: this.palette.shallow },
        uGrid: { value: this.palette.accent },
        uFog: { value: this.palette.fog },
        uSun: { value: this.palette.sun },
        uFogNear: { value: FOG_NEAR },
        uFogFar: { value: FOG_FAR },
      },
    });
    this.water = new THREE.Mesh(waterGeo, this.waterMat);
    this.water.position.set(0, 0, -115);
    this.water.frustumCulled = false;
    this.scene.add(this.water);

    // ---- sky dome
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        uFog: { value: this.palette.fog },
        uZenith: { value: this.palette.zenith },
        uSun: { value: this.palette.sun },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    const starCount = 260;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = rng() * Math.PI * 2;
      const el = Math.asin(randRange(rng, 0.06, 1));
      starPos[i * 3] = Math.cos(el) * Math.cos(a) * 380;
      starPos[i * 3 + 1] = Math.sin(el) * 380;
      starPos[i * 3 + 2] = Math.cos(el) * Math.sin(a) * 380;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.7,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        fog: false,
      }),
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.scene.add(this.stars);

    // ---- mountains: a jagged ring at the horizon, with a valley where the sun sits
    const cols = 180;
    const radius = 300;
    const verts: number[] = [];
    const ridgePts: number[] = [];
    const heightAt = (a: number) => {
      const n = 14 + 10 * Math.sin(a * 5 + 1) + 7 * Math.sin(a * 11 + 2) + 4 * Math.sin(a * 23 + 0.5);
      let diff = Math.abs(((a + Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI); // angular distance from straight ahead (-z)
      diff = Math.abs(diff);
      const valley = Math.min(1, 0.22 + diff / 1.1);
      return Math.max(3, n) * valley;
    };
    for (let i = 0; i < cols; i++) {
      const a0 = (i / cols) * Math.PI * 2;
      const a1 = ((i + 1) / cols) * Math.PI * 2;
      const x0 = Math.cos(a0) * radius;
      const z0 = Math.sin(a0) * radius;
      const x1 = Math.cos(a1) * radius;
      const z1 = Math.sin(a1) * radius;
      const h0 = heightAt(a0);
      const h1 = heightAt(a1);
      verts.push(x0, -8, z0, x1, -8, z1, x1, h1, z1, x0, -8, z0, x1, h1, z1, x0, h0, z0);
      ridgePts.push(x0, h0, z0);
    }
    const mGeo = new THREE.BufferGeometry();
    mGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    this.mountainMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false });
    this.mountains = new THREE.Mesh(mGeo, this.mountainMat);
    this.mountains.frustumCulled = false;
    this.scene.add(this.mountains);
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute("position", new THREE.Float32BufferAttribute(ridgePts, 3));
    this.ridgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, fog: false });
    this.ridge = new THREE.LineLoop(rGeo, this.ridgeMat);
    this.ridge.frustumCulled = false;
    this.scene.add(this.ridge);

    // ---- edge buoys: two glowing rows marking the corridor, streaming past
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.markers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 10, 8), this.markerMat, MARKER_COUNT * 2);
    this.markers.frustumCulled = false;
    this.scene.add(this.markers);

    // ---- palm islands drifting by on both sides
    this.islandMat = new THREE.MeshStandardMaterial({ color: 0x140d26, roughness: 1, flatShading: true });
    this.palmMat = new THREE.MeshStandardMaterial({
      color: 0x08140f,
      roughness: 0.9,
      flatShading: true,
      emissive: 0xffffff,
      emissiveIntensity: 0.12,
    });
    for (let i = 0; i < 14; i++) {
      const island = this.makeIsland();
      island.z = -randRange(rng, -20, 250);
      this.placeIsland(island, false);
      this.scene.add(island.group);
      this.islands.push(island);
    }

    // ---- speed streaks
    const streakCount = 55;
    this.streakData = new Float32Array(streakCount * 4); // x, y, z, length
    for (let i = 0; i < streakCount; i++) this.resetStreak(i, true);
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(streakCount * 6), 3));
    this.streakMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.streaks = new THREE.LineSegments(sGeo, this.streakMat);
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);
  }

  private makeIsland(): Island {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3 + this.rng() * 2, 5.5 + this.rng() * 2, 1.6, 7), this.islandMat);
    base.position.y = 0;
    group.add(base);
    const palms = 1 + Math.floor(this.rng() * 3);
    for (let p = 0; p < palms; p++) {
      const palm = new THREE.Group();
      const trunkH = 3.6 + this.rng() * 2;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, trunkH, 6), this.palmMat);
      trunk.position.y = trunkH / 2;
      palm.add(trunk);
      const crown = new THREE.Group();
      crown.position.y = trunkH;
      for (let f = 0; f < 6; f++) {
        const pivot = new THREE.Group();
        pivot.rotation.y = (f / 6) * Math.PI * 2 + this.rng() * 0.4;
        const frond = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.5), this.palmMat);
        frond.position.x = 1.15;
        frond.rotation.z = -0.4;
        pivot.add(frond);
        crown.add(pivot);
      }
      palm.add(crown);
      palm.position.set(randRange(this.rng, -1.8, 1.8), 0.6, randRange(this.rng, -1.8, 1.8));
      palm.rotation.z = randRange(this.rng, -0.2, 0.2);
      group.add(palm);
    }
    return { group, z: 0, x: 0 };
  }

  private placeIsland(island: Island, respawn: boolean) {
    const side = this.rng() < 0.5 ? -1 : 1;
    island.x = side * randRange(this.rng, 26, 80);
    if (respawn) island.z = -randRange(this.rng, 230, 290);
    island.group.position.x = island.x;
    island.group.rotation.y = this.rng() * Math.PI * 2;
  }

  private resetStreak(i: number, anywhere: boolean) {
    const side = this.rng() < 0.5 ? -1 : 1;
    this.streakData[i * 4] = side * randRange(this.rng, 2.5, 13);
    this.streakData[i * 4 + 1] = randRange(this.rng, 0.4, 7);
    this.streakData[i * 4 + 2] = anywhere ? randRange(this.rng, -60, 8) : -randRange(this.rng, 55, 70);
    this.streakData[i * 4 + 3] = randRange(this.rng, 0.5, 1.4);
  }

  setTheme(theme: LevelTheme, instant = false) {
    this.target.setTheme(theme);
    if (instant) this.palette.copy(this.target);
  }

  update(dt: number, scroll: number, worldSpeed: number, time: number, camera: THREE.Camera, speedFactor: number) {
    this.palette.easeTo(this.target, Math.min(1, dt * 1.6));
    this.fog.color.copy(this.palette.fog);

    this.waterMat.uniforms.uScroll.value = scroll;
    this.waterMat.uniforms.uTime.value = time;

    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.mountains.position.set(camera.position.x, 0, camera.position.z);
    this.ridge.position.copy(this.mountains.position);
    this.mountainMat.color.copy(this.palette.mountain);
    this.ridgeMat.color.copy(this.palette.accent);
    this.markerMat.color.copy(this.palette.accent).multiplyScalar(1.6);
    this.islandMat.color.copy(this.palette.mountain).multiplyScalar(1.6);
    this.palmMat.emissive.copy(this.palette.accent);

    // edge buoys: positions are a pure function of scroll, so they never drift out of sync with the water
    const span = MARKER_COUNT * MARKER_SPACING;
    let n = 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < MARKER_COUNT; i++) {
        const base = -i * MARKER_SPACING;
        let z = ((((base + scroll) % span) + span) % span) - (span - 40);
        z += side > 0 ? 0 : MARKER_SPACING / 2;
        const u = z - scroll;
        this.dummy.position.set(side * MARKER_X, 0.35 + waveHeight(side * MARKER_X, u, time), z);
        this.dummy.updateMatrix();
        this.markers.setMatrixAt(n++, this.dummy.matrix);
      }
    }
    this.markers.instanceMatrix.needsUpdate = true;

    for (const island of this.islands) {
      island.z += worldSpeed * dt;
      if (island.z > 30) this.placeIsland(island, true);
      island.group.position.set(island.x, waveHeight(island.x, island.z - scroll, time) * 0.5 + 0.2, island.z);
    }

    // speed streaks - only visible once you're really moving
    this.streakMat.opacity = Math.max(0, Math.min(0.5, (speedFactor - 0.08) * 0.7));
    const attr = this.streaks.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const len = 2.5 + worldSpeed * 0.12;
    for (let i = 0; i < this.streakData.length / 4; i++) {
      this.streakData[i * 4 + 2] += worldSpeed * dt * 1.4;
      if (this.streakData[i * 4 + 2] > 9) this.resetStreak(i, false);
      const x = this.streakData[i * 4];
      const y = this.streakData[i * 4 + 1];
      const z = this.streakData[i * 4 + 2];
      const l = len * this.streakData[i * 4 + 3];
      arr[i * 6] = x;
      arr[i * 6 + 1] = y;
      arr[i * 6 + 2] = z;
      arr[i * 6 + 3] = x;
      arr[i * 6 + 4] = y;
      arr[i * 6 + 5] = z - l;
    }
    attr.needsUpdate = true;
  }
}
