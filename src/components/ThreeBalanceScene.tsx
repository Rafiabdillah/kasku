import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { formatRupiahTitle } from '../core/format';

export interface ThreeSceneMetrics {
  kasBalance: number;
  bankBalance: number;
  ewalletBalance: number;
  totalAssets: number;
  totalDebt: number;
  totalEquity: number;
  monthlyNet: number;
}

interface ThreeBalanceSceneProps {
  metrics: ThreeSceneMetrics;
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
}

type CameraPresetKey = 'isometrik' | 'timbangan' | 'dompet' | 'buku';

const CAMERA_PRESETS: Record<
  CameraPresetKey,
  { label: string; pos: [number, number, number]; target: [number, number, number] }
> = {
  isometrik: { label: 'Isometrik', pos: [4.85, 3.65, 5.75], target: [0.18, 0.72, 0.05] },
  timbangan: { label: 'Neraca', pos: [0.2, 2.35, 5.4], target: [-0.6, 1.4, 0] },
  dompet: { label: 'Dompet', pos: [-2.9, 2.5, 3.1], target: [-1.45, 0.95, 0] },
  buku: { label: 'Buku Kas', pos: [2.8, 2.2, 3.0], target: [1.32, 0.3, 0.1] },
};

// Pre-allocated scratch helpers (zero GC inside render/transition ticks)
const _scratchPos = new THREE.Vector3();
const _scratchTarget = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(20, 18, 15, 0.52)');
  grad.addColorStop(0.55, 'rgba(20, 18, 15, 0.2)');
  grad.addColorStop(1, 'rgba(20, 18, 15, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLedgerCoverTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Rich forest ledger leather base
  ctx.fillStyle = '#14532d';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle leather grain noise
  for (let i = 0; i < 4500; i++) {
    const x = (i * 73) % 512;
    const y = ((i * 137) % 512);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(x, y, 2, 2);
  }

  // Gold foil border
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 36, 440, 440);
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, 416, 416);

  // Gold embossed Indonesian title
  ctx.fillStyle = '#f3d97d';
  ctx.font = 'bold 54px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('BUKUKU', 256, 200);

  ctx.font = 'bold 20px Georgia, serif';
  ctx.fillStyle = '#e5c158';
  ctx.fillText('TATA BUKU & JURNAL', 256, 245);

  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(150, 270);
  ctx.lineTo(362, 270);
  ctx.stroke();

  ctx.font = '18px monospace';
  ctx.fillStyle = '#d8e9dc';
  ctx.fillText('DEBIT  |  KREDIT', 256, 315);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function createPaperLinesTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#cfc7b4';
  ctx.lineWidth = 1;
  for (let y = 12; y < 256; y += 12) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function createWoodGrainBump(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 3) {
    const shade = 110 + Math.round(Math.sin(y * 0.22) * 24);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(0, y, 256, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

export function ThreeBalanceScene({
  metrics,
  fullScreen = false,
  onToggleFullScreen,
}: ThreeBalanceSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const metricsRef = useRef<ThreeSceneMetrics>(metrics);
  metricsRef.current = metrics;

  const [preset, setPreset] = useState<CameraPresetKey>('isometrik');
  const [explodeLevel, setExplodeLevel] = useState<number>(0);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [contextLost, setContextLost] = useState<boolean>(false);

  const explodeTargetRef = useRef<number>(0);
  explodeTargetRef.current = explodeLevel;

  const presetHandlerRef = useRef<((key: CameraPresetKey) => void) | null>(null);
  const syncDataRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    syncDataRef.current?.();
  }, [metrics]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    const bgColor = new THREE.Color('#EFECE5');
    scene.background = bgColor;
    scene.fog = new THREE.FogExp2(0xefece5, 0.032);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 60);
    camera.position.set(...CAMERA_PRESETS.isometrik.pos);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    container.innerHTML = '';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTex = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    scene.environment = envTex;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    // Three-point warm/cool studio lighting rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0xb8a88a, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1db, 2.2);
    keyLight.position.set(5.5, 8.5, 4.5);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 22;
    keyLight.shadow.camera.left = -5.5;
    keyLight.shadow.camera.right = 5.5;
    keyLight.shadow.camera.top = 5.5;
    keyLight.shadow.camera.bottom = -5.5;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xd9e8ff, 0.9);
    rimLight.position.set(-5, 4.5, -5);
    scene.add(rimLight);

    // Materials library (distinct roughness >= 0.25 delta between adjacent surfaces)
    const woodBump = createWoodGrainBump(maxAniso);
    const coverTex = createLedgerCoverTexture(maxAniso);
    const paperTex = createPaperLinesTexture(maxAniso);
    const shadowTex = createContactShadowTexture();

    const travertineMat = new THREE.MeshStandardMaterial({
      color: 0xe6e1d6,
      roughness: 0.86,
      metalness: 0.02,
      bumpMap: woodBump,
      bumpScale: 0.005,
    });
    const mahoganyMat = new THREE.MeshStandardMaterial({
      color: 0x4b2919,
      roughness: 0.72,
      metalness: 0.06,
      bumpMap: woodBump,
      bumpScale: 0.015,
    });
    const brassMat = new THREE.MeshPhysicalMaterial({
      color: 0xd4a948,
      roughness: 0.2,
      metalness: 0.92,
      clearcoat: 0.35,
      clearcoatRoughness: 0.2,
    });
    const darkBronzeMat = new THREE.MeshStandardMaterial({
      color: 0x5c4727,
      roughness: 0.38,
      metalness: 0.82,
    });
    const leatherCoverMat = new THREE.MeshStandardMaterial({
      map: coverTex,
      roughness: 0.78,
      metalness: 0.05,
    });
    const spineLeatherMat = new THREE.MeshStandardMaterial({
      color: 0x114424,
      roughness: 0.74,
      metalness: 0.05,
    });
    const paperBlockMat = new THREE.MeshStandardMaterial({
      map: paperTex,
      roughness: 0.9,
      metalness: 0.0,
    });
    const silkRibbonMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      roughness: 0.65,
      metalness: 0.05,
    });
    const inkwellGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      roughness: 0.14,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });
    const kasCoinMat = new THREE.MeshStandardMaterial({
      color: 0x15803d,
      roughness: 0.26,
      metalness: 0.76,
    });
    const bankCoinMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.22,
      metalness: 0.9,
    });
    const ewalletCoinMat = new THREE.MeshStandardMaterial({
      color: 0x0f766e,
      roughness: 0.24,
      metalness: 0.82,
    });
    const shadowPlaneMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    const disposables: Array<{ dispose: () => void }> = [
      woodBump,
      coverTex,
      paperTex,
      shadowTex,
      travertineMat,
      mahoganyMat,
      brassMat,
      darkBronzeMat,
      leatherCoverMat,
      spineLeatherMat,
      paperBlockMat,
      silkRibbonMat,
      inkwellGlassMat,
      kasCoinMat,
      bankCoinMat,
      ewalletCoinMat,
      shadowPlaneMat,
    ];

    // 1. Ground Studio Plinth
    const floorGroup = new THREE.Group();
    const plinthGeo = new THREE.CylinderGeometry(5.2, 5.4, 0.22, 48);
    disposables.push(plinthGeo);
    const plinthMesh = new THREE.Mesh(plinthGeo, travertineMat);
    plinthMesh.position.y = -0.11;
    plinthMesh.receiveShadow = true;
    floorGroup.add(plinthMesh);

    const floorRingGeo = new THREE.RingGeometry(4.95, 5.02, 48);
    disposables.push(floorRingGeo);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xb89648,
      roughness: 0.28,
      metalness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    disposables.push(ringMat);
    const floorRing = new THREE.Mesh(floorRingGeo, ringMat);
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = 0.005;
    floorGroup.add(floorRing);
    scene.add(floorGroup);

    // 2. Composite Scale Monument Group (Timbangan Neraca Klasik)
    const scaleRoot = new THREE.Group();
    scaleRoot.position.set(-0.65, 0, 0);
    scene.add(scaleRoot);

    const scaleShadowGeo = new THREE.CircleGeometry(1.45, 32);
    disposables.push(scaleShadowGeo);
    const scaleShadow = new THREE.Mesh(scaleShadowGeo, shadowPlaneMat);
    scaleShadow.rotation.x = -Math.PI / 2;
    scaleShadow.position.set(0, 0.015, 0);
    scaleRoot.add(scaleShadow);

    // Octagonal beveled mahogany base
    const baseShape = new THREE.Shape();
    const octR = 0.92;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * octR;
      const y = Math.sin(a) * octR;
      if (i === 0) baseShape.moveTo(x, y);
      else baseShape.lineTo(x, y);
    }
    baseShape.closePath();
    const baseGeo = new THREE.ExtrudeGeometry(baseShape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
    });
    baseGeo.rotateX(-Math.PI / 2);
    disposables.push(baseGeo);
    const baseMesh = new THREE.Mesh(baseGeo, mahoganyMat);
    baseMesh.position.y = 0.04;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    scaleRoot.add(baseMesh);

    // Stepped upper brass collar + fluted central column (LatheGeometry)
    const columnPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.46, 0.0),
      new THREE.Vector2(0.42, 0.08),
      new THREE.Vector2(0.24, 0.14),
      new THREE.Vector2(0.14, 0.28),
      new THREE.Vector2(0.11, 0.95),
      new THREE.Vector2(0.16, 1.05),
      new THREE.Vector2(0.09, 1.15),
      new THREE.Vector2(0.08, 1.85),
      new THREE.Vector2(0.15, 1.94),
      new THREE.Vector2(0.06, 2.08),
      new THREE.Vector2(0.0, 2.15),
    ];
    const columnGeo = new THREE.LatheGeometry(columnPts, 24);
    disposables.push(columnGeo);
    const columnMesh = new THREE.Mesh(columnGeo, brassMat);
    columnMesh.position.y = 0.22;
    columnMesh.castShadow = true;
    scaleRoot.add(columnMesh);

    // Decorative fulcrum housing & pointer dial
    const dialGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 24);
    dialGeo.rotateX(Math.PI / 2);
    disposables.push(dialGeo);
    const dialMesh = new THREE.Mesh(dialGeo, darkBronzeMat);
    dialMesh.position.set(0, 2.1, 0.04);
    scaleRoot.add(dialMesh);

    // Pivoting Balance Beam Group
    const beamPivot = new THREE.Group();
    beamPivot.position.set(0, 2.1, 0);
    scaleRoot.add(beamPivot);

    const beamShape = new THREE.Shape();
    beamShape.moveTo(-1.32, 0.02);
    beamShape.lineTo(-0.22, 0.1);
    beamShape.lineTo(0, 0.14);
    beamShape.lineTo(0.22, 0.1);
    beamShape.lineTo(1.32, 0.02);
    beamShape.lineTo(1.32, -0.04);
    beamShape.lineTo(0.22, -0.05);
    beamShape.lineTo(0, -0.08);
    beamShape.lineTo(-0.22, -0.05);
    beamShape.lineTo(-1.32, -0.04);
    beamShape.closePath();

    const beamGeo = new THREE.ExtrudeGeometry(beamShape, {
      depth: 0.07,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 2,
    });
    beamGeo.translate(0, 0, -0.035);
    disposables.push(beamGeo);
    const beamMesh = new THREE.Mesh(beamGeo, brassMat);
    beamMesh.castShadow = true;
    beamPivot.add(beamMesh);

    // Center needle pointer
    const needleGeo = new THREE.ConeGeometry(0.03, 0.38, 12);
    disposables.push(needleGeo);
    const needleMesh = new THREE.Mesh(needleGeo, darkBronzeMat);
    needleMesh.position.set(0, 0.24, 0.04);
    beamPivot.add(needleMesh);

    // Helper to build suspension cradle + concave pan with exact vector-aligned rods
    const rodUnitGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 8);
    const panPts = [
      new THREE.Vector2(0.0, -0.04),
      new THREE.Vector2(0.45, -0.03),
      new THREE.Vector2(0.62, 0.03),
      new THREE.Vector2(0.64, 0.06),
      new THREE.Vector2(0.59, 0.06),
      new THREE.Vector2(0.42, 0.0),
      new THREE.Vector2(0.0, 0.0),
    ];
    const panGeo = new THREE.LatheGeometry(panPts, 28);
    const ringHookGeo = new THREE.TorusGeometry(0.05, 0.015, 8, 16);
    disposables.push(rodUnitGeo, panGeo, ringHookGeo);

    const upVec = new THREE.Vector3(0, 1, 0);
    const hookAnchor = new THREE.Vector3(0, -0.05, 0);

    function createPanAssembly(xOffset: number): THREE.Group {
      const panGroup = new THREE.Group();
      panGroup.position.set(xOffset, 0, 0);

      const hook = new THREE.Mesh(ringHookGeo, brassMat);
      hook.position.set(0, -0.04, 0);
      panGroup.add(hook);

      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        const rimAnchor = new THREE.Vector3(
          Math.cos(angle) * 0.58,
          -0.95,
          Math.sin(angle) * 0.58,
        );
        const dir = rimAnchor.clone().sub(hookAnchor);
        const len = dir.length();
        const mid = hookAnchor.clone().add(rimAnchor).multiplyScalar(0.5);

        const rod = new THREE.Mesh(rodUnitGeo, darkBronzeMat);
        rod.position.copy(mid);
        rod.scale.set(1, len, 1);
        rod.quaternion.setFromUnitVectors(upVec, dir.normalize());
        panGroup.add(rod);
      }

      const pan = new THREE.Mesh(panGeo, brassMat);
      pan.position.set(0, -1.0, 0);
      pan.castShadow = true;
      pan.receiveShadow = true;
      panGroup.add(pan);

      return panGroup;
    }

    const leftPan = createPanAssembly(-1.25);
    const rightPan = createPanAssembly(1.25);
    beamPivot.add(leftPan);
    beamPivot.add(rightPan);

    // Left Pan Dynamic Coin Stacks (Kas, Bank, E-Wallet)
    const coinGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.04, 20);
    disposables.push(coinGeo);

    const leftCoinsGroup = new THREE.Group();
    leftCoinsGroup.position.set(0, -0.99, 0);
    leftPan.add(leftCoinsGroup);

    // Right Pan Dynamic Weights (Modal & Utang)
    const weightPts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.18, 0),
      new THREE.Vector2(0.16, 0.04),
      new THREE.Vector2(0.14, 0.22),
      new THREE.Vector2(0.08, 0.26),
      new THREE.Vector2(0.11, 0.33),
      new THREE.Vector2(0.0, 0.35),
    ];
    const weightGeo = new THREE.LatheGeometry(weightPts, 20);
    disposables.push(weightGeo);

    const rightWeightsGroup = new THREE.Group();
    rightWeightsGroup.position.set(0, -0.99, 0);
    rightPan.add(rightWeightsGroup);

    const modalWeight = new THREE.Mesh(weightGeo, brassMat);
    modalWeight.position.set(-0.14, 0, 0.06);
    modalWeight.castShadow = true;
    rightWeightsGroup.add(modalWeight);

    const debtWeight = new THREE.Mesh(weightGeo, darkBronzeMat);
    debtWeight.position.set(0.18, 0, -0.08);
    debtWeight.castShadow = true;
    rightWeightsGroup.add(debtWeight);

    // 3. Bound Ledger Book ("BukuKu" Group)
    const bookGroup = new THREE.Group();
    bookGroup.position.set(1.32, 0, 0.08);
    bookGroup.rotation.y = -0.35;
    scene.add(bookGroup);

    const bookShadowGeo = new THREE.CircleGeometry(1.15, 28);
    disposables.push(bookShadowGeo);
    const bookShadow = new THREE.Mesh(bookShadowGeo, shadowPlaneMat);
    bookShadow.rotation.x = -Math.PI / 2;
    bookShadow.position.set(0, 0.015, 0);
    bookGroup.add(bookShadow);

    const bottomBoardGeo = new THREE.BoxGeometry(1.22, 0.05, 1.56);
    const pagesBlockGeo = new THREE.BoxGeometry(1.12, 0.22, 1.46);
    const topBoardGeo = new THREE.BoxGeometry(1.22, 0.05, 1.56);
    const spineGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.56, 16, 1, false, Math.PI / 2, Math.PI);
    spineGeo.rotateX(Math.PI / 2);
    const cornerGuardGeo = new THREE.BoxGeometry(0.12, 0.07, 0.12);
    const ribbonGeo = new THREE.BoxGeometry(0.06, 0.015, 0.42);
    disposables.push(
      bottomBoardGeo,
      pagesBlockGeo,
      topBoardGeo,
      spineGeo,
      cornerGuardGeo,
      ribbonGeo,
    );

    const bottomBoard = new THREE.Mesh(bottomBoardGeo, spineLeatherMat);
    bottomBoard.position.set(0, 0.025, 0);
    bottomBoard.castShadow = true;
    bottomBoard.receiveShadow = true;
    bookGroup.add(bottomBoard);

    const pagesBlock = new THREE.Mesh(pagesBlockGeo, paperBlockMat);
    pagesBlock.position.set(0.03, 0.16, 0);
    pagesBlock.castShadow = true;
    bookGroup.add(pagesBlock);

    const topBoard = new THREE.Mesh(topBoardGeo, [
      spineLeatherMat,
      spineLeatherMat,
      leatherCoverMat,
      spineLeatherMat,
      spineLeatherMat,
      spineLeatherMat,
    ]);
    topBoard.position.set(0, 0.295, 0);
    topBoard.castShadow = true;
    bookGroup.add(topBoard);

    const spineMesh = new THREE.Mesh(spineGeo, spineLeatherMat);
    spineMesh.position.set(-0.56, 0.16, 0);
    spineMesh.castShadow = true;
    bookGroup.add(spineMesh);

    const corners: Array<[number, number]> = [
      [0.57, 0.74],
      [0.57, -0.74],
    ];
    for (const [cx, cz] of corners) {
      const corner = new THREE.Mesh(cornerGuardGeo, brassMat);
      corner.position.set(cx, 0.3, cz);
      bookGroup.add(corner);
    }

    const ribbon = new THREE.Mesh(ribbonGeo, silkRibbonMat);
    ribbon.position.set(0.18, 0.04, 0.9);
    ribbon.rotation.y = 0.12;
    bookGroup.add(ribbon);

    // 4. Inkwell & Brass Fountain Pen Group
    const deskSetGroup = new THREE.Group();
    deskSetGroup.position.set(1.25, 0, -1.05);
    scene.add(deskSetGroup);

    const inkPts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.24, 0),
      new THREE.Vector2(0.26, 0.14),
      new THREE.Vector2(0.14, 0.28),
      new THREE.Vector2(0.14, 0.36),
      new THREE.Vector2(0.17, 0.38),
      new THREE.Vector2(0, 0.38),
    ];
    const inkGeo = new THREE.LatheGeometry(inkPts, 8);
    const penPts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.015, 0.08),
      new THREE.Vector2(0.045, 0.24),
      new THREE.Vector2(0.045, 0.85),
      new THREE.Vector2(0.025, 0.98),
      new THREE.Vector2(0, 1.0),
    ];
    const penGeo = new THREE.LatheGeometry(penPts, 14);
    disposables.push(inkGeo, penGeo);

    const inkwell = new THREE.Mesh(inkGeo, inkwellGlassMat);
    inkwell.castShadow = true;
    deskSetGroup.add(inkwell);

    const penMesh = new THREE.Mesh(penGeo, brassMat);
    penMesh.position.set(-0.2, 0.045, 0.38);
    penMesh.rotation.set(Math.PI / 2, 0, 0.55);
    penMesh.castShadow = true;
    deskSetGroup.add(penMesh);

    // Dynamic update helper for coin stacks & beam target tilt
    let targetBeamTilt = 0;

    function rebuildCoinsForMetrics() {
      while (leftCoinsGroup.children.length > 0) {
        leftCoinsGroup.remove(leftCoinsGroup.children[0]);
      }

      const m = metricsRef.current;
      const maxWallet = Math.max(m.kasBalance, m.bankBalance, m.ewalletBalance, 1);

      const stacks = [
        { val: m.kasBalance, x: -0.22, z: 0.14, mat: kasCoinMat },
        { val: m.bankBalance, x: 0.04, z: -0.18, mat: bankCoinMat },
        { val: m.ewalletBalance, x: 0.24, z: 0.12, mat: ewalletCoinMat },
      ];

      for (const st of stacks) {
        const count = Math.max(1, Math.min(11, Math.round((Math.max(0, st.val) / maxWallet) * 10) + 1));
        for (let i = 0; i < count; i++) {
          const coin = new THREE.Mesh(coinGeo, st.mat);
          coin.position.set(st.x, 0.025 + i * 0.042, st.z);
          coin.castShadow = true;
          leftCoinsGroup.add(coin);
        }
      }

      // Scale weights cleanly from equity & debt
      const totalRight = Math.max(1, m.totalEquity + m.totalDebt);
      const modalRatio = Math.max(0.55, Math.min(1.45, (m.totalEquity / totalRight) * 1.4));
      const debtRatio = Math.max(0.4, Math.min(1.3, (m.totalDebt / totalRight) * 1.6 + 0.4));
      modalWeight.scale.setScalar(modalRatio);
      debtWeight.scale.setScalar(debtRatio);

      // Gentle accounting balance needle tilt (balanced = level 0; surplus tilts slightly left)
      const diffRatio = (m.totalAssets - (m.totalEquity + m.totalDebt)) / Math.max(1, m.totalAssets);
      targetBeamTilt = THREE.MathUtils.clamp(diffRatio * 0.22, -0.12, 0.12);
    }

    rebuildCoinsForMetrics();

    // OrbitControls + damped camera transitions
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.4;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.target.set(...CAMERA_PRESETS.isometrik.target);

    let camAnimating = false;
    let desiredCamPos = new THREE.Vector3(...CAMERA_PRESETS.isometrik.pos);
    let desiredTarget = new THREE.Vector3(...CAMERA_PRESETS.isometrik.target);

    let currentExplode = 0;
    let currentTilt = 0;

    // Coalesced on-demand renderer + software WebGL afterDraw pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
        lastTime = now;

        // Exponential damping for camera presets
        if (camAnimating) {
          const factor = 1 - Math.exp(-7 * dt);
          camera.position.lerp(desiredCamPos, factor);
          controls.target.lerp(desiredTarget, factor);
          if (
            camera.position.distanceTo(desiredCamPos) < 0.015 &&
            controls.target.distanceTo(desiredTarget) < 0.015
          ) {
            camera.position.copy(desiredCamPos);
            controls.target.copy(desiredTarget);
            camAnimating = false;
          } else {
            renderDirty = true;
          }
        }

        // Exponential damping for beam tilt & exploded view
        const targetExp = explodeTargetRef.current;
        if (Math.abs(currentExplode - targetExp) > 0.002) {
          currentExplode = THREE.MathUtils.damp(currentExplode, targetExp, 7, dt);
          renderDirty = true;
        } else {
          currentExplode = targetExp;
        }

        if (Math.abs(currentTilt - targetBeamTilt) > 0.001) {
          currentTilt = THREE.MathUtils.damp(currentTilt, targetBeamTilt, 6, dt);
          renderDirty = true;
        } else {
          currentTilt = targetBeamTilt;
        }

        // Apply exploded offsets cleanly
        beamPivot.position.y = 2.1 + currentExplode * 0.55;
        beamPivot.rotation.z = currentTilt;
        leftPan.rotation.z = -currentTilt;
        rightPan.rotation.z = -currentTilt;
        topBoard.position.y = 0.295 + currentExplode * 0.42;
        pagesBlock.position.y = 0.16 + currentExplode * 0.18;

        controls.update();
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    const onControlStart = () => {
      camAnimating = false;
      requestRender();
    };
    const onControlChange = () => {
      requestRender();
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('change', onControlChange);

    presetHandlerRef.current = (key: CameraPresetKey) => {
      const p = CAMERA_PRESETS[key];
      desiredCamPos.set(...p.pos);
      desiredTarget.set(...p.target);
      camAnimating = true;
      requestRender();
    };

    syncDataRef.current = () => {
      rebuildCoinsForMetrics();
      requestRender();
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Initial render
    requestRender();

    const onResize = () => {
      if (!container || disposed) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 420;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', onControlChange);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      envTex.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, []);

  // Trigger re-render when explode slider changes
  useEffect(() => {
    syncDataRef.current?.();
  }, [explodeLevel]);

  const handleSelectPreset = (key: CameraPresetKey) => {
    setPreset(key);
    presetHandlerRef.current?.(key);
  };

  return (
    <div
      className={
        fullScreen
          ? 'relative w-full h-[calc(100vh-64px)] min-h-[540px] bg-[#EFECE5] overflow-hidden'
          : 'relative w-full h-[380px] lg:h-[430px] rounded-xl border border-[#E5E2DC] bg-[#EFECE5] overflow-hidden'
      }
      data-testid="three-balance-scene"
    >
      {/* Dedicated isolated WebGL mount container */}
      <div ref={mountRef} className="w-full h-full" />

      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#EFECE5] text-[#18181B] p-6 text-center">
          <div>
            <p className="font-serif text-lg font-semibold">Visualisasi 3D dijeda sementara</p>
            <p className="text-sm text-[#57534E] mt-1">
              Konteks grafis browser sedang dipulihkan.
            </p>
          </div>
        </div>
      )}

      {/* Top-Left Minimal Spec Header (solid/rgba surface, no backdrop-filter over WebGL) */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 flex items-start justify-between gap-3">
        <div className="pointer-events-auto rounded-lg border border-[#D6D3CB] bg-[#FFFFFF]/95 px-3.5 py-2.5 shadow-sm">
          <p className="text-xs font-medium text-[#57534E]">Neraca 3D &amp; Buku Kas</p>
          <p className="font-mono text-sm font-semibold text-[#14532D] tabular-nums">
            Aset {formatRupiahTitle(metrics.totalAssets)}
          </p>
        </div>

        {onToggleFullScreen && (
          <button
            type="button"
            onClick={onToggleFullScreen}
            aria-label={fullScreen ? 'Kecilkan tampilan 3D' : 'Perluas tampilan 3D'}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-[#D6D3CB] bg-[#FFFFFF]/95 px-3 py-2 text-xs font-semibold text-[#18181B] shadow-sm hover:bg-[#F3F1EB] transition-colors whitespace-nowrap shrink-0"
          >
            {fullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{fullScreen ? 'Tutup Layar Penuh' : 'Layar Penuh 3D'}</span>
          </button>
        )}
      </div>

      {/* Collapsible Bottom Control Dock (solid/rgba surface, zero backdrop-blur) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(94%,740px)] flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="inline-flex items-center gap-1 rounded-t-lg border border-b-0 border-[#D6D3CB] bg-[#FFFFFF]/95 px-3 py-1 text-[11px] font-semibold text-[#57534E] hover:text-[#18181B] transition-colors"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{dockCollapsed ? 'Tampilkan Kontrol' : 'Sembunyikan Kontrol'}</span>
        </button>

        {!dockCollapsed && (
          <div className="w-full rounded-xl border border-[#D6D3CB] bg-[#FFFFFF]/95 px-4 py-2.5 shadow-md flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 bg-[#F3F1EB] p-1 rounded-lg">
              {(Object.keys(CAMERA_PRESETS) as CameraPresetKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelectPreset(key)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    preset === key
                      ? 'bg-[#14532D] text-white'
                      : 'text-[#57534E] hover:text-[#18181B]'
                  }`}
                >
                  {CAMERA_PRESETS[key].label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-[#57534E] whitespace-nowrap">
                <span>Bedah 3D</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={explodeLevel}
                  onChange={(e) => setExplodeLevel(Number(e.target.value))}
                  aria-label="Geser bedah komponen 3D"
                  className="w-24 accent-[#14532D]"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  setExplodeLevel(0);
                  handleSelectPreset('isometrik');
                }}
                aria-label="Reset kamera 3D"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#18181B] border border-[#D6D3CB] rounded-md hover:bg-[#F3F1EB] whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
