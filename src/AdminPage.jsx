import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { db, auth, googleProvider, ADMIN_EMAIL } from './firebase.js';

const p2 = n => String(n).padStart(2,'0');
const fmtMins = m => { if(!m) return '0분'; const h=Math.floor(m/60),min=m%60; if(h===0) return`${min}분`; if(min===0) return`${h}시간`; return`${h}시간 ${min}분`; };
const today = () => { const d=new Date(); return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; };
const thisMonth = () => { const d=new Date(); return `${d.getFullYear()}-${p2(d.getMonth()+1)}`; };

export default function AdminPage() {
  const [adminUser, setAdminUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [stats,    setStats]    = useState(null);
  const [users,    setUsers]    = useState([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setAdminUser(u);
      setAuthChecked(true);
      if (u && u.email === ADMIN_EMAIL) loadStats();
    });
    return () => unsub();
  }, []);

  const handleLogin = async () => {
    setLoading(true); setError('');
    try {
      const r = await signInWithPopup(auth, googleProvider);
      if (r.user.email !== ADMIN_EMAIL) {
        await signOut(auth);
        setError('관리자 계정이 아닙니다.');
      }
    } catch { setError('로그인 실패'); }
    setLoading(false);
  };

  const loadStats = async () => {
    setLoading(true);
    try {
      const month = thisMonth();
      const todayStr = today().replace(/-/g,'');

      // 전체 사용자
      const usersSnap = await getDocs(collection(db, 'users'));
      const userList  = usersSnap.docs.map(d => ({
        uid:        d.id,
        nickname:   d.data().nickname  || '(이름없음)',
        email:      d.data().email     || '',
        lastActive: d.data().lastActive?.toDate?.() || null,
        createdAt:  d.data().createdAt?.toDate?.()  || null,
      }));

      // 오늘 접속자
      let todayCount = 0;
      try {
        const daySnap = await getDoc(doc(db, 'stats', 'daily', todayStr));
        todayCount = daySnap.exists() ? (daySnap.data().count || 0) : 0;
      } catch {}

      // 총 가입자
      let totalUsers = userList.length;
      try {
        const ov = await getDoc(doc(db, 'stats', 'overview'));
        if (ov.exists()) totalUsers = ov.data().totalUsers || totalUsers;
      } catch {}

      // 이번달 수행 통계 집계 (각 유저의 summary)
      let totalPractice = 0, totalBaerae = 0, cheongsuDays = 0, activeUsers = 0, recordCount = 0;
      const summaryPromises = userList.map(u =>
        getDoc(doc(db, 'users', u.uid, 'summary', month)).catch(() => null)
      );
      const summaries = await Promise.all(summaryPromises);
      summaries.forEach(s => {
        if (!s || !s.exists()) return;
        const d = s.data();
        if ((d.activeDays || 0) > 0) activeUsers++;
        totalPractice += d.totalPractice || 0;
        totalBaerae   += d.totalBaerae   || 0;
        cheongsuDays  += d.cheongsuDays  || 0;
        recordCount   += d.recordCount   || 0;
      });

      const avgPractice = activeUsers > 0 ? Math.round(totalPractice / activeUsers) : 0;
      const cheongsuRate = recordCount > 0 ? Math.round((cheongsuDays / recordCount) * 100) : 0;

      setStats({ totalUsers, todayCount, avgPractice, cheongsuRate, totalPractice, activeUsers });
      setUsers(userList.sort((a,b) => (b.lastActive||0) - (a.lastActive||0)));
    } catch (e) { console.error(e); setError('데이터 로딩 실패: ' + e.message); }
    setLoading(false);
  };

  const fmt = d => d ? `${d.getFullYear()}.${p2(d.getMonth()+1)}.${p2(d.getDate())}` : '-';

  const S = {
    wrap: { minHeight:'100vh', background:'#F5F0FF', padding:'20px 16px 60px', fontFamily:"'Noto Sans KR',sans-serif", maxWidth:480, margin:'0 auto' },
    loginWrap: { minHeight:'100vh', background:'#0f1b3d', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, fontFamily:"'Noto Sans KR',sans-serif" },
  };

  /* ── 로그인 전 ── */
  if (!authChecked) return <div style={{...S.loginWrap}}><div style={{color:'#C9A84C',fontSize:24}}>⏳</div></div>;

  if (!adminUser || adminUser.email !== ADMIN_EMAIL) return (
    <div style={S.loginWrap}>
      <img src="/icons/icon-96.png" alt="" style={{width:80,height:80,borderRadius:18,marginBottom:16}}/>
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

  /* ── 관리자 대시보드 ── */
  return (
    <div style={S.wrap}>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <div>
          <h1 style={{color:'#5B21B6',fontSize:18,fontWeight:800,margin:0}}>📊 관리자 대시보드</h1>
          <p style={{color:'#A78BFA',fontSize:11,margin:0}}>빛꽃수행일지 · {thisMonth()}</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={loadStats} style={{background:'#EDE9FE',border:'none',borderRadius:8,padding:'6px 12px',color:'#7C3AED',fontSize:12,fontWeight:600,cursor:'pointer'}}>🔄 새로고침</button>
          <button onClick={()=>signOut(auth)} style={{background:'#FEE2E2',border:'none',borderRadius:8,padding:'6px 12px',color:'#EF4444',fontSize:12,fontWeight:600,cursor:'pointer'}}>로그아웃</button>
        </div>
      </div>
      <a href="/" style={{display:'inline-block',color:'#A78BFA',fontSize:12,textDecoration:'none',marginBottom:16}}>← 앱으로</a>

      {loading && <div style={{textAlign:'center',padding:40,color:'#A78BFA'}}>⏳ 불러오는 중...</div>}
      {error && <div style={{background:'#FEE2E2',borderRadius:12,padding:12,color:'#EF4444',fontSize:13,marginBottom:14}}>{error}</div>}

      {stats && (<>
        {/* 주요 지표 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          {[
            ['👥', '총 가입자', `${stats.totalUsers}명`, '#7C3AED', '#F5F3FF'],
            ['📅', '오늘 접속자', `${stats.todayCount}명`, '#059669', '#ECFDF5'],
            ['🕯️', '월 평균 수행', fmtMins(stats.avgPractice), '#B45309', '#FFF7ED'],
            ['💧', '청수 실천율', `${stats.cheongsuRate}%`, '#0D9488', '#F0FDFA'],
          ].map(([icon,label,val,color,bg])=>(
            <div key={label} style={{background:bg,borderRadius:16,padding:'16px 14px',border:`1px solid ${color}22`}}>
              <div style={{fontSize:22,marginBottom:4}}>{icon}</div>
              <div style={{color,fontSize:22,fontWeight:800,lineHeight:1}}>{val}</div>
              <div style={{color:'#9896AA',fontSize:11,marginTop:3}}>{label}</div>
            </div>
          ))}
        </div>

        {/* 이번달 수행 통계 */}
        <div style={{background:'#fff',borderRadius:16,padding:18,marginBottom:14,border:'1px solid #EDE9FE'}}>
          <p style={{color:'#7C3AED',fontSize:13,fontWeight:700,margin:'0 0 14px'}}>📈 이번달 수행 현황</p>
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

        {/* 가입자 명단 */}
        <div style={{background:'#fff',borderRadius:16,padding:18,border:'1px solid #EDE9FE'}}>
          <p style={{color:'#7C3AED',fontSize:13,fontWeight:700,margin:'0 0 12px'}}>
            👤 가입자 명단 ({users.length}명)
          </p>
          <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:360,overflowY:'auto'}}>
            {users.map((u,i)=>(
              <div key={u.uid} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'#FAFAFA',borderRadius:10}}>
                <span style={{fontSize:12,color:'#C084FC',minWidth:22,fontWeight:700}}>{i+1}</span>
                <span style={{flex:1,fontSize:14,color:'#374151',fontWeight:500}}>{u.nickname}</span>
                <span style={{fontSize:11,color:'#9CA3AF'}}>최근 {fmt(u.lastActive)}</span>
              </div>
            ))}
          </div>
        </div>
      </>)}
    </div>
  );
}
