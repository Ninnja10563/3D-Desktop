import { useState, useEffect, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { Layers3, StickyNote, FolderOpen, Timer, Calculator, Plus, X, Minus, Maximize2, ArrowUpRight, RotateCcw, Grid2X2, HelpCircle, SlidersHorizontal, MousePointer2, Move3D, ChevronDown, Search, Monitor, AppWindow, Check, VolumeX, Circle, Keyboard, LayoutGrid, Expand, LocateFixed } from 'lucide-react';
import { WorkspaceApp, type BuiltinAppType } from './apps/WorkspaceApps';
import { type SpatialWindow, type AppType, type Camera, DEFAULT_CAMERA, DEFAULT_WINDOWS, clamp, readWorkspace, arrangeWindows } from './workspace';

const APP_META = {
  notes: { name: 'Notes', icon: StickyNote, color: 'yellow' },
  files: { name: 'Files', icon: FolderOpen, color: 'blue' },
  focus: { name: 'Focus', icon: Timer, color: 'coral' },
  calculator: { name: 'Calculator', icon: Calculator, color: 'silver' },
  capture: { name: 'Live window', icon: Monitor, color: 'green' },
};
type Capture = { stream: MediaStream; ended: boolean };
type MacApp = { id: string; name: string; path: string };
type Source = { id: string; name: string; thumbnail: string; appName?: string };
type ModalName = 'share' | 'launcher' | 'help' | 'settings' | null;

function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={19}/></button></div>{children}
  </dialog>;
}

function LiveWindow({ capture, appId, apps, setApp, openApp }: { capture?: Capture; appId?: string; apps: MacApp[]; setApp: (id: string) => void; openApp: (id: string) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && capture) { ref.current.srcObject = capture.stream; void ref.current.play().catch(() => {}); } return () => { if (ref.current) ref.current.srcObject = null; }; }, [capture?.stream]);
  return <div className="live-app">
    <div className="live-video">{capture && !capture.ended ? <video ref={ref} autoPlay muted playsInline/> : <div className="capture-ended"><Monitor size={30}/><h3>Sharing has ended</h3><p>Close this window and bring the app in again.</p></div>}</div>
    <div className="live-footer"><span><i className={capture?.ended ? '' : 'live-dot'}/>{capture?.ended ? 'Disconnected' : 'Live view'}<VolumeX size={13}/></span>
      {window.depthNative && <div className="live-switch">{!appId && <select aria-label="Link live view to a Mac app" value="" onChange={e => setApp(e.target.value)}><option value="">Link to Mac app…</option>{apps.map(app => <option value={app.id} key={app.id}>{app.name}</option>)}</select>}{appId && <button onClick={() => openApp(appId)}>Open original <ArrowUpRight size={13}/></button>}</div>}
    </div><p className="live-caption">Live views are view-only. Use the original app to interact.</p>
  </div>;
}

export default function App() {
  const [initial] = useState(readWorkspace);
  const [windows, setWindows] = useState<SpatialWindow[]>(initial.windows);
  const [camera, setCamera] = useState<Camera>(initial.camera);
  const [selected, setSelected] = useState<string | null>(initial.windows.find(w => !w.minimized)?.id ?? null);
  const [focused, setFocused] = useState<string | null>(null);
  const [flat, setFlat] = useState(false);
  const [orbit, setOrbit] = useState(false);
  const [modal, setModal] = useState<ModalName>(null);
  const [toast, setToast] = useState('');
  const [clock, setClock] = useState(new Date());
  const [room, setRoom] = useState(() => { try { return localStorage.getItem('depth.room') || 'studio'; } catch { return 'studio'; } });
  const [grid, setGrid] = useState(true);
  const [captures, setCaptures] = useState<Record<string, Capture>>({});
  const captureRef = useRef(captures); captureRef.current = captures;
  const [apps, setApps] = useState<MacApp[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [appError, setAppError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [viewport, setViewport] = useState({width: 1200, height: 700});
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ mode: 'move'|'resize'|'orbit'; id?: string; px: number; py: number; x: number; y: number; scale: number } | null>(null);
  const active = windows.find(w => w.id === selected && !w.minimized);
  const visible = windows.filter(w => !w.minimized);
  const stageScale = Math.min(1, viewport.width / 1160, viewport.height / 760);
  const effectiveZoom = camera.zoom * stageScale;
  const latestWorkspace = useRef({windows, camera});
  latestWorkspace.current = {windows, camera};

  useEffect(() => { const id = setInterval(() => setClock(new Date()), 10000); return () => clearInterval(id); }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 4300); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    const id = setTimeout(() => { try { localStorage.setItem('depth.workspace.v1', JSON.stringify({windows: windows.filter(w => w.type !== 'capture'), camera})); setStorageError(false); } catch { setStorageError(true); } }, 250);
    return () => clearTimeout(id);
  }, [windows, camera]);
  useEffect(() => {
    const flush = () => { const saved = latestWorkspace.current; try { localStorage.setItem('depth.workspace.v1', JSON.stringify({...saved, windows:saved.windows.filter(w=>w.type!=='capture')})); } catch {} };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);
  useEffect(() => { try { localStorage.setItem('depth.room', room); } catch {} }, [room]);
  useEffect(() => { if (!stage.current) return; const ob = new ResizeObserver(([entry]) => setViewport({width: entry.contentRect.width, height: entry.contentRect.height})); ob.observe(stage.current); return () => ob.disconnect(); }, []);
  useEffect(() => () => { Object.values(captureRef.current).forEach(c => c.stream.getTracks().forEach(t => t.stop())); }, []);
  useEffect(() => {
    function move(e: PointerEvent) {
      const g = gesture.current; if (!g) return;
      const dx = (e.clientX-g.px)/g.scale, dy = (e.clientY-g.py)/g.scale;
      if (g.mode === 'orbit') setCamera(c => ({...c, ry: clamp(g.x+dx*0.1, -40, 40), rx: clamp(g.y-dy*0.1,-25,25)}));
      else if (g.mode === 'move') setWindows(ws => ws.map(w => w.id === g.id ? {...w, x: clamp(g.x+dx,-1100,1100), y: clamp(g.y+dy,-700,700)} : w));
      else setWindows(ws => ws.map(w => w.id === g.id ? {...w, width: clamp(g.x+dx,280,900), height: clamp(g.y+dy,220,700)} : w));
    }
    function end() { gesture.current = null; document.body.classList.remove('dragging'); }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end); };
  }, []);

  function updateWindow(id: string, update: Partial<SpatialWindow>) { setWindows(ws => ws.map(w => w.id === id ? {...w,...update} : w)); }
  function launch(type: BuiltinAppType) {
    const existing = windows.find(w => w.type === type);
    if (existing) { updateWindow(existing.id, {minimized: false}); setSelected(existing.id); }
    else { const template = DEFAULT_WINDOWS.find(w => w.type === type); const w: SpatialWindow = template ? {...template} : {id:type,type,title:APP_META[type].name,x:0,y:0,z:180,width:330,height:440,tilt:0,minimized:false}; setWindows(ws => [...ws,w]); setSelected(w.id); }
    setFocused(null); setModal(null);
  }
  function closeWindow(id: string) {
    const capture = captures[id]; if (capture) { capture.stream.getTracks().forEach(t => t.stop()); setCaptures(cs => {const next={...cs};delete next[id];return next;}); }
    setWindows(ws => ws.filter(w => w.id !== id)); if (selected === id) setSelected(visible.find(w => w.id !== id)?.id ?? null); if (focused === id) setFocused(null);
  }
  function minimize(id: string) { updateWindow(id, {minimized: true}); if (focused === id) setFocused(null); setSelected(visible.find(w => w.id !== id)?.id ?? null); }
  function reset() { setWindows(ws => { const extras = ws.filter(w => !DEFAULT_WINDOWS.some(d => d.id === w.id)); return [...DEFAULT_WINDOWS.map(w=>({...w})), ...extras.map((w,i)=>({...w,x:i*90,y:0,z:-300,minimized:true}))]; }); setCamera({...DEFAULT_CAMERA}); setFlat(false); setFocused(null); setSelected('notes'); setToast('Layout reset. Your notes and files are safe.'); }
  function startDrag(e: ReactPointerEvent, w: SpatialWindow, mode: 'move'|'resize') {
    if (e.button !== 0 || focused || (e.target as HTMLElement).closest('button,input,select')) return;
    e.preventDefault(); e.stopPropagation(); setSelected(w.id);
    const bounds = e.currentTarget.closest('.spatial-window')?.getBoundingClientRect();
    gesture.current = { mode,id:w.id,px:e.clientX,py:e.clientY,x:mode==='move'?w.x:w.width,y:mode==='move'?w.y:w.height,scale:Math.max(0.25,bounds?bounds.width/w.width:effectiveZoom) };
    document.body.classList.add('dragging'); e.currentTarget.setPointerCapture(e.pointerId);
  }
  function startOrbit(e: ReactPointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.spatial-window,button,input') || flat || focused) return;
    gesture.current = { mode:'orbit',px:e.clientX,py:e.clientY,x:camera.ry,y:camera.rx,scale:1 }; document.body.classList.add('dragging'); e.currentTarget.setPointerCapture(e.pointerId);
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') { setFocused(null); setOrbit(false); return; }
      if (modal || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); void openLauncher(); }
      else if (e.key === '?') setModal('help');
      else if (e.key.toLowerCase() === 'r') { setCamera({...DEFAULT_CAMERA}); setFlat(false); }
      else if (e.key.toLowerCase() === 'n') launch('notes');
      else if (e.key.toLowerCase() === 'f' && active) setFocused(focused ? null : active.id);
      else if (e.altKey && ['ArrowUp','ArrowDown'].includes(e.key) && active) { e.preventDefault(); updateWindow(active.id, {z:clamp(active.z+(e.key==='ArrowUp'?25:-25),-500,350)}); }
    }
    window.addEventListener('keydown',key); return () => window.removeEventListener('keydown',key);
  });

  async function loadApps() { if (!window.depthNative) return; try { setApps(await window.depthNative.getApps()); setAppError(''); } catch { setAppError('Could not read your Applications folder. Try opening the launcher again.'); } }
  async function openLauncher() { setQuery(''); setModal('launcher'); await loadApps(); }
  async function openMacApp(id: string) { try { await window.depthNative?.openApp(id); setModal(null); } catch (err) { setToast(`Could not open this app. ${err instanceof Error ? err.message : ''}`); } }
  async function openShare() { setCaptureError(''); setSources([]); setModal('share'); if (window.depthNative) { setBusy(true); await loadApps(); try { setSources(await window.depthNative.getSources()); } catch (err) { setCaptureError(err instanceof Error ? err.message : 'Could not list windows. Check Screen Recording permission.'); } finally {setBusy(false);} } }
  async function startCapture(source?: Source) {
    if (Object.keys(captures).length >= 6) {setCaptureError('Close a live view first. You can share up to six windows at once.'); return;}
    setCaptureError(''); setBusy(true);
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Live views need the Mac app, or a browser that supports screen sharing on localhost or HTTPS.');
      if (source && window.depthNative) await window.depthNative.selectSource(source.id);
      const stream = await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:24,max:30}},audio:false});
      const id = `capture-${crypto.randomUUID()}`;
      const title = source?.name || stream.getVideoTracks()[0]?.label || 'Live window';
      const appMatch = apps.find(a => source?.appName === a.name || title.toLowerCase().includes(a.name.toLowerCase()));
      setCaptures(cs=>({...cs,[id]:{stream,ended:false}}));
      stream.getVideoTracks()[0]?.addEventListener('ended',()=>setCaptures(cs=>cs[id]?{...cs,[id]:{...cs[id],ended:true}}:cs));
      setWindows(ws=>[...ws,{id,type:'capture',title,x:0,y:0,z:180,width:650,height:430,tilt:0,minimized:false,appId:appMatch?.id}]);
      setSelected(id); setFocused(null); setModal(null); setToast('Live view added. Closing it stops sharing.');
    } catch (err) {setCaptureError(err instanceof DOMException && err.name==='NotAllowedError' ? 'Sharing wasn’t started. Choose a window when prompted, or enable Screen Recording for 3D Desktop in macOS System Settings.' : err instanceof Error ? err.message : 'Screen sharing could not start.');}
    finally {setBusy(false);}
  }
  function tile() {setWindows(ws=>arrangeWindows(ws,'grid'));setCamera({rx:4,ry:-5,zoom:visible.length>3?0.62:0.78});setFocused(null);}
  const transformFor = (w: SpatialWindow) => focused === w.id ? `translate3d(${-w.width/2}px,${-w.height/2}px,0)` : `translate3d(${w.x-w.width/2}px,${w.y-w.height/2}px,${flat?0:w.z}px) rotateY(${flat?0:w.tilt}deg)`;

  return <div className={`desktop room-${room} ${window.depthNative?.platform==='darwin'?'native-mac':''} ${flat?'flat-mode':''} ${focused?'focus-mode':''}`}>
    <header className="topbar">
      <div className="brand"><Layers3 size={25} strokeWidth={1.6}/><span>3D Desktop</span><span className="brand-divider"/><span className="workspace-name">Personal space <ChevronDown size={12}/></span></div>
      <div className="view-switch" aria-label="Workspace view"><button className={!flat?'chosen':''} aria-pressed={!flat} onClick={()=>{setFlat(false);setFocused(null);}}><Layers3 size={15}/>Spatial</button><button className={flat?'chosen':''} aria-pressed={flat} onClick={()=>{setFlat(true);setFocused(null);}}><LayoutGrid size={14}/>Flat</button></div>
      <div className="top-actions"><span className="clock">{clock.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span><button className="icon-button help-button" aria-label="Help and shortcuts" onClick={()=>setModal('help')}><HelpCircle size={18}/></button><button className="share-button" onClick={()=>void openShare()}><Plus size={16}/>Bring an app</button></div>
    </header>

    <main className={`stage ${orbit?'orbit-mode':''}`} ref={stage} onPointerDown={startOrbit} onWheel={e=>{if(!(e.target as HTMLElement).closest('.spatial-window,.inspector,.scene-tools')&&!focused){setCamera(c=>({...c,zoom:clamp(c.zoom-e.deltaY*0.0008,0.45,1.4)}));}}}>
      <div className="workspace-heading"><div className="eyebrow"><span className="status-dot"/> YOUR WORKSPACE <span className="space-index">01 / {room.toUpperCase()}</span></div><h1>A new dimension<br/>to your everyday.</h1><p>{focused ? 'One window. All your attention.' : 'A little perspective changes everything.'}</p></div>
      <div className="scene-tools" role="toolbar" aria-label="Scene tools"><button className={!orbit?'active':''} aria-label="Select windows" title="Select windows" aria-pressed={!orbit} onClick={()=>setOrbit(false)}><MousePointer2 size={19}/></button><button className={orbit?'active':''} aria-label="Orbit workspace" title="Orbit workspace · drag empty space" aria-pressed={orbit} onClick={()=>{setOrbit(true);setFlat(false);setFocused(null);}}><Move3D size={20}/></button><span/><button aria-label="Tile windows" title="Tile windows" onClick={tile}><Grid2X2 size={18}/></button><button aria-label="Reset workspace" title="Reset layout · keeps your content" onClick={reset}><RotateCcw size={18}/></button></div>
      <div className="perspective-scene"><div className="world" style={{transform:focused?`scale(${Math.min(1.25,(viewport.width-90)/(active?.width||650),(viewport.height-120)/(active?.height||430))})`:`scale(${effectiveZoom}) rotateX(${flat?0:camera.rx}deg) rotateY(${flat?0:camera.ry}deg)`}}>
        {!focused && !flat && grid && <div className="floor"><div className="floor-axis axis-x"/><div className="floor-axis axis-z"/><span className="floor-label">3D DESKTOP / PERSONAL SPACE</span></div>}
        {windows.map(w => {
          const Icon = APP_META[w.type].icon;
          return <section key={w.id} className={`spatial-window ${selected===w.id?'selected':''} ${w.minimized|| (focused&&focused!==w.id)?'hidden-window':''}`} style={{width:w.width,height:w.height,transform:transformFor(w),zIndex:flat?(selected===w.id?100:windows.indexOf(w)+1):undefined}} aria-label={`${w.title} window`} onPointerDown={()=>setSelected(w.id)}>
            <div className="window-edge"/><div className="window-surface"><header className="window-titlebar" onPointerDown={e=>startDrag(e,w,'move')} onDoubleClick={e=>{if(!(e.target as HTMLElement).closest('button')){setSelected(w.id);setFocused(focused?null:w.id);}}}>
              <div className={`window-title ${APP_META[w.type].color}`}><Icon size={15}/><span>{w.title}</span>{w.type==='capture'&&<span className="live-badge">LIVE</span>}</div><div className="window-actions"><button aria-label={`Minimize ${w.title}`} title="Minimize" onClick={()=>minimize(w.id)}><Minus size={13}/></button><button aria-label={`Focus ${w.title}`} title="Focus window · F" onClick={()=>{setSelected(w.id);setFocused(focused?null:w.id);}}><Maximize2 size={12}/></button><button aria-label={`Close ${w.title}`} title="Close" onClick={()=>closeWindow(w.id)}><X size={13}/></button></div>
            </header><div className="window-content">{w.type==='capture'?<LiveWindow capture={captures[w.id]} appId={w.appId} apps={apps} setApp={id=>updateWindow(w.id,{appId:id})} openApp={id=>void openMacApp(id)}/>:<WorkspaceApp type={w.type}/>}</div>
            {!focused&&<div className="window-resize" title="Drag to resize" onPointerDown={e=>startDrag(e,w,'resize')}/>}
            </div>{!focused&&<span className="window-depth"><span/>{flat?'FLAT':`${w.z>0?'+':''}${Math.round(w.z)} Z`}</span>}
          </section>;
        })}
      </div></div>
      {visible.length===0&&<div className="empty-workspace"><Layers3 size={40}/><h2>Room for something good.</h2><p>Open an app from the dock to get started.</p><button className="primary-button" onClick={()=>launch('notes')}>Open Notes <ArrowUpRight size={15}/></button></div>}
      {focused ? <button className="leave-focus" onClick={()=>setFocused(null)}><Layers3 size={16}/>Back to space <kbd>esc</kbd></button> : active && <aside className="inspector" aria-label="Window properties"><div className="inspector-label">SELECTED WINDOW <SlidersHorizontal size={13}/></div><div className="inspector-title">{active.title}<span className="status-dot"/></div><label className="range-label" htmlFor="depth">Depth <output>{active.z>0?'+':''}{Math.round(active.z)}<span> px</span></output></label><input id="depth" aria-label="Window depth" type="range" min="-500" max="350" step="5" value={active.z} disabled={flat} onChange={e=>updateWindow(active.id,{z:Number(e.target.value)})}/><div className="range-extents"><span>Further away</span><span>Closer</span></div><label className="range-label tilt-label" htmlFor="tilt">Angle <output>{active.tilt}°</output></label><input id="tilt" aria-label="Window angle" type="range" min="-35" max="35" value={active.tilt} disabled={flat} onChange={e=>updateWindow(active.id,{tilt:Number(e.target.value)})}/><button className="focus-button" onClick={()=>setFocused(active.id)}><Expand size={14}/>Focus window <kbd>F</kbd></button>{flat&&<p className="inspector-hint">Switch to Spatial to adjust depth.</p>}</aside>}
      <div className="orientation" aria-hidden="true"><div className="orientation-gizmo" style={{transform:`rotateX(${flat?0:camera.rx}deg) rotateY(${flat?0:camera.ry}deg)`}}><span className="gizmo-x">x</span><span className="gizmo-y">y</span><span className="gizmo-z">z</span></div><span>{flat?'2D WORKSPACE':'3D WORKSPACE'}</span></div>
    </main>

    <footer className="bottom-bar"><div className="workspace-status"><span className="status-dot"/><span>{window.depthNative?'APPLE SILICON':'BROWSER PREVIEW'}</span><span className="save-state">{storageError?'Layout could not be saved':`${visible.length} open · saved locally`}</span></div>
      <nav className="dock" aria-label="Applications">{(['notes','files','focus','calculator'] as BuiltinAppType[]).map(type=>{const Icon=APP_META[type].icon;const w=windows.find(w=>w.type===type);return <button key={type} className={`dock-app dock-${APP_META[type].color} ${selected===w?.id&&!w?.minimized?'dock-selected':''}`} aria-label={`Open ${APP_META[type].name}`} title={APP_META[type].name} onClick={()=>launch(type)}><Icon size={25} strokeWidth={1.65}/><span className="dock-tooltip">{APP_META[type].name}</span><i className={w?'running':''}/></button>;})}<span className="dock-separator"/>{windows.filter(w=>w.type==='capture').map(w=><button key={w.id} className="dock-app dock-green" aria-label={`Restore ${w.title}`} title={w.title} onClick={()=>{updateWindow(w.id,{minimized:false});setSelected(w.id);setFocused(null);}}><Monitor size={24}/><i className="running"/></button>)}<button className="dock-app launcher-button" aria-label="Open app launcher" title="App launcher · ⌘K" onClick={()=>void openLauncher()}><LayoutGrid size={24}/><span className="dock-tooltip">All apps</span></button></nav>
      <div className="view-controls"><button className="icon-button" aria-label="Zoom out" onClick={()=>setCamera(c=>({...c,zoom:clamp(c.zoom-0.1,0.45,1.4)}))}><Minus size={15}/></button><span>{Math.round(camera.zoom*100)}%</span><button className="icon-button" aria-label="Zoom in" onClick={()=>setCamera(c=>({...c,zoom:clamp(c.zoom+0.1,0.45,1.4)}))}><Plus size={15}/></button><button className="icon-button" aria-label="Reset camera" title="Reset camera · R" onClick={()=>setCamera({...DEFAULT_CAMERA})}><LocateFixed size={17}/></button><span/><button className="icon-button" aria-label="Workspace settings" onClick={()=>setModal('settings')}><SlidersHorizontal size={17}/></button></div>
    </footer>
    <div className="gesture-hint">{focused?'Press Esc to return to your workspace':orbit?'Drag the background to change your perspective':'Drag a title bar to move · Drag the background to orbit'}</div>
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}

    {modal==='help'&&<Modal title="A little space to get started" close={()=>setModal(null)}><p className="modal-intro">3D Desktop gives your everyday apps room to breathe. Arrange windows in space, then focus on one when it’s time to work.</p><div className="help-steps"><div><MousePointer2/><section><h3>Make it yours</h3><p>Drag any title bar to move a window. Drag its bottom-right corner to resize. Your layout saves automatically.</p></section></div><div><Move3D/><section><h3>Find your perspective</h3><p>Drag empty space to orbit. Scroll over the background to zoom. Select a window and use Depth and Angle to place it in 3D.</p></section></div><div><Monitor/><section><h3>Bring in your Mac</h3><p>Use Bring an app to share a live window or display. Live views are view-only; Open original switches to the Mac app. Closing a live view stops sharing.</p></section></div></div><div className="keyboard-shortcuts"><Keyboard size={18}/><span><kbd>F</kbd> Focus</span><span><kbd>R</kbd> Reset camera</span><span><kbd>N</kbd> Notes</span><span><kbd>⌘ K</kbd> Apps</span><span><kbd>⌥ ↑↓</kbd> Depth</span></div><button className="primary-button full-width" onClick={()=>setModal(null)}>Make yourself at home <ArrowUpRight size={16}/></button></Modal>}

    {modal==='settings'&&<Modal title="Your space, your way" close={()=>setModal(null)}><p className="modal-intro">A backdrop for your best work.</p><div className="room-options">{[{id:'studio',name:'Studio',label:'Slate & sage'},{id:'dune',name:'Dune',label:'Warm & earthy'},{id:'night',name:'Night',label:'After hours'}].map(r=><button key={r.id} className={`room-option room-swatch-${r.id} ${room===r.id?'selected-room':''}`} onClick={()=>setRoom(r.id)}><span className="room-preview"/><strong>{r.name}{room===r.id&&<Check size={14}/>}</strong><small>{r.label}</small></button>)}</div><label className="setting-row"><span><strong>Perspective grid</strong><small>A reference plane for your windows.</small></span><input type="checkbox" checked={grid} onChange={e=>setGrid(e.target.checked)}/></label><div className="setting-row"><span><strong>Reset window layout</strong><small>Your notes and imported files stay safe.</small></span><button className="secondary-button" onClick={()=>{reset();setModal(null);}}>Reset</button></div><div className="settings-about"><Layers3 size={22}/><span>3D Desktop 1.0 <small>A little more room to think.</small></span><span className="local-badge">LOCAL FIRST</span></div></Modal>}

    {modal==='launcher'&&<Modal title="Make room for an app" close={()=>setModal(null)} wide><label className="search-box"><Search size={18}/><input autoFocus placeholder="Find an app…" aria-label="Search apps" value={query} onChange={e=>setQuery(e.target.value)}/><kbd>⌘ K</kbd></label><div className="launcher-label">IN YOUR WORKSPACE</div><div className="launcher-builtins">{(['notes','files','focus','calculator'] as BuiltinAppType[]).filter(t=>APP_META[t].name.toLowerCase().includes(query.toLowerCase())).map(type=>{const Icon=APP_META[type].icon;return <button key={type} onClick={()=>launch(type)}><Icon size={23}/><span>{APP_META[type].name}</span><Plus size={15}/></button>;})}</div>{window.depthNative?<><div className="launcher-label">ON YOUR MAC <span>Opens in macOS</span></div>{appError&&<p className="error-message">{appError}</p>}<div className="native-app-list">{apps.filter(a=>a.name.toLowerCase().includes(query.toLowerCase())).map(a=><button key={a.id} onClick={()=>void openMacApp(a.id)}><AppWindow size={19}/><span>{a.name}</span><ArrowUpRight size={15}/></button>)}{apps.filter(a=>a.name.toLowerCase().includes(query.toLowerCase())).length===0&&<p className="muted-text">{query?'No matching Mac apps.':'Your installed apps will appear here.'}</p>}</div><p className="modal-footnote">To add a live view, launch the app, then choose Bring an app.</p></>:<div className="browser-note"><Monitor size={22}/><div><strong>Your Mac apps belong here, too.</strong><p>The macOS version includes your installed apps. In this browser preview, use Bring an app to share a window.</p></div></div>}</Modal>}

    {modal==='share'&&<Modal title="Bring your world into 3D Desktop" close={()=>{if(!busy)setModal(null);}} wide><p className="modal-intro">Add a live view of an app or your entire desktop. Nothing is uploaded or recorded. Interact with shared apps in their original windows.</p>{captureError&&<p className="error-message" role="alert">{captureError}</p>}{window.depthNative?<><div className="source-heading"><span>CHOOSE A WINDOW OR DISPLAY</span><button disabled={busy} onClick={()=>void openShare()}><RotateCcw size={14}/>Refresh</button></div>{busy&&<p className="loading-text">{sources.length?'Starting your live view…':'Finding your windows…'}</p>}<div className="source-grid">{sources.map(s=><button key={s.id} disabled={busy} onClick={()=>void startCapture(s)}><div>{s.thumbnail?<img src={s.thumbnail} alt=""/>:<Monitor size={32}/>}</div><span>{s.name}</span><Plus size={15}/></button>)}</div>{!busy&&sources.length===0&&<p className="muted-text">No windows available. Allow 3D Desktop to record the screen in macOS System Settings, then reopen 3D Desktop.</p>}<button className="secondary-button" onClick={()=>void window.depthNative?.openScreenPrivacySettings()}>Screen Recording settings <ArrowUpRight size={14}/></button></>:<div className="browser-share"><Monitor size={46} strokeWidth={1.2}/><h3>Your apps. A new perspective.</h3><p>Your browser will ask which window or display to share.</p><button className="primary-button" disabled={busy} onClick={()=>void startCapture()}><Plus size={17}/>{busy?'Waiting for your choice…':'Choose a window'}</button></div>}<p className="modal-footnote"><Circle size={9}/>Sharing stays on this device. Close the live window to stop.</p></Modal>}
  </div>;
}
