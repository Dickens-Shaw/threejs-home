import * as THREE from 'three'

// Islands are kept only when their center sits inside an object's volume and
// the island itself is smaller than the furniture around it. Walls run about
// 5 to 10, so those stay in the room shell. The desktop is its own 3.53 slab.
// Volumes were measured in this room's world space. A cut whose union is the
// wrong size is left on the shell.

const corner = new THREE.Vector3()
const size = new THREE.Vector3()

function positionsBox(position, matrix)
{
    const box = new THREE.Box3()

    for(let i = 0; i < position.count; i++)
    {
        corner.fromBufferAttribute(position, i)
        if(matrix)
            corner.applyMatrix4(matrix)
        box.expandByPoint(corner)
    }

    return box
}

function boundsFromIndex(geometry)
{
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const box = new THREE.Box3()

    for(let i = 0; i < index.count; i++)
    {
        corner.fromBufferAttribute(position, index.getX(i))
        box.expandByPoint(corner)
    }

    return box
}

function geometryWithIndex(source, indexArray)
{
    const geometry = new THREE.BufferGeometry()

    for(const name of Object.keys(source.attributes))
        geometry.setAttribute(name, source.getAttribute(name))

    geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
    geometry.boundingBox = boundsFromIndex(geometry)
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere())
    return geometry
}

function worldBoxOf(min, max, matrix)
{
    const box = new THREE.Box3()

    for(const x of [min[0], max[0]])
    {
        for(const y of [min[1], max[1]])
        {
            for(const z of [min[2], max[2]])
                box.expandByPoint(corner.set(x, y, z).applyMatrix4(matrix))
        }
    }

    return box
}

function contains(record, min, max)
{
    const center = record.center
    return center.x >= min[0] && center.x <= max[0]
        && center.y >= min[1] && center.y <= max[1]
        && center.z >= min[2] && center.z <= max[2]
}

function padBox(box, minPad, maxPad)
{
    const next = box.clone()
    next.min.x += minPad[0]
    next.min.y += minPad[1]
    next.min.z += minPad[2]
    next.max.x += maxPad[0]
    next.max.y += maxPad[1]
    next.max.z += maxPad[2]
    return next
}

function collectIslands(geometry, matrix)
{
    const index = geometry.getIndex()
    const position = geometry.getAttribute('position')
    const source = index.array
    const triangleCount = source.length / 3
    const vertexCount = position.count
    const parent = new Uint32Array(vertexCount)

    for(let i = 0; i < vertexCount; i++)
        parent[i] = i

    const find = (vertex) =>
    {
        while(parent[vertex] !== vertex)
        {
            parent[vertex] = parent[parent[vertex]]
            vertex = parent[vertex]
        }
        return vertex
    }

    const union = (a, b) =>
    {
        a = find(a)
        b = find(b)
        if(a !== b)
            parent[b] = a
    }

    for(let triangle = 0; triangle < triangleCount; triangle++)
    {
        const a = source[triangle * 3]
        const b = source[triangle * 3 + 1]
        const c = source[triangle * 3 + 2]
        union(a, b)
        union(b, c)
    }

    const islands = new Map()

    const include = (island, vertex) =>
    {
        const x = position.getX(vertex)
        const y = position.getY(vertex)
        const z = position.getZ(vertex)
        if(x < island.min[0]) island.min[0] = x
        if(y < island.min[1]) island.min[1] = y
        if(z < island.min[2]) island.min[2] = z
        if(x > island.max[0]) island.max[0] = x
        if(y > island.max[1]) island.max[1] = y
        if(z > island.max[2]) island.max[2] = z
    }

    for(let triangle = 0; triangle < triangleCount; triangle++)
    {
        const root = find(source[triangle * 3])
        let island = islands.get(root)

        if(!island)
        {
            island = {
                min: [Infinity, Infinity, Infinity],
                max: [-Infinity, -Infinity, -Infinity],
                tris: 0,
                owner: null
            }
            islands.set(root, island)
        }

        island.tris += 1
        include(island, source[triangle * 3])
        include(island, source[triangle * 3 + 1])
        include(island, source[triangle * 3 + 2])
    }

    const records = []

    for(const island of islands.values())
    {
        const box = worldBoxOf(island.min, island.max, matrix)
        const islandSize = box.getSize(new THREE.Vector3())
        island.box = box
        island.center = box.getCenter(new THREE.Vector3())
        island.size = islandSize
        island.edge = Math.max(islandSize.x, islandSize.y, islandSize.z)
        records.push(island)
    }

    return { source, triangleCount, find, islands, records }
}

function claim(records, id, test, limit)
{
    const hits = []
    const box = new THREE.Box3()
    let tris = 0

    for(const record of records)
    {
        if(record.owner || !test(record))
            continue
        hits.push(record)
        tris += record.tris
        box.union(record.box)
    }

    if(!hits.length || tris < limit.minTris)
        return false

    const unionSize = box.getSize(size)
    const maxEdge = Math.max(unionSize.x, unionSize.y, unionSize.z)
    const minEdge = Math.min(unionSize.x, unionSize.y, unionSize.z)

    if(maxEdge > limit.maxEdge || minEdge < limit.minEdge)
        return false

    if(limit.hits && !box.intersectsBox(limit.hits))
        return false

    for(const hit of hits)
        hit.owner = id

    return true
}

function screenVolume(screenBox)
{
    const box = screenBox.clone()
    box.min.x -= 0.06
    box.max.x += 0.06
    box.min.y -= 0.18
    box.max.y += 0.06
    box.min.z -= 0.42
    box.max.z += 0.06
    return box
}

function standVolume(screenBox)
{
    const origin = screenBox.getCenter(new THREE.Vector3())
    return new THREE.Box3(
        new THREE.Vector3(origin.x - 1.15, origin.y - 1.10, origin.z - 0.50),
        new THREE.Vector3(origin.x + 0.85, origin.y - 0.94, origin.z + 0.42)
    )
}

function rulesFor(seeds)
{
    const screenCenter = seeds.pcScreen.getCenter(new THREE.Vector3())
    const macVolume = padBox(seeds.macScreen, [-0.17, -0.5, -0.43], [0.16, 0.45, 0.8])
    const lightVolume = padBox(seeds.elgato, [-0.12, -0.18, -0.20], [0.15, 0.15, 0.18])
    const deckVolume = padBox(seeds.buttons, [-0.15, -0.04, -0.07], [0.15, 0.07, 0.01])
    const speakerVolume = padBox(seeds.leds, [-0.21, -0.26, -0.21], [0.26, 0.18, 0.25])
    const steam = seeds.steam.getCenter(new THREE.Vector3())

    return [
        {
            id: 'computer',
            minTris: 50,
            maxEdge: 2.8,
            minEdge: 0.2,
            hits: seeds.pcScreen,
            test: (record) =>
            {
                const inScreen = record.edge <= 2.55 && screenVolume(seeds.pcScreen).containsPoint(record.center)
                const inStand = record.edge >= 0.4 && record.edge <= 0.85 && record.size.y < 0.1
                    && standVolume(seeds.pcScreen).containsPoint(record.center)
                return inScreen || inStand
            }
        },
        {
            id: 'headphones',
            minTris: 20,
            maxEdge: 0.35,
            minEdge: 0.08,
            test: (record) => contains(record, [-1.56, 2.34, -4.55], [-1.36, 2.5, -4.32])
                && record.edge <= 0.22 && record.size.y > 0.08 && record.tris >= 20
        },
        {
            id: 'mic',
            minTris: 200,
            maxEdge: 2.2,
            minEdge: 0.2,
            test: (record) => contains(record,
                [screenCenter.x - 1.94, screenCenter.y - 1.56, screenCenter.z - 0.12],
                [screenCenter.x - 1.15, screenCenter.y + 0.40, screenCenter.z + 0.56]
            ) && record.edge <= 1.8 && record.edge >= 0.1 && record.size.y >= 0.08
        },
        {
            id: 'loupedeck',
            minTris: 40,
            maxEdge: 0.8,
            minEdge: 0.05,
            test: (record) => deckVolume.containsPoint(record.center) && record.edge >= 0.12 && record.edge <= 0.6
        },
        {
            id: 'elgato',
            minTris: 40,
            maxEdge: 2.8,
            minEdge: 0.12,
            test: (record) => (lightVolume.containsPoint(record.center) && record.edge <= 1.05)
                || (contains(record, [-0.3, 2.35, -5.08], [1.95, 4.7, -4.72])
                    && record.edge <= 1.5
                    && Math.min(record.size.x, record.size.z) < 0.35
                    && record.tris >= 8)
        },
        {
            id: 'camera',
            minTris: 80,
            maxEdge: 0.8,
            minEdge: 0.15,
            test: (record) => contains(record, [2.35, 3.65, -4.9], [3.05, 4.25, -4.15]) && record.edge <= 0.65
        },
        {
            id: 'mac',
            minTris: 80,
            maxEdge: 2.4,
            minEdge: 0.2,
            hits: seeds.macScreen,
            test: (record) => macVolume.containsPoint(record.center) && record.edge <= 1.55
                && !(record.center.y > 3.6 && record.center.x > 2.35)
                && !(record.size.y < 0.05 && record.edge > 0.9)
        },
        {
            id: 'plant',
            minTris: 400,
            maxEdge: 3.2,
            minEdge: 0.4,
            test: (record) => contains(record, [3.05, 2, -5.15], [4.5, 4.9, -3.2]) && record.edge <= 2.05 && record.tris >= 20
        },
        {
            id: 'guitar',
            minTris: 80,
            maxEdge: 3.2,
            minEdge: 0.4,
            test: (record) => contains(record, [-3.45, 0.35, -3.95], [-2.7, 2.85, -3.05]) && record.edge <= 2.5 && record.edge >= 0.7
        },
        {
            id: 'mug',
            minTris: 80,
            maxEdge: 0.7,
            minEdge: 0.1,
            test: (record) => Math.abs(record.center.x - steam.x) < 0.22
                && Math.abs(record.center.z - steam.z) < 0.22
                && record.center.y > 1.85 && record.center.y < 2.65
                && record.edge < 0.5
                && !(record.size.y < 0.02 && record.edge > 0.28)
        },
        {
            id: 'rubik',
            minTris: 12,
            maxEdge: 0.25,
            minEdge: 0.03,
            test: (record) => contains(record, [-1.58, 2.45, -4.58], [-1.28, 2.66, -4.22]) && record.edge <= 0.09
        },
        {
            id: 'controller',
            minTris: 80,
            maxEdge: 0.9,
            minEdge: 0.05,
            test: (record) => contains(record, [-0.45, 0.95, 1.55], [0.15, 1.24, 2.3])
                && record.edge <= 0.7 && record.tris >= 4
        },
        {
            id: 'keyboard',
            minTris: 80,
            maxEdge: 0.8,
            minEdge: 0.08,
            test: (record) => contains(record, [-0.25, 2.35, -4.55], [0.7, 2.6, -4.05]) && record.edge <= 0.12
        },
        {
            id: 'google',
            minTris: 40,
            maxEdge: 0.6,
            minEdge: 0.08,
            test: (record) => speakerVolume.containsPoint(record.center) && record.edge <= 0.5
        },
        {
            id: 'among',
            minTris: 400,
            maxEdge: 2.8,
            minEdge: 0.4,
            test: (record) => contains(record, [-5.1, 5.15, -5.2], [-2.5, 6.45, -4])
                && record.edge < 0.75
                && Math.min(record.size.x, record.size.y, record.size.z) > 0.22
        },
        {
            id: 'books',
            minTris: 80,
            maxEdge: 5,
            minEdge: 0.3,
            test: (record) =>
            {
                if(!contains(record, [-5.1, 1.15, -5.2], [-2.5, 5.1, -4.05]))
                    return false
                const dims = [record.size.x, record.size.y, record.size.z].sort((a, b) => a - b)
                return dims[0] < 0.22 && dims[1] > 0.2 && dims[2] > 0.45 && dims[2] < 1.05
            }
        },
        {
            id: 'shelf',
            minTris: 400,
            maxEdge: 5.1,
            minEdge: 0.4,
            test: (record) => contains(record, [-5.15, 0.9, -5.25], [-2.55, 6.45, -3.3])
                && record.tris >= 8
                && (record.edge <= 1.35 || (record.edge <= 2.55 && record.size.y < 0.12 && record.size.x > 1.2))
        },
        {
            id: 'desk',
            minTris: 8,
            maxEdge: 3.8,
            minEdge: 0.04,
            test: (record) =>
            {
                const slab = record.edge > 3 && record.edge < 3.8 && record.size.y < 0.15
                    && record.center.y > 2.1 && record.center.y < 2.5 && record.center.z < -4
                const body = contains(record, [-1.65, 1.85, -5.15], [2.1, 2.25, -3.9])
                    && record.edge <= 2 && record.tris >= 8 && record.size.y < 0.4 && record.size.y > 0.005
                return slab || body
            }
        },
        {
            id: 'table',
            minTris: 20,
            maxEdge: 3.2,
            minEdge: 0.5,
            test: (record) => contains(record, [-0.9, 0.2, 0.05], [1.6, 1.05, 3.3])
                && record.edge >= 0.7 && record.edge <= 3.1 && record.center.y < 1.05
        },
        {
            id: 'sofa',
            minTris: 400,
            maxEdge: 6.2,
            minEdge: 0.4,
            test: (record) =>
            {
                const cushion = contains(record, [-3.9, 0.4, -1.4], [-1.5, 1.95, 4.3])
                    && record.edge <= 2.6 && record.size.y <= 1.15 && record.tris >= 12
                const shell = contains(record, [-4.2, 0, -1.6], [-1.5, 1.95, 4.5])
                    && record.edge >= 4 && record.edge <= 6.2
                    && record.tris < 400 && record.size.y >= 1.5 && record.size.y <= 2
                return cushion || shell
            }
        },
        {
            id: 'chair',
            minTris: 40,
            maxEdge: 2.5,
            minEdge: 0.15,
            test: (record) =>
            {
                const dx = record.center.x - 0.792
                const dz = record.center.z + 1.533
                return dx * dx + dz * dz < 1.4
                    && record.center.y > 0.04 && record.center.y < 1.35
                    && record.edge <= 2.1 && record.tris >= 8
                    && record.size.y > 0.02
            }
        }
    ]
}

const CLIP_EPS = 1e-5

function pointInside(point, box)
{
    return point.x >= box.min.x - CLIP_EPS && point.x <= box.max.x + CLIP_EPS
        && point.y >= box.min.y - CLIP_EPS && point.y <= box.max.y + CLIP_EPS
        && point.z >= box.min.z - CLIP_EPS && point.z <= box.max.z + CLIP_EPS
}

function lerpClip(a, b, t)
{
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        lx: a.lx + (b.lx - a.lx) * t,
        ly: a.ly + (b.ly - a.ly) * t,
        lz: a.lz + (b.lz - a.lz) * t,
        u: a.u + (b.u - a.u) * t,
        v: a.v + (b.v - a.v) * t
    }
}

function splitPoly(poly, axis, limit, direction)
{
    const inside = []
    const outside = []

    for(let i = 0; i < poly.length; i++)
    {
        const current = poly[i]
        const next = poly[(i + 1) % poly.length]
        const currentSide = direction * (current[axis] - limit)
        const nextSide = direction * (next[axis] - limit)
        const currentIn = currentSide >= -CLIP_EPS
        const nextIn = nextSide >= -CLIP_EPS

        if(currentIn)
            inside.push(current)
        else
            outside.push(current)

        if(currentIn === nextIn)
            continue

        const delta = next[axis] - current[axis]
        const t = Math.abs(delta) < CLIP_EPS ? 0 : (limit - current[axis]) / delta
        const mid = lerpClip(current, next, Math.min(1, Math.max(0, t)))
        inside.push(mid)
        outside.push(mid)
    }

    return { inside, outside }
}

function clipBox(poly, box)
{
    let parts = [poly]
    const scraps = []
    const planes = [
        ['x', box.min.x, 1],
        ['x', box.max.x, -1],
        ['y', box.min.y, 1],
        ['y', box.max.y, -1],
        ['z', box.min.z, 1],
        ['z', box.max.z, -1]
    ]

    for(const [axis, limit, direction] of planes)
    {
        const next = []

        for(const part of parts)
        {
            const split = splitPoly(part, axis, limit, direction)
            if(split.outside.length >= 3)
                scraps.push(split.outside)
            if(split.inside.length >= 3)
                next.push(split.inside)
        }

        parts = next
        if(!parts.length)
            break
    }

    return { inside: parts, outside: scraps }
}

function pushPolygon(positions, uvs, indices, poly)
{
    if(poly.length < 3)
        return

    const base = positions.length / 3
    let wrote = 0

    for(let i = 1; i < poly.length - 1; i++)
    {
        const ax = poly[i].x - poly[0].x
        const ay = poly[i].y - poly[0].y
        const az = poly[i].z - poly[0].z
        const bx = poly[i + 1].x - poly[0].x
        const by = poly[i + 1].y - poly[0].y
        const bz = poly[i + 1].z - poly[0].z
        const crossX = ay * bz - az * by
        const crossY = az * bx - ax * bz
        const crossZ = ax * by - ay * bx
        if(crossX * crossX + crossY * crossY + crossZ * crossZ < 1e-12)
            continue
        if(!wrote)
        {
            for(const point of poly)
            {
                positions.push(point.lx, point.ly, point.lz)
                uvs.push(point.u, point.v)
            }
        }
        indices.push(base, base + i, base + i + 1)
        wrote += 1
    }
}

function geometryFromClip(positions, uvs, indices)
{
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
}

function hardCutsFor()
{
    return [
        { id: 'tv', min: [4.16, 1.46, -0.34], max: [4.32, 3.88, 3.98], spanX: 0.12 },
        { id: 'stand', min: [3.5, 0.02, 1.4], max: [4.16, 1.72, 4.05] }
    ]
}

function applyHardCuts(geometry, matrix, source, triangleCount, triOwner)
{
    const position = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    const world = new THREE.Vector3()
    const local = new THREE.Vector3()
    const cuts = hardCutsFor().map((cut) => ({
        ...cut,
        box: new THREE.Box3(new THREE.Vector3(...cut.min), new THREE.Vector3(...cut.max)),
        whole: [],
        positions: [],
        uvs: [],
        indices: []
    }))
    const patch = { positions: [], uvs: [], indices: [] }
    let pool = []

    const readPoint = (vertex) =>
    {
        local.fromBufferAttribute(position, vertex)
        world.copy(local).applyMatrix4(matrix)
        return {
            x: world.x,
            y: world.y,
            z: world.z,
            lx: local.x,
            ly: local.y,
            lz: local.z,
            u: uv ? uv.getX(vertex) : 0,
            v: uv ? uv.getY(vertex) : 0
        }
    }

    for(let triangle = 0; triangle < triangleCount; triangle++)
    {
        if(triOwner[triangle])
            continue

        const poly = [
            readPoint(source[triangle * 3]),
            readPoint(source[triangle * 3 + 1]),
            readPoint(source[triangle * 3 + 2])
        ]
        const min = [Math.min(poly[0].x, poly[1].x, poly[2].x), Math.min(poly[0].y, poly[1].y, poly[2].y), Math.min(poly[0].z, poly[1].z, poly[2].z)]
        const max = [Math.max(poly[0].x, poly[1].x, poly[2].x), Math.max(poly[0].y, poly[1].y, poly[2].y), Math.max(poly[0].z, poly[1].z, poly[2].z)]
        const hits = cuts.some((cut) => min[0] <= cut.box.max.x && max[0] >= cut.box.min.x
            && min[1] <= cut.box.max.y && max[1] >= cut.box.min.y
            && min[2] <= cut.box.max.z && max[2] >= cut.box.min.z)
        if(hits)
            pool.push({ poly, triangle })
    }

    for(const cut of cuts)
    {
        const next = []

        for(const item of pool)
        {
            let spanX = 0
            for(const point of item.poly)
                spanX = Math.max(spanX, point.x)
            let spanMinX = Infinity
            for(const point of item.poly)
                spanMinX = Math.min(spanMinX, point.x)
            if(cut.spanX && spanX - spanMinX > cut.spanX)
            {
                next.push(item)
                continue
            }

            const fullyIn = item.poly.every((point) => pointInside(point, cut.box))
            if(fullyIn)
            {
                if(item.triangle !== null)
                {
                    cut.whole.push(item.triangle)
                    triOwner[item.triangle] = cut.id
                }
                else
                    pushPolygon(cut.positions, cut.uvs, cut.indices, item.poly)
                continue
            }

            const bounds = item.poly.reduce((box, point) =>
            {
                box.min[0] = Math.min(box.min[0], point.x)
                box.min[1] = Math.min(box.min[1], point.y)
                box.min[2] = Math.min(box.min[2], point.z)
                box.max[0] = Math.max(box.max[0], point.x)
                box.max[1] = Math.max(box.max[1], point.y)
                box.max[2] = Math.max(box.max[2], point.z)
                return box
            }, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] })
            const misses = bounds.min[0] > cut.box.max.x || bounds.max[0] < cut.box.min.x
                || bounds.min[1] > cut.box.max.y || bounds.max[1] < cut.box.min.y
                || bounds.min[2] > cut.box.max.z || bounds.max[2] < cut.box.min.z
            if(misses)
            {
                next.push(item)
                continue
            }

            const clipped = clipBox(item.poly, cut.box)
            if(!clipped.inside.length)
            {
                next.push(item)
                continue
            }

            if(item.triangle !== null)
                triOwner[item.triangle] = `${cut.id}#clip`

            for(const poly of clipped.inside)
                pushPolygon(cut.positions, cut.uvs, cut.indices, poly)
            for(const poly of clipped.outside)
                next.push({ poly, triangle: null })
        }

        pool = next
    }

    for(const item of pool)
    {
        if(item.triangle === null)
            pushPolygon(patch.positions, patch.uvs, patch.indices, item.poly)
    }

    return { cuts, patch }
}

function makeShell(roomMesh, indexArray, name)
{
    const shell = new THREE.Mesh(geometryWithIndex(roomMesh.geometry, indexArray), roomMesh.material)
    shell.name = name
    shell.position.copy(roomMesh.position)
    shell.quaternion.copy(roomMesh.quaternion)
    shell.scale.copy(roomMesh.scale)
    return shell
}

function makeGroup(name, shell, extras)
{
    const group = new THREE.Group()
    group.name = name
    group.add(shell)

    for(const extra of extras)
        group.add(extra)

    return group
}

export function assembleRoom(roomMesh, parts)
{
    roomMesh.updateWorldMatrix(true, false)

    const meshes = [parts.pcScreen, parts.macScreen, parts.elgato, parts.steam, ...parts.buttons, ...parts.leds]
    for(const mesh of meshes)
        mesh.updateWorldMatrix(true, false)

    const seeds = {
        pcScreen: positionsBox(parts.pcScreen.geometry.getAttribute('position'), parts.pcScreen.matrixWorld),
        macScreen: positionsBox(parts.macScreen.geometry.getAttribute('position'), parts.macScreen.matrixWorld),
        elgato: positionsBox(parts.elgato.geometry.getAttribute('position'), parts.elgato.matrixWorld),
        steam: positionsBox(parts.steam.geometry.getAttribute('position'), parts.steam.matrixWorld),
        buttons: new THREE.Box3(),
        leds: new THREE.Box3()
    }

    for(const mesh of parts.buttons)
        seeds.buttons.union(positionsBox(mesh.geometry.getAttribute('position'), mesh.matrixWorld))

    for(const mesh of parts.leds)
        seeds.leds.union(positionsBox(mesh.geometry.getAttribute('position'), mesh.matrixWorld))

    const split = collectIslands(roomMesh.geometry, roomMesh.matrixWorld)
    const rules = rulesFor(seeds)
    const kept = []

    for(const rule of rules)
    {
        if(claim(split.records, rule.id, rule.test, rule))
            kept.push(rule.id)
    }

    const triOwner = new Array(split.triangleCount).fill(null)

    for(let triangle = 0; triangle < split.triangleCount; triangle++)
    {
        const owner = split.islands.get(split.find(split.source[triangle * 3])).owner
        if(owner)
            triOwner[triangle] = owner
    }

    const hard = applyHardCuts(roomMesh.geometry, roomMesh.matrixWorld, split.source, split.triangleCount, triOwner)
    const counts = new Map()
    for(const id of kept)
        counts.set(id, 0)

    for(const cut of hard.cuts)
    {
        if(cut.whole.length || cut.indices.length)
            counts.set(cut.id, 0)
    }

    let restTriangles = 0

    for(let triangle = 0; triangle < split.triangleCount; triangle++)
    {
        const owner = triOwner[triangle]
        if(owner && owner.indexOf('#clip') === -1)
            counts.set(owner, counts.get(owner) + 1)
        else if(!owner)
            restTriangles += 1
    }

    const arrays = new Map()
    for(const [id, count] of counts)
        arrays.set(id, { array: new Uint32Array(count * 3), cursor: 0 })

    const rest = new Uint32Array(restTriangles * 3)
    let restCursor = 0

    for(let triangle = 0; triangle < split.triangleCount; triangle++)
    {
        const raw = triOwner[triangle]
        if(raw && raw.indexOf('#clip') !== -1)
            continue

        const target = raw ? arrays.get(raw) : null
        const array = target ? target.array : rest
        let cursor = target ? target.cursor : restCursor
        array[cursor] = split.source[triangle * 3]
        array[cursor + 1] = split.source[triangle * 3 + 1]
        array[cursor + 2] = split.source[triangle * 3 + 2]
        if(target)
            target.cursor += 3
        else
            restCursor += 3
    }

    roomMesh.geometry.setIndex(new THREE.BufferAttribute(rest, 1))
    roomMesh.geometry.groups = []
    roomMesh.geometry.boundingBox = boundsFromIndex(roomMesh.geometry)
    roomMesh.geometry.boundingSphere = roomMesh.geometry.boundingBox.getBoundingSphere(new THREE.Sphere())

    const extras = {
        computer: [parts.pcScreen],
        mac: [parts.macScreen],
        elgato: [parts.elgato],
        loupedeck: parts.buttons,
        mug: [parts.steam],
        google: parts.leds
    }
    const groups = {}

    for(const [id, packed] of arrays)
    {
        if(!packed.array.length)
            continue

        const shell = makeShell(roomMesh, packed.array, `${id}-shell`)
        groups[id] = makeGroup(id, shell, extras[id] || [])
    }

    for(const cut of hard.cuts)
    {
        if(!cut.indices.length)
            continue

        if(!groups[cut.id])
        {
            const group = new THREE.Group()
            group.name = cut.id
            groups[cut.id] = group
        }

        const piece = new THREE.Mesh(geometryFromClip(cut.positions, cut.uvs, cut.indices), roomMesh.material)
        piece.name = `${cut.id}-clip`
        piece.position.copy(roomMesh.position)
        piece.quaternion.copy(roomMesh.quaternion)
        piece.scale.copy(roomMesh.scale)
        groups[cut.id].add(piece)
    }

    if(hard.patch.indices.length)
    {
        const patch = new THREE.Mesh(geometryFromClip(hard.patch.positions, hard.patch.uvs, hard.patch.indices), roomMesh.material)
        patch.name = 'room-patch'
        roomMesh.add(patch)
    }

    return groups
}

// The keyboard body is drawn on the desk. This patch is the compact dark
// print under the keycaps (about 0.5 by 0.25). Wider dark areas stay put.
const KEYBOARD_PRINT = { minU: 0.6609, maxU: 0.6792, minV: 0.5117, maxV: 0.5209 }
const DESK_TOP = { x0: -1.532, x1: 1.999, z0: -4.13, z1: -5.059, y: 2.36, u0: 0.73154, u1: 0.60243, v0: 0.51024, v1: 0.54434 }

function deskPoint(u, v)
{
    const x = DESK_TOP.x0 + (DESK_TOP.u0 - u) / (DESK_TOP.u0 - DESK_TOP.u1) * (DESK_TOP.x1 - DESK_TOP.x0)
    const z = DESK_TOP.z0 + (v - DESK_TOP.v0) / (DESK_TOP.v1 - DESK_TOP.v0) * (DESK_TOP.z1 - DESK_TOP.z0)
    return [x, DESK_TOP.y + 0.0015, z]
}

function paintedTexture(source, uv)
{
    const image = source.image
    if(!image || !image.width)
        return source

    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)

    const x0 = Math.max(0, Math.floor(uv.minU * canvas.width))
    const y0 = Math.max(0, Math.floor(uv.minV * canvas.height))
    const x1 = Math.min(canvas.width, Math.ceil(uv.maxU * canvas.width))
    const y1 = Math.min(canvas.height, Math.ceil(uv.maxV * canvas.height))
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    const data = pixels.data
    const outside = (x, y) =>
    {
        const clampedX = Math.max(0, Math.min(canvas.width - 1, x))
        const clampedY = Math.max(0, Math.min(canvas.height - 1, y))
        const offset = (clampedY * canvas.width + clampedX) * 4
        return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]
    }

    for(let y = y0; y < y1; y++)
    {
        for(let x = x0; x < x1; x++)
        {
            const nearest = Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y)
            let sample = outside(x, y0 - 2)
            if(nearest === x - x0)
                sample = outside(x0 - 2, y)
            else if(nearest === x1 - 1 - x)
                sample = outside(x1 + 1, y)
            else if(nearest === y1 - 1 - y)
                sample = outside(x, y1 + 1)
            const offset = (y * canvas.width + x) * 4
            data[offset] = sample[0]
            data[offset + 1] = sample[1]
            data[offset + 2] = sample[2]
            data[offset + 3] = sample[3]
        }
    }

    context.putImageData(pixels, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.encoding = source.encoding
    texture.flipY = false
    texture.needsUpdate = true
    return texture
}

export function attachKeyboardPrint(group, material)
{
    const corners = [
        [KEYBOARD_PRINT.maxU, KEYBOARD_PRINT.minV],
        [KEYBOARD_PRINT.minU, KEYBOARD_PRINT.minV],
        [KEYBOARD_PRINT.minU, KEYBOARD_PRINT.maxV],
        [KEYBOARD_PRINT.maxU, KEYBOARD_PRINT.maxV]
    ]
    const positions = []
    for(const [u, v] of corners)
        positions.push(...deskPoint(u, v))

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(corners.flat(), 2))
    const edgeA = new THREE.Vector3(positions[3] - positions[0], positions[4] - positions[1], positions[5] - positions[2])
    const edgeB = new THREE.Vector3(positions[6] - positions[0], positions[7] - positions[1], positions[8] - positions[2])
    geometry.setIndex(edgeA.cross(edgeB).y < 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3])
    geometry.computeVertexNormals()

    const cardMaterial = material.clone()
    for(const name of ['uNightMix', 'uNeutralMix', 'uLightMapTexture', 'uLightTvColor', 'uLightTvStrength', 'uLightDeskColor', 'uLightDeskStrength', 'uLightPcColor', 'uLightPcStrength'])
        cardMaterial.uniforms[name] = material.uniforms[name]

    const card = new THREE.Mesh(geometry, cardMaterial)
    card.name = 'keyboard-print'
    card.material.polygonOffset = true
    card.material.polygonOffsetFactor = -2
    card.material.polygonOffsetUnits = -2
    group.add(card)

    if(typeof document === 'undefined')
        return

    for(const name of ['uBakedDayTexture', 'uBakedNightTexture', 'uBakedNeutralTexture'])
    {
        const source = material.uniforms[name] && material.uniforms[name].value
        if(source)
            material.uniforms[name].value = paintedTexture(source, KEYBOARD_PRINT)
    }
}
