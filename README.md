# a-console
A better, canvas-based console for A-Frame. Currently in 'alpha', but should already be the best thing out there. 

### Viewing live logs
- Developed for A-Frame 1.3.0
- **Scroll through console history using thumbstick events**
- Prints all logs to a virtual 16:10 2k vertically oriented screen by default
- But, **handles any custom screen size you want, with any font size you want**--just set geometry and pixel-width resolution
- **Prints stack traces** for errors by default; green for log, yellow for warn, red for error by default
- Handles line breaks for lines that are too wide, auto-scrolls on new input, handles font and screen resizing smoothly
- Full automatic text reflowing for dynamic screen resolution updates, font size updates, and geometry updates
- **Stringifies and pretty-prints objects** that are console-logged; when not able to (circular, etc.), prints object's keys
- Uses HTML Canvas as a texture under the hood to minimize draw call strain, and only stores last 2000 entries to prevent memory leak from logging
- Correctly parses color-interpolated console strings used by A-Frame core (e.g., logs you see like `core:warn blah blah` where `core:warn` is orange)
- However, _lots_ of array/object/string churn, so this will impact garbage collection--intended for dev purposes, so that wasn't a priority for v1

### Live coding
- **Hook up your keyboard** and TYPE! (btw: Quest 2 accepts generic bluetooth keyboard, and they work with this!)
- Auto-log return values, ignoring undefined
- Store command history, which you access by using up/down arrows just like a 'real' console
- Left/Right arrows act as a cursor to edit your text; Home/End also supported to jump to beginning/end
- Smooth scroll through console with pgup/pgdn
- Stores input history between sessions! Your long typed out commands persist between sessions.
- Includes number of built-in helpers to make working with your virtual world much smoother, just type `help`

### Virtual keyoard
- While technically you can inject a `superkeyboard` and use it with the console, the default super keyboard lacks keys for symbols needed to write code. Pull request welcome to add a custom keyboard! That said, coding is much nicer on a real keyboard, so I recommend using a bluetooth keyboard anyways.

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
  <a-console font-size="35" position="0 .13 -.36" scale=".33 .33 .33" rotation="-70.7 -1.77"></a-console>
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
    // side: 'material.side',
    'pixel-width': 'console.canvasWidth',
    'pixel-height': 'console.canvasHeight', 
    // pixel-height not necessary or looked at unless allow-custom-aspect-ratio is true 
    'allow-custom-aspect-ratio': 'console.pixelRatioOverride',
    
    'skip-intro': 'console.skipIntroAnimation',
    'font-size': 'console.fontSize',
    // always in 'pixels' (px), supply '18' to get '18px' 
    
    // specify how many input entries to save for resizing/scrolling
    history: 'console.history',
    'capture-console': 'console.captureConsole',

    // fill screen with colored timestamps
    demo: 'console.demo',

    // inject 3d virtual keyboard
    'inject-keyboard': 'console.injectKeyboard',
    // which cursor to use to select keys on the virtual keyboard
    'use-cursor': 'console.kbCursor',

    // accept keyboard events themselves
    'keyboard-events': 'console.keyboardEventsInput',

    'thumbstick-scrolling': 'console.thumbstickScrolling',
  }
}));

AFRAME.registerComponent('console', {
  dependencies: ['geometry', 'material'],
  schema: {
    fontSize: {default: 20, type: 'number'},
    fontFamily: {default: 'monospace', type: 'string'},
    textColor: {default: 'green', type: 'color'},
    inputColor: {default: 'white', type: 'color'},
    returnColor: {default: 'orange', type: 'color'},
    backgroundColor: {default: 'black', type: 'color'},
    
    // how much historical input to store
    history: { default: 2000, type:'number'},
    
    // canvas dimensions corresponsd to screen resolution, geometry to screen size.
    // 2560x1600 = 2k 16:10 ratio screen, vertically.
    // note that specified geometry will override this setting, and only width will be observed,
    // unless pixelRatioOverride = true, to keep pixels square by default, and allow
    // resizing screen without distortion.
    canvasWidth: {default: 1600, type: 'number'},
    canvasHeight: {default: 2560, type: 'number'}, 
    pixelRatioOverride: {default: false, type: 'bool'},
    
    captureConsole: {default: ['log','warn','error'], type: 'array'},
    // ^could also specify debug, info
    captureConsoleColors: {default: ["",'yellow','red'], type: 'array'},
    captureStackTraceFor: {default: ['error'], type:'array'},
    showStackTraces: {default: true, type:'bool'},
    
    skipIntroAnimation: {default: false, type: 'bool'},
    introLineDelay: {default: 75, type:'number'},
    keepLogo: {default: false, type:'bool'},
    demo: {default: false, type: 'bool'},
    
    // inject aframe-super-keyboard
    // note: default keyboard lacks symbols needed for most code stuff
    // pull request for custom keyboard with symbols is welcome!
    injectKeyboard: {default: false, type: 'bool'},
    kbCursor: {default: '[cursor]', type:'selector'},
    // ^specify raycaster that can interact with the VR keyboard
    
    // use events from physical keyboard:
    keyboardEventsInput: {default: false, type: 'bool'},
    
    // helpful stuff for working with aframe input
    addKeyboardHelpers: {default: true, type: 'bool'},
    saveCommandHistory: {default: true, type: 'bool'},
    
    thumbstickScrolling: {default: '', type: 'selector'}
  },
```

Check out index.html for some examples.

## roadmap: coming soon

### designed with this in mind, just needs interface added to enable
  - ability to manually scroll, not just auto-scroll (was designed with this idea in mind, should be very easy to implement)
  - inclusive/exclusive filter                       
  - make stack traces toggle/revealable
  - per-line font size (would be very easy to implement, but low priority, not sure anyone would use this feature)

### keyboard that can `eval()` commands typed from inside VR
this is 99% done... only thing needed is a custom aframe-super-keyboard layout that supports the symbols needed for code. At the moment, the only thing it would be good for is if you design your code to assign a value to a global, and you want to lookup that value--but that's not super helpful, as there's far more efficient ways to do that, the point of this functionality would be to run commands with side effects or lookup things you didn't plan on looking up on the fly, of course.

## roadmap: maybe, pull request welcome
  - support for native console text inline colors (currently design to only allow color-per-input, would probably just need to add a flag that allows inputs to be chained without newlines along with color string processing)
    - actually, should probably utilize this more in depth and possibly get full range of css expression: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/font
  - expanding support for the [console object API](https://developer.mozilla.org/en-US/docs/Web/API/console) (debug and info should 'just work')
  - single-page mode (so, instead of adding to history, a way to keep modifying the visible lines, enabling text-GUI stuff a-la HTOP, etc.) (easy to implement with current design, but probably no demand for it; did something similar with keyboard support)
  - allow JSON stringify custom settings (not hard to implement, probably no demand for it)
