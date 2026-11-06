import * as THREE from 'three'
import { gsap } from 'gsap'

import Experience from './Experience.js'

const CATEGORIES = [
    { id: 'shell', title: '基准', color: '#c8c2b8' },
    { id: 'furniture', title: '家具', color: '#e4c4a8' },
    { id: 'screen', title: '屏幕', color: '#9ec1ff' },
    { id: 'light', title: '灯光', color: '#ffb15c' },
    { id: 'console', title: '控制台', color: '#d7b0ff' },
    { id: 'decor', title: '装饰', color: '#9ed9b8' }
]

const LIST_CELL = 2.2
const LIST_FIT = 1.6
const LIST_Y = 2

export default class AssetViews
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.camera = this.experience.camera
        this.navigation = this.experience.navigation
        this.debug = this.experience.debug
        this.world = this.experience.world
        this.domElement = this.experience.renderer.instance.domElement

        this.assets = []
        this.assetByObject = new Map()
        this.selected = null
        this.hovered = null
        this.mode = 'assembled'
        this.suspendMotion = false
        this.motion = null
        this.motionRun = 0
        this.assembledView = null

        const limits = this.navigation.view.spherical.limits
        this.savedLimits = {
            radius: { min: limits.radius.min, max: limits.radius.max },
            phi: { min: limits.phi.min, max: limits.phi.max },
            theta: { min: limits.theta.min, max: limits.theta.max }
        }

        this._box = new THREE.Box3()
        this._center = new THREE.Vector3()
        this._size = new THREE.Vector3()
        this._forward = new THREE.Vector3()
        this._toPoint = new THREE.Vector3()
        this._color = new THREE.Color()
        this._selectedColor = new THREE.Color('#fff4d2')
        this._pointer = new THREE.Vector2()
        this._raycaster = new THREE.Raycaster()

        this.setAssets()
        this.chairHomeRotation = this.world.topChair.model.group.rotation.y
        this.setExplode()
        this.setListLayout()
        this.setHelpers()
        this.setInterface()
        this.setPicking()
    }

    setAssets()
    {
        const world = this.world

        this.addAsset({
            id: 'room',
            name: '房间壳体',
            short: '房间壳体',
            kind: '结构',
            file: 'roomModel.glb',
            category: 'shell',
            object: world.baked.model.mesh,
            anchor: true
        })

        const assembly = world.assembly || {}

        this.addGrouped(assembly.shelf, {
            id: 'shelf',
            name: '书架',
            short: '书架',
            kind: '家具',
            file: 'roomModel.glb',
            category: 'furniture'
        })

        this.addGrouped(assembly.computer, {
            id: 'computer',
            name: '电脑',
            short: '电脑',
            kind: '家具',
            file: '显示器 + 屏幕',
            category: 'screen'
        }, {
            id: 'pc-screen',
            name: '电脑屏幕',
            short: '电脑屏幕',
            kind: '屏幕',
            file: 'pcScreenModel.glb',
            category: 'screen',
            object: world.pcScreen.model.mesh
        })

        this.addGrouped(assembly.mac, {
            id: 'mac',
            name: 'Mac',
            short: 'Mac',
            kind: '家具',
            file: '机身 + macScreenModel.glb',
            category: 'screen'
        }, {
            id: 'mac-screen',
            name: 'Mac 屏幕',
            short: 'Mac 屏幕',
            kind: '屏幕',
            file: 'macScreenModel.glb',
            category: 'screen',
            object: world.macScreen.model.mesh
        })

        this.addGrouped(assembly.desk, {
            id: 'desk',
            name: '电脑桌',
            short: '电脑桌',
            kind: '家具',
            file: 'roomModel.glb',
            category: 'furniture'
        })

        this.addGrouped(assembly.keyboard, {
            id: 'keyboard',
            name: '键盘',
            short: '键盘',
            kind: '家具',
            file: 'roomModel.glb',
            category: 'furniture'
        })

        this.addGrouped(assembly.sofa, {
            id: 'sofa',
            name: '沙发',
            short: '沙发',
            kind: '家具',
            file: 'roomModel.glb',
            category: 'furniture'
        })

        this.addGrouped(assembly.table, {
            id: 'table',
            name: '茶几',
            short: '茶几',
            kind: '家具',
            file: 'roomModel.glb',
            category: 'furniture'
        })

        this.addGrouped(assembly.tv, {
            id: 'tv',
            name: '电视',
            short: '电视',
            kind: '家具',
            file: '屏幕 + 弹跳标志',
            category: 'screen'
        })

        this.addGrouped(assembly.stand, {
            id: 'stand',
            name: '电视柜',
            short: '电视柜',
            kind: '家具',
            file: 'roomModel.glb',
            category: 'furniture'
        })

        this.addGrouped(assembly.headphones, {
            id: 'headphones',
            name: '耳机',
            short: '耳机',
            kind: '装饰',
            file: 'roomModel.glb',
            category: 'decor'
        })

        this.addGrouped(assembly.controller, {
            id: 'controller',
            name: '手柄',
            short: '手柄',
            kind: '装饰',
            file: 'roomModel.glb',
            category: 'decor'
        })

        this.addGrouped(assembly.chair, {
            id: 'chair',
            name: '转椅',
            short: '转椅',
            kind: '家具',
            file: '椅座 + 底座',
            category: 'furniture'
        }, {
            id: 'chair',
            name: '转椅',
            short: '转椅',
            kind: '家具',
            file: 'topChairModel.glb',
            category: 'furniture',
            object: world.topChair.model.group
        })

        this.addGrouped(assembly.elgato, {
            id: 'elgato',
            name: 'Elgato 补光灯',
            short: '补光灯',
            kind: '灯光',
            file: '灯头 + elgatoLightModel.glb',
            category: 'light'
        }, {
            id: 'elgato',
            name: 'Elgato 补光灯',
            short: '补光灯',
            kind: '灯光',
            file: 'elgatoLightModel.glb',
            category: 'light',
            object: world.elgatoLight.model.mesh
        })

        this.addGrouped(assembly.google, {
            id: 'google',
            name: 'Google Home',
            short: 'Google Home',
            kind: '灯光',
            file: '机身 + googleHomeLedsModel.glb',
            category: 'light'
        })

        if(!assembly.google)
        {
            world.googleLeds.model.items.forEach((item) =>
            {
                const meshName = item.mesh.name || `led${item.index}`
                const number = String(parseInt(meshName.replace(/\D/g, ''), 10) + 1).padStart(2, '0')

                this.addAsset({
                    id: `led-${meshName}`,
                    name: `Google Home 灯珠 ${number}`,
                    short: `灯珠 ${number}`,
                    kind: '灯光',
                    file: 'googleHomeLedsModel.glb',
                    category: 'light',
                    object: item.mesh,
                    cluster: 'leds',
                    compactTag: true
                })
            })
        }

        this.addGrouped(assembly.loupedeck, {
            id: 'loupedeck',
            name: 'Loupedeck',
            short: 'Loupedeck',
            kind: '控制台',
            file: '底座 + loupedeckButtonsModel.glb',
            category: 'console'
        })

        if(!assembly.loupedeck)
        {
            world.loupedeckButtons.model.items.forEach((item) =>
            {
                const meshName = item.mesh.name || `screen${item.index}`
                const number = String(parseInt(meshName.replace(/\D/g, ''), 10)).padStart(2, '0')

                this.addAsset({
                    id: `button-${meshName}`,
                    name: `Loupedeck 按键 ${number}`,
                    short: `按键 ${number}`,
                    kind: '按键',
                    file: 'loupedeckButtonsModel.glb',
                    category: 'console',
                    object: item.mesh,
                    cluster: 'buttons',
                    compactTag: true
                })
            })
        }

        this.addGrouped(assembly.books, {
            id: 'books',
            name: '书',
            short: '书',
            kind: '装饰',
            file: 'roomModel.glb',
            category: 'decor'
        })

        this.addGrouped(assembly.among, {
            id: 'among',
            name: 'Among Us 小人',
            short: '小人',
            kind: '装饰',
            file: 'roomModel.glb',
            category: 'decor'
        })

        this.addGrouped(assembly.guitar, {
            id: 'guitar',
            name: '吉他',
            short: '吉他',
            kind: '装饰',
            file: 'roomModel.glb',
            category: 'decor'
        })

        this.addGrouped(assembly.mic, {
            id: 'mic',
            name: '麦克风架',
            short: '麦克风架',
            kind: '装饰',
            file: 'roomModel.glb',
            category: 'decor'
        })

        this.addGrouped(assembly.camera, {
            id: 'camera',
            name: '相机',
            short: '相机',
            kind: '装饰',
            file: 'roomModel.glb',
            category: 'decor'
        })

        this.addGrouped(assembly.plant, {
            id: 'plant',
            name: '龟背竹',
            short: '龟背竹',
            kind: '装饰',
            file: 'roomModel.glb',
            category: 'decor'
        })

        this.addGrouped(assembly.mug, {
            id: 'mug',
            name: '杯子',
            short: '杯子',
            kind: '装饰',
            file: '杯子 + coffeeSteamModel.glb',
            category: 'decor'
        }, {
            id: 'steam',
            name: '咖啡热气',
            short: '咖啡热气',
            kind: '装饰',
            file: 'coffeeSteamModel.glb',
            category: 'decor',
            object: world.coffeeSteam.model.mesh
        })

        this.addGrouped(assembly.rubik, {
            id: 'rubik',
            name: '魔方',
            short: '魔方',
            kind: '装饰',
            file: 'roomModel.glb',
            category: 'decor'
        })
    }

    countTriangles(object)
    {
        let triangles = 0

        object.traverse((child) =>
        {
            const position = child.geometry && child.geometry.attributes && child.geometry.attributes.position

            if(!child.isMesh || !position)
                return

            triangles += child.geometry.index
                ? child.geometry.index.count / 3
                : position.count / 3
        })

        return Math.round(triangles)
    }

    addGrouped(group, spec, fallback)
    {
        if(group)
        {
            this.addAsset({ ...spec, object: group })
            return
        }

        if(fallback)
            this.addAsset(fallback)
    }

    addAsset(spec)
    {
        const object = spec.object
        this._box.setFromObject(object)
        const center = this._box.getCenter(new THREE.Vector3())
        const size = this._box.getSize(new THREE.Vector3())
        const category = CATEGORIES.find((item) => item.id === spec.category)
        const triangles = this.countTriangles(object)
        const detail = [
            spec.kind,
            spec.anchor ? '不位移' : '',
            spec.file,
            `${triangles.toLocaleString('en-US')} 面`
        ].filter(Boolean).join(' · ')

        const asset = {
            ...spec,
            triangles,
            detail,
            meta: detail,
            object,
            color: new THREE.Color(category.color),
            swatch: category.color,
            shown: true,
            homePosition: object.position.clone(),
            homeScale: object.scale.clone(),
            homeCenter: center.clone(),
            centerOffset: center.clone().sub(object.position),
            size,
            liveCenter: center.clone(),
            layoutPosition: object.position.clone(),
            layoutScale: object.scale.clone(),
            explodePosition: object.position.clone(),
            explodedCenter: center.clone(),
            listPosition: object.position.clone(),
            listScale: object.scale.clone()
        }

        asset.radius = this.radiusFor(asset)
        this.assets.push(asset)
        this.assetByObject.set(object, asset)
    }

    radiusFor(asset)
    {
        const half = Math.max(asset.size.x, asset.size.y, asset.size.z) * 0.5

        if(asset.cluster === 'leds')
            return 0.26

        if(asset.cluster === 'buttons')
            return Math.min(half, 0.3)

        return Math.min(half * 0.62, 1.2)
    }

    setExplode()
    {
        const focus = new THREE.Vector3(1.05, 2.2, -2.3)
        const presets = {
            leds: { scale: 1, push: 4.8, lift: 1.45, stack: 0.9 },
            buttons: { scale: 2.15, push: 4.6, lift: 1.6, stack: 0 },
            single: { scale: 1, push: 5.4, lift: 1.25, stack: 0 }
        }
        const groups = new Map()

        for(const asset of this.assets)
        {
            if(asset.anchor)
            {
                asset.explodePosition.copy(asset.homePosition)
                asset.explodedCenter.copy(asset.homeCenter)
                continue
            }

            const key = asset.cluster || asset.id

            if(!groups.has(key))
                groups.set(key, [])

            groups.get(key).push(asset)
        }

        groups.forEach((members, key) =>
        {
            const preset = presets[key] || presets.single
            const centroid = new THREE.Vector3()

            for(const member of members)
                centroid.add(member.homeCenter)

            centroid.multiplyScalar(1 / members.length)

            const direction = centroid.clone().sub(focus)

            if(direction.lengthSq() < 1e-8)
                direction.set(0, 1, 0)
            else
                direction.normalize()

            const destination = centroid.clone().addScaledVector(direction, preset.push)
            destination.y += preset.lift

            members.forEach((member, index) =>
            {
                const relative = member.homeCenter.clone().sub(centroid).multiplyScalar(preset.scale)
                member.explodedCenter = destination.clone().add(relative)
                member.explodedCenter.y += (index - (members.length - 1) / 2) * preset.stack
            })
        })

        const movable = this.assets.filter((asset) => !asset.anchor)

        for(let iteration = 0; iteration < 28; iteration++)
        {
            for(let i = 0; i < movable.length; i++)
            {
                for(let j = i + 1; j < movable.length; j++)
                {
                    const a = movable[i]
                    const b = movable[j]
                    const diff = b.explodedCenter.clone().sub(a.explodedCenter)
                    let distance = diff.length()
                    const minDistance = a.radius + b.radius + 0.22

                    if(distance >= minDistance)
                        continue

                    if(distance < 1e-5)
                    {
                        diff.set(((i * 3) % 5) - 2, 0.4, ((j * 5) % 5) - 2)
                        distance = diff.length()
                    }

                    diff.multiplyScalar(1 / distance)

                    const push = (minDistance - distance) * 0.5
                    a.explodedCenter.addScaledVector(diff, -push)
                    b.explodedCenter.addScaledVector(diff, push)
                }
            }
        }

        for(const asset of movable)
            asset.explodePosition.copy(asset.explodedCenter).sub(asset.centerOffset)
    }

    setListLayout()
    {
        const columns = Math.max(1, Math.ceil(Math.sqrt(this.assets.length)))
        const rows = Math.ceil(this.assets.length / columns)
        const originX = -((columns - 1) * LIST_CELL) / 2
        const originZ = -((rows - 1) * LIST_CELL) / 2
        this.listGrid = { columns, rows }

        this.assets.forEach((asset, index) =>
        {
            const column = index % columns
            const row = Math.floor(index / columns)
            const maxDim = Math.max(asset.size.x, asset.size.y, asset.size.z, 0.001)
            const fitted = LIST_FIT / maxDim
            const targetCenter = new THREE.Vector3(
                originX + column * LIST_CELL,
                LIST_Y,
                originZ + row * LIST_CELL
            )

            asset.listScale = asset.homeScale.clone().multiplyScalar(fitted)
            asset.listPosition = targetCenter.sub(asset.centerOffset.clone().multiplyScalar(fitted))
        })
    }

    setHelpers()
    {
        const movable = this.assets.filter((asset) => !asset.anchor)
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(movable.length * 2 * 3), 3))
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(movable.length * 2 * 3), 3))

        this.leaders = new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 0.72,
                depthTest: false,
                depthWrite: false,
                toneMapped: false
            })
        )
        this.leaders.frustumCulled = false
        this.leaders.visible = false
        this.leaders.renderOrder = 4
        this.leaders.raycast = () => {}
        this.scene.add(this.leaders)

        this.outline = new THREE.BoxHelper(this.assets[0].object, 0xffe1a8)
        this.outline.material.depthTest = false
        this.outline.material.toneMapped = false
        this.outline.visible = false
        this.outline.renderOrder = 5
        this.outline.raycast = () => {}
        this.scene.add(this.outline)
    }

    setInterface()
    {
        if(this.debug && this.debug.containerElem_)
            this.debug.containerElem_.style.zIndex = '40'

        this.dom = {}

        const ui = document.createElement('div')
        ui.className = 'asset-ui'
        this.dom.ui = ui

        const toolbar = document.createElement('div')
        toolbar.className = 'asset-toolbar'
        toolbar.setAttribute('role', 'tablist')
        toolbar.setAttribute('aria-label', '查看方式')
        this.dom.toolbar = toolbar

        this.dom.modes = {}

        for(const mode of [
            { id: 'assembled', label: '组装' },
            { id: 'exploded', label: '爆炸' },
            { id: 'list', label: '列表' }
        ])
        {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'asset-mode'
            button.dataset.view = mode.id
            button.textContent = mode.label
            button.setAttribute('aria-pressed', mode.id === 'assembled' ? 'true' : 'false')

            if(mode.id === 'assembled')
                button.classList.add('is-active')

            button.addEventListener('click', () =>
            {
                this.setMode(mode.id)
            })
            this.dom.modes[mode.id] = button
            toolbar.appendChild(button)
        }

        const panel = document.createElement('aside')
        panel.className = 'asset-list'
        panel.setAttribute('aria-label', '可拆分资产')
        panel.hidden = true
        this.dom.panel = panel

        const head = document.createElement('header')
        head.className = 'asset-list-head'

        const kicker = document.createElement('h2')
        kicker.className = 'asset-list-kicker'
        kicker.textContent = '可拆分资产'

        const summary = document.createElement('p')
        summary.className = 'asset-list-summary'
        summary.textContent = `${this.assets.length} 个资产。房间壳体留在原位，其余在爆炸视图里分开。`
        head.append(kicker, summary)

        const search = document.createElement('input')
        search.className = 'asset-search'
        search.type = 'search'
        search.placeholder = '搜索名称或文件'
        search.setAttribute('aria-label', '搜索资产')
        search.addEventListener('input', () =>
        {
            this.filterRows()
        })
        this.dom.search = search

        const hint = document.createElement('p')
        hint.className = 'asset-hint'
        hint.textContent = '单击选中，双击对准'
        this.dom.hint = hint

        const body = document.createElement('div')
        body.className = 'asset-list-body'
        this.dom.body = body
        this.dom.groups = []

        let globalIndex = 1

        for(const category of CATEGORIES)
        {
            const items = this.assets.filter((asset) => asset.category === category.id)

            if(items.length === 0)
                continue

            const group = document.createElement('section')
            group.className = 'asset-group'

            const title = document.createElement('h3')
            const titleText = document.createElement('span')
            titleText.textContent = category.title
            const titleCount = document.createElement('span')
            titleCount.textContent = String(items.length)
            title.append(titleText, titleCount)

            const list = document.createElement('ul')

            items.forEach((asset, index) =>
            {
                asset.indexLabel = String(globalIndex).padStart(2, '0')
                asset.groupIndex = String(index + 1).padStart(2, '0')
                globalIndex++

                const row = document.createElement('li')
                row.className = 'asset-row'
                row.dataset.id = asset.id

                const eye = document.createElement('button')
                eye.type = 'button'
                eye.className = 'asset-eye'
                eye.dataset.eye = ''
                eye.setAttribute('aria-label', '隐藏')

                const label = document.createElement('button')
                label.type = 'button'
                label.className = 'asset-label'
                label.dataset.select = ''
                label.title = asset.detail

                const indexNode = document.createElement('span')
                indexNode.className = 'asset-index'
                indexNode.textContent = asset.groupIndex

                const copy = document.createElement('span')
                copy.className = 'asset-copy'

                const name = document.createElement('strong')
                name.textContent = asset.name

                const small = document.createElement('small')
                small.textContent = asset.detail

                copy.append(name, small)
                label.append(indexNode, copy)
                row.append(eye, label)
                list.appendChild(row)
                asset.row = row
                asset.eye = eye
            })

            group.append(title, list)
            body.appendChild(group)
            this.dom.groups.push({
                element: group,
                count: titleCount,
                items
            })
        }

        panel.append(head, search, hint, body)

        const callout = document.createElement('p')
        callout.className = 'asset-callout'
        callout.hidden = true
        this.dom.callout = callout

        const tags = document.createElement('div')
        tags.className = 'asset-tags'
        this.dom.tags = tags

        for(const asset of this.assets)
        {
            if(asset.anchor)
                continue

            const tag = document.createElement('button')
            tag.type = 'button'
            tag.className = 'asset-tag'
            tag.hidden = true
            tag.style.setProperty('--swatch', asset.swatch)
            tag.addEventListener('click', (event) =>
            {
                event.stopPropagation()
                this.select(asset, { reveal: true })
            })
            tag.addEventListener('mouseenter', () =>
            {
                this.hovered = asset
                this.syncRows()
            })
            tag.addEventListener('mouseleave', () =>
            {
                if(this.hovered === asset)
                    this.hovered = null

                this.syncRows()
            })
            asset.tag = tag
            tags.appendChild(tag)
        }

        ui.append(toolbar, panel, callout, tags)
        document.body.appendChild(ui)

        const stop = (event) => event.stopPropagation()
        ui.addEventListener('mousedown', stop)
        ui.addEventListener('pointerdown', stop)
        ui.addEventListener('touchstart', stop, { passive: true })
        ui.addEventListener('wheel', (event) => event.stopPropagation(), { passive: false })

        body.addEventListener('click', (event) =>
        {
            const row = event.target.closest('.asset-row')

            if(!row)
                return

            const asset = this.assets.find((item) => item.id === row.dataset.id)

            if(!asset)
                return

            if(event.target.closest('[data-eye]'))
            {
                this.setShown(asset, !asset.shown)
                return
            }

            this.select(asset)
        })

        body.addEventListener('dblclick', (event) =>
        {
            const row = event.target.closest('.asset-row')

            if(!row || event.target.closest('[data-eye]'))
                return

            const asset = this.assets.find((item) => item.id === row.dataset.id)

            if(asset)
                this.select(asset, { frame: true })
        })

        body.addEventListener('mouseover', (event) =>
        {
            const row = event.target.closest('.asset-row')
            const asset = row ? this.assets.find((item) => item.id === row.dataset.id) : null

            if(this.hovered === asset)
                return

            this.hovered = asset
            this.syncRows()
        })

        body.addEventListener('mouseleave', () =>
        {
            this.hovered = null
            this.syncRows()
        })

        window.addEventListener('keydown', (event) =>
        {
            if(event.key !== 'Escape' || document.activeElement === this.dom.search)
                return

            const pane = event.target && event.target.closest ? event.target.closest('.tp-dfwv') : null

            if(pane)
                return

            this.select(null)
        })

        this.filterRows()
        this.syncChrome()
    }

    setPicking()
    {
        this.pick = { x: 0, y: 0, moved: false, tracking: false }

        this.domElement.addEventListener('pointerdown', (event) =>
        {
            if(event.button !== 0)
                return

            this.pick.x = event.clientX
            this.pick.y = event.clientY
            this.pick.moved = false
            this.pick.tracking = true
        })

        window.addEventListener('pointermove', (event) =>
        {
            if(!this.pick.tracking)
                return

            if(this.pick.moved)
                return

            if(Math.hypot(event.clientX - this.pick.x, event.clientY - this.pick.y) > 5)
            {
                this.pick.moved = true

                if(this.cameraMotion)
                    this.cameraMotion.kill()
            }
        })

        window.addEventListener('pointerup', (event) =>
        {
            if(!this.pick.tracking || event.button !== 0)
                return

            const moved = this.pick.moved
            this.pick.tracking = false

            if(moved || event.target !== this.domElement)
                return

            this.pickAt(event.clientX, event.clientY)
        })
    }

    setMode(nextMode)
    {
        if(nextMode === this.mode)
            return

        const leavingHome = this.mode === 'assembled'
        this.mode = nextMode

        if(leavingHome)
        {
            this.saveView()
            this.relaxLimits()
        }

        this.suspendMotion = nextMode !== 'assembled'

        if(this.suspendMotion)
            this.parkMotions()

        this.tweenTo(nextMode)
        this.syncChrome()
    }

    saveView()
    {
        const spherical = this.navigation.view.spherical.value
        const target = this.navigation.view.target.value

        this.assembledView = {
            radius: spherical.radius,
            phi: spherical.phi,
            theta: spherical.theta,
            target: target.clone()
        }
    }

    relaxLimits()
    {
        const limits = this.navigation.view.spherical.limits
        limits.radius.min = 4
        limits.radius.max = 80
        limits.phi.min = 0.15
        limits.phi.max = Math.PI * 0.48
        limits.theta.min = -Math.PI
        limits.theta.max = Math.PI
    }

    restoreLimits()
    {
        const limits = this.navigation.view.spherical.limits
        limits.radius.min = this.savedLimits.radius.min
        limits.radius.max = this.savedLimits.radius.max
        limits.phi.min = this.savedLimits.phi.min
        limits.phi.max = this.savedLimits.phi.max
        limits.theta.min = this.savedLimits.theta.min
        limits.theta.max = this.savedLimits.theta.max
    }

    parkMotions()
    {
        const logo = this.world.bouncingLogo
        logo.animations.z = 0
        logo.animations.y = 0
        logo.model.mesh.position.set(0, 0, 0)
        this.world.topChair.model.group.rotation.y = this.chairHomeRotation
    }

    targetsFor(asset, nextMode)
    {
        if(nextMode === 'list')
            return { position: asset.listPosition, scale: asset.listScale }

        if(nextMode === 'exploded')
            return { position: asset.explodePosition, scale: asset.homeScale }

        return { position: asset.homePosition, scale: asset.homeScale }
    }

    viewFor(nextMode)
    {
        if(nextMode === 'assembled' && this.assembledView)
            return this.assembledView

        if(nextMode === 'list')
            return this.frameList()

        return {
            target: new THREE.Vector3(0.6, 2.45, -1.4),
            radius: Math.max(this.navigation.view.spherical.value.radius, 46)
        }
    }

    frameList()
    {
        const columns = this.listGrid.columns
        const rows = this.listGrid.rows
        const width = (columns - 1) * LIST_CELL + LIST_FIT
        const depth = (rows - 1) * LIST_CELL + LIST_FIT
        const radius = 0.5 * Math.sqrt(width * width + depth * depth + LIST_FIT * LIST_FIT)
        const fov = THREE.MathUtils.degToRad(this.camera.instance.fov)
        const distance = (radius / Math.sin(fov / 2)) * 1.08

        return {
            target: new THREE.Vector3(0, LIST_Y, 0),
            radius: distance
        }
    }

    tweenTo(nextMode)
    {
        if(this.motion)
            this.motion.kill()

        if(this.cameraMotion)
            this.cameraMotion.kill()

        const run = ++this.motionRun
        const timeline = gsap.timeline({
            onComplete: () =>
            {
                if(run !== this.motionRun)
                    return

                this.motion = null

                if(this.mode === 'assembled')
                {
                    this.suspendMotion = false
                    this.restoreLimits()
                }
            }
        })
        this.motion = timeline

        for(const asset of this.assets)
        {
            const target = this.targetsFor(asset, nextMode)

            timeline.to(asset.layoutPosition, {
                x: target.position.x,
                y: target.position.y,
                z: target.position.z,
                duration: 0.9,
                ease: 'power2.inOut'
            }, 0)

            timeline.to(asset.layoutScale, {
                x: target.scale.x,
                y: target.scale.y,
                z: target.scale.z,
                duration: 0.9,
                ease: 'power2.inOut'
            }, 0)
        }

        const cameraTimeline = gsap.timeline()
        this.cameraMotion = cameraTimeline
        this.tweenCamera(this.viewFor(nextMode), cameraTimeline)
    }

    tweenCamera(view, timeline)
    {
        const spherical = this.navigation.view.spherical
        const target = this.navigation.view.target
        const pose = {
            radius: view.radius,
            phi: view.phi === undefined ? spherical.value.phi : view.phi,
            theta: view.theta === undefined ? spherical.value.theta : view.theta,
            x: view.target.x,
            y: view.target.y,
            z: view.target.z
        }

        for(const channel of [spherical.value, spherical.smoothed])
        {
            timeline.to(channel, {
                radius: pose.radius,
                phi: pose.phi,
                theta: pose.theta,
                duration: 0.9,
                ease: 'power2.inOut'
            }, 0)
        }

        for(const channel of [target.value, target.smoothed])
        {
            timeline.to(channel, {
                x: pose.x,
                y: pose.y,
                z: pose.z,
                duration: 0.9,
                ease: 'power2.inOut'
            }, 0)
        }
    }

    frameAsset(asset)
    {
        asset.object.updateWorldMatrix(true, true)
        const box = new THREE.Box3().setFromObject(asset.object)

        if(box.isEmpty())
            return

        const sphere = box.getBoundingSphere(new THREE.Sphere())
        const fov = THREE.MathUtils.degToRad(this.camera.instance.fov)
        const distance = Math.max((sphere.radius * 1.45) / Math.sin(fov / 2), 4)
        const limits = this.navigation.view.spherical.limits.radius

        if(this.cameraMotion)
            this.cameraMotion.kill()

        const timeline = gsap.timeline({
            onComplete: () =>
            {
                this.cameraMotion = null
            }
        })
        this.cameraMotion = timeline
        this.tweenCamera({
            target: sphere.center,
            radius: Math.min(Math.max(distance, limits.min), limits.max)
        }, timeline)
    }

    syncChrome()
    {
        for(const mode of Object.keys(this.dom.modes))
        {
            const button = this.dom.modes[mode]
            const active = mode === this.mode
            button.classList.toggle('is-active', active)
            button.setAttribute('aria-pressed', active ? 'true' : 'false')
        }

        this.dom.panel.hidden = this.mode === 'assembled'
    }

    filterRows()
    {
        const query = this.dom.search.value.trim().toLowerCase()
        let shown = 0

        for(const asset of this.assets)
        {
            const haystack = `${asset.name} ${asset.kind} ${asset.file} ${asset.detail} ${asset.object.name || ''}`.toLowerCase()
            const match = query === '' || haystack.includes(query)
            asset.row.hidden = !match

            if(match)
                shown++
        }

        for(const group of this.dom.groups)
        {
            const visible = group.items.filter((asset) => !asset.row.hidden)
            group.element.hidden = visible.length === 0
            group.count.textContent = String(visible.length)
        }

        const hint = shown === 0 ? '没有匹配的资产' : '单击选中，双击对准'
        this.dom.hint.textContent = query === '' ? hint : `${shown} / ${this.assets.length} · ${hint}`
    }

    setShown(asset, shown)
    {
        asset.shown = shown
        asset.object.visible = shown
        asset.row.classList.toggle('is-hidden', !shown)
        asset.eye.setAttribute('aria-label', shown ? '隐藏' : '显示')

        if(this.selected === asset && !shown)
            this.outline.visible = false
    }

    select(asset, { frame = false, reveal = false } = {})
    {
        this.selected = asset
        this.syncRows()

        if(asset && reveal && this.mode !== 'assembled')
            asset.row.scrollIntoView({ block: 'nearest' })

        if(asset && frame && asset.shown)
            this.frameAsset(asset)
    }

    syncRows()
    {
        for(const asset of this.assets)
        {
            const selected = asset === this.selected
            asset.row.classList.toggle('is-selected', selected)
            asset.row.classList.toggle('is-hovered', asset === this.hovered)

            if(asset.tag)
            {
                asset.tag.classList.toggle('is-active', selected)
                asset.tag.classList.toggle('is-hot', asset === this.hovered)
            }
        }

        if(!this.selected)
        {
            this.dom.callout.hidden = true
            return
        }

        this.dom.callout.hidden = false
        this.dom.callout.textContent = `${this.selected.groupIndex}  ${this.selected.name} · ${this.selected.detail}`
    }

    pickAt(x, y)
    {
        const rect = this.domElement.getBoundingClientRect()
        this._pointer.x = ((x - rect.left) / rect.width) * 2 - 1
        this._pointer.y = -((y - rect.top) / rect.height) * 2 + 1
        this._raycaster.setFromCamera(this._pointer, this.camera.instance)

        const roots = this.assets.filter((asset) => asset.shown).map((asset) => asset.object)
        const hits = this._raycaster.intersectObjects(roots, true)

        if(hits.length === 0)
        {
            this.select(null)
            return
        }

        const asset = this.assetFromObject(hits[0].object)

        if(asset)
            this.select(asset, { reveal: true })
    }

    assetFromObject(object)
    {
        let current = object

        while(current)
        {
            const asset = this.assetByObject.get(current)

            if(asset)
                return asset

            current = current.parent
        }

        return null
    }

    tagLabel(asset)
    {
        const hot = asset === this.selected || asset === this.hovered

        if(asset.compactTag && !hot)
            return asset.indexLabel

        return `${asset.indexLabel} ${asset.short}`
    }

    update()
    {
        if(this.suspendMotion)
            this.parkMotions()

        this.applyLayout()
        this.updateCenters()
        this.updateLeaders()
        this.updateOutline()
        this.updateTags()
    }

    applyLayout()
    {
        for(const asset of this.assets)
        {
            asset.object.visible = asset.shown
            asset.object.position.copy(asset.layoutPosition)
            asset.object.scale.copy(asset.layoutScale)
        }
    }

    updateCenters()
    {
        for(const asset of this.assets)
        {
            if(!asset.shown)
                continue

            this._box.setFromObject(asset.object)
            this._box.getCenter(asset.liveCenter)
        }
    }

    updateLeaders()
    {
        const visible = this.mode === 'exploded'
        this.leaders.visible = visible

        if(!visible)
            return

        const positions = this.leaders.geometry.attributes.position.array
        const colors = this.leaders.geometry.attributes.color.array
        let cursor = 0
        let colorCursor = 0

        for(const asset of this.assets)
        {
            if(asset.anchor)
                continue

            const end = asset.shown ? asset.liveCenter : asset.homeCenter

            positions[cursor++] = asset.homeCenter.x
            positions[cursor++] = asset.homeCenter.y
            positions[cursor++] = asset.homeCenter.z
            positions[cursor++] = end.x
            positions[cursor++] = end.y
            positions[cursor++] = end.z

            this._color.copy(asset.color)

            if(asset === this.selected)
                this._color.lerp(this._selectedColor, 0.72)

            for(let i = 0; i < 2; i++)
            {
                colors[colorCursor++] = this._color.r
                colors[colorCursor++] = this._color.g
                colors[colorCursor++] = this._color.b
            }
        }

        this.leaders.geometry.attributes.position.needsUpdate = true
        this.leaders.geometry.attributes.color.needsUpdate = true
    }

    updateOutline()
    {
        const asset = this.hovered || this.selected

        if(!asset || !asset.shown)
        {
            this.outline.visible = false
            return
        }

        this.outline.visible = true
        this.outline.setFromObject(asset.object)
        this.outline.material.color.setHex(asset === this.selected ? 0xffe1a8 : 0xffffff)
    }

    updateTags()
    {
        const showTags = this.mode === 'exploded'
        const camera = this.camera.instance
        const rect = this.domElement.getBoundingClientRect()
        const blockers = [this.dom.toolbar.getBoundingClientRect()]

        if(!this.dom.panel.hidden)
            blockers.push(this.dom.panel.getBoundingClientRect())

        if(this.debug && this.debug.containerElem_)
            blockers.push(this.debug.containerElem_.getBoundingClientRect())

        camera.getWorldDirection(this._forward)

        for(const asset of this.assets)
        {
            if(!asset.tag)
                continue

            const label = this.tagLabel(asset)

            if(asset.tag.dataset.label !== label)
            {
                asset.tag.dataset.label = label
                asset.tag.textContent = label
            }

            if(!showTags || !asset.shown)
            {
                asset.tag.hidden = true
                continue
            }

            this._toPoint.copy(asset.liveCenter).sub(camera.position)
            const inFront = this._toPoint.dot(this._forward) > 0.15

            if(!inFront)
            {
                asset.tag.hidden = true
                continue
            }

            this._center.copy(asset.liveCenter).project(camera)

            const x = (this._center.x * 0.5 + 0.5) * rect.width + rect.left
            const y = (-this._center.y * 0.5 + 0.5) * rect.height + rect.top
            const covered = blockers.some((bounds) =>
            {
                return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
            })

            asset.tag.hidden = covered

            if(covered)
                continue

            asset.tag.style.opacity = '1'
            asset.tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, calc(-100% - 8px))`
        }
    }
}
