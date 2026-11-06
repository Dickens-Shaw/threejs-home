import * as THREE from 'three'
import Experience from './Experience.js'
import Baked from './Baked.js'
import GoogleLeds from './GoogleLeds.js'
import LoupedeckButtons from './LoupedeckButtons.js'
import CoffeeSteam from './CoffeeSteam.js'
import TopChair from './TopChair.js'
import ElgatoLight from './ElgatoLight.js'
import BouncingLogo from './BouncingLogo.js'
import Screen from './Screen.js'
import AssetViews from './AssetViews.js'
import { assembleRoom, attachKeyboardPrint } from './roomAssembly.js'

export default class World
{
    constructor(_options)
    {
        this.experience = new Experience()
        this.config = this.experience.config
        this.scene = this.experience.scene
        this.resources = this.experience.resources
        
        this.resources.on('groupEnd', (_group) =>
        {
            if(_group.name === 'base')
            {
                this.setBaked()
                this.setGoogleLeds()
                this.setLoupedeckButtons()
                this.setCoffeeSteam()
                this.setTopChair()
                this.setElgatoLight()
                this.setBouncingLogo()
                this.setScreens()
                this.setAssembly()
                this.setAssetViews()
            }
        })
    }

    setBaked()
    {
        this.baked = new Baked()
    }

    setGoogleLeds()
    {
        this.googleLeds = new GoogleLeds()
    }

    setLoupedeckButtons()
    {
        this.loupedeckButtons = new LoupedeckButtons()
    }

    setCoffeeSteam()
    {
        this.coffeeSteam = new CoffeeSteam()
    }

    setTopChair()
    {
        this.topChair = new TopChair()
    }

    setElgatoLight()
    {
        this.elgatoLight = new ElgatoLight()
    }

    setBouncingLogo()
    {
        this.bouncingLogo = new BouncingLogo()
    }

    setScreens()
    {
        this.pcScreen = new Screen(
            this.resources.items.pcScreenModel.scene.children[0],
            '/assets/videoPortfolio.mp4'
        )
        this.macScreen = new Screen(
            this.resources.items.macScreenModel.scene.children[0],
            '/assets/videoStream.mp4'
        )
    }

    setAssembly()
    {
        this.assembly = assembleRoom(this.baked.model.mesh, {
            pcScreen: this.pcScreen.model.mesh,
            macScreen: this.macScreen.model.mesh,
            elgato: this.elgatoLight.model.mesh,
            steam: this.coffeeSteam.model.mesh,
            buttons: this.loupedeckButtons.model.items.map((item) => item.mesh),
            leds: this.googleLeds.model.items.map((item) => item.mesh)
        })

        const chairBase = this.assembly.chair

        if(chairBase)
        {
            const chair = new THREE.Group()
            chair.name = 'chair'
            chair.add(this.topChair.model.group)
            chair.add(chairBase)
            this.assembly.chair = chair
        }

        if(this.assembly.keyboard)
            attachKeyboardPrint(this.assembly.keyboard, this.baked.model.material)

        for(const group of Object.values(this.assembly))
            this.scene.add(group)

        if(this.assembly.tv)
            this.assembly.tv.attach(this.bouncingLogo.model.group)

        this.computer = this.assembly.computer || null
    }

    setAssetViews()
    {
        this.assetViews = new AssetViews()
    }

    resize()
    {
    }

    update()
    {
        if(this.googleLeds)
            this.googleLeds.update()

        if(this.loupedeckButtons)
            this.loupedeckButtons.update()

        if(this.coffeeSteam)
            this.coffeeSteam.update()

        if(this.topChair)
            this.topChair.update()

        if(this.bouncingLogo)
            this.bouncingLogo.update()

        if(this.assetViews)
            this.assetViews.update()
    }

    destroy()
    {
    }
}