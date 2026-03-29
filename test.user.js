// ==UserScript==
// @name         Multiband Audio Compressor (Octave Bands, Dual Mono)
// @version      2.2
// @description  Extreme multiband compression - 1 band per octave, dual mono, ~flat output
// @author       nxbrnt
// @updateURL  https://github.com/nxbrnt/userscripts_public/raw/refs/heads/main/test.user.js
// @downloadURL  https://github.com/nxbrnt/userscripts_public/raw/refs/heads/main/test.user.js
// @match        https://m.twitch.tv/*
// @match        https://www.twitch.tv/*
// @match        https://m.youtube.com/*
// @match        https://www.youtube.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var ATTACK  = 0.001;
    var RELEASE = 0.07;
    var processedVideos = new WeakSet();

    // 10 octave bands spanning ~20 Hz – ~20 kHz.
    // Crossover edges (Hz): 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480
    // Centers = geometric mean of adjacent edges (Hz):
    //   sqrt(20*40)=28.3, sqrt(40*80)=56.6, ..., sqrt(10240*20480)=14480
    var BAND_CENTERS = [28.3, 56.6, 113, 226, 452, 905, 1810, 3620, 7240, 14480];

    // Q = sqrt(2) ≈ 1.414 produces exactly a 1-octave -3 dB bandwidth
    // for a 2nd-order bandpass BiquadFilter.
    var BAND_Q = Math.SQRT2;

    /**
     * Creates a single octave band: bandpass filter → compressor.
     * Returns { input: AudioNode, output: AudioNode }.
     */
    function createBand(ctx, centerHz) {
        var filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = centerHz;
        filter.Q.value = BAND_Q;

        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -100; // compress everything above the noise floor
        comp.ratio.value     = 20;   // effectively infinite — collapses dynamic range
        comp.attack.value    = ATTACK;
        comp.release.value   = RELEASE;
        comp.knee.value      = 0;    // hard knee

        filter.connect(comp);
        return { input: filter, output: comp };
    }

    /**
     * Builds a full mono channel strip:
     *   splitter[outputIndex] → 10 parallel band chains → sum node → limiter
     * Returns the limiter node (final output).
     */
    function buildChannelStrip(ctx, splitter, outputIndex) {
        // Each band receives the full mono channel and compresses independently.
        // Web Audio automatically sums multiple connections into the same input node.
        var sumNode = ctx.createGain();
        sumNode.gain.value = 1.0;

        BAND_CENTERS.forEach(function (center) {
            var band = createBand(ctx, center);
            splitter.connect(band.input, outputIndex, 0);
            band.output.connect(sumNode);
        });

        // Final brickwall limiter to catch any inter-band summation peaks.
        var limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1;
        limiter.ratio.value     = 20;
        limiter.attack.value    = 0.001;
        limiter.release.value   = 0.1;
        limiter.knee.value      = 0;

        sumNode.connect(limiter);
        return limiter;
    }

    function applyCompression(videoElement) {
        if (processedVideos.has(videoElement)) return;

        try {
            var ctx      = new (window.AudioContext || window.webkitAudioContext)();
            var source   = ctx.createMediaElementSource(videoElement);
            var splitter = ctx.createChannelSplitter(2);
            var merger   = ctx.createChannelMerger(2);

            source.connect(splitter);

            var outL = buildChannelStrip(ctx, splitter, 0); // left
            var outR = buildChannelStrip(ctx, splitter, 1); // right

            outL.connect(merger, 0, 0);
            outR.connect(merger, 0, 1);
            merger.connect(ctx.destination);

            processedVideos.add(videoElement);
            console.log('[Multiband Compressor] Applied to:', videoElement.src || videoElement);
        } catch (e) {
            console.error('[Multiband Compressor] Error:', e);
        }
    }

    function setupObserver() {
        // Process any videos already in the DOM.
        document.querySelectorAll('video').forEach(applyCompression);

        // Watch for dynamically added videos (Twitch loads the player asynchronously).
        new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeName === 'VIDEO') {
                        applyCompression(node);
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('video').forEach(applyCompression);
                    }
                });
            });
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) {
        setupObserver();
    } else {
        document.addEventListener('DOMContentLoaded', setupObserver);
    }

})();