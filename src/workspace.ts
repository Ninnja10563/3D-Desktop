export type AppType = 'notes' | 'files' | 'focus' | 'calculator' | 'capture';
export type SpatialWindow = { id: string; type: AppType; title: string; x: number; y: number; z: number; width: number; height: number; tilt: number; minimized: boolean; appId?: string };
export type Camera = { rx: number; ry: number; zoom: number };
export const DEFAULT_CAMERA: Camera = { rx: 7, ry: -13, zoom: 0.88 };
export const DEFAULT_WINDOWS: SpatialWindow[] = [
  { id: 'notes', type: 'notes', title: 'Notes', x: -205, y: -50, z: 100, width: 500, height: 366, tilt: 0, minimized: false },
  { id: 'files', type: 'files', title: 'Files', x: 270, y: -100, z: -170, width: 420, height: 348, tilt: -6, minimized: false },
  { id: 'focus', type: 'focus', title: 'Focus', x: 240, y: 214, z: 5, width: 306, height: 274, tilt: -6, minimized: false },
];
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const finite = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
export function sanitizeWorkspace(value: unknown): { windows: SpatialWindow[]; camera: Camera } {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const cam = data.camera && typeof data.camera === 'object' ? data.camera as Record<string, unknown> : {};
  const seen = new Set<string>();
  const windows = Array.isArray(data.windows) ? data.windows.filter((v): v is Record<string, unknown> => Boolean(v && typeof v === 'object')).filter(v => typeof v.type === 'string' && ['notes','files','focus','calculator'].includes(v.type)).filter(v => { const id = String(v.type); if (seen.has(id)) return false; seen.add(id); return true; }).map(v => ({
    id: String(v.type), type: v.type as AppType, title: ({ notes: 'Notes', files: 'Files', focus: 'Focus', calculator: 'Calculator' } as Record<string,string>)[String(v.type)],
    x: finite(v.x, 0, -1100, 1100), y: finite(v.y, 0, -700, 700), z: finite(v.z, 0, -500, 350),
    width: finite(v.width, 440, 280, 900), height: finite(v.height, 350, 220, 700), tilt: finite(v.tilt, 0, -35, 35), minimized: v.minimized === true,
  })) : DEFAULT_WINDOWS.map(w => ({...w}));
  return { windows, camera: { rx: finite(cam.rx, DEFAULT_CAMERA.rx, -25, 25), ry: finite(cam.ry, DEFAULT_CAMERA.ry, -40, 40), zoom: finite(cam.zoom, DEFAULT_CAMERA.zoom, 0.45, 1.4) } };
}
export function readWorkspace() {
  try { const saved = localStorage.getItem('depth.workspace.v1'); return saved ? sanitizeWorkspace(JSON.parse(saved)) : sanitizeWorkspace(null); }
  catch { return sanitizeWorkspace(null); }
}
export function arrangeWindows(windows: SpatialWindow[], mode: 'cascade' | 'grid'): SpatialWindow[] {
  const visible = windows.filter(w => !w.minimized);
  return windows.map(w => { const i = visible.findIndex(v => v.id === w.id); if (i === -1) return w;
    if (mode === 'cascade') return {...w, x: (i - (visible.length-1)/2)*250, y: (i-(visible.length-1)/2)*75, z: 150-i*125, tilt: -i*3};
    const cols = visible.length < 3 ? visible.length : Math.ceil(Math.sqrt(visible.length));
    const rows = Math.ceil(visible.length / cols);
    const cellW = Math.max(...visible.map(v => v.width)) + 40;
    const cellH = Math.max(...visible.map(v => v.height)) + 40;
    return {...w, x: (i%cols-(cols-1)/2)*cellW, y: (Math.floor(i/cols)-(rows-1)/2)*cellH, z: 0, tilt: 0};
  });
}
