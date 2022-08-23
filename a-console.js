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
      console.warn("triggering original geometry update, and then triggering console update");
      originalGeometryUpdate(oldData);
      this.update(this.data); // trigger console update any time geometry updates, in case pixel ratio changed.
    }).bind(this)    
  },
  changed(oldData, key) {
    return oldData[key] !== this.data[key];
  },
  update(oldData) {    
    if (this.data.fontFamily !== 'monospace') {
      console.warn('caution: a-console expects monospace fonts');
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
      console.warn("geometry or canvasprops update!", pixelRatio, geometryRatio)
      if (geometryRatio === pixelRatio || this.data.pixelRatioOverride) {
        this.canvas.setAttribute('height', this.data.canvasHeight);
      }
      else {
          const correctAspectRatioHeight = Math.round(this.data.canvasWidth * geometryRatio);
          console.log(`set canvas height to ${correctAspectRatioHeight}, because pixel width is ${this.data.canvasWidth} and geometry ratio h/w is ${geometryRatio}`)
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
    return new Promise((resolve, reject) => {
      let logoArray = AFrameLogo2.split("\n");
      logoArray.forEach((line,i) => {
        setTimeout( () => {
          this.writeToCanvas(line, logoGradient[i+8]);
          if (i+1 === logoArray.length) {
            setTimeout(() => {
              this.writeToCanvas('dev@aframe:~$', logoGradient[i+9]); resolve(); 
              let counter = 1; let up = true; let theLine = "";
              if (this.data.demo) setInterval(() => {
                if (fullScreenGradient[counter+1] && counter !== 0) {up ? counter++ : counter--} else {up = !up; up ? counter++ : counter--;} 
                theLine = theLine.length < 1000 ? theLine + JSON.stringify(new Date()) : JSON.stringify(new Date()); this.writeToCanvas(theLine, fullScreenGradient[counter])
              }, Math.random() * 150)
            }, 1000)
          }
        }, i*this.data.introLineDelay)
      })
    })
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
    console.error("reflow lines not yet finished being implemented, fix me")
    // used when font size or screen size changes, to recompute line breaks.
    // can also used when toggling all stack traces on/off, or when filtering
    this.lineQ = [];
    this.rawInputs.forEach(rawInput => {
      this.addTextToQ(rawInput.text, rawInput.color, rawInput.isStackTrace, true)
    });
    this.writeToCanvas();
  },
  grabAllLogs() {
    console.log(this.data,1)
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
      if (this.rawInputs.length > this.data.history) {
        this.rawInputs.shift();
      }
    }

    if (!isStackTrace || this.data.showStackTraces) {
      text.split('\n').forEach(newLine => {
        for (let i = 0; i < newLine.length / this.maxLineWidth; i++) {
          let maxLengthSegment = newLine.slice(i*this.maxLineWidth, (i*this.maxLineWidth) + this.maxLineWidth);
          this.lineQ.push([maxLengthSegment, color]);
          if (this.rawInputs.length > this.data.history) {
            this.lineQ.shift();
          }
        }
      })
    }
  },
  async logToCanvas (arrayOfArgs, color, hasStackTrace) {
    if (this.isPaused) return; // don't store logs while paused
    arrayOfArgs.forEach(async (arg, i) => {
      if (typeof arg !== "string") {
        try {
          arg = JSON.stringify(arg, null, 2);
        } catch(e) {
          arg = `<a-console error: unable to stringify argument: ${e.stack.split('\n')[0]}>`;
        }
      }
      await this.logoAnimation;
      this.writeToCanvas(arg, color, i === arrayOfArgs.length-1 ? hasStackTrace : false);
    });
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