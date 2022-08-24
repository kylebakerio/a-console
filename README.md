# a-console
A better, canvas-based console for A-Frame. Currently in 'alpha', but should already be the best thing out there. 

- Prints all logs to a virtual 16:10 2k vertically oriented screen by default
- Handles any custom screen size you want, with any font size you want--just set geometry and pixel-width resolution
- Prints stack traces for errors by default
- Handles line breaks for lines that are too wide, and auto-scrolls on new input
- Stringifies and pretty-prints objects that are console-logged
- fully supported text reflowing for dynamic screen resolution updates, font size updates, and geometry updates
- Developed for A-Frame 1.3.0


<a href='https://ko-fi.com/kylev' target='_blank'><img height='35' style='border:0px;height:46px;' src='https://az743702.vo.msecnd.net/cdn/kofi3.png?v=0' border='0' alt='Buy Me a Coffee at ko-fi.com' /><a/>


![Screenshot from 2022-08-20 04-21-13](https://user-images.githubusercontent.com/6391152/185741660-0c40d8e8-563d-459a-bf41-1abfcc1b1560.png)

https://user-images.githubusercontent.com/6391152/185741975-a4cf08da-a521-46db-92f2-db312cac0163.mp4

_Also: check out [vr-super-stats](https://github.com/kylebakerio/vr-super-stats) to see live stats while in-headset._

## demo
https://canvas-log.glitch.me/

## how-to
Literally just add this line to your scene:
```html
<a-console position="0 1.5 -2"></a-console>
```

I like to add it to my hand so I can walk around with it in VR:
```html
<a-entity id="my-tracked-left-hand" class="local-hand"  oculus-touch-controls="hand:left;">
  <a-console position="0 .13 -.36" scale=".33 .33 .33" rotation="-70.7 -1.77"></a-console>
</a-entity>  
```
  
by default it will intercept console.log/warn/error, and print stack traces on error. you can also manually print to the console with the `logToCanvas()` and `writeToCanvas()` methods. (They do _not_ currently run commands, just allow you to print text.)

## options
- **I always advise that you check the schema for up-to-date options.**
- **always check the update() function, it may be that some settings only work on init()**
```js
AFRAME.registerPrimitive('a-console', extendDeep({}, meshMixin, {
  defaultComponents: {
    geometry: {primitive: 'plane', width:1.6*.666, height:2.56*.666}, // 1920 x 1200, / 3 for more manageable size
    material: {side: 'double'},
    console: {},
  },

  mappings: {
    height: 'geometry.height',
    width: 'geometry.width',
    "font-size": 'console.fontSize',
    
    // font-family MUST be a monospace font, or expect things to break :)
    "font-family": 'console.fontFamily',
    "text-color": 'console.textColor',
    "background-color": 'console.backgroundColor',
    
    'pixel-width': 'console.canvasWidth',
    'pixel-height': 'console.canvasHeight', 
    // pixel-height not necessary or looked at unless allow-custom-aspect-ratio is true 
    'allow-custom-aspect-ratio': 'console.pixelRatioOverride',
    
    'skip-intro': 'console.skipIntroAnimation',
    'font-size': 'console.fontSize',
    // always in 'pixels'
    
    demo: 'console.demo',
    // fill screen with colored timestamps
  }
}));


AFRAME.registerComponent('console', {
  dependencies: ['geometry', 'material'],
  schema: {
    fontSize: {default: 20, type: 'number'},
    fontFamily: {default: 'monospace', type: 'string'},
    textColor: {default: 'green', type: 'color'},
    backgroundColor: {default: 'black', type: 'color'},
    
    // how much historical input to store
    history: { default: 2000, type:'number'},
    
    // canvas dimensions corresponsd to screen resolution, geometry to screen size.
    // 2560x1600 = 2k 16:10 ratio screen, vertically.
    // note that geometry will override this setting, and only width will be observed,
    // unless pixelRatioOverride = true, to keep pixels square by default, and allow
    // resizing screen without it affecting pixels by default
    canvasWidth: {default: 1600, type: 'number'},
    canvasHeight: {default: 2560, type: 'number'}, 
    pixelRatioOverride: {default: false, type: 'bool'},
    
    captureConsole: {default: ['log','warn','error'], type: 'array'},
    captureConsoleColors: {default: ["",'yellow','red'], type: 'array'},
    captureStackTraceFor: {default: ['error'], type:'array'},
    showStackTraces: {default: true, type:'bool'},
    
    skipIntroAnimation: {default: false, type: 'bool'},
    introLineDelay: {default: 75, type:'number'},
    demo: {default: false, type: 'bool'},
  },
```

Check out index.html for some examples.

## roadmap
  - ability to manually scroll, not just auto-scroll
  - inclusive/exclusive filter
  - allow JSON stringify custom settings
  - make stack traces toggle/revealable
  - keyboard for console input
  - `eval()` to run code on the fly from inside VR
  - support for native console text inline colors
  - expanding support for the [console object API](https://developer.mozilla.org/en-US/docs/Web/API/console).
