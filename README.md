# Video MediaRecorder Polyfill

A MediaRecorder polyfill to capture video in browsers lacking [MediaRecorder], but having [getUserMedia] support.



```js
function dataAvailable (event) {
  const buf = event.data
  if (buf && buf instanceof Blob && buf.size !== 0) {
    /* buf is a Blob containing a jpeg or webp image */
  }
}
/* constraints may specify size and frame rate of video */
const constraints = { video: true }
navigator.mediaDevices.getUserMedia(constraints).then(stream => {
  const options = {
    mimeType: 'image/jpeg', /* or image/webp */
    videoBitsPerSecond: 125000, /* optional */
    pruneConsecutiveEqualFrames: false /* expensive when set to true */
  }
  const recorder = new MediaRecorder(stream, options)
  recorder.addEventListener('dataavailable', dataAvailable)
  recorder.start(10)
})
```



## Data types

Offers `image/jpeg` and `image/webp` encoded still images. They can be selected by the mimeType element of the options. Default is `image/jpeg`.

## Limitations

This polyfill tries to be MediaRecorder API compatible. But it still has a few small differences.

* Each time it raises its dataavailable event, it delivers the most recent camera capture image, rather than all the preceding ones. In that
sense it really isn't a recorder, but a capturere.

* It doesn't support the `ondataavailable` property. Use `addEventListener` instead.

* No audio. 

## Future

* Add webm encapsulation.
* Support `ondataavailable`.
* Pester the Safari team to stop messing around and finish their WebRTC media implementation.
* npm

## Credit

Thanks to Andrey Sitnik for his [audio-recorder-polyfill] work, which I copied.

[MediaRecorder]: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder

[getUserMedia]: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder

[audio-recorder-polyfill]: https://github.com/ai/audio-recorder-polyfill
