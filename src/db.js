/**
 * 데이터 저장소
 * Firestore (클라우드) + IndexedDB 로컬 캐싱
 *
 * ── Firebase 읽기 최적화 전략 ──
 * 사용자가 기록 저장 시 → stats/monthly/{YYYY-MM} 통계 문서 자동 업데이트
 * 관리자 대시보드 → 통계 문서 3개만 읽음 (유저 전체 읽기 안 함)
 */
import {
  doc, getDoc, setDoc, collection, getDocs,
  serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from './firebase.js';
// 로컬 캐싱은 firebase.js에서 초기화 시 설정

let _uid  = null;
let _tier = '일반';
export const setCurrentUser = (uid, tier) => { _uid = uid; _tier = tier || '일반'; };
export const getCurrentUser = () => _uid;
export const clearUser      = () => { _uid = null; _tier = '일반'; };

const enc = k => k.replace(/\//g, '_SL_');
const dec = k => k.replace(/_SL_/g, '/');

/* ══════════════════════════════════════════
   기본 store (기존 앱 인터페이스 유지)
══════════════════════════════════════════ */
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
    try { localStorage.setItem(key, value); } catch {}
    if (_uid) {
      try {
        await setDoc(doc(db, 'users', _uid, 'data', enc(key)), {
          v: value, updatedAt: serverTimestamp(),
        });
        // 기록 저장 시 통계 문서 자동 업데이트
        if (key.startsWith('record:')) {
          await syncStats(_uid, _tier, key.replace('record:', ''));
        }
      } catch (e) { console.warn('Firestore set error', e); }
    }
  },

  list: async (prefix) => {
    if (_uid) {
      try {
        const snap = await getDocs(collection(db, 'users', _uid, 'data'));
        return { keys: snap.docs.map(d => dec(d.id)).filter(k => k.startsWith(prefix)) };
      } catch {}
    }
    return { keys: Object.keys(localStorage).filter(k => k.startsWith(prefix)) };
  },
};

/* ══════════════════════════════════════════
   통계 문서 자동 업데이트 (기록 저장 시 호출)
   → 관리자 대시보드가 이 문서만 읽으면 됨
══════════════════════════════════════════ */
async function syncStats(uid, tier, date) {
  try {
    const month = date.substring(0, 7); // YYYY-MM

    // 1) 개인 월간 요약 계산
    const listResult = await store.list('record:');
    const monthKeys  = (listResult.keys || []).filter(k => k.startsWith(`record:${month}`));

    let totalPractice = 0, totalBaerae = 0, activeDays = 0, cheongsuDays = 0;
    for (const k of monthKeys) {
      const r = await store.get(k);
      if (!r) continue;
      const d = JSON.parse(r.value);
      if ((d.practice||0)>0 || (d.baerae||0)>0 || d.cheongsu?.morning || d.cheongsu?.evening) {
        activeDays++;
        totalPractice += d.practice || 0;
        totalBaerae   += d.baerae   || 0;
        if (d.cheongsu?.morning || d.cheongsu?.evening) cheongsuDays++;
      }
    }

    // 2) 개인 요약 저장
    await setDoc(doc(db, 'users', uid, 'summary', month), {
      totalPractice, totalBaerae, activeDays, cheongsuDays,
      recordCount: monthKeys.length, updatedAt: serverTimestamp(),
    });

    // 3) ★ 전체 통계 문서 업데이트 (관리자용)
    //    각 유저의 최신 기여분을 계산해서 덮어씀
    const statsRef = doc(db, 'stats', `monthly_${month}`);
    const statsSnap = await getDoc(statsRef);
    const existing = statsSnap.exists() ? statsSnap.data() : {};

    // 이 유저의 이전 기여분 빼고, 새 기여분 더하기
    const prevContrib = existing.userContribs?.[uid] || {};
    const tierKey = `tier_${tier}`;
    const prevTierKey = prevContrib.tier ? `tier_${prevContrib.tier}` : tierKey;

    const newStats = {
      // 전체 합계
      totalPractice:  ((existing.totalPractice  || 0) - (prevContrib.practice||0)  + totalPractice),
      totalBaerae:    ((existing.totalBaerae    || 0) - (prevContrib.baerae||0)    + totalBaerae),
      totalCheongsu:  ((existing.totalCheongsu  || 0) - (prevContrib.cheongsu||0)  + cheongsuDays),
      totalActiveDays:((existing.totalActiveDays|| 0) - (prevContrib.activeDays||0)+ activeDays),
      totalRecords:   ((existing.totalRecords   || 0) - (prevContrib.records||0)   + monthKeys.length),

      // 계층별 합계 (이전 계층에서 빼고 현재 계층에 더하기)
      [`${prevTierKey}_practice`]:   ((existing[`${prevTierKey}_practice`]||0)   - (prevContrib.practice||0)),
      [`${prevTierKey}_cheongsu`]:   ((existing[`${prevTierKey}_cheongsu`]||0)   - (prevContrib.cheongsu||0)),
      [`${prevTierKey}_baerae`]:     ((existing[`${prevTierKey}_baerae`]||0)     - (prevContrib.baerae||0)),
      [`${prevTierKey}_activeDays`]: ((existing[`${prevTierKey}_activeDays`]||0) - (prevContrib.activeDays||0)),
      [`${tierKey}_practice`]:       ((existing[`${tierKey}_practice`]||0)   + totalPractice),
      [`${tierKey}_cheongsu`]:       ((existing[`${tierKey}_cheongsu`]||0)   + cheongsuDays),
      [`${tierKey}_baerae`]:         ((existing[`${tierKey}_baerae`]||0)     + totalBaerae),
      [`${tierKey}_activeDays`]:     ((existing[`${tierKey}_activeDays`]||0) + activeDays),

      // 이 유저의 최신 기여분 저장 (다음 업데이트 시 diff 계산용)
      userContribs: {
        ...(existing.userContribs || {}),
        [uid]: { practice:totalPractice, baerae:totalBaerae, cheongsu:cheongsuDays, activeDays, records:monthKeys.length, tier },
      },
      updatedAt: serverTimestamp(),
    };

    // 음수 방지
    Object.keys(newStats).forEach(k => {
      if (typeof newStats[k] === 'number' && newStats[k] < 0) newStats[k] = 0;
    });

    await setDoc(statsRef, newStats, { merge: true });

  } catch (e) { console.warn('syncStats error', e); }
}

/* ══════════════════════════════════════════
   사용자 프로필 저장
   → userList 캐시 문서도 함께 업데이트
══════════════════════════════════════════ */
export async function saveUserProfile({ uid, nickname, tier, email }) {
  try {
    const ref   = doc(db, 'users', uid);
    const snap  = await getDoc(ref);
    const isNew = !snap.exists();

    await setDoc(ref, {
      nickname, email: email||'', tier: tier||'일반',
      lastActive: serverTimestamp(),
      ...(isNew ? { createdAt: serverTimestamp() } : {}),
    }, { merge: true });

    // ★ userList 캐시 문서 업데이트 (관리자 명단용 - 1개 문서만 읽으면 됨)
    const entry = { uid, nickname, tier: tier||'일반', email: email||'', lastActive: new Date().toISOString() };
    await setDoc(doc(db, 'stats', 'userList'), {
      users: { [uid]: entry },
      updatedAt: serverTimestamp(),
    }, { merge: true });

    if (isNew) {
      await setDoc(doc(db, 'stats', 'overview'), { totalUsers: increment(1) }, { merge: true });
    }

    // 일별 접속 집계
    const today = new Date().toISOString().split('T')[0].replace(/-/g,'');
    await setDoc(doc(db, 'stats', 'daily', today), { count: increment(1) }, { merge: true });

  } catch (e) { console.warn('saveUserProfile error', e); }
}

/* ══════════════════════════════════════════════
   기존 localStorage 기록을 Firebase로 동기화
   로그인 시 1회 실행 → summary 문서 생성
══════════════════════════════════════════════ */
export async function syncLocalToFirestore(uid, tier) {
  try {
    // 이미 동기화했는지 확인 (중복 방지)
    const doneKey = `_synced_${uid}`;
    if (localStorage.getItem(doneKey)) return;

    const keys = Object.keys(localStorage).filter(k => k.startsWith('record:'));
    if (keys.length === 0) return;

    console.log(`[Sync] ${keys.length}개 기록 동기화 시작...`);

    // 각 기록을 Firestore에 저장
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (!value) continue;
      try {
        await setDoc(doc(db, 'users', uid, 'data', enc(key)), {
          v: value,
          updatedAt: serverTimestamp(),
        });
      } catch (e) { console.warn('sync error:', key, e); }
    }

    // 월별 summary 재계산
    const months = [...new Set(keys.map(k => k.replace('record:', '').substring(0, 7)))];
    for (const month of months) {
      const monthKeys = keys.filter(k => k.startsWith(`record:${month}`));
      let totalPractice=0, totalBaerae=0, activeDays=0, cheongsuDays=0;

      for (const k of monthKeys) {
        const r = localStorage.getItem(k);
        if (!r) continue;
        try {
          const d = JSON.parse(r);
          if ((d.practice||0)>0||(d.baerae||0)>0||d.cheongsu?.morning||d.cheongsu?.evening) {
            activeDays++;
            totalPractice += d.practice||0;
            totalBaerae   += d.baerae  ||0;
            if (d.cheongsu?.morning||d.cheongsu?.evening) cheongsuDays++;
          }
        } catch {}
      }

      if (activeDays > 0) {
        await setDoc(doc(db, 'users', uid, 'summary', month), {
          totalPractice, totalBaerae, activeDays, cheongsuDays,
          recordCount: monthKeys.length, updatedAt: serverTimestamp(),
        });
        console.log(`[Sync] ${month} summary 저장 완료 (수행${activeDays}일)`);
      }
    }

    // 동기화 완료 표시
    localStorage.setItem(doneKey, '1');
    console.log('[Sync] 동기화 완료!');
  } catch (e) { console.warn('syncLocalToFirestore error:', e); }
}
