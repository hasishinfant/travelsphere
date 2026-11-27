// 360° destination viewer — Three.js equirectangular sphere with WebXR (immersive-vr) when supported.
// Desktop: drag (with momentum) / scroll / arrow keys; slow auto-rotation when idle. Mobile: swipe / pinch, optional
// motion control. A "live conditions" layer simulates the CURRENT light (sun position at the photo's location) and
// weather (rain, snow, fog, wind, lightning from the live Open-Meteo reading) over the recorded photo, and says so.
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { X, Smartphone, Glasses, ExternalLink, RotateCcw, CloudSun } from 'lucide-react';
import type { Panorama } from '@/data/panoramas';
import { describeLook, lookFor, type LiveWeather, type SceneLook } from './panoramaConditions';
import './PanoramaViewer.css';

interface Props {
  panorama: Panorama;
  placeName: string;
  onClose: () => void;
  /** Current weather at the destination (from the safety assessment); null when unavailable. */
  weather?: LiveWeather | null;
  weatherObservedAt?: string | null;
}

type XRNav = Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean>; requestSession(mode: string, init?: object): Promise<XRSession> } };

const MIN_FOV = 40;   // closer than this the 3840 px photo turns soft
const MAX_FOV = 95;
const IDLE_MS = 4000;

function photoDate(taken: string) {
  const [y, m, d] = taken.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString('en-GB',
    d ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } : { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function localTime(tz: string, when: Date) {
  try {
    return when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return when.toISOString().slice(11, 16) + ' UTC';
  }
}

function dropTexture(): THREE.Texture {
  // Soft round sprite for snow flakes
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

const PanoramaViewer: React.FC<Props> = ({ panorama, placeName, onClose, weather = null, weatherObservedAt = null }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState(0);
  const [vrSupported, setVrSupported] = useState(false);
  const [inVr, setInVr] = useState(false);
  const [motion, setMotion] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const look: SceneLook = lookFor(panorama.lat, panorama.lon, now, weather);
  const lookRef = useRef(look);
  lookRef.current = look;
  const liveRef = useRef(live);
  liveRef.current = live;
  const api = useRef<{ enterVr: () => void; setMotion: (on: boolean) => Promise<boolean>; reset: () => void;
    applyLook: () => void } | null>(null);

  // Keep the simulated light in step with the clock
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const mount = mountRef.current!;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1100);
    const geometry = new THREE.SphereGeometry(500, 96, 64);
    geometry.scale(-1, 1, 1); // view the texture from inside
    const material = new THREE.MeshBasicMaterial({ color: 0xf4f2ef });
    scene.add(new THREE.Mesh(geometry, material));

    // ---- weather particles (rain streaks or snow flakes) in a box around the camera
    const BOX = 60;
    const maxParticles = 3200;
    const positions = new Float32Array(maxParticles * 6);   // two vertices per streak
    const speeds = new Float32Array(maxParticles);
    for (let i = 0; i < maxParticles; i++) {
      const x = (Math.random() - 0.5) * 2 * BOX, y = (Math.random() - 0.5) * 2 * BOX, z = (Math.random() - 0.5) * 2 * BOX;
      positions.set([x, y, z, x, y - 1.2, z], i * 6);
      speeds[i] = 0.75 + Math.random() * 0.5;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const rainMat = new THREE.LineBasicMaterial({ color: 0xc8d4e3, transparent: true, opacity: 0.45, depthWrite: false, fog: false });
    const rain = new THREE.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false;
    const snowPos = new Float32Array(maxParticles * 3);
    for (let i = 0; i < maxParticles; i++) snowPos.set([positions[i * 6], positions[i * 6 + 1], positions[i * 6 + 2]], i * 3);
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    const flake = dropTexture();
    const snowMat = new THREE.PointsMaterial({ size: 0.9, map: flake, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    const snow = new THREE.Points(snowGeo, snowMat);
    snow.frustumCulled = false;
    scene.add(rain, snow);

    let flash = 0;   // lightning brightness, decays each frame
    const baseColor = new THREE.Color(1, 1, 1);
    const applyLook = () => {
      const l = lookRef.current;
      const on = liveRef.current;
      // A photo taken at night is not darkened again
      const tint = on && !(panorama.photoLight === 'night' && l.light !== 'day') ? l.tint : [1, 1, 1];
      baseColor.setRGB(tint[0], tint[1], tint[2], THREE.SRGBColorSpace);   // perceptual, not linear, dimming
      if (texture) material.color.copy(baseColor);
      const fogColor = l.light === 'night' ? 0x1a2030 : l.light === 'twilight' ? 0x6b6880
        : l.precip !== 'none' ? 0x8e959d : 0xc9cfd6;   // rain: a darker grey haze; fog/cloud: a pale one
      const hadFog = !!scene.fog;
      scene.fog = on && l.fog > 0 ? new THREE.Fog(fogColor, 0, 500 / l.fog) : null;
      if (hadFog !== !!scene.fog) material.needsUpdate = true;   // fog on/off changes the shader
      const count = on ? l.particles : 0;
      const isSnow = l.precip === 'snow';
      rain.visible = count > 0 && !isSnow;
      snow.visible = count > 0 && isSnow;
      rainGeo.setDrawRange(0, count * 2);
      snowGeo.setDrawRange(0, count);
      rainMat.color.set(l.light === 'night' ? 0x8090a8 : 0xc8d4e3);
    };

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
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        texture = t;
        material.map = t;
        material.needsUpdate = true;
        applyLook();
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

    // ---- look controls (yaw/pitch in degrees) with momentum, smooth zoom and idle auto-rotation
    let lon = 0, lat = 0, dragging = false, px = 0, py = 0, sLon = 0, sLat = 0;
    let vLon = 0, vLat = 0, lastX = 0, lastY = 0, lastT = 0;
    let targetFov = 75;
    let lastInput = performance.now();
    let orient: { alpha: number; beta: number; gamma: number } | null = null;
    let motionOn = false;
    const touched = () => { lastInput = performance.now(); };
    const onDown = (e: PointerEvent) => {
      dragging = true; px = lastX = e.clientX; py = lastY = e.clientY; lastT = performance.now();
      sLon = lon; sLat = lat; vLon = vLat = 0; touched(); mount.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const k = camera.fov / mount.clientHeight;
      lon = sLon - (e.clientX - px) * k;
      lat = sLat + (e.clientY - py) * k;
      const t = performance.now(), dt = Math.max(1, t - lastT);
      vLon = (-(e.clientX - lastX) * k) / dt * 16;      // degrees per ~frame
      vLat = ((e.clientY - lastY) * k) / dt * 16;
      lastX = e.clientX; lastY = e.clientY; lastT = t; touched();
    };
    const onUp = () => {
      dragging = false; touched();
      if (performance.now() - lastT > 80) { vLon = vLat = 0; }     // the pointer had stopped before release
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      targetFov = THREE.MathUtils.clamp(targetFov + e.deltaY * 0.05, MIN_FOV, MAX_FOV);
      touched();
    };
    // pinch zoom
    const touches = new Map<number, { x: number; y: number }>();
    let pinchStart = 0, fovStart = 75;
    const onTouchStart = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y); fovStart = targetFov; dragging = false;
      }
      touched();
    };
    const onTouchMove = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (touches.size === 2 && pinchStart) {
        const [a, b] = [...touches.values()];
        targetFov = THREE.MathUtils.clamp(fovStart * (pinchStart / Math.hypot(a.x - b.x, a.y - b.y)), MIN_FOV, MAX_FOV);
      }
      touched();
    };
    const onTouchEnd = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) touches.delete(t.identifier); if (touches.size < 2) pinchStart = 0; };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') { vLon = -1.2; touched(); }
      if (e.key === 'ArrowRight') { vLon = 1.2; touched(); }
      if (e.key === 'ArrowUp') { vLat = 1.2; touched(); }
      if (e.key === 'ArrowDown') { vLat = -1.2; touched(); }
      if (e.key === '+' || e.key === '=') { targetFov = Math.max(MIN_FOV, targetFov - 8); touched(); }
      if (e.key === '-') { targetFov = Math.min(MAX_FOV, targetFov + 8); touched(); }
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
    const clock = new THREE.Clock();

    renderer.setAnimationLoop(() => {
      const dt = Math.min(0.05, clock.getDelta());
      const frames = dt * 60;
      if (!renderer.xr.isPresenting) {
        if (orient && motionOn) {
          const screenAngle = THREE.MathUtils.degToRad((screen.orientation?.angle as number) || 0);
          euler.set(THREE.MathUtils.degToRad(orient.beta), THREE.MathUtils.degToRad(orient.alpha), -THREE.MathUtils.degToRad(orient.gamma), 'YXZ');
          camera.quaternion.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -screenAngle));
        } else {
          if (!dragging) {
            // momentum after a flick, decaying smoothly
            lon += vLon * frames; lat += vLat * frames;
            const decay = Math.pow(0.92, frames);
            vLon *= decay; vLat *= decay;
            if (Math.abs(vLon) < 0.001) vLon = 0;
            if (Math.abs(vLat) < 0.001) vLat = 0;
            // gentle auto-rotation once the viewer has been left alone (eased in)
            const idle = performance.now() - lastInput;
            if (!reduceMotion && idle > IDLE_MS && vLon === 0) {
              lon += 0.025 * frames * Math.min(1, (idle - IDLE_MS) / 2000);
              lat += (0 - lat) * 0.01 * frames;      // drift back towards the horizon
            }
          }
          lat = THREE.MathUtils.clamp(lat, -85, 85);
          const phi = THREE.MathUtils.degToRad(90 - lat);
          const theta = THREE.MathUtils.degToRad(lon);
          target.set(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
          camera.lookAt(target);
        }
        if (Math.abs(camera.fov - targetFov) > 0.01) {
          camera.fov += (targetFov - camera.fov) * Math.min(1, 0.15 * frames);
          camera.updateProjectionMatrix();
        }
      }

      // weather particles follow the camera; wind slants and drifts them
      const l = lookRef.current;
      if (rain.visible || snow.visible) {
        const wind = Math.min(30, l.windMs);
        const drift = wind * 0.012;
        if (rain.visible) {
          const fall = (l.precip === 'drizzle' ? 0.9 : 1.8) * frames;
          const len = l.precip === 'drizzle' ? 0.6 : 1.4;
          const count = rainGeo.drawRange.count / 2;
          for (let i = 0; i < count; i++) {
            const o = i * 6;
            let x = positions[o] + drift * frames * speeds[i], y = positions[o + 1] - fall * speeds[i];
            const z = positions[o + 2];
            if (y < -BOX) { y = BOX; x = (Math.random() - 0.5) * 2 * BOX; }
            if (x > BOX) x = -BOX;
            positions[o] = x; positions[o + 1] = y;
            positions[o + 3] = x - drift * len * 2; positions[o + 4] = y - len; positions[o + 5] = z;
          }
          rainGeo.attributes.position.needsUpdate = true;
          rain.position.copy(camera.position);
        }
        if (snow.visible) {
          const count = snowGeo.drawRange.count;
          const t = performance.now() / 1000;
          for (let i = 0; i < count; i++) {
            const o = i * 3;
            let y = snowPos[o + 1] - 0.12 * frames * speeds[i];
            let x = snowPos[o] + (drift + Math.sin(t + i) * 0.02) * frames;
            if (y < -BOX) { y = BOX; x = (Math.random() - 0.5) * 2 * BOX; }
            if (x > BOX) x = -BOX;
            snowPos[o] = x; snowPos[o + 1] = y;
          }
          snowGeo.attributes.position.needsUpdate = true;
          snow.position.copy(camera.position);
        }
      }
      // lightning: rare, brief flashes during a thunderstorm
      if (liveRef.current && l.lightning && !reduceMotion && flash <= 0 && Math.random() < 0.0025 * frames) flash = 1;
      if (flash > 0 && texture) {
        const f = flash * 1.6;
        material.color.setRGB(Math.min(1.6, baseColor.r + f), Math.min(1.6, baseColor.g + f), Math.min(1.6, baseColor.b + f));
        flash -= 0.12 * frames;
        if (flash <= 0) material.color.copy(baseColor);
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
      reset: () => { lon = 0; lat = 0; vLon = vLat = 0; targetFov = 75; touched(); },
      applyLook,
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
      rainGeo.dispose(); rainMat.dispose(); snowGeo.dispose(); snowMat.dispose(); flake.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [panorama, onClose, attempt]);

  // Re-apply the look when the clock, the weather or the toggle changes (no reload of the photo)
  useEffect(() => { api.current?.applyLook(); }, [live, look.light, look.precip, look.fog, look.tint.join()]);

  const hasMotion = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && window.matchMedia('(pointer: coarse)').matches;
  const observed = weatherObservedAt ? Math.max(0, Math.round((Date.now() - Date.parse(weatherObservedAt)) / 60_000)) : null;

  return (
    <div className="pano" role="dialog" aria-modal="true" aria-label={`360° view of ${placeName}`}>
      <div className="pano-canvas" ref={mountRef} />

      <header className="pano-top">
        <div className="pano-title">
          <p className="eyebrow">360° view</p>
          <h2>{panorama.caption}</h2>
          <p className="pano-place">{placeName}</p>
          {panorama.note && <p className="pano-note">{panorama.note}</p>}
        </div>
        <button type="button" className="pano-btn is-round" onClick={onClose} aria-label="Close 360° view">
          <X size={20} />
        </button>
      </header>

      {status === 'ready' && (
        <div className={`pano-live ${live ? 'is-on' : ''}`} aria-live="polite">
          <p className="pano-live-now">
            <CloudSun size={15} aria-hidden="true" />
            <strong>Now {localTime(panorama.timezone, now)}</strong>
            <span>{describeLook(look, weather)}</span>
          </p>
          <p className="pano-live-note">
            {live
              ? <>Light and weather simulated{weather ? ` from the live reading${observed !== null ? ` (${observed} min ago)` : ''}` : ' from the time of day only — live weather unavailable'} over a photo taken {photoDate(panorama.taken)}.</>
              : <>Photo as taken, {photoDate(panorama.taken)}.</>}
          </p>
        </div>
      )}

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
          <button type="button" className={`pano-btn ${live ? 'is-on' : ''}`} onClick={() => setLive(v => !v)}
            disabled={status !== 'ready'} aria-pressed={live}>
            <CloudSun size={16} /> {live ? 'Live conditions on' : 'Live conditions off'}
          </button>
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
          {status === 'ready' && <span className="pano-hint">Drag or flick to look around · scroll to zoom · </span>}
          Photo: {panorama.author} · {panorama.license} · {photoDate(panorama.taken)} ·{' '}
          <a href={panorama.source} target="_blank" rel="noreferrer">Source <ExternalLink size={11} /></a>
        </p>
      </footer>
    </div>
  );
};

export default PanoramaViewer;
