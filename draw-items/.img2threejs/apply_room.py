#!/usr/bin/env python3
"""Fill the cutaway-room assessment and ObjectSculptSpec from the 4.png observation."""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSESSMENT = ROOT / "assessment.json"
SPEC = ROOT / "object-sculpt-spec.json"

FORBIDDEN = {
    "appendage", "branch", "limb", "arm", "leg", "handle", "connector", "tube",
    "cable", "horn", "wing", "tail", "root", "fork", "rib", "support", "hinge",
    "socket", "pipe",
}


def rgba(hex_color: str, alpha: str = "1.0") -> str:
    h = hex_color.lstrip("#")
    return f"rgba({int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)}, {alpha})"


def shade(hex_color: str, factor: float) -> str:
    h = hex_color.lstrip("#")
    channels = [max(0, min(255, int(int(h[i : i + 2], 16) * factor))) for i in (0, 2, 4)]
    return "#" + "".join(f"{c:02x}" for c in channels)


def material(
    mid: str,
    name: str,
    color: str,
    roughness: float,
    metalness: float = 0.0,
    emissive: str = "#000000",
    emissive_intensity: float = 0.0,
) -> dict:
    secondary = shade(color, 0.82)
    return {
        "id": mid,
        "name": name,
        "type": "standard",
        "shaderModel": "MeshStandardMaterial",
        "baseColor": color,
        "color": color,
        "emissive": emissive,
        "emissiveIntensity": {"base": emissive_intensity},
        "albedo": {"dominant": color, "secondary": [secondary]},
        "colorVariation": {
            "palette": [color, secondary],
            "pattern": "flat",
            "amplitude": 0.04,
            "heightCorrelation": 0.0,
        },
        "roughness": {"base": roughness, "variation": 0.06},
        "metalness": {"base": metalness, "variation": 0.0},
        "localOverrides": [
            {
                "id": f"{mid}-contact",
                "region": "contact edges",
                "roughness": min(1.0, roughness + 0.15),
                "dirtAmount": 0.06,
            }
        ],
        "textureless": {
            "declared": True,
            "evidence": [
                "4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."
            ],
        },
    }


MATERIALS = [
    material("wood-floor", "Floor wood", "#d7a56a", 0.55),
    material("wood-seam", "Floor seam", "#c49262", 0.62),
    material("wood", "Furniture wood", "#c4925a", 0.5),
    material("plinth", "Exterior plinth", "#2c3444", 0.7),
    material("wall-white", "Left wall", "#f3f0ec", 0.72),
    material("wall-salmon", "Salmon wall", "#e7a394", 0.7),
    material("plastic-white", "White plastic", "#f7f4f0", 0.42),
    material("plastic-black", "Black plastic", "#1a1a1a", 0.4),
    material("plastic-grey", "Grey plastic", "#8d8f97", 0.48),
    material("fabric-sofa", "Sofa fabric", "#6a6578", 0.82),
    material("chair", "Chair shell", "#2a2a2e", 0.55),
    material("screen-warm", "Warm screen", "#ff6a1a", 0.18, emissive="#ff6a1a", emissive_intensity=2.4),
    material("screen-dark", "TV screen", "#161616", 0.22, emissive="#2a2a2a", emissive_intensity=0.35),
    material("wordmark", "Wordmark", "#f4f4f4", 0.3, emissive="#f4f4f4", emissive_intensity=0.8),
    material("lamp", "Lamp shade", "#fff6e8", 0.28, emissive="#fff4d8", emissive_intensity=2.2),
    material("glow-cyan", "Console glow", "#7ee7e1", 0.25, emissive="#7ee7e1", emissive_intensity=1.8),
    material("leaf", "Leaf", "#3f8f55", 0.58),
    material("guitar", "Guitar body", "#5c3a28", 0.45),
    material("octopus", "Octopus plush", "#c9c4d4", 0.65),
    material("cushion", "Floor cushion", "#efe4d4", 0.75),
    material("void", "Window void", "#050505", 0.9),
]
MATERIALS.extend(
    material(f"fig-{i}", f"Figurine {i}", color, 0.4)
    for i, color in enumerate(
        ["#e85d4c", "#f0a202", "#f4d35e", "#7dce82", "#5eb1e8", "#7a6ff0", "#e86bb0", "#f28c6b"]
    )
)
BOOK_COLORS = ["#355c8a", "#f2f2f2", "#e07a3d", "#2c2c2c", "#8d4a3a", "#d7c4a3", "#4d6b4a", "#c45b6a"]
MATERIALS.extend(material(f"book-{i}", f"Book {i}", color, 0.6) for i, color in enumerate(BOOK_COLORS))
MATERIAL_CLASS = {
    "wood-floor": "wood",
    "wood-seam": "wood",
    "wood": "wood",
    "plinth": "plastic",
    "wall-white": "plastic",
    "wall-salmon": "plastic",
    "plastic-white": "plastic",
    "plastic-black": "plastic",
    "plastic-grey": "plastic",
    "fabric-sofa": "fabric",
    "chair": "plastic",
    "screen-warm": "plastic",
    "screen-dark": "plastic",
    "wordmark": "plastic",
    "lamp": "plastic",
    "glow-cyan": "plastic",
    "leaf": "plastic",
    "guitar": "wood",
    "octopus": "rubber",
    "cushion": "fabric",
    "void": "plastic",
}


def recipe(material_id: str) -> dict:
    mat = next(item for item in MATERIALS if item["id"] == material_id)
    return {
        "dominantAlbedo": rgba(mat["baseColor"]),
        "secondaryAlbedo": rgba(shade(mat["baseColor"], 0.82)),
        "materialClass": MATERIAL_CLASS.get(material_id, "plastic"),
        "materialClassConfidence": 0.75,
    }


def component(cid, name, primitive, level, position, scale, material_id, role, rotation=(0, 0, 0), features=None, evidence="full-object"):
    tokens = set(__import__("re").findall(r"[a-z0-9]+", name.lower()))
    hit = tokens & FORBIDDEN
    if hit:
        raise SystemExit(f"{cid} name {name!r} uses forbidden token(s) {hit}")
    return {
        "id": cid,
        "name": name,
        "level": level,
        "role": role,
        "importance": 0.8 if level == "macro" else 0.55,
        "confidence": 0.72,
        "primitive": primitive,
        "topologyClass": "assembled-solid",
        "topologyRationale": (
            f"{name} is a discrete {primitive} mass in the 4.png cutaway, assembled into the room "
            "rather than modeled as one continuous sculpt."
        ),
        "geometryDescriptor": {
            "topologyIntent": "stylized hard-surface diorama part",
            "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1},
            "deformationStack": [],
            "uvStrategy": "generated procedural coordinates",
            "normalStrategy": "smooth vertex normals",
        },
        "parent": None,
        "attachment": None,
        "dimensions": {
            "width": float(scale[0]),
            "height": float(scale[1]),
            "depth": float(scale[2]),
            "units": "relative",
            "confidence": 0.6,
        },
        "transform": {"position": list(position), "rotation": list(rotation), "scale": list(scale)},
        "actionProfile": {
            "animationRole": "static",
            "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7},
            "transformChannels": {
                "translate": True, "rotate": True, "scale": True, "bend": False, "twist": False,
                "detach": True, "visibility": True, "materialState": False,
            },
            "sockets": [],
            "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": False, "notes": "box proxy"},
            "constraints": [],
            "destruction": {
                "breakable": False, "fractureGroup": cid, "seamRefs": [], "detachableFragments": [],
                "breakImpulse": 0.0, "debrisMaterial": material_id,
            },
        },
        "material": material_id,
        "materialLayers": [material_id],
        "deformations": [],
        "joints": [],
        "seams": [],
        "localFeatures": features or [],
        "surfaceDetail": {
            "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0,
            "normalPattern": "", "displacementPattern": "", "occlusionPattern": "",
            "edgeWearPattern": "", "notes": "",
        },
        "colorMaterialRecipe": recipe(material_id),
        "evidenceRefs": [evidence],
        "details": [],
        "fidelityTier": "blockout" if level == "macro" else "structural-pass",
    }


def feat(fid: str, kind: str, note: str) -> dict:
    return {"id": fid, "kind": kind, "note": note}


def build_components() -> list[dict]:
    parts: list[dict] = []

    def add(*args, **kwargs):
        parts.append(component(*args, **kwargs))

    add("floor", "Floor", "box", "macro", (0, -0.05, 0), (4.72, 0.1, 3.72), "wood-floor", "shell",
        features=[feat("floor-plank-grooves", "groove", "plank seams run along Z")])
    add("plinth", "Exterior plinth", "box", "macro", (0, -0.16, 0), (4.95, 0.12, 3.95), "plinth", "shell")
    add("left-wall", "Left wall", "box", "macro", (-2.24, 1.25, 0), (0.08, 2.5, 3.56), "wall-white", "shell")
    add("back-wall", "Back wall", "box", "macro", (0, 1.25, -1.74), (4.56, 2.5, 0.08), "wall-salmon", "shell",
        features=[feat("window-opening", "hole", "black window opening in the back wall")])
    add("right-wall", "Right wall", "box", "macro", (2.24, 1.25, 0), (0.08, 2.5, 3.56), "wall-salmon", "shell")
    for i, x in enumerate((-1.6, -0.8, 0.0, 0.8, 1.6)):
        add(f"plank-seam-{i}", f"Plank seam {i}", "box", "macro", (x, 0.004, 0), (0.015, 0.008, 3.35), "wood-seam", "seam")

    posts = [(-2.12, -0.1), (-2.12, 0.8), (-1.76, -0.1), (-1.76, 0.8)]
    for i, (x, z) in enumerate(posts):
        add(f"shelf-post-{i}", f"Shelf post {i}", "box", "macro", (x, 1.08, z), (0.06, 2.12, 0.06), "wood", "frame")
    for i, y in enumerate((0.08, 0.55, 1.15, 1.7, 2.12)):
        add(f"shelf-board-{i}", f"Shelf board {i}", "box", "macro", (-1.94, y, 0.35), (0.42, 0.04, 0.96), "wood", "frame",
            features=[feat("shelf-board-bevel", "bevel", "light catches the board front edge")] if i == 4 else None)
    add("shelf-cabinet", "Shelf cabinet", "box", "macro", (-1.94, 0.85, 0.35), (0.36, 0.46, 0.82), "plastic-white", "cabinet",
        features=[feat("cabinet-door-seam", "seam", "vertical split on the white cabinet")])

    for i, z in enumerate((-0.28, -0.12, 0.04, 0.2, 0.36, 0.52, 0.68)):
        add(f"book-top-{i}", f"Top book {i}", "box", "macro", (-1.9, 1.88, z), (0.16, 0.28, 0.07), f"book-{i % 8}", "book")
        add(f"book-low-{i}", f"Low book {i}", "box", "macro", (-1.9, 0.26, z), (0.16, 0.26, 0.07), f"book-{(i + 3) % 8}", "book")

    fig_z = (-0.22, -0.02, 0.16, 0.34, 0.5, 0.66, 0.22, 0.4)
    fig_x = (-1.98, -1.9, -1.98, -1.88, -2.0, -1.9, -1.84, -2.04)
    for i in range(8):
        add(f"figurine-{i}", f"Figurine {i}", "sphere", "macro", (fig_x[i], 2.26, fig_z[i]), (0.13, 0.13, 0.13), f"fig-{i}", "figurine")

    add("desk-top", "Desk top", "box", "macro", (-0.95, 0.74, -1.18), (1.5, 0.05, 0.64), "wood", "top")
    add("drawer-pedestal", "Drawer pedestal", "box", "macro", (-1.42, 0.36, -1.18), (0.42, 0.68, 0.5), "plastic-white", "pedestal")
    for i, y in enumerate((0.52, 0.36, 0.2)):
        add(f"drawer-line-{i}", f"Drawer line {i}", "box", "meso", (-1.2, y, -1.18), (0.01, 0.012, 0.36), "plastic-black", "seam")
    add("monitor-bezel", "Monitor bezel", "box", "macro", (-1.15, 1.16, -1.4), (0.64, 0.4, 0.04), "plastic-black", "screen")
    add("monitor-screen", "Monitor screen", "box", "macro", (-1.15, 1.16, -1.372), (0.56, 0.32, 0.012), "screen-warm", "screen",
        features=[feat("sunset-gradient", "emissive", "orange screen on the monitor")])
    add("monitor-boom", "Monitor boom", "box", "macro", (-1.45, 1.0, -1.42), (0.28, 0.03, 0.03), "plastic-black", "boom", rotation=(0, 0, 0.6))
    add("lamp-shade", "Lamp shade", "sphere", "macro", (-1.58, 1.48, -1.32), (0.22, 0.16, 0.22), "lamp", "lamp",
        features=[feat("lamp-hotspot", "emissive", "white shade is the local key")])
    add("lamp-stem", "Lamp stem", "cylinder", "macro", (-1.55, 1.1, -1.36), (0.03, 0.55, 0.03), "plastic-black", "stem")
    add("laptop-base", "Laptop base", "box", "macro", (-0.42, 0.785, -1.12), (0.36, 0.02, 0.24), "plastic-grey", "computer")
    add("laptop-lid", "Laptop lid", "box", "macro", (-0.42, 0.96, -1.26), (0.36, 0.22, 0.012), "plastic-grey", "computer", rotation=(-0.85, 0, 0))
    add("keyboard", "Keyboard", "box", "macro", (-1.05, 0.78, -1.02), (0.34, 0.02, 0.12), "plastic-black", "peripheral")
    add("mouse", "Mouse", "ellipsoid", "meso", (-0.72, 0.785, -0.98), (0.05, 0.025, 0.08), "plastic-black", "peripheral")
    add("headphone-band", "Headphone band", "torus", "meso", (-1.5, 0.86, -0.98), (0.18, 0.18, 0.18), "plastic-black", "peripheral", rotation=(1.2, 0.4, 0))
    add("headphone-cup-a", "Headphone cup A", "sphere", "meso", (-1.56, 0.8, -0.98), (0.07, 0.08, 0.07), "plastic-black", "peripheral")
    add("headphone-cup-b", "Headphone cup B", "sphere", "meso", (-1.44, 0.8, -0.98), (0.07, 0.08, 0.07), "plastic-black", "peripheral")

    add("chair-seat", "Chair seat", "box", "macro", (-0.65, 0.48, -0.52), (0.52, 0.1, 0.5), "chair", "seat")
    add("chair-back", "Chair back", "box", "macro", (-0.65, 0.9, -0.3), (0.5, 0.62, 0.1), "chair", "backrest")
    add("chair-side-a", "Chair side A", "box", "macro", (-0.9, 0.85, -0.32), (0.06, 0.4, 0.08), "plastic-grey", "bolster")
    add("chair-side-b", "Chair side B", "box", "macro", (-0.4, 0.85, -0.32), (0.06, 0.4, 0.08), "plastic-grey", "bolster")
    add("chair-column", "Chair column", "cylinder", "macro", (-0.65, 0.24, -0.52), (0.08, 0.32, 0.08), "plastic-black", "column")
    add("chair-hub", "Chair hub", "cylinder", "macro", (-0.65, 0.08, -0.52), (0.12, 0.04, 0.12), "plastic-black", "hub")
    for i in range(5):
        angle = i * math.tau / 5
        add(
            f"chair-spoke-{i}",
            f"Chair spoke {i}",
            "box",
            "macro",
            (-0.65 + math.cos(angle) * 0.16, 0.07, -0.52 + math.sin(angle) * 0.16),
            (0.28, 0.025, 0.045),
            "plastic-black",
            "spoke",
            rotation=(0, -angle, 0),
        )
        add(
            f"caster-{i}",
            f"Caster {i}",
            "sphere",
            "macro",
            (-0.65 + math.cos(angle) * 0.28, 0.04, -0.52 + math.sin(angle) * 0.28),
            (0.05, 0.05, 0.05),
            "plastic-black",
            "caster",
        )

    add("sofa-body", "Sofa body", "box", "macro", (0.15, 0.32, 0.82), (1.75, 0.42, 0.62), "fabric-sofa", "seat")
    add("sofa-backrest", "Sofa backrest", "box", "macro", (0.15, 0.62, 1.12), (1.75, 0.5, 0.14), "fabric-sofa", "backrest",
        features=[feat("sofa-blue-rim", "contour", "blue wash outlines the sofa back")])
    add("table-top", "Table top", "box", "macro", (0.45, 0.34, 0.15), (0.78, 0.06, 0.48), "plastic-white", "top",
        features=[feat("table-edge", "bevel", "white top edge catches light")])
    add("table-base", "Table base", "box", "macro", (0.45, 0.16, 0.15), (0.58, 0.24, 0.34), "wood", "base")
    add("gamepad", "Gamepad", "box", "macro", (0.52, 0.39, 0.18), (0.14, 0.035, 0.08), "plastic-black", "peripheral")

    add("octopus-head", "Octopus head", "sphere", "macro", (1.02, 0.72, 0.78), (0.28, 0.24, 0.26), "octopus", "plush")
    for i, dz in enumerate((-0.1, -0.03, 0.04, 0.11, 0.18)):
        add(
            f"tentacle-{i}",
            f"Tentacle {i}",
            "cylinder",
            "macro",
            (1.2, 0.32, 0.72 + dz),
            (0.045, 0.5, 0.045),
            "octopus",
            "plush",
            rotation=(0.08 * (i - 2), 0, 0.22),
        )

    add("tv-panel", "TV panel", "box", "macro", (2.16, 1.42, -0.05), (0.05, 0.92, 1.5), "plastic-black", "screen")
    add("tv-screen", "TV screen", "box", "macro", (2.125, 1.42, -0.05), (0.02, 0.78, 1.32), "screen-dark", "screen",
        features=[feat("journey-wordmark", "decal", "three.js journey wordmark on the upper screen")])
    add("tv-wordmark", "TV wordmark", "box", "macro", (2.11, 1.62, -0.05), (0.012, 0.07, 0.62), "wordmark", "decal")
    add("console-body", "Console body", "box", "macro", (1.62, 0.2, -0.05), (0.38, 0.28, 1.42), "plastic-white", "cabinet")
    add("console-top", "Console top", "box", "macro", (1.62, 0.36, -0.05), (0.44, 0.04, 1.5), "wood", "top")
    add("console-glow", "Console glow", "box", "macro", (1.62, 0.05, -0.05), (0.28, 0.02, 1.15), "glow-cyan", "light",
        features=[feat("underglow", "emissive", "cyan line under the console")])
    add("small-pot", "Small pot", "cylinder", "meso", (1.82, 0.44, 0.48), (0.1, 0.1, 0.1), "plastic-black", "pot")
    add("small-leaf", "Small leaf", "ellipsoid", "meso", (1.82, 0.56, 0.48), (0.12, 0.16, 0.1), "leaf", "foliage")

    add("window-void", "Window void", "box", "macro", (0.4, 1.55, -1.68), (0.78, 1.05, 0.04), "void", "opening")
    add("window-frame-top", "Window frame top", "box", "macro", (0.4, 2.12, -1.66), (0.92, 0.06, 0.05), "plastic-white", "frame")
    add("window-frame-bottom", "Window frame bottom", "box", "macro", (0.4, 0.98, -1.66), (0.92, 0.06, 0.05), "plastic-white", "frame")
    add("window-frame-a", "Window frame A", "box", "macro", (-0.02, 1.55, -1.66), (0.06, 1.16, 0.05), "plastic-white", "frame")
    add("window-frame-b", "Window frame B", "box", "macro", (0.82, 1.55, -1.66), (0.06, 1.16, 0.05), "plastic-white", "frame")
    for i, y in enumerate((1.35, 1.55, 1.75)):
        add(f"window-rail-{i}", f"Window rail {i}", "box", "macro", (0.55, y, -1.655), (0.36, 0.025, 0.02), "plastic-white", "rail")
    add("camera-body", "Camera body", "box", "meso", (-0.2, 1.12, -1.58), (0.1, 0.07, 0.08), "plastic-black", "camera")

    leaves = [
        ((-0.05, 1.45, -1.42), (0.34, 0.1, 0.22), (0.5, 0.2, 0.4)),
        ((0.15, 1.25, -1.38), (0.28, 0.1, 0.36), (-0.3, 0.4, 0.2)),
        ((0.35, 1.55, -1.4), (0.3, 0.09, 0.24), (0.2, -0.3, -0.4)),
        ((0.05, 1.05, -1.32), (0.26, 0.12, 0.3), (0.6, 0.1, 0.3)),
        ((0.28, 1.15, -1.3), (0.22, 0.08, 0.28), (-0.4, 0.5, 0.1)),
    ]
    for i, (pos, scale, rot) in enumerate(leaves):
        add(f"leaf-{i}", f"Leaf {i}", "ellipsoid", "macro", pos, scale, "leaf", "foliage", rotation=rot)

    add("guitar-body", "Guitar body", "ellipsoid", "macro", (-1.48, 0.32, 0.55), (0.34, 0.46, 0.14), "guitar", "instrument", rotation=(0.15, 0.2, 0.55))
    add("guitar-neck", "Guitar neck", "cylinder", "macro", (-1.68, 0.72, 0.42), (0.04, 0.7, 0.04), "wood", "instrument", rotation=(0.15, 0, 0.45))

    add("cushion-a", "Cushion A", "box", "macro", (1.0, 0.06, -0.72), (0.48, 0.1, 0.28), "cushion", "soft")
    add("cushion-b", "Cushion B", "box", "macro", (1.35, 0.05, -0.42), (0.4, 0.08, 0.26), "cushion", "soft")
    return parts


def details() -> list[dict]:
    rows = [
        ("floor-grooves", "groove", "floor", "plank seams"),
        ("shelf-bevel", "bevel", "shelf-board-4", "top board edge"),
        ("cabinet-seam", "seam", "shelf-cabinet", "door split"),
        ("screen-gloss", "gloss", "monitor-screen", "low roughness orange panel"),
        ("screen-emit", "emissive", "monitor-screen", "sunset image"),
        ("lamp-emit", "emissive", "lamp-shade", "desk lamp"),
        ("wordmark-decal", "decal", "tv-wordmark", "three.js journey"),
        ("underglow-emit", "emissive", "console-glow", "cyan gap light"),
        ("table-bevel", "bevel", "table-top", "white edge"),
        ("sofa-contour", "contour", "sofa-backrest", "blue rim on the backrest"),
        ("window-line", "linework", "window-rail-1", "horizontal rails"),
        ("window-hole", "hole", "window-void", "black exterior"),
    ]
    return [
        {
            "id": did,
            "kind": kind,
            "region": region,
            "affects": kind,
            "scale": "meso",
            "confidence": 0.7,
            "evidenceRef": "full-object",
            "mapsTo": {"type": "component", "ref": ref},
        }
        for did, kind, ref, region in rows
    ]


def fill_assessment(assessment: dict) -> None:
    assessment["objectClass"] = {
        "primaryType": "cutaway room diorama",
        "primaryDomain": "object",
        "formLanguage": ["geometric", "hard-surface", "architectural"],
        "structureKind": ["compound object", "repeated modules", "layered shell"],
        "motionPotential": ["static prop"],
        "materialFamilies": ["wood", "plastic", "fabric", "rubber"],
        "notes": (
            "Flat stylized paint. Local evidence core.pbr-hand-painted-vs-pbr-texture says not to invent a photo texture. "
            "core.coordinate-relative-units: dimensions are relative to the room box, not manufacturing units. "
            "core.pbr-color-space-srgb-vs-linearnocolorspace: albedo and emissive are sRGB."
        ),
    }
    assessment["complexity"]["tier"] = "complex"
    assessment["complexity"]["scores"] = {
        "silhouetteComplexity": 2,
        "componentCount": 3,
        "hierarchyDepth": 2,
        "repetitionDensity": 2,
        "materialLayerCount": 2,
        "localDetailDensity": 1,
        "occlusionRisk": 3,
        "actionReadinessNeed": 1,
    }
    assessment["complexity"]["estimatedCounts"] = {
        "macroComponents": 20,
        "mesoComponents": 12,
        "microFeatureGroups": 6,
        "materialLayers": 12,
        "repetitionSystems": 1,
    }
    assessment["complexity"]["reasoning"] = [
        "Many discrete furniture masses, but each mass is a simple primitive. Not ultra-complex microstructure.",
        "One isometric view. Back faces are symmetry inferences, recorded as limits rather than open unknowns.",
        "Blue and magenta washes are lights. They are not baked into wall albedo.",
    ]
    decision = assessment["specDepthDecision"]
    decision["requiredDepth"] = "complex"
    decision["minimumComponentLevels"] = ["macro", "meso", "micro"]
    decision["needsRepetitionSystems"] = True
    decision["needsMaterialLocalOverrides"] = True
    decision["needsMultipleReviewViews"] = True
    decision["needsActionReadyHierarchy"] = True
    decision["rationale"] = "Complex furnishing assembly. Micro marks are seams, the wordmark, and emissive panels, not pores."
    assessment["unknownsToResolveBeforeImplementation"] = []
    inventory = assessment["detailInventory"]
    inventory["scanMethod"] = "grid-3x3"
    inventory["targetMinDetails"] = 10
    inventory["details"] = details()
    assessment["anatomy"]["applies"] = False


def quality_contract(existing: dict) -> dict:
    existing["qualityBar"] = "complex"
    existing["definitionOfDone"] = [
        "The open-front, open-top room box, salmon and white walls, and tan floor match the diorama silhouette.",
        "Bookshelf, desk, chair, sofa, table, TV, window, guitar, plant, and octopus occupy the same regions as 4.png.",
        "Blue, warm, and magenta light are separate from albedo. Screens and the lamp are emissive.",
    ]
    existing["minimumSpecDepth"] = {
        "macroComponents": 3,
        "mesoComponents": 8,
        "microFeatureGroups": 5,
        "materialLayers": 3,
        "repetitionSystems": 1,
        "reviewViewpoints": 4,
    }
    existing["featureGroups"] = [
        {
            "id": "room-shell",
            "name": "Cutaway room shell",
            "required": True,
            "qualityCriteria": [
                "Floor, three walls, dark plinth, open top, and open +Z side match the diorama box.",
            ],
            "evidenceRefs": ["full-object"],
            "failureModes": ["a closed room", "a single furniture prop with no shell"],
        },
        {
            "id": "furniture-layout",
            "name": "Furniture layout",
            "required": True,
            "qualityCriteria": [
                "Shelf on -X, workstation on the back-left, sofa nearest +Z, TV on +X.",
            ],
            "evidenceRefs": ["full-object"],
            "failureModes": ["furniture floats", "TV and shelf swap walls"],
        },
        {
            "id": "identity-marks",
            "name": "Identity marks",
            "required": True,
            "qualityCriteria": [
                "Rainbow figurines, orange monitor, octopus, guitar, window rails, and the TV wordmark are present.",
            ],
            "evidenceRefs": ["full-object"],
            "failureModes": ["generic empty room", "missing the wordmark or octopus"],
        },
        {
            "id": "light-not-albedo",
            "name": "Colored light kept off albedo",
            "required": True,
            "qualityCriteria": [
                "Left wall stays off-white and the right wall stays salmon. Blue and magenta are lights.",
            ],
            "evidenceRefs": ["full-object"],
            "failureModes": ["magenta painted into the right-wall albedo"],
        },
    ]
    existing["visualDeltaChecks"] = [
        "Compare the room box silhouette against 4.png from the isometric three-quarter.",
        "Check shelf, sofa, and TV placement before judging small props.",
    ]
    existing["antiShallowSpecRules"] = [
        "Do not collapse the room into one box.",
        "Do not bake the colored washes into wall albedo.",
    ]
    existing["mustNotDo"] = [
        "Do not project the lit reference as albedo.",
        "Do not claim measured architecture from one isometric view.",
    ]
    return existing


def view_evidence() -> list[dict]:
    def region(eid, x, y, w, h, note):
        return {
            "id": eid,
            "note": note,
            "confidence": 0.75,
            "imageRegion": {"x": x, "y": y, "width": w, "height": h},
        }

    return [
        region("full-object", 0.18, 0.1, 0.66, 0.78, "whole diorama"),
        region("shelf-zone", 0.2, 0.2, 0.16, 0.5, "bookshelf and guitar"),
        region("desk-zone", 0.3, 0.28, 0.22, 0.28, "desk, monitor, chair"),
        region("sofa-zone", 0.34, 0.55, 0.32, 0.28, "sofa, octopus, table"),
        region("tv-zone", 0.6, 0.26, 0.2, 0.32, "TV and console"),
    ]


def feature_targets() -> list[dict]:
    def target(tid, name, tier, pass_id, refs, minimum):
        return {
            "id": tid,
            "name": name,
            "tier": tier,
            "passIds": [pass_id],
            "minimumScore": minimum,
            "mustPass": tier == "critical",
            "componentRefs": refs,
            "evidenceRefs": ["full-object"],
        }

    return [
        target("room-box", "Open room box", "critical", "blockout", ["floor", "left-wall", "back-wall", "right-wall"], 0.8),
        target("wall-colors", "White left wall and salmon back wall", "critical", "blockout", ["left-wall", "back-wall", "right-wall"], 0.8),
        target("major-furniture", "Shelf desk sofa TV masses", "critical", "blockout", ["shelf-cabinet", "desk-top", "sofa-body", "tv-panel"], 0.75),
        target("workstation", "Monitor chair and lamp", "important", "blockout", ["monitor-screen", "chair-seat", "lamp-shade"], 0.65),
        target("identity-props", "Figurines octopus guitar plant", "important", "blockout", ["figurine-0", "octopus-head", "guitar-body", "leaf-0"], 0.65),
        target("small-peripherals", "Keyboard headphones gamepad", "important", "structural-pass", ["keyboard", "headphone-band", "gamepad"], 0.6),
        target("wordmark", "TV wordmark", "critical", "blockout", ["tv-wordmark"], 0.7),
        target("colored-wash", "Blue warm and magenta washes", "critical", "lighting-pass", ["left-wall", "right-wall", "lamp-shade"], 0.75),
    ]


def repetition() -> list[dict]:
    return [
        {
            "id": "chair-casters",
            "name": "Five chair casters",
            "level": "micro",
            "parent": "chair-hub",
            "count": 5,
            "primitive": "sphere",
            "material": "plastic-black",
            "instanceScale": [0.05, 0.05, 0.05],
            "elementComponentIds": [f"caster-{i}" for i in range(5)],
            "placement": {"mode": "radial", "axis": [0, 1, 0], "radius": 0.56},
            "buildsGeometry": False,
            "realization": "authored-components",
            "distribution": "Five spheres already authored around the hub. This system records the repeat and must not emit a second ring.",
        }
    ]


def apply_spec(spec: dict) -> None:
    fill_assessment(spec["preSpecAssessment"])
    quality_contract(spec["qualityContract"])
    parts = build_components()
    spec["componentTree"] = parts
    spec["materials"] = MATERIALS
    spec["repetitionSystems"] = repetition()
    spec["suitability"] = "conditional"
    spec["scores"] = {
        "object_isolation": 2,
        "silhouette_readability": 3,
        "depth_inference": 2,
        "primitive_decomposition": 3,
        "material_procedurality": 3,
        "occlusion_risk": 2,
        "interaction_fit": 2,
    }
    spec["viewEvidence"] = view_evidence()
    spec["featureReviewTargets"] = feature_targets()
    spec["sourceImage"] = "/Users/xiaodigen/Desktop/Github/threejs-home/draw-items/4.png"
    spec["referenceCamera"] = {
        "solved": False,
        "fovDegrees": 28.0,
        "aspect": 1.525,
        "orientation": {"yaw": 0.65, "pitch": -0.62, "roll": 0.0},
        "positionHint": [4.2, 4.4, 5.6],
        "note": "Manual isometric match to 4.png. Not a solved pose. Projection was skipped because the surfaces are flat paint.",
    }
    spec["qualityTargets"]["targetFidelity"] = 0.7
    spec["qualityTargets"]["mustMatch"] = [
        "open-front open-top room box",
        "shelf on the left, TV on the right, sofa nearest the camera",
        "salmon walls, white left wall, tan floor",
        "orange monitor, octopus, figurines, guitar, window",
    ]
    spec["qualityTargets"]["niceToHave"] = [
        "exact TV glyph outlines",
        "guitar sound hole",
        "gamepad buttons",
    ]
    spec["qualityTargets"]["reviewViewpoints"] = [
        "isometric-three-quarter",
        "left-wall",
        "back-wall",
        "right-wall",
    ]
    spec["lightingFromPhoto"] = [
        "Key light: small white practical at the desk lamp, warm-neutral, high intensity.",
        "Fill light: blue-violet wash on the left wall. Cool color temperature. Not part of the wall albedo.",
        "Rim light: magenta wash on the right wall around the TV.",
        "Exposure stays moderate under ACES filmic tone mapping against a black background.",
        "Contact shadow: short soft ground shadows under the sofa, chair, table, and guitar.",
    ]
    spec["performanceBudget"] = {"targetTriangles": 50000, "fpsTarget": 60}
    spec["approximationNotes"] = [
        "Single isometric view. Back faces are mirrored inferences.",
        "Generator does not bevel boxes. Edge bevels are specified and will read sharper than 4.png until a later pass.",
        "TV glyphs are a wordmark card. Exact letterforms are a canvas decal, not extracted pixels.",
        "Dimensions follow core.coordinate-relative-units and are not manufacturing measurements.",
    ]
    spec["risks"] = [
        "Hidden backs of the sofa, chair, TV, and shelf.",
        "Book count and figurine count are representative, not a census.",
    ]
    by_level: dict[str, list[str]] = {"macro": [], "meso": [], "micro": []}
    for part in parts:
        by_level.setdefault(part["level"], []).append(part["id"])
    for item in spec.get("buildPasses", []):
        pid = item.get("id")
        if pid == "blockout":
            item["componentRefs"] = by_level["macro"]
        elif pid == "structural-pass":
            item["componentRefs"] = by_level["meso"]
        elif pid == "form-refinement":
            item["componentRefs"] = by_level["micro"] or by_level["meso"]
        else:
            item["componentRefs"] = [part["id"] for part in parts]
    counts = {level: len(ids) for level, ids in by_level.items()}
    features = sum(len(part["localFeatures"]) for part in parts)
    print(f"components={len(parts)} levels={counts} localFeatures={features} materials={len(MATERIALS)}")


def main() -> None:
    if ASSESSMENT.exists():
        payload = json.loads(ASSESSMENT.read_text())
        fill_assessment(payload["preSpecAssessment"])
        quality_contract(payload["qualityContract"])
        ASSESSMENT.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"updated {ASSESSMENT}")
    if SPEC.exists():
        spec = json.loads(SPEC.read_text())
        apply_spec(spec)
        SPEC.write_text(json.dumps(spec, indent=2) + "\n")
        print(f"updated {SPEC}")


if __name__ == "__main__":
    main()
