/* Drei Dinge, sonst nichts: das Verzeichnis folgt dem Lesefortschritt, die
   Suche findet auch Unterabschnitte, und auf schmalen Bildschirmen lässt sich
   das Verzeichnis wegklappen. Kein Netz, kein Speicher, keine Abhängigkeit. */
(function () {
  var toc = document.getElementById('toc');
  var verzeichnis = document.getElementById('verzeichnis');
  var ergebnisse = document.getElementById('ergebnisse');
  var links = Array.prototype.slice.call(verzeichnis.querySelectorAll('a'));
  var karte = {};
  links.forEach(function (a) { karte[a.getAttribute('href').slice(1)] = a; });

  /* --- Mitlaufende Hervorhebung -----------------------------------------
     `rootMargin` schneidet oben die Kopfleiste weg und unten so viel, dass
     immer nur die oberste sichtbare Überschrift zählt — sonst springt die
     Markierung beim Scrollen hin und her. */
  var aktiv = null;
  if ('IntersectionObserver' in window) {
    var beobachter = new IntersectionObserver(function (eintraege) {
      eintraege.forEach(function (e) {
        if (!e.isIntersecting) return;
        var a = karte[e.target.id];
        if (!a || a === aktiv) return;
        if (aktiv) aktiv.classList.remove('jetzt');
        a.classList.add('jetzt');
        aktiv = a;
        if (ergebnisse.hidden) {
          var oben = a.offsetTop - toc.clientHeight / 2;
          if (Math.abs(toc.scrollTop - oben) > toc.clientHeight / 2) toc.scrollTop = oben;
        }
      });
    }, { rootMargin: '-70px 0px -76% 0px', threshold: 0 });
    document.querySelectorAll('h2[id], h3[id]').forEach(function (h) { beobachter.observe(h); });
  }

  /* --- Suche -------------------------------------------------------------
     Gesucht wird über **alle** Überschriften, auch die Unterabschnitte, die
     im Verzeichnis nicht stehen: wer „Ventilautorität" eintippt, sucht den
     Abschnitt 13.11.4 und nicht das Kapitel darüber.

     Umlaute und ß werden gleichgesetzt, damit „Waermepumpe" dasselbe findet
     wie „Wärmepumpe" — dieselbe Regel wie in der Wissensbasis des Programms.
     Und dieselbe Falle: „ae" darf nicht blind zu „a" werden, sonst findet
     „Bogen" nichts mehr. Deshalb wird in beide Richtungen normalisiert,
     Umlaut → Doppelbuchstabe, und die Suche ist eine Teilzeichenfolge. */
  function flach(s) {
    return s.toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  var index = (window.__HANDBUCH_INDEX || []).map(function (e) {
    return { s: e.s, k: e.k, t: e.t, c: e.c, f: flach(e.t), fc: flach(e.c) };
  });

  var feld = document.getElementById('suchfeld');
  var anzeige = document.getElementById('treffer');

  function zeige(liste) {
    if (!liste.length) {
      ergebnisse.innerHTML = '<p class="leer">Nichts gefunden. Versuchen Sie ein kürzeres Wort — die Suche ' +
        'greift auch mitten im Wort.</p>';
      return;
    }
    var html = liste.slice(0, 60).map(function (e) {
      var kap = e.s === 2 ? '' : '<span class="e-kap">' + e.c + '</span>';
      return '<a class="erg erg-' + e.s + '" href="#' + e.k + '">' + kap +
        '<span class="e-titel">' + e.t + '</span></a>';
    }).join('');
    if (liste.length > 60) html += '<p class="leer">… und ' + (liste.length - 60) + ' weitere.</p>';
    ergebnisse.innerHTML = html;
  }

  function suchen() {
    var q = flach(feld.value);
    if (!q) {
      ergebnisse.hidden = true;
      verzeichnis.hidden = false;
      anzeige.textContent = '';
      return;
    }
    var worte = q.split(' ');
    var treffer = index.filter(function (e) {
      return worte.every(function (w) { return e.f.indexOf(w) >= 0 || e.fc.indexOf(w) >= 0; });
    });
    /* Sortiert: erst die Überschriften, in denen das Wort selbst steht, dann
       die, die nur über ihr Kapitel passen; innerhalb dessen die gröbere
       Gliederungsstufe zuerst. */
    treffer.sort(function (a, b) {
      var ta = worte.every(function (w) { return a.f.indexOf(w) >= 0; }) ? 0 : 1;
      var tb = worte.every(function (w) { return b.f.indexOf(w) >= 0; }) ? 0 : 1;
      return ta - tb || a.s - b.s;
    });
    verzeichnis.hidden = true;
    ergebnisse.hidden = false;
    zeige(treffer);
    anzeige.textContent = treffer.length + (treffer.length === 1 ? ' Treffer' : ' Treffer');
    toc.scrollTop = 0;
  }

  feld.addEventListener('input', suchen);
  feld.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { feld.value = ''; suchen(); feld.blur(); return; }
    if (e.key !== 'Enter') return;
    var erste = ergebnisse.querySelector('a');
    if (erste) erste.click();
  });
  /* Strg+F ist im Browser belegt; „/" ist die Taste, die jeder kennt, der
     einmal in einer Dokumentation gesucht hat. */
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== feld && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      feld.focus();
      feld.select();
    }
  });

  document.getElementById('menue').addEventListener('click', function () {
    toc.classList.toggle('auf');
  });
  toc.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    if (window.innerWidth <= 1080) toc.classList.remove('auf');
  });
})();
