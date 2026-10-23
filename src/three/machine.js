import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  makeMarqueeTexture,
  makeBedTexture,
  makeRampTexture,
  makeGlassGlareTexture,
  makeStarShape,
} from './assets.js';

/**
 * 搭建低模推币机。所有尺寸与 config.machine 的玩法尺寸对齐。
 * 返回可动部件（推板、跑马灯）供 World 每帧驱动。
 */
export function createMachine(config, materials) {
  const machine = new THREE.Group();
  const bedTop = config.machine.bed.topY;
  const bedW = config.machine.bed.width;
  const bedBack = config.machine.bed.backZ;
  const bedFront = config.machine.bed.frontZ;
  const bedDepth = bedFront - bedBack;
  const bedCenterZ = (bedFront + bedBack) / 2;

  const box = (w, h, d, mat, r = 0.08) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  /* ---------------- 底座 ---------------- */
  const cabinet = box(6.25, 1.35, 5.7, materials.red, 0.18);
  cabinet.position.set(0, 0.75, 0.05);
  machine.add(cabinet);

  const cabinetBand = box(6.35, 0.24, 5.8, materials.yellow, 0.1);
  cabinetBand.position.set(0, 0.24, 0.05);
  machine.add(cabinetBand);

  const frontPanel = box(4.7, 0.78, 0.1, materials.cream, 0.12);
  frontPanel.position.set(0, 0.6, 2.92);
  machine.add(frontPanel);

  const starGeo = new THREE.ExtrudeGeometry(makeStarShape(0.22, 0.095, 5), {
    depth: 0.05,
    bevelEnabled: true,
    bevelSize: 0.02,
    bevelThickness: 0.02,
    bevelSegments: 1,
  });
  starGeo.center();
  const frontStar = new THREE.Mesh(starGeo, materials.deepRed);
  frontStar.position.set(0, 0.62, 2.99);
  machine.add(frontStar);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 10), materials.deepRed);
      foot.position.set(sx * 2.7, 0.11, sz * 2.15);
      foot.castShadow = true;
      machine.add(foot);

      const screw = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), materials.metal);
      screw.position.set(sx * 2.2, 0.9, 2.98);
      machine.add(screw);
    }
  }

  // 侧面圆窗装饰
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), materials.yellow);
      disc.rotation.z = Math.PI / 2;
      disc.position.set(sx * 3.14, 0.72, -0.9 + i * 1.8);
      machine.add(disc);
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12), materials.deepRed);
      dot.rotation.z = Math.PI / 2;
      dot.position.set(sx * 3.17, 0.72, -0.9 + i * 1.8);
      machine.add(dot);
    }
  }

  /* ---------------- 币台 ---------------- */
  const bedBase = box(bedW + 0.35, 0.4, bedDepth + 0.3, materials.deepRed, 0.12);
  bedBase.position.set(0, bedTop - 0.18, bedCenterZ);
  machine.add(bedBase);

  const bedTexture = makeBedTexture();
  const bedTopMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(bedW, bedDepth),
    new THREE.MeshStandardMaterial({ map: bedTexture, roughness: 0.78, metalness: 0 })
  );
  bedTopMesh.rotation.x = -Math.PI / 2;
  bedTopMesh.position.set(0, bedTop + 0.005, bedCenterZ);
  bedTopMesh.receiveShadow = true;
  machine.add(bedTopMesh);

  // 前缘金色压条
  const lip = box(bedW + 0.12, 0.07, 0.12, materials.gold, 0.035);
  lip.position.set(0, bedTop + 0.02, bedFront + 0.02);
  machine.add(lip);

  // 币台末端的向上斜坡：币要爬坡才能掉进托盘
  const rampCfg = config.machine.bed.ramp;
  if (rampCfg) {
    const rampDepth = rampCfg.endZ - rampCfg.startZ;
    const angle = Math.atan2(rampCfg.rise, rampDepth);
    const rampTex = makeRampTexture();
    rampTex.wrapS = THREE.RepeatWrapping;
    rampTex.wrapT = THREE.RepeatWrapping;
    rampTex.repeat.set(3, 1);
    const rampMat = new THREE.MeshStandardMaterial({ map: rampTex, roughness: 0.55, metalness: 0.02 });
    const rampSlab = box(bedW, 0.07, rampDepth / Math.cos(angle) + 0.04, rampMat, 0.03);
    rampSlab.rotation.x = -angle;
    rampSlab.position.set(0, bedTop + rampCfg.rise / 2 + 0.035, (rampCfg.startZ + rampCfg.endZ) / 2);
    machine.add(rampSlab);
    const rampFront = box(bedW + 0.06, 0.075, 0.09, materials.gold, 0.03);
    rampFront.position.set(0, bedTop + rampCfg.rise + 0.04, rampCfg.endZ);
    machine.add(rampFront);
    const rampFace = box(bedW, rampCfg.rise, 0.05, materials.red, 0.025);
    rampFace.position.set(0, bedTop + rampCfg.rise / 2, rampCfg.endZ + 0.05);
    machine.add(rampFace);
    const rampUnder = box(bedW - 0.12, 0.1, rampDepth - 0.03, materials.deepRed, 0.03);
    rampUnder.position.set(0, bedTop + 0.02, (rampCfg.startZ + rampCfg.endZ) / 2);
    machine.add(rampUnder);
    for (const sx of [-1, 1]) {
      const cheek = box(0.1, rampCfg.rise * 0.55, rampDepth * 0.75, materials.red, 0.025);
      cheek.rotation.x = -angle * 0.45;
      cheek.position.set(sx * (bedW / 2 - 0.05), bedTop + rampCfg.rise * 0.3, (rampCfg.startZ + rampCfg.endZ) / 2);
      machine.add(cheek);
    }
  }

  // 左右围栏
  for (const sx of [-1, 1]) {
    const rail = box(0.16, 0.42, bedDepth + 0.08, materials.red, 0.06);
    rail.position.set(sx * (bedW / 2 + 0.08), bedTop + 0.18, bedCenterZ);
    machine.add(rail);
    const railTop = box(0.22, 0.09, bedDepth + 0.1, materials.yellow, 0.04);
    railTop.position.set(sx * (bedW / 2 + 0.08), bedTop + 0.43, bedCenterZ);
    machine.add(railTop);
  }

  // 后墙 + 推板收纳仓
  const backWall = box(bedW + 0.3, 0.95, 0.2, materials.red, 0.07);
  backWall.position.set(0, bedTop + 0.45, bedBack - 0.02);
  machine.add(backWall);

  const housing = box(5.25, 0.95, 1.35, materials.cream, 0.14);
  housing.position.set(0, bedTop + 0.42, -1.52);
  machine.add(housing);
  const housingTrim = box(5.3, 0.13, 1.4, materials.yellow, 0.05);
  housingTrim.position.set(0, bedTop + 0.93, -1.52);
  machine.add(housingTrim);
  const housingLip = box(5.0, 0.3, 0.12, materials.deepRed, 0.05);
  housingLip.position.set(0, bedTop + 0.68, -0.83);
  machine.add(housingLip);

  /* ---------------- 推板上方的固定挡板 ---------------- */
  const baffleCfg = config.machine.baffle;
  if (baffleCfg) {
    const baffle = new THREE.Group();
    const baffleBar = box(baffleCfg.width, baffleCfg.height, 0.09, materials.red, 0.035);
    baffleBar.position.set(0, baffleCfg.bottomY + baffleCfg.height / 2, baffleCfg.z);
    baffle.add(baffleBar);
    const baffleLip = box(baffleCfg.width + 0.05, 0.055, 0.11, materials.gold, 0.02);
    baffleLip.position.set(0, baffleCfg.bottomY + 0.025, baffleCfg.z);
    baffle.add(baffleLip);
    // 挡板从后方机架/后墙伸出，不再像一道横在前面的栏杆
    const rearZ = -0.72;
    const armLen = baffleCfg.z - rearZ;
    for (const sx of [-1, 1]) {
      const arm = box(0.06, 0.06, armLen, materials.metal, 0.02);
      arm.position.set(sx * (baffleCfg.width / 2 - 0.06), baffleCfg.bottomY + baffleCfg.height + 0.01, (baffleCfg.z + rearZ) / 2);
      baffle.add(arm);
      const post = box(0.08, 0.22, 0.08, materials.deepRed, 0.02);
      post.position.set(sx * (baffleCfg.width / 2 - 0.06), baffleCfg.bottomY + baffleCfg.height + 0.1, rearZ);
      baffle.add(post);
    }
    machine.add(baffle);
    machine.userData.baffle = baffle;
  }

  /* ---------------- 推板 ---------------- */
  const pusher = new THREE.Group();
  const pusherBody = box(config.machine.pusher.width, 0.5, config.machine.pusher.depth, materials.pusher, 0.12);
  pusherBody.position.y = 0.25;
  pusher.add(pusherBody);

  const pusherFace = box(config.machine.pusher.width + 0.02, 0.4, 0.08, materials.warmWhite, 0.05);
  pusherFace.position.set(0, 0.24, config.machine.pusher.depth / 2 + 0.015);
  pusher.add(pusherFace);

  const pusherTrim = box(config.machine.pusher.width + 0.04, 0.09, 0.1, materials.red, 0.035);
  pusherTrim.position.set(0, 0.47, config.machine.pusher.depth / 2 + 0.02);
  pusher.add(pusherTrim);

  for (let i = -2; i <= 2; i++) {
    const grip = box(0.12, 0.14, 0.5, materials.cream, 0.04);
    grip.position.set(i * 0.9, 0.52, 0.05);
    pusher.add(grip);
  }

  pusher.position.set(0, bedTop, config.machine.pusher.frontMinZ - config.machine.pusher.depth / 2);
  machine.add(pusher);

  // 推杆（收纳仓 -> 推板）
  const rods = [];
  for (const sx of [-1.45, 1.45]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1, 10), materials.metal);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(sx, bedTop + 0.22, -0.8);
    rod.castShadow = true;
    machine.add(rod);
    rods.push(rod);
  }

  /* ---------------- 出口托盘 ---------------- */
  const tray = new THREE.Group();
  tray.position.set(0, 1.15, 2.82);
  machine.add(tray);

  const trayBottom = box(3.6, 0.16, 1.0, materials.deepRed, 0.08);
  trayBottom.position.set(0, -0.3, 0);
  tray.add(trayBottom);
  for (const sx of [-1, 1]) {
    const side = box(0.16, 0.48, 1.05, materials.red, 0.06);
    side.position.set(sx * 1.8, -0.04, 0);
    tray.add(side);
  }
  const trayFront = box(3.7, 0.42, 0.14, materials.yellow, 0.06);
  trayFront.position.set(0, 0.06, 0.5);
  tray.add(trayFront);
  const trayInner = box(3.35, 0.1, 0.8, materials.cream, 0.06);
  trayInner.position.set(0, -0.18, -0.02);
  tray.add(trayInner);
  const trayStar = new THREE.Mesh(starGeo, materials.red);
  trayStar.scale.setScalar(0.8);
  trayStar.position.set(0, 0.08, 0.58);
  tray.add(trayStar);
  // 黑洞出口，增强“掉进去”的视觉
  const trayHole = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 0.5),
    new THREE.MeshBasicMaterial({ color: 0x2a120d, transparent: true, opacity: 0.72 })
  );
  trayHole.rotation.x = -Math.PI / 2;
  trayHole.position.set(0, -0.12, -0.1);
  tray.add(trayHole);

  /* ---------------- 玻璃罩 ---------------- */
  const glassBottom = 1.88;
  const glassTop = 4.48;
  const glassH = glassTop - glassBottom;
  const glassGroup = new THREE.Group();
  machine.add(glassGroup);

  const addGlassPanel = (w, h, pos, rotY = 0) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const panel = new THREE.Mesh(geo, materials.glass);
    panel.position.copy(pos);
    panel.rotation.y = rotY;
    panel.renderOrder = 2;
    glassGroup.add(panel);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), materials.glassEdge);
    edges.position.copy(pos);
    edges.rotation.y = rotY;
    edges.renderOrder = 3;
    glassGroup.add(edges);
    return panel;
  };

  // 正面玻璃（下方留出奖品格口）
  addGlassPanel(bedW + 0.1, glassH, new THREE.Vector3(0, glassBottom + glassH / 2, bedFront + 0.1));
  const frontRail = box(bedW + 0.25, 0.1, 0.14, materials.gold, 0.04);
  frontRail.position.set(0, glassBottom - 0.06, bedFront + 0.1);
  machine.add(frontRail);

  for (const sx of [-1, 1]) {
    addGlassPanel(bedDepth + 0.15, glassH, new THREE.Vector3(sx * (bedW / 2 + 0.08), glassBottom + glassH / 2, bedCenterZ), Math.PI / 2);
  }

  // 玻璃高光：让透明罩真正“被看见”
  const glareTex = makeGlassGlareTexture();
  const frontGlare = new THREE.Mesh(
    new THREE.PlaneGeometry(4.7, 2.45),
    new THREE.MeshBasicMaterial({
      map: glareTex,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  frontGlare.position.set(-0.1, 3.08, bedFront + 0.135);
  frontGlare.renderOrder = 3;
  glassGroup.add(frontGlare);
  for (const sx of [-1, 1]) {
    const sideGlare = new THREE.Mesh(
      new THREE.PlaneGeometry(3.9, 2.15),
      new THREE.MeshBasicMaterial({
        map: glareTex,
        transparent: true,
        opacity: sx > 0 ? 0.1 : 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    sideGlare.position.set(sx * (bedW / 2 + 0.105), 3.05, 0.35);
    sideGlare.rotation.y = Math.PI / 2;
    sideGlare.renderOrder = 3;
    glassGroup.add(sideGlare);
  }

  // 顶面玻璃：四块拼出投币长槽
  const topY = glassTop;
  const slotZ = config.machine.drop.slotZ;
  const slotHalf = 0.22;
  const slotHalfW = 1.25;
  const topPanels = [
    { w: bedW, d: slotZ - slotHalf - bedBack, x: 0, z: bedBack + (slotZ - slotHalf - bedBack) / 2 },
    { w: bedW, d: bedFront - (slotZ + slotHalf), x: 0, z: slotZ + slotHalf + (bedFront - slotZ - slotHalf) / 2 },
    { w: bedW / 2 - slotHalfW, d: slotHalf * 2, x: -(slotHalfW + (bedW / 2 - slotHalfW) / 2), z: slotZ },
    { w: bedW / 2 - slotHalfW, d: slotHalf * 2, x: slotHalfW + (bedW / 2 - slotHalfW) / 2, z: slotZ },
  ];
  for (const p of topPanels) {
    if (p.w <= 0 || p.d <= 0) continue;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), materials.glass);
    panel.rotation.x = -Math.PI / 2;
    panel.position.set(p.x, topY, p.z);
    panel.renderOrder = 2;
    glassGroup.add(panel);
  }

  // 投币长槽的金色边框
  for (const z of [slotZ - slotHalf, slotZ + slotHalf]) {
    const rail = box(slotHalfW * 2 + 0.16, 0.07, 0.055, materials.gold, 0.02);
    rail.position.set(0, topY + 0.02, z);
    machine.add(rail);
  }
  for (const sx of [-1, 1]) {
    const end = box(0.06, 0.07, slotHalf * 2 + 0.06, materials.gold, 0.02);
    end.position.set(sx * (slotHalfW + 0.03), topY + 0.02, slotZ);
    machine.add(end);
  }

  // 玻璃占位立柱
  for (const sx of [-1, 1]) {
    for (const z of [bedBack + 0.02, bedFront + 0.1]) {
      const post = box(0.12, glassH + 0.25, 0.12, materials.red, 0.035);
      post.position.set(sx * (bedW / 2 + 0.1), glassBottom + glassH / 2, z);
      machine.add(post);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), materials.yellow);
      cap.position.set(sx * (bedW / 2 + 0.1), glassTop + 0.12, z);
      machine.add(cap);
    }
  }

  // 顶部后侧横梁
  const topBackRail = box(bedW + 0.3, 0.16, 0.16, materials.red, 0.05);
  topBackRail.position.set(0, glassTop + 0.1, bedBack - 0.02);
  machine.add(topBackRail);

  /* ---------------- 顶部招牌 ---------------- */
  const marquee = new THREE.Group();
  marquee.position.set(0, 5.14, -0.15);
  machine.add(marquee);
  const marqueeBoard = box(5.55, 0.97, 0.27, materials.deepRed, 0.2);
  marqueeBoard.position.z = 0;
  marquee.add(marqueeBoard);
  const marqueeFace = new THREE.Mesh(
    new THREE.PlaneGeometry(5.25, 0.76),
    new THREE.MeshBasicMaterial({ map: makeMarqueeTexture(), transparent: true })
  );
  marqueeFace.position.set(0, 0, 0.14);
  marquee.add(marqueeFace);

  const bulbs = [];
  const bulbGeo = new THREE.SphereGeometry(0.075, 8, 8);
  for (let i = 0; i < 7; i++) {
    for (const sy of [-1, 1]) {
      const b = new THREE.Mesh(bulbGeo, materials.bulb);
      b.position.set(-2.33 + i * 0.777, sy * 0.455, 0.165);
      marquee.add(b);
      bulbs.push(b);
    }
  }

  for (const sx of [-1, 1]) {
    const support = box(0.14, 0.6, 0.14, materials.metal, 0.04);
    support.position.set(sx * 2.15, 4.72, -0.15);
    machine.add(support);
  }

  /* ---------------- 地面 ---------------- */
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(4.8, 5.05, 0.22, 64),
    new THREE.MeshStandardMaterial({ color: 0xffe9bf, roughness: 0.9 })
  );
  ground.position.y = 0.0;
  ground.material.color.set(0xffe3ae);
  ground.receiveShadow = true;
  machine.add(ground);

  const groundRing = new THREE.Mesh(
    new THREE.TorusGeometry(4.45, 0.045, 6, 80),
    new THREE.MeshBasicMaterial({ color: 0xf3b73b, transparent: true, opacity: 0.45 })
  );
  groundRing.rotation.x = Math.PI / 2;
  groundRing.position.y = 0.12;
  machine.add(groundRing);

  machine.userData = {
    pusher,
    rods,
    bulbs,
    marquee,
    tray,
    glassTop,
    bedTop,
    slotZ,
    topY,
  };
  return machine;
}

export function syncPusher(machine, frontZ, config) {
  const { pusher, rods } = machine.userData;
  const depth = config.machine.pusher.depth;
  pusher.position.z = frontZ - depth / 2;

  const backZ = frontZ - depth;
  const housingFront = -0.85;
  const len = Math.max(0.08, backZ - housingFront);
  for (const rod of rods) {
    rod.scale.y = len;
    rod.position.z = housingFront + len / 2;
  }
}
