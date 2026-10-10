// Koppeling tussen het toestel van de senior en dat van de mantelzorger.
// Er worden alleen minuten per dag gedeeld, geen scores, niveaus of spelresultaten.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, serverTimestamp,
  collection, query, where, orderBy, limit, onSnapshot, addDoc
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA8fv9u3Nd_AeED7q5l4dnlQqFwHyI225c",
  authDomain: "breinplezier-app.firebaseapp.com",
  projectId: "breinplezier-app",
  storageBucket: "breinplezier-app.firebasestorage.app",
  messagingSenderId: "813877708377",
  appId: "1:813877708377:web:900928d9d124420116d348"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const PAIR_KEY = 'hersenspel-pair';
const NUDGES = ['👋', '😊', '💛', '👏'];

let uid = null;
let code = null;
let unsubs = [];
let minutesByUser = {};
let lastNudge = null;
let errorText = '';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function todayKey(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Minuten van vandaag uit de spelopslag van de app (alleen de minuten, niets anders)
function todayMinutes(){
  try{
    const d = JSON.parse(localStorage.getItem('hersenspel-v3')) || {};
    return Math.round((d['min:' + todayKey()] || 0) / 60000);
  }catch(e){ return 0; }
}

function savedCode(){ try{ return localStorage.getItem(PAIR_KEY); }catch(e){ return null; } }
function saveCode(c){ try{ if(c) localStorage.setItem(PAIR_KEY, c); else localStorage.removeItem(PAIR_KEY); }catch(e){} }

// Zes tekens, zonder verwarrende letters zoals 0, O, I en L
function newCode(){
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, n => chars[n % chars.length]).join('');
}

function unsubscribe(){
  unsubs.forEach(u => u());
  unsubs = [];
  minutesByUser = {};
  lastNudge = null;
}

function listen(){
  unsubscribe();
  if(!code) return;
  const today = todayKey();
  unsubs.push(onSnapshot(
    query(collection(db, 'pairs', code, 'days'), where('date', '==', today)),
    snap => { minutesByUser = {}; snap.forEach(s => { minutesByUser[s.data().uid] = s.data().minutes; }); render(); },
    err => { errorText = 'Verbinding mislukt: ' + err.message; render(); }
  ));
  unsubs.push(onSnapshot(
    query(collection(db, 'pairs', code, 'nudges'), orderBy('at', 'desc'), limit(1)),
    snap => { lastNudge = snap.empty ? null : snap.docs[0].data(); render(); },
    err => { errorText = 'Verbinding mislukt: ' + err.message; render(); }
  ));
}

async function pushMinutes(){
  if(!code || !uid) return;
  try{
    await setDoc(doc(db, 'pairs', code, 'days', todayKey() + '_' + uid), {
      uid, date: todayKey(), minutes: todayMinutes(), updatedAt: serverTimestamp()
    });
  }catch(e){ errorText = 'Minuten niet opgeslagen: ' + e.message; render(); }
}

async function createPair(){
  code = newCode();
  await setDoc(doc(db, 'pairs', code), { members: [uid], createdAt: serverTimestamp() });
  saveCode(code);
  listen();
  pushMinutes();
  render();
}

async function joinPair(input){
  const c = String(input).trim().toUpperCase();
  if(!/^[A-Z2-9]{6}$/.test(c)) throw new Error('Een code bestaat uit zes letters of cijfers.');
  const snap = await getDoc(doc(db, 'pairs', c));
  if(!snap.exists()) throw new Error('Deze code bestaat niet.');
  const members = snap.data().members || [];
  if(!members.includes(uid)){
    if(members.length >= 2) throw new Error('Deze koppeling is al vol.');
    await updateDoc(doc(db, 'pairs', c), { members: [...members, uid] });
  }
  code = c;
  saveCode(c);
  listen();
  pushMinutes();
  render();
}

// Ontkoppelen haalt de koppeling uit de database, zodat een nieuwe partner gekoppeld kan worden
async function leave(){
  const old = code;
  unsubscribe();
  code = null;
  saveCode(null);
  errorText = '';
  try{
    if(old){
      for(const sub of ['days', 'nudges']){
        const s = await getDocs(collection(db, 'pairs', old, sub));
        for(const d of s.docs){ await deleteDoc(d.ref); }
      }
      await deleteDoc(doc(db, 'pairs', old));
    }
  }catch(e){ errorText = 'Verwijderen op de server lukt niet: ' + e.message; }
  render();
}

async function sendNudge(emoji){
  if(!code) return;
  try{
    await addDoc(collection(db, 'pairs', code, 'nudges'), { from: uid, text: emoji, at: serverTimestamp() });
  }catch(e){ errorText = 'Bericht niet verstuurd: ' + e.message; render(); }
}

function render(){
  const slot = $('koppel-slot');
  if(!slot) return;

  if(!uid){
    slot.innerHTML = '<div class="panel"><h2>Koppelen</h2><p class="muted" style="margin:0">Even geduld…</p><div class="feedback bad">' + esc(errorText) + '</div></div>';
    return;
  }

  if(!code){
    slot.innerHTML = '<div class="panel"><h2>Koppelen met je partner</h2>'
      + '<p class="muted">Mantelzorger: vul de code in die op het toestel van de senior staat. Je ziet dan alleen de minuten van vandaag.</p>'
      + '<div class="row"><input class="answer" id="kj" style="max-width:200px" autocomplete="off" autocapitalize="characters" placeholder="zes tekens"><button class="btn" id="kjoin">Koppel</button></div>'
      + '<p class="muted" style="margin:14px 0 6px">Senior: maak een code aan en geef die door.</p>'
      + '<button class="btn ghost" id="kmake">Maak een code</button>'
      + '<div class="feedback bad" id="kerr">' + esc(errorText) + '</div></div>';
    $('kjoin').onclick = async () => { errorText = ''; try{ await joinPair($('kj').value); }catch(e){ errorText = e.message; render(); } };
    $('kmake').onclick = async () => { errorText = ''; try{ await createPair(); }catch(e){ errorText = 'Code maken lukt niet: ' + e.message; render(); } };
    return;
  }

  const myM = todayMinutes();
  const others = Object.keys(minutesByUser).filter(k => k !== uid);
  const theirs = others.length ? minutesByUser[others[0]] : null;

  const mineText = 'Jij: ' + Math.min(myM, 5) + ' van 5 minuten vandaag';
  const theirsText = theirs == null ? 'Partner: nog niet geoefend vandaag' : 'Partner: ' + Math.min(theirs, 5) + ' van 5 minuten vandaag';

  let hint = '';
  if((theirs || 0) >= 5 && myM < 5) hint = 'Je partner heeft vandaag al geoefend. Zin om ook even te spelen?';
  else if(myM >= 5 && (theirs || 0) < 5) hint = 'Jij hebt vandaag je vijf minuten. Stuur je partner een zwaai.';

  const incoming = lastNudge && lastNudge.from !== uid
    ? '<p style="margin:12px 0 0;font-size:1.3rem">Bericht van je partner: ' + esc(lastNudge.text || '') + '</p>' : '';

  slot.innerHTML = '<div class="panel"><h2>Koppeling</h2>'
    + '<p class="muted" style="margin:0">Code: <b>' + esc(code) + '</b></p>'
    + '<p style="margin:12px 0 0">' + esc(mineText) + '</p>'
    + '<p style="margin:4px 0 0">' + esc(theirsText) + '</p>'
    + (hint ? '<p class="muted" style="margin:10px 0 0">' + esc(hint) + '</p>' : '')
    + incoming
    + '<div class="toggles" style="margin-top:12px">' + NUDGES.map(e => '<button class="btn ghost" data-n="' + e + '">' + e + '</button>').join('') + '</div>'
    + '<div class="row" style="margin-top:12px"><button class="btn ghost" id="kleave">Ontkoppelen</button></div>'
    + '<div class="feedback bad">' + esc(errorText) + '</div></div>';

  slot.querySelectorAll('[data-n]').forEach(b => { b.onclick = () => sendNudge(b.dataset.n); });
  $('kleave').onclick = leave;
}

async function init(){
  try{
    await signInAnonymously(auth);
    uid = auth.currentUser.uid;
  }catch(e){
    errorText = 'Anonieme login staat uit of faalt: ' + e.message;
    render();
    return;
  }
  code = savedCode();
  if(code){ listen(); pushMinutes(); }
  render();
  setInterval(pushMinutes, 60000);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') pushMinutes(); });
}

window.koppelMount = render;

// Levenslange codes: een document in de verzameling 'levenslang' met de code als ID
window.checkLifetime = async (input) => {
  if(!uid) return false;
  const c = String(input).trim().toUpperCase();
  if(!c) return false;
  try{
    const snap = await getDoc(doc(db, 'levenslang', c));
    return snap.exists() && snap.data().active === true;
  }catch(e){ return false; }
};

init();
