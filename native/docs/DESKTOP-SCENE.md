# Whole-desktop scene direction

Requested behavior: the existing desktop becomes one navigable 3D scene. Dragging empty space rotates the shared view; each real application window retains its own position, depth, and orientation. Selecting a window must not flatten it. This is a product requirement, not functionality verified in the current build.

## Proposed interaction

- An explicit scene-navigation modifier plus a drag on empty desktop rotates the whole scene. This preserves ordinary Finder desktop selection and drag-and-drop. A configurable unmodified navigation mode can follow once hit testing is reliable.
- Scrolling in scene-navigation mode changes camera distance.
- Window manipulation changes that window's placement within the scene; camera movement changes the view of all windows together.
- Restore resets the camera and removes all compositor presentations, returning to the ordinary desktop.

The shared camera transform must compose with each window transform before projection. Rendering and pointer hit testing must use the same combined transform. Overlapping windows need front-to-back hit testing; menus and dialogs need explicit ownership and stacking behavior. A captured full-desktop plane could test camera motion, but would not establish independent window depth or correct input.

## Verification gate

The current single-window proof has user-confirmed typing, cursor placement, scrolling, and some successful menu selections. Menu behavior remains intermittent. A mouse-interception/custom-cursor experiment caused invisible cursor and broken hover inside the transformed floating window; it is disabled. The user confirmed ordinary cursor recovery after the utility stopped.

Before enabling a desktop-wide input surface, establish repeatable hover and exact menu-item selection on a transformed window, verify the emergency shortcut while the target app has focus, and test forced-exit restoration. Then test two overlapping windows, dialog/menu ownership, and shared-camera input mapping. Dock, menu bar, Spaces, full-screen apps, and additional displays require separate acceptance tests; they are not implied by scene rendering.

No system security changes are part of this plan. Input experiments require deliberate starts and bounded restoration; the failed custom-cursor route remains disabled by default.
