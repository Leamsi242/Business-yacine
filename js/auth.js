// Connexion : Touch ID / Face ID (WebAuthn) et journal des connexions.
//
// Touch ID ne remplace pas le PIN, il le garde sous clé sur l'appareil : à l'activation, le téléphone crée une clé
// d'accès (passkey) dont l'extension PRF fournit un secret qui ne sort de la puce sécurisée qu'après l'empreinte ou
// le visage. Ce secret chiffre le PIN (AES-GCM) ; le PIN chiffré reste dans ce navigateur seulement. Sans PRF
// (navigateur trop ancien), l'option n'est pas proposée : jamais de PIN gardé en clair.
//
// Chaque ouverture de l'application est consignée par PYDB.logAccess (table access_log, lisible par l'administrateur
// seul) avec l'appareil et, si le téléphone l'autorise, la position.
(function () {
  const KEY = 'py-bio', NO = 'py-bio-no';
  const NOPRF = 'Ce navigateur ne sait pas protéger le PIN par empreinte ou visage. Sur iPhone et Mac, utilise Safari à jour ; ailleurs, Chrome à jour.';
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, del: k => { try { localStorage.removeItem(k); } catch (e) {} } };

  // Résumé lisible de l'appareil pour le journal : « iPhone · Safari », « Mac · Chrome ».
  function deviceLabel(ua) {
    ua = ua || '';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Appareil inconnu';
    const br = /Edg\//.test(ua) ? 'Edge' : /(CriOS|Chrome)\//.test(ua) ? 'Chrome' : /(FxiOS|Firefox)\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navigateur';
    return os + ' · ' + br;
  }
  // Position au moment de la connexion, si le téléphone l'autorise (demande du navigateur) ; sinon rien.
  function position(timeout = 8000) {
    return new Promise(res => {
      if (!navigator.geolocation) return res({});
      let done = false; const t = setTimeout(() => { done = true; res({}); }, timeout);
      navigator.geolocation.getCurrentPosition(p => { if (done) return; done = true; clearTimeout(t); res({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), acc: Math.round(p.coords.accuracy) }); },
        () => { if (done) return; done = true; clearTimeout(t); res({}); }, { enableHighAccuracy: false, timeout, maximumAge: 300000 });
    });
  }
  // kind : 'connexion' (PIN ou Touch ID) ou 'ouverture' (session déjà ouverte) ; method : 'pin', 'biometrie', 'session'.
  async function record(kind, method) {
    const pos = await position();
    try { return await window.PYDB.logAccess(Object.assign({ kind, method, device: deviceLabel(navigator.userAgent) }, pos)); } catch (e) { return false; }
  }

  async function available() {
    try { return !!(window.PublicKeyCredential && window.crypto && crypto.subtle && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
  }
  const enrolled = () => !!store.get(KEY);
  const declined = () => store.get(NO) === '1';
  const decline = () => store.set(NO, '1');
  const keyFrom = out => crypto.subtle.importKey('raw', out, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function prfGet(id, salt) {
    const a = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
    const r = a.getClientExtensionResults ? a.getClientExtensionResults() : {}; const out = r && r.prf && r.prf.results && r.prf.results.first;
    if (!out) throw new Error(NOPRF); return out;
  }
  async function enroll(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Pilote Yacine' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'yacine', displayName: 'Yacine' },
      challenge: crypto.getRandomValues(new Uint8Array(32)), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } } });
    const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    if (!ext.prf || ext.prf.enabled === false) throw new Error(NOPRF);
    // Certains appareils ne donnent le secret qu'à la première utilisation : on le demande alors tout de suite.
    const out = (ext.prf.results && ext.prf.results.first) || await prfGet(cred.rawId, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(out), new TextEncoder().encode(pin));
    store.set(KEY, JSON.stringify({ id: b64(cred.rawId), salt: b64(salt), iv: b64(iv), ct: b64(ct) })); store.del(NO);
  }
  async function unlock() {
    const s = JSON.parse(store.get(KEY) || 'null'); if (!s) throw new Error('Touch ID n’est pas activé sur cet appareil');
    const out = await prfGet(unb64(s.id), unb64(s.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, await keyFrom(out), unb64(s.ct));
    return new TextDecoder().decode(pt);
  }
  const forget = () => store.del(KEY);

  window.PYAUTH = { deviceLabel, position, record, available, enrolled, declined, decline, enroll, unlock, forget };
})();
