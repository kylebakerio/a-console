# a-console
A better, canvas-based console for A-Frame.

<a href='https://ko-fi.com/kylev' target='_blank'><img height='35' style='border:0px;height:46px;' src='https://az743702.vo.msecnd.net/cdn/kofi3.png?v=0' border='0' alt='Buy Me a Coffee at ko-fi.com' /><a/>

## demo
https://canvas-log.glitch.me/

## how-to
Literally just add this line to your scene:
```html
<a-console position="0 1.5 -2"></a-console>
```

## options
**I always advise that you check the schema for up-to-date options**
```js
    // I recommend not touching these
    fontSize: {default: 18, type: 'number'},
    fontFamily: {default: 'monospace', type: 'string'},
    canvasWidth: {default: 1080, type: 'number'},
    canvasHeight: {default: 1920, type: 'number'},
    // but you can touch these:
    backgroundColor: {default: 'black', type: 'color'},
    textColor: {default: 'green', type: 'color'},
    captureConsole: {default: ['log','warn','error'], type: 'array'},
    capturedConsoleColors: {default: [null,'yellow','red'], type: 'array'},
    printStackTraceFor: {default: ['error'], type:'array'},
    captureConsoleActive: {default: true, type:'bool'},
```