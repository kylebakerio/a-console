/* global AFRAME, THREE */

var extendDeep = AFRAME.utils.extendDeep;

// The mesh mixin provides common material properties for creating mesh-based primitives.
// This makes the material component a default component and maps all the base material properties.
var meshMixin = AFRAME.primitives.getMeshMixin();

AFRAME.registerPrimitive('a-console', extendDeep({}, meshMixin, {
  // Preset default components. These components and component properties will be attached to the entity out-of-the-box.
  defaultComponents: {
    geometry: {primitive: 'plane',width:1080/1000,height:1920/1000},
    material: {side: 'double'},
    console: {},
  },

  // Defined mappings from HTML attributes to component properties (using dots as delimiters).
  // If we set `width="5"` in HTML, then the primitive will automatically set `geometry="width: 5"`.
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

/*
  todo:
  handle scroll
  handle line breaks in input?
  grab console
  // todo: allow picking which of these, which colors, etc., probably via config obj 
  // todo: add filter option
  // todo: allow JSON stringify config setting
  // todo: store raw logs separately, to allow recompute for canvas size changes
  // todo: stacktrace storing, to allow toggle access (need grouped messages to do this)
*/

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
    capturedConsoleColors: {default: [null,'yellow','red'], type: 'array'},
    printStackTraceFor: {default: ['error'], type:'array'},
    captureConsoleActive: {default: true, type:'bool'},
  },
  init() {
    // this.plane = document.createElement('a-plane');
    this.canvas = document.createElement('canvas');
    this.lineQ = []; // where we store processor lines of console output
    this.rawInputs = []; // where we store raw inputs (with metadata)
    this.i = 0;
    // this.el.appendChild(this.plane)
    document.body.appendChild(this.canvas);
    this.canvas.id = "a-console-canvas"+Math.round(Math.random()*1000);
    // this.canvas.setAttribute('width',this.data.canvasWidth);
    // this.canvas.setAttribute('height',this.data.canvasHeight);
    this.ctx = this.canvas.getContext('2d');
    this.el.setAttribute('material', 'src', `#${this.canvas.id}`); // TODO: may need to set as ID of canvas instead, check that this works
    window.consoleEl = this.el; // debug
    this.grabAllLogs();
  },
  changed(oldData, key) {
    return oldData[key] !== this.data[key];
  },
  update(oldData) {
    if (this.data.fontSize !== 18 || 
        this.data.fontFamily !== 'monospace' || 
        this.canvasWidth !== 1080 ||
        this.canvasHeight !== 1920) {
      console.warn('currently built to rely on hardcoded defaults; changing these values may break stuff');
    }

    if (this.changed(oldData, 'fontSize') || this.changed(oldData, 'fontFamily')) {
      this.ctx.font = `${this.data.fontSize}px ${this.data.fontFamily}`;
    }
    if (this.changed(oldData, 'textColor')) {
      this.ctx.fillStyle = this.data.textColor;
    }
    if (this.changed(oldData, 'canvasWidth') || this.changed(oldData, 'canvasHeight')) {
      this.canvas.setAttribute('width',this.data.canvasWidth);
      this.canvas.setAttribute('height',this.data.canvasHeight);
    }
    if (this.changed(oldData, 'backgroundColor')) {
      console.warn("backgroundColor change wipes canvas, should only be set at init");
      this.cleanBackground();
    }
  },
  scroll() {
    // todo
  },
  grabAllLogs() {
    [['log'], ['warn','yellow'], ['error','red']].forEach(tuple => {
      const originalFn = console[tuple[0]];
      const consoleComponent = this;
      console[tuple[0]] = function() {
        originalFn(...arguments);
        
        if (consoleComponent.data.captureConsoleActive) {
          let arrayOfArgs = [...arguments]
          if (consoleComponent.data.printStackTraceFor.includes(tuple[0])) {
            arrayOfArgs.push(new Error().stack);
          }
          consoleComponent.logToCanvas(arrayOfArgs,tuple[1]);
        }
      };
    })
  },
  addTextToQ(text, color) {
    let maxLineWidth = 98; // todo: replace with calculation... can it be done?
    
    for (let i = 0; i < text.length / maxLineWidth; i++) {
      let maxLengthSegment = text.slice(i*maxLineWidth, (i*maxLineWidth) + maxLineWidth);
      
      // console.log(`splitting to ${maxLengthSegment}`);
      
      maxLengthSegment.split('\n').forEach(newLine => {
        this.lineQ.push([newLine, color]);
      })
    }
  },
  logToCanvas(arrayOfArgs, color) {
    arrayOfArgs.forEach(arg => {
      if (typeof arg !== "string") {
        try {
          arg = JSON.stringify(arg, null, 2);
        } catch(e) {
          arg = "<unable to stringify argument>";
        }
      }
      this.writeToCanvas(arg, color);
    });
  },
  writeToCanvas(text="", color=this.data.textColor) {
    if (text) this.addTextToQ(text, color);
    this.cleanBackground();
    this.ctx.font = `${this.data.fontSize}px ${this.data.fontFamily}`;

    for (let line = 0, i = this.lineQ.length > 64 ? this.lineQ.length - 64 : 0; 
         i < this.lineQ.length; 
         i++, line++) {
      // console.log(i)
      this.ctx.fillStyle = this.lineQ[i][1];
      this.ctx.fillText(this.lineQ[i][0], 10, 30 + 30*line);
    }

    this.material = this.el.getObject3D('mesh').material;
    if (this.material.map) this.material.map.needsUpdate = true;
  },
  cleanBackground() {
    let opacity = .9
    this.ctx.globalAlpha = opacity;
    this.ctx.fillStyle = this.data.backgroundColor;
    // ctx.filter = "blur(15px)"
    this.ctx.fillRect(0, 0, this.data.canvasWidth, this.data.canvasHeight)
  }
  
})

AFRAME.registerComponent('live-canvas', {
  dependencies: ['geometry', 'material'],
  schema: {
    src: { type: "string", default: "#id"}
  },
  init() {
    if (!document.querySelector(this.data.src)) {
      console.error("no such canvas")
      return
    }
    this.el.setAttribute('material',{src:this.data.src})
  },
  tick() {
    var el = this.el;
    var material;

    material = el.getObject3D('mesh').material;
    if (!material.map) { 
      console.error("no material map")
      this.el.removeAttribute('live-canvas')
      return; 
    }
    material.map.needsUpdate = true;
  }
});