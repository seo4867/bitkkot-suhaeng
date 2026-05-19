import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, deleteDoc, setDoc, increment } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { db, auth, googleProvider, ADMIN_EMAIL } from './firebase.js';

const p2 = n => String(n).padStart(2,'0');
const fmtMins = m => { if(!m)return'0분'; const h=Math.floor(m/60),min=m%60; if(h===0)return`${min}분`; if(min===0)return`${h}시간`; return`${h}시간 ${min}분`; };
const fmt = d => d ? `${d.getFullYear()}.${p2(d.getMonth()+1)}.${p2(d.getDate())}` : '-';
const TIERS = ['어린이','청소년','대학생','일반'];
const TIER_ICON = {'어린이':'🧒','청소년':'🙋','대학생':'🎓','일반':'🌸'};

export default function AdminPage() {
  const [adminUser,  setAdminUser]  = useState(null);
  const [authChecked,setAuthChecked]= useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [stats,      setStats]      = useState(null);
  const [users,      setUsers]      = useState([]);

  // 월 선택 (기본: 이번달)
  const now = new Date();
  const [selYear,  setSelYear]  = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const selMonthStr = `${selYear}-${p2(selMonth)}`;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setAdminUser(u);
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (adminUser && adminUser.email === ADMIN_EMAIL) loadStats();
  }, [adminUser, selMonthStr]);

  const handleLogin = async () => {
    setLoading(true); setError('');
    try {
      const r = await signInWithPopup(auth, googleProvider);
      if (r.user.email !== ADMIN_EMAIL) {
        await signOut(auth); setError('관리자 계정이 아닙니다.');
      }
    } catch { setError('로그인 실패'); }
    setLoading(false);
  };

  const loadStats = async () => {
    setLoading(true);
    try {
      const todayStr = new Date().toISOString().split('T')[0].replace(/-/g,'');

      // 전체 사용자
      const usersSnap = await getDocs(collection(db, 'users'));
      const userList  = usersSnap.docs.map(d => ({
        uid:        d.id,
        nickname:   d.data().nickname || '(이름없음)',
        email:      d.data().email    || '',
        tier:       d.data().tier     || '일반',
        lastActive: d.data().lastActive?.toDate?.() || null,
        createdAt:  d.data().createdAt?.toDate?.()  || null,
      }));

      // 오늘 접속자
      let todayCount = 0;
      try {
        const ds = await getDoc(doc(db, 'stats', 'daily', todayStr));
        todayCount = ds.exists() ? (ds.data().count || 0) : 0;
      } catch {}

      // 총 가입자
      let totalUsers = userList.length;
      try {
        const ov = await getDoc(doc(db, 'stats', 'overview'));
        if (ov.exists()) totalUsers = ov.data().totalUsers || totalUsers;
      } catch {}

      // 선택 월 통계 + 계층별 통계
      const summaryResults = await Promise.all(
        userList.map(u =>
          getDoc(doc(db, 'users', u.uid, 'summary', selMonthStr)).catch(() => null)
        )
      );

      let totalPractice = 0, totalBaerae = 0, cheongsuDays = 0, activeUsers = 0, recordCount = 0;
      const tierStats = {};
      TIERS.forEach(t => { tierStats[t] = { practice:0, baerae:0, cheongsuDays:0, activeDays:0, users:0 }; });

      summaryResults.forEach((s, i) => {
        if (!s || !s.exists()) return;
        const d = s.data();
        const tier = userList[i].tier || '일반';
        if ((d.activeDays || 0) > 0) { activeUsers++; }
        totalPractice += d.totalPractice || 0;
        totalBaerae   += d.totalBaerae   || 0;
        cheongsuDays  += d.cheongsuDays  || 0;
        recordCount   += d.recordCount   || 0;

        // 계층별 집계
        if (tierStats[tier] && (d.activeDays || 0) > 0) {
          tierStats[tier].practice   += d.totalPractice || 0;
          tierStats[tier].baerae     += d.totalBaerae   || 0;
          tierStats[tier].cheongsuDays += d.cheongsuDays || 0;
          tierStats[tier].activeDays += d.activeDays    || 0;
          tierStats[tier].users++;
        }
      });

      const avgPractice  = activeUsers > 0 ? Math.round(totalPractice / activeUsers) : 0;
      const cheongsuRate = recordCount  > 0 ? Math.round((cheongsuDays / recordCount) * 100) : 0;

      setStats({ totalUsers, todayCount, avgPractice, cheongsuRate, totalPractice, activeUsers, tierStats });
      setUsers(userList.sort((a,b) => (b.lastActive||0) - (a.lastActive||0)));
    } catch (e) { setError('데이터 로딩 실패: ' + e.message); }
    setLoading(false);
  };

  const deleteUserData = async (uid, nickname) => {
    if (!window.confirm(`"${nickname}" 님의 모든 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const dataSnap = await getDocs(collection(db, 'users', uid, 'data'));
      for (const d of dataSnap.docs) await deleteDoc(d.ref);
      const sumSnap  = await getDocs(collection(db, 'users', uid, 'summary'));
      for (const d of sumSnap.docs)  await deleteDoc(d.ref);
      await deleteDoc(doc(db, 'users', uid));
      await setDoc(doc(db,'stats','overview'), { totalUsers: increment(-1) }, { merge: true });
      alert(`"${nickname}" 님의 데이터가 삭제됐어요.`);
      await loadStats();
    } catch (e) { alert('삭제 실패: ' + e.message); }
  };

  // 월 이동
  const moveMonth = (dir) => {
    let m = selMonth + dir, y = selYear;
    if (m > 12) { m = 1;  y++; }
    if (m < 1)  { m = 12; y--; }
    setSelMonth(m); setSelYear(y);
  };

  const S = {
    wrap: { minHeight:'100vh', background:'#F5F0FF', padding:'20px 16px 60px', fontFamily:"'Noto Sans KR',sans-serif", maxWidth:480, margin:'0 auto' },
    loginWrap: { minHeight:'100vh', background:'#0f1b3d', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, fontFamily:"'Noto Sans KR',sans-serif" },
    card: { background:'#fff', borderRadius:16, padding:18, marginBottom:14, border:'1px solid #EDE9FE' },
    label: { color:'#7C3AED', fontSize:13, fontWeight:700, margin:'0 0 12px' },
  };

  if (!authChecked) return <div style={S.loginWrap}><div style={{color:'#C9A84C',fontSize:24}}>⏳</div></div>;

  if (!adminUser || adminUser.email !== ADMIN_EMAIL) return (
    <div style={S.loginWrap}>
      <img src="/icons/icon-192.png" alt="" style={{width:80,height:80,borderRadius:18,marginBottom:16}}/>
      <h2 style={{color:'#C9A84C',fontSize:20,fontWeight:800,marginBottom:6,fontFamily:"'Noto Serif KR',serif"}}>관리자 페이지</h2>
      <p style={{color:'#8899BB',fontSize:13,marginBottom:28}}>빛꽃수행일지 · 증산도 대학생 연합회</p>
      <div style={{width:'100%',maxWidth:300}}>
        <button onClick={handleLogin} disabled={loading}
          style={{width:'100%',padding:'14px',borderRadius:14,border:'none',background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,fontSize:15,fontWeight:600,color:'#374151'}}>
          {loading ? '⏳ 로그인 중...' : '🔐 관리자 구글 로그인'}
        </button>
        {error && <p style={{color:'#F87171',fontSize:12,textAlign:'center',marginTop:10}}>{error}</p>}
      </div>
      <a href="/" style={{marginTop:24,color:'#556080',fontSize:12,textDecoration:'none'}}>← 앱으로 돌아가기</a>
    </div>
  );

  return (
    <div style={S.wrap}>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div>
          <h1 style={{color:'#5B21B6',fontSize:18,fontWeight:800,margin:0}}>📊 관리자 대시보드</h1>
          <p style={{color:'#A78BFA',fontSize:11,margin:0}}>빛꽃수행일지 · 증산도 대학생 연합회</p>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={loadStats} style={{background:'#EDE9FE',border:'none',borderRadius:8,padding:'6px 10px',color:'#7C3AED',fontSize:12,fontWeight:600,cursor:'pointer'}}>🔄</button>
          <button onClick={()=>signOut(auth)} style={{background:'#FEE2E2',border:'none',borderRadius:8,padding:'6px 10px',color:'#EF4444',fontSize:12,fontWeight:600,cursor:'pointer'}}>로그아웃</button>
        </div>
      </div>
      <a href="/" style={{display:'inline-block',color:'#A78BFA',fontSize:12,textDecoration:'none',marginBottom:16}}>← 앱으로</a>

      {loading && <div style={{textAlign:'center',padding:32,color:'#A78BFA'}}>⏳ 불러오는 중...</div>}
      {error   && <div style={{background:'#FEE2E2',borderRadius:12,padding:12,color:'#EF4444',fontSize:13,marginBottom:14}}>{error}</div>}

      {stats && (<>
        {/* ── 월 선택기 ── */}
        <div style={{...S.card, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <button onClick={()=>moveMonth(-1)} style={{background:'#EDE9FE',border:'none',borderRadius:8,padding:'8px 14px',color:'#7C3AED',fontSize:16,cursor:'pointer'}}>‹</button>
          <span style={{color:'#5B21B6',fontSize:16,fontWeight:800}}>{selYear}년 {selMonth}월</span>
          <button onClick={()=>moveMonth(1)}
            disabled={selYear===now.getFullYear()&&selMonth===now.getMonth()+1}
            style={{background:'#EDE9FE',border:'none',borderRadius:8,padding:'8px 14px',color:'#7C3AED',fontSize:16,cursor:'pointer',opacity:(selYear===now.getFullYear()&&selMonth===now.getMonth()+1)?0.3:1}}>›</button>
        </div>

        {/* ── 주요 지표 ── */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          {[
            ['👥','총 가입자',`${stats.totalUsers}명`,'#7C3AED','#F5F3FF'],
            ['📅','오늘 접속자',`${stats.todayCount}명`,'#059669','#ECFDF5'],
            ['🕯️','월 평균 수행',fmtMins(stats.avgPractice),'#B45309','#FFF7ED'],
            ['💧','청수 실천율',`${stats.cheongsuRate}%`,'#0D9488','#F0FDFA'],
          ].map(([icon,label,val,color,bg])=>(
            <div key={label} style={{background:bg,borderRadius:16,padding:'16px 14px',border:`1px solid ${color}22`}}>
              <div style={{fontSize:22,marginBottom:4}}>{icon}</div>
              <div style={{color,fontSize:22,fontWeight:800,lineHeight:1}}>{val}</div>
              <div style={{color:'#9896AA',fontSize:11,marginTop:3}}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── 이번달 수행 현황 ── */}
        <div style={S.card}>
          <p style={S.label}>📈 {selMonthStr} 수행 현황</p>
          {[
            ['수행 참여자', `${stats.activeUsers}명 / 전체 ${stats.totalUsers}명`],
            ['전체 총 수행', fmtMins(stats.totalPractice)],
            ['1인 평균 수행', fmtMins(stats.avgPractice)],
            ['청수 실천율', `${stats.cheongsuRate}%`],
          ].map(([label,val])=>(
            <div key={label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:'1px solid #F3F0FF'}}>
              <span style={{color:'#6B7280',fontSize:13}}>{label}</span>
              <span style={{color:'#5B21B6',fontSize:14,fontWeight:700}}>{val}</span>
            </div>
          ))}
        </div>

        {/* ── 계층별 수행 현황 ── */}
        <div style={S.card}>
          <p style={S.label}>👥 계층별 수행 현황 ({selMonthStr})</p>
          {TIERS.map(t => {
            const ts = stats.tierStats[t] || {};
            const total = users.filter(u=>(u.tier||'일반')===t).length;
            const avg   = ts.users > 0 ? Math.round((ts.practice||0) / ts.users) : 0;
            return (
              <div key={t} style={{background:'#F9F7FF',borderRadius:12,padding:'12px 14px',marginBottom:8,border:'1px solid #EDE9FE'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                  <span style={{fontSize:20}}>{TIER_ICON[t]}</span>
                  <span style={{color:'#5B21B6',fontSize:14,fontWeight:700,flex:1}}>{t}</span>
                  <span style={{color:'#9896AA',fontSize:12}}>총 {total}명 중 <b style={{color:'#7C3AED'}}>{ts.users||0}명</b> 참여</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
                  {[
                    ['평균 수행', fmtMins(avg)],
                    ['청수 실천', `${ts.cheongsuDays||0}일`],
                    ['총 배례', `${ts.baerae||0}회`],
                  ].map(([l,v])=>(
                    <div key={l} style={{background:'#fff',borderRadius:8,padding:'6px 8px',textAlign:'center',border:'1px solid #EDE9FE'}}>
                      <div style={{color:'#7C3AED',fontSize:13,fontWeight:700}}>{v}</div>
                      <div style={{color:'#9896AA',fontSize:10,marginTop:2}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── 계층 분포 ── */}
        <div style={S.card}>
          <p style={S.label}>📊 계층 분포</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {TIERS.map(t => {
              const count = users.filter(u=>(u.tier||'일반')===t).length;
              const pct   = stats.totalUsers > 0 ? Math.round(count/stats.totalUsers*100) : 0;
              return (
                <div key={t} style={{background:'#F9F7FF',borderRadius:10,padding:'10px 12px',display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:18}}>{TIER_ICON[t]}</span>
                  <div style={{flex:1}}>
                    <div style={{color:'#5B21B6',fontSize:13,fontWeight:700}}>{t}</div>
                    <div style={{background:'#EDE9FE',borderRadius:4,height:4,marginTop:4}}>
                      <div style={{background:'#7C3AED',borderRadius:4,height:4,width:`${pct}%`,transition:'width 0.5s'}}/>
                    </div>
                  </div>
                  <span style={{color:'#7C3AED',fontSize:14,fontWeight:800}}>{count}<span style={{fontSize:10,color:'#A78BFA'}}>명</span></span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 가입자 명단 ── */}
        <div style={S.card}>
          <p style={S.label}>👤 가입자 명단 ({users.length}명)</p>
          <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:360,overflowY:'auto'}}>
            {users.map((u,i) => (
              <div key={u.uid} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#FAFAFA',borderRadius:10}}>
                <span style={{fontSize:12,color:'#C084FC',minWidth:22,fontWeight:700}}>{i+1}</span>
                <span style={{flex:1,fontSize:13,color:'#374151',fontWeight:500}}>{u.nickname}</span>
                <span style={{fontSize:10,background:'#EDE9FE',color:'#7C3AED',borderRadius:6,padding:'2px 6px',fontWeight:600}}>{u.tier||'일반'}</span>
                <span style={{fontSize:11,color:'#9CA3AF'}}>{fmt(u.lastActive)}</span>
                <button onClick={()=>deleteUserData(u.uid,u.nickname)} title="삭제"
                  style={{background:'none',border:'none',cursor:'pointer',fontSize:14,color:'#EF4444',padding:'2px'}}>🗑️</button>
              </div>
            ))}
          </div>
        </div>
      </>)}
    </div>
  );
}
