# a-console
A better, canvas-based console for A-Frame. Currently in 'alpha', but should already be the best thing out there. 
- Prints to a virtual 1920x1080 screen vertically oriented. 
- Prints stack traces for errors. Handles line breaks and auto-scrolls on new input.
- Stringifies and pretty-prints objects that are console-logged. 
- Automatically handles newlines, and creates line breaks for lines over 98 chars as needed

<a href='https://ko-fi.com/kylev' target='_blank'><img height='35' style='border:0px;height:46px;' src='https://az743702.vo.msecnd.net/cdn/kofi3.png?v=0' border='0' alt='Buy Me a Coffee at ko-fi.com' /><a/>


![Screenshot from 2022-08-20 04-21-13](https://user-images.githubusercontent.com/6391152/185741660-0c40d8e8-563d-459a-bf41-1abfcc1b1560.png)



https://user-images.githubusercontent.com/6391152/185741975-a4cf08da-a521-46db-92f2-db312cac0163.mp4




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
  schema: {
    // I recommend you don't touch these
    fontSize: {default: 18, type: 'number'},
    fontFamily: {default: 'monospace', type: 'string'},
    canvasWidth: {default: 1080, type: 'number'},
    canvasHeight: {default: 1920, type: 'number'},
    
    textColor: {default: 'green', type: 'color'},
    backgroundColor: {default: 'black', type: 'color'},
    
    captureConsole: {default: ['log','warn','error'], type: 'array'},
    captureConsoleColors: {default: [null,'yellow','red'], type: 'array'},
    printStackTraceFor: {default: ['error'], type:'array'},
    captureConsoleActive: {default: true, type:'bool'},
    
    skipIntroAnimation: {default: false, type: 'bool'},
    introLineDelay: {default: 75, type:'number'},
  },
```

## roadmap
  - reflow text for custom terminal sizes 
  - ability to manually scroll, not just auto-scroll
  - inclusive/exclusive filter
  - allow JSON stringify custom settings
  - make stack traces toggle/revealable
  - keyboard for console input
  - `eval()` to run code on the fly from inside VR
