// Blendet die Inhaltsblöcke sanft ein, sobald sie beim Scrollen ins Bild
// kommen. Das Aussehen dazu steht in stil.css unter „Bewegung".
//
// Gesteuert wird über ein data-Attribut statt über eine Klasse, damit es nicht
// mit den Klassen kollidiert, die das dc-Runtime über React setzt. Versteckt
// wird nur, was dieses Skript selbst markiert hat: Läuft es nicht, bleibt die
// Seite einfach ohne Einblenden sichtbar.
//
// Wer Bewegung abgestellt hat (prefers-reduced-motion), bekommt nichts davon.
(function () {
  'use strict';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  // Kopfbild, Seitenkopf und Navigation haben ihren eigenen Auftritt in
  // stil.css und stehen deshalb nicht in dieser Liste.
  var ZIELE = [
    '.two > *',
    '.qs > *',
    '.termine > *',
    '.soft',
    '.deepblock',
    '.wrap:not(.pagehead) > .eyebrow',
    '.wrap > div:not([class])'
  ].join(',');
  // Versatz zwischen Blöcken, die im selben Moment ins Bild kommen, damit sie
  // nacheinander statt als Block erscheinen. Gedeckelt, sonst wartet der
  // sechste Termin spürbar.
  var STAFFEL = 90;
  var STAFFEL_MAX = 5;
  // Länger als Übergang plus größter Versatz in stil.css
  var AUFRAEUMEN = 1500;

  var markiert = new WeakSet();

  var io = new IntersectionObserver(function (eintraege) {
    var sichtbar = eintraege.filter(function (e) { return e.isIntersecting; });
    // In Leserichtung staffeln: erst von oben nach unten, dann von links
    sichtbar.sort(function (a, b) {
      return (a.boundingClientRect.top - b.boundingClientRect.top) ||
        (a.boundingClientRect.left - b.boundingClientRect.left);
    });
    sichtbar.forEach(function (e, i) {
      var el = e.target;
      io.unobserve(el);
      el.style.transitionDelay = Math.min(i, STAFFEL_MAX) * STAFFEL + 'ms';
      el.setAttribute('data-rv', 'in');
      // Danach das Attribut ganz entfernen, damit Hover-Übergänge im Block
      // wieder ohne den Einblend-Versatz laufen.
      setTimeout(function () {
        el.removeAttribute('data-rv');
        el.style.transitionDelay = '';
      }, AUFRAEUMEN);
    });
  }, { rootMargin: '0px 0px -8% 0px' });

  function markieren() {
    // Nur im gerenderten Bereich. Vorher steht der Inhalt noch als rohe
    // Vorlage in <x-dc>; markiert man die, liest das Runtime die Attribute
    // mit ein und nimmt sie beim nächsten Rendern wieder heraus.
    var wurzel = document.getElementById('dc-root');
    if (!wurzel) return;
    wurzel.querySelectorAll(ZIELE).forEach(function (el) {
      if (markiert.has(el)) return;
      markiert.add(el);
      // Liegt der Block in einem anderen, der schon einblendet, reicht das
      if (el.parentElement.closest('[data-rv]')) return;
      el.setAttribute('data-rv', 'wait');
      io.observe(el);
    });
  }

  function beobachten() {
    markieren();
    // Das Runtime baut den Seiteninhalt erst nach dem Laden auf. Der
    // MutationObserver meldet sich noch vor dem nächsten Zeichnen, deshalb
    // blitzt nichts kurz auf, bevor es versteckt wird.
    new MutationObserver(markieren).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', beobachten);
  } else {
    beobachten();
  }
})();
