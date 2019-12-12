'use strict'

window.MediaRecorder = (window.MediaRecorder && typeof window.MediaRecorder === 'function')
  ? MediaRecorder
  : (function () {
    console.log ('polyfilling MediaRecorder')

    function error (method) {
      var event = new Event ('error')
      event.data = new Error ('Wrong state for ' + method)
      return event
    }

    /**
     * fetch the current constraints
     * @param stream
     * @returns {*}
     */
    function getStreamConstraints (stream) {
      const tracks = stream.getVideoTracks ()
      if (!tracks || !tracks.length >= 1 || !tracks[0]) return null
      const track = tracks[0]
      return {
        settings: track.getSettings (),
        constraints: track.getConstraints (),
        capabilities: track.getCapabilities (),
        track: track,
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
     * var options = {mimeType: 'image/jpeg', videoBitsPerSecond: 125000}
     * navigator.mediaDevices.getUserMedia({ video: true }).then(function (stream) {
     *   var recorder = new MediaRecorder(stream, options )
     * })
     * @class
     */
    function MediaRecorder (stream, options) {

      if (options && typeof options.mimeType === 'string') {
        if (!MediaRecorder.isTypeSupported (options.mimeType)) {
          throw new Error ('NotSupportedError: mimeType ' + options.mimeType + ' unknown')
        }
        this.mimeType = options.mimeType
      }

      this.options = options
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
      this.em = document.createDocumentFragment ()

      this.videoElement = null
      this.canvasElement = null

      this.imageQuality = {
        current: 0.7,
        max: 0.9,
        min: 0.3,
        step: 0.02,
      }
    }

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
        if (this.state !== 'inactive') {
          return this.em.dispatchEvent (error ('start'))
        }


        this.constraints = getStreamConstraints (this.stream)
        var width = this.constraints.settings.width
        var height = this.constraints.settings.height
        var framerate = this.constraints.settings.frameRate
        this.millisecondsPerFrame = 1000.0 / framerate

        this.videoElement = document.createElement ('video')
        this.videoElement.autoplay = true
        this.videoElement.playsInline = true
        this.videoElement.style.width = width + 'px'
        this.videoElement.style.height = height + 'px'
        this.videoElement.srcObject = this.stream

        this.canvasElement = document.createElement ('canvas')
        this.canvasElementContext = this.canvasElement.getContext ('2d')

        this.state = 'recording'
        this.em.dispatchEvent (new Event ('start'))

        this.recentTime = null
        if (timeslice) {
          this.slicing = setInterval (function (mediaRecorder) {
            if (mediaRecorder.state === 'recording') mediaRecorder.requestData ()
          }, timeslice, this)
        }

        if (true) {
          /* try to figure out video timing */
          this.startWallTime = Date.now ()
          this.recentWallTime = Date.now ()
          this.recentVidTime = null

          this.monitoring = setInterval (function (mediaRecorder) {
            var nowWallTime = Date.now ()
            var elapsedWallTime = nowWallTime - mediaRecorder.startWallTime
            var deltaWallTime = nowWallTime - mediaRecorder.recentWallTime
            var elapsedVidTime = mediaRecorder.videoElement.currentTime * 1000
            if (!mediaRecorder.recentVidTime) mediaRecorder.recentVidTime = elapsedVidTime
            var deltaVidTime = elapsedVidTime - mediaRecorder.recentVidTime
            if (deltaVidTime > 0) {
              console.log ('                   ',
                           elapsedWallTime, deltaWallTime,
                           elapsedVidTime.toFixed (1),
                           deltaVidTime.toFixed (1),
                           mediaRecorder.millisecondsPerFrame.toFixed(1))
              mediaRecorder.recentWallTime = nowWallTime
              mediaRecorder.recentVidTime = elapsedVidTime
            }
          }, 1, this)
        }

        return undefined
      },
      /**
       * Stop media capture and raise final `dataavailable` event with recorded data.
       *
       * @return {undefined}
       *
       * @example
       * finishButton.addEventListener('click', function () {
       *   recorder.stop()
       * })
       */
      stop: function stop () {
        if (this.state === 'inactive') {
          return this.em.dispatchEvent (error ('stop'))
        }

        this.requestData ()
        this.state = 'inactive'
        if (this.slicing) clearInterval (this.slicing)
        if (this.monitoring) clearInterval (this.monitoring)
        delete this.slicing
        delete this.monitoring
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
          return this.em.dispatchEvent (error ('pause'))
        }

        this.state = 'paused'
        return this.em.dispatchEvent (new Event ('pause'))
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
          return this.em.dispatchEvent (error ('resume'))
        }

        this.state = 'recording'
        return this.em.dispatchEvent (new Event ('resume'))
      },

      /**
       * Raise a `dataavailable` event containing the captured media.
       *
       */
      requestData: function requestData () {
        if (this.state === 'inactive') {
          return this.em.dispatchEvent (error ('requestData'))
        }
        /* skip frames that haven't changed */
        var currentTime = this.videoElement.currentTime * 1000
        if (!this.recentTime) this.recentTime = currentTime
        var deltaTime = currentTime - this.recentTime
        /* no unchanged frames: using this relies on video capture frame rate setting, and accurate .currentTime */
        if (deltaTime <= 0) return
        /* no early frames. Relies on accurate .currentTime, but not accurate capture frame rate */
        //if (deltaTime <= this.millisecondsPerFrame) return (no early frames)
        this.recentTime = currentTime

        /* render the current frame to image */
        var width = this.videoElement.videoWidth
        var height = this.videoElement.videoHeight
        this.canvasElement.width = width
        this.canvasElement.height = height
        try {
          const start = Date.now ()
          this.canvasElementContext.drawImage (this.videoElement, 0, 0, width, height)
          const elapsed = Date.now () - start
        } catch (err) {
          console.error ('draw from video to canvas error', err)
          throw err
        }
        try {
          const mediaRecorder = this
          const start = Date.now ()
          this.canvasElement.toBlob (function (blob) {
            const elapsed = Date.now () - start
            var event = new Event ('dataavailable')
            event.data = blob
            event.deltaTime = deltaTime
            mediaRecorder.em.dispatchEvent (event)
            if (mediaRecorder.state === 'inactive') {
              mediaRecorder.em.dispatchEvent (new Event ('stop'))
            }
          }, this.mimeType, this.imageQuality.current)
        } catch (err) {
          console.error ('blob creation error', err)
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
        this.em.addEventListener.apply (this.em, arguments)
      },

      /**
       * Remove event listener.
       *
       * @param {"start"|"stop"|"pause"|"resume"|"dataavailable"|"error"}
       * type Event type.
       * @param {function} listener The same function used in `addEventListener`.
       *
       * @return {function}
       */
      removeEventListener: function removeEventListener () {
        return this.em.removeEventListener.apply (this.em, arguments)
      },

      /**
       * Calls each of the listeners registered for a given event.
       *
       * @param {Event} event The event object.
       *
       * @return {boolean} Is event was no canceled by any listener.
       */
      dispatchEvent: function dispatchEvent () {
        this.em.dispatchEvent.apply (this.em, arguments)
      },

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
      return /image\/jpeg?/.test (mimeType) || /image\/webp?/.test (mimeType)
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

    return MediaRecorder
  }) ()