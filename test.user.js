// ==UserScript==
// @name         Multiband Audio Compressor (LR4 Crossovers, Dual Mono)
// @version      3.0.1
// @description  Multiband compression with Linkwitz-Riley 4th-order crossovers, dual mono
// @author       nxbrnt
// @updateURL    https://github.com/nxbrnt/userscripts_public/raw/refs/heads/main/test.user.js
// @downloadURL  https://github.com/nxbrnt/userscripts_public/raw/refs/heads/main/test.user.js
// @match        https://m.twitch.tv/*
// @match        https://www.twitch.tv/*
// @match        https://m.youtube.com/*
// @match        https://www.youtube.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var ATTACK = 0.001;
    var RELEASE = 0.07;
    var processedVideos = new WeakSet();

    // 9 crossover frequencies (Hz) defining 10 bands:
    //   0–40, 40–80, 80–160, 160–320, 320–640,
    //   640–1280, 1280–2560, 2560–5120, 5120–10240, 10240+
    var CROSSOVERS = [40, 80, 160, 320, 640, 1280, 2560, 5120, 10240];

    // LR4 = two cascaded 2nd-order Butterworth filters at the same frequency.
    // Q = 1/√2 ≈ 0.707 for a 2nd-order Butterworth response.
    // At the crossover frequency each path is at −6 dB and in phase,
    // so LP + HP sums to flat magnitude.
    var LR4_Q = 1 / Math.SQRT2;

    function createLR4LP(ctx, freq) {
        var f1 = ctx.createBiquadFilter();
        f1.type = 'lowpass';
        f1.frequency.value = freq;
        f1.Q.value = LR4_Q;

        var f2 = ctx.createBiquadFilter();
        f2.type = 'lowpass';
        f2.frequency.value = freq;
        f2.Q.value = LR4_Q;

        f1.connect(f2);
        return { input: f1, output: f2 };
    }

    function createLR4HP(ctx, freq) {
        var f1 = ctx.createBiquadFilter();
        f1.type = 'highpass';
        f1.frequency.value = freq;
        f1.Q.value = LR4_Q;

        var f2 = ctx.createBiquadFilter();
        f2.type = 'highpass';
        f2.frequency.value = freq;
        f2.Q.value = LR4_Q;

        f1.connect(f2);
        return { input: f1, output: f2 };
    }

    /**
     * Recursively splits inputNode into bands using a binary tree of LR4
     * crossovers. Each leaf feeds a compressor. Returns an array of
     * compressor output nodes, one per band, in ascending frequency order.
     */
    function buildBandTree(ctx, inputNode, crossovers) {
        if (crossovers.length === 0) {
            var comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -100;
            comp.ratio.value = 20;
            comp.attack.value = ATTACK;
            comp.release.value = RELEASE;
            comp.knee.value = 0;
            inputNode.connect(comp);
            return [comp];
        }

        var mid = Math.floor(crossovers.length / 2);
        var freq = crossovers[mid];

        var lp = createLR4LP(ctx, freq);
        var hp = createLR4HP(ctx, freq);
        inputNode.connect(lp.input);
        inputNode.connect(hp.input);

        return buildBandTree(ctx, lp.output, crossovers.slice(0, mid)).concat(
            buildBandTree(ctx, hp.output, crossovers.slice(mid + 1))
        );
    }

    /**
     * Builds a full mono channel strip:
     *   splitter[outputIndex] → LR4 crossover tree → sum node → limiter
     * Returns the limiter node (final output).
     */
    function buildChannelStrip(ctx, splitter, outputIndex) {
        // Tap the mono channel into a gain node so the tree has a single
        // connectable input node.
        var tap = ctx.createGain();
        tap.gain.value = 1.0;
        splitter.connect(tap, outputIndex, 0);

        var sumNode = ctx.createGain();
        sumNode.gain.value = 1.0;

        buildBandTree(ctx, tap, CROSSOVERS).forEach(function (comp) {
            comp.connect(sumNode);
        });

        var limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1;
        limiter.ratio.value = 20;
        limiter.attack.value = ATTACK;
        limiter.release.value = 0.07;
        limiter.knee.value = 0;

        sumNode.connect(limiter);
        return limiter;
    }

    function applyCompression(videoElement) {
        if (processedVideos.has(videoElement)) return;

        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            var source = ctx.createMediaElementSource(videoElement);
            var splitter = ctx.createChannelSplitter(2);
            var merger = ctx.createChannelMerger(2);

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
        document.querySelectorAll('video').forEach(applyCompression);

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
