#!/usr/bin/env python3
"""
Prints OS-level screen coordinates in real time.
Uses ctypes + CoreGraphics — no extra packages needed.
Ctrl-C to stop.
"""
import ctypes, time, sys

class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

cg = ctypes.cdll.LoadLibrary(
    '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics'
)
cg.CGEventCreate.restype = ctypes.c_void_p
cg.CGEventCreate.argtypes = [ctypes.c_void_p]
cg.CGEventGetLocation.restype = CGPoint
cg.CGEventGetLocation.argtypes = [ctypes.c_void_p]

print("Move your mouse — Ctrl-C to stop\n")
try:
    while True:
        ev  = cg.CGEventCreate(None)
        pos = cg.CGEventGetLocation(ev)
        sys.stdout.write(f'\r  ({int(pos.x):5d}, {int(pos.y):5d})   ')
        sys.stdout.flush()
        time.sleep(0.04)
except KeyboardInterrupt:
    print()
