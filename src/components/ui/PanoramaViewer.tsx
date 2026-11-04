// 360° destination viewer — Three.js equirectangular sphere with WebXR (immersive-vr) when supported.
// Desktop: drag / scroll / arrow keys. Mobile: swipe / pinch, optional motion control. Fallback: none needed —
// the viewer runs in any WebGL browser; VR is offered only when navigator.xr supports immersive-vr.
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { X, Smartphone, Glasses, ExternalLink, RotateCcw } from 'lucide-react';
import type { Panorama } from '@/data/panoramas';
import './PanoramaViewer.css';

interface Props {
  panorama: Panorama;
  placeName: string;
  onClose: () => void;
}

type XRNav = Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean>; requestSession(mode: string, init?: object): Promise<XRSession> } };

const PanoramaViewer: React.FC<Props> = ({ panorama, placeName, onClose }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState(0);
  const [vrSupported, setVrSupported] = useState(false);
  const [inVr, setInVr] = useState(false);
  const [motion, setMotion] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const api = useRef<{ enterVr: () => void; setMotion: (on: boolean) => Promise<boolean>; reset: () => void } | null>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1100);
    const geometry = new THREE.SphereGeometry(500, 64, 40);
    geometry.scale(-1, 1, 1); // view the texture from inside
    const material = new THREE.MeshBasicMaterial({ color: 0xf4f2ef });
    scene.add(new THREE.Mesh(geometry, material));

    // Pick a texture size the GPU can hold
    const maxTex = renderer.capabilities.maxTextureSize;
    const url = maxTex >= 4096 && window.innerWidth >= 900 ? panorama.image : panorama.imageSmall;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    let texture: THREE.Texture | null = null;
    let disposed = false;
    // On failure retry once with the smaller rendition (different URL, less memory) before giving up
    const load = (src: string, isRetry: boolean) => loader.load(
      src,
      t => {
        if (disposed) { t.dispose(); return; }
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture = t;
        material.map = t;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        setStatus('ready');
      },
      e => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); },
      () => {
        if (disposed) return;
        if (!isRetry && src !== panorama.imageSmall) load(panorama.imageSmall, true);
        else setStatus('error');
      },
    );
    setStatus('loading');
    setProgress(0);
    load(url, false);

    // ---- look controls (yaw/pitch in degrees)
    let lon = 0, lat = 0, dragging = false, px = 0, py = 0, sLon = 0, sLat = 0;
    let orient: { alpha: number; beta: number; gamma: number } | null = null;
    let motionOn = false;
    const onDown = (e: PointerEvent) => { dragging = true; px = e.clientX; py = e.clientY; sLon = lon; sLat = lat; mount.setPointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const k = camera.fov / mount.clientHeight;
      lon = sLon - (e.clientX - px) * k;
      lat = sLat + (e.clientY - py) * k;
    };
    const onUp = () => { dragging = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.05, 30, 95);
      camera.updateProjectionMatrix();
    };
    // pinch zoom
    const touches = new Map<number, { x: number; y: number }>();
    let pinchStart = 0, fovStart = 75;
    const onTouchStart = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y); fovStart = camera.fov; dragging = false;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (touches.size === 2 && pinchStart) {
        const [a, b] = [...touches.values()];
        camera.fov = THREE.MathUtils.clamp(fovStart * (pinchStart / Math.hypot(a.x - b.x, a.y - b.y)), 30, 95);
        camera.updateProjectionMatrix();
      }
    };
    const onTouchEnd = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) touches.delete(t.identifier); if (touches.size < 2) pinchStart = 0; };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') lon -= 5;
      if (e.key === 'ArrowRight') lon += 5;
      if (e.key === 'ArrowUp') lat += 5;
      if (e.key === 'ArrowDown') lat -= 5;
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      orient = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
    };
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };

    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointermove', onMove);
    mount.addEventListener('pointerup', onUp);
    mount.addEventListener('pointercancel', onUp);
    mount.addEventListener('wheel', onWheel, { passive: false });
    mount.addEventListener('touchstart', onTouchStart, { passive: true });
    mount.addEventListener('touchmove', onTouchMove, { passive: true });
    mount.addEventListener('touchend', onTouchEnd);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);

    // Device orientation → camera quaternion (standard W3C mapping)
    const zee = new THREE.Vector3(0, 0, 1);
    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    const target = new THREE.Vector3();

    renderer.setAnimationLoop(() => {
      if (!renderer.xr.isPresenting) {
        if (orient && motionOn) {
          const screenAngle = THREE.MathUtils.degToRad((screen.orientation?.angle as number) || 0);
          euler.set(THREE.MathUtils.degToRad(orient.beta), THREE.MathUtils.degToRad(orient.alpha), -THREE.MathUtils.degToRad(orient.gamma), 'YXZ');
          camera.quaternion.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -screenAngle));
        } else {
          lat = THREE.MathUtils.clamp(lat, -85, 85);
          const phi = THREE.MathUtils.degToRad(90 - lat);
          const theta = THREE.MathUtils.degToRad(lon);
          target.set(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
          camera.lookAt(target);
        }
      }
      renderer.render(scene, camera);
    });

    let xrSession: XRSession | null = null;
    const nav = navigator as XRNav;
    nav.xr?.isSessionSupported('immersive-vr').then(setVrSupported).catch(() => setVrSupported(false));

    api.current = {
      enterVr: async () => {
        if (!nav.xr) return;
        try {
          xrSession = await nav.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
          await renderer.xr.setSession(xrSession);
          setInVr(true);
          xrSession.addEventListener('end', () => { setInVr(false); xrSession = null; });
        } catch {
          setVrSupported(false);
        }
      },
      setMotion: async on => {
        if (on) {
          const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
          if (DOE.requestPermission && (await DOE.requestPermission().catch(() => 'denied')) !== 'granted') return false;
          window.addEventListener('deviceorientation', onOrient);
        } else {
          window.removeEventListener('deviceorientation', onOrient);
          orient = null;
        }
        motionOn = on;
        return true;
      },
      reset: () => { lon = 0; lat = 0; camera.fov = 75; camera.updateProjectionMatrix(); },
    };

    document.body.style.overflow = 'hidden';
    return () => {
      disposed = true;
      document.body.style.overflow = '';
      xrSession?.end().catch(() => undefined);
      renderer.setAnimationLoop(null);
      mount.removeEventListener('pointerdown', onDown);
      mount.removeEventListener('pointermove', onMove);
      mount.removeEventListener('pointerup', onUp);
      mount.removeEventListener('pointercancel', onUp);
      mount.removeEventListener('wheel', onWheel);
      mount.removeEventListener('touchstart', onTouchStart);
      mount.removeEventListener('touchmove', onTouchMove);
      mount.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('deviceorientation', onOrient);
      texture?.dispose();
      material.dispose();
      geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [panorama, onClose, attempt]);

  const hasMotion = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && window.matchMedia('(pointer: coarse)').matches;

  return (
    <div className="pano" role="dialog" aria-modal="true" aria-label={`360° view of ${placeName}`}>
      <div className="pano-canvas" ref={mountRef} />

      <header className="pano-top">
        <div className="pano-title">
          <p className="eyebrow">360° view</p>
          <h2>{panorama.caption}</h2>
          <p className="pano-place">{placeName}</p>
        </div>
        <button type="button" className="pano-btn is-round" onClick={onClose} aria-label="Close 360° view">
          <X size={20} />
        </button>
      </header>

      {status === 'loading' && (
        <div className="pano-status">
          <span className="spinner" /> Loading panorama{progress ? ` · ${progress}%` : '…'}
        </div>
      )}
      {status === 'error' && (
        <div className="pano-status is-error">
          <span>The panorama couldn’t be loaded. Check your connection and try again.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt(a => a + 1)}>Try again</button>
        </div>
      )}

      <footer className="pano-bottom">
        <div className="pano-controls">
          <button type="button" className="pano-btn" onClick={() => api.current?.reset()} disabled={status !== 'ready'}>
            <RotateCcw size={16} /> Reset view
          </button>
          {hasMotion && (
            <button
              type="button"
              className={`pano-btn ${motion ? 'is-on' : ''}`}
              disabled={status !== 'ready'}
              onClick={async () => { const ok = await api.current?.setMotion(!motion); if (ok) setMotion(!motion); }}
              aria-pressed={motion}
            >
              <Smartphone size={16} /> {motion ? 'Motion on' : 'Use motion'}
            </button>
          )}
          {vrSupported && (
            <button type="button" className="pano-btn is-primary" onClick={() => api.current?.enterVr()} disabled={status !== 'ready' || inVr}>
              <Glasses size={16} /> {inVr ? 'In VR' : 'Enter VR'}
            </button>
          )}
        </div>
        <p className="pano-credit">
          {status === 'ready' && <span className="pano-hint">Drag to look around · scroll to zoom · </span>}
          Photo: {panorama.author} · {panorama.license} ·{' '}
          <a href={panorama.source} target="_blank" rel="noreferrer">Source <ExternalLink size={11} /></a>
        </p>
      </footer>
    </div>
  );
};

export default PanoramaViewer;
