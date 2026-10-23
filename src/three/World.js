import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMachine, syncPusher } from './machine.js';
import {
  makeMaterials,
  makeNuggetGeometries,
  makeNuggetMaterial,
  makeNuggetMesh,
  makeJackpotBox,
  makeJackpotLabelTexture,
  makeBoxFrontTexture,
  makeStarShape,
} from './assets.js';
import { pusherFrontAt } from '../config.js';
import { PusherWorld } from '../physics.js';
import { mulberry32, clamp, lerp } from '../utils.js';

const DEG = Math.PI / 180;

export class GameWorld {
  constructor(container, config, callbacks = {}) {
    this.container = container;
    this.config = config;
    this.callbacks = callbacks;
    this.paused = false;
    this.destroyed = false;

    this.rand = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
    this.visualTime = 0;
    this.machineTime = 0;
    this.active = false;
    this.accumulator = 0;
    this.lastTime = performance.now();

    this.coinMeshes = new Map();
    this.fallAnims = [];
    this.dropAnims = [];
    this.dropQueue = [];
    this.landBounces = [];
    this.plateCoins = [];
    this.plateFalls = [];
    this.lastPlateFront = null;
    this.dropCooldown = 0;
    this.rings = [];
    this.bursts = [];
    this.jackpotAnim = null;
    this.jackpotWon = Boolean(callbacks.jackpotAlreadyWon);
    this.jackpotWonAt = 0;
    this.shake = 0;

    this.cameraState = {
      azimuth: this.config.machine.camera.azimuthDeg * DEG,
      elevation: this.config.machine.camera.elevationDeg * DEG,
      targetAzimuth: this.config.machine.camera.azimuthDeg * DEG,
      targetElevation: this.config.machine.camera.elevationDeg * DEG,
      radius: 12,
      dragging: false,
      lastX: 0,
      lastY: 0,
      pointerId: null,
    };

    this.initRenderer();
    this.initScene();
    this.initLights();
    this.initMachine();
    this.initPhysics();
    this.initCameraControls();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    this.renderer.domElement.setAttribute('aria-label', '麦乐鸡块推币机 3D 场景');
    this.container.appendChild(this.renderer.domElement);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.config.machine.camera.fov, 1, 0.1, 80);
    const target = this.config.machine.camera.target;
    this.baseTarget = new THREE.Vector3(target[0], target[1], target[2]);
    this.target = this.baseTarget.clone();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(env, 0.04).texture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.4;
    pmrem.dispose();
    env.traverse?.((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose?.();
      }
    });
  }

  initLights() {
    const hemi = new THREE.HemisphereLight(0xfff2ce, 0xb55b3c, 0.85);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff0cf, 2.15);
    key.position.set(4.5, 10, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(window.innerWidth < 760 ? 1024 : 2048, window.innerWidth < 760 ? 1024 : 2048);
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -4;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    key.target.position.set(0, 1.4, 0);
    this.scene.add(key);
    this.scene.add(key.target);
    this.keyLight = key;

    const fill = new THREE.DirectionalLight(0xff9b79, 0.38);
    fill.position.set(-6, 4, 2);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffe39b, 0.55);
    rim.position.set(2, 6, -6);
    this.scene.add(rim);
  }

  initMachine() {
    this.materials = makeMaterials();
    this.machine = createMachine(this.config, this.materials);
    this.scene.add(this.machine);

    this.nuggetGeoms = makeNuggetGeometries();
    this.nuggetMaterial = makeNuggetMaterial();

    // 灯牌灯泡独立脉动
    for (let i = 0; i < this.machine.userData.bulbs.length; i++) {
      const bulb = this.machine.userData.bulbs[i];
      bulb.material = this.materials.bulb.clone();
      bulb.userData.phase = i * 0.72;
    }

    this.jackpotGroup = makeJackpotBox(
      this.materials,
      this.nuggetGeoms,
      this.nuggetMaterial,
      makeBoxFrontTexture(),
      makeJackpotLabelTexture()
    );
    this.jackpotGroup.position.set(
      this.config.machine.jackpot.x,
      this.config.machine.bed.topY + 0.005,
      this.config.machine.jackpot.z
    );
    this.scene.add(this.jackpotGroup);

    this.ghostGroup = this.buildGhost();
    this.ghostGroup.visible = false;
    this.scene.add(this.ghostGroup);

    this.initDust();
    this.updateJackpotVisuals(0, true);
  }

  buildGhost() {
    const group = new THREE.Group();
    const starGeo = new THREE.ExtrudeGeometry(makeStarShape(0.32, 0.14, 5), {
      depth: 0.1,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      bevelSegments: 1,
    });
    starGeo.center();
    const star = new THREE.Mesh(starGeo, this.materials.gold);
    star.castShadow = true;
    star.position.y = 0.55;
    star.rotation.x = -0.25;
    group.add(star);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.03, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);
    group.position.set(
      this.config.machine.jackpot.x,
      this.config.machine.bed.topY + 0.005,
      this.config.machine.jackpot.z
    );
    group.userData = { star, ring };
    return group;
  }

  initDust() {
    const count = 46;
    const positions = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 3.8 + this.rand() * 3.8;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.4 + this.rand() * 6.2;
      positions[i * 3 + 2] = Math.sin(a) * r * 0.75;
      seeds.push({ y: positions[i * 3 + 1], phase: this.rand() * Math.PI * 2, speed: 0.15 + this.rand() * 0.2 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffd77a,
      size: 0.055,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, mat);
    this.scene.add(this.dust);
    this.dustSeeds = seeds;
  }

  initPhysics() {
    this.physics = new PusherWorld(this.config, this.rand);
    this.physics.seedInitialCoins(mulberry32(this.config.machine.physics.initialSeed));
    if (this.jackpotWon) {
      this.physics.box.fallen = true;
      this.jackpotGroup.visible = false;
      this.ghostGroup.visible = true;
    }
    for (const coin of this.physics.coins) {
      const mesh = makeNuggetMesh(this.nuggetGeoms, this.nuggetMaterial, coin.variant, this.rand);
      mesh.position.set(coin.x, this.config.machine.bed.topY + 0.09 + this.rampLift(coin.z), coin.z);
      mesh.rotation.y = coin.rot;
      this.scene.add(mesh);
      this.coinMeshes.set(coin.id, mesh);
    }
    syncPusher(this.machine, this.pusherFront(), this.config);
  }

  initCameraControls() {
    const el = this.renderer.domElement;
    const state = this.cameraState;
    const cam = this.config.machine.camera;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      state.dragging = true;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      state.pointerId = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('is-grabbing');
    });

    el.addEventListener('pointermove', (e) => {
      if (!state.dragging || e.pointerId !== state.pointerId) return;
      const dx = e.clientX - state.lastX;
      const dy = e.clientY - state.lastY;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      state.targetAzimuth = clamp(
        state.targetAzimuth - dx * 0.005,
        cam.minAzimuthDeg * DEG,
        cam.maxAzimuthDeg * DEG
      );
      state.targetElevation = clamp(
        state.targetElevation + dy * 0.004,
        cam.minElevationDeg * DEG,
        cam.maxElevationDeg * DEG
      );
    });

    const end = (e) => {
      if (e.pointerId !== undefined && e.pointerId !== state.pointerId) return;
      state.dragging = false;
      state.pointerId = null;
      el.classList.remove('is-grabbing');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', (e) => {
      if (e.buttons === 0) end(e);
    });
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // 竖屏时镜头目标下移，抵消 3D 纵深造成的“机台偏下”，让画面更居中
    const portrait = h / w > 1.15;
    this.target.copy(this.baseTarget);
    if (portrait) this.target.y -= 0.82;

    const cam = this.config.machine.camera;
    const vFov = cam.fov * DEG;
    const distV = cam.fitHeight / (2 * Math.tan(vFov / 2));
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distH = cam.fitWidth / (2 * Math.tan(hFov / 2));
    this.cameraState.radius = Math.max(distV, distH) * 1.03;
    this.updateCamera(1);
  }

  updateCamera(snap = 0) {
    const s = this.cameraState;
    const k = snap >= 1 ? 1 : 1 - Math.pow(0.001, Math.min(0.05, snap || 1 / 60));
    s.azimuth = lerp(s.azimuth, s.targetAzimuth, k);
    s.elevation = lerp(s.elevation, s.targetElevation, k);

    const idle = Math.sin(this.visualTime * 0.36) * 0.006 + Math.sin(this.visualTime * 0.21) * 0.003;
    const az = s.azimuth + (this.paused ? 0 : idle);
    const el = s.elevation;
    const r = s.radius;
    const shake = this.shake;
    const sx = shake ? (this.rand() - 0.5) * shake : 0;
    const sy = shake ? (this.rand() - 0.5) * shake : 0;

    const cx = this.target.x + Math.cos(el) * Math.sin(az) * r + sx;
    const cy = this.target.y + Math.sin(el) * r + sy;
    const cz = this.target.z + Math.cos(el) * Math.cos(az) * r;

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
  }

  queueDrop() {
    if (!this.active) {
      // 静止时推板停在 idleFrontZ，物理层的 prevFront 还停在初始沉降位置；
      // 先对齐，避免激活首帧产生一个不真实的巨大推板速度，把整床币弹飞。
      this.physics.prevFront = this.pusherFront();
      this.active = true;
      this.machineTime = this.pusherStartTimeForIdle();
    }
    this.physics.queueAssist();
    this.dropQueue.push(true);
    this.dropCooldown = Math.min(this.dropCooldown, 0.05);
  }

  get coinRestY() {
    return this.config.machine.bed.topY + 0.09;
  }

  get plateCoinY() {
    return this.config.machine.bed.topY + (this.config.machine.pusher.height ?? 0.5) + 0.09;
  }

  rampLift(z) {
    const ramp = this.config.machine.bed.ramp;
    if (!ramp) return 0;
    const t = clamp((z - ramp.startZ) / (ramp.endZ - ramp.startZ), 0, 1);
    return t * ramp.rise;
  }

  spawnDropCoin() {
    const drop = this.config.machine.drop;
    const { xRange, zRange } = drop;
    const x = xRange[0] + this.rand() * (xRange[1] - xRange[0]);
    const z = zRange[0] + this.rand() * (zRange[1] - zRange[0]);
    const mesh = makeNuggetMesh(this.nuggetGeoms, this.nuggetMaterial, Math.floor(this.rand() * 3), this.rand, 1.02);
    mesh.position.set(x, 5.15, z);
    mesh.rotation.y = this.rand() * Math.PI * 2;
    mesh.castShadow = true;
    this.scene.add(mesh);

    // 落点正好在推板上方：判断落到推板顶，还是落到币台。
    const predictedFront = this.active
      ? pusherFrontAt(this.machineTime + drop.flightSec, this.config.machine)
      : this.config.machine.pusher.frontMinZ;
    const willLandOnPlate = predictedFront > z + 0.025;

    this.dropAnims.push({
      mesh,
      x,
      z,
      t: 0,
      dur: drop.flightSec,
      startY: 5.15,
      targetY: willLandOnPlate ? this.plateCoinY : this.coinRestY,
      willLandOnPlate,
    });
  }

  updateDrops(dt) {
    this.dropCooldown -= dt;
    if (this.dropQueue.length > 0 && this.dropCooldown <= 0 && this.dropAnims.length === 0) {
      // 投币口在推板上方靠前的位置：等推板伸展到落点下方再释放，
      // 避免推板正在回撤时币直接掉到币台，保证“先落推板”的体验。
      const drop = this.config.machine.drop;
      const predictedFront = this.active
        ? pusherFrontAt(this.machineTime + drop.flightSec, this.config.machine)
        : this.config.machine.pusher.frontMinZ;
      if (predictedFront < drop.zRange[1] + 0.04) return;
      this.dropQueue.shift();
      this.spawnDropCoin();
      this.dropCooldown = this.config.machine.drop.queueGapMs / 1000;
    }

    for (let i = this.dropAnims.length - 1; i >= 0; i--) {
      const a = this.dropAnims[i];
      a.t += dt;
      const p = clamp(a.t / a.dur, 0, 1);
      const ease = p * p;
      a.mesh.position.y = lerp(a.startY, a.targetY, ease);
      a.mesh.rotation.x = p * Math.PI * 2.2;
      a.mesh.rotation.y += dt * 5.5;
      if (p >= 1) {
        this.dropAnims.splice(i, 1);
        this.landDropCoin(a);
      }
    }
  }

  removeLandBounce(mesh) {
    const idx = this.landBounces.findIndex((b) => b.mesh === mesh);
    if (idx < 0) return;
    const b = this.landBounces[idx];
    b.mesh.position.y = b.baseY;
    b.mesh.scale.copy(b.baseScale);
    this.landBounces.splice(idx, 1);
  }

  landDropCoin(anim) {
    const front = this.pusherFront();
    const z = anim.z;
    const onPlate = front > z + 0.025;

    if (onPlate) {
      anim.mesh.position.y = this.plateCoinY;
      this.landCoinOnPlate(anim.mesh, anim.x, z);
      return;
    }

    // 极少数情况下预测是推板上、落地时推板刚好收回：补一段从推板到币台的下落。
    if (anim.willLandOnPlate) {
      this.startPlateFall(anim.mesh, anim.x, z, front);
      return;
    }

    this.landCoinOnBed(anim.mesh, anim.x, z, front);
  }

  landCoinOnBed(mesh, x, z, front) {
    const r = this.config.machine.coin.radius;
    const safeZ = Math.max(z, front + r + 0.025);
    const body = this.physics.addCoin(x, safeZ, {
      rot: this.rand() * Math.PI * 2,
      spin: (this.rand() - 0.5) * 2.5,
      variant: Math.floor(this.rand() * 3),
    });
    mesh.position.set(body.x, this.coinRestY, body.z);
    mesh.rotation.x = 0;
    this.coinMeshes.set(body.id, mesh);
    this.landBounces.push({
      mesh,
      t: 0,
      dur: 0.32,
      baseY: mesh.position.y,
      baseScale: mesh.scale.clone(),
    });
    this.spawnRing(mesh.position, 0xffd064, 0.9, 0.38);
    this.burst(mesh.position, 5, 0xffcf5a, 0.9);
    this.shake = Math.max(this.shake, 0.025);
    this.callbacks.onCoinLanded?.({ kind: 'bed', body });
  }

  landCoinOnPlate(mesh, x, z) {
    // 同一块推板上可能有几枚币，横向稍微让开，避免完全重叠。
    let px = x;
    for (const p of this.plateCoins) {
      if (Math.abs(p.x - px) < 0.42) {
        px += px >= p.x ? 0.32 : -0.32;
      }
    }
    px = clamp(px, -2.1, 2.1);

    mesh.position.set(px, this.plateCoinY, z);
    mesh.rotation.x = 0;
    this.plateCoins.push({ mesh, x: px, z, age: 0, held: false });

    this.landBounces.push({
      mesh,
      t: 0,
      dur: 0.32,
      baseY: this.plateCoinY,
      baseScale: mesh.scale.clone(),
    });
    this.spawnRing(
      mesh.position,
      0xfff0c0,
      0.9,
      0.36,
      this.config.machine.bed.topY + (this.config.machine.pusher.height ?? 0.5) + 0.02
    );
    this.burst(mesh.position, 4, 0xffcf5a, 0.7);
    this.shake = Math.max(this.shake, 0.018);
    this.callbacks.onCoinLanded?.({ kind: 'plate' });
  }

  startPlateFall(mesh, x, z, front) {
    this.removeLandBounce(mesh);
    const r = this.config.machine.coin.radius;
    const targetZ = Math.max(z, front + r - 0.02);
    this.plateFalls.push({
      mesh,
      x,
      z0: z,
      z1: targetZ,
      y0: this.plateCoinY,
      y1: this.coinRestY,
      t: 0,
      dur: 0.24,
    });
  }

  updatePlateCoins(dt = this.config.machine.physics.fixedDt) {
    if (!this.active) return;
    const front = this.pusherFront();
    const delta = this.lastPlateFront === null ? 0 : front - this.lastPlateFront;
    this.lastPlateFront = front;

    const baffle = this.config.machine.baffle;
    const r = this.config.machine.coin.radius;
    // 挡板在币的后方：币中心停在挡板前侧（更大 z 一侧）。
    const stopZ = baffle ? baffle.z + r + (baffle.holdOffset ?? 0.01) : -Infinity;

    for (let i = this.plateCoins.length - 1; i >= 0; i--) {
      const p = this.plateCoins[i];
      p.age = (p.age ?? 0) + dt;

      // 关键：币在推板上跟着推板一起前后运动，而不是原地不动。
      if (delta !== 0 && !p.held) {
        p.z = clamp(p.z + delta * 0.95, front - 1.04, front - 0.02);
      }

      // 推板回撤时，币跟着后退，撞到后方的固定挡板后停住；
      // 推板继续回撤，币失去支撑，从推板前缘滑落到币台。
      if (baffle && !p.held && delta < 0 && p.z <= stopZ) {
        p.z = stopZ;
        p.held = true;
      }
      if (p.held) {
        p.z = stopZ;
        p.mesh.position.z = p.z;
      } else {
        p.mesh.position.z = p.z;
      }

      if (front < p.z + 0.02) {
        this.plateCoins.splice(i, 1);
        this.startPlateFall(p.mesh, p.x, p.z, front);
      }
    }
  }

  updatePlateFalls(dt) {
    for (let i = this.plateFalls.length - 1; i >= 0; i--) {
      const a = this.plateFalls[i];
      a.t += dt;
      const p = clamp(a.t / a.dur, 0, 1);
      a.mesh.position.x = a.x;
      a.mesh.position.z = lerp(a.z0, a.z1, p);
      a.mesh.position.y = lerp(a.y0, a.y1, p * p);
      a.mesh.rotation.x = Math.sin(p * Math.PI) * 0.3;
      a.mesh.rotation.y += dt * 3;
      if (p >= 1) {
        this.plateFalls.splice(i, 1);
        const body = this.physics.addCoin(a.x, a.z1, {
          rot: this.rand() * Math.PI * 2,
          spin: (this.rand() - 0.5) * 2.5,
          variant: Math.floor(this.rand() * 3),
        });
        a.mesh.position.set(body.x, this.coinRestY, body.z);
        a.mesh.rotation.x = 0;
        this.coinMeshes.set(body.id, a.mesh);
        this.landBounces.push({
          mesh: a.mesh,
          t: 0,
          dur: 0.28,
          baseY: this.coinRestY,
          baseScale: a.mesh.scale.clone(),
        });
        this.spawnRing(a.mesh.position, 0xffd064, 0.75, 0.32);
        this.burst(a.mesh.position, 4, 0xffcf5a, 0.7);
        this.shake = Math.max(this.shake, 0.015);
        this.callbacks.onCoinLanded?.({ kind: 'bed-from-plate', body });
      }
    }
  }

  pusherFront() {
    if (!this.active) {
      const idle = Math.sin(this.visualTime * 1.6) * 0.006;
      return (this.config.machine.pusher.idleFrontZ ?? this.config.machine.pusher.frontMinZ) + idle;
    }
    return pusherFrontAt(this.machineTime, this.config.machine);
  }

  pusherStartTimeForIdle() {
    const p = this.config.machine.pusher;
    const target = p.idleFrontZ ?? p.frontMinZ;
    let bestT = 0;
    let bestDiff = Infinity;
    for (let i = 0; i <= 400; i++) {
      const phase = i / 400;
      if (phase < p.extendStart || phase > p.retractStart) continue;
      const t = phase * p.cycleSec;
      const diff = Math.abs(pusherFrontAt(t, this.config.machine) - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestT = t;
      }
    }
    return bestT;
  }

  stepMachine(dt) {
    if (this.paused) return;
    if (this.active) this.machineTime += dt;
    const front = this.pusherFront();
    syncPusher(this.machine, front, this.config);

    if (!this.active) return;

    this.accumulator += dt;
    const fixed = this.config.machine.physics.fixedDt;
    let guard = 0;
    while (this.accumulator >= fixed && guard < 8) {
      const events = this.physics.step(fixed, front);
      this.accumulator -= fixed;
      guard++;
      if (events.length) this.handleEvents(events);
    }

    for (const [id, mesh] of this.coinMeshes) {
      const body = this.physics.coins.find((c) => c.id === id);
      if (!body) continue;
      mesh.position.x = body.x;
      mesh.position.z = body.z;
      mesh.position.y = this.coinRestY + this.rampLift(body.z);
      mesh.rotation.y = body.rot;
    }

    // 大奖盒也要跟随物理位置：让玩家看到它被币堆一点点推向前。
    if (!this.jackpotAnim && !this.physics.box.fallen && this.jackpotGroup.visible) {
      this.jackpotGroup.position.x = this.physics.box.x;
      this.jackpotGroup.position.y = this.config.machine.bed.topY + 0.005 + this.rampLift(this.physics.box.z);
      this.jackpotGroup.position.z = this.physics.box.z;
      this.jackpotGroup.rotation.z = -this.physics.box.vx * 0.03;
      this.jackpotGroup.rotation.x = this.physics.box.vz * 0.02;
    }
  }

  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'coin') {
        this.onCoinFall(ev.coin);
      } else if (ev.type === 'jackpot') {
        this.onJackpotFall();
      } else if (ev.type === 'assist') {
        this.shake = Math.max(this.shake, 0.018);
        this.callbacks.onAssist?.();
      }
    }
  }

  onCoinFall(coin) {
    const mesh = this.coinMeshes.get(coin.id);
    if (mesh) {
      this.coinMeshes.delete(coin.id);
      const bounceIndex = this.landBounces.findIndex((b) => b.mesh === mesh);
      if (bounceIndex >= 0) {
        const b = this.landBounces[bounceIndex];
        b.mesh.position.y = b.baseY;
        b.mesh.scale.copy(b.baseScale);
        this.landBounces.splice(bounceIndex, 1);
      }
      const screen = this.projectToClient(mesh.position);
      this.fallAnims.push({
        mesh,
        t: 0,
        dur: 0.58,
        x0: mesh.position.x,
        y0: mesh.position.y,
        z0: mesh.position.z,
        spin: (this.rand() - 0.5) * 7,
      });
      this.spawnRing(mesh.position, 0xffe08a, 1.2, 0.4);
      this.burst(mesh.position, 7, 0xffc947, 1.5);
      this.shake = Math.max(this.shake, 0.045);
      this.callbacks.onCoinDropped?.({ screen, world: mesh.position.clone() });
    }
  }

  onJackpotFall() {
    if (this.jackpotAnim) return;
    this.jackpotWon = true;
    this.jackpotAnim = { t: 0, dur: 1.35, called: false };
    this.shake = 0.11;
    this.callbacks.onJackpotStart?.();
  }

  updateFallAnims(dt) {
    for (let i = this.landBounces.length - 1; i >= 0; i--) {
      const b = this.landBounces[i];
      b.t += dt;
      const p = clamp(b.t / b.dur, 0, 1);
      const bounce = Math.abs(Math.sin(p * Math.PI * 2)) * (1 - p);
      b.mesh.position.y = b.baseY + bounce * 0.055;
      b.mesh.scale.set(
        b.baseScale.x * (1 - bounce * 0.06),
        b.baseScale.y * (1 + bounce * 0.1),
        b.baseScale.z * (1 - bounce * 0.06)
      );
      if (p >= 1) {
        b.mesh.position.y = b.baseY;
        b.mesh.scale.copy(b.baseScale);
        this.landBounces.splice(i, 1);
      }
    }

    for (let i = this.fallAnims.length - 1; i >= 0; i--) {
      const a = this.fallAnims[i];
      a.t += dt;
      const p = clamp(a.t / a.dur, 0, 1);
      a.mesh.position.x = a.x0 + Math.sin(p * Math.PI) * 0.06;
      a.mesh.position.z = a.z0 + p * 0.62;
      a.mesh.position.y = a.y0 - p * p * 0.85;
      a.mesh.rotation.x = p * a.spin;
      a.mesh.rotation.z = p * a.spin * 0.4;
      const s = 1 - p * 0.45;
      a.mesh.scale.multiplyScalar(Math.pow(s, dt * 2));
      if (p >= 1) {
        this.scene.remove(a.mesh);
        a.mesh.scale.setScalar(1);
        this.fallAnims.splice(i, 1);
      }
    }
  }

  updateJackpotVisuals(t, force = false) {
    const g = this.jackpotGroup;
    if (!g || (!g.visible && !force)) return;
    const data = g.userData;
    data.lidPivot.rotation.x = -0.13 + Math.sin(t * 1.7) * 0.035;
    data.ring.material.opacity = 0.4 + Math.sin(t * 2.2) * 0.16;
    const sign = data.sign;
    sign.position.y = 1.32 + Math.sin(t * 1.8) * 0.045;
    sign.quaternion.copy(this.camera.quaternion);
    data.sparkles.children.forEach((s) => {
      const phase = t * 0.9 + s.userData.phase;
      const r = s.userData.radius;
      s.position.set(Math.cos(phase) * r, 0.7 + Math.sin(phase * 1.7) * 0.32, Math.sin(phase) * r * 0.65);
      s.rotation.y += 0.01;
      s.rotation.x += 0.008;
      s.scale.setScalar(0.8 + Math.sin(phase * 2.3) * 0.3);
    });
    data.light.intensity = 3.2 + Math.sin(t * 2.4) * 0.9;
  }

  updateJackpotAnim(dt) {
    if (!this.jackpotAnim) return;
    const a = this.jackpotAnim;
    a.t += dt;
    const p = clamp(a.t / a.dur, 0, 1);
    const lift = Math.sin(p * Math.PI * 0.85) * 1.25;
    const g = this.jackpotGroup;
    g.position.set(
      this.physics.box.x + Math.sin(p * Math.PI) * 0.15,
      this.config.machine.bed.topY + 0.005 + lift,
      this.physics.box.z + 0.55 * p
    );
    g.rotation.z = Math.sin(p * Math.PI * 2) * 0.14 + p * 0.05;
    g.rotation.x = Math.sin(p * Math.PI) * 0.22;
    const scale = 1 + Math.sin(p * Math.PI) * 0.25;
    g.scale.setScalar(scale);
    g.userData.lidPivot.rotation.x = -0.13 - p * 0.7;
    this.shake = Math.max(this.shake, 0.04 * (1 - p));
    if (p >= 0.55 && !a.called) {
      a.called = true;
      this.jackpotWonAt = this.visualTime;
      this.burst(g.position.clone().setY(g.position.y + 0.6), 38, 0xffc533, 3.2);
      this.callbacks.onJackpot?.();
    }
    if (p >= 1) {
      g.visible = false;
      this.ghostGroup.visible = true;
      this.jackpotAnim = null;
    }
  }

  spawnRing(position, color, maxScale, dur, y = this.config.machine.bed.topY + 0.02) {
    const geo = new THREE.RingGeometry(0.12, 0.19, 28);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(position.x, y, position.z);
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.rings.push({ mesh, t: 0, dur, maxScale });
  }

  updateRings(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const p = clamp(r.t / r.dur, 0, 1);
      r.mesh.scale.setScalar(1 + p * r.maxScale * 3);
      r.mesh.material.opacity = 0.75 * (1 - p);
      if (p >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  burst(position, count, color, speed, up = true) {
    const group = new THREE.Group();
    const geo = new THREE.OctahedronGeometry(0.035, 0);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const parts = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.position.copy(position);
      const a = this.rand() * Math.PI * 2;
      const s = (0.5 + this.rand() * 0.8) * speed;
      parts.push({
        mesh: m,
        vx: Math.cos(a) * s,
        vy: (up ? 0.7 : 0.2) * speed + this.rand() * 0.8,
        vz: Math.sin(a) * s,
        rot: this.rand() * 6,
      });
      group.add(m);
    }
    group.userData.parts = parts;
    group.userData.life = 0;
    group.userData.maxLife = 0.9;
    this.scene.add(group);
    this.bursts.push(group);
  }

  updateBursts(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const group = this.bursts[i];
      group.userData.life += dt;
      const p = group.userData.life / group.userData.maxLife;
      for (const part of group.userData.parts) {
        part.mesh.position.x += part.vx * dt;
        part.mesh.position.y += part.vy * dt;
        part.mesh.position.z += part.vz * dt;
        part.vy -= 5.5 * dt;
        part.vx *= 0.985;
        part.vz *= 0.985;
        part.mesh.rotation.x += part.rot * dt;
        part.mesh.rotation.y += part.rot * 1.3 * dt;
        part.mesh.material.opacity = Math.max(0, 1 - p);
      }
      if (p >= 1) {
        for (const part of group.userData.parts) part.mesh.material.dispose();
        this.scene.remove(group);
        this.bursts.splice(i, 1);
      }
    }
  }

  updateAmbient(dt) {
    // 跑马灯
    for (const bulb of this.machine.userData.bulbs) {
      const on = 0.5 + 0.5 * Math.sin(this.visualTime * 3.2 + bulb.userData.phase);
      bulb.material.emissiveIntensity = 0.7 + on * 1.9;
      bulb.scale.setScalar(0.88 + on * 0.2);
    }
    // 浮尘
    const pos = this.dust.geometry.attributes.position;
    for (let i = 0; i < this.dustSeeds.length; i++) {
      const seed = this.dustSeeds[i];
      pos.setY(i, seed.y + Math.sin(this.visualTime * seed.speed + seed.phase) * 0.18);
    }
    pos.needsUpdate = true;
    this.dust.rotation.y = this.visualTime * 0.015;

    // 大奖盒的光效
    if (this.jackpotGroup.visible) {
      this.updateJackpotVisuals(this.visualTime);
    }
    if (this.ghostGroup.visible) {
      this.ghostGroup.userData.star.rotation.y = this.visualTime * 0.8;
      this.ghostGroup.userData.star.position.y = 0.55 + Math.sin(this.visualTime * 1.6) * 0.06;
      this.ghostGroup.userData.ring.material.opacity = 0.35 + Math.sin(this.visualTime * 2) * 0.15;
    }
    this.shake *= Math.exp(-8 * dt);
    if (this.shake < 0.001) this.shake = 0;
  }

  projectToClient(vec) {
    const v = vec.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      clientX: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      clientY: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      visible: v.z < 1,
    };
  }

  updateLabels() {
    const s = this.cameraState;
    const points = [
      { id: 'slot', world: new THREE.Vector3(-1.16, 4.42, this.config.machine.drop.slotZ) },
      { id: 'exit', world: new THREE.Vector3(1.38, 1.34, 3.14) },
    ];
    const rect = this.renderer.domElement.getBoundingClientRect();
    const labels = {};
    for (const p of points) {
      const v = p.world.clone().project(this.camera);
      labels[p.id] = {
        x: (v.x * 0.5 + 0.5) * rect.width,
        y: (-v.y * 0.5 + 0.5) * rect.height,
        visible: v.z < 1 && v.x > -1.15 && v.x < 1.15 && v.y > -1.15 && v.y < 1.15,
      };
    }
    this.callbacks.onLabels?.(labels);
  }

  loop(now) {
    if (this.destroyed) return;
    const dt = Math.min(0.045, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.visualTime += dt;

    // 拖拽后的相机缓动
    this.cameraState.targetAzimuth = clamp(
      this.cameraState.targetAzimuth,
      this.config.machine.camera.minAzimuthDeg * DEG,
      this.config.machine.camera.maxAzimuthDeg * DEG
    );
    this.updateCamera(dt);
    this.updateAmbient(dt);
    this.updateRings(dt);
    this.updateBursts(dt);

    if (!this.paused) {
      this.updateDrops(dt);
      this.updateFallAnims(dt);
      this.stepMachine(dt);
      this.updatePlateCoins(dt);
      this.updatePlateFalls(dt);
      this.updateJackpotAnim(dt);
      syncPusher(this.machine, this.pusherFront(), this.config);
    }

    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
    if (!this._ready) {
      this._ready = true;
      this.callbacks.onReady?.();
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ---------------- 调试接口 ---------------- */
  /**
   * 以 60fps 固定步长快进整台机器（含落币、推板、落板、挡板、斜坡、物理）。
   * 仅供开发/验收使用；不渲染，所以能绕开无头浏览器低帧率。
   */
  simulateFor(seconds = 30) {
    const step = 1 / 60;
    const steps = Math.floor(seconds / step);
    const wasPaused = this.paused;
    this.paused = false;
    let simulated = 0;
    for (let i = 0; i < steps; i++) {
      this.visualTime += step;
      this.updateDrops(step);
      this.updateFallAnims(step);
      this.stepMachine(step);
      this.updatePlateCoins(step);
      this.updatePlateFalls(step);
      this.updateJackpotAnim(step);
      syncPusher(this.machine, this.pusherFront(), this.config);
      simulated += step;
      if (this.paused) break; // 中奖弹层等会暂停世界
    }
    if (!wasPaused && !this.paused) this.paused = false;
    return { simulated };
  }

  fastForward(seconds = 30) {
    const fixed = this.config.machine.physics.fixedDt;
    const steps = Math.floor(seconds / fixed);
    this.active = true;
    for (let i = 0; i < steps; i++) {
      this.machineTime += fixed;
      const front = pusherFrontAt(this.machineTime, this.config.machine);
      const events = this.physics.step(fixed, front);
      this.handleEvents(events);
    }
    syncPusher(this.machine, this.pusherFront(), this.config);
    for (const [id, mesh] of this.coinMeshes) {
      const body = this.physics.coins.find((c) => c.id === id);
      if (body) {
        mesh.position.set(body.x, this.config.machine.bed.topY + 0.09, body.z);
        mesh.rotation.y = body.rot;
      }
    }
  }

  forceJackpot() {
    if (this.jackpotWon) return false;
    this.active = true;
    this.physics.box.z = this.config.machine.jackpot.fallZ - 0.01;
    this.physics.box.vz = 0.4;
    return true;
  }

  respawnJackpot() {
    // 新的大奖箱：先让商店状态已复位，再把箱子放回初始位置。
    this.jackpotAnim = null;
    this.jackpotWon = false;
    this.jackpotWonAt = 0;
    this.ghostGroup.visible = false;
    this.physics.box = this.physics.createBox();

    // 清理落点附近重叠的场内币，避免新箱子把币直接顶飞。
    const b = this.physics.box;
    const r = this.config.machine.coin.radius;
    for (let i = this.physics.coins.length - 1; i >= 0; i--) {
      const c = this.physics.coins[i];
      const nx = clamp(c.x, b.x - b.halfW, b.x + b.halfW);
      const nz = clamp(c.z, b.z - b.halfD, b.z + b.halfD);
      if (Math.hypot(c.x - nx, c.z - nz) < r + 0.03) {
        this.physics.coins.splice(i, 1);
        const mesh = this.coinMeshes.get(c.id);
        if (mesh) {
          this.scene.remove(mesh);
          this.coinMeshes.delete(c.id);
        }
      }
    }

    const g = this.jackpotGroup;
    g.visible = true;
    g.position.set(
      this.config.machine.jackpot.x,
      this.config.machine.bed.topY + 0.005,
      this.config.machine.jackpot.z
    );
    g.scale.setScalar(1);
    g.rotation.set(0, 0, 0);
    g.userData.lidPivot.rotation.x = -0.13;
    this.spawnRing(g.position, 0xfff0c0, 1.4, 0.5, this.config.machine.bed.topY + 0.03);
    this.burst(g.position.clone().setY(g.position.y + 0.4), 18, 0xffc533, 1.8);
    this.shake = Math.max(this.shake, 0.03);
    return true;
  }

  resetMachine() {
    for (const mesh of this.coinMeshes.values()) this.scene.remove(mesh);
    for (const p of this.plateCoins) this.scene.remove(p.mesh);
    for (const a of this.plateFalls) this.scene.remove(a.mesh);
    for (const a of this.fallAnims) this.scene.remove(a.mesh);
    for (const a of this.dropAnims) this.scene.remove(a.mesh);
    for (const r of this.rings) this.scene.remove(r.mesh);
    for (const g of this.bursts) this.scene.remove(g);
    this.coinMeshes.clear();
    this.plateCoins = [];
    this.plateFalls = [];
    this.lastPlateFront = null;
    this.fallAnims = [];
    this.dropAnims = [];
    this.dropQueue = [];
    this.landBounces = [];
    this.rings = [];
    this.bursts = [];
    this.jackpotAnim = null;
    this.jackpotWon = false;
    this.jackpotWonAt = 0;
    this.active = false;
    this.machineTime = 0;
    this.accumulator = 0;
    this.paused = false;
    this.physics.reset();
    this.physics.seedInitialCoins(mulberry32(this.config.machine.physics.initialSeed));
    for (const coin of this.physics.coins) {
      const mesh = makeNuggetMesh(this.nuggetGeoms, this.nuggetMaterial, coin.variant, this.rand);
      mesh.position.set(coin.x, this.config.machine.bed.topY + 0.09 + this.rampLift(coin.z), coin.z);
      mesh.rotation.y = coin.rot;
      this.scene.add(mesh);
      this.coinMeshes.set(coin.id, mesh);
    }
    this.jackpotGroup.visible = true;
    this.jackpotGroup.position.set(
      this.config.machine.jackpot.x,
      this.config.machine.bed.topY + 0.005,
      this.config.machine.jackpot.z
    );
    this.jackpotGroup.scale.setScalar(1);
    this.jackpotGroup.rotation.set(0, 0, 0);
    this.ghostGroup.visible = false;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
