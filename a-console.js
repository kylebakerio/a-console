/* global AFRAME, THREE */

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
    // always in 'pixels'
    
    // specify how many console entries to store
    history: 'console.history',
    'capture-console': 'console.captureConsole',

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
    
    captureConsole: {default: ['log','warn','error'], type: 'array'}, // could also specify debug, info
    captureConsoleColors: {default: ["",'yellow','red'], type: 'array'},
    captureStackTraceFor: {default: ['error'], type:'array'},
    showStackTraces: {default: true, type:'bool'},
    
    skipIntroAnimation: {default: false, type: 'bool'},
    introLineDelay: {default: 75, type:'number'},
    keepLogo: {default: false, type:'bool'},
    demo: {default: false, type: 'bool'},
  },
  init() {
    // these two lines set up a second canvas used for measuring font width
    this.textSizeCanvas = document.createElement("canvas");
    this.textCanvasCtx = this.textSizeCanvas.getContext("2d");
    
    this.hookIntoGeometry();
    
    this.lineQ = []; // where we store processor lines of console output
    this.rawInputs = []; // where we store raw inputs (with some metadata) that we can reflow on console display updates
    
    this.canvas = document.createElement('canvas');
    this.canvas.id = "a-console-canvas"+Math.round(Math.random()*1000);
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.el.setAttribute('material', 'src', `#${this.canvas.id}`); // TODO: may need to set as ID of canvas instead, check that this works
    
    if (!this.data.skipIntroAnimation) this.logoAnimation = this.animateLogo();
    if (this.data.captureConsole) this.grabAllLogs();
  },
  pause() {
    this.isPaused = true;
  },
  play() {
    this.isPaused = false;
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
      await new Promise((resolve2, reject2) => {
        let logoLineLength = useLogo.split('\n')[2].length;
        let findFontInterval = setInterval(() => {
          if (this.maxLineWidth >= logoLineLength || this.data.fontSize == 1) {
            console.debug("hit correct font size for logo", this.el.id, this.data.fontSize, this.maxLineWidth, logoLineLength)
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
        setTimeout( () => {
          this.writeToCanvas(line, this.getNextGradientColor());
          if (i+1 === logoArray.length) {
            setTimeout(() => {
              if (!this.data.keepLogo) {
                console.debug("removing logo, restoring true font size");
                this.rawInputs = [{text:''}];
                this.lineQ = [''];
                this.el.setAttribute('console','fontSize',trueFontSize);
              }
              this.writeToCanvas('dev@aframe:~$', this.getNextGradientColor()); resolve(); 
              
              if (this.data.demo) {
                this.runDemo();
              }
            }, 1000)
          }
        }, i*this.data.introLineDelay)
      })
    })
  },
  getNextGradientColor:(() => {
    let counter = 1;
    let up = true;
    return function() {
      if (fullScreenGradient[counter+1] && counter !== 0) {
        up ? counter++ : counter--
      } else {
        up = !up; up ? counter++ : counter--;
      }
      return fullScreenGradient[counter];      
    } 
  })(),
  runDemo() {
    let theLine = "";
    this.demoInterval = setInterval(() => {
        theLine = theLine.length < 1000 ? 
          theLine + JSON.stringify(new Date()) : 
          JSON.stringify(new Date()); 
        this.writeToCanvas(theLine, this.getNextGradientColor())
    }, Math.random() * 150);
  },
  scroll() {
    // todo
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
  grabAllLogs() {
    for (let i = 0; i < this.data.captureConsole.length; i++) {
      const consoleComponent = this;
      const consoleFuncName = this.data.captureConsole[i];
      const consoleFuncColor = this.data.captureConsoleColors[i];
      const originalFn = console[consoleFuncName];
      console.debug(consoleFuncName, consoleFuncColor)
      
      console[consoleFuncName] = function() {
        originalFn(...arguments);
        
        if (consoleComponent.data.captureConsole) {
          const arrayOfArgs = [...arguments];
          let hasStackTrace = false;
          if (consoleComponent.data.captureStackTraceFor.includes(consoleFuncName)) {
            arrayOfArgs.push(new Error().stack);
            hasStackTrace = true;
          }
          consoleComponent.logToCanvas(arrayOfArgs,consoleFuncColor || consoleComponent.data.textColor, hasStackTrace);
        }
      };
    }
    // uncomment this line to fill up the console with timestamps
  },
  addTextToQ(text, color, isStackTrace, reflow) {
    if (!reflow) {
      this.rawInputs.push({
        text,
        color,
        isStackTrace
      });
    }

    if (!isStackTrace || this.data.showStackTraces) {
      text.split('\n').forEach(newLine => {
        for (let i = 0; i < newLine.length / this.maxLineWidth; i++) {
          let maxLengthSegment = newLine.slice(i*this.maxLineWidth, (i*this.maxLineWidth) + this.maxLineWidth);
          this.lineQ.push([maxLengthSegment, color]);
          
          if (!reflow && this.rawInputs.length > this.data.history) {
            this.lineQ.shift();
          }
        }
      })
    }

    if (!reflow && this.rawInputs.length > this.data.history) {
      this.rawInputs.shift();
    }
  },
  stringify(arg) {
    let output;
    try {
      output = JSON.stringify(arg, null, 2);
    } catch(e) {
      output = `<a-console error: unable to stringify argument: ${e.stack.split('\n')[0]}>`;
    }
    return output;
  },
  async logToCanvas(arrayOfArgs, color, hasStackTrace) {
    if (this.isPaused) return; // don't capture logs while paused
    let logString = "";
    arrayOfArgs.reduce((logString, arg, i) => {
      if (i === arrayOfArgs.length-1 && hasStackTrace) {
        return logString;
      }
      else if (typeof arg !== "string") {
        logString += this.stringify(arg);
      }
      else {
        logString += arg;
      }
    }, "");
    await this.logoAnimation; // capture logs during animation, but don't display until after animation
    this.writeToCanvas(logString, color, false);
    if (hasStackTrace) {
      this.writeToCanvas(arrayOfArgs[arrayOfArgs.length-1], color, true)
    }
  },
  writeToCanvas(text="", color=this.data.textColor, isStackTrace=false) {
    if (text) this.addTextToQ(text, color, isStackTrace, false);
    this.refreshBackground();
    this.ctx.font = `${this.data.fontSize}px ${this.data.fontFamily}`;
    
    for (let line = 0, i = this.lineQ.length > this.maxConsoleLines ? this.lineQ.length - this.maxConsoleLines : 0; 
         i < this.lineQ.length; 
         i++, line++) {
      this.ctx.fillStyle = this.lineQ[i][1];
      this.ctx.fillText(this.lineQ[i][0], this.xMargin, this.data.fontSize + this.data.fontSize*line);
    }

    this.material = this.el.getObject3D('mesh').material;
    if (this.material.map) this.material.map.needsUpdate = true;
  },
  refreshBackground() {
    let opacity = 1;
    this.ctx.globalAlpha = opacity;
    this.ctx.fillStyle = this.data.backgroundColor;
    this.ctx.fillRect(0, 0, this.data.canvasWidth, this.data.canvasHeight)
  }
});

const AFrameLogo1 = `PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP5PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP5YJ??YPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP5YJ???????PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPYJ???????????YPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP5~~????????????5PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP~Y?!???????????YGPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP!?PP!????????????#&&GPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP?!PPPJ!???????????5@@GPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPY~5PPPP!7???????????B#PPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPP5~YPPPPGP!????????????5PPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPP!JPGB#&&&J7???????????YPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPP7!G#&&&&&&#!????????????PPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPJJY55Y7!YJY5B#&&&&5!????????????J5JJY5PPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPP5!!YY7!~5PPY?!!?5B&&7????????????77!!Y5PPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPP5YJ?!!J?7~JY?7!!!!!~~!J?!????????????7!!JJ?JY5PPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPY?77777!!7777!!!!!!!777!!!~????????????77!!77777?YPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPP5Y?77777777777777!!7JY?!!~!????????????777777?Y5PPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPP5J?77777777777!~75?!!!~7????????77777?J5PPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPP5YJ?77777777!7?77!!!~????77777?JY5PPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPP5YJ?77777!!77777!77777?JY5PPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP5Y?777777777777?Y5PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP5J?7777?J5PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP5YY5PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP`

const AFrameLogo2 = `
                                                                                
           ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~:            
           :~~~~~~7?~~~~~~~~7???!~7?7?7~~~~?7~~~~J!~~!J~~~???7~~~~~:            
           :~~~~~!YY7~~~~~~~Y?~!~~Y?~~57~~7Y5!~~!PY~~YG7~!P!!!~~~~~:            
           :~~~~~57!P~~7??!~YY77~~YY?5?~~!5!?5~~?J?J???J~!P??!~~~~~:            
           :~~~~JY77JY~~~~~~Y7~~~~Y?~?Y!~5?77YJ~Y7~YY~75~!P!!!~~~~~:            
           :~~~~7~~~~7~~~~~~7!~~~~7!~~77!7~~~~7~7!~~~~~7~~????~~~~~:            
           :^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^:            
                                                                                
                                                                                
                                              .                                 
                                          .:^~~^          .^?P57:               
                                      ..^~~~~~~~.     .^?5BBBBBBBGY!:           
                                   .^~~~~~~~~~~~~   .YGBBBBBBBBBBBBBBGY!.       
                                :~~~~~~~~~~~~~~~~:  :PPPPGGBBBBBBBBBBBBBBGY^    
                               :^~~~~~~~~~~~~~~~~~   .^7YPPPPGGBBBBBBBBB#&&Y    
                              :??^~~~~~~~~~~~~~~~~:      .^7YPPPPGBB##&#BY~.    
                             .!55~~~~~~~~~~~~~~~~~~          .^?YPB#B5!.        
                            .~555J:~~~~~~~~~~~~~~~~^             .~:            
                            ^Y5555~^~~~~~~~~~~~~~~~~.                           
                           :JP5555Y:~~~~~~~~~~~~~~~~^                           
                          .7P555555!^~~~~~~~~~~~~~~~~.                          
                         .!5555555PP^~~~~~~~~~~~~~~~~~                          
                        .^5555PGB#&&Y^~~~~~~~~~~~~~~~~:                         
                        ^YPGB#&&&&&&#~~~~~~~~~~~~~~~~~~                         
                       :!G#&&&&&&&&&&P^~~~~~~~~~~~~~~~~:                        
             .^~:    ..!J77JPB&&&&&&&&!^~~~~~~~~~~~~~~~~.    :~^.               
             !!?Y?:^~^~5PP5Y?~!JG#&&&&G:~~~~~~~~~~~~~~~~!~^:~!7YY               
             ~~?YY!!^^YP5YJ7!~^^^^!YB&&57!~~~~~~~~~~~~~~~!!!~~!YY.              
          .:~~~7?7!~:?J7!~^^~~~~!7YPB##&#BGY7!~~~~~~~~~~~~!~~~!J?~:.            
      .:^~!!~~~!~~~~~!~~~~~~~7YPB############BPJ7~~~~~~~~~!!~~!~~~!!~~:.        
      :^~!!~~~~~~~~~~~~~~~~~~5GGB################B5?!~~~~~~!~~~~~~~!!~^:        
         .:^~!!~~~~~~~~~~~~~~Y555PGB##############&&&J~~~~~!!~~!!~^:.           
             .:~~!~~~~~~~~~~~!7?Y5PPPPGBB######&&&&@@J~~~~~!!~~:.               
                 .^~!!~~~~~~~~~~~!JY5555PPGB&&&@@&&B5!~!!!~^.                   
                    .:^~!!~~~~~~~~7~~!?J555B@&&BP?!~~!~^:.                      
                        .:~~!~~~~~~~~~~~!7?5PJ!~~!~~:.                          
                            .^~!!~~~~~~~~~~~~~!~^.                              
                               .:^~!!~~~~!!~^:.                                 
                                   .:~~~~:.                                     
                                                                                
                                                                                
                                                                                 `

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

// AFRAME.registerComponent('live-canvas', {
//   dependencies: ['geometry', 'material'],
//   schema: {
//     src: { type: "string", default: "#id"}
//   },
//   init() {
//     if (!document.querySelector(this.data.src)) {
//       console.error("no such canvas")
//       return
//     }
//     this.el.setAttribute('material',{src:this.data.src})
//   },
//   tick() {
//     var el = this.el;
//     var material;

//     material = el.getObject3D('mesh').material;
//     if (!material.map) { 
//       console.error("no material map")
//       this.el.removeAttribute('live-canvas')
//       return; 
//     }
//     material.map.needsUpdate = true;
//   }
// });