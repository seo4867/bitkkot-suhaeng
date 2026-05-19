/**
 * 데이터 저장소
 * Firestore (클라우드) + localStorage (로컬 캐시)
 */
import {
  doc, getDoc, setDoc, collection, getDocs,
  serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from './firebase.js';

let _uid = null;
export const setCurrentUser = (uid) => { _uid = uid; };
export const getCurrentUser = ()     => _uid;
export const clearUser      = ()     => { _uid = null; };

/* ── key 인코딩 (/ 제거) ── */
const enc = k => k.replace(/\//g, '_SL_');
const dec = k => k.replace(/_SL_/g, '/');

/* ── 기본 store (기존 앱 인터페이스와 동일) ── */
export const store = {
  get: async (key) => {
    if (_uid) {
      try {
        const snap = await getDoc(doc(db, 'users', _uid, 'data', enc(key)));
        if (snap.exists()) return { value: snap.data().v };
      } catch {}
    }
    const v = localStorage.getItem(key);
    return v !== null ? { value: v } : null;
  },

  set: async (key, value) => {
    // 로컬 캐시
    try { localStorage.setItem(key, value); } catch {}
    // Firestore
    if (_uid) {
      try {
        await setDoc(doc(db, 'users', _uid, 'data', enc(key)), {
          v: value,
          updatedAt: serverTimestamp(),
        });
        // record 저장 시 월간 통계 동기화
        if (key.startsWith('record:')) {
          await syncMonthlySummary(_uid, key.replace('record:', ''));
        }
      } catch (e) { console.warn('Firestore set error', e); }
    }
  },

  list: async (prefix) => {
    if (_uid) {
      try {
        const snap = await getDocs(collection(db, 'users', _uid, 'data'));
        const keys = snap.docs.map(d => dec(d.id)).filter(k => k.startsWith(prefix));
        return { keys };
      } catch {}
    }
    const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
    return { keys };
  },
};

/* ── 월간 통계 동기화 (개인 요약 → Firestore) ── */
async function syncMonthlySummary(uid, date) {
  try {
    const month = date.substring(0, 7); // YYYY-MM
    const listResult = await store.list('record:');
    const monthKeys  = (listResult.keys || []).filter(k => k.startsWith(`record:${month}`));

    let totalPractice = 0, totalBaerae = 0, activeDays = 0, cheongsuDays = 0;

    for (const k of monthKeys) {
      const r = await store.get(k);
      if (!r) continue;
      const d = JSON.parse(r.value);
      if ((d.practice || 0) > 0 || (d.baerae || 0) > 0 || d.cheongsu?.morning || d.cheongsu?.evening) {
        activeDays++;
        totalPractice += d.practice || 0;
        totalBaerae   += d.baerae   || 0;
        if (d.cheongsu?.morning || d.cheongsu?.evening) cheongsuDays++;
      }
    }

    await setDoc(doc(db, 'users', uid, 'summary', month), {
      totalPractice, totalBaerae, activeDays, cheongsuDays,
      recordCount: monthKeys.length,
      updatedAt: serverTimestamp(),
    });
  } catch (e) { console.warn('syncMonthlySummary error', e); }
}

/* ── 사용자 프로필 저장 ── */
export async function saveUserProfile({ uid, nickname, tier, email }) {
  try {
    const ref  = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    const isNew = !snap.exists();

    await setDoc(ref, {
      nickname,
      tier: tier || '일반',
      email: email || '',
      lastActive: serverTimestamp(),
      ...(isNew ? { createdAt: serverTimestamp() } : {}),
    }, { merge: true });

    // 신규 가입이면 totalUsers +1
    if (isNew) {
      await setDoc(doc(db, 'stats', 'overview'),
        { totalUsers: increment(1) }, { merge: true });
    }

    // 오늘 접속자 기록
    const today = new Date().toISOString().split('T')[0].replace(/-/g,'');
    await setDoc(doc(db, 'stats', 'daily', today),
      { count: increment(1), date: today }, { merge: true });

  } catch (e) { console.warn('saveUserProfile error', e); }
}
