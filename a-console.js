/* global AFRAME, THREE, ac */

var extendDeep = AFRAME.utils.extendDeep;
var meshMixin = AFRAME.primitives.getMeshMixin();

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
    // ppcm: 'console.pixelsPerCentimeter',
    // side: 'material.side',
    'pixel-width': 'console.canvasWidth',
    'pixel-height': 'console.canvasHeight', 
    // pixel-height not necessary or looked at unless allow-custom-aspect-ratio is true 
    'allow-custom-aspect-ratio': 'console.pixelRatioOverride',
    
    'skip-intro': 'console.skipIntroAnimation',
    'font-size': 'console.fontSize',
    // always in 'pixels' (px), supply '18' to get '18px' 
    
    // specify how many console entries to save for resizing/scrolling
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
    returnColor: {default: 'lightblue', type: 'color'},
    backgroundColor: {default: 'black', type: 'color'},
    
    // how much historical logs to store
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
    
    // supply a selector that emits thumbstickmoved events to scroll with it
    thumbstickScrolling: {default: '', type: 'selector'}
  },
  async init() {
    // these two lines set up a second canvas used for measuring font width
    this.textSizeCanvas = document.createElement("canvas");
    this.textCanvasCtx = this.textSizeCanvas.getContext("2d");
    
    this.hookIntoGeometry();
    
    this.lineQ = []; // where we store processor lines of console output
    this.rawInputs = []; // where we store raw inputs (with some metadata) that we can reflow on console display updates
    
    this.canvas = document.createElement('canvas');
    this.canvas.id = "a-console-canvas"+Math.round(Math.random()*100000);
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.el.setAttribute('material', 'src', `#${this.canvas.id}`); // TODO: may need to set as ID of canvas instead, check that this works
    
    if (!this.data.skipIntroAnimation) this.logoAnimation = this.animateLogo();
    await this.logoAnimation;
    if (this.data.captureConsole) this.grabAllLogs();
    if (this.data.injectKeyboard) this.injectKeyboardSrc();
    if (this.data.keyboardEventsInput) this.listenForKeyboardEvents();
    if (this.data.thumbstickScrolling) this.addThumbstickScrolling();
    if (this.data.demo) this.runDemo();
  },
  pause() {
    this.isPaused = true;
  },
  play() {
    this.isPaused = false;
  },
  addThumbstickScrolling() {
    this.data.thumbstickScrolling.addEventListener('thumbstickmoved', evt => {
      this.thumbstickY = evt.detail.y;
    })
  },
  thumbstickY: 0,
  lastCursorBlinkTimestamp: 0,
  tick() {
    // thumbstick scrolling
    if (this.thumbstickY < -.3) {
      this.scroll("up");
    }
    else if (this.thumbstickY > .3) {
      this.scroll("down");
    }
    // blinking cursor
    let now = Date.now();
    if (now - this.lastCursorBlinkTimestamp > 500) {
      this.lastCursorBlinkTimestamp = now;
      this.writeToCanvas();
    }
  },
  commandHistorySetup() {
    if (!this.data.saveCommandHistory) {
      // commandHistory is already an empty normal array by default
    } else {
      // use proxy to keep in sync with localStorage
      var originalArray = localStorage.commandHistoryBackup ? JSON.parse(localStorage.commandHistoryBackup) : [];
      var arrayChangeHandler = {
        get: function(target, property) {
          // console.log('getting ' + property + ' for ' + target);
          // property is index in this case
          return target[property];
        },
        set: function(target, property, value, receiver) {
          // console.log('setting ' + property + ' for ' + target + ' with value ' + value);
          target[property] = value;
          localStorage.commandHistoryBackup = JSON.stringify(target);

          // you have to return true to accept the changes
          return true;
        }
      };
      
      this.commandHistory = new Proxy( originalArray, arrayChangeHandler );
      // treat commandHistory as an array

      // proxyToArray.push('Test');
      // console.log(proxyToArray[0]);
    }
  },
  hookIntoGeometry() {
    this.oldGeometry = {
      width: this.el.components.geometry.data.width,
      height: this.el.components.geometry.data.height,
    }
    const originalGeometryUpdate = this.el.components.geometry.update.bind(this.el.components.geometry);
    this.el.components.geometry.update = (function(oldData) {
      console.debug("triggering original geometry update, and then triggering console update");
      originalGeometryUpdate(oldData);
      this.update(this.data); // trigger console update any time geometry updates, in case pixel ratio changed.
    }).bind(this)    
  },
  changed(oldData, key) {
    return oldData[key] !== this.data[key];
  },
  update(oldData) {    
    if (!this.data.fontFamily.includes('mono')) {
      console.debug('CAUTION: a-console expects consistent-width fonts to function properly');
    }

    if (this.changed(oldData, 'canvasWidth') ||
        this.changed(oldData, 'canvasHeight') ||
        this.oldGeometry.width !== this.el.components.geometry.data.width || 
        this.oldGeometry.height !== this.el.components.geometry.data.height) {
      // this.canvas.setAttribute('width', this.el.components.geometry.data.width * 100 * this.data.pixelsPerCentimeter);
      // this.canvas.setAttribute('height', this.el.components.geometry.data.height * 100 * this.data.pixelsPerCentimeter);
      this.canvas.setAttribute('width', this.data.canvasWidth);
      let geometryRatio = Math.round( (this.el.components.geometry.data.height / this.el.components.geometry.data.width) * 1000) / 1000;
      let pixelRatio = this.data.canvasHeight / this.data.canvasWidth;
      console.debug("geometry or canvasprops update!", pixelRatio, geometryRatio)
      if (geometryRatio === pixelRatio || this.data.pixelRatioOverride) {
        this.canvas.setAttribute('height', this.data.canvasHeight);
      }
      else {
          const correctAspectRatioHeight = Math.round(this.data.canvasWidth * geometryRatio);
          console.debug(`set canvas height to ${correctAspectRatioHeight}, because pixel width is ${this.data.canvasWidth} and geometry ratio h/w is ${geometryRatio}`)
          this.canvas.setAttribute('height', correctAspectRatioHeight);
          this.el.setAttribute('console','canvasHeight',correctAspectRatioHeight);
          // this.data.canvasHeight = correctAspectRatioHeight // there's a possibility we should do it this way to be safe...
      }
      this.el.setAttribute('material', 'src', ``); // TODO: may need to set as ID of canvas instead, check that this works
      this.el.setAttribute('material', 'src', `#${this.canvas.id}`); // TODO: may need to set as ID of canvas instead, check that this works
      this.reflowAllLines();
    }

    if (this.changed(oldData, 'backgroundColor')) {
      this.writeToCanvas();
    }
    
    if (this.changed(oldData, 'fontSize') || this.changed(oldData, 'fontFamily')) {
      this.ctx.font = `${this.data.fontSize}px ${this.data.fontFamily}`;
      this.reflowAllLines();
    }    
  },
  async animateLogo() {
    let useLogo = AFrameLogoHD;
    let trueFontSize = this.data.fontSize;
    return new Promise(async (resolve, reject) => {
      
      // run a quick loop to figure out correct font size to display logo properly
      await new Promise((resolve2, reject2) => {
        let logoLineLength = useLogo.split('\n')[2].length;
        let findFontInterval = setInterval(() => {
          if (this.maxLineWidth >= logoLineLength || this.data.fontSize == 1) {
            console.debug(this.data.fontSize > 1 ? "hit correct font size for logo" : "hit minimum font size, seems not big enough", this.el.id, this.data.fontSize, this.maxLineWidth, logoLineLength)
            // todo: would be nice to just not show broken logo in this case
            clearInterval(findFontInterval);
            resolve2();
            return;
          }
          console.debug("attempt reducing font size for logo to", this.data.fontSize-1)
          this.el.setAttribute('console','fontSize',this.data.fontSize-1)
        }, 25);
      })
      
      let logoArray = useLogo.split("\n");

      logoArray.forEach((line,i) => {
        setTimeout(() => {
          this.writeToCanvas(line, this.getNextGradientColor());
          if (i+1 === logoArray.length) {
            setTimeout(() => {
              if (!this.data.keepLogo) {
                console.debug("removing logo, restoring true font size");
                this.rawInputs = [{text:''}];
                this.lineQ = [''];
                this.el.setAttribute('console','fontSize',trueFontSize);
              }
              resolve(); 
            }, 1000)
          }
        }, i*this.data.introLineDelay)
      })
    })
  },
  getNextGradientColor:(() => {
    let counter = 1;
    let up = true;
    return function(n=1) {
      if (fullScreenGradient[counter+1] && counter !== 0) {
        up ? counter+=n : counter-=n;
      } else {
        up = !up; up ? counter+=n : counter-=n;
      }
      if (!fullScreenGradient[counter]) {
        counter = 1;
        up = true;
      }
      return fullScreenGradient[counter];      
    } 
  })(),
  async runDemo() {
    await this.logoAnimation;
    let theLine = "";
    this.demoInterval = setInterval(() => {
        theLine = Date.now() + "";
        this.writeToCanvas(theLine, this.getNextGradientColor())
    }, Math.random() * 1050);
  },
  commandBuffer: "",
  listeningForKeyboardEvents: false,
  inputCursorOffset: 0, // for manipulating input with arrow keys
  commandOffset: 0,
  exploringInputHistory: false,
  addKeyboardHelpers(force) {
    if (window.ac) {
      console.info("ignoring conflict: window.ac already exists, will overwrite")
    }
    window.ac = {
      logAll: true,
      skipUndefined: true,
      c: console,
      cl: console.log,
      d: document,
      qs:function querySelector(x) { return document.querySelector(x) },
      id: function getElementById(id) { return document.getElementById(id) },
      qsal:function querySelectorAllList(x) { 
        return [...document.querySelectorAll(x)].map(
          el => `${el.tagName.toLowerCase()}${el.id ? '#'+el.id : ''}${el.className ? "." + el.className.split(" ").join("."):""}`)
      },
      qsa: function querySelectorAll(x) { return [...document.querySelectorAll(x)] },
      comp: function getComponent(x) { return document.querySelector(`[${x}]`).components[x] },
      ok: function objectKeys(x) { return Object.keys(x) },
      el: function createEl(type='a-entity', attributes={}, append=[]) {
        const newEl = document.createElement(type);

        for (const [key, value] of Object.entries(attributes)) {
          newEl.setAttribute(key, value)
        }

        if (!Array.isArray(append)) {
          append = [append]
        }

        if (append) {
          append.forEach(toAppend => {
            if (typeof toAppend === "string") {
              toAppend = document.querySelector(toAppend)
            }
            newEl.appendChild(toAppend)
          });
        }

        return newEl;
      },
      app: function appendTo(appendThisEl,appendToThisEl=AFRAME.scenes[0]) {
        appendToThisEl.appendChild(appendThisEl);
      },
      opt: (function setOption(attr, val) {
        this.el.setAttribute('console',attr,val);
      }).bind(this),
      attr: function setAttribute(selectorOrEl, component, attribute, value) {
        const el = typeof selectorOrEl === "string" ? document.querySelector(selectorOrEl) : selectorOrEl;
        if (value) {
          el.setAttribute(component, attribute, value)
        } else {
          return el.components[component].data[attribute];
        }
      },
      move: function move(selectorOrEl,dimension,amount) {
        const el = typeof selectorOrEl === "string" ? document.querySelector(selectorOrEl) : selectorOrEl;
        const newVal = el.components.position.data[dimension] + amount;
        this.moveTo(el,dimension,newVal);
      },
      moveTo: function moveTo(selectorOrEl,dimension,value) {
        const el = typeof selectorOrEl === "string" ? document.querySelector(selectorOrEl) : selectorOrEl;
        el.components.position.data[dimension] = value;
        el.setAttribute('position',el.components.position.data)
      },
      help: (function() {
        console.log(`
  built in helpers:
%c   keys:%c
   ---------
    thumbstick (if configured): scroll console
    pgUp/Dn: scroll console
    arrowUp/Down: scroll inputs history
    arrowLeft/Right: move input cursor
    delete: clear input field
    
%c   misc:%c
   ----------
    ac.ok(x) = Object.keys(x);
    ac.opt(attr,val) = <consoleEl>.setAttribute('console',attr,val)
     example:
      ac.set('fontSize',25);
     useful for adjusting console component itself
     (try \`ac.comp('console').data\` to see list of attributes you can modify)
    help      -> show this text
    ac.help() -> show this text
    
%c   console:%c
   -----------
    ac.c = console
    ac.cl(msg) = console.log(msg)
    ac.c.warn(msg) = console.warn(msg)
    ac.logAll -> bool, default true; when true, logs output of all executed commands
    ac.skipUndefined -> bool, default true; when true, ignores undefined return values
    
%c   document:%c
   ------------------
    ac.d =  window.document
    ac.qs(selector) = document.querySelector(selector)
    ac.id(id) = document.getElementById(id)
    ac.qsa(selector) = [...document.querySelectorAll(selector)]
    ac.qsal(selector) = ac.qsa(selector).map(el => <el's tag, id, classes, combined as string>)
    
%c   element (create, append):%c
   -------------------------
    ac.el(tag, attributes, children) -> create an element
      example:
       ac.el('a-sphere',{position:'0 1 -1'})
    ac.app(child, parent) -> append child el to parent el
      example:
       let newEl = ac.el('a-sphere',{position:'0 1 -2'})
       ac.app(newEl) // (default parent is scene if not specified)
      this will create a sphere and append it to the scene
      
%c   aframe specific:%c
   -----------------
    ac.comp(compName) = document.querySelector('[compName]').components[compName]
      good for when only one el has a given component you want to directly inspect/use
    ac.attr(selectorOrEl, component, attribute, value) = el.setAttribute(component, attribute, value)
      example:
       ac.attr('#tv','position','z',2) // set z to 2
      if last argument not supplied, will get instead of set
       ac.attr('#tv','position',z)     // document.querySelector('#tv').components.position.data.z
    ac.move(selector,dimension,amount)
      adjusts position dimension by given amount
    ac.moveTo(selector,dimension,value)
      sets position dimension to exact value
`,
`color: ${this.getNextGradientColor(30)}`,'color: inherit',`color: ${this.getNextGradientColor(30)}`,'color: inherit',`color: ${this.getNextGradientColor(30)}`,'color: inherit',`color: ${this.getNextGradientColor(30)}`,'color: inherit',`color: ${this.getNextGradientColor(30)}`,'color: inherit',`color: ${this.getNextGradientColor(30)}`,'color: inherit'
)
      }).bind(this)
    }
    setTimeout(() => window.ac.help(),0)
  },
  scroll(dir) {
    if (dir === "down") {
      if (this.scrollOffset === 0) {
        return;
      }
      this.scrollOffset -= this.scrollOffset === 0 ? 0 : 1;
    }
    else if (dir === "up") {
      this.scrollOffset += this.scrollOffset === (this.lineQ.length + this.commandBufferFormatted.length - this.maxConsoleLines) ? 0 : 1;
    }
    this.writeToCanvas();
  },
  listenForKeyboardEvents() {
    if (this.data.addKeyboardHelpers) this.addKeyboardHelpers();
    this.commandHistorySetup();
    // todo, add event listeners to pause()
    if (this.listeningForKeyboardEvents) return;
    this.listeningForKeyboardEvents = true;
    // probably ideal to add this functionality into super-keyboard itself actually
    let keysToSkip = [16,17,18];
    
    // keydown for arrow/pgdnup is so pressing and holding is properly registered as multi-press
    window.addEventListener("keydown", (function(event) {
      if (event.key.includes("Arrow")) {
        if (event.key.includes('Up')) {
          if (this.commandOffset === 0 && !this.exploringInputHistory) {
            // save current line just in case... but also make sure we don't duplicate this... bleh
            this.commandHistory.push([this.commandBuffer, this.data.inputColor]);
            this.exploringInputHistory = true;
          }
          this.commandOffset += this.commandOffset === (this.commandHistory.length-1) ? 0 : 1;
          let historyInput = this.commandHistory[this.commandHistory.length -(1+this.commandOffset)];
          this.renderCommandBuffer(historyInput[0], historyInput[1]);
          this.commandBuffer = historyInput[0];
        }
        else if (event.key.includes('Down')) {
          if (this.commandOffset === 0) {
            return;
          }
          this.commandOffset -= this.commandOffset === 0 ? 0 : 1;
          // console.info("offset after down:",this.commandOffset)
          let historyInput = this.commandHistory[this.commandHistory.length -(1+this.commandOffset)];
          this.renderCommandBuffer(historyInput[0], historyInput[1]);
          this.commandBuffer = historyInput[0];
          if (this.commandOffset === 0 && this.exploringInputHistory) {
            this.commandHistory.pop(); // remove the cached text
            this.exploringInputHistory = false;
          }
        }
        else if (event.key.includes('Left')) {
          this.inputCursorOffset += this.inputCursorOffset === this.commandBuffer.length ? 0 : 1;
          this.writeToCanvas();
        }
        else if (event.key.includes('Right')) {
          this.inputCursorOffset -= this.inputCursorOffset === 0 ? 0 : 1;
          this.writeToCanvas();
        }
      } else if (event.key.includes("Page")) {
        if (event.key.includes('Up')) {
          this.scroll("up");
        }
        else if (event.key.includes('Down')) {
          this.scroll("down");
        }
      } else if (event.key === "Backspace") {
        let len = this.commandBuffer.length;
        let offset = this.inputCursorOffset + 1;
        let afterBackspace = this.commandBuffer.slice(0, len-offset) + this.commandBuffer.slice(len-offset+1);
        this.commandBuffer = afterBackspace;
        this.renderCommandBuffer();
      }
    }).bind(this))

    const skipKeyNames = ["CapsLock","Tab","Insert","PageUp","PageDown","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Backspace","Meta"];
    window.addEventListener("keyup", (function(event) {
      if (event.isComposing || keysToSkip.includes(event.keyCode)) {
        // do nothing
      } else if (event.key === "Escape") {
        console.log("todo: escape behavior; ignore typing until console raycast clicked to re-activate perhaps?")
      } else if (event.key === "Enter") {
        this.eval(this.commandBuffer);
        this.commandBuffer = '';
        this.inputCursorOffset = 0;
        this.renderCommandBuffer();
      } else if (event.key === "Delete") {
        this.commandBuffer = '';
        this.renderCommandBuffer();
      } else if (skipKeyNames.includes(event.key)) {
        // do nothing on these keys
      } else if (event.key === "Home") {
        this.inputCursorOffset = this.commandBuffer.length;
        this.writeToCanvas();
      } else if (event.key === "End") {
        this.inputCursorOffset = 0;
        this.writeToCanvas();
      } else {
        let newString;
        if (this.inputCursorOffset === 0) {
          newString = this.commandBuffer + event.key;
        }
        else {
          newString = 
            this.commandBuffer.slice(0,this.commandBuffer.length - this.inputCursorOffset) + 
            event.key + 
            this.commandBuffer.slice(this.commandBuffer.length - this.inputCursorOffset);
        }
        // debugger
        this.commandBuffer = newString;
        this.renderCommandBuffer();
      }
      // this.startBlinkCursor();
    }).bind(this));
  },
  injectKeyboardSrc: (function() {
    let haveInjectedKeyboardSrc = null;
    return async function() {
      if (!this.haveInjectedKeyboardSrc) {
        let srcLoadedResolve;
        this.haveInjectedKeyboardSrc = new Promise((resolve, reject) => {
          srcLoadedResolve = resolve;
        })

        // inject kylebakerio fork of super-keyboard source if first time injecting
        // note: no symbols on this keyboard; needed is a custom keyboard that has programming symbols available
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.async = true;
        script.onload = function() {
          srcLoadedResolve();
        }
        script.src = 'https://cdn.statically.io/gh/kylebakerio/aframe-super-keyboard/master/dist/aframe-super-keyboard.min.js';
        try {
          document.getElementsByTagName('head')[0].appendChild(script);
        } catch (e) {
          console.error("error injecting keyboard source; perhaps you already load super keyboard? will attempt to continue anyways.")
          console.error(e);
        }
      }
      await this.haveInjectedKeyboardSrc;
      // inject keyboard into scene
      this.superKeyboard = this.superKeyboard || document.createElement('a-entity');
      this.superKeyboard.id = "a-console-keyboard";
      this.superKeyboard.setAttribute('super-keyboard', `font:monoid;hand:${this.data.kbCursor}; value:console.log('hello world'); multipleInputs: true; imagePath: https://cdn.statically.io/gh/kylebakerio/aframe-super-keyboard/master/dist`);
      this.el.appendChild(this.superKeyboard);
      this.superKeyboard.setAttribute('position','0 -1.5 0');
      this.superKeyboard.setAttribute('rotation','-45 0 0');
      window.addEventListener('superkeyboardinput', (function(event) {
        this.eval(event.detail.value);
      }).bind(this));
    }
  })(),
  canEval: null,
  eval(cmd) {
    if (this.canEval === null) {
      try {
        eval('1');
        this.canEval = true;
      } catch(e) {
        console.error("in-vr code execution relies on eval(), which is forbidden here, you probably need to add 'unsafe-eval' to your server's content security policy.",e);
      }
    }
    
    if (!this.canEval) {
      console.error("< eval() forbidden >");
    }
    else {
      let cmdColor = "gray";
      try {
        if (cmd === 'help') {
          ac.help();
        }
        else if (ac.logAll) {
          // console.log(window.eval(cmd));
          const returnVal = window.eval(cmd);
          if (!ac.skipUndefined || returnVal !== undefined) {
            this.logToCanvas([returnVal],this.data.returnColor, false);
          }
        } else {
          window.eval(cmd);
        }
      } catch (e) {
        cmdColor = "red";
        console.error(e.message);
      }
      if (this.exploringInputHistory) {
        this.commandHistory.pop(); // remove the cached text
        this.exploringInputHistory = false;
        this.commandOffset = 0;
      }
      if (!this.commandHistory.length || this.commandHistory[this.commandHistory.length-1][0] !== cmd) {
        this.commandHistory.push([cmd, cmdColor]); // unless we re-ran the last command, save what we just ran into history
      }
      // console.info(this.commandHistory.map((cmd,i) => `${i}: ${cmd[0]}`))
    }
  },
  calcTextWidth() {
    this.textCanvasCtx.font = this.ctx.font;
    this.textData = this.textCanvasCtx.measureText('a');
    this.fontWidth = this.textData.width;

    this.maxConsoleLines = Math.floor(this.data.canvasHeight / this.data.fontSize);
    this.yMargin = (Math.ceil(this.maxConsoleLines * 0.01));
    this.maxConsoleLines-= Math.ceil(this.yMargin); // this is broken for some reason
    
    this.maxLineWidth = (this.data.canvasWidth / this.fontWidth);
    this.xMargin = Math.ceil(this.maxLineWidth * .02);
    this.maxLineWidth -= this.xMargin; // 1% reduce for buffer
    this.maxLineWidth = Math.ceil(this.maxLineWidth);
  },
  reflowAllLines() {
    this.calcTextWidth();
    if (!this.lineQ.length) return;
    // used when font size or screen size changes, to recompute line breaks.
    // can also used when toggling all stack traces on/off, or when filtering
    this.lineQ = [];
    this.rawInputs.forEach(rawInput => {
      this.addTextToQ(rawInput.text, rawInput.color, rawInput.isStackTrace, true)
    });
    this.writeToCanvas();
  },
  addErrorListeners: (() => {
    // experimental: reporting uncaught errors
    // https://stackoverflow.com/questions/12571650/catching-all-javascript-unhandled-exceptions
    // https://stackoverflow.com/questions/62475654/how-to-manage-uncaught-exceptions-in-javascript-in-order-to-show-the-error-mes    
    let haveAddedListeners = false;
    return function() {
      if (haveAddedListeners) return;
      haveAddedListeners = true;
      window.addEventListener('unhandledrejection', function (e) {
        console.error(e.reason.message);
        return false;
      })

      window.addEventListener("error", function (e) {
         console.error(e.error.message);
         return false;
      })
    }
  })(),
  grabAllLogs() {
    for (let i = 0; i < this.data.captureConsole.length; i++) {
      const consoleComponent = this;
      const consoleFuncName = this.data.captureConsole[i];
      const consoleFuncColor = this.data.captureConsoleColors[i];
      const originalFn = console[consoleFuncName];
      
      console[consoleFuncName] = function() {
        originalFn(...arguments);
        
        if (consoleComponent.data.captureConsole.includes(consoleFuncName)) {
          const arrayOfArgs = [...arguments];
          let hasStackTrace = false;
          if (consoleComponent.data.captureStackTraceFor.includes(consoleFuncName)) {
            // console.log("manually added stack error:",new Error().stack); // I think we want to slice the first three lines out?
            arrayOfArgs.push((new Error().stack).split("\n").slice(1).join("\n"));
            hasStackTrace = true;
          }
          consoleComponent.logToCanvas(arrayOfArgs,consoleFuncColor || consoleComponent.data.textColor, hasStackTrace);
        }
      };
    }

    this.addErrorListeners();
  },
  commandHistory: [],
  renderCommandBuffer(text=this.commandBuffer, color=this.data.inputColor) {
    this.commandBufferFormatted = this.rawInputNewlines(`dev@${location.host}:$ ${text}`).map(line => [line, color]);
    this.writeToCanvas();
  },
  commandBufferFormatted: [],
  rawInputNewlines(text) {
    let output = [];
    text.split('\n').forEach(newLine => {
      for (let i = 0; i < newLine.length / this.maxLineWidth; i++) {
        let maxLengthSegment = newLine.slice(i*this.maxLineWidth, (i*this.maxLineWidth) + this.maxLineWidth);
        output.push(maxLengthSegment);
      }
    })
    return output
  },
  addTextToQ(text, color, isStackTrace, reflow, sameLine=false) {
    if (typeof text !== "string") {
      throw new Error("can only write string to canvas")
    }
    if (!reflow) {
      this.rawInputs.push({
        text,
        color,
        isStackTrace,
        sameLine
      });
    }

    if (!isStackTrace || this.data.showStackTraces) {
      this.rawInputNewlines(text).forEach((line,i) => {
        this.lineQ.push([line, color, sameLine && i !== 0]);
        if (!reflow && this.rawInputs.length > this.data.history) {
          this.lineQ.shift();
        }
      })
    } else {
      // future feature: perhaps insert clickable line that expands out to stack trace
    }

    if (!reflow && this.rawInputs.length > this.data.history) {
      // if reflow, skip this
      // otherwise,
      // if inputs is bigger than history limit, remove oldest
      this.rawInputs.shift();
    }
  },
  stringify(arg) {
    let output;
    try {
      output = JSON.stringify(arg, null, 2);
    } catch(e) {
      // output = `<a-console error: unable to stringify argument: ${e.stack.split('\n')[0]}>`;
      output = `<could not stringify(${e.stack.split('\n')[0]}); showing keys instead>\n${JSON.stringify(Object.keys(arg),null,2)} `;
    }
    return output;
  },
  async logToCanvas(arrayOfArgs, color, hasStackTrace) {
    if (this.isPaused) return; // don't capture logs while paused
    const isFormattedLogInput = arrayOfArgs.reduce((memo,item) => typeof item !== "string" ? false : item.includes('%c') || memo, false);
    if (isFormattedLogInput) {
      let texts = arrayOfArgs[0].split("%c");
      let styles = [""].concat(arrayOfArgs.slice(1).map(str => str.split("color:")[1]));
      texts.forEach((text,i) => {
        let color = styles[i].includes("inherit") ? this.data.textColor : styles[i];
        // console.info([color,text]);
        this.writeToCanvas(text,color,false,true)
      })
      // pass in multiple separate stylelized lines
    } else {
      let logString = "";
      logString = arrayOfArgs.reduce((logString, arg, i) => {
        if (i > 0) {
          logString += " "; // space between arguments
        }
        if (i === arrayOfArgs.length-1 && hasStackTrace) {
          return logString; // in other words, skip, because we send it as a separate input
        }
        else if (typeof arg !== "string") {
          logString += this.stringify(arg);
        }
        else {
          logString += arg;
        }
        return logString;
      }, "");
      await this.logoAnimation; // capture logs during animation, but don't display until after animation
      this.writeToCanvas(logString, color, false);
      if (hasStackTrace) {
        this.writeToCanvas(arrayOfArgs[arrayOfArgs.length-1], color, true)
      }
    }
    
  },
  scrollOffset: 0,
  writeToCanvas(text="", color=this.data.textColor, isStackTrace=false, sameLine=false) {    
    if (text) this.addTextToQ(text, color, isStackTrace, false, sameLine);
    this.refreshBackground();
    this.ctx.font = `${this.data.fontSize}px ${this.data.fontFamily}`;
    let lines = this.lineQ.concat(this.commandBufferFormatted);
    
    let lineX = 0;
    let lineY = 0;
    let yLines = 0;
    for (let canvasLine = 0, 
         i = lines.length > this.maxConsoleLines ? lines.length - this.maxConsoleLines - this.scrollOffset : 0; 
         
         i < lines.length; 
         
         i++, canvasLine++) {
        
        if (!lines[i][2]) {
          // if sameLine is false (normal)
          // then we're on a new line
          yLines++;
          lineX = this.xMargin;
        } else {
          // otherwise, attempt to fit this line on same line as last one
          let newLineX = lineX + (lines[i-1][0].length * this.fontWidth);
          if (newLineX <= this.maxLineWidth) {
            lineX = newLineX;
          } else {
            // but if it doesn't fit, stick it on a new line anyways
            yLines++;
            lineX = this.xMargin;
          }
        }
        lineY = this.data.fontSize + (this.data.fontSize * yLines);
        
        this.ctx.fillStyle = lines[i][1];
        this.ctx.fillText( lines[i][0], lineX, lineY );
    }
    if (lines.length && this.scrollOffset === 0 && this.data.keyboardEventsInput) {
      let cursorX = ((lines[lines.length-1][0].length - this.inputCursorOffset) * this.fontWidth) - 5;
      let cursorY = this.data.fontSize + (this.data.fontSize * yLines) + 4;
      this.ctx.fillStyle = this.data.inputColor;
      const cursorChar = Date.now() % 1000 > 500 ? "_" : " "; //"▯" : "▮";
      this.ctx.font = `${this.data.fontSize}px ${this.data.fontFamily}`;
      this.ctx.fillText(cursorChar, cursorX, cursorY);
    }

    this.material = this.el.getObject3D('mesh').material;
    if (this.material.map) this.material.map.needsUpdate = true;
  },
  refreshBackground() {
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = this.data.backgroundColor;
    this.ctx.fillRect(0, 0, this.data.canvasWidth, this.data.canvasHeight)
  }
});

const AFrameLogoHD = `
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMX0OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOKWMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:,;;,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,;oXWMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;,,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,,,,,,;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;,,;;;;;;;;;,,;;,,,,,,,;,,,;;;,,,;,,;,;;,;;,,;;,;;;;;;,;;,;;;;,,;;;;,,;;;;;;;;;;;,,,,,,,;,,;;,;;,,,;;;,;;,;;,,;,;;;,,,,,;;;,,;;,;;,,,,,;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;,,;;;,,,,;;;,;:c;,;;;,;;,,,,,,,,;;,,;,;cllcclccc:;,;;;clclcccc:;,;;,,;;;;;,,;cc;;;,,,,,,,,;:c:;,;;,;;,;:c:;;,,,;;;clllcllcc:;,;;,;;,,,;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;,;;;;,,,,,,,;lxko;;;,;;,,,,,,,;;;,,,,,cxxlllllll:;;;,cxxoollloooc;;,,;;;;;;;lkkl;;;;;;;,,,;dOxc,;;,;;,:dOx:;,,,;;lxdoollollc;,;;,;;,,,;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;;,,,,,,;,,,,:doodc;;,;;,,,,;;;;;;;,,;,cxl;;,,;,,,;;,,cxo;,,;,;:okl;;;;,;;;,:dooxc;,,,;;;;,:xxxd;,;;;,;lxkkc;;,;;;lxl;;,,,,;;,,,,,;;,,,;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;,,,,,,;;;,,;od:;od:,,,,;,,;,,,,,;,,;,,cxl;,,,;;,;;,,,cxo;,;;,;,cko;,,,;;,,:od::dd:,,;;;,,;cxolxl;;;,;cdllkl;,,,;;lxl;,;;,,,;;;;,,;;,,,;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;;,,,,,;,,;;lxl;,:do;,,,;;,;;;,,,,,;;;,cxl,;;,,,,;,,;;cxo;;;,,;:oxl;;,,;;,;ldc;,cxo;;,,,,;;lxl;oxc,;,:dd:cxo;,,,;;lxl;;;;;;;;;;,;;;;,,,;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;;,,,;;;,;,:do;;,;lxl;,;;;;:ccccc:;;,;;ckxllllll:;,;;,ckkoooodoooc;;;;;;;;cdl;,,;oxc;,;,,;;oxc,:do;;;ldc,:xd;,;;;;lkxoooool:;;,;;;;;,,,;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;;,,,;;;;;;od:;;;;:dx:;;;;:loooool:;,;,cxo::::::;;,,,,ckxllcokxc;,;;;;,,;:dd:;;;;:dd:,,,,,;od:,;cdl;cdl;,;dx:,;;,;lxo:::;;;;;;;;;;;;,,,;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;,,,,;;;;;lkxooooooxkd;,;;,,;;,,,,,,;;;cxl;,,;,,,;,,,;cxo;,,;cdxc;;,,;,,;okxooooooxko;,;,,:do;;,;odloo:,,;lxc,,,,;lxl;;,,;,;;,;;,,;,,,;;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;,,,,,,,;cdo::::::::oxl;;;,,,;,,;,,;,,,cxl;,;,,,;;,,,;cxo;,,,;:dxc;;;,,;cxo::::::::oxl;;,,cxl;;,,:dkxc;;,,cxl;,;;;lxl,,,,;;;;,,,,,,,,,,,,;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;,,,,,,,;:dd:,;,,,,,,;oxc,;,,;;,,,,;;;;,cxl,;;,,;;,,,,,cxo;,;,,,:oxl;,,,:dd:;,;;,,;,:dd:;,;lxc,;,;;:oc;;;;;:do;,;;;lxl;;;;;;;;,,,,,;,,,,,,;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;;;,,,,,,;:oc;;;,,,,,,;:oc;;;;;;,,,;,,;,,:lc,,;,;;,;;,;,:oc;,,;;,;;lo:;,,coc;;;;,;;,;;:oc;,;cl:,;,;;,;;,,;;;;ll;,;;,cddoooooooc;,,,,,,,,;,,;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:,;;;;;;,,;;;;;;,;;;;,,,,;;,,,;;;;;;;;;;;,;;;,,,;;;;;;;;,,;;;;,,;;;;;;;;;;;;;,;;;;;;;;,;;;;;;;;,,;;;;;;;;;;,;,;;;;,,;;;;;;;;;;;;;;,,;;;;;;;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:,,;;;;,,,;,,;;;;,,;;,,,,,,,,,,;;;;;;;,,,,;;;,,,,;;;;;;;,,;;;,,,,,,,,;;;;;,,,,,;,;;;;;;;;;,,;;,,,,;;;,;;;,,,,;,,,,,,,,,;;;;;;,,,,,,,;;;;;;;;,oXWMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWk:;,,,,,,,,;;,;;,,;;;;;;;,;;;,,;;;;;;;;;,,,,,,,,,;;;;;;;;,,,;;;;;;,,,;;;;;;;;,,,,;;;,,,,,;;,,,;,,,,,,;;;;;;;,;;;,,;;;;;,,;;;;;,,,,;;,,,,,;;;;,oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMW0ollllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllxNMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMWNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWXNWWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWN0koccd0WMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNKkdc;,,,,;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWXKK0KXNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWXOxl:,,,,;;;;;:kWMMMMMMMMMMMMMMMMMMMMMMMMWWNXK0OOOOOOO0XNWWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNN0xo:;,,,,;;;;;;;;;lKWMMMMMMMMMMMMMMMMMMMMWNXK0OOOkkkOOOOkOOO0KXNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNKkdlc;,,,,;;;;;;;;;;;;;:kNMMMMMMMMMMMMMMMMWWXK0OOOOOkOOOOOOOOOOkOkkOO0KXWWMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWXOxl:,,,,,,;;;;;;;;;;;;;;;;;lKWMMMMMMMMMMMMWNXK0OOOOOOOOOOOOOOOOOOOkkkOOOkOOO0XNWWMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWX0xo:;,,,,;;;;;;;;;;;;;;;;;;;;;;:xNMMMMMMMMWNXK0OOkOOkOOOOOOOOOOOOOOOOOOOOOOOOOOkOOO0KXNWMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNKkdc;,,,,,;;;;;;;;;;;;;;;;;;;;;;;;;;lKWMMMMMMWKkkkkkOOOkkOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOkOOO0KXNWMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWXOdl:,,,,,,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:xNMMMMMMNOddxxxkkkkOOOOOOOOOOOOOOOOOOOOOOOOOOOOkkOkkOOkkOO0XNWWMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWN0xo:;,,,,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;l0WMMMMMNOddddddxxkkkkOOOOOOOOOkOOOOOOOOOOOOOOOOOkkOOOOOOkkOO0KXNWMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMXo,',,,,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;xNMMMMMXkdddddddddxxxkkkkkkOOOOOOkkOOOOOOOOOOOOOOOOOOOOOOkkkOOO0KNWMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNx,..',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;l0WMMMMN0kxdddddddddddxxkkkkkOOOOOOkkOOOOOOOOOOOOOOOkOOOOOOOO0000XWMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWO;...',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;dNMMMMMWNX0OxxdddddddddddxxxkkOOOOOOOOOOOOOOOOOOOOOOOOOOO0000000XWMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMW0c.',,.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;c0WMMMMMMMMWNK0kxdddddddddddxxxkkkOOOkkOkkkOOkOOOOOOO00000000000XWMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMXo'.;l:'',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;dNMMMMMMMMMMMWWXKOkxdddddddddddxxxkkkkkkOOOOOOOOO000000000000KKNWMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNx,.,ldl,.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;cOWMMMMMMMMMMMMMMWNX0OkxddddddddddxxxkkkkOOOO0000000000000KXNNWMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWO;.'cddo:'.,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;dXMMMMMMMMMMMMMMMMMMWNX0OxxdddddddddddxkO000000000000KKXNWWMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWKc'':odddl;.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;cOWMMMMMMMMMMMMMMMMMMMMMWNK0kxdddddddddkO00000000KKXNNWMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMXo'.;odddddc'.,,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,;;;dXWMMMMMMMMMMMMMMMMMMMMMMMMWXKOkxdddddkO00000KXXNWWMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWx,.,lddddddo;.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:OWMMMMMMMMMMMMMMMMMMMMMMMMMMMWNX0OxxdkO0KKXNWWMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWO;.'cddddddddc'.,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;oXMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNK00KXNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMKc.':oddddddddo;.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:kWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNo'.;lddddddddddc'.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;oXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWx,.,cdddddddddddo;.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:kNMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMW0:.':oddddddddddddc,.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;lKMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMKl'':odddddddddddddo:.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:kWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNd'.;ldddddddddddddddl,.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;lKWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWk,.,cddddddddddddddddo:'',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:xNMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMW0:.':odddddddddddddddddl,.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;lKWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMXl'.;oddddddddddddddddddo:'',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;xNMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNd'.,lddddddddddddddddddddl,.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;l0WMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWk;.,cddddddddddddddddddddxxl'',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;dNMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMW0:.':odddddddddddddddddxkO0Kk:.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;c0WMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMXl'.;oddddddddddddddxkO00KKKK0o'',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;dNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNd,.,lddddddddddddxkO0KKKKKKKKKk:.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;c0WMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWk;.'cdddddddddxkO0KKKKKKKKKKKKK0o,.,,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;dXMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMW0:.':odddddxxkO0KKKKKKKKKKKKKKKKKO:.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;cOWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMXl'.;odddxkO0KKKKKKKKKKKKKKKKKKKKK0d,.,,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;dXMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNd,.,lxkOO0KKKKKKKKKKKKKKKKKKKKKKKKKOc'',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;cOWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWk;..;dOKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKd,.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;oXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMKc..'',:lxO0KKKKKKKKKKKKKKKKKKKKKKKKKKOc'',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:OWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNKOkOKNWMMMMMMMMMMMWXo'.;cc;,'',cok0KKKKKKKKKKKKKKKKKKKKKKKKx,.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;oKWMMMMMMMMMMWX0Ok0XWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMN0kdlcccldk0NMMMMMWNKOd:'.,ldddol:;''';ldO0KKKKKKKKKKKKKKKKKKKKOl'',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;lx0NWMMMMWKOdolcccodOXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWk:;::cccclloOWWNKOdl:;,..'cdddddddolc:,'',:oxOKKKKKKKKKKKKKKKKKKx;.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:ldOXWW0l;;::ccclloxKWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWx;,;;;:loooodkxl:;;;;,'.':odddddddddddol:;''';ldk0KKKKKKKKKKKKKK0l'',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;cdko;,,;;:cloooo0WMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWx;,,,;:loooolc:;;;;;,'..;lddddddddddddddol:,'''',:oxO0KKKKKKKKKKKx;.',,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,;cloooo0WMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWx;,,,;:loooolc:;;;;;,..,cdddddddddddool::;,,,,,''''';cdk0KKKKKKKK0l'.',;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,;;;,;cloooo0WMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWx;,,,;:loooool:;;;;,'.'coddddddddolc:;,,,,,,,,,,,,,''.',:lxO0KKKXKOo:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,,,,,;cloooo0WMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMWN0o;,,,;:loooooc:;;;,'.':odddddooc:;;,,,,,,,,,,,,,,,,,,,''',:dOKKKXXX0Okkdoc:;;;,;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,,,,,,;clooookXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMWXOdl:;;,,,;:loollc:;;;,'..,ldddolc:;,,,,,,,,,,,,,,,,,,,,,,;:loxkOOO000KKK00O00Okdlc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,,,,;cloollccok0XWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMWX0koc;;;;;;;;;;:clc:;;;;;;,'.,colc:;,,,,,,,,,,,,,,,,,,,,,,,;coxkO00000OOOOO0000O000000Oxoc:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,;:lcc:;;;;;:cok0XWMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMWNKOdl:;;;;;;;;;;;;;;c:;;;;;;;;;,,;::;,,,,,,,,,,,,,,,,,,,,,,;:ldkOOO00000000000OOOOOOO00000000Okdoc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;::;;;;;;;;;;;;:cdkKNWMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMWX0xl:;;;;;;;;;;;;;;;,,:c;,;;;;;;;;;;;;;,,,,,,,,,,,,,,,,,,,,;coxkO0000000000000000000OOOOO00000000000Oxol:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,,;::,,;;;;;;;;;;;;;;:ldOKNWMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMNKkdc;;;;;;;;;;;;;;;;;,,,,;:;,,,;;;;;;;;;;;;;;,,,,,,,,,,,,,,,:okOO0000000000000000000000000OO00000000000000Okdlc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,,,,;:;,,,;;;;;;;;;;;;;;;;;:lxOXWMMMMMMMMMMMMMMM
MMMMMMMMMMMXkl:;;;;;;;;;;;;;;;;;;,,,,,;,,,,;;;;;;;;;;;;;;;;;;,,,,,,,,,,;lxkkOOO00000000000000000000000OOO00000000000000000Oxdl:;;;;;;;;;;;;;;;;;;;;;;;;;,,,,,;,,,,;;;;;;;;;;;;;;;;;;:lkKWMMMMMMMMMMMMMMM
MMMMMMMMMMMMWNKkdc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,,,,,,;ldddxxkOO0000000000000000000000OO000000000000000000000kxoc;;;;;;;;;;;;;;;;;;;;;;;;;;,,;;;;;;;;;;;;;;;;;;;cdkKNWMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMWX0xl:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,,,;ldddddddxxkO0000000000000000000OOO00000000000000000000000Oxdl:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:lx0XWMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMWNKkoc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;lddddddddddxxkO0000000000000000OOO000000000000000000000000KK0x:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;cdkKNWMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMWXOxl:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;lddddddddddddxxkkOO00000000000000OO00000000000000000000KKXXXXk:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:lx0XWMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMWNKkoc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;clodddddddddxxxxxxkkkOOO00000000OO0000000000000000KKKXXXXXXXk:,;;;;;;;;;;;;;;;;;;;;;;;;;;;cokKNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWXOxl:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:clodddddxxxxxxxddxxkOOO00000OOO000000000000KKXXXXXXXXXXXk:;;;;;;;;;;;;;;;;;;;;;;;;:lxOXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNKkoc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:loddxxxxxxxddddddxkkkOOO0OO00000000KKKXXXXXNNXXNXXXXkc;;;;;;;;;;;;;;;;;;;;;cokKNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWXOxl:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,;;:codxxxxxddddddddddxxkOOOO0000KKXXXXXXXXNNXXXXXXKko:;;;;;;;;;;;;;;;;;:lxOXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNKkoc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;,;cooooddddddddddddddddxxkOKXXXXNXXXXXXXXXNXK0xoc:;;;;;;;;;;;;;;;;cokKNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWXOxl:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;cc:;;:clodddddddddddddddOXXNXXXXXXNNNXX0kdl:;;;;;;;;;;;;;;;;:lxOXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNKkoc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;::;;;;;;:cloddddddddddddOXXNXXXXXXXK0xoc:;;;;;;;;;;;;;;;;cokKNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWXOdl:;;;;;;;;;;;;;;;;;;;;;;;,,,,;::,,,;;;;;;;:clooddddddxOXXXXXXXKkdl:;;;;;;;;;;;;;;;;:lxOXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWN0koc;;;;;;;;;;;;;;;;;;;;,,,,;;;,,,;;;;;;;;;;;:clodddxOXXXKOxoc:;;;;;;;;;;;;;;;;cokKNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWXOdl:;;;;;;;;;;;;;;;;;,,,,,,,,;;;;;;;;;;;;;;;;:clok0kdl:;;;;;;;;;;;;;;;;:ldOXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWN0koc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:::;;;;;;;;;;;;;;;;;cokKNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWXOdl:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:ldOXWWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWN0koc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;cok0NWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWKOdl:;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;:ldOXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWN0xoc;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;cok0NWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNKOdl:;;;;;;;;;;;;;;;;;;;;;;;;;:ldOXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWN0xo:;;;;;;;;;;;;;;;;;;;cok0NWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWKOdc:;;;;;;;;;;;:ldOXWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWN0xo:;;;;clok0NWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWNKOddOXNWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMWWMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
`                                                                                 
const logoGradient = ["#0501fa","#0a02f5","#0f03f0","#1404eb","#1905e6","#1e06e1","#2307dc","#2808d7","#2d09d2","#320acd","#370bc8","#3c0cc3","#410dbe","#460eb9","#4b0fb4","#5010af","#5511aa","#5a12a5","#5f13a0","#64149b","#691596","#6e1691","#73178c","#781887","#7d1982","#821a7d","#871b78","#8c1c73","#911d6e","#961e69","#9b1f64","#a0205f","#a5215a","#aa2255","#af2350","#b4244b","#b92546","#be2641","#c3273c","#c82837","#cd2932","#d22a2d","#d72b28","#dc2c23","#e12d1e","#e62e19","#eb2f14","#f0300f","#f5310a","#fa3205"];
const fullScreenGradient = ["#0301fc","#0501fa","#0802f7","#0b02f4","#0d03f2","#1003ef","#1204ed","#1504ea","#1805e7","#1a05e5","#1d06e2","#2006df","#2207dd","#2507da","#2708d8","#2a08d5","#2d09d2","#2f09d0","#320acd","#350bca","#370bc8","#3a0cc5","#3c0cc3","#3f0dc0","#420dbd","#440ebb","#470eb8","#4a0fb5","#4c0fb3","#4f10b0","#5110ae","#5411ab","#5711a8","#5912a6","#5c12a3","#5f13a0","#61139e","#64149b","#671598","#691596","#6c1693","#6e1691","#71178e","#74178b","#761889","#791886","#7c1983","#7e1981","#811a7e","#831a7c","#861b79","#891b76","#8b1c74","#8e1c71","#911d6e","#931d6c","#961e69","#981e67","#9b1f64","#9e2061","#a0205f","#a3215c","#a62159","#a82257","#ab2254","#ae2351","#b0234f","#b3244c","#b5244a","#b82547","#bb2544","#bd2642","#c0263f","#c3273c","#c5273a","#c82837","#ca2835","#cd2932","#d02a2f","#d22a2d","#d52b2a","#d82b27","#da2c25","#dd2c22","#df2d20","#e22d1d","#e52e1a","#e72e18","#ea2f15","#ed2f12","#ef3010","#f2300d","#f4310b","#f73108","#fa3205","#fc3203"]
// from: https://codepen.io/BangEqual/pen/VLNowO
