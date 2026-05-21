// ============================================================
// How AI Actually Works — Three.js scroll-driven scene engine
// ============================================================
//
// Architecture:
//   - One persistent THREE.Scene with one Camera.
//   - Each "layer" of the AI stack is a THREE.Group (a "tableau"),
//     all parked at the world origin.
//   - On scroll we figure out which tableau the viewport is over,
//     fade/transition between them, and pipe a 0..1 progress
//     value into per-tableau animations.
//   - Constant render loop animates everything; scroll only nudges
//     parameters.
// ============================================================

import * as THREE from 'three';

// ---------- Renderer / Camera / Scene ----------

const canvas = document.getElementById('scene');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060a, 0.04);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 0, 14);
camera.lookAt(0, 0, 0);

// Subtle ambient lighting (most things are emissive)
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const keyLight = new THREE.DirectionalLight(0xa9d8ff, 0.6);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xff9b6e, 0.25);
rimLight.position.set(-6, -2, -4);
scene.add(rimLight);

// ---------- Helpers ----------

const PALETTE = {
  teal:   new THREE.Color('#7cf8d6'),
  amber:  new THREE.Color('#ffb84d'),
  violet: new THREE.Color('#b58cff'),
  sky:    new THREE.Color('#6ec1ff'),
  pink:   new THREE.Color('#ff7ab6'),
  white:  new THREE.Color('#ffffff'),
};

const TAU = Math.PI * 2;

const lerp  = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// ============================================================
// TABLEAU BUILDERS — one function per AI stack layer.
// Each returns { group, update(progress, time, alpha) }.
// 'progress'  is 0..1 across the section.
// 'alpha'     is 0..1 visibility (cross-fade weight).
// 'time'      is seconds since page load.
// ============================================================

// ----- 0. PROLOGUE: a quiet starfield of "ideas" -----
function buildPrologue() {
  const group = new THREE.Group();

  const count = 1800;
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  const sizes     = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // distribute in a thick spherical shell
    const r = 6 + Math.random() * 14;
    const theta = Math.random() * TAU;
    const phi   = Math.acos(2 * Math.random() - 1);

    positions[i*3+0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i*3+2] = r * Math.cos(phi);

    const c = Math.random() < 0.7 ? PALETTE.sky
            : Math.random() < 0.5 ? PALETTE.teal
                                  : PALETTE.violet;
    colors[i*3+0] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
    sizes[i]      = Math.random() * 0.06 + 0.015;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      uniform float uTime;
      void main() {
        vColor = color;
        vec3 p = position;
        // gentle drift
        p.x += sin(uTime * 0.3 + position.y) * 0.06;
        p.y += cos(uTime * 0.25 + position.z) * 0.06;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = size * (380.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      uniform float uAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor, a * uAlpha);
      }`,
    vertexColors: true,
  });

  const stars = new THREE.Points(geo, mat);
  group.add(stars);

  return {
    group,
    update(p, t, a) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uAlpha.value = a;
      stars.rotation.y = t * 0.04;
      stars.rotation.x = Math.sin(t * 0.02) * 0.2;
      // gently zoom in over the section
      const s = 1 + p * 0.25;
      group.scale.setScalar(s);
    },
  };
}

// ----- 1. ENERGY: power lines + lightning arcs -----
function buildEnergy() {
  const group = new THREE.Group();

  // Two pylons (transmission towers) — minimal geometric
  function pylon(x) {
    const p = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x2a3142, metalness: 0.6, roughness: 0.4, emissive: 0x0a1020,
    });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.18, 5, 8), trunkMat);
    trunk.position.y = 0;
    p.add(trunk);
    for (let i = 0; i < 3; i++) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(1.2 - i * 0.25, 0.06, 0.06),
        trunkMat
      );
      beam.position.y = 1.4 - i * 0.7;
      p.add(beam);
    }
    p.position.x = x;
    p.position.y = -1;
    return p;
  }
  const pyL = pylon(-5);
  const pyR = pylon( 5);
  group.add(pyL, pyR);

  // Power cable (catenary curve)
  function cable(yOffset) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = lerp(-5, 5, t);
      const sag = -Math.sin(t * Math.PI) * 0.6;
      pts.push(new THREE.Vector3(x, yOffset + sag - 1, 0));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 64, 0.015, 6, false),
      new THREE.MeshBasicMaterial({ color: 0x4a5366 })
    );
    return { mesh: tube, curve };
  }
  const cables = [cable(1.4), cable(0.7), cable(0)];
  cables.forEach(c => group.add(c.mesh));

  // Electricity particles travelling along the cables
  const ELEC_COUNT = 80;
  const elecPositions = new Float32Array(ELEC_COUNT * 3);
  const elecData = []; // {cable, t, speed}
  for (let i = 0; i < ELEC_COUNT; i++) {
    elecData.push({
      ci: Math.floor(Math.random() * cables.length),
      t: Math.random(),
      speed: 0.25 + Math.random() * 0.6,
    });
  }
  const elecGeo = new THREE.BufferGeometry();
  elecGeo.setAttribute('position', new THREE.BufferAttribute(elecPositions, 3));
  const elecMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uAlpha: { value: 1 }, uColor: { value: PALETTE.amber } },
    vertexShader: `
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 6.0 * (380.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uAlpha;
      uniform vec3 uColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor, a * uAlpha);
      }`,
  });
  const elec = new THREE.Points(elecGeo, elecMat);
  group.add(elec);

  // Lightning bolt (segmented line) that flashes occasionally
  const boltMat = new THREE.LineBasicMaterial({
    color: PALETTE.sky,
    transparent: true,
    opacity: 0,
    linewidth: 2,
  });
  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3 * 16), 3));
  const bolt = new THREE.Line(boltGeo, boltMat);
  group.add(bolt);
  let boltTimer = 0;
  let boltOpacity = 0;

  function regenerateBolt() {
    const arr = boltGeo.attributes.position.array;
    const startY =  1.3;
    const endY   = -1.0;
    const x0 = (Math.random() - 0.5) * 6;
    let prev = new THREE.Vector3(x0, startY, 0);
    for (let i = 0; i < 16; i++) {
      const t = (i + 1) / 16;
      const y = lerp(startY, endY, t);
      const x = prev.x + (Math.random() - 0.5) * 0.6;
      arr[i * 6 + 0] = prev.x; arr[i * 6 + 1] = prev.y; arr[i * 6 + 2] = 0;
      arr[i * 6 + 3] = x;      arr[i * 6 + 4] = y;      arr[i * 6 + 5] = 0;
      prev = new THREE.Vector3(x, y, 0);
    }
    boltGeo.attributes.position.needsUpdate = true;
  }

  // Ground glow plane
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 4),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uAlpha;
        void main(){
          float d = abs(vUv.y - 0.5);
          float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + vUv.x * 6.0);
          float a = smoothstep(0.5, 0.0, d) * (0.25 + pulse * 0.35);
          vec3 col = mix(vec3(1.0, 0.5, 0.15), vec3(1.0, 0.8, 0.3), pulse);
          gl_FragColor = vec4(col, a * uAlpha * 0.5);
        }`,
    })
  );
  glow.position.y = -2.2;
  glow.rotation.x = -Math.PI / 2.4;
  group.add(glow);

  return {
    group,
    update(p, t, a) {
      // animate electricity along cables
      const arr = elecGeo.attributes.position.array;
      for (let i = 0; i < ELEC_COUNT; i++) {
        const d = elecData[i];
        d.t += d.speed * 0.012;
        if (d.t > 1) d.t -= 1;
        const c = cables[d.ci];
        const pt = c.curve.getPointAt(d.t);
        arr[i*3+0] = pt.x;
        arr[i*3+1] = pt.y;
        arr[i*3+2] = pt.z + Math.sin(t * 8 + i) * 0.03;
      }
      elecGeo.attributes.position.needsUpdate = true;
      elecMat.uniforms.uAlpha.value = a;

      // lightning timing — more frequent the further you scroll
      boltTimer -= 1/60;
      if (boltTimer <= 0) {
        regenerateBolt();
        boltOpacity = 1.0;
        boltTimer = 0.5 + Math.random() * (1.4 - p * 1.0);
      }
      boltOpacity *= 0.85;
      boltMat.opacity = boltOpacity * a;

      glow.material.uniforms.uTime.value = t;
      glow.material.uniforms.uAlpha.value = a;

      // slow drift
      group.rotation.y = Math.sin(t * 0.15) * 0.1 + p * 0.2;
      group.position.y = -0.2 + p * -0.3;
    },
  };
}

// ----- 2. CHIPS: a rotating GPU die with transistor grid -----
function buildChips() {
  const group = new THREE.Group();

  // Substrate (PCB-like)
  const substrate = new THREE.Mesh(
    new THREE.BoxGeometry(7, 0.18, 5),
    new THREE.MeshStandardMaterial({
      color: 0x1a3320, metalness: 0.3, roughness: 0.7,
    })
  );
  substrate.position.y = -0.4;
  group.add(substrate);

  // Main die
  const die = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.28, 3.6),
    new THREE.MeshStandardMaterial({
      color: 0x0a1424, metalness: 0.85, roughness: 0.25,
      emissive: 0x051022, emissiveIntensity: 0.6,
    })
  );
  die.position.y = -0.16;
  group.add(die);

  // Transistor grid on top of die (a sea of glowing pixels)
  const COLS = 24, ROWS = 24;
  const cellSize = 3.2 / COLS;
  const cellGeo = new THREE.PlaneGeometry(cellSize * 0.78, cellSize * 0.78);
  const cellInst = new THREE.InstancedMesh(
    cellGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1, toneMapped: false,
    }),
    COLS * ROWS
  );
  const dummy = new THREE.Object3D();
  const cellColors = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const x = (c - COLS / 2 + 0.5) * cellSize;
      const z = (r - ROWS / 2 + 0.5) * cellSize;
      dummy.position.set(x, -0.015, z);
      dummy.rotation.x = -Math.PI / 2;
      dummy.updateMatrix();
      cellInst.setMatrixAt(i, dummy.matrix);
      const col = new THREE.Color().lerpColors(PALETTE.teal, PALETTE.sky, Math.random());
      cellColors.push(col);
      cellInst.setColorAt(i, col);
    }
  }
  cellInst.instanceMatrix.needsUpdate = true;
  cellInst.instanceColor.needsUpdate = true;
  group.add(cellInst);

  // HBM memory stacks on two sides
  function hbm(x) {
    const stack = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const layer = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.08, 1.3),
        new THREE.MeshStandardMaterial({
          color: 0x2a2632, metalness: 0.7, roughness: 0.3,
          emissive: PALETTE.violet, emissiveIntensity: 0.15,
        })
      );
      layer.position.y = i * 0.1;
      stack.add(layer);
    }
    stack.position.set(x, -0.2, 0);
    return stack;
  }
  group.add(hbm(-2.2));
  group.add(hbm( 2.2));

  // Connector traces on the substrate (animated lines)
  const traceMat = new THREE.LineBasicMaterial({
    color: PALETTE.amber, transparent: true, opacity: 0.5,
  });
  for (let i = 0; i < 20; i++) {
    const startX = -3.5 + Math.random() * 7;
    const startZ = (Math.random() < 0.5 ? -1 : 1) * (2.4 + Math.random() * 0.2);
    const endX = startX + (Math.random() - 0.5) * 0.4;
    const endZ = startZ > 0 ? 1.8 : -1.8;
    const pts = [
      new THREE.Vector3(startX, -0.3, startZ),
      new THREE.Vector3(startX, -0.3, (startZ + endZ) / 2),
      new THREE.Vector3(endX,   -0.3, endZ),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, traceMat);
    group.add(line);
  }

  // Floating label rings
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.01, 6, 80),
    new THREE.MeshBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0.6 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.05;
  group.add(ring);

  return {
    group,
    update(p, t, a) {
      // pulse the transistor grid — wave of activity sweeping over it
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const dx = c - COLS / 2;
          const dz = r - ROWS / 2;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const wave = Math.sin(t * 2 - dist * 0.5);
          const intensity = 0.25 + (wave * 0.5 + 0.5) * 0.9;
          const flicker = 0.85 + Math.random() * 0.3;
          const baseCol = cellColors[i];
          const c2 = baseCol.clone().multiplyScalar(intensity * flicker);
          cellInst.setColorAt(i, c2);
        }
      }
      cellInst.instanceColor.needsUpdate = true;
      cellInst.material.opacity = a;

      // tilt and rotate the whole die based on scroll
      group.rotation.x = -0.4 + p * 0.2 + Math.sin(t * 0.4) * 0.04;
      group.rotation.y = t * 0.15 + p * 0.4;
      group.position.y = 0.2 - p * 0.5;
      group.scale.setScalar(1 + p * 0.15);

      ring.scale.setScalar(1 + (Math.sin(t * 1.4) * 0.05));
    },
  };
}

// ----- 3. DATACENTER: rows of server racks + fiber light streams -----
function buildDatacenter() {
  const group = new THREE.Group();

  const ROWS = 3, RACKS = 6;
  const rackGroup = new THREE.Group();

  const rackMat = new THREE.MeshStandardMaterial({
    color: 0x12161e, metalness: 0.7, roughness: 0.45,
  });

  const ledColors = [PALETTE.teal, PALETTE.amber, PALETTE.sky];
  const allLEDs = []; // pulse them randomly

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < RACKS; c++) {
      const rack = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.6), rackMat);
      rack.add(body);

      // panels with LEDs
      for (let row = 0; row < 8; row++) {
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(0.66, 0.18, 0.02),
          new THREE.MeshStandardMaterial({ color: 0x05080c, metalness: 0.4, roughness: 0.7 })
        );
        panel.position.y = -0.8 + row * 0.22;
        panel.position.z = 0.31;
        rack.add(panel);

        for (let l = 0; l < 5; l++) {
          const led = new THREE.Mesh(
            new THREE.SphereGeometry(0.018, 6, 6),
            new THREE.MeshBasicMaterial({
              color: ledColors[(row + l) % ledColors.length],
              toneMapped: false,
            })
          );
          led.position.set(-0.25 + l * 0.12, panel.position.y + 0.04, 0.33);
          rack.add(led);
          allLEDs.push({ mesh: led, phase: Math.random() * TAU, speed: 1 + Math.random() * 3 });
        }
      }

      rack.position.x = (c - (RACKS - 1) / 2) * 1.0;
      rack.position.z = (r - (ROWS - 1) / 2) * 1.4;
      rack.position.y = 0;
      rackGroup.add(rack);
    }
  }
  rackGroup.position.y = -0.2;
  group.add(rackGroup);

  // Floor with grid
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 12, 20, 12),
    new THREE.MeshBasicMaterial({
      color: 0x0a1424, transparent: true, opacity: 0.85, wireframe: true,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.1;
  group.add(floor);

  // Fiber light streams: a few luminous curves arcing between racks
  const STREAM_COUNT = 8;
  const streamMat = new THREE.LineBasicMaterial({
    color: PALETTE.teal, transparent: true, opacity: 0.55,
  });
  const streams = [];
  for (let i = 0; i < STREAM_COUNT; i++) {
    const sx = (Math.random() - 0.5) * 6;
    const sz = (Math.random() - 0.5) * 3;
    const ex = (Math.random() - 0.5) * 6;
    const ez = (Math.random() - 0.5) * 3;
    const peak = 1.5 + Math.random() * 1.5;
    const pts = [];
    for (let j = 0; j <= 30; j++) {
      const t = j / 30;
      const x = lerp(sx, ex, t);
      const z = lerp(sz, ez, t);
      const y = Math.sin(t * Math.PI) * peak;
      pts.push(new THREE.Vector3(x, y, z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, streamMat.clone());
    group.add(line);
    streams.push({ line, basePts: pts, phase: Math.random() * TAU });
  }

  // Travelling photon points along the streams
  const PHOTONS = 60;
  const photonPos = new Float32Array(PHOTONS * 3);
  const photonData = [];
  for (let i = 0; i < PHOTONS; i++) {
    photonData.push({
      streamIdx: Math.floor(Math.random() * STREAM_COUNT),
      t: Math.random(),
      speed: 0.3 + Math.random() * 0.7,
    });
  }
  const photonGeo = new THREE.BufferGeometry();
  photonGeo.setAttribute('position', new THREE.BufferAttribute(photonPos, 3));
  const photonMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.08, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const photons = new THREE.Points(photonGeo, photonMat);
  group.add(photons);

  return {
    group,
    update(p, t, a) {
      // LED twinkle
      for (const l of allLEDs) {
        const v = 0.4 + 0.6 * (Math.sin(t * l.speed + l.phase) * 0.5 + 0.5);
        l.mesh.material.color.setRGB(
          l.mesh.material.color.r,
          l.mesh.material.color.g,
          l.mesh.material.color.b
        );
        l.mesh.scale.setScalar(0.6 + v * 1.2);
        l.mesh.material.opacity = a;
      }

      // photons travel along curves
      const arr = photonGeo.attributes.position.array;
      for (let i = 0; i < PHOTONS; i++) {
        const d = photonData[i];
        d.t += d.speed * 0.01;
        if (d.t > 1) d.t -= 1;
        const stream = streams[d.streamIdx];
        const j = Math.min(30, Math.floor(d.t * 30));
        const k = Math.min(30, j + 1);
        const tt = d.t * 30 - j;
        const p0 = stream.basePts[j];
        const p1 = stream.basePts[k];
        arr[i*3+0] = lerp(p0.x, p1.x, tt);
        arr[i*3+1] = lerp(p0.y, p1.y, tt);
        arr[i*3+2] = lerp(p0.z, p1.z, tt);
      }
      photonGeo.attributes.position.needsUpdate = true;
      photonMat.opacity = a;

      // streams pulse opacity
      streams.forEach((s, i) => {
        s.line.material.opacity = (0.3 + 0.4 * (Math.sin(t * 1.5 + s.phase) * 0.5 + 0.5)) * a;
      });

      floor.material.opacity = 0.85 * a;

      // camera-ish movement: rotate the whole datacenter group
      group.rotation.y = -0.4 + p * 0.7 + Math.sin(t * 0.1) * 0.05;
      group.rotation.x = 0.15;
      group.position.y = -0.1 - p * 0.3;
      group.scale.setScalar(1 - p * 0.1);
    },
  };
}

// ----- 4. DATA: stream of token-glyphs flowing into a funnel -----
function buildData() {
  const group = new THREE.Group();

  // Create text-glyph sprite atlases procedurally with canvas
  const glyphTexture = (() => {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 1024;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 1024, 1024);
    const glyphs = '01abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP{}[]()<>+=*?/&%$#@!~';
    const cell = 64;
    const cols = 16;
    ctx.font = 'bold 44px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < glyphs.length; i++) {
      const x = (i % cols) * cell + cell / 2;
      const y = Math.floor(i / cols) * cell + cell / 2;
      ctx.fillText(glyphs[i], x, y);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return { tex, count: glyphs.length, cols };
  })();

  const COUNT = 320;
  const positions = new Float32Array(COUNT * 3);
  const uvOffsets = new Float32Array(COUNT * 2);
  const colors    = new Float32Array(COUNT * 3);
  const sizes     = new Float32Array(COUNT);
  const speeds    = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    positions[i*3+0] = (Math.random() - 0.5) * 14;
    positions[i*3+1] = (Math.random() - 0.5) * 8;
    positions[i*3+2] = (Math.random() - 0.5) * 6;
    const g = Math.floor(Math.random() * glyphTexture.count);
    uvOffsets[i*2+0] = (g % glyphTexture.cols) / glyphTexture.cols;
    uvOffsets[i*2+1] = 1 - Math.floor(g / glyphTexture.cols) / glyphTexture.cols - 1 / glyphTexture.cols;
    const col = Math.random() < 0.5 ? PALETTE.teal : Math.random() < 0.5 ? PALETTE.sky : PALETTE.violet;
    colors[i*3+0] = col.r; colors[i*3+1] = col.g; colors[i*3+2] = col.b;
    sizes[i]  = 0.25 + Math.random() * 0.35;
    speeds[i] = 0.4 + Math.random() * 1.4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uvOffset', new THREE.BufferAttribute(uvOffsets, 2));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTex:   { value: glyphTexture.tex },
      uAlpha: { value: 1 },
      uCols:  { value: glyphTexture.cols },
    },
    vertexShader: `
      attribute float size;
      attribute vec2 uvOffset;
      varying vec3 vColor;
      varying vec2 vOffset;
      void main() {
        vColor = color;
        vOffset = uvOffset;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (380.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying vec2 vOffset;
      uniform sampler2D uTex;
      uniform float uAlpha;
      uniform float uCols;
      void main() {
        vec2 uv = vOffset + gl_PointCoord / uCols;
        // gl_PointCoord origin is top-left; flip Y to align with canvas tile
        uv.y = vOffset.y + (1.0 - gl_PointCoord.y) / uCols;
        vec4 tex = texture2D(uTex, uv);
        gl_FragColor = vec4(vColor, tex.a * uAlpha);
      }`,
    vertexColors: true,
  });

  const tokens = new THREE.Points(geo, mat);
  group.add(tokens);

  // Funnel rings (suggesting tokens being squeezed into the model)
  const funnel = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const r = 3 - i * 0.5;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.012, 6, 96),
      new THREE.MeshBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0.35 })
    );
    ring.position.z = -i * 1.0;
    ring.rotation.x = Math.PI / 2;
    funnel.add(ring);
  }
  group.add(funnel);

  return {
    group,
    update(p, t, a) {
      // tokens drift toward the funnel center
      const arr = geo.attributes.position.array;
      for (let i = 0; i < COUNT; i++) {
        arr[i*3+0] *= 0.997;          // pull toward x=0
        arr[i*3+1] *= 0.997;          // pull toward y=0
        arr[i*3+2] -= speeds[i] * 0.02; // flow down -Z

        // when they pass into the throat, respawn at the back
        if (arr[i*3+2] < -6) {
          arr[i*3+0] = (Math.random() - 0.5) * 14;
          arr[i*3+1] = (Math.random() - 0.5) * 8;
          arr[i*3+2] = 4 + Math.random() * 2;
        }
      }
      geo.attributes.position.needsUpdate = true;
      mat.uniforms.uAlpha.value = a;

      funnel.rotation.z = t * 0.2;
      funnel.children.forEach((ring, i) => {
        ring.material.opacity = (0.25 + Math.sin(t * 2 - i * 0.5) * 0.2) * a;
      });

      group.rotation.y = Math.sin(t * 0.2) * 0.1 + p * 0.3;
      group.position.z = lerp(2, -1, p);
    },
  };
}

// ----- 5. MODEL: a transformer-like neural net with attention arcs -----
function buildModel() {
  const group = new THREE.Group();

  const LAYERS = 6;
  const NODES_PER = 8;
  const layerSpacing = 1.4;
  const nodeSpacing  = 0.7;

  const nodes = []; // flat array, indexed [layer][node]
  const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

  for (let l = 0; l < LAYERS; l++) {
    const layer = [];
    for (let n = 0; n < NODES_PER; n++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 12, 12),
        nodeMat.clone()
      );
      m.position.set(
        (n - (NODES_PER - 1) / 2) * nodeSpacing,
        (l - (LAYERS - 1) / 2) * layerSpacing,
        0
      );
      const col = new THREE.Color().lerpColors(PALETTE.violet, PALETTE.teal, l / (LAYERS - 1));
      m.material.color.copy(col);
      group.add(m);
      layer.push(m);
    }
    nodes.push(layer);
  }

  // Connections between consecutive layers
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x6ec1ff, transparent: true, opacity: 0.15,
  });
  for (let l = 0; l < LAYERS - 1; l++) {
    for (let a = 0; a < NODES_PER; a++) {
      for (let b = 0; b < NODES_PER; b++) {
        if (Math.random() > 0.45) continue; // sparse
        const geo = new THREE.BufferGeometry().setFromPoints([
          nodes[l][a].position, nodes[l+1][b].position
        ]);
        group.add(new THREE.Line(geo, lineMat));
      }
    }
  }

  // Attention arcs along the top input row
  const inputRow = nodes[0];
  const attMat = new THREE.LineBasicMaterial({
    color: PALETTE.amber, transparent: true, opacity: 0.6,
  });
  const attArcs = [];
  for (let i = 0; i < inputRow.length; i++) {
    for (let j = 0; j < inputRow.length; j++) {
      if (i === j || Math.random() > 0.35) continue;
      const pts = [];
      const p0 = inputRow[i].position;
      const p1 = inputRow[j].position;
      const dist = Math.abs(j - i);
      const peakZ = -0.5 - dist * 0.3;
      for (let t = 0; t <= 20; t++) {
        const tt = t / 20;
        const x = lerp(p0.x, p1.x, tt);
        const y = p0.y + 0.4 * Math.sin(tt * Math.PI);
        const z = peakZ * Math.sin(tt * Math.PI);
        pts.push(new THREE.Vector3(x, y, z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, attMat.clone());
      group.add(line);
      attArcs.push({ line, phase: Math.random() * TAU });
    }
  }

  // Activity pulses: data flowing through the network
  const pulseMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false,
  });
  const PULSES = 12;
  const pulses = [];
  for (let i = 0; i < PULSES; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), pulseMat.clone());
    m.userData = {
      layer: Math.floor(Math.random() * (LAYERS - 1)),
      from: Math.floor(Math.random() * NODES_PER),
      to:   Math.floor(Math.random() * NODES_PER),
      t: Math.random(),
      speed: 0.2 + Math.random() * 0.6,
    };
    group.add(m);
    pulses.push(m);
  }

  return {
    group,
    update(p, t, a) {
      // pulse nodes brightness in waves
      for (let l = 0; l < LAYERS; l++) {
        for (let n = 0; n < NODES_PER; n++) {
          const m = nodes[l][n];
          const v = 0.4 + 0.6 * (Math.sin(t * 2 + l * 0.8 + n * 0.4) * 0.5 + 0.5);
          m.scale.setScalar(0.6 + v * 0.8);
          m.material.opacity = a;
          m.material.transparent = true;
        }
      }

      // animate pulses traveling between layers
      for (const m of pulses) {
        const d = m.userData;
        d.t += d.speed * 0.025;
        if (d.t > 1) {
          d.t = 0;
          d.layer = (d.layer + 1) % (LAYERS - 1);
          d.from = d.to;
          d.to = Math.floor(Math.random() * NODES_PER);
        }
        const a0 = nodes[d.layer][d.from].position;
        const a1 = nodes[d.layer + 1][d.to].position;
        m.position.lerpVectors(a0, a1, d.t);
        m.material.opacity = a;
      }

      // attention arcs shimmer
      attArcs.forEach((a2, i) => {
        a2.line.material.opacity = (0.3 + Math.sin(t * 1.5 + a2.phase) * 0.3) * a;
      });

      group.rotation.y = -0.4 + p * 0.8 + Math.sin(t * 0.2) * 0.05;
      group.rotation.x = 0.05 + Math.sin(t * 0.15) * 0.05;
      group.position.y = 0.2 - p * 0.4;
      group.scale.setScalar(0.85 + p * 0.15);
    },
  };
}

// ----- 6. TRAINING: loss curve descending, gradients raining -----
function buildTraining() {
  const group = new THREE.Group();

  // Build a loss curve as a tube
  const lossPoints = [];
  const N = 200;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = -5 + t * 10;
    // exponential decay + noise — looks like a real training run
    const noise = (Math.sin(i * 0.7) + Math.sin(i * 1.7) * 0.5) * 0.1 * Math.exp(-t * 2.5);
    const y = 2.6 * Math.exp(-t * 3.2) - 1.4 + noise;
    lossPoints.push(new THREE.Vector3(x, y, 0));
  }
  const curve = new THREE.CatmullRomCurve3(lossPoints);
  const lossTube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 200, 0.04, 8, false),
    new THREE.MeshBasicMaterial({ color: PALETTE.teal, toneMapped: false })
  );
  group.add(lossTube);

  // Axes
  const axisMat = new THREE.LineBasicMaterial({ color: 0x4a5366 });
  const axisX = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-5, -1.6, 0), new THREE.Vector3(5, -1.6, 0)
    ]),
    axisMat
  );
  const axisY = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-5, -1.6, 0), new THREE.Vector3(-5, 1.6, 0)
    ]),
    axisMat
  );
  group.add(axisX, axisY);

  // Tick marks
  for (let i = 0; i <= 10; i++) {
    const x = -5 + i;
    const t = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, -1.6, 0), new THREE.Vector3(x, -1.7, 0)
      ]),
      axisMat
    );
    group.add(t);
  }

  // Moving dot riding the curve = current training step
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 16),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber, toneMapped: false })
  );
  group.add(dot);

  // "Gradient" particles raining down toward the curve
  const RAIN_COUNT = 120;
  const rainPos = new Float32Array(RAIN_COUNT * 3);
  const rainData = [];
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPos[i*3+0] = (Math.random() - 0.5) * 10;
    rainPos[i*3+1] = 2 + Math.random() * 3;
    rainPos[i*3+2] = (Math.random() - 0.5) * 2;
    rainData.push({ vy: 0.02 + Math.random() * 0.06 });
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({
    color: PALETTE.violet, size: 0.05, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  group.add(rain);

  // Faint backdrop of "epoch" gridlines
  const gridMat = new THREE.LineBasicMaterial({
    color: 0x1a2030, transparent: true, opacity: 0.5,
  });
  for (let i = 1; i <= 5; i++) {
    const y = -1.6 + i * 0.6;
    const g = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-5, y, 0), new THREE.Vector3(5, y, 0)
      ]),
      gridMat
    );
    group.add(g);
  }

  return {
    group,
    update(p, t, a) {
      // dot rides curve
      const dotT = (Math.sin(t * 0.3) * 0.5 + 0.5);
      const pt = curve.getPointAt(dotT);
      dot.position.copy(pt);
      dot.scale.setScalar(0.8 + Math.sin(t * 6) * 0.2);

      // rain
      const arr = rainGeo.attributes.position.array;
      for (let i = 0; i < RAIN_COUNT; i++) {
        arr[i*3+1] -= rainData[i].vy;
        if (arr[i*3+1] < -1.6) {
          arr[i*3+1] = 2 + Math.random() * 3;
          arr[i*3+0] = (Math.random() - 0.5) * 10;
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
      rainMat.opacity = 0.6 * a;
      lossTube.material.opacity = a;
      lossTube.material.transparent = true;

      group.rotation.y = -0.2 + p * 0.4 + Math.sin(t * 0.1) * 0.04;
      group.rotation.x = 0.1;
      group.position.y = 0.2;
      group.scale.setScalar(0.95 + p * 0.1);
    },
  };
}

// ----- 7. INFERENCE: a token stream emerging from a glowing core -----
function buildInference() {
  const group = new THREE.Group();

  // Central glowing core (the "running" model)
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.7, 2),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: PALETTE.teal,
      emissiveIntensity: 1.4,
      metalness: 0.3, roughness: 0.4,
      wireframe: true,
    })
  );
  group.add(core);

  // Inner solid core
  const innerCore = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 1),
    new THREE.MeshStandardMaterial({
      color: 0x051418,
      emissive: PALETTE.teal,
      emissiveIntensity: 0.5,
    })
  );
  group.add(innerCore);

  // Tokens stream out along +X axis (the "answer")
  const STREAM_LEN = 40;
  const streamGroup = new THREE.Group();
  group.add(streamGroup);

  const tokenMat = new THREE.MeshBasicMaterial({
    color: PALETTE.teal, transparent: true, opacity: 1, toneMapped: false,
  });
  const tokens = [];
  for (let i = 0; i < STREAM_LEN; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.25, 0.06),
      tokenMat.clone()
    );
    m.userData = { index: i };
    streamGroup.add(m);
    tokens.push(m);
  }

  // Probability bars (distribution preview floating above core)
  const barGroup = new THREE.Group();
  const BAR_N = 12;
  const bars = [];
  for (let i = 0; i < BAR_N; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 1, 0.05),
      new THREE.MeshBasicMaterial({
        color: i === Math.floor(BAR_N / 2) ? PALETTE.amber : PALETTE.sky,
        transparent: true, opacity: 0.8, toneMapped: false,
      })
    );
    m.position.x = (i - (BAR_N - 1) / 2) * 0.18;
    m.position.y = 1.8;
    barGroup.add(m);
    bars.push(m);
  }
  group.add(barGroup);

  // Halo ring around core
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.02, 8, 80),
    new THREE.MeshBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0.5 })
  );
  halo.rotation.x = Math.PI / 2;
  group.add(halo);

  return {
    group,
    update(p, t, a) {
      core.rotation.x = t * 0.4;
      core.rotation.y = t * 0.5;
      innerCore.rotation.x = -t * 0.3;
      innerCore.rotation.y = -t * 0.2;

      // tokens stream rightward, recycling
      const speed = 1.2;
      for (let i = 0; i < tokens.length; i++) {
        const m = tokens[i];
        const phase = ((t * speed) - i * 0.12) % (tokens.length * 0.15);
        const x = 1.0 + phase * 2.5;
        m.position.x = x;
        m.position.y = Math.sin(phase * 3 + i) * 0.05;
        const fade = clamp(1 - (x - 1.0) / 7);
        m.material.opacity = fade * a;
        m.scale.setScalar(0.4 + fade * 0.8);
        // colour shift along the way
        const col = new THREE.Color().lerpColors(PALETTE.teal, PALETTE.violet, 1 - fade);
        m.material.color.copy(col);
      }

      // bars: probability distribution wiggling, "peak" pulsing
      bars.forEach((b, i) => {
        const d = Math.abs(i - (BAR_N - 1) / 2);
        const target = Math.exp(-d * d * 0.25) + Math.random() * 0.15;
        b.scale.y = target * (1 + Math.sin(t * 4 + i) * 0.06);
        b.position.y = 1.8 + (target / 2) - 0.5;
        b.material.opacity = 0.8 * a;
      });

      halo.scale.setScalar(1 + Math.sin(t * 1.5) * 0.05);
      halo.material.opacity = (0.4 + 0.2 * Math.sin(t * 2)) * a;

      group.rotation.y = -0.3 + p * 0.5;
      group.position.y = 0.1 - p * 0.2;
      group.position.x = -1 + p * 0.5;
    },
  };
}

// ----- 8. APPS: floating UI panels orbiting a model core -----
function buildApps() {
  const group = new THREE.Group();

  // Central model orb
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 32, 32),
    new THREE.MeshStandardMaterial({
      color: 0x05080c,
      emissive: PALETTE.teal,
      emissiveIntensity: 0.6,
    })
  );
  group.add(orb);

  const orbWire = new THREE.Mesh(
    new THREE.SphereGeometry(0.65, 16, 12),
    new THREE.MeshBasicMaterial({
      color: PALETTE.teal, transparent: true, opacity: 0.3, wireframe: true,
    })
  );
  group.add(orbWire);

  // Floating "app" panels — small textured planes
  function makePanel(label, lines, accentColor) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 320;
    const ctx = cv.getContext('2d');

    // bg
    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0, 0, 512, 320);

    // title bar
    ctx.fillStyle = '#1a2030';
    ctx.fillRect(0, 0, 512, 36);
    ctx.fillStyle = '#ff5f56'; ctx.beginPath(); ctx.arc(20, 18, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffbd2e'; ctx.beginPath(); ctx.arc(40, 18, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#27c93f'; ctx.beginPath(); ctx.arc(60, 18, 6, 0, TAU); ctx.fill();

    ctx.fillStyle = '#8b94a7';
    ctx.font = '500 14px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, 256, 23);

    // body content
    ctx.textAlign = 'left';
    ctx.font = '14px "JetBrains Mono", monospace';
    lines.forEach((line, i) => {
      const y = 70 + i * 24;
      ctx.fillStyle = line.startsWith('>') ? '#7cf8d6' :
                      line.startsWith('//') ? '#4a5366' :
                      '#e7ecf3';
      ctx.fillText(line, 24, y);
    });

    // accent stripe
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 318, 512, 2);

    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 1.25),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
    );
    return m;
  }

  const panels = [];
  const panelDefs = [
    { label: 'chat.app', accent: '#7cf8d6', lines: [
      '> what is the meaning of life?',
      '',
      'a stack of layers, all the',
      'way down to electrons.',
      '',
      '// also: 42.',
    ]},
    { label: 'editor.app', accent: '#b58cff', lines: [
      '// app.tsx',
      'export default function App() {',
      '  return <Hello />;',
      '}',
      '',
      '> claude: looks good ✓',
    ]},
    { label: 'agent.app', accent: '#ffb84d', lines: [
      '> book me a flight to tokyo',
      '',
      '// tool: search_flights',
      '// tool: read_calendar',
      '// tool: send_email',
      '',
      'done. confirmation sent.',
    ]},
    { label: 'terminal.app', accent: '#6ec1ff', lines: [
      '$ claude "explain this repo"',
      '',
      '// reading 142 files...',
      '// summarizing...',
      '',
      '> this is a webpack build',
      '> for a react app.',
    ]},
  ];

  panelDefs.forEach((d, i) => {
    const m = makePanel(d.label, d.lines, d.accent);
    m.userData = { angle: (i / panelDefs.length) * TAU, accent: d.accent };
    panels.push(m);
    group.add(m);
  });

  // Connecting lines from panels to orb
  const lineMat = new THREE.LineBasicMaterial({
    color: PALETTE.teal, transparent: true, opacity: 0.4,
  });
  const connectors = panels.map(p => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)
    ]);
    const l = new THREE.Line(geo, lineMat.clone());
    group.add(l);
    return l;
  });

  // Particle dust filling the space
  const DUST = 200;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dustPos[i*3+0] = (Math.random() - 0.5) * 12;
    dustPos[i*3+1] = (Math.random() - 0.5) * 8;
    dustPos[i*3+2] = (Math.random() - 0.5) * 6;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x7cf8d6, size: 0.025, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.Points(dustGeo, dustMat));

  return {
    group,
    update(p, t, a) {
      orb.material.emissiveIntensity = 0.6 + Math.sin(t * 3) * 0.2;
      orbWire.rotation.y = t * 0.3;
      orbWire.rotation.x = t * 0.2;
      orbWire.material.opacity = 0.3 * a;
      orb.material.opacity = a;
      orb.material.transparent = true;

      const radius = 3.2;
      panels.forEach((m, i) => {
        const angle = m.userData.angle + t * 0.15;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius * 0.7;
        const y = Math.sin(t * 0.5 + i) * 0.3 + (i % 2 === 0 ? 0.7 : -0.7);
        m.position.set(x, y, z);
        m.lookAt(0, 0, 0);
        m.rotateY(Math.PI); // face camera-ish since plane normal flips
        m.material.opacity = a;

        // update connector line
        const arr = connectors[i].geometry.attributes.position.array;
        arr[0] = 0; arr[1] = 0; arr[2] = 0;
        arr[3] = x; arr[4] = y; arr[5] = z;
        connectors[i].geometry.attributes.position.needsUpdate = true;
        connectors[i].material.opacity = 0.4 * a;
      });

      group.rotation.y = -0.2 + p * 0.5;
      group.position.y = -0.1;
    },
  };
}

// ============================================================
// REGISTER ALL TABLEAUX
// ============================================================

const tableaux = [
  { build: buildPrologue,   label: 'prologue'   },
  { build: buildEnergy,     label: 'energy'     },
  { build: buildChips,      label: 'chips'      },
  { build: buildDatacenter, label: 'datacenter' },
  { build: buildData,       label: 'data'       },
  { build: buildModel,      label: 'model'      },
  { build: buildTraining,   label: 'training'   },
  { build: buildInference,  label: 'inference'  },
  { build: buildApps,       label: 'apps'       },
];

const built = tableaux.map(t => {
  const b = t.build();
  b.label = t.label;
  scene.add(b.group);
  b.group.visible = false; // we'll toggle by alpha
  return b;
});

// ============================================================
// SCROLL TRACKING
// ============================================================

const panels = Array.from(document.querySelectorAll('.panel'));
const railFill  = document.getElementById('railFill');
const railLabel = document.getElementById('railLabel');
const railPct   = document.getElementById('railPct');

let activeIndex = 0;
let activeProgress = 0;  // 0..1 within active section
let docProgress    = 0;  // 0..1 overall

function updateScrollState() {
  const scrollY = window.scrollY;
  const viewportH = window.innerHeight;
  const docH = document.documentElement.scrollHeight - viewportH;
  docProgress = clamp(scrollY / Math.max(1, docH));

  // Find which panel the viewport center is in
  const center = scrollY + viewportH / 2;
  let idx = 0;
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const top = p.offsetTop;
    const bot = top + p.offsetHeight;
    if (center >= top && center < bot) { idx = i; break; }
    if (center >= bot) idx = i;
  }
  // Map panel data-step to tableau index (they are 1:1 for our 9 panels +
  // an epilogue panel that uses the last tableau)
  const step = parseInt(panels[idx].dataset.step || '0', 10);
  activeIndex = Math.min(step, built.length - 1);

  // Compute within-section progress
  const p = panels[idx];
  const top = p.offsetTop;
  const h = p.offsetHeight;
  activeProgress = clamp((scrollY + viewportH / 2 - top) / h);

  // UI rail
  railFill.style.height = (docProgress * 100).toFixed(1) + '%';
  railLabel.textContent = p.dataset.label || '';
  railPct.textContent = Math.round(docProgress * 100) + '%';
}

window.addEventListener('scroll', updateScrollState, { passive: true });
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  updateScrollState();
});

// ============================================================
// CARD ENTRANCE OBSERVER
// ============================================================

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) e.target.classList.add('in');
  }
}, { threshold: 0.18 });
document.querySelectorAll('.card').forEach(c => io.observe(c));

// ============================================================
// RENDER LOOP
// ============================================================

const clock = new THREE.Clock();

// Smoothed alpha per tableau for graceful cross-fade
const alphas = built.map(() => 0);

function tick() {
  const t = clock.getElapsedTime();

  // target alpha = 1 for active tableau, 0 otherwise
  for (let i = 0; i < built.length; i++) {
    const target = (i === activeIndex) ? 1 : 0;
    alphas[i] = lerp(alphas[i], target, 0.08);
    const visible = alphas[i] > 0.01;
    built[i].group.visible = visible;
    if (visible) {
      const localProgress = (i === activeIndex) ? activeProgress : 0;
      built[i].update(localProgress, t, alphas[i]);
    }
  }

  // Gentle camera parallax based on mouse + scroll
  const targetY = -mouseY * 0.4 + (activeProgress - 0.5) * 0.3;
  const targetX = mouseX * 0.6;
  camera.position.x = lerp(camera.position.x, targetX, 0.04);
  camera.position.y = lerp(camera.position.y, targetY, 0.04);
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

let mouseX = 0, mouseY = 0;
window.addEventListener('mousemove', (e) => {
  mouseX = (e.clientX / window.innerWidth) * 2 - 1;
  mouseY = (e.clientY / window.innerHeight) * 2 - 1;
});

updateScrollState();
tick();
