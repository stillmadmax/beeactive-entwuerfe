// Buchungslogik des Prototyps: Termine aus der Serienregel, Ausnahmen von
// Bine, Anmeldungen, Abmeldungen und der Admin-Teil. Alles rechnet im
// Browser und liegt in localStorage; verschickt wird nichts. Was verschickt
// würde, landet stattdessen im Postausgang und ist im Admin nachlesbar.
//
// Die Seiten halten keine Daten: jeder Aufruf liest den Speicher frisch und
// jede Änderung schreibt ihn sofort zurück. So überschreiben sich Admin und
// Anmeldeseite nicht, wenn beide offen sind, und die Aufrufe sehen schon so
// aus wie später gegen das PHP-Backend (siehe docs/buchungstool.md): die
// Seiten rufen termine(), anmelden(), abmelden() usw. und bekommen Antworten.
(function () {
  'use strict';

  var SPEICHER = 'beeactive.buchung.v1';
  var PERSON = 'beeactive.person';
  var MEINE = 'beeactive.meine';

  var MITTWOCH = 3;
  // Termine im Voraus: vier offen, vier zum Aufklappen (Bine, 2026-08-16)
  var WOCHEN = 8;
  // Anmeldeschluss: eine Stunde vor Beginn, bei 19:30 also 18:30 (Bine)
  var VORLAUF_MIN = 60;
  var ADRESSE = 'SOMOS, Lindwurmstraße 92A';
  var PAYPAL = 'beeactive@mailbox.org';

  var ORT_TEXT = { vorort: 'vor Ort', online: 'über Zoom' };
  var ZAHLWEG_TEXT = { paypal: 'PayPal', bar: 'bar vor Ort', wellpass: 'Wellpass' };

  var STANDARD = {
    serie: { uhrzeit: '19:30', dauer: 60, plaetze: 15, zoom: 'https://zoom.us/j/000000000?pwd=beispiel' },
    // Ausnahmen je Termin, Schlüssel ist das Datum als JJJJ-MM-TT:
    // { abgesagt, grund, voll, nurOnline, nurVorOrt, uhrzeit, plaetze }
    ausnahmen: {},
    anmeldungen: [],
    // Was verschickt worden wäre
    postausgang: []
  };

  // ---------- Speicher ----------

  function lesen(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function schreiben(key, wert) {
    try {
      window.localStorage.setItem(key, JSON.stringify(wert));
    } catch (e) {
      // Privater Modus oder voller Speicher: der Prototyp läuft dann ohne
      // Gedächtnis weiter, die Seite selbst bleibt benutzbar.
    }
  }

  function istObjekt(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  function zahl(x, sonst) {
    return typeof x === 'number' && isFinite(x) && x > 0 ? x : sonst;
  }

  // Liest den Speicher und sortiert aus, was nicht hineingehört. Ein kaputter
  // Eintrag darf nicht beide Seiten lahmlegen, denn der Knopf zum
  // Zurücksetzen steht auf einer davon.
  function laden() {
    var s = lesen(SPEICHER);
    if (!istObjekt(s)) s = {};
    var serie = istObjekt(s.serie) ? s.serie : {};
    return {
      serie: {
        uhrzeit: /^\d\d:\d\d$/.test(serie.uhrzeit) ? serie.uhrzeit : STANDARD.serie.uhrzeit,
        dauer: zahl(serie.dauer, STANDARD.serie.dauer),
        plaetze: zahl(serie.plaetze, STANDARD.serie.plaetze),
        zoom: typeof serie.zoom === 'string' ? serie.zoom : STANDARD.serie.zoom
      },
      ausnahmen: istObjekt(s.ausnahmen) ? s.ausnahmen : {},
      anmeldungen: (Array.isArray(s.anmeldungen) ? s.anmeldungen : []).filter(function (a) {
        return istObjekt(a) && typeof a.termin === 'string' && typeof a.mail === 'string';
      }),
      postausgang: (Array.isArray(s.postausgang) ? s.postausgang : []).filter(istObjekt)
    };
  }

  // Jede Änderung: frisch lesen, ändern, sofort schreiben
  function aendern(fn) {
    var store = laden();
    var r = fn(store);
    schreiben(SPEICHER, store);
    return r;
  }

  function zuruecksetzen() {
    try {
      window.localStorage.removeItem(SPEICHER);
      window.localStorage.removeItem(MEINE);
    } catch (e) {}
  }

  // Name und Mail des Browsers, damit Stammgäste nur beim ersten Mal tippen
  function personLesen() {
    var p = lesen(PERSON);
    return istObjekt(p) ? { name: String(p.name || ''), mail: String(p.mail || '') } : { name: '', mail: '' };
  }

  function personMerken(name, mail) {
    schreiben(PERSON, { name: name, mail: mail });
  }

  // Tokens der Anmeldungen aus diesem Browser. Nur im Prototyp nötig: in der
  // gebauten Seite steht der Abmeldelink in der Bestätigungsmail.
  function meineLesen() {
    var t = lesen(MEINE);
    return Array.isArray(t) ? t.filter(function (x) { return typeof x === 'string'; }) : [];
  }

  function meineMerken(token) {
    var t = meineLesen();
    if (t.indexOf(token) < 0) t.push(token);
    schreiben(MEINE, t);
  }

  // ---------- Datum ----------

  function nullUhr(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function zweistellig(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function tagKey(d) {
    return d.getFullYear() + '-' + zweistellig(d.getMonth() + 1) + '-' + zweistellig(d.getDate());
  }

  function ausKey(key) {
    var t = String(key).split('-');
    return new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
  }

  function plusTage(d, n) {
    var e = new Date(d);
    e.setDate(e.getDate() + n);
    return e;
  }

  function plusMinuten(d, n) {
    return new Date(d.getTime() + n * 60000);
  }

  // Datum plus Uhrzeit "HH:MM" als Zeitpunkt
  function zeitpunkt(key, uhrzeit) {
    var d = ausKey(key);
    var t = uhrzeit.split(':');
    d.setHours(Number(t[0]), Number(t[1]), 0, 0);
    return d;
  }

  function uhrzeitText(d) {
    return zweistellig(d.getHours()) + ':' + zweistellig(d.getMinutes());
  }

  // Nur für Texte, die keine Datumsrechnung brauchen (Anmeldeschluss der
  // Serie). Läuft über Mitternacht sauber durch.
  function uhrzeitPlus(uhrzeit, minuten) {
    var t = uhrzeit.split(':');
    var m = Number(t[0]) * 60 + Number(t[1]) + minuten;
    m = ((m % 1440) + 1440) % 1440;
    return zweistellig(Math.floor(m / 60)) + ':' + zweistellig(m % 60);
  }

  function datumLang(key) {
    return ausKey(key).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function datumKurz(key) {
    return ausKey(key).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  }

  // Der nächste Mittwoch ab einem Tag, der Tag selbst eingeschlossen
  function naechsterMittwoch(tag) {
    return plusTage(tag, (MITTWOCH - tag.getDay() + 7) % 7);
  }

  // Jetzt, im Prototyp per ?jetzt=2026-10-14T18:45 verstellbar, um den
  // Anmeldeschluss und den Kurstag zu prüfen, ohne auf Mittwoch zu warten.
  function jetzt() {
    try {
      var p = new URLSearchParams(window.location.search).get('jetzt');
      if (p) {
        var d = new Date(p);
        if (!isNaN(d.getTime())) return d;
      }
    } catch (e) {}
    return new Date();
  }

  // ---------- Termine ----------

  function aktiveIm(store, key) {
    return store.anmeldungen.filter(function (a) {
      return a.termin === key && !a.storniertAm;
    });
  }

  function aktive(key) {
    return aktiveIm(laden(), key);
  }

  // Ein Termin mit allem, was Seite und Admin über ihn wissen müssen
  function terminAus(store, key, wann) {
    var s = store.serie;
    var x = istObjekt(store.ausnahmen[key]) ? store.ausnahmen[key] : {};
    var uhrzeit = /^\d\d:\d\d$/.test(x.uhrzeit) ? x.uhrzeit : s.uhrzeit;
    var plaetze = zahl(x.plaetze, s.plaetze);
    var liste = aktiveIm(store, key);
    var vorOrt = liste.filter(function (a) { return a.ort === 'vorort'; }).length;
    var online = liste.length - vorOrt;
    var abgesagt = !!x.abgesagt;
    // Ausgebucht heißt immer nur vor Ort, über Zoom gibt es keine Platzgrenze
    var voll = !!x.voll || vorOrt >= plaetze;
    var vorOrtMoeglich = !abgesagt && !x.nurOnline && !voll;
    var onlineMoeglich = !abgesagt && !x.nurVorOrt;
    var beginn = zeitpunkt(key, uhrzeit);
    var schluss = plusMinuten(beginn, -VORLAUF_MIN);
    var ende = plusMinuten(beginn, s.dauer);
    var geschlossen = wann >= schluss;

    var status, statusCls, wo, cls;
    var zeit = uhrzeit + '–' + uhrzeitText(ende);
    if (abgesagt) {
      status = 'Abgesagt'; statusCls = 'aus'; cls = 'is-off';
      wo = 'Fällt aus' + (x.grund ? ', ' + x.grund : '');
    } else if (voll && onlineMoeglich) {
      status = 'Nur noch online'; statusCls = 'voll'; cls = 'is-online';
      wo = zeit + ' · Vor Ort ausgebucht, über Zoom ist noch Platz';
    } else if (voll) {
      status = 'Ausgebucht'; statusCls = 'aus'; cls = 'is-off';
      wo = zeit + ' · Vor Ort ausgebucht, diesmal ohne Zoom';
    } else if (x.nurOnline) {
      status = 'Nur online'; statusCls = 'voll'; cls = 'is-online';
      wo = zeit + ' · Diesmal nur über Zoom';
    } else if (x.nurVorOrt) {
      status = 'Nur vor Ort'; statusCls = 'voll'; cls = 'is-online';
      wo = zeit + ' · ' + ADRESSE + ' · diesmal ohne Zoom';
    } else {
      status = 'Platz frei'; statusCls = 'frei'; cls = '';
      wo = zeit + ' · ' + ADRESSE + ' · auch per Zoom';
    }

    return {
      key: key,
      uhrzeit: uhrzeit,
      ende: uhrzeitText(ende),
      schlussText: uhrzeitText(schluss),
      plaetze: plaetze,
      abgesagt: abgesagt,
      manuellVoll: !!x.voll,
      nurOnline: !!x.nurOnline,
      nurVorOrt: !!x.nurVorOrt,
      vorOrt: vorOrt,
      online: online,
      voll: voll,
      vorOrtMoeglich: vorOrtMoeglich,
      onlineMoeglich: onlineMoeglich,
      geschlossen: geschlossen,
      begonnen: wann >= beginn,
      vorbei: wann >= ende,
      buchbar: !geschlossen && (vorOrtMoeglich || onlineMoeglich),
      lang: datumLang(key),
      kurz: datumKurz(key),
      status: status,
      statusCls: statusCls,
      cls: cls,
      wo: wo
    };
  }

  function termin(key, wann) {
    return terminAus(laden(), key, wann || jetzt());
  }

  // Die acht Mittwoche, die öffentlich angeboten werden. Der erste ist der
  // nächste Mittwoch, dessen Anmeldeschluss noch nicht vorbei ist.
  function termineAus(store, wann) {
    var erster = naechsterMittwoch(nullUhr(wann));
    if (terminAus(store, tagKey(erster), wann).geschlossen) erster = plusTage(erster, 7);
    var liste = [];
    for (var i = 0; i < WOCHEN; i++) {
      liste.push(terminAus(store, tagKey(plusTage(erster, i * 7)), wann));
    }
    return liste;
  }

  function termine(wann) {
    return termineAus(laden(), wann || jetzt());
  }

  // Für den Admin: der letzte Mittwoch dazu, damit Bine nach der Stunde noch
  // die Haken setzen kann, dann die kommenden.
  function adminTermine(wann) {
    wann = wann || jetzt();
    var store = laden();
    var erster = plusTage(naechsterMittwoch(nullUhr(wann)), -7);
    var liste = [];
    for (var i = 0; i < WOCHEN + 2; i++) {
      liste.push(terminAus(store, tagKey(plusTage(erster, i * 7)), wann));
    }
    return liste;
  }

  // Wie ein Termin angesprochen wird: „Heute, Mittwoch, 14. Oktober“ am
  // Kurstag, „Diesen Mittwoch“ in den sechs Tagen davor, „Nächsten Mittwoch“,
  // wenn der heutige nach dem Anmeldeschluss schon aus der Liste ist. Alles
  // weiter Entfernte heißt nur „Mittwoch, Datum“.
  function bezeichnung(t, wann) {
    wann = wann || jetzt();
    var tage = Math.round((ausKey(t.key) - nullUhr(wann)) / 86400000);
    var datum = t.lang.replace(/^Mittwoch, /, '');
    if (tage === 0) return 'Heute, Mittwoch, ' + datum;
    if (tage < 7) return 'Diesen Mittwoch, ' + datum;
    if (tage === 7) return 'Nächsten Mittwoch, ' + datum;
    return 'Mittwoch, ' + datum;
  }

  // Für den Abschluss-Block auf Start- und Angebotsseite: derselbe Mittwoch,
  // den das Formular vorauswählt, mit seiner Uhrzeit
  function naechsterText() {
    var t = termine().filter(function (x) { return x.buchbar; })[0];
    return t ? bezeichnung(t) + ', ' + t.uhrzeit + ' Uhr' : 'Mittwochs, ' + serie().uhrzeit + ' Uhr';
  }

  function serie() {
    var s = laden().serie;
    s.schluss = uhrzeitPlus(s.uhrzeit, -VORLAUF_MIN);
    return s;
  }

  // Was an einem Termin wirklich geht: Vor Ort fällt weg, wenn ausgebucht
  // oder nur Zoom; über Zoom gilt nur PayPal, Wellpass und bar gibt es nur
  // vor Ort (Bine, 2026-08-16).
  function wirksam(t, ort, zahlweg) {
    if (t) {
      if (ort === 'vorort' && !t.vorOrtMoeglich) ort = 'online';
      if (ort === 'online' && !t.onlineMoeglich) ort = 'vorort';
    }
    if (ort === 'online') zahlweg = 'paypal';
    return { ort: ort, zahlweg: zahlweg };
  }

  // ---------- Anmelden und Abmelden ----------

  function token() {
    var a = new Uint8Array(12);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(a);
    } else {
      for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }

  function mailGueltig(mail) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail);
  }

  function post(store, an, betreff) {
    store.postausgang.unshift({ zeit: new Date().toISOString(), an: an, betreff: betreff });
    store.postausgang = store.postausgang.slice(0, 30);
  }

  function suchenIn(store, feld, wert) {
    for (var i = 0; i < store.anmeldungen.length; i++) {
      if (store.anmeldungen[i][feld] === wert) return store.anmeldungen[i];
    }
    return null;
  }

  function suchen(tokenOderId) {
    var store = laden();
    return suchenIn(store, 'token', tokenOderId) || suchenIn(store, 'id', tokenOderId);
  }

  // eingabe: { termin, name, mail, ort: 'vorort'|'online',
  //            zahlweg: 'paypal'|'bar'|'wellpass', honig }
  // admin: Bine trägt jemanden nach. Dann gilt kein Anmeldeschluss, und ein
  // von Hand gesetztes „ausgebucht“ gilt nicht für sie, nur die Platzzahl.
  function anmelden(eingabe, admin) {
    var wann = jetzt();
    // Honigtopf: ein Bot, der das unsichtbare Feld füllt, bekommt keinen
    // Eintrag. Die Meldung ist für den seltenen Menschen, dessen Browser das
    // Feld ausgefüllt hat, sonst stünde er vor einem toten Knopf.
    if (eingabe.honig) return { ok: false, fehler: 'Das hat nicht geklappt. Schreib mir kurz an ' + PAYPAL + ', dann trage ich dich ein.' };

    var name = String(eingabe.name || '').trim();
    var mail = String(eingabe.mail || '').trim().toLowerCase();
    if (!name) return { ok: false, feld: 'name', fehler: 'Wie soll ich dich nennen? Der Name fehlt noch.' };
    if (!mailGueltig(mail)) return { ok: false, feld: 'mail', fehler: 'Die Mailadresse sieht nicht vollständig aus.' };
    if (eingabe.ort !== 'vorort' && eingabe.ort !== 'online') return { ok: false, fehler: 'Vor Ort oder online?' };
    if (['paypal', 'bar', 'wellpass'].indexOf(eingabe.zahlweg) < 0) return { ok: false, fehler: 'Wie zahlst du?' };
    if (!/^\d{4}-\d\d-\d\d$/.test(String(eingabe.termin))) return { ok: false, fehler: 'Welcher Mittwoch?' };

    return aendern(function (store) {
      var t = terminAus(store, eingabe.termin, wann);
      if (t.abgesagt) return { ok: false, fehler: 'Dieser Mittwoch fällt aus.' };
      if (!admin && t.geschlossen) {
        var naechster = termineAus(store, wann)[0];
        return { ok: false, fehler: 'Für ' + t.lang + ' ist die Anmeldung seit ' + t.schlussText + ' Uhr geschlossen.' + (naechster ? ' Der nächste Mittwoch ist der ' + naechster.kurz : '') };
      }
      var angeboten = termineAus(store, wann).some(function (x) { return x.key === t.key; });
      if (!admin && !angeboten) return { ok: false, fehler: 'Diesen Mittwoch kannst du noch nicht buchen.' };
      var vorOrtOk = admin ? !t.nurOnline && t.vorOrt < t.plaetze : t.vorOrtMoeglich;
      if (eingabe.ort === 'vorort' && !vorOrtOk) {
        return { ok: false, fehler: t.onlineMoeglich ? 'Vor Ort ist dieser Mittwoch voll. Über Zoom ist noch Platz.' : 'Vor Ort ist dieser Mittwoch voll.' };
      }
      if (eingabe.ort === 'online' && !t.onlineMoeglich) return { ok: false, fehler: 'Diesen Mittwoch gibt es keinen Zoom.' };
      if (eingabe.ort === 'online' && eingabe.zahlweg !== 'paypal') return { ok: false, fehler: 'Über Zoom geht nur PayPal.' };

      var doppelt = aktiveIm(store, t.key).some(function (a) { return a.mail === mail; });
      if (doppelt) return { ok: false, feld: 'mail', fehler: 'Mit dieser Mailadresse bist du für diesen Mittwoch schon angemeldet.' };

      var a = {
        id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        token: token(),
        termin: t.key,
        name: name,
        mail: mail,
        ort: eingabe.ort,
        zahlweg: eingabe.zahlweg,
        bezahlt: false,
        angemeldetAm: new Date().toISOString(),
        storniertAm: null,
        vonBine: !!admin
      };
      store.anmeldungen.push(a);
      // Wer nachträglich für eine vergangene Stunde eingetragen wird, braucht
      // keine Bestätigung mehr
      if (!(admin && t.vorbei)) post(store, mail, 'Deine Anmeldung für ' + t.lang);
      return { ok: true, anmeldung: a, termin: terminAus(store, t.key, wann) };
    });
  }

  // vonBine: Austragen im Admin, dann geht keine Abmeldebestätigung raus
  function abmelden(tokenOderId, vonBine) {
    var wann = jetzt();
    return aendern(function (store) {
      var a = suchenIn(store, 'token', tokenOderId) || suchenIn(store, 'id', tokenOderId);
      if (!a) return { ok: false, fehler: 'unbekannt' };
      var t = terminAus(store, a.termin, wann);
      if (a.storniertAm) return { ok: false, fehler: 'schon', anmeldung: a, termin: t };
      // Nach der Stunde gilt der Link aus der Mail nicht mehr: Bine braucht
      // die Liste noch für die Haken. Austragen im Admin geht weiter.
      if (!vonBine && t.vorbei) return { ok: false, fehler: 'vorbei', anmeldung: a, termin: t };
      a.storniertAm = new Date().toISOString();
      if (!vonBine) post(store, a.mail, 'Abgemeldet: ' + t.lang);
      return { ok: true, anmeldung: a, termin: t };
    });
  }

  // ---------- Mails, die verschickt würden ----------

  function bestaetigungsMail(a, abmeldeLink) {
    var store = laden();
    var t = terminAus(store, a.termin, jetzt());
    var z = [];
    z.push('Betreff: Deine Anmeldung für ' + t.lang);
    z.push('');
    z.push('Hallo ' + a.name + ',');
    z.push('');
    z.push('du bist angemeldet für Dynamic Yoga am ' + t.lang + ', ' + t.uhrzeit + ' bis ' + t.ende + ' Uhr.');
    z.push('');
    if (a.ort === 'online') {
      z.push('Du bist über Zoom dabei. Hier ist dein Link: ' + store.serie.zoom);
      z.push('Am besten fünf Minuten vorher einwählen.');
    } else {
      z.push('Wir üben im ' + ADRESSE + ', 80337 München. Der Eingang ist im Hinterhof, dort bei „SOMOS Kursräume“ klingeln. Komm am besten schon umgezogen, Matten sind da.');
    }
    z.push('');
    // PayPal-Adresse und „bar geht auch“ stehen in jeder Mail mit Zahlung
    // (PROJEKT.md), nur die Reihenfolge folgt dem gewählten Zahlweg. Über Zoom
    // gibt es kein „vor Ort“, da bleibt nur vorab. Wellpass zahlt nichts.
    if (a.zahlweg === 'wellpass') {
      z.push('Du kommst über Wellpass: Vor der Stunde scannst du wie gewohnt den QR-Code in der Wellpass-App, bezahlen musst du nichts.');
    } else if (a.ort === 'online') {
      z.push('Die Stunde kostet 19 Euro, bitte vorab per PayPal an ' + PAYPAL + '.');
    } else if (a.zahlweg === 'bar') {
      z.push('Die Stunde kostet 19 Euro, du zahlst bar vor Ort. Wenn du lieber vorab zahlen magst: per PayPal an ' + PAYPAL + '.');
    } else {
      z.push('Die Stunde kostet 19 Euro. Am liebsten per PayPal vorab an ' + PAYPAL + ', PayPal geht aber auch noch vor Ort, bar genauso.');
    }
    z.push('');
    z.push('Kannst du doch nicht? Dann melde dich hier ab: ' + abmeldeLink);
    z.push('');
    z.push('Bis Mittwoch!');
    z.push('Bine');
    return z.join('\n');
  }

  // ---------- Admin ----------

  // Wer schon auf der Liste steht, muss von „nur Zoom“, „nur vor Ort“ und
  // einer anderen Uhrzeit erfahren, sonst steht er mit der alten Mail vor der
  // Tür. Die Anmeldung selbst bleibt, wie sie ist; umbuchen tut die Person
  // über den Abmeldelink und das Formular. Gibt die Zahl der Betroffenen zurück.
  function ausnahme(key, patch) {
    return aendern(function (store) {
      var alt = istObjekt(store.ausnahmen[key]) ? store.ausnahmen[key] : {};
      var neu = Object.assign({}, alt, patch);
      store.ausnahmen[key] = neu;
      if (terminAus(store, key, jetzt()).vorbei) return 0;
      var liste = aktiveIm(store, key);
      var betroffene = [];
      var was = '';
      if (neu.nurOnline && !alt.nurOnline) {
        betroffene = liste.filter(function (a) { return a.ort === 'vorort'; });
        was = 'diesmal nur über Zoom';
      } else if (neu.nurVorOrt && !alt.nurVorOrt) {
        betroffene = liste.filter(function (a) { return a.ort === 'online'; });
        was = 'diesmal ohne Zoom';
      } else if (neu.uhrzeit && neu.uhrzeit !== (alt.uhrzeit || store.serie.uhrzeit)) {
        betroffene = liste;
        was = 'Beginn ' + neu.uhrzeit + ' Uhr';
      }
      if (betroffene.length) post(store, betroffene.length + ' Angemeldete', 'Geändert: ' + datumLang(key) + ', ' + was);
      return betroffene.length;
    });
  }

  // Gibt zurück, wie viele Angemeldete eine Absage bekämen. Ein schon
  // abgesagter Mittwoch bleibt unberührt, sonst ginge die Absage zweimal raus.
  function absagen(key, grund) {
    return aendern(function (store) {
      var x = istObjekt(store.ausnahmen[key]) ? store.ausnahmen[key] : {};
      if (x.abgesagt) return 0;
      var betroffene = aktiveIm(store, key);
      store.ausnahmen[key] = Object.assign({}, x, { abgesagt: true, grund: grund || '' });
      if (betroffene.length) post(store, betroffene.length + ' Angemeldete', 'Absage: ' + datumLang(key) + ' fällt aus');
      return betroffene.length;
    });
  }

  // Wer die Absage bekommen hat, steht noch auf der Liste und muss erfahren,
  // dass die Stunde doch stattfindet
  function absageZurueck(key) {
    return aendern(function (store) {
      var x = istObjekt(store.ausnahmen[key]) ? store.ausnahmen[key] : {};
      if (!x.abgesagt) return 0;
      var betroffene = aktiveIm(store, key);
      store.ausnahmen[key] = Object.assign({}, x, { abgesagt: false, grund: '' });
      if (betroffene.length) post(store, betroffene.length + ' Angemeldete', 'Findet doch statt: ' + datumLang(key));
      return betroffene.length;
    });
  }

  // Alle kommenden Mittwoche im Zeitraum absagen, Grenzen eingeschlossen.
  // Vergangene und schon abgesagte bleiben, wie sie sind. Gibt die Zahl der
  // neu abgesagten zurück.
  function urlaub(vonKey, bisKey) {
    var von = ausKey(vonKey), bis = ausKey(bisKey);
    if (isNaN(von.getTime()) || isNaN(bis.getTime()) || bis < von) return 0;
    var wann = jetzt();
    var n = 0;
    for (var d = naechsterMittwoch(von); d <= bis; d = plusTage(d, 7)) {
      var key = tagKey(d);
      var t = termin(key, wann);
      if (t.vorbei || t.abgesagt) continue;
      absagen(key, 'Bine ist im Urlaub');
      n++;
    }
    return n;
  }

  function linkGueltig(url) {
    return /^https?:\/\/\S+$/.test(url);
  }

  // Ein neuer Zoom-Link muss zu denen, die den alten schon in der Mail haben;
  // eine neue Uhrzeit zu allen, deren Mittwoch keine eigene hat. Abgesagte
  // und vergangene Mittwoche bleiben außen vor.
  function serieAendern(patch) {
    aendern(function (store) {
      var neuerLink = typeof patch.zoom === 'string' && patch.zoom !== store.serie.zoom;
      if (neuerLink && !linkGueltig(patch.zoom)) { delete patch.zoom; neuerLink = false; }
      var neueZeit = typeof patch.uhrzeit === 'string' && patch.uhrzeit !== store.serie.uhrzeit;
      Object.assign(store.serie, patch);
      if (!neuerLink && !neueZeit) return;
      var wann = jetzt();
      var betroffene = {};
      store.anmeldungen.forEach(function (a) {
        if (a.storniertAm) return;
        var x = istObjekt(store.ausnahmen[a.termin]) ? store.ausnahmen[a.termin] : {};
        var t = terminAus(store, a.termin, wann);
        if (t.vorbei || t.abgesagt) return;
        if (neuerLink && a.ort === 'online') post(store, a.mail, 'Neuer Zoom-Link für ' + t.lang);
        if (neueZeit && !x.uhrzeit) betroffene[a.termin] = (betroffene[a.termin] || 0) + 1;
      });
      Object.keys(betroffene).sort().forEach(function (key) {
        post(store, betroffene[key] + ' Angemeldete', 'Geändert: ' + datumLang(key) + ', Beginn ' + patch.uhrzeit + ' Uhr');
      });
    });
  }

  function bezahlt(id, wert) {
    aendern(function (store) {
      var a = suchenIn(store, 'id', id);
      if (a) a.bezahlt = !!wert;
    });
  }

  function postausgang() {
    return laden().postausgang;
  }

  window.Buchung = {
    ORT_TEXT: ORT_TEXT,
    ZAHLWEG_TEXT: ZAHLWEG_TEXT,
    zuruecksetzen: zuruecksetzen,
    personLesen: personLesen,
    personMerken: personMerken,
    meineLesen: meineLesen,
    meineMerken: meineMerken,
    jetzt: jetzt,
    tagKey: tagKey,
    datumLang: datumLang,
    serie: serie,
    naechsterText: naechsterText,
    linkGueltig: linkGueltig,
    termin: termin,
    termine: termine,
    adminTermine: adminTermine,
    bezeichnung: bezeichnung,
    wirksam: wirksam,
    aktive: aktive,
    suchen: suchen,
    anmelden: anmelden,
    abmelden: abmelden,
    bestaetigungsMail: bestaetigungsMail,
    ausnahme: ausnahme,
    absagen: absagen,
    absageZurueck: absageZurueck,
    urlaub: urlaub,
    serieAendern: serieAendern,
    bezahlt: bezahlt,
    postausgang: postausgang
  };
})();
