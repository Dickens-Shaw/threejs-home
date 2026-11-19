# Image analysis — 4.png

Reference: `4.png`, 1720×1128. Protocol: `grimoire/intake/image_analysis.md`.
Coordinate frame used below: Y up, +X toward the TV wall, −X toward the bookshelf wall, −Z toward the window wall, +Z toward the open front (camera side).

## Layer 1 — Identification

- Work type: cutaway room diorama.
- Broad class: architectural furnishing assembly.
- `primaryDomain`: `object`.
- Confidence: 0.93 that the reconstruction target is the whole box, not one piece of furniture. One bounded subject fills the frame (probe foreground coverage 0.959).
- The render is already stylized hard-surface geometry with flat color, not a photograph.

## Layer 2 — Form and silhouette

- Bounding volume: rectangular cuboid, open on +Z and open at the top. No ceiling plane. No front wall.
- Exterior cut edges read as a dark blue-grey slab under the floor and along the wall thickness.
- Empty-box symmetry would be bilateral; the furnishing is asymmetric.
- Shape language: geometric. Rounded blobs (figurines, octopus, lamp shade, plant leaves) are the organic exceptions.
- Floor plan is wider along X than deep along Z. Wall height is a bit over half the floor width. Proportions are inferred from one isometric view.

## Layer 3 — Macro, meso, micro

Macro masses:

- room shell: floor, left wall, back wall, right wall, dark plinth
- bookshelf against the left wall: wood uprights and boards, white mid cabinet, book rows, figurine cluster on the top
- workstation: desk top, white drawer pedestal, monitor on a boom, lamp, laptop, chair
- lounge: dark sofa seen from the back, white-top coffee table, octopus on the sofa's +X end
- media wall: large black TV, low console, small plant, cyan underglow
- window bay: white frame, black exterior, horizontal rails, broad-leaf plant, small camera

Meso: books, keyboard, mouse, headphones, gamepad, drawer fronts, window rails, chair base spokes, cushions.
Micro: plank seams, cabinet door seam, screen wordmark, tentacle tips, caster spheres.

## Layer 4 — Spatial relationships

- `<left wall, supports, bookshelf>` contact: butt. Shelf back is flush to the wall.
- `<bookshelf front, supports, guitar>` contact: overlap / lean. Body on the floor, neck upward.
- `<desk, above, drawer pedestal>` contact: butt. Desk continues toward the window.
- `<monitor, in front of, back wall>` on a dark boom. Screen faces +Z.
- `<chair, faces, desk>` the backrest is toward +Z.
- `<sofa backrest, faces, +Z>` nearest the camera. Seat is occluded.
- `<coffee table, between, sofa and TV console>` table top is white, base is wood.
- `<gamepad, on, coffee table>`.
- `<TV, mounted on, right wall>` screen faces −X. Wordmark sits in the upper area of the panel.
- `<console, below, TV>` cyan linear glow in the gap under the console.
- `<window, set in, back wall>` exterior is black. Plant leaves overlap the frame.
- `<octopus, draped on, sofa +X end>` tentacles hang down the outer face.

## Layer 5 — Materials (PBR, lighting removed where possible)

| Surface | Albedo (inferred, lighting removed) | Metalness | Roughness | Notes |
|---|---|---|---|---|
| Floor | warm tan wood | 0 | 0.55 satin | plank seams |
| Left wall | off-white | 0 | 0.7 | blue wash is light, not paint |
| Back and right walls | salmon pink | 0 | 0.72 | right wall looks more magenta because of a colored wash |
| Shelf and desk wood | light tan | 0 | 0.5 | |
| White cabinet, drawers, table top, window frame | white | 0 | 0.45 | |
| Sofa | dark grey-violet fabric | 0 | 0.8 | |
| Chair | black with grey side panels | 0 | 0.55 | |
| TV and monitor bezels | near black | 0 | 0.4 | |
| Monitor image | orange-yellow | 0 | 0.2 | emissive |
| TV image | near black | 0 | 0.25 | emissive, light wordmark |
| Lamp shade | white | 0 | 0.3 | emissive |
| Plant leaves | mid green | 0 | 0.6 | |
| Octopus | pale grey-lavender | 0 | 0.65 | |
| Guitar body | dark brown | 0 | 0.45 | |
| Figurines | saturated distinct hues | 0 | 0.4 | |

Inference: do not bake the blue or magenta washes into albedo.

## Layer 6 — Color and finish

- Left: cool blue-violet light on a white wall, strongest high on the wall.
- Center: warm orange from the monitor, hard white from the lamp shade.
- Right: magenta wash on the salmon wall, cyan line under the console.
- Finishes are matte to satin. No brushed metal, no clearcoat wood, no glass caustics.
- The window is not a daylight source. The opening is black.

## Layer 7 — Identity-defining features

- Open-top, open-front room box on a black void.
- Salmon back/right walls, white left wall, tan floor.
- Bookshelf with a rainbow figurine cluster and a leaning guitar.
- Orange monitor, open laptop, gaming chair.
- Dark sofa with a pale octopus on the +X end.
- TV wordmark reading `three.js journey`.
- Window with white rails and a broad-leaf plant.
- Three-color practical lighting: blue, warm, magenta.

## Layer 8 — Uncertainty

- Back faces of the sofa, chair, TV, and shelf are hidden.
- Drawer interiors, cabinet interior, and exact book count are hidden. Book spines are color blocks, not readable titles.
- Guitar sound hole, strings, and headstock are below the pixel size.
- Octopus suckers are not resolved. Visible tentacles are about four or five; the hidden side is guessed.
- Mouse and gamepad button layout is unresolved.
- Large-plant pot is occluded.
- Caster count is inferred as five from the chair silhouette.
- Exact plank count and wall thickness are inferred from the cut edge.
- A second view does not exist. Hidden sides are symmetry inferences, not measurements.

## Suitability

Conditional. The rubric's "scene, not an object" reject does not fit: the frame has one diorama with a strong silhouette, and that diorama is built from primitives. Output is a stylized real-time prop, not measured architecture. Exact glyph outlines on the TV are a generated decal, not a photo projection.
