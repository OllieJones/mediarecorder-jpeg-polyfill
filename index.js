'use strict'
/* global Event */

window.MediaRecorder = (window.MediaRecorder && typeof window.MediaRecorder === 'function')
  ? window.MediaRecorder
  : (function () {
    console.log('polyfilling MediaRecorder')

    function error (method) {
      const event = new Event('error')
      event.data = new Error('Wrong state for ' + method)
      return event
    }

    /**
     * fetch the current constraints
     * @param stream
     * @returns {*}
     */
    function getStreamConstraints (stream) {
      const tracks = stream.getVideoTracks()
      if (!tracks || !tracks.length >= 1 || !tracks[0]) return null
      const track = tracks[0]
      return {
        settings: track.getSettings(),
        constraints: track.getConstraints(),
        capabilities: track.getCapabilities(),
        track: track
      }
    }

    /**
     * Motion JPEG MediaRecorder API polyfill.
     *
     * based on Andrey Sitnik's audio MediaRecorder polyfill
     * at https://github.com/ai/audio-recorder-polyfill
     *
     * @param {MediaStream} stream The video stream to record.
     *
     * @param {Object} options
     * @example
     * var options = {mimeType: 'image/jpeg', videoBitsPerSecond: 125000, pruneConsecutiveEqualFrames: false}
     * navigator.mediaDevices.getUserMedia({ video: true }).then(function (stream) {
     *   var recorder = new MediaRecorder(stream, options )
     * })
     * @class
     */
    function MediaRecorder (stream, options) {
      if (options && typeof options.mimeType === 'string') {
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          throw new Error('NotSupportedError: mimeType ' + options.mimeType + ' unknown')
        }
        this.mimeType = options.mimeType
      }

      // noinspection JSUnresolvedVariable
      this._pruneConsecutiveEqualFrames = options && options.pruneConsecutiveEqualFrames

      // noinspection JSUnresolvedVariable
      this._lookbackTime = options && typeof options.lookbackTime === 'number' ? options.lookbackTime : 1000
      /**
       * The `MediaStream` passed into the constructor.
       * @type {MediaStream}
       */
      this.stream = stream

      /**
       * The current state of recording process.
       * @type {"inactive"|"recording"|"paused"}
       */
      this.state = 'inactive'

      /* support for event delivery */
      this._em = document.createDocumentFragment()
      this._eventListenerCounts = []

      this._videoElement = null
      this._canvasElement = null
      this._canvasElementContext = null

      this._imageQuality = {
        current: 0.7,
        max: 0.9,
        min: 0.3,
        step: 0.02
      }

      this._history = new Queue()
      const videoBps = options && typeof options.videoBitsPerSecond === 'number' ? options.videoBitsPerSecond : 0
      const bps = options && typeof options.bitsPerSecond === 'number' ? options.bitsPerSecond : 0
      this._targetBitsPerSecond = (bps > videoBps) ? bps : videoBps
      if (this._targetBitsPerSecond <= 0) this._targetBitsPerSecond = 250000

      this._imagePending = false
      /**
       * Event handler when data is ready
       * @type {function}
       */
      this.ondataavailable = null
    }

    // noinspection JSUnusedGlobalSymbols
    MediaRecorder.prototype = {
      /**
       * The MIME type that is being used for recording.
       * @type {string}
       */
      mimeType: 'image/jpeg',

      /**
       * Begins recording media.
       *
       * @param {number} [timeslice] The milliseconds to record into each `Blob`.
       *
       * @return {boolean}
       *
       * @example
       * recordButton.addEventListener('click', function () {
       *   recorder.start(50)
       * })
       */
      start: function start (timeslice) {
        if (this._slicing) {
          clearInterval(this._slicing)
          delete this._slicing
          delete this._actualTimeSlice
        }
        if (this.state !== 'inactive') {
          return this._em.dispatchEvent(error('start'))
        }

        this._imagePending = false
        this.constraints = getStreamConstraints(this.stream)
        const width = this.constraints.settings.width
        const height = this.constraints.settings.height
        const framerate = this.constraints.settings.frameRate
        this.millisecondsPerFrame = 1000.0 / framerate

        this.previousBlobSize = -1

        this._videoElement = document.createElement('video')
        this._videoElement.autoplay = true
        this._videoElement.playsInline = true
        this._videoElement.style.width = width + 'px'
        this._videoElement.style.height = height + 'px'
        this._videoElement.srcObject = this.stream

        this._canvasElement = document.createElement('canvas')
        this._canvasElementContext = this._canvasElement.getContext('2d')

        this.state = 'recording'
        this._em.dispatchEvent(new Event('start'))

        if (timeslice) {
          const actualTimeSlice = (timeslice > this.millisecondsPerFrame) ? timeslice : this.millisecondsPerFrame
          this._actualTimeSlice = actualTimeSlice
          this._slicing = setInterval(function (mediaRecorder) {
            if (mediaRecorder.state === 'recording') mediaRecorder.requestData()
          }, actualTimeSlice, this)
        }

        return undefined
      },
      /**
       * Stop media capture and raise final `dataavailable` event with recorded data.
       *
       * @return {boolean}
       *
       * @example
       * finishButton.addEventListener('click', function () {
       *   recorder.stop()
       * })
       */
      stop: function stop () {
        if (this.state === 'inactive') {
          return this._em.dispatchEvent(error('stop'))
        }

        this.requestData()
        this.state = 'inactive'
        if (this._slicing) {
          clearInterval(this._slicing)
          delete this._slicing
          delete this._actualTimeSlice
        }
        this._imagePending = false
        return this._em.dispatchEvent(new Event('stop'))
      },

      /**
       * Pauses recording of media streams.
       *
       * @return {boolean}
       *
       * @example
       * pauseButton.addEventListener('click', function () {
       *   recorder.pause()
       * })
       */
      pause: function pause () {
        if (this.state !== 'recording') {
          return this._em.dispatchEvent(error('pause'))
        }

        this.state = 'paused'
        return this._em.dispatchEvent(new Event('pause'))
      },

      /**
       * Resumes media recording when it has been previously paused.
       *
       * @return {boolean}
       *
       * @example
       * resumeButton.addEventListener('click', function () {
       *   recorder.resume()
       * })
       */
      resume: function resume () {
        if (this.state !== 'paused') {
          return this._em.dispatchEvent(error('resume'))
        }

        this.state = 'recording'
        return this._em.dispatchEvent(new Event('resume'))
      },

      /**
       * Raise a `dataavailable` event containing the captured media.
       *
       */
      requestData: function requestData () {
        if (this.state === 'inactive') {
          return this._em.dispatchEvent(error('requestData'))
        }
        // noinspection JSUnresolvedVariable
        if (typeof this.ondataavailable !== 'function' && (this._eventListenerCounts.dataavailable || 0) <= 0) return
        if (this._imagePending) return
        this._imagePending = true
        /* render the current frame to image */
        const width = this._videoElement.videoWidth
        const height = this._videoElement.videoHeight
        this._canvasElement.width = width
        this._canvasElement.height = height
        try {
          this._canvasElementContext.drawImage(this._videoElement, 0, 0, width, height)
        } catch (err) {
          this._imagePending = false
          console.error('drawImage() error', err)
          throw err
        }
        try {
          const mediaRecorder = this
          const history = mediaRecorder._history
          let send = true
          this._canvasElement.toBlob(function (blob) {
            const now = Date.now()
            if (blob && blob.size > 0) {
              /* bitrate measurement and control */
              let old = history.peek()
              while (old && typeof old.timestamp === 'number' && old.timestamp <= now - mediaRecorder._lookbackTime) {
                /* remove older history */
                history.dequeue()
                old = history.peek()
              }
              if (old && typeof old.timestamp === 'number') {
                const timeDifference = now - old.timestamp
                let bitsPerSecond = 0
                if (timeDifference > 0) {
                  let byteSum = blob.size
                  for (const item of history) byteSum += item.size
                  /* bitrate over last items, inclusive of present item */
                  bitsPerSecond = 8000 * byteSum / timeDifference
                  /* if this item makes bitrate too large, suppress this item */
                  if (bitsPerSecond > mediaRecorder._targetBitsPerSecond) {
                    send = false
                    // console.log('suppressed frame sized', blob.size, bitsPerSecond, timeDifference)
                  }
                }
              }

              /* detection of unchanged frames */
              if (send && mediaRecorder._pruneConsecutiveEqualFrames && blob.size === mediaRecorder.previousBlobSize) {
                /* detection of unchanged frames; time-consuming and generally not necessary */
                if (mediaRecorder.previousBlobUrl) {
                  /* we can't see into blobs, so we'll use toDataURL to compare frames */
                  const url = mediaRecorder._canvasElement.toDataURL(mediaRecorder.mimeType, mediaRecorder._imageQuality.min)
                  if (url === mediaRecorder.previousBlobUrl) {
                    send = false
                  } else {
                    send = true
                    mediaRecorder.previousBlobUrl = url
                  }
                } else {
                  mediaRecorder.previousBlobUrl = mediaRecorder._canvasElement.toDataURL(mediaRecorder.mimeType, mediaRecorder._imageQuality.min)
                }
              }
              if (send) {
                history.enqueue({ timestamp: now, size: blob.size })
                const event = new Event('dataavailable')
                event.data = blob
                mediaRecorder._em.dispatchEvent(event)
                if (typeof mediaRecorder.ondataavailable === 'function') {
                  // noinspection JSValidateTypes
                  mediaRecorder.ondataavailable(event)
                }
                mediaRecorder.previousBlobSize = blob.size
              }
            }

            if (mediaRecorder.state === 'inactive') {
              mediaRecorder._em.dispatchEvent(new Event('stop'))
            }
            mediaRecorder._imagePending = false
          }, this.mimeType, this._imageQuality.current)
        } catch (err) {
          console.error('toBlob() error', err)
          throw err
        }
      },

      /**
       * Add listener for specified event type.
       *
       * @param {"start"|"stop"|"pause"|"resume"|"dataavailable"|"error"}
       * type Event type.
       * @param {function} listener The listener function.
       *
       * @return {undefined}
       *
       * @example
       * recorder.addEventListener('dataavailable', function (e) {
       *   audio.src = URL.createObjectURL(e.data)
       * })
       */
      addEventListener: function addEventListener () {
        const name = arguments[0]
        if (typeof name === 'string') {
          this._eventListenerCounts[name] = (typeof this._eventListenerCounts[name] === 'number')
            ? this._eventListenerCounts[name] + 1
            : 1
        }
        this._em.addEventListener.apply(this._em, arguments)
      },

      /**
       * Remove event listener.
       *
       * @param {"start"|"stop"|"pause"|"resume"|"dataavailable"|"error"}
       * type Event type.
       * @param {function} listener The same function used in `addEventListener`.
       *
       * @return {function} the removed function
       */
      removeEventListener: function removeEventListener () {
        const name = arguments[0]
        if (typeof name === 'string') {
          this._eventListenerCounts[name] = (typeof this._eventListenerCounts[name] === 'number')
            ? this._eventListenerCounts[name] - 1
            : 0
        }

        return this._em.removeEventListener.apply(this._em, arguments)
      },

      /**
       * Calls each of the listeners registered for a given event.
       *
       * @param {Event} event The event object.
       *
       * @return {boolean} Is event was no canceled by any listener.
       */
      dispatchEvent: function dispatchEvent () {
        this._em.dispatchEvent.apply(this._em, arguments)
      }

    }
    /**
     * Returns `true` if the MIME type specified is one the polyfill can record.
     *
     * This polyfill supports only `image/jpeg`.
     *
     * @param {string} mimeType The mimeType to check.
     *
     * @return {boolean} `true` on `image/jpeg` MIME type.
     */
    MediaRecorder.isTypeSupported = function isTypeSupported (mimeType) {
      return /image\/jpeg?/.test(mimeType) || /image\/webp?/.test(mimeType)
    }

    /**
     * `true` if MediaRecorder can not be polyfilled in the current browser.
     * @type {boolean}
     *
     * @example
     * if (MediaRecorder.notSupported) {
     *   showWarning('JPEG recording is not supported in this browser')
     * }
     */
    MediaRecorder.notSupported = !navigator.mediaDevices

    /** Creates a new queue. A queue is a first-in-first-out (FIFO) data structure -
     * items are added to the end of the queue and removed from the front.
     * A queue is iterable, from the oldest to the newest entry: from front to end.
     *     for ( const item of queue ) { }
     */
    class Queue {
      constructor () {
        // initialise the queue and offset
        this._queue = []
        this._offset = 0
      }

      /**
       * Get the current length of the queue
       * @returns {number} or 0 if the queue is empty.
       */
      size () {
        return (this._queue - this._offset)
      };

      /**
       * Get the current length of the queue
       * @returns {number} or 0 if the queue is empty.
       */
      getLength () {
        return (this._queue - this._offset)
      };

      /**
       * Detect whether a queue is empty
       * @returns {boolean} true if empty, false if not.
       */
      isEmpty () {
        return (this._queue.length === 0)
      };

      /**
       * Enqueues the specified item
       * @param item
       */
      enqueue (item) {
        this._queue.push(item)
      }

      /**
       * Removes the oldest item from the queue and returns it.
       * @returns queue item, or undefined if the queue is empty
       */
      dequeue () {
        // if the queue is empty, return immediately
        if (this._queue.length === 0) return undefined
        // store the item at the front of the queue
        const item = this._queue[this._offset]
        // increment the offset and remove the free space if necessary
        if (++this._offset * 2 >= this._queue.length) {
          this._queue = this._queue.slice(this._offset)
          this._offset = 0
        }
        // return the dequeued item
        return item
      }

      /**
       * Returns the item at the front of the queue (without dequeuing it).
       * @returns queue item, or undefined if the queue is empty
       */
      peek () {
        return (this._queue.length > 0 ? this._queue[this._offset] : undefined)
      };

      /**
       * Iterator allowing
       *      for (const item of queue) { }
       * Yields, space-efficiently, the elements of the queue from oldest to newest.
       * @returns {{next: next}}
       */
      [Symbol.iterator] () {
        let step = this._offset
        return {
          next: () => {
            if (this._queue.length <= step) return { value: undefined, done: true }
            return { value: this._queue[step++], done: false }
          }
        }
      }
    }

    return MediaRecorder
  })()
