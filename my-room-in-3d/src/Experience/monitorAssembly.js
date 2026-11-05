import * as THREE from 'three'

// This room's screen is 2.40 x 1.38. The bezel island behind it is 2.44 wide,
// and the desktop is 3.53, so the furniture cap sits between those two.
// An island is kept only when its center is inside the padded screen box.
// A box test alone would pull in the Mac and the desktop where they graze it.
const MAX_ISLAND_EDGE = 2.55

const corner = new THREE.Vector3()
const center = new THREE.Vector3()

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

function screenVolume(screenGeometry, screenMatrix)
{
    const box = positionsBox(screenGeometry.getAttribute('position'), screenMatrix)
    box.min.x -= 0.06
    box.max.x += 0.06
    box.min.y -= 0.18
    box.max.y += 0.06
    box.min.z -= 0.42
    box.max.z += 0.06
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

function splitRoom(geometry, matrix, volume)
{
    const index = geometry.getIndex()
    const position = geometry.getAttribute('position')
    if(!index || !position)
        return null

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
                keep: false
            }
            islands.set(root, island)
        }

        include(island, source[triangle * 3])
        include(island, source[triangle * 3 + 1])
        include(island, source[triangle * 3 + 2])
    }

    const bodyBox = new THREE.Box3()

    for(const island of islands.values())
    {
        const box = worldBoxOf(island.min, island.max, matrix)
        const size = box.getSize(corner)
        island.keep = Math.max(size.x, size.y, size.z) <= MAX_ISLAND_EDGE && volume.containsPoint(box.getCenter(center))
        if(island.keep)
            bodyBox.union(box)
    }

    let monitorTriangles = 0

    for(let triangle = 0; triangle < triangleCount; triangle++)
    {
        if(islands.get(find(source[triangle * 3])).keep)
            monitorTriangles += 1
    }

    const size = bodyBox.getSize(corner)
    const maxEdge = Math.max(size.x, size.y, size.z)
    const minEdge = Math.min(size.x, size.y, size.z)

    if(bodyBox.isEmpty() || monitorTriangles < 10 || maxEdge > 2.8 || minEdge < 0.2)
        return null

    const monitor = new Uint32Array(monitorTriangles * 3)
    const rest = new Uint32Array((triangleCount - monitorTriangles) * 3)
    let monitorCursor = 0
    let restCursor = 0

    for(let triangle = 0; triangle < triangleCount; triangle++)
    {
        const keep = islands.get(find(source[triangle * 3])).keep
        const target = keep ? monitor : rest
        let cursor = keep ? monitorCursor : restCursor
        target[cursor] = source[triangle * 3]
        target[cursor + 1] = source[triangle * 3 + 1]
        target[cursor + 2] = source[triangle * 3 + 2]
        if(keep)
            monitorCursor += 3
        else
            restCursor += 3
    }

    return { monitor, rest, monitorTriangles, bodyBox }
}

export function assembleComputer(roomMesh, screenMesh)
{
    roomMesh.updateWorldMatrix(true, false)
    screenMesh.updateWorldMatrix(true, false)

    const screenBox = positionsBox(screenMesh.geometry.getAttribute('position'), screenMesh.matrixWorld)
    const split = splitRoom(
        roomMesh.geometry,
        roomMesh.matrixWorld,
        screenVolume(screenMesh.geometry, screenMesh.matrixWorld)
    )

    if(!split || !split.bodyBox.intersectsBox(screenBox))
        return null

    const shellGeometry = geometryWithIndex(roomMesh.geometry, split.monitor)
    roomMesh.geometry.setIndex(new THREE.BufferAttribute(split.rest, 1))
    roomMesh.geometry.groups = []
    roomMesh.geometry.boundingBox = boundsFromIndex(roomMesh.geometry)
    roomMesh.geometry.boundingSphere = roomMesh.geometry.boundingBox.getBoundingSphere(new THREE.Sphere())

    const shell = new THREE.Mesh(shellGeometry, roomMesh.material)
    shell.name = 'monitor-shell'
    shell.position.copy(roomMesh.position)
    shell.quaternion.copy(roomMesh.quaternion)
    shell.scale.copy(roomMesh.scale)

    const group = new THREE.Group()
    group.name = 'computer'
    group.add(shell)
    group.add(screenMesh)
    return group
}
