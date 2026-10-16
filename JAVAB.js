// Variables globales
let isPlaying = false;
let currentSlide = 0;
let totalSlides = 0;

// ---------- Música de fondo (archivo propio: musica.mp3) ----------
// Plan A: elemento <audio>. Plan B (si el navegador o el visor lo bloquea):
// Web Audio API decodificando el archivo directamente. Ambos se arrancan dentro
// del mismo toque del botón, que es lo que exigen iPhone y Android.
const MUSIC_FILE = 'musica.mp3';
let musicMode = null;          // 'element' | 'webaudio'
let audioCtx = null, webSource = null, webBuffer = null, webGain = null;
let webStartedAt = 0, webOffset = 0, webPlaying = false;
let fallbackTimer = null;

function getAudio() { return document.getElementById('bgMusic'); }

function b64ToBytes(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function prepareAudioElement() {
    const a = getAudio();
    if (!a) return;
    if (window.__MUSIC_B64 && !a.src) {
        try {
            const blob = new Blob([b64ToBytes(window.__MUSIC_B64)], { type: 'audio/mpeg' });
            a.src = URL.createObjectURL(blob);
        } catch (e) {}
    } else if (!a.getAttribute('src')) {
        a.src = MUSIC_FILE;
    }
}
function getMusicBytes() {
    if (window.__MUSIC_B64) return Promise.resolve(b64ToBytes(window.__MUSIC_B64).buffer);
    return fetch(MUSIC_FILE).then(r => r.arrayBuffer());
}

function startWebAudio() {
    // Se crea/reanuda el contexto dentro del toque (desbloquea el audio);
    // la decodificación puede terminar después sin problema.
    try {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audioCtx = new AC();
            webGain = audioCtx.createGain();
            webGain.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        // sonido silencioso inmediato para "despertar" el audio en iOS
        const s = audioCtx.createBufferSource();
        s.buffer = audioCtx.createBuffer(1, 1, 22050);
        s.connect(audioCtx.destination); s.start(0);
    } catch (e) { return; }
    const go = () => {
        if (musicMode === 'element') return;
        musicMode = 'webaudio';
        playWebAudio();
    };
    if (webBuffer) { go(); return; }
    getMusicBytes()
        .then(buf => new Promise((res, rej) => audioCtx.decodeAudioData(buf, res, rej)))
        .then(b => { webBuffer = b; go(); })
        .catch(() => {});
}
function playWebAudio() {
    if (!audioCtx || !webBuffer) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    webSource = audioCtx.createBufferSource();
    webSource.buffer = webBuffer;
    webSource.loop = true;
    webSource.connect(webGain);
    webSource.start(0, webOffset % webBuffer.duration);
    webStartedAt = audioCtx.currentTime - webOffset;
    webPlaying = true; isPlaying = true; updateMusicIcon();
}
function pauseWebAudio() {
    if (!webSource) return;
    webOffset = audioCtx.currentTime - webStartedAt;
    try { webSource.stop(); } catch (e) {}
    webSource = null; webPlaying = false; isPlaying = false; updateMusicIcon();
}

function startMusic() {
    const audio = getAudio();
    const musicPlayer = document.getElementById('musicPlayer');
    if (musicPlayer) musicPlayer.style.display = 'block';

    // Plan B se prepara en el mismo toque, por si el Plan A falla
    startWebAudio();

    if (!audio) return;
    audio.muted = false;
    audio.volume = 1;
    let p;
    try { p = audio.play(); } catch (e) { p = Promise.reject(e); }
    const failA = () => { if (musicMode !== 'webaudio') { musicMode = null; } };
    if (p && typeof p.then === 'function') {
        p.then(() => {
            // Plan A sonando: apagar el Plan B si llegó a arrancar
            musicMode = 'element';
            if (webPlaying) { pauseWebAudio(); webOffset = 0; }
            isPlaying = true; updateMusicIcon();
        }).catch(failA);
    }
    // si en 2.5 s el <audio> no avanza, nos quedamos con Web Audio
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
        if (musicMode === 'element' && (audio.paused || audio.currentTime < 0.2)) {
            try { audio.pause(); } catch (e) {}
            musicMode = 'webaudio';
            if (webBuffer && !webPlaying) playWebAudio();
        }
    }, 2500);
}

function closeWelcome() {
    const modal = document.getElementById('welcomeModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}
function enterWithMusicClick() { closeWelcome(); startMusic(); }
function enterWithoutMusicClick() {
    closeWelcome();
    const musicPlayer = document.getElementById('musicPlayer');
    if (musicPlayer) musicPlayer.style.display = 'block';   // por si luego quiere activarla
    isPlaying = false; updateMusicIcon();
}
function enterInvitation() { enterWithMusicClick(); }

function toggleMusic() {
    const audio = getAudio();
    if (musicMode === 'webaudio') {
        if (webPlaying) pauseWebAudio(); else playWebAudio();
        return;
    }
    if (musicMode === 'element' && audio) {
        if (audio.paused) audio.play().catch(() => {}); else audio.pause();
        return;
    }
    // aún no ha sonado nada (entró sin música): arrancar ahora
    startMusic();
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    initializeCountdown();
    initializeCarousel();

    const modal = document.getElementById('welcomeModal');
    if (modal) modal.style.display = 'flex';

    const toggle = document.getElementById('musicToggle');
    if (toggle) toggle.addEventListener('click', toggleMusic);

    prepareAudioElement();
    const audio = getAudio();
    if (audio) {
        audio.addEventListener('playing', () => { if (musicMode !== 'webaudio') { musicMode = 'element'; isPlaying = true; updateMusicIcon(); } });
        audio.addEventListener('pause', () => { if (musicMode === 'element') { isPlaying = false; updateMusicIcon(); } });
        audio.addEventListener('error', () => {
            if (musicMode !== 'webaudio') { musicMode = 'webaudio'; if (webBuffer && !webPlaying) playWebAudio(); }
        });
    }
    // Si el usuario cambia de pestaña o bloquea el teléfono, pausar; al volver, continuar
    let resumeOnReturn = false;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            resumeOnReturn = isPlaying;
            if (musicMode === 'webaudio') pauseWebAudio(); else { const a = getAudio(); if (a) a.pause(); }
        } else if (resumeOnReturn) {
            if (musicMode === 'webaudio') playWebAudio(); else { const a = getAudio(); if (a) a.play().catch(() => {}); }
        }
    });
});

function updateMusicIcon() {
    const volumeIcon = document.getElementById('volumeIcon');
    
    if (volumeIcon) {
        if (isPlaying) {
            volumeIcon.innerHTML = `
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#fff" stroke="#fff" stroke-width="1"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.08" stroke="#fff" stroke-width="2"></path>
                <circle cx="6.5" cy="12" r="1" fill="#B9A3DA"/>
            `;
        } else {
            volumeIcon.innerHTML = `
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#fff" stroke="#fff" stroke-width="1"></polygon>
                <line x1="19" y1="9" x2="17" y2="11" stroke="#ff6b6b" stroke-width="2"></line>
                <line x1="17" y1="9" x2="19" y2="11" stroke="#ff6b6b" stroke-width="2"></line>
                <circle cx="6.5" cy="12" r="1" fill="#ff6b6b"/>
            `;
        }
    }
}

// Countdown
function initializeCountdown() {
    const targetDate = new Date('2026-12-20T16:00:00').getTime();
    
    function updateCountdown() {
        const now = new Date().getTime();
        const difference = targetDate - now;
        
        if (difference > 0) {
            const days = Math.floor(difference / (1000 * 60 * 60 * 24));
            const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((difference % (1000 * 60)) / 1000);
            
            document.getElementById('days').textContent = days.toString().padStart(2, '0');
            document.getElementById('hours').textContent = hours.toString().padStart(2, '0');
            document.getElementById('minutes').textContent = minutes.toString().padStart(2, '0');
            document.getElementById('seconds').textContent = seconds.toString().padStart(2, '0');
        } else {
            document.getElementById('days').textContent = '00';
            document.getElementById('hours').textContent = '00';
            document.getElementById('minutes').textContent = '00';
            document.getElementById('seconds').textContent = '00';
        }
    }
    
    updateCountdown();
    setInterval(updateCountdown, 1000);
}

// Carrusel
function initializeCarousel() {
    const track = document.getElementById('carouselTrack');
    const nextBtn = document.getElementById('nextBtn');
    const prevBtn = document.getElementById('prevBtn');

    if (!track) return;

    // calcular total dinámicamente
    const items = track.querySelectorAll('.carousel-item');
    totalSlides = items.length;
    const totalSlidesElement = document.getElementById('totalSlides');
    if (totalSlidesElement) totalSlidesElement.textContent = totalSlides;

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentSlide = (currentSlide + 1) % totalSlides;
            updateCarousel();
        });
    }
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
            updateCarousel();
        });
    }

    // Ajuste inicial para asegurar cálculo correcto tras el render
    updateCarousel();
    requestAnimationFrame(updateCarousel);
    setTimeout(updateCarousel, 200);

    // Auto-play del carrusel
    setInterval(() => {
        nextSlide();
    }, 2500);
}

function updateCarousel() {
    const track = document.getElementById('carouselTrack');
    if (track) {
        const items = track.querySelectorAll('.carousel-item');
        if (!items.length) return;
        const container = track.parentElement;

        // Temporarily reset transform to measure actual positions
        const previousTransform = track.style.transform;
        track.style.transform = 'none';

        const firstRect = items[0].getBoundingClientRect();
        const secondRect = items[1] ? items[1].getBoundingClientRect() : null;
        const stepWidth = Math.max(1, secondRect ? Math.round(secondRect.left - firstRect.left) : Math.round(firstRect.width));

        const containerWidth = Math.round(container.getBoundingClientRect().width);
        const visibleCount = Math.max(1, Math.floor((containerWidth + 1) / stepWidth));
        const maxIndex = Math.max(0, totalSlides - visibleCount);

        // Detecta si hay que dar la vuelta (de la última foto a la 1, o viceversa)
        let wrapped = false;
        if (currentSlide > maxIndex) { currentSlide = 0; wrapped = true; }
        if (currentSlide < 0) { currentSlide = maxIndex; wrapped = true; }

        const trackRect = track.getBoundingClientRect();
        const baseLeft = Math.round(firstRect.left - trackRect.left);
        const translateXpx = -Math.round(baseLeft + (currentSlide * stepWidth));

        if (wrapped) {
            // Al dar la vuelta, salta directo a la foto 1 sin animar el regreso
            // (evita el efecto de "devolverse" deslizando hacia atrás por todas las fotos)
            const prevTransition = track.style.transition;
            track.style.transition = 'none';
            track.style.transform = `translateX(${translateXpx}px)`;
            void track.offsetWidth; // fuerza reflow para aplicar el salto sin animación
            track.style.transition = prevTransition || '';
        } else {
            // Apply transform
            track.style.transform = `translateX(${translateXpx}px)`;
        }
        // console.log('Carousel moved to slide:', { currentSlide, visibleCount, maxIndex, translateXpx, stepWidth, baseLeft });
    }
    updateSlideCounter();
    markCenterCarouselItem();
}

function nextSlide() {
    currentSlide++;
    updateCarousel();
}

function previousSlide() {
    currentSlide--;
    updateCarousel();
}

function updateSlideCounter() {
    const currentSlideElement = document.getElementById('currentSlide');
    const totalSlidesElement = document.getElementById('totalSlides');
    if (currentSlideElement) currentSlideElement.textContent = (currentSlide + 1);
    if (totalSlidesElement) totalSlidesElement.textContent = totalSlides;
}

// Mark center carousel item on desktop
function markCenterCarouselItem() {
    const track = document.getElementById('carouselTrack');
    if (!track) return;
    const items = Array.from(track.querySelectorAll('.carousel-item'));
    if (!items.length) return;
    items.forEach(it => it.classList.remove('is-center'));

    const firstItem = items[0];
    const container = track.parentElement;
    const itemWidth = firstItem.getBoundingClientRect().width;
    const containerWidth = container.getBoundingClientRect().width;
    const visibleCount = Math.max(1, Math.floor(containerWidth / itemWidth));

    const centerIndex = (currentSlide + Math.floor(visibleCount / 2)) % items.length;
    items[centerIndex].classList.add('is-center');
}

// Hook into carousel updates
const _origUpdateCarousel = typeof updateCarousel === 'function' ? updateCarousel : null;
if (_origUpdateCarousel) {
    window.updateCarousel = function() {
        _origUpdateCarousel();
        markCenterCarouselItem();
    };
}

window.addEventListener('resize', markCenterCarouselItem);

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(markCenterCarouselItem, 200);
});

// Funciones de los botones
function openLocation(location) {
    // Casa del abogado Joaquín
    const mapsUrls = {
        ceremony: "https://maps.app.goo.gl/vC11VswoY4TNdrLw7",
        reception: "https://maps.app.goo.gl/vC11VswoY4TNdrLw7"
    };
    const mapsUrl = mapsUrls[location] || mapsUrls.ceremony;
    window.open(mapsUrl, '_blank');
}

// NOTA: esta es una plantilla de ejemplo. Reemplaza el contenido de estas
// funciones con tu propio enlace (Google Drive, Google Form, lista de
// regalos, etc.) cuando personalices la invitación.

function sharePhotos() {
    window.open('https://photos.app.goo.gl/CD3JMfxcuTyoF6ZR8', '_blank');
}

function showDressCode() {
    const modal = document.getElementById('dresscodeModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeDressCodeModal() {
    // El click dentro de la tarjeta del modal usa stopPropagation(), así que
    // esta función solo se dispara al hacer click en el fondo oscuro o en la X.
    const modal = document.getElementById('dresscodeModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showGifts() {
    window.open('https://cuentapro11.github.io/numero-cuenta-ejemplo/', '_blank');
}

function confirmAttendance() {
    window.open('https://docs.google.com/forms/d/e/1FAIpQLSd5L-s8Tl-NB-LVPgMBanpjb8LrRA0fNXRJ2WNmMoT4ozhP1A/viewform?usp=publish-editor', '_blank');
}

// Sistema de Toast
function showToast(title, message) {
    const toast = document.getElementById('toast');
    const toastContent = document.getElementById('toastContent');
    
    toastContent.innerHTML = `
        <h4 style="font-weight: 700; color: #fff; margin-bottom: 0.35rem; letter-spacing: 0.2px;">${title}</h4>
        <p style="color: #ddd;">${message}</p>
    `;
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// Nota: el efecto de portada ahora se logra 100% con CSS (hero fijo detrás
// del contenido, ver .hero-section y .content en CCSB.css), igual que en
// boda100L. Ya no hace falta mover nada por JS en el scroll.


// Forzar limpieza de caches en clientes antiguos
(function() {
  function clearCaches() {
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(reg => reg.unregister());
      }).catch(() => {});
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', clearCaches);
  } else {
    clearCaches();
  }
})();
