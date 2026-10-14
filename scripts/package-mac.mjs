import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { packager } from '@electron/packager';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electronVersion = require('electron/package.json').version;
const rendererDependencies = ['react', 'react-dom', 'scheduler', 'lucide-react'];
const notices = [
  'THIRD-PARTY NOTICES FOR 3D Desktop',
  'The renderer contains the packages listed below. Their complete license texts follow.',
  'Electron and Chromium notices are distributed separately in LICENSE and LICENSES.chromium.html.',
  ...await Promise.all(rendererDependencies.map(async (name) => {
    const directory = path.join(root, 'node_modules', name);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const license = await readFile(path.join(directory, 'LICENSE'), 'utf8');
    return `\n${'='.repeat(72)}\n${name} ${manifest.version}\n${'='.repeat(72)}\n\n${license.trim()}\n`;
  })),
].join('\n\n').trimEnd() + '\n';
await mkdir(path.join(root, 'assets'), { recursive: true });
await writeFile(path.join(root, 'assets', 'THIRD_PARTY_NOTICES.txt'), notices);

await access(path.join(root, 'dist', 'index.html')).catch(() => {
  throw new Error('Build the application first: npm run build');
});

const staging = await mkdtemp(path.join(os.tmpdir(), 'depth-package-'));
try {
  await cp(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
  await cp(path.join(root, 'electron'), path.join(staging, 'electron'), {
    recursive: true,
    filter: (filename) => !filename.endsWith('.test.cjs'),
  });
  await cp(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'));
  await writeFile(path.join(staging, 'THIRD_PARTY_NOTICES.txt'), notices);
  await writeFile(path.join(staging, 'package.json'), JSON.stringify({
    name: '3d-desktop',
    productName: '3D Desktop',
    version: metadata.version,
    description: metadata.description,
    author: metadata.author,
    license: metadata.license,
    main: 'electron/main.cjs',
  }, null, 2));

  console.log(`Packaging 3D Desktop for Apple Silicon with Electron ${electronVersion}…`);
  const outputs = await packager({
    dir: staging,
    out: release,
    name: '3D Desktop',
    executableName: '3D Desktop',
    platform: 'darwin',
    arch: 'arm64',
    electronVersion,
    appVersion: metadata.version,
    appBundleId: 'studio.depth.desktop',
    appCategoryType: 'public.app-category.productivity',
    icon: path.join(root, 'assets', '3D-Desktop.icns'),
    darwinDarkModeSupport: true,
    overwrite: true,
    asar: true,
    prune: false,
    extendInfo: {
      NSHumanReadableCopyright: '3D Desktop contributors',
      NSScreenCaptureUsageDescription: '3D Desktop displays the windows you choose as live panels in your private 3D workspace.',
      NSHighResolutionCapable: true,
    },
    ...(process.platform === 'darwin' ? { osxSign: { identity: '-' } } : {}),
  });
  const output = outputs[0];
  if (!output) throw new Error('The macOS package was not created.');
  await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), notices);
  await cp(path.join(root, 'LICENSE'), path.join(output, '3D-DESKTOP-LICENSE.txt'));
  const installer = String.raw`#!/bin/bash
set -euo pipefail

echo "3D Desktop — Apple Silicon installation"
echo ""
echo "This is a locally built app, without an Apple Developer ID signature or notarization."
echo "This installer will copy 3D Desktop to ~/Applications, ad-hoc sign that copy on your Mac,"
echo "and remove the download quarantine flag only from that copy of 3D Desktop."
echo "It does not change Gatekeeper or any system-wide security setting."
echo "An existing 3D Desktop.app will be moved to a separate backup folder, never deleted."
echo "An older Depth.app stays in place. Your existing workspace data is retained."
echo ""

if [[ "$(/usr/bin/uname -s)" != "Darwin" ]] || [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" != "1" ]]; then
  echo "This build requires a Mac with Apple Silicon (M1, M2, M3, or later)."
  exit 1
fi

depth_source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
depth_source="$depth_source_dir/3D Desktop.app"
if [[ ! -d "$depth_source" ]] || [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$depth_source/Contents/Info.plist" 2>/dev/null || true)" != "studio.depth.desktop" ]]; then
  echo "Keep this installer beside the original 3D Desktop.app from the download."
  exit 1
fi
if /usr/bin/pgrep -x "3D Desktop" >/dev/null || /usr/bin/pgrep -x "Depth" >/dev/null; then
  echo "Please quit 3D Desktop and any older Depth app before running this installer again."
  exit 1
fi

read -r -p "Install this copy of 3D Desktop? [y/N] " depth_answer
case "$depth_answer" in
  y|Y|yes|YES) ;;
  *) echo "Installation cancelled. Nothing changed."; exit 0 ;;
esac

depth_destination="$HOME/Applications"
depth_target="$depth_destination/3D Desktop.app"
/bin/mkdir -p "$depth_destination"
depth_stage="$(/usr/bin/mktemp -d "$depth_destination/.depth-install-XXXXXX")"
trap '/bin/rm -rf -- "$depth_stage"' EXIT
/usr/bin/ditto "$depth_source" "$depth_stage/3D Desktop.app"
/usr/bin/xattr -dr com.apple.quarantine "$depth_stage/3D Desktop.app" 2>/dev/null || true
/usr/bin/codesign --force --deep --sign - "$depth_stage/3D Desktop.app"
/usr/bin/codesign --verify --deep --strict "$depth_stage/3D Desktop.app"

if [[ -e "$depth_target" ]] || [[ -L "$depth_target" ]]; then
  depth_backup="$(/usr/bin/mktemp -d "$depth_destination/3D Desktop-backup-XXXXXX")"
  /bin/mv "$depth_target" "$depth_backup/3D Desktop.app"
  echo "Your previous copy is saved in: $depth_backup"
fi
/bin/mv "$depth_stage/3D Desktop.app" "$depth_target"
echo ""
echo "3D Desktop is installed in: $depth_target"
echo "To bring in live app windows, allow 3D Desktop in System Settings → Privacy & Security"
echo "→ Screen & System Audio Recording, then quit and reopen 3D Desktop."
/usr/bin/open "$depth_target"
`;
  const installerPath = path.join(output, 'Install 3D Desktop.command');
  await writeFile(installerPath, installer);
  await chmod(installerPath, 0o755);
  await writeFile(path.join(output, 'READ ME.txt'), `3D DESKTOP — YOUR SPATIAL DESKTOP\n\nApple Silicon edition (M1/M2/M3 and later).\n\n1. Extract the complete ZIP. Keep 3D Desktop.app and Install 3D Desktop.command together.\n2. Control-click Install 3D Desktop.command, choose Open, and read the installation prompt.\n3. Type y to install into your user Applications folder. No administrator access is needed.\n\nIf macOS blocks the command file, open Terminal, type bash followed by a space, drag\nInstall 3D Desktop.command into Terminal, and press Return. The script remains reviewable\nin any text editor before you run it.\n\nThe app is not Apple Developer ID signed or notarized. The installer signs the local\ncopy on your Mac and removes quarantine only for that app. It does not disable\nGatekeeper. Existing installations are preserved in a separate backup folder.\n\nLIVE WINDOWS\nUse Bring an app in 3D Desktop. macOS requires Screen & System Audio Recording permission.\nEnable 3D Desktop under System Settings > Privacy & Security, then quit and reopen it.\nOnly the screen or window you choose is shown. Streams remain on your device, carry\nno audio, and stop when removed or 3D Desktop is closed. Protected content may appear black.\nLive windows are views; open the original application to interact with it.\n\nThis application adds a 3D workspace; it does not replace the macOS window manager.\nThe package targets macOS Apple Silicon. Mac hardware runtime verification must be\ncompleted on your Mac; the development environment cannot run the arm64 Mac binary.\n`);
  const archive = path.join(release, `3D-Desktop-${metadata.version}-mac-arm64.zip`);
  const distributionEntries = [
    '3D Desktop.app', 'Install 3D Desktop.command', 'READ ME.txt',
    'LICENSE', 'LICENSES.chromium.html', 'THIRD_PARTY_NOTICES.txt', '3D-DESKTOP-LICENSE.txt',
  ];
  await rm(archive, { force: true });
  await rm(`${archive}.sha256`, { force: true });
  if (process.platform === 'darwin') {
    await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', output, archive]);
  } else {
    // Store symlinks as symlinks; Electron Framework depends on them on macOS.
    try {
      await run('zip', ['-q', '-r', '-y', archive, ...distributionEntries], { cwd: output, maxBuffer: 1024 * 1024 });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const zipScript = String.raw`
import os, stat, sys, zipfile
source, target, *entries = sys.argv[1:]
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    def add(relative):
        full = os.path.join(source, relative)
        mode = os.lstat(full).st_mode
        if stat.S_ISLNK(mode):
            info = zipfile.ZipInfo(relative)
            info.create_system = 3
            info.external_attr = mode << 16
            archive.writestr(info, os.readlink(full))
        elif stat.S_ISDIR(mode):
            archive.write(full, relative + '/')
            for name in sorted(os.listdir(full)):
                add(os.path.join(relative, name))
        else:
            archive.write(full, relative)
    for entry in entries:
        add(entry)
`;
      await run('python3', ['-c', zipScript, output, archive, ...distributionEntries], { maxBuffer: 1024 * 1024 });
    }
  }
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(archive)) digest.update(chunk);
  const checksum = `${digest.digest('hex')}  ${path.basename(archive)}\n`;
  await writeFile(`${archive}.sha256`, checksum);
  console.log(`Mac application: ${path.join(output, '3D Desktop.app')}`);
  console.log(`Apple Silicon download: ${archive}`);
  console.log(`SHA-256 checksum: ${archive}.sha256`);
  console.log(process.platform === 'darwin'
    ? 'This build is ad-hoc signed for local use; it is not Developer ID signed or notarized.'
    : 'This cross-compiled build is unsigned. Follow the included Mac installation instructions before opening it.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
