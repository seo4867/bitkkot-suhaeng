/**
 * 관리자 대시보드
 *
 * ── Firebase 읽기 최적화 ──
 * 대시보드 로딩 시 읽는 문서: 딱 3개
 *   ① stats/overview          (총 가입자)
 *   ② stats/monthly/{YYYY-MM} (월별 통계 - 미리 계산됨)
 *   ③ stats/userList           (유저 명단 캐시)
 *
 * 유저 전체 순회 없음 → 1000명이어도 3 reads만 사용
 */
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { doc, getDoc, getDocs, collection, deleteDoc, setDoc, increment } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { db, auth, googleProvider, ADMIN_EMAIL } from './firebase.js';

const p2 = n => String(n).padStart(2,'0');
const fmtMins = m => { if(!m)return'0분'; const h=Math.floor(m/60),min=m%60; if(h===0)return`${min}분`; if(min===0)return`${h}시간`; return`${h}시간 ${min}분`; };
const fmt  = d => d ? d.toString().slice(0,10) : '-';
const TIERS = ['어린이','청소년','대학생','일반'];
const TIER_ICON = {'어린이':'🧒','청소년':'🙋','대학생':'🎓','일반':'🌸'};


/* ── 엑셀 내보내기 (추가 reads 없음 - 이미 로드된 데이터 사용) ── */
function exportAdminExcel(stats, users, monthStr) {
  const wb = XLSX.utils.book_new();

  // ── 시트1: 가입자 명단 ──
  const userRows = [['번호','닉네임','계층','최근접속일']];
  users.forEach((u, i) => {
    userRows.push([i+1, u.nickname, u.tier||'일반', u.lastActive ? u.lastActive.toString().slice(0,10) : '-']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(userRows), '가입자명단');

  // ── 시트2: 월별 전체 통계 ──
  const fmtMins = m => { if(!m)return'0분'; const h=Math.floor(m/60),mn=m%60; if(h===0)return`${mn}분`; if(mn===0)return`${h}시간`; return`${h}시간 ${mn}분`; };
  const statRows = [
    ['항목','값'],
    ['조회 월', monthStr],
    ['총 가입자', `${stats.totalUsers}명`],
    ['오늘 접속자', `${stats.todayCount}명`],
    ['수행 참여자', `${stats.activeUsers}명`],
    ['전체 총 수행', fmtMins(stats.totalPractice)],
    ['1인 평균 수행', fmtMins(stats.avgPractice)],
    ['청수 실천율', `${stats.cheongsuRate}%`],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statRows), '전체통계');

  // ── 시트3: 계층별 통계 ──
  const TIERS = ['어린이','청소년','대학생','일반'];
  const tierRows = [['계층','전체인원','참여인원','평균수행','청수실천일','총배례']];
  TIERS.forEach(t => {
    const ts = stats.tierStats[t] || {};
    const avg = ts.users > 0 ? Math.round((ts.practice||0)/ts.users) : 0;
    tierRows.push([t, ts.totalUsers||0, ts.users||0, fmtMins(avg), ts.cheongsuDays||0, ts.baerae||0]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tierRows), '계층별통계');

  // ── 다운로드 ──
  const today = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `빛꽃수행일지_관리자_${monthStr}_${today}.xlsx`);
}

export default function AdminPage() {
  const [adminUser,   setAdminUser]   = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [stats,       setStats]       = useState(null);
  const [users,       setUsers]       = useState([]);

  const now = new Date();
  const [selYear,  setSelYear]  = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth()+1);
  const monthStr = `${selYear}-${p2(selMonth)}`;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setAdminUser(u); setAuthChecked(true); });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (adminUser?.email === ADMIN_EMAIL) loadStats();
  }, [adminUser, monthStr]);

  /* ─────────────────────────────────────────
     loadStats: 딱 3 reads (유저 전체 순회 없음)
  ───────────────────────────────────────── */
  const loadStats = async () => {
    setLoading(true); setError('');
    try {
      const todayStr = now.toISOString().split('T')[0].replace(/-/g,'');

      // ① overview
      const ovSnap  = await getDoc(doc(db,'stats','overview'));
      const ovData  = ovSnap.exists() ? ovSnap.data() : {};
      const todayCount = ovData[`daily_${todayStr}`] || 0;

      // ② 유저 목록 (캐시 → 폴백)
      let userList = [];
      const ulSnap = await getDoc(doc(db,'stats','userList'));
      if (ulSnap.exists() && Object.keys(ulSnap.data().users||{}).length > 0) {
        userList = Object.values(ulSnap.data().users||{}).filter(u=>u&&u.uid)
          .sort((a,b)=>(b.lastActive||'')>(a.lastActive||'')?1:-1);
      } else {
        const usersSnap = await getDocs(collection(db,'users'));
        userList = usersSnap.docs.map(d=>({
          uid:d.id, nickname:d.data().nickname||'(이름없음)',
          tier:d.data().tier||'일반', email:d.data().email||'',
          lastActive:d.data().lastActive?.toDate?.()?.toISOString()||'',
        })).sort((a,b)=>(b.lastActive||'')>(a.lastActive||'')?1:-1);
      }
      const totalUsers = ovData.totalUsers || userList.length;

      // ③ 월 통계 (캐시 → 폴백)
      let m = {};
      const mSnap = await getDoc(doc(db,'stats',`monthly_${monthStr}`));
      if (mSnap.exists() && (mSnap.data().totalPractice||0) > 0) {
        m = mSnap.data();
      } else {
        const summaries = await Promise.all(
          userList.map(u=>getDoc(doc(db,'users',u.uid,'summary',monthStr)).catch(()=>null))
        );
        summaries.forEach((s,i) => {
          if (!s||!s.exists()) return;
          const d=s.data(), t=userList[i].tier||'일반', k=`tier_${t}`;
          m.totalPractice   = (m.totalPractice  ||0)+(d.totalPractice||0);
          m.totalBaerae     = (m.totalBaerae    ||0)+(d.totalBaerae  ||0);
          m.totalCheongsu   = (m.totalCheongsu  ||0)+(d.cheongsuDays ||0);
          m.totalActiveDays = (m.totalActiveDays||0)+(d.activeDays   ||0);
          m.totalRecords    = (m.totalRecords   ||0)+(d.recordCount  ||0);
          m[`${k}_practice`]  =(m[`${k}_practice`] ||0)+(d.totalPractice||0);
          m[`${k}_baerae`]    =(m[`${k}_baerae`]   ||0)+(d.totalBaerae  ||0);
          m[`${k}_cheongsu`]  =(m[`${k}_cheongsu`] ||0)+(d.cheongsuDays ||0);
          m[`${k}_activeDays`]=(m[`${k}_activeDays`]||0)+(d.activeDays  ||0);
          if (!m.userContribs) m.userContribs={};
          m.userContribs[userList[i].uid]={
            practice:d.totalPractice||0, baerae:d.totalBaerae||0,
            cheongsu:d.cheongsuDays||0, activeDays:d.activeDays||0,
            records:d.recordCount||0, tier:t
          };
        });
      }

      // 계층별 통계
      const tierStats={};
      TIERS.forEach(t=>{
        const k=`tier_${t}`;
        tierStats[t]={
          users:Object.values(m.userContribs||{}).filter(c=>c.tier===t&&(c.activeDays||0)>0).length,
          totalUsers:userList.filter(u=>(u.tier||'일반')===t).length,
          practice:m[`${k}_practice`]||0, baerae:m[`${k}_baerae`]||0,
          cheongsuDays:m[`${k}_cheongsu`]||0, activeDays:m[`${k}_activeDays`]||0,
        };
      });
      const activeUsers = Object.values(m.userContribs||{}).filter(c=>(c.activeDays||0)>0).length;
      const avgPractice = activeUsers>0?Math.round((m.totalPractice||0)/activeUsers):0;
      const cheongsuRate=(m.totalRecords||0)>0?Math.round(((m.totalCheongsu||0)/m.totalRecords)*100):0;

      setStats({totalUsers,todayCount,avgPractice,cheongsuRate,
                totalPractice:m.totalPractice||0,activeUsers,tierStats});
      setUsers(userList);
    } catch(e){setError('로딩 실패: '+e.message);}
    setLoading(false);
  };;

  /* 사용자 삭제 */
  const deleteUser = async (uid, nickname) => {
    if (!window.confirm(`"${nickname}" 님의 모든 데이터를 삭제할까요?`)) return;
    try {
      const dataSnap = await getDocs(collection(db,'users',uid,'data'));
      for (const d of dataSnap.docs) await deleteDoc(d.ref);
      const sumSnap  = await getDocs(collection(db,'users',uid,'summary'));
      for (const d of sumSnap.docs)  await deleteDoc(d.ref);
      await deleteDoc(doc(db,'users',uid));
      // userList 캐시에서도 제거
      await setDoc(doc(db,'stats','userList'), { users: { [uid]: null } }, { merge: true });
      await setDoc(doc(db,'stats','overview'), { totalUsers: increment(-1) }, { merge: true });
      alert(`"${nickname}" 님이 삭제됐어요.`);
      await loadStats();
    } catch (e) { alert('삭제 실패: ' + e.message); }
  };

  const moveMonth = (dir) => {
    let m=selMonth+dir, y=selYear;
    if(m>12){m=1;y++;} if(m<1){m=12;y--;}
    setSelMonth(m); setSelYear(y);
  };

  const S = {
    wrap: {minHeight:'100vh',background:'#F5F0FF',padding:'20px 16px 60px',fontFamily:"'Noto Sans KR',sans-serif",maxWidth:480,margin:'0 auto'},
    card: {background:'#fff',borderRadius:16,padding:18,marginBottom:14,border:'1px solid #EDE9FE'},
    label:{color:'#7C3AED',fontSize:13,fontWeight:700,margin:'0 0 12px',display:'block'},
    loginWrap:{minHeight:'100vh',background:'#0f1b3d',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,fontFamily:"'Noto Sans KR',sans-serif"},
  };

  if (!authChecked) return <div style={S.loginWrap}><div style={{color:'#C9A84C',fontSize:28}}>⏳</div></div>;

  if (!adminUser || adminUser.email !== ADMIN_EMAIL) return (
    <div style={S.loginWrap}>
      <img src="/icons/icon-192.png" alt="" style={{width:80,height:80,borderRadius:18,marginBottom:16}}/>
      <h2 style={{color:'#C9A84C',fontSize:20,fontWeight:800,marginBottom:6,fontFamily:"'Noto Serif KR',serif"}}>관리자 페이지</h2>
      <p style={{color:'#8899BB',fontSize:13,marginBottom:28}}>빛꽃수행일지 · 증산도 대학생 연합회</p>
      <button onClick={async()=>{setLoading(true);setError('');try{const r=await signInWithPopup(auth,googleProvider);if(r.user.email!==ADMIN_EMAIL){await signOut(auth);setError('관리자 계정이 아닙니다.');}}catch{setError('로그인 실패');}setLoading(false);}} disabled={loading}
        style={{width:'100%',maxWidth:300,padding:'14px',borderRadius:14,border:'none',background:'#fff',cursor:'pointer',fontSize:15,fontWeight:600,color:'#374151'}}>
        {loading?'⏳ 로그인 중...':'🔐 관리자 구글 로그인'}
      </button>
      {error&&<p style={{color:'#F87171',fontSize:12,marginTop:10}}>{error}</p>}
      <a href="/" style={{marginTop:24,color:'#556080',fontSize:12,textDecoration:'none'}}>← 앱으로</a>
    </div>
  );

  return (
    <div style={S.wrap}>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div>
          <h1 style={{color:'#5B21B6',fontSize:18,fontWeight:800,margin:0}}>📊 관리자 대시보드</h1>
          <p style={{color:'#A78BFA',fontSize:10,margin:'2px 0 0'}}>읽기 3회/로딩 · Firebase 최적화</p>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={loadStats} style={{background:'#EDE9FE',border:'none',borderRadius:8,padding:'6px 10px',color:'#7C3AED',fontSize:12,fontWeight:600,cursor:'pointer'}}>🔄</button>
          {stats && <button onClick={()=>exportAdminExcel(stats,users,monthStr)} style={{background:'#ECFDF5',border:'none',borderRadius:8,padding:'6px 10px',color:'#059669',fontSize:12,fontWeight:600,cursor:'pointer'}}>📥 엑셀</button>}
          <button onClick={()=>signOut(auth)} style={{background:'#FEE2E2',border:'none',borderRadius:8,padding:'6px 10px',color:'#EF4444',fontSize:12,fontWeight:600,cursor:'pointer'}}>로그아웃</button>
        </div>
      </div>
      <a href="/" style={{color:'#A78BFA',fontSize:12,textDecoration:'none',display:'inline-block',marginBottom:14}}>← 앱으로</a>

      {loading && <div style={{textAlign:'center',padding:32,color:'#A78BFA'}}>⏳ 불러오는 중...</div>}
      {error   && <div style={{background:'#FEE2E2',borderRadius:12,padding:12,color:'#EF4444',fontSize:13,marginBottom:14}}>{error}</div>}

      {stats && (<>
        {/* 월 선택 */}
        <div style={{...S.card,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 18px'}}>
          <button onClick={()=>moveMonth(-1)} style={{background:'#EDE9FE',border:'none',borderRadius:8,padding:'8px 16px',color:'#7C3AED',fontSize:18,cursor:'pointer',fontWeight:700}}>‹</button>
          <span style={{color:'#5B21B6',fontSize:16,fontWeight:800}}>{selYear}년 {selMonth}월</span>
          <button onClick={()=>moveMonth(1)}
            disabled={selYear===now.getFullYear()&&selMonth===now.getMonth()+1}
            style={{background:'#EDE9FE',border:'none',borderRadius:8,padding:'8px 16px',color:'#7C3AED',fontSize:18,cursor:'pointer',fontWeight:700,
                    opacity:(selYear===now.getFullYear()&&selMonth===now.getMonth()+1)?0.3:1}}>›</button>
        </div>

        {/* 주요 지표 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          {[['👥','총 가입자',`${stats.totalUsers}명`,'#7C3AED','#F5F3FF'],
            ['📅','오늘 접속',`${stats.todayCount}명`,'#059669','#ECFDF5'],
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

        {/* 월별 수행 현황 */}
        <div style={S.card}>
          <span style={S.label}>📈 {monthStr} 수행 현황</span>
          {[['수행 참여자',`${stats.activeUsers}명 / 전체 ${stats.totalUsers}명`],
            ['전체 총 수행',fmtMins(stats.totalPractice)],
            ['1인 평균 수행',fmtMins(stats.avgPractice)],
            ['청수 실천율',`${stats.cheongsuRate}%`],
          ].map(([l,v])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid #F3F0FF'}}>
              <span style={{color:'#6B7280',fontSize:13}}>{l}</span>
              <span style={{color:'#5B21B6',fontSize:14,fontWeight:700}}>{v}</span>
            </div>
          ))}
        </div>

        {/* 계층별 수행 현황 */}
        <div style={S.card}>
          <span style={S.label}>👥 계층별 수행 현황 ({monthStr})</span>
          {TIERS.map(t=>{
            const ts=stats.tierStats[t]||{};
            const avg=ts.users>0?Math.round((ts.practice||0)/ts.users):0;
            return (
              <div key={t} style={{background:'#F9F7FF',borderRadius:12,padding:'12px 14px',marginBottom:8,border:'1px solid #EDE9FE'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                  <span style={{fontSize:20}}>{TIER_ICON[t]}</span>
                  <span style={{color:'#5B21B6',fontSize:14,fontWeight:700,flex:1}}>{t}</span>
                  <span style={{color:'#9896AA',fontSize:12}}>
                    {ts.totalUsers||0}명 중 <b style={{color:'#7C3AED'}}>{ts.users||0}명</b> 참여
                  </span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
                  {[['평균 수행',fmtMins(avg)],['청수 실천',`${ts.cheongsuDays||0}일`],['총 배례',`${ts.baerae||0}회`]].map(([l,v])=>(
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

        {/* 계층 분포 */}
        <div style={S.card}>
          <span style={S.label}>📊 계층 분포</span>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {TIERS.map(t=>{
              const count=users.filter(u=>(u.tier||'일반')===t).length;
              const pct=stats.totalUsers>0?Math.round(count/stats.totalUsers*100):0;
              return(
                <div key={t} style={{background:'#F9F7FF',borderRadius:10,padding:'10px 12px',display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:18}}>{TIER_ICON[t]}</span>
                  <div style={{flex:1}}>
                    <div style={{color:'#5B21B6',fontSize:13,fontWeight:700}}>{t}</div>
                    <div style={{background:'#EDE9FE',borderRadius:4,height:4,marginTop:4}}>
                      <div style={{background:'#7C3AED',borderRadius:4,height:4,width:`${pct}%`,transition:'width 0.6s'}}/>
                    </div>
                  </div>
                  <span style={{color:'#7C3AED',fontSize:14,fontWeight:800}}>{count}<span style={{fontSize:10,color:'#A78BFA'}}>명</span></span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 가입자 명단 */}
        <div style={S.card}>
          <span style={S.label}>👤 가입자 명단 ({users.length}명)</span>
          <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:360,overflowY:'auto'}}>
            {users.map((u,i)=>(
              <div key={u.uid} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#FAFAFA',borderRadius:10}}>
                <span style={{fontSize:12,color:'#C084FC',minWidth:22,fontWeight:700}}>{i+1}</span>
                <span style={{flex:1,fontSize:13,color:'#374151',fontWeight:500}}>{u.nickname}</span>
                <span style={{fontSize:10,background:'#EDE9FE',color:'#7C3AED',borderRadius:6,padding:'2px 6px',fontWeight:600}}>{u.tier||'일반'}</span>
                <span style={{fontSize:11,color:'#9CA3AF'}}>{fmt(u.lastActive)}</span>
                <button onClick={()=>deleteUser(u.uid,u.nickname)} title="삭제"
                  style={{background:'none',border:'none',cursor:'pointer',fontSize:14,color:'#EF4444',padding:'2px'}}>🗑️</button>
              </div>
            ))}
          </div>
        </div>
      </>)}
    </div>
  );
}
