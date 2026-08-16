// Startet die stummen Clips.
//
// Warum es das braucht: Die Seiten werden vom dc-Runtime über React gerendert,
// und dabei geht das `muted`-Attribut aus der Vorlage verloren. Ohne `muted`
// verweigern die Browser den Autostart, die Clips bleiben als Standbild stehen.
// Hier wird `muted` deshalb am Element selbst gesetzt und die Wiedergabe
// angestossen, sobald die Clips im DOM sind.
//
// Wer Bewegung abgestellt hat (prefers-reduced-motion), bekommt nichts davon:
// dann bleiben die Clips pausiert, und stil.css zeigt an ihrer Stelle das
// Standbild des Rahmens.
(function () {
  'use strict';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function start() {
    document.querySelectorAll('video[autoplay]').forEach(function (v) {
      v.muted = true;
      if (v.paused) v.play().catch(function () {});
    });
  }

  function beobachten() {
    start();
    // Das Runtime baut den Seiteninhalt erst nach dem Laden auf, deshalb noch
    // einmal nachfassen, sobald sich etwas am Baum ändert.
    new MutationObserver(start).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', beobachten);
  } else {
    beobachten();
  }
})();
