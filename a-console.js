/* global AFRAME, THREE */

var extendDeep = AFRAME.utils.extendDeep;
var meshMixin = AFRAME.primitives.getMeshMixin();

AFRAME.registerPrimitive('a-console', extendDeep({}, meshMixin, {
  defaultComponents: {
    geometry: {primitive: 'plane',width:1080/1000,height:1920/1000, scale:'.5 .5 .5'},
    material: {side: 'double'},
    console: {},
  },

  mappings: {
    height: 'geometry.height',
    width: 'geometry.width',
    fontsize: 'console.fontSize',
    fontfamily: 'console.fontFamily',
    textcolor: 'console.textColor',
    backgroundcolor: 'console.backgroundColor',
    canvaswidth: 'console.canvasWidth',
    canvasheight: 'console.canvasHeight',
  }
}));



AFRAME.registerComponent('console', {
  dependencies: ['geometry', 'material'],
  schema: {
    fontSize: {default: 18, type: 'number'},
    fontFamily: {default: 'monospace', type: 'string'},
    textColor: {default: 'green', type: 'color'},
    backgroundColor: {default: 'black', type: 'color'},
    
    canvasWidth: {default: 1080, type: 'number'},
    canvasHeight: {default: 1920, type: 'number'},
    
    captureConsole: {default: ['log','warn','error'], type: 'array'},
    captureConsoleColors: {default: [null,'yellow','red'], type: 'array'},
    printStackTraceFor: {default: ['error'], type:'array'},
    captureConsoleActive: {default: true, type:'bool'},
    
    skipIntroAnimation: {default: false, type: 'bool'},
    introLineDelay: {default: 75, type:'number'},
  },
  async init() {
    this.canvas = document.createElement('canvas');
    this.lineQ = []; // where we store processor lines of console output
    this.rawInputs = []; // where we store raw inputs (with metadata)
    document.body.appendChild(this.canvas);
    this.canvas.id = "a-console-canvas"+Math.round(Math.random()*1000);
    this.ctx = this.canvas.getContext('2d');
    this.el.setAttribute('material', 'src', `#${this.canvas.id}`); // TODO: may need to set as ID of canvas instead, check that this works
    if (!this.data.skipIntroAnimation) await this.animateLogo();
    if (this.data.captureConsoleActive) this.grabAllLogs();
  },
  changed(oldData, key) {
    return oldData[key] !== this.data[key];
  },
  update(oldData) {
    if (this.data.fontSize !== 18 || 
        this.data.fontFamily !== 'monospace'
        ) {
      console.warn('currently built to rely on hardcoded defaults; changing these values may break stuff');
    }

    if (this.changed(oldData, 'fontSize') || this.changed(oldData, 'fontFamily')) {
      this.ctx.font = `${this.data.fontSize}px ${this.data.fontFamily}`;
    }
    // if (this.changed(oldData, 'textColor')) {
      // this.ctx.fillStyle = this.data.textColor;
    // }
    if (this.changed(oldData, 'canvasWidth') || this.changed(oldData, 'canvasHeight')) {
      this.canvas.setAttribute('width',this.data.canvasWidth);
      this.canvas.setAttribute('height',this.data.canvasHeight);
      
      if (this.data.canvasWidth !== 1080 ||
        this.data.canvasHeight !== 1920) {
          console.warn("canvas resizing not fully implemented");
      }
    }
    if (this.changed(oldData, 'backgroundColor')) {
      this.cleanBackground();
      this.writeToCanvas();
    }
  },
  async animateLogo() {
    return new Promise((resolve, reject) => {
      let logoArray = AFrameLogo2.split("\n");
      logoArray.forEach((line,i) => {
        setTimeout( () => {
          this.writeToCanvas(line, logoGradient[i+8]);
          if (i+1 === logoArray.length) {
            setTimeout(() => {this.writeToCanvas('dev@aframe:~$', logoGradient[i+9]); resolve()}, i*this.data.introLineDelay+100)
          }
        }, i*this.data.introLineDelay)
      })
    })
  },
  scroll() {
    // todo
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
        
        if (consoleComponent.data.captureConsoleActive) {
          let arrayOfArgs = [...arguments]
          if (consoleComponent.data.printStackTraceFor.includes(consoleFuncName)) {
            arrayOfArgs.push(new Error().stack);
          }
          consoleComponent.logToCanvas(arrayOfArgs,consoleFuncColor || consoleComponent.data.textColor);
        }
      };
    }
    // uncomment this line to fill up the console with timestamps
    // setInterval(() => {this.writeToCanvas(JSON.stringify(new Date()), logoGradient[Math.round(Math.random() * 40)])}, Math.random() * 700)
  },
  addTextToQ(text, color) {
    let maxLineWidth = 98; // todo: replace with calculation... can it be done?
    
    text.split('\n').forEach(newLine => {
      for (let i = 0; i < newLine.length / maxLineWidth; i++) {
        let maxLengthSegment = newLine.slice(i*maxLineWidth, (i*maxLineWidth) + maxLineWidth);
      }
      this.lineQ.push([newLine, color]);
    })
  },
  logToCanvas(arrayOfArgs, color) {
    arrayOfArgs.forEach(arg => {
      if (typeof arg !== "string") {
        try {
          arg = JSON.stringify(arg, null, 2);
        } catch(e) {
          arg = `<a-console error: unable to stringify argument: ${e.stack.split('\n')[0]}>`;
        }
      }
      this.writeToCanvas(arg, color);
    });
  },
  writeToCanvas(text="", color=this.data.textColor) {
    if (text) this.addTextToQ(text, color);
    this.cleanBackground();
    this.ctx.font = `${this.data.fontSize}px ${this.data.fontFamily}`;

    for (let line = 0, i = this.lineQ.length > 95 ? this.lineQ.length - 95 : 0; 
         i < this.lineQ.length; 
         i++, line++) {
      this.ctx.fillStyle = this.lineQ[i][1];
      this.ctx.fillText(this.lineQ[i][0], 10, 20 + 20*line);
    }

    this.material = this.el.getObject3D('mesh').material;
    if (this.material.map) this.material.map.needsUpdate = true;
  },
  cleanBackground() {
    let opacity = .9
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