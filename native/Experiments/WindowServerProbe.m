// Minimal, unprivileged WindowServer experiment. No injection or security changes.
// Private declarations checked against Chromium's constrained_window_animation.mm.
#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#include <dlfcn.h>
#include <signal.h>

typedef struct { float x, y; } MeshPoint;
typedef struct { MeshPoint local, global; } WarpPoint;
typedef int (*ConnectionFn)(void);
typedef CGError (*GetTransformFn)(int, uint32_t, CGAffineTransform *);
typedef CGError (*SetTransformFn)(int, uint32_t, CGAffineTransform);
typedef CGError (*SetWarpFn)(int, uint32_t, int, int, const WarpPoint *);
typedef CGError (*GetOwnerFn)(int, uint32_t, int *);
static volatile sig_atomic_t stopping;
static void stop(int sig) { stopping = sig; }
static void pump(double seconds) {
    NSDate *end = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (!stopping && [end timeIntervalSinceNow] > 0) {
        NSEvent *event = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]
                                              inMode:NSDefaultRunLoopMode dequeue:YES];
        if (event) [NSApp sendEvent:event];
        [NSApp updateWindows];
    }
}
static NSArray *matrix(CGAffineTransform t) {
    return @[@(t.a), @(t.b), @(t.c), @(t.d), @(t.tx), @(t.ty)];
}
static void output(NSDictionary *record) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys error:nil];
    puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
    fflush(stdout);
}
int main(int argc, const char **argv) { @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    void *sky = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW | RTLD_LOCAL);
    ConnectionFn connection = dlsym(sky, "SLSMainConnectionID");
    GetTransformFn getTransform = dlsym(sky, "SLSGetWindowTransform");
    SetTransformFn setTransform = dlsym(sky, "SLSSetWindowTransform");
    SetWarpFn setWarp = dlsym(sky, "SLSSetWindowWarp");
    GetOwnerFn getOwner = dlsym(sky, "SLSGetWindowOwner");
    output(@{@"kind":@"environment", @"os":NSProcessInfo.processInfo.operatingSystemVersionString,
             @"accessibility":@(AXIsProcessTrusted()), @"screenCapture":@(CGPreflightScreenCaptureAccess()),
             @"eventPost":@(CGPreflightPostEventAccess()), @"eventListen":@(CGPreflightListenEventAccess()),
             @"symbols":@{@"connection":@(connection != NULL), @"getTransform":@(getTransform != NULL),
                          @"setTransform":@(setTransform != NULL), @"setWarp":@(setWarp != NULL)}});
    NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionAll | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
    if (argc < 2 || strcmp(argv[1], "list") == 0) {
        for (NSDictionary *window in windows) {
            if ([window[(id)kCGWindowLayer] intValue] != 0) continue;
            output(@{@"kind":@"window", @"id":window[(id)kCGWindowNumber], @"pid":window[(id)kCGWindowOwnerPID],
                     @"app":window[(id)kCGWindowOwnerName] ?: @"", @"onScreen":window[(id)kCGWindowIsOnscreen] ?: @NO, @"bounds":window[(id)kCGWindowBounds]});
        }
        return 0;
    }
    if (!connection || !getTransform || !setTransform || !setWarp || !getOwner) return 2;
    BOOL own = strcmp(argv[1], "self") == 0;
    if (!own && strcmp(argv[1], "window") != 0) { fputs("Usage: WindowServerProbe list | self | window ID [seconds] [affine]\n", stderr); return 2; }
    if (!own && argc < 3) return 2;
    NSWindow *ownedWindow = nil;
    uint32_t wid = own ? 0 : (uint32_t)strtoul(argv[2], NULL, 10);
    CGRect bounds = CGRectZero;
    if (own) {
        ownedWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(200, 200, 600, 350)
                      styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                      backing:NSBackingStoreBuffered defer:NO];
        ownedWindow.title = @"3D Desktop — owned-window positive control";
        NSTextField *label = [NSTextField labelWithString:@"WindowServer perspective probe\nThis is the OWNED control, not proof for other apps.\nRestores and exits after 12 seconds."];
        label.frame = NSMakeRect(40, 110, 520, 160);
        label.font = [NSFont systemFontOfSize:22];
        [ownedWindow.contentView addSubview:label];
        [ownedWindow makeKeyAndOrderFront:nil];
        wid = (uint32_t)ownedWindow.windowNumber;
        bounds = CGRectMake(200, NSScreen.screens[0].frame.size.height - NSMaxY(ownedWindow.frame), 600, ownedWindow.frame.size.height);
    } else {
        for (NSDictionary *w in windows) {
            if ([w[(id)kCGWindowNumber] unsignedIntValue] == wid)
                CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)w[(id)kCGWindowBounds], &bounds);
        }
        if (CGRectIsEmpty(bounds)) { fputs("Choose an on-screen standard test window.\n", stderr); return 3; }
    }
    pump(0.2);
    int cid = connection(), owner = 0;
    CGAffineTransform original = CGAffineTransformIdentity;
    CGError ownerResult = getOwner(cid, wid, &owner);
    CGError readResult = getTransform(cid, wid, &original);
    output(@{@"kind":@"before", @"window":@(wid), @"own":@(own), @"connection":@(cid), @"owner":@(owner),
             @"ownerResult":@(ownerResult), @"readResult":@(readResult), @"transform":matrix(original)});
    if (readResult != kCGErrorSuccess) return 4;
    // First prove whether an ordinary connection is allowed even to write the current value.
    BOOL affine = argc > 4 && strcmp(argv[4], "affine") == 0;
    double seconds = argc > 3 ? fmin(60, fmax(1, atof(argv[3]))) : 12;
    CGAffineTransform requested = affine ? CGAffineTransformMake(1.25, 0, 0, 1.25, original.tx - 30, original.ty - 30) : original;
    CGError affineResult = setTransform(cid, wid, requested);
    CGFloat x = bounds.origin.x, y = bounds.origin.y, w = bounds.size.width, h = bounds.size.height;
    WarpPoint points[4] = {{{0,0},{x+80,y+35}}, {{w,0},{x+w-65,y}},
                          {{0,h},{x+80,y+h-35}}, {{w,h},{x+w-65,y+h}}};
    CGError warpResult = affine ? kCGErrorSuccess : setWarp(cid, wid, 2, 2, points);
    pump(0.2);
    CGAffineTransform applied = CGAffineTransformIdentity;
    CGError appliedRead = getTransform(cid, wid, &applied);
    output(@{@"kind":@"apply", @"affine":@(affine), @"affineResult":@(affineResult), @"warpResult":@(warpResult), @"seconds":@(seconds), @"appliedReadResult":@(appliedRead), @"requested":matrix(requested), @"actual":matrix(applied)});
    signal(SIGINT, stop); signal(SIGTERM, stop);
    if (warpResult == kCGErrorSuccess) {
        pump(seconds);
    }
    getTransform(cid, wid, &applied);
    output(@{@"kind":@"beforeRestore", @"actual":matrix(applied)});
    CGError clearResult = setWarp(cid, wid, 0, 0, NULL);
    CGError restoreResult = setTransform(cid, wid, original);
    CGAffineTransform after = CGAffineTransformIdentity;
    CGError afterResult = getTransform(cid, wid, &after);
    output(@{@"kind":@"restore", @"clearWarpResult":@(clearResult), @"restoreTransformResult":@(restoreResult),
             @"readResult":@(afterResult), @"transform":matrix(after), @"matrixMatches":@(CGAffineTransformEqualToTransform(original, after))});
    [ownedWindow orderOut:nil];
    return warpResult == kCGErrorSuccess ? 0 : 5;
}}
