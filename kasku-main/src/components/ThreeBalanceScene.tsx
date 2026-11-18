import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Maximize2, Minimize2, RotateCcw, Eye, EyeOff, ArrowUpRight } from 'lucide-react';
import { formatRupiahInput } from '../core/format';

export interface ThreeBalanceSceneProps {
  kas: number;
  bank: number;
  ewallet: number;
  piutang: number;
  utang: number;
  modalAwal: number;
  monthlyNet: number;
  onNavigate?: (tab: 'catat' | 'buku' | 'hutang') => void;
}

type CameraPreset = 'isometric' | 'neraca' | 'dompet' | 'buku';

interface CalloutPin {
  id: 'aset' | 'pasiva' | 'buku' | 'tinta';
  title: string;
  value: string;
  subtitle: string;
  actionLabel: string;
  targetTab: 'catat' | 'buku' | 'hutang';
  worldPos: THREE.Vector3;
}

export function ThreeBalanceScene({
  kas,
  bank,
  ewallet,
  piutang,
  utang,
  modalAwal,
  monthlyNet,
  onNavigate,
}: ThreeBalanceSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);

  const [preset, setPreset] = useState<CameraPreset>('isometric');
  const [explodeRatio, setExplodeRatio] = useState<number>(0);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [selectedPin, setSelectedPin] = useState<CalloutPin['id'] | null>(null);
  const [pinCoords, setPinCoords] = useState<Record<string, { x: number; y: number; visible: boolean }>>({});

  // Refs untuk nilai dinamis di dalam render loop tanpa re-init Three.js
  const stateRef = useRef({
    kas,
    bank,
    ewallet,
    piutang,
    utang,
    modalAwal,
    monthlyNet,
    preset,
    explodeRatio,
  });

  useEffect(() => {
    stateRef.current = {
      kas,
      bank,
      ewallet,
      piutang,
      utang,
      modalAwal,
      monthlyNet,
      preset,
      explodeRatio,
    };
  }, [kas, bank, ewallet, piutang, utang, modalAwal, monthlyNet, preset, explodeRatio]);

  const totalAset = Math.max(0, kas + bank + ewallet + piutang);
  const totalPasiva = Math.max(0, modalAwal + utang + monthlyNet);

  const callouts: CalloutPin[] = [
    {
      id: 'aset',
      title: 'Piringan Aset & Likuiditas',
      value: `Rp${formatRupiahInput(totalAset)}`,
      subtitle: `Kas Rp${formatRupiahInput(kas)} · Bank Rp${formatRupiahInput(bank)}`,
      actionLabel: 'Catat Pemasukan',
      targetTab: 'catat',
      worldPos: new THREE.Vector3(-1.45, 1.55, 0),
    },
    {
      id: 'pasiva',
      title: 'Piringan Kewajiban & Ekuitas',
      value: `Rp${formatRupiahInput(totalPasiva)}`,
      subtitle: `Utang Aktif Rp${formatRupiahInput(utang)}`,
      actionLabel: 'Kelola Utang',
      targetTab: 'hutang',
      worldPos: new THREE.Vector3(1.45, 1.55, 0),
    },
    {
      id: 'buku',
      title: 'Kitab Jurnal Double-Entry',
      value: 'Debit = Kredit',
      subtitle: 'Catatan mutasi buku besar aktif',
      actionLabel: 'Buka Buku Besar',
      targetTab: 'buku',
      worldPos: new THREE.Vector3(0.95, 0.35, 1.25),
    },
    {
      id: 'tinta',
      title: 'Indikator Laba / Rugi Bulan Ini',
      value: `${monthlyNet >= 0 ? '+' : '-'}Rp${formatRupiahInput(Math.abs(monthlyNet))}`,
      subtitle: monthlyNet >= 0 ? 'Status: Surplus (Hijau Zamrud)' : 'Status: Defisit (Merah Marun)',
      actionLabel: 'Lihat Laporan',
      targetTab: 'buku',
      worldPos: new THREE.Vector3(1.45, 0.65, 0.65),
    },
  ];

  // Toggle Fullscreen
  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    const width = wrapper.clientWidth || 600;
    const height = wrapper.clientHeight || 380;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#F5F2EB');

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 3.3, 6.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrapper.innerHTML = '';
    wrapper.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    controls.minDistance = 2.8;
    controls.maxDistance = 10.5;
    controls.target.set(0, 0.95, 0);

    // 2. Pencahayaan Studio Hangat
    const ambientLight = new THREE.AmbientLight('#FFFDF9', 1.35);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#FFF7E6', 1.9);
    dirLight.position.set(4.5, 7.5, 5.0);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 18;
    const d = 4.5;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight('#D1FAE5', 0.55);
    rimLight.position.set(-4, 3, -4);
    scene.add(rimLight);

    // 3. Alas Meja & Lingkaran Dekoratif
    const deskGeo = new THREE.CircleGeometry(4.6, 64);
    const deskMat = new THREE.MeshStandardMaterial({ color: '#FAF8F3', roughness: 0.9 });
    const deskMesh = new THREE.Mesh(deskGeo, deskMat);
    deskMesh.rotation.x = -Math.PI / 2;
    deskMesh.receiveShadow = true;
    scene.add(deskMesh);

    const ringGeo = new THREE.RingGeometry(3.35, 3.41, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#D6C7A9', side: THREE.DoubleSide });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.005;
    scene.add(ringMesh);

    // Material Kuningan & Kayu
    const brassMat = new THREE.MeshStandardMaterial({
      color: '#D4AF37',
      metalness: 0.78,
      roughness: 0.24,
    });
    const darkBrassMat = new THREE.MeshStandardMaterial({
      color: '#856514',
      metalness: 0.75,
      roughness: 0.35,
    });
    const woodMat = new THREE.MeshStandardMaterial({
      color: '#7C5845',
      roughness: 0.65,
    });

    // 4. Grup Utama Timbangan Neraca
    const scaleRoot = new THREE.Group();
    scene.add(scaleRoot);

    // Alas Kayu Segi Delapan
    const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.88, 0.22, 8), woodMat);
    baseMesh.position.y = 0.11;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    scaleRoot.add(baseMesh);

    // Tiang Tengah
    const pillarGroup = new THREE.Group();
    scaleRoot.add(pillarGroup);

    const pillarCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.16, 24), brassMat);
    pillarCollar.position.y = 0.28;
    pillarCollar.castShadow = true;
    pillarGroup.add(pillarCollar);

    const pillarShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.95, 20), brassMat);
    pillarShaft.position.y = 1.25;
    pillarShaft.castShadow = true;
    pillarGroup.add(pillarShaft);

    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 16), brassMat);
    finial.position.y = 2.36;
    pillarGroup.add(finial);

    // Lengan Timbangan (Beam) & Jarum Indikator
    const beamGroup = new THREE.Group();
    beamGroup.position.set(0, 2.08, 0);
    scaleRoot.add(beamGroup);

    const beamBar = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.08, 0.09), brassMat);
    beamBar.castShadow = true;
    beamGroup.add(beamBar);

    const pivotHub = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 20), darkBrassMat);
    beamGroup.add(pivotHub);

    const needle = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.42, 12), darkBrassMat);
    needle.position.y = 0.24;
    beamGroup.add(needle);

    // Piringan Kiri (Aset) & Piringan Kanan (Pasiva)
    const createPanAssembly = () => {
      const panGroup = new THREE.Group();

      // 3 Tali Gantung
      for (let i = 0; i < 3; i++) {
        const angle = (i * Math.PI * 2) / 3;
        const wireGeo = new THREE.CylinderGeometry(0.01, 0.01, 1.12, 8);
        const wire = new THREE.Mesh(wireGeo, darkBrassMat);
        wire.position.set(Math.cos(angle) * 0.28, -0.52, Math.sin(angle) * 0.28);
        wire.lookAt(0, 0, 0);
        wire.rotateX(Math.PI / 2);
        panGroup.add(wire);
      }

      // Piringan Datar
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.52, 0.06, 32), brassMat);
      dish.position.y = -1.06;
      dish.castShadow = true;
      dish.receiveShadow = true;
      panGroup.add(dish);

      return panGroup;
    };

    const leftPan = createPanAssembly();
    leftPan.position.set(-1.45, 0, 0);
    beamGroup.add(leftPan);

    const rightPan = createPanAssembly();
    rightPan.position.set(1.45, 0, 0);
    beamGroup.add(rightPan);

    // 5. InstancedMesh Tumpukan Koin di Piringan Kiri (Kas, Bank, E-Wallet)
    const MAX_COINS = 36;
    const coinGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.036, 20);
    const coinMat = new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.3 });
    const coinInstanced = new THREE.InstancedMesh(coinGeo, coinMat, MAX_COINS);
    coinInstanced.castShadow = true;
    coinInstanced.receiveShadow = true;
    leftPan.add(coinInstanced);

    // Anak Timbangan di Piringan Kanan (Modal & Utang)
    const equityWeight = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.36, 20), brassMat);
    equityWeight.position.set(-0.14, -0.86, 0);
    equityWeight.castShadow = true;
    rightPan.add(equityWeight);

    const debtWeight = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.24, 18), darkBrassMat);
    debtWeight.position.set(0.24, -0.92, 0.12);
    debtWeight.castShadow = true;
    rightPan.add(debtWeight);

    // 6. Kitab BukuKu 3D & Wadah Tinta Laba/Rugi
    const bookGroup = new THREE.Group();
    bookGroup.position.set(0.95, 0.08, 1.25);
    bookGroup.rotation.y = -0.35;
    scene.add(bookGroup);

    const coverMat = new THREE.MeshStandardMaterial({ color: '#14532D', roughness: 0.55 });
    const pageMat = new THREE.MeshStandardMaterial({ color: '#FAF8F3', roughness: 0.85 });

    const bookCover = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.16, 0.85), coverMat);
    bookCover.castShadow = true;
    bookCover.receiveShadow = true;
    bookGroup.add(bookCover);

    const bookPages = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.12, 0.78), pageMat);
    bookPages.position.x = 0.02;
    bookGroup.add(bookPages);

    const ribbon = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.02, 0.28),
      new THREE.MeshStandardMaterial({ color: '#DC2626' })
    );
    ribbon.position.set(0.18, -0.06, 0.48);
    bookGroup.add(ribbon);

    // Wadah Tinta (Inkwell)
    const inkwellGroup = new THREE.Group();
    inkwellGroup.position.set(1.45, 0.14, 0.65);
    scene.add(inkwellGroup);

    const inkGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 0.28, 20),
      new THREE.MeshStandardMaterial({
        color: '#334155',
        metalness: 0.3,
        roughness: 0.2,
        transparent: true,
        opacity: 0.82,
      })
    );
    inkGlass.castShadow = true;
    inkwellGroup.add(inkGlass);

    const inkLiquidMat = new THREE.MeshStandardMaterial({
      color: '#10B981',
      emissive: '#059669',
      emissiveIntensity: 0.45,
      roughness: 0.2,
    });
    const inkLiquid = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.16, 18), inkLiquidMat);
    inkLiquid.position.y = -0.04;
    inkwellGroup.add(inkLiquid);

    // 7. Variabel Fisika Pegas Teredam (Damped Harmonic Spring)
    let currentAngle = 0;
    let angularVelocity = 0;
    const stiffness = 28.0;
    const damping = 5.2;

    const dummy = new THREE.Object3D();
    const colorKas = new THREE.Color('#15803D');
    const colorBank = new THREE.Color('#D97706');
    const colorEwallet = new THREE.Color('#0D9488');

    const cameraGoals: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
      isometric: { pos: [0, 3.3, 6.2], target: [0, 0.95, 0] },
      neraca: { pos: [0, 2.35, 5.1], target: [0, 1.35, 0] },
      dompet: { pos: [-2.4, 2.55, 3.6], target: [-1.35, 1.15, 0] },
      buku: { pos: [2.3, 2.2, 3.8], target: [1.05, 0.35, 1.05] },
    };

    let prevPreset: CameraPreset = stateRef.current.preset;
    let frameId = 0;
    let lastTime = performance.now();
    let frameCounter = 0;

    // 8. Render Loop Utama
    const animate = (now: number) => {
      frameId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const s = stateRef.current;

      // Hitung target kemiringan timbangan berdasarkan selisih aset & pasiva
      const asetVal = Math.max(0, s.kas + s.bank + s.ewallet + s.piutang);
      const pasivaVal = Math.max(0, s.modalAwal + s.utang + s.monthlyNet);
      const diffRatio =
        asetVal + pasivaVal > 0 ? (asetVal - pasivaVal) / Math.max(asetVal, pasivaVal, 1) : 0;
      const targetAngle = THREE.MathUtils.clamp(diffRatio * 0.24, -0.24, 0.24);

      // Integrasi Fisika Pegas Teredam
      const springForce = (targetAngle - currentAngle) * stiffness;
      const dampingForce = -angularVelocity * damping;
      angularVelocity += (springForce + dampingForce) * dt;
      currentAngle += angularVelocity * dt;

      beamGroup.rotation.z = currentAngle;
      // Piringan tetap tegak lurus terhadap gravitasi (counter-rotate)
      leftPan.rotation.z = -currentAngle;
      rightPan.rotation.z = -currentAngle;

      // Efek Mode Bedah 3D (Explode View)
      const exp = s.explodeRatio;
      beamGroup.position.y = 2.08 + exp * 0.45;
      leftPan.position.x = -1.45 - exp * 0.35;
      rightPan.position.x = 1.45 + exp * 0.35;
      bookGroup.position.set(0.95 + exp * 0.35, 0.08 + exp * 0.2, 1.25 + exp * 0.35);
      inkwellGroup.position.set(1.45 + exp * 0.45, 0.14 + exp * 0.25, 0.65 + exp * 0.15);

      // Update Tumpukan Koin (InstancedMesh)
      const unitScale = Math.max(asetVal / 12, 50000);
      const kasCount = Math.min(12, s.kas > 0 ? Math.max(1, Math.round(s.kas / unitScale)) : 0);
      const bankCount = Math.min(12, s.bank > 0 ? Math.max(1, Math.round(s.bank / unitScale)) : 0);
      const ewalletCount = Math.min(12, s.ewallet > 0 ? Math.max(1, Math.round(s.ewallet / unitScale)) : 0);

      let idx = 0;
      const stackConfigs = [
        { count: kasCount, x: -0.2, z: 0.05, color: colorKas },
        { count: bankCount, x: 0.15, z: -0.1, color: colorBank },
        { count: ewalletCount, x: 0.12, z: 0.2, color: colorEwallet },
      ];

      for (const stack of stackConfigs) {
        for (let c = 0; c < stack.count && idx < MAX_COINS; c++) {
          dummy.position.set(stack.x, -1.01 + c * 0.038, stack.z);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          coinInstanced.setMatrixAt(idx, dummy.matrix);
          coinInstanced.setColorAt(idx, stack.color);
          idx++;
        }
      }
      for (; idx < MAX_COINS; idx++) {
        dummy.position.set(0, -10, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        coinInstanced.setMatrixAt(idx, dummy.matrix);
      }
      coinInstanced.instanceMatrix.needsUpdate = true;
      if (coinInstanced.instanceColor) coinInstanced.instanceColor.needsUpdate = true;

      // Skala Anak Timbangan Kanan (Modal vs Utang)
      const eqScale = s.modalAwal > 0 ? THREE.MathUtils.clamp(0.8 + s.modalAwal / 5000000, 0.8, 1.45) : 0.85;
      equityWeight.scale.set(eqScale, eqScale, eqScale);
      const debtScale = s.utang > 0 ? THREE.MathUtils.clamp(0.7 + s.utang / 2000000, 0.7, 1.45) : 0.65;
      debtWeight.scale.set(debtScale, debtScale, debtScale);

      // Warna Tinta Laba / Rugi
      if (s.monthlyNet >= 0) {
        inkLiquidMat.color.set('#10B981');
        inkLiquidMat.emissive.set('#059669');
      } else {
        inkLiquidMat.color.set('#E11D48');
        inkLiquidMat.emissive.set('#9F1239');
      }

      // Transisi Kamera Preset Halus
      if (s.preset !== prevPreset) {
        prevPreset = s.preset;
      }
      const goal = cameraGoals[s.preset];
      camera.position.lerp(new THREE.Vector3(...goal.pos), 0.04);
      controls.target.lerp(new THREE.Vector3(...goal.target), 0.05);
      controls.update();

      renderer.render(scene, camera);

      // Proyeksi Koordinat Label 3D Mengambang setiap 3 frame agar hemat CPU
      frameCounter++;
      if (frameCounter % 3 === 0 && wrapper) {
        const w = wrapper.clientWidth;
        const h = wrapper.clientHeight;
        const nextCoords: Record<string, { x: number; y: number; visible: boolean }> = {};

        for (const pin of callouts) {
          const projected = pin.worldPos.clone().project(camera);
          const x = (projected.x * 0.5 + 0.5) * w;
          const y = (-(projected.y * 0.5) + 0.5) * h;
          const visible = projected.z < 1 && x >= 16 && x <= w - 16 && y >= 16 && y <= h - 16;
          nextCoords[pin.id] = { x, y, visible };
        }
        setPinCoords(nextCoords);
      }
    };

    frameId = requestAnimationFrame(animate);

    // Resize Observer Responsif
    const resizeObserver = new ResizeObserver(() => {
      if (!wrapper) return;
      const newW = wrapper.clientWidth;
      const newH = wrapper.clientHeight;
      if (newW > 0 && newH > 0) {
        camera.aspect = newW / newH;
        camera.updateProjectionMatrix();
        renderer.setSize(newW, newH);
      }
    });
    resizeObserver.observe(wrapper);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  const activeCallout = callouts.find((c) => c.id === selectedPin) ?? null;

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-2xl border border-[#D6D3CB] bg-[#F5F2EB] overflow-hidden shadow-sm transition-all ${
        isFullscreen ? 'h-screen rounded-none' : 'h-[380px] sm:h-[430px]'
      }`}
    >
      {/* Badge Ringkasan Pojok Kiri Atas */}
      <div className="absolute top-3.5 left-3.5 z-20 rounded-xl border border-[#D6D3CB]/80 bg-white/95 backdrop-blur-sm px-3.5 py-2 shadow-sm">
        <p className="text-[11px] font-medium text-[#57534E]">Neraca 3D & Buku Kas</p>
        <p className="font-mono text-sm sm:text-base font-bold text-[#14532D]">
          Aset Rp{formatRupiahInput(totalAset)}
        </p>
      </div>

      {/* Tombol Layar Penuh Pojok Kanan Atas */}
      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute top-3.5 right-3.5 z-20 inline-flex items-center gap-1.5 rounded-xl border border-[#D6D3CB]/80 bg-white/95 backdrop-blur-sm px-3 py-2 text-xs font-semibold text-[#18181B] shadow-sm hover:bg-white transition-colors"
      >
        {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        <span>{isFullscreen ? 'Keluar Layar Penuh' : 'Layar Penuh 3D'}</span>
      </button>

      {/* Canvas 3D Three.js */}
      <div ref={canvasWrapperRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Projected 3D Callout Pins (Label Mengambang Interaktif) */}
      {callouts.map((pin) => {
        const pos = pinCoords[pin.id];
        if (!pos || !pos.visible) return null;
        const isSelected = selectedPin === pin.id;
        return (
          <button
            key={pin.id}
            type="button"
            onClick={() => setSelectedPin(isSelected ? null : pin.id)}
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-md transition-transform hover:scale-105 ${
              isSelected
                ? 'bg-[#14532D] text-white ring-2 ring-white'
                : 'bg-white/90 text-[#18181B] border border-[#D6D3CB]'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
            <span>{pin.id.toUpperCase()}</span>
          </button>
        );
      })}

      {/* Kartu Detail Saat Pin 3D Diklik */}
      {activeCallout && (
        <div className="absolute top-16 left-3.5 z-20 w-64 rounded-xl border border-[#D6D3CB] bg-white/95 backdrop-blur-md p-3.5 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold text-[#57534E]">{activeCallout.title}</p>
              <p className="font-mono text-sm font-bold text-[#14532D] mt-0.5">{activeCallout.value}</p>
              <p className="text-[11px] text-[#78716C] mt-1">{activeCallout.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPin(null)}
              className="text-xs font-bold text-[#78716C] hover:text-[#18181B]"
            >
              ✕
            </button>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate(activeCallout.targetTab)}
              className="mt-2.5 w-full inline-flex items-center justify-center gap-1 rounded-lg bg-[#14532D] py-1.5 text-[11px] font-semibold text-white hover:bg-[#166534]"
            >
              <span>{activeCallout.actionLabel}</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Panel Kontrol Bawah */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center w-[94%] max-w-xl">
        <button
          type="button"
          onClick={() => setShowControls((v) => !v)}
          className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-[#D6D3CB] bg-white/95 px-3 py-1 text-[11px] font-semibold text-[#57534E] shadow-sm hover:text-[#18181B]"
        >
          {showControls ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          <span>{showControls ? 'Sembunyikan Kontrol' : 'Tampilkan Kontrol 3D'}</span>
        </button>

        {showControls && (
          <div className="w-full flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#D6D3CB] bg-white/95 backdrop-blur-md p-2 shadow-md">
            {/* Preset Kamera */}
            <div className="flex items-center gap-1 rounded-xl bg-[#F4EFE2] p-1 text-[11px] font-semibold">
              {(
                [
                  { id: 'isometric', label: 'Isometrik' },
                  { id: 'neraca', label: 'Neraca' },
                  { id: 'dompet', label: 'Dompet' },
                  { id: 'buku', label: 'Buku Kas' },
                ] as { id: CameraPreset; label: string }[]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreset(item.id)}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    preset === item.id
                      ? 'bg-[#14532D] text-white shadow-sm'
                      : 'text-[#57534E] hover:text-[#18181B]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Slider Bedah 3D & Reset */}
            <div className="flex items-center gap-2.5 px-1">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#57534E]">
                <span>Bedah 3D</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={explodeRatio}
                  onChange={(e) => setExplodeRatio(parseFloat(e.target.value))}
                  className="w-16 sm:w-20 accent-[#14532D] cursor-pointer"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  setPreset('isometric');
                  setExplodeRatio(0);
                  setSelectedPin(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-[#D6D3CB] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#18181B] hover:bg-[#FAF9F5]"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}