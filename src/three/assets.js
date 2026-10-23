import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, clamp } from '../utils.js';

export const PALETTE = {
  red: 0xdc3224,
  deepRed: 0xaa2018,
  redShadow: 0x821711,
  yellow: 0xf7b81e,
  lightYellow: 0xffd15a,
  cream: 0xffe9c2,
  warmWhite: 0xfff6e4,
  brown: 0x5b3a20,
  metal: 0xc5d0d6,
  darkMetal: 0x7f8c93,
  gold: 0xf2ad24,
  glass: 0xd8f2ff,
  mint: 0x8dd6b8,
};

export function standard(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.02,
    ...opts,
  });
}

export function makeMaterials() {
  const m = {
    red: standard(PALETTE.red, { roughness: 0.52 }),
    deepRed: standard(PALETTE.deepRed, { roughness: 0.6 }),
    redShadow: standard(PALETTE.redShadow, { roughness: 0.7 }),
    yellow: standard(PALETTE.yellow, { roughness: 0.48 }),
    lightYellow: standard(PALETTE.lightYellow, { roughness: 0.55 }),
    cream: standard(PALETTE.cream, { roughness: 0.64 }),
    warmWhite: standard(PALETTE.warmWhite, { roughness: 0.58 }),
    brown: standard(PALETTE.brown, { roughness: 0.72 }),
    metal: standard(PALETTE.metal, { roughness: 0.28, metalness: 0.72 }),
    darkMetal: standard(PALETTE.darkMetal, { roughness: 0.4, metalness: 0.55 }),
    gold: standard(PALETTE.gold, { roughness: 0.35, metalness: 0.4 }),
    mint: standard(PALETTE.mint, { roughness: 0.58 }),
    pusher: standard(0xf3d29b, { roughness: 0.66 }),
    black: standard(0x1a1110, { roughness: 0.85 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: PALETTE.glass,
      transparent: true,
      opacity: 0.11,
      roughness: 0.1,
      metalness: 0,
      transmission: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    glassEdge: new THREE.LineBasicMaterial({
      color: 0xbfe9f7,
      transparent: true,
      opacity: 0.55,
    }),
    bulb: new THREE.MeshStandardMaterial({
      color: 0xffe9a3,
      emissive: 0xffc533,
      emissiveIntensity: 1.6,
      roughness: 0.3,
    }),
    starGlow: new THREE.MeshBasicMaterial({
      color: 0xffd75a,
      transparent: true,
      opacity: 0.5,
    }),
  };
  return m;
}

export function makeCanvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function makeMarqueeTexture() {
  return makeCanvasTexture(1024, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ffcc45');
    g.addColorStop(1, '#f7b11f');
    roundRect(ctx, 10, 10, w - 20, h - 20, 46);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#a8231c';
    ctx.stroke();

    ctx.save();
    ctx.translate(w / 2, 116);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 86px "Microsoft YaHei", "PingFang SC", "Arial Rounded MT Bold", sans-serif';
    ctx.fillStyle = '#a8231c';
    ctx.fillText('麦乐鸡块推币机', 0, 4);
    ctx.font = '800 34px "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#7d3b13';
    ctx.fillText("McDONALD'S MCP  ·  NUGGET PUSHER", 0, 76);
    ctx.restore();

    // 两侧小星星，避免直接使用品牌素材
    drawStar(ctx, 78, h / 2, 28, 12, 5, '#b5281f');
    drawStar(ctx, w - 78, h / 2, 28, 12, 5, '#b5281f');
  });
}

export function drawStar(ctx, cx, cy, outer, inner, points, fill) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function makeJackpotLabelTexture() {
  return makeCanvasTexture(512, 180, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 8, 8, w - 16, h - 16, 34);
    ctx.fillStyle = '#fff4d8';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#e33b2e';
    ctx.stroke();
    drawStar(ctx, 78, h / 2, 34, 15, 5, '#ffc533');
    ctx.fillStyle = '#b82820';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 54px "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif';
    ctx.fillText('JACKPOT', w / 2 + 30, h / 2 - 16);
    ctx.font = '800 34px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillStyle = '#7d3b13';
    ctx.fillText('一整盒麦乐鸡', w / 2 + 30, h / 2 + 33);
  });
}

export function makeBoxFrontTexture() {
  return makeCanvasTexture(512, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 12, 12, w - 24, h - 24, 30);
    ctx.fillStyle = '#fff3d6';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#a8231c';
    ctx.stroke();
    drawStar(ctx, 84, h / 2, 40, 17, 5, '#ffc533');
    ctx.fillStyle = '#b82820';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '900 62px "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif';
    ctx.fillText('NUGGET', 152, h / 2 - 26);
    ctx.font = '900 48px "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#7d3b13';
    ctx.fillText('PARTY BOX', 152, h / 2 + 42);
  });
}

export function makeBedTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f9e6b9');
    g.addColorStop(1, '#f3d79e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 细网格 + 圆点，模拟游艺机币台的印刷纹理
    ctx.strokeStyle = 'rgba(180, 124, 48, 0.16)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= w; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    for (let y = 16; y < h; y += 64) {
      for (let x = 16; x < w; x += 64) {
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 前缘警示斜纹
    ctx.save();
    ctx.globalAlpha = 0.34;
    for (let x = -100; x < w + 100; x += 48) {
      ctx.strokeStyle = '#c48f30';
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.moveTo(x, h - 52);
      ctx.lineTo(x + 52, h - 4);
      ctx.stroke();
    }
    ctx.restore();
  });
}

export function makeRampTexture() {
  return makeCanvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffd969';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(227, 59, 46, 0.78)';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    for (let x = 34; x < w; x += 92) {
      ctx.beginPath();
      ctx.moveTo(x - 24, 30);
      ctx.lineTo(x, 64);
      ctx.lineTo(x - 24, 98);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 252, 235, 0.65)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  });
}

export function makeGlassGlareTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-0.42);
    const width = 86;
    const g = ctx.createLinearGradient(-width / 2, 0, width / 2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.34, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.52, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-width / 2, -h * 0.68, width, h * 1.36);
    const g2 = ctx.createLinearGradient(-240, 0, -180, 0);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(-270, -h * 0.7, 46, h * 1.4);
    ctx.restore();
  });
}

export function makeStarShape(outer = 0.5, inner = 0.22, points = 5) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** 不规则低模麦乐鸡块：3 个轮廓变体共用材质。 */
export function makeNuggetGeometries() {
  const geoms = [];
  const rng = mulberry32(90731);
  for (let v = 0; v < 3; v++) {
    const shape = new THREE.Shape();
    const n = 12;
    const points = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const lobe = v === 0 ? 1 + Math.sin(a * 3 + 1) * 0.07 : v === 1 ? 1 + Math.cos(a * 2 + 0.5) * 0.09 : 1 + Math.sin(a * 4) * 0.05;
      const r = 0.2 * (0.9 + rng() * 0.17) * lobe;
      points.push(new THREE.Vector2(Math.cos(a) * r * 1.16, Math.sin(a) * r * 0.92));
    }
    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, points[i].y);
    shape.closePath();

    const baseGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.09,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.036,
      bevelThickness: 0.03,
      steps: 1,
      curveSegments: 1,
    });
    baseGeo.rotateX(-Math.PI / 2);
    baseGeo.center();

    // 顶部加一小块圆润“鸡块鼓包”，从俯视角度看更像鸡块而不是硬币
    const lump = new THREE.IcosahedronGeometry(0.115 + v * 0.008, 1);
    lump.scale(1.12, 0.44, 0.84);
    lump.rotateY(v * 0.9 + 0.4);
    lump.translate(-0.035 + v * 0.035, 0.062, v === 1 ? 0.02 : -0.015);
    const geo = mergeGeometries([baseGeo, lump], false) || baseGeo;
    geo.computeVertexNormals();

    // 顶面偏亮、侧面偏焦糖色，并混入少量“烤斑”
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const light = new THREE.Color(0xffc24a);
    const mid = new THREE.Color(0xe59a1e);
    const dark = new THREE.Color(0xc4760f);
    const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = clamp((y + 0.1) / 0.2, 0, 1);
      color.copy(dark).lerp(mid, h * 0.8).lerp(light, Math.max(0, h - 0.55) * 0.9);
      const spot = Math.sin(x * 31 + z * 19 + v) * Math.cos(z * 27 - x * 13);
      if (spot > 0.66) color.lerp(new THREE.Color(0xa65b08), 0.4);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geoms.push(geo);
  }
  return geoms;
}

export function makeNuggetMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.52,
    metalness: 0.03,
    emissive: 0x1b0d00,
    emissiveIntensity: 0.07,
  });
}

export function makeNuggetMesh(geoms, material, variant = 0, rand = Math.random, scale = 1) {
  const geo = geoms[Math.abs(variant) % geoms.length];
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.y = rand() * Math.PI * 2;
  mesh.scale.setScalar(scale * (0.94 + rand() * 0.12));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function makeJackpotBox(materials, geoms, nuggetMaterial, frontTex, signTex) {
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.y = 0.06;
  group.add(tilt);

  const bodyGeo = new RoundedBoxGeometry(1.45, 0.56, 0.8, 3, 0.07);
  const body = new THREE.Mesh(bodyGeo, materials.red);
  body.position.y = 0.3;
  body.castShadow = true;
  body.receiveShadow = true;
  tilt.add(body);

  // 奶油色腰线
  const band = new THREE.Mesh(new RoundedBoxGeometry(1.48, 0.12, 0.83, 2, 0.04), materials.cream);
  band.position.y = 0.11;
  band.castShadow = true;
  tilt.add(band);

  // 盒盖：从后侧翻开一点，露出里面的鸡块
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.56, -0.4);
  lidPivot.rotation.x = -0.13;
  tilt.add(lidPivot);
  const lid = new THREE.Mesh(new RoundedBoxGeometry(1.55, 0.16, 0.9, 3, 0.06), materials.yellow);
  lid.position.set(0, 0.06, 0.4);
  lid.castShadow = true;
  lidPivot.add(lid);
  const lidInset = new THREE.Mesh(new RoundedBoxGeometry(1.18, 0.03, 0.6, 2, 0.025), materials.deepRed);
  lidInset.position.set(0, 0.145, 0.4);
  lidPivot.add(lidInset);

  // 盒内探头的三块鸡块
  const rng = mulberry32(551);
  const inside = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const n = makeNuggetMesh(geoms, nuggetMaterial, i, rng, 0.62);
    n.position.set(-0.34 + i * 0.34, 0.54, 0.1 + (i % 2) * 0.09);
    n.rotation.x = -0.1;
    inside.add(n);
  }
  tilt.add(inside);

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(1.18, 0.42),
    new THREE.MeshBasicMaterial({ map: frontTex, transparent: true, depthWrite: false })
  );
  label.position.set(0, 0.33, 0.408);
  tilt.add(label);

  // 盒顶小星星
  const starGeo = new THREE.ExtrudeGeometry(makeStarShape(0.17, 0.075, 5), {
    depth: 0.05,
    bevelEnabled: true,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    bevelSegments: 1,
  });
  starGeo.center();
  const star = new THREE.Mesh(starGeo, materials.deepRed);
  star.rotation.x = -Math.PI / 2;
  star.position.set(0, 0.15, 0.4);
  lidPivot.add(star);

  // 地面光环
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.88, 0.035, 6, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.55, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025;
  group.add(ring);

  // 悬浮 JACKPOT 标牌
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.38, 0.49),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  sign.position.set(0, 1.32, 0);
  group.add(sign);

  // 环绕的小闪光
  const sparkleMat = new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.95 });
  const sparkles = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.035 + (i % 3) * 0.012, 0), sparkleMat);
    s.userData.phase = i * 1.7;
    s.userData.radius = 0.75 + (i % 2) * 0.2;
    sparkles.add(s);
  }
  group.add(sparkles);

  const light = new THREE.PointLight(0xffc533, 3.4, 3.2, 2);
  light.position.set(0, 1.0, 0.35);
  group.add(light);

  group.userData = { tilt, lidPivot, ring, sign, sparkles, light };
  return group;
}

