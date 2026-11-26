(() => {
    if (window.__xdeckVideos) return;
    // Video and GIF files 𝕏 lists in its own API responses, by media key: the best MP4 of each.
    const videos = new Map();
    window.__xdeckVideos = videos;

    // The key is in both the poster image and the video file addresses:
    // ext_tw_video(_thumb)/ID/, amplify_video(_thumb)/ID/ and tweet_video(_thumb)/KEY for GIFs.
    const patterns = [
        new RegExp('(?:ext_tw_video|amplify_video)(?:_thumb)?/([0-9]+)/'),
        new RegExp('tweet_video(?:_thumb)?/([A-Za-z0-9_-]+)'),
    ];
    const keyFromUrl = (url) => {
        for (const pattern of patterns) {
            const match = (url || '').match(pattern);
            if (match) return match[1];
        }
        return null;
    };

    const remember = (media) => {
        const variants = ((media.video_info || {}).variants || []).filter(
            (variant) => variant.content_type === 'video/mp4' && variant.url
        );
        if (variants.length === 0) return;
        const best = variants.reduce((a, b) => ((b.bitrate || 0) > (a.bitrate || 0) ? b : a));
        const key = keyFromUrl(media.media_url_https) || keyFromUrl(best.url) || media.id_str;
        if (!key) return;
        // expanded_url is https://x.com/USER/status/ID/video/1: name the file after them.
        const parts = (media.expanded_url || '').split('/');
        const statusIndex = parts.indexOf('status');
        const name = statusIndex > 0 && parts[statusIndex + 1]
            ? parts[statusIndex - 1] + '-' + parts[statusIndex + 1]
            : key;
        videos.set(key, { url: best.url, name: name });
    };

    const scan = (value, depth) => {
        if (!value || typeof value !== 'object' || depth > 80) return;
        if (Array.isArray(value)) {
            value.forEach((item) => scan(item, depth + 1));
            return;
        }
        if (value.video_info && typeof value.video_info === 'object') remember(value);
        for (const key in value) {
            const child = value[key];
            if (child && typeof child === 'object') scan(child, depth + 1);
        }
    };

    let pending = false;
    const scheduleButtons = () => {
        if (pending) return;
        pending = true;
        setTimeout(() => {
            pending = false;
            addButtons();
        }, 300);
    };

    const inspectText = (text) => {
        if (typeof text !== 'string' || text.indexOf('video_info') === -1) return;
        try {
            scan(JSON.parse(text), 0);
        } catch (_) {}
        scheduleButtons();
    };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
        this.addEventListener('load', () => {
            try {
                if (this.responseType === '' || this.responseType === 'text') {
                    inspectText(this.responseText);
                } else if (this.responseType === 'json' && this.response) {
                    scan(this.response, 0);
                    scheduleButtons();
                }
            } catch (_) {}
        });
        return originalSend.apply(this, arguments);
    };
    const originalFetch = window.fetch;
    window.fetch = function () {
        return originalFetch.apply(this, arguments).then((response) => {
            try {
                const type = response.headers.get('content-type') || '';
                if (type.indexOf('json') !== -1) {
                    response.clone().text().then(inspectText).catch(() => {});
                }
            } catch (_) {}
            return response;
        });
    };

    const svgNamespace = 'http://www.w3.org/2000/svg';
    const makeIcon = () => {
        const svg = document.createElementNS(svgNamespace, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svgNamespace, 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('d', 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14');
        svg.appendChild(path);
        return svg;
    };

    const addButtons = () => {
        document.querySelectorAll('video').forEach((video) => {
            const key = keyFromUrl(video.getAttribute('poster')) || keyFromUrl(video.getAttribute('src'));
            const info = key ? videos.get(key) : null;
            const player = video.closest('[data-testid="videoPlayer"]') || video.parentElement;
            if (!info || !player || player.querySelector('.xdeck-download')) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'xdeck-download';
            button.title = 'Download video';
            button.setAttribute('aria-label', 'Download video');
            button.appendChild(makeIcon());
            // 𝕏 plays or opens the video on press; the button keeps its clicks to itself.
            ['pointerdown', 'mousedown', 'mouseup', 'touchstart'].forEach((type) => {
                button.addEventListener(type, (event) => event.stopPropagation(), true);
            });
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                button.classList.add('xdeck-downloading');
                setTimeout(() => button.classList.remove('xdeck-downloading'), 1500);
                const message = JSON.stringify({
                    type: 'downloadVideo',
                    body: JSON.stringify({ url: info.url, name: info.name }),
                });
                webkit.messageHandlers.handler.postMessage(message);
            }, true);
            if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
            player.appendChild(button);
        });
    };

    const start = () => {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = '.xdeck-download { position: absolute; top: 8px; right: 8px; z-index: 10; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: rgba(15, 20, 25, 0.75); color: #fff; cursor: pointer; opacity: 0.85; transition: opacity 0.15s, transform 0.15s; } .xdeck-download:hover { opacity: 1; transform: scale(1.06); } .xdeck-download:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; } .xdeck-download.xdeck-downloading { opacity: 0.45; }';
        document.head.appendChild(style);
        new MutationObserver(scheduleButtons).observe(document.body, { childList: true, subtree: true });
        scheduleButtons();
    };
    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start);
    }
})();
