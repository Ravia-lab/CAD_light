/**
 * Glossar — die Abkürzungen, an denen das Werkzeug sonst scheitert.
 *
 * Dieses Programm bedient nicht nur, wer Bauphysik studiert hat. Ein Monteur,
 * der einen Bestand aufnimmt, liest „ΔU_WB" und „B′" zum ersten Mal — und
 * gibt entweder irgendetwas ein oder gar nichts. Beides ist schlechter als
 * ein Satz Erklärung an der richtigen Stelle.
 *
 * Deshalb steht jeder Fachbegriff hier *einmal* mit drei Angaben:
 *   • `term`  — wie er ausgeschrieben heißt
 *   • `short` — eine Zeile, die im Vorbeigehen reicht
 *   • `long`  — was er bedeutet und warum er gebraucht wird, in Alltagssprache
 *
 * Regel für `long`: kein Begriff darf durch einen anderen Fachbegriff erklärt
 * werden. Wer „Transmissionswärmeverlust" nachschlägt, weiß nichts mit
 * „Wärmedurchgangskoeffizient" anzufangen.
 */

export interface GlossaryEntry {
  term: string;
  short: string;
  long: string;
  /** Typischer Wertebereich, wenn es einen gibt — die häufigste Rückfrage. */
  typical?: string;
}

export const GLOSSAR: Record<string, GlossaryEntry> = {
  'u-wert': {
    term: 'U-Wert',
    short: 'Wie viel Wärme durch ein Bauteil geht.',
    long:
      'Der U-Wert sagt, wie viel Wärme durch einen Quadratmeter Wand, Fenster oder Dach ' +
      'nach draußen geht, wenn es drinnen ein Grad wärmer ist als draußen. Klein ist gut: ' +
      'eine gedämmte Außenwand liegt bei 0,2, eine ungedämmte Altbauwand bei 1,4.',
    typical: 'Außenwand 0,15–1,4 · Fenster 0,8–3,0 · Dach 0,14–0,5',
  },
  'g-wert': {
    term: 'g-Wert',
    short: 'Wie viel Sonnenwärme durch die Scheibe kommt.',
    long:
      'Der g-Wert ist der Anteil der Sonnenwärme, der durch die Verglasung in den Raum ' +
      'gelangt. 0,6 heißt: 60 % kommen an. Für die Heizlast im Winter ist er nur ein ' +
      'Nebenwert, für die sommerliche Wärme dagegen entscheidend.',
    typical: '2-fach 0,58–0,62 · 3-fach 0,50–0,55',
  },
  'delta-u-wb': {
    term: 'ΔU_WB — Wärmebrückenzuschlag',
    short: 'Aufschlag für die Ecken und Anschlüsse, die mehr Wärme verlieren.',
    long:
      'An Gebäudeecken, Fensterlaibungen und Deckenauflagern geht mehr Wärme verloren als ' +
      'in der Fläche daneben. Statt jede dieser Stellen einzeln zu rechnen, wird ein ' +
      'pauschaler Aufschlag auf alle Bauteile gelegt. Ohne genaueren Nachweis sind ' +
      '0,10 W/(m²·K) anzusetzen — das ist bewusst reichlich.',
    typical: 'ohne Nachweis 0,10 · nach Katalog 0,05 · sehr gut geplant 0,03',
  },
  psi: {
    term: 'ψ — längenbezogener Wärmeverlust',
    short: 'Wärmeverlust je Meter Anschlusskante.',
    long:
      'Was der U-Wert für eine Fläche ist, ist ψ für eine Kante: Wärmeverlust je laufendem ' +
      'Meter Gebäudeecke, Fensterlaibung oder Sockel. Negative Werte sind kein Fehler — ' +
      'an einer Außenecke ist die Außenfläche größer als die Innenfläche, über die ' +
      'gerechnet wird.',
  },
  'b-strich': {
    term: 'B′ — charakteristisches Bodenmaß',
    short: 'Wie „tief" ein Raum im Erdreich sitzt.',
    long:
      'Wärme, die in den Boden geht, nimmt einen langen Weg durchs Erdreich nach draußen. ' +
      'Wie lang, hängt davon ab, wie groß der Raum im Verhältnis zu seinem Außenumfang ' +
      'ist. Genau das drückt B′ aus. Ein großer, kompakter Kellerraum verliert je ' +
      'Quadratmeter weniger als ein schmaler. Der Wert wird hier automatisch gebildet.',
  },
  n50: {
    term: 'n50 — Luftdichtheit',
    short: 'Wie undicht das Gebäude ist, gemessen im Blower-Door-Test.',
    long:
      'Beim Blower-Door-Test wird das Gebäude mit einem Ventilator auf Über- und Unterdruck ' +
      'gebracht und gemessen, wie viel Luft durch Ritzen nachströmt. n50 = 1,5 heißt: unter ' +
      'Prüfdruck wird die Raumluft eineinhalbmal je Stunde ausgetauscht. Ohne Messung wird ' +
      'geschätzt — Neubau 1,5, Altbau 3 bis 6.',
    typical: 'Passivhaus 0,6 · Neubau 1,5–3 · Altbau 3–6',
  },
  'n-min': {
    term: 'n_min — Mindestluftwechsel',
    short: 'Wie oft die Luft im Raum stündlich getauscht werden muss.',
    long:
      'Aus hygienischen Gründen muss die Raumluft regelmäßig erneuert werden — sonst steigt ' +
      'die Feuchte und es schimmelt. 0,5 heißt: die halbe Raumluftmenge je Stunde. In Bad ' +
      'und Küche ist der Bedarf höher als im Schlafzimmer. Diese Luft muss geheizt werden ' +
      'und ist deshalb Teil der Heizlast.',
    typical: 'Wohnen/Schlafen 0,5 · Bad, WC, Küche 1,5',
  },
  kniestock: {
    term: 'Kniestock',
    short: 'Die Höhe der geraden Wand unter der Dachschräge.',
    long:
      'Im Dachgeschoss steht meist noch ein Stück gerade Wand, bevor die Schräge beginnt. ' +
      'Diese Höhe ist der Kniestock, gemessen vom fertigen Fußboden. Sie entscheidet ' +
      'darüber, wie viel vom Raum wirklich nutzbar ist — und damit über Wohnfläche, ' +
      'Volumen und Dachfläche.',
    typical: '0 m (Dach sitzt direkt auf) bis 1,5 m',
  },
  traufe: {
    term: 'Traufe',
    short: 'Die untere, waagerechte Dachkante — dort, wo die Rinne hängt.',
    long:
      'Die Traufe ist die untere Kante der Dachfläche. Bei einem Satteldach gibt es zwei, ' +
      'je eine an den Längsseiten. Dort trifft das Dach auf die Außenwand.',
  },
  ortgang: {
    term: 'Ortgang',
    short: 'Die schräge Dachkante am Giebel.',
    long:
      'Der Ortgang ist die seitliche, schräg ansteigende Dachkante über der Giebelwand — ' +
      'die Linie, an der das Dach seitlich endet. Weil sie schräg läuft, ist sie länger als ' +
      'die Wand darunter.',
  },
  azimut: {
    term: 'Azimut',
    short: 'In welche Himmelsrichtung eine Fläche zeigt, als Winkel.',
    long:
      'Statt „Süd" oder „Südwest" wird die Richtung als Winkel angegeben: 0° ist Norden, ' +
      '90° Osten, 180° Süden, 270° Westen. Damit lässt sich rechnen — zum Beispiel, wie ' +
      'viel Sonne auf ein Fenster fällt.',
  },
  'nordabweichung': {
    term: 'Nordabweichung',
    short: 'Wie stark der Plan gegenüber Norden verdreht ist.',
    long:
      'Ein Grundriss wird selten genau nach Norden gezeichnet. Die Nordabweichung sagt, um ' +
      'wie viel Grad er verdreht liegt. Das Werkzeug rechnet sie in jede Himmelsrichtung ' +
      'ein — Sie müssen den Plan also nicht drehen.',
  },
  wrg: {
    term: 'Wärmerückgewinnung (η)',
    short: 'Wie viel Wärme die Anlage aus der Abluft in die Zuluft zurückholt.',
    long:
      'Eine Lüftungsanlage mit Wärmerückgewinnung führt die warme Abluft an der kalten ' +
      'Zuluft vorbei und überträgt dabei einen Teil der Wärme. 80 % heißt: nur ein Fünftel ' +
      'der Luftmenge muss noch aufgeheizt werden. Das ist der Unterschied zwischen einer ' +
      'kleinen und einer großen Heizung.',
    typical: 'Geräte liegen bei 75–90 %',
  },
  'ueberstroemen': {
    term: 'Überströmen',
    short: 'Luft wandert vom Wohnraum über den Flur ins Bad.',
    long:
      'Frische Luft kommt in Wohn- und Schlafräume, verbraucht wird sie in Bad, WC und ' +
      'Küche. Dazwischen strömt sie durch Türspalte oder Überströmelemente — deshalb ' +
      'braucht ein Flur weder Zu- noch Abluft.',
  },
  'f-rh': {
    term: 'f_RH — Wiederaufheizfaktor',
    short: 'Zuschlag, wenn die Heizung nachts abgesenkt wird.',
    long:
      'Wird nachts abgesenkt, muss die Heizung morgens mehr leisten, um den Raum wieder ' +
      'aufzuwärmen. Wie viel mehr, steht in einer Tabelle der jeweiligen Norm. In ' +
      'Deutschland ist dieser Zuschlag amtlich auf 0 gesetzt — er wird also üblicherweise ' +
      'nicht angesetzt.',
    typical: 'In Deutschland 0',
  },
  'nennweite': {
    term: 'DN — Nennweite',
    short: 'Der ungefähre Innendurchmesser eines Rohrs in Millimetern.',
    long:
      'DN 20 heißt: das Rohr hat rund 20 mm lichte Weite. Je enger das Rohr und je länger ' +
      'der Weg, desto mehr Druck geht verloren — deshalb steht die Nennweite neben der ' +
      'Länge in der Strangliste.',
  },
  'schrittmass': {
    term: '2s + a — Schrittmaß',
    short: 'Die Faustregel für bequeme Treppen.',
    long:
      'Zweimal die Stufenhöhe plus einmal die Auftrittstiefe sollte ungefähr 63 cm ergeben — ' +
      'das entspricht einem normalen Schritt. Liegt eine Treppe deutlich daneben, läuft sie ' +
      'sich unangenehm, auch wenn sie sonst zulässig ist.',
    typical: '59–65 cm, Stufenhöhe 14–20 cm, Auftritt 23–37 cm',
  },
  adiabat: {
    term: 'adiabat',
    short: 'Kein Wärmefluss — beide Seiten sind gleich warm.',
    long:
      'Liegt über einem 20-°C-Raum ein weiterer 20-°C-Raum, fließt durch die Decke dazwischen ' +
      'keine Wärme. Solche Bauteile werden „adiabat" gerechnet und tragen nichts zur ' +
      'Heizlast bei. Ohne Geschossstapel müsste dieselbe Decke gegen „unbeheizt" gerechnet ' +
      'werden — und die Heizung fiele zu groß aus.',
  },
  'heizlast': {
    term: 'Heizlast',
    short: 'Die Leistung, die ein Raum am kältesten Tag braucht.',
    long:
      'Die Heizlast ist die Wärmeleistung in Watt, die ein Raum braucht, damit es bei ' +
      'Auslegungstemperatur draußen drinnen warm bleibt. Sie ist die Grundlage dafür, wie ' +
      'groß Heizkörper und Wärmeerzeuger sein müssen. Gerechnet wird sie in RaVia — dieses ' +
      'Werkzeug erfasst die Daten dafür.',
  },
  'norm-aussentemperatur': {
    term: 'Norm-Außentemperatur',
    short: 'Die kälteste Temperatur, für die ausgelegt wird.',
    long:
      'Nicht die kälteste jemals gemessene, sondern ein Wert, der ortsabhängig festgelegt ist ' +
      'und im langjährigen Mittel selten unterschritten wird. In Deutschland liegt er je nach ' +
      'Region zwischen −10 und −16 °C.',
    typical: 'Norddeutschland −10 · Mitte −12 · Alpenraum −16',
  },
  'abschirmung': {
    term: 'Abschirmung',
    short: 'Wie stark der Wind ans Gebäude kommt.',
    long:
      'Ein freistehendes Haus auf dem Feld bekommt mehr Wind ab als ein Reihenhaus in der ' +
      'Stadt — und damit mehr kalte Luft durch die Ritzen. Die Abschirmungsklasse bildet das ' +
      'ab.',
  },
  'wofl': {
    term: 'Wohnfläche nach WoFlV',
    short: 'Unter der Schräge zählt nicht alles mit.',
    long:
      'Bei Dachschrägen zählt Fläche über 2,00 m Höhe voll, zwischen 1,00 und 2,00 m nur zur ' +
      'Hälfte, darunter gar nicht. Das ist der Grund, warum die Wohnfläche eines ' +
      'Dachgeschosses kleiner ist als seine Grundfläche.',
  },
  'huellflaeche': {
    term: 'Hüllfläche',
    short: 'Alle Flächen, die beheizt von unbeheizt trennen.',
    long:
      'Außenwände, Fenster, Türen, Dach, Boden und Decken zusammen — die gedachte Hülle um den ' +
      'warmen Bereich. Über sie geht die Wärme verloren.',
  },
  'ta-laerm': {
    term: 'TA Lärm — Immissionsrichtwert',
    short: 'Wie laut es beim Nachbarn ankommen darf.',
    long:
      'Die Technische Anleitung zum Schutz gegen Lärm legt fest, wie laut eine Anlage am Fenster ' +
      'des Nachbarn sein darf. Gemessen wird 0,5 m vor dem geöffneten Fenster des am stärksten ' +
      'betroffenen Wohn- oder Schlafraums. Nachts gilt der strengere Wert — und weil eine ' +
      'Wärmepumpe durchläuft, ist immer die Nacht der maßgebliche Fall.',
    typical: 'Wohngebiet nachts 40 dB(A) · reines Wohngebiet 35 · Mischgebiet 45',
  },
  schallleistung: {
    term: 'Schallleistungspegel',
    short: 'Wie viel Lärm das Gerät insgesamt abgibt — unabhängig vom Abstand.',
    long:
      'Der Schallleistungspegel beschreibt die Quelle selbst, nicht das, was man an einer ' +
      'bestimmten Stelle hört. Aus ihm und dem Abstand ergibt sich, wie laut es beim Nachbarn ' +
      'ankommt. Anzusetzen ist der lauteste Betriebszustand, nicht der Wert vom Energielabel — ' +
      'die Anlage könnte nachts ja hochlaufen.',
    typical: 'Aktuelle Geräte 43–62 dB(A), leise Modelle unter 50',
  },
  schutzbereich: {
    term: 'Schutzbereich (R290)',
    short: 'Der Bereich um das Gerät, in dem keine Öffnung liegen darf.',
    long:
      'Propan ist brennbar und schwerer als Luft. Tritt es aus, sinkt es zu Boden und sammelt ' +
      'sich in Vertiefungen. Deshalb darf im Schutzbereich um das Gerät nichts liegen, wo es ' +
      'hineinlaufen könnte: Lichtschacht, Kellerabgang, Bodenablauf, Kellerfenster — und er darf ' +
      'nicht auf das Nachbargrundstück reichen. Den Radius gibt der Hersteller vor, eine ' +
      'allgemeine Tabelle gibt es dafür nicht.',
    typical: 'Verbreitet 1,00 m waagerecht, 0,5 m über der Geräteoberkante',
  },
  entzugsleistung: {
    term: 'Spezifische Entzugsleistung',
    short: 'Wie viel Wärme der Boden je Meter oder Quadratmeter hergibt.',
    long:
      'Wie viel Wärme dem Erdreich entnommen werden kann, hängt davon ab, woraus es besteht und ' +
      'wie feucht es ist. Trockener Sand gibt wenig her, wassergesättigter Kies viel. Aus diesem ' +
      'Wert und der benötigten Leistung ergibt sich, wie viele Sondenmeter gebohrt oder wie viele ' +
      'Quadratmeter Kollektor verlegt werden müssen.',
    typical: 'Sonde 20–84 W/m · Flächenkollektor 8–40 W/m²',
  },
  cop: {
    term: 'COP — Leistungszahl',
    short: 'Wie viel Wärme je Kilowattstunde Strom herauskommt.',
    long:
      'Ein COP von 4 heißt: aus einer Kilowattstunde Strom werden vier Kilowattstunden Wärme. ' +
      'Der Wert gilt immer nur für einen bestimmten Betriebspunkt — je kälter die Quelle und je ' +
      'wärmer der Vorlauf, desto kleiner wird er. Über ein ganzes Jahr gemittelt heißt dieselbe ' +
      'Größe Jahresarbeitszahl.',
    typical: 'Luft/Wasser 2,7–4,1 · Sole/Wasser 4,4–4,8 · Wasser/Wasser 4,9–5,8',
  },
  bivalenzpunkt: {
    term: 'Bivalenzpunkt',
    short: 'Ab welcher Außentemperatur die Zusatzheizung mitläuft.',
    long:
      'Eine Wärmepumpe wird meist nicht für den kältesten Tag ausgelegt, sondern etwas kleiner — ' +
      'die letzten Grad übernimmt ein Heizstab oder ein zweiter Erzeuger. Der Bivalenzpunkt ist ' +
      'die Außentemperatur, ab der das passiert. Bei −5 °C deckt die Wärmepumpe immer noch rund ' +
      '95 Prozent der Jahresarbeit ab.',
    typical: 'Monoenergetisch −5 bis −8 °C · bivalent −2 bis −4 °C',
  },
  spreizung: {
    term: 'Spreizung',
    short: 'Der Temperaturunterschied zwischen hin und zurück.',
    long:
      'Das Wasser geht warm zur Heizfläche und kommt kühler zurück. Die Differenz ist die ' +
      'Spreizung. Sie entscheidet, wie viel Wasser die Pumpe bewegen muss: bei kleiner ' +
      'Spreizung muss viel Wasser fließen, um dieselbe Wärme zu transportieren, und die Pumpe ' +
      'braucht mehr Strom. Bei großer Spreizung wird die Heizfläche am Ende zu kalt.',
    typical: 'Fußbodenheizung 5–7 K · Heizkörper 8–15 K',
  },
  volumenstrom: {
    term: 'Volumenstrom',
    short: 'Wie viel Wasser in einer Stunde durch das Rohr geht.',
    long:
      'Angegeben in Kubikmetern je Stunde. Er ergibt sich aus der Wärmemenge und der ' +
      'Spreizung: doppelte Wärme bei gleicher Spreizung heißt doppelt so viel Wasser. Aus dem ' +
      'Volumenstrom folgt die Rohrgröße — zu klein und es rauscht, zu groß und es kostet ' +
      'unnötig Geld und Wasserinhalt.',
    typical: 'Einfamilienhaus 0,5–1,5 m³/h',
  },
  ausdehnungsgefaess: {
    term: 'Membran-Ausdehnungsgefäß (MAG)',
    short: 'Nimmt das Wasser auf, das sich beim Aufheizen ausdehnt.',
    long:
      'Wasser wird beim Erwärmen größer. In einer geschlossenen Anlage muss dieser Zuwachs ' +
      'irgendwohin — sonst steigt der Druck, bis das Sicherheitsventil abbläst. Das ' +
      'Ausdehnungsgefäß ist ein Behälter mit einer Gummiblase darin: das Wasser drückt sie ' +
      'zusammen, das Gas dahinter federt. Ist es zu klein oder falsch vorgespannt, verliert die ' +
      'Anlage bei jeder kalten Woche Wasser.',
    typical: 'Einfamilienhaus 18–35 l',
  },
  vordruck: {
    term: 'Vordruck p₀',
    short: 'Der Gasdruck im Ausdehnungsgefäß im leeren Zustand.',
    long:
      'Er muss so hoch sein, dass am höchsten Punkt der Anlage noch Wasser steht und keine ' +
      'Luft gezogen wird. Faustregel: ein Meter Höhenunterschied entspricht 0,1 bar, dazu ein ' +
      'Zuschlag von 0,2 bar. Der Vordruck wird am ausgebauten oder wasserseitig entlasteten ' +
      'Gefäß eingestellt — mit gefüllter Anlage misst man nur den Anlagendruck.',
    typical: 'Einfamilienhaus 0,8–1,5 bar',
  },
  puffer: {
    term: 'Pufferspeicher',
    short: 'Wasservorrat, damit der Verdichter nicht ständig an- und ausgeht.',
    long:
      'Eine Wärmepumpe braucht Wasser in der Anlage — zum Abtauen des Außengeräts und damit ' +
      'sie nach dem Anlaufen ein paar Minuten durchläuft. Steckt genug Wasser in Estrich und ' +
      'Leitungen, ist kein Puffer nötig. Bei Heizkörpern und bei Einzelraumregelung fast immer ' +
      'schon. Ein zu großer Puffer schadet: er mischt den Vorlauf herunter und kostet Effizienz.',
    typical: 'Reihenpuffer 25–100 l · als Richtwert 12 l je kW',
  },
  legionellen: {
    term: 'Legionellen',
    short: 'Bakterien, die sich in lauwarmem Trinkwasser vermehren.',
    long:
      'Sie wachsen zwischen etwa 25 und 45 °C und sterben oberhalb 60 °C ab. Deshalb gibt es ' +
      'Temperaturvorgaben für Warmwasserspeicher. Für eine Wärmepumpe ist das ein Zielkonflikt: ' +
      'jedes Grad mehr Speichertemperatur kostet Effizienz. In einem Einfamilienhaus reicht ' +
      'eine wöchentliche Aufheizung; in größeren Anlagen gelten feste Temperaturen.',
    typical: 'Speicher 50–60 °C · Aufheizung wöchentlich auf 60 °C',
  },
  zirkulation: {
    term: 'Zirkulation',
    short: 'Warmes Wasser kreist ständig, damit es sofort am Hahn ankommt.',
    long:
      'Ohne Zirkulation steht das Wasser in der Leitung und kühlt aus — es dauert, bis es warm ' +
      'wird, und die stehende Menge ist hygienisch heikel. Ab drei Litern Inhalt zwischen ' +
      'Speicher und der entferntesten Zapfstelle ist eine Zirkulationsleitung vorgeschrieben. ' +
      'Sie kostet allerdings Wärme, weil die Leitung dauernd warm ist.',
    typical: 'Grenze 3 Liter Leitungsinhalt',
  },
  typklasse: {
    term: 'Typklasse',
    short: 'Ein gedachtes Gerät statt eines echten Produkts.',
    long:
      'Der Gerätekatalog dieses Programms enthält keine bestellbaren Geräte, sondern ' +
      'Beschreibungen dessen, was ein Gerät dieser Bauart und Größe üblicherweise leistet. ' +
      'Damit lässt sich alles rechnen, was vor der Geräteauswahl kommt — Platz, Schall, ' +
      'Speicher, Rohre. Sobald das Datenblatt da ist, werden die echten Werte eingetragen, und ' +
      'erst dann ist die Auslegung belastbar.',
  },
  ueberstroemventil: {
    term: 'Überströmventil',
    short: 'Notausgang für das Wasser, wenn zu viele Heizkreise geschlossen sind.',
    long:
      'Jede Wärmepumpe braucht eine Mindestwassermenge, sonst schaltet sie ab. Schließen die ' +
      'Raumthermostate nach und nach alle Kreise, unterschreitet der Durchfluss diese Menge. ' +
      'Das Überströmventil öffnet dann einen Kurzschluss zwischen Vor- und Rücklauf. Besser ' +
      'wäre, den Fall gar nicht entstehen zu lassen — etwa indem ein Kreis immer offen bleibt.',
  },
  systemtrenner: {
    term: 'Systemtrenner',
    short: 'Verhindert, dass Heizungswasser ins Trinkwasser zurückläuft.',
    long:
      'Beim Füllen der Heizung wird Trinkwasser angeschlossen. Fällt dabei der Druck im ' +
      'Trinkwassernetz ab, könnte Heizungswasser zurückgesaugt werden — mit allem, was darin ' +
      'gelöst ist. Der Systemtrenner unterbricht die Verbindung mit einer offenen Zone und ' +
      'lässt Wasser nur in eine Richtung durch. Er ist beim Füllen vorgeschrieben.',
  },
};

/** Alle Begriffe, alphabetisch — für eine Übersicht im Hilfebereich. */
export const glossaryList = (): (GlossaryEntry & { id: string })[] =>
  Object.entries(GLOSSAR)
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => a.term.localeCompare(b.term, 'de'));
