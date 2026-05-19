import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, googleProvider, db } from './firebase.js';
import { saveUserProfile } from './db.js';

const TIERS     = ['어린이', '청소년', '대학생', '일반'];
const TIER_ICON = { '어린이':'🧒', '청소년':'🙋', '대학생':'🎓', '일반':'🌸' };

export default function LoginScreen({ onLogin }) {
  const [step,     setStep]     = useState('google'); // 'google' | 'info'
  const [fbUser,   setFbUser]   = useState(null);
  const [nickname, setNickname] = useState('');
  const [tier,     setTier]     = useState('대학생');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  /* ── Step 1: 구글 로그인 ── */
  const handleGoogle = async () => {
    setLoading(true); setError('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user   = result.user;
      // 기존 유저면 저장된 이름/계층 미리 채우기
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          setNickname(snap.data().nickname || user.displayName || '');
          setTier(snap.data().tier || '대학생');
        } else {
          setNickname(user.displayName || '');
        }
      } catch { setNickname(user.displayName || ''); }
      setFbUser(user);
      setStep('info'); // 항상 이름/계층 입력 단계로
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') {
        setError('로그인에 실패했습니다. 다시 시도해 주세요.');
      }
    }
    setLoading(false);
  };

  /* ── Step 2: 이름/계층 저장 후 앱 입장 ── */
  const handleSave = async () => {
    if (!nickname.trim()) { setError('이름을 입력해 주세요.'); return; }
    setLoading(true);
    try {
      await saveUserProfile({ uid: fbUser.uid, nickname: nickname.trim(), tier, email: fbUser.email });
      onLogin({ uid: fbUser.uid, nickname: nickname.trim(), email: fbUser.email });
    } catch { setError('저장 중 오류가 발생했습니다.'); }
    setLoading(false);
  };

  const W = { minHeight:'100vh', background:'#0f1b3d', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 24px', fontFamily:"'Noto Sans KR',sans-serif" };
  const CARD = { width:'100%', maxWidth:320, background:'rgba(255,255,255,0.06)', borderRadius:20, padding:24, border:'1px solid rgba(201,168,76,0.25)' };

  return (
    <div style={W}>
      <img src="/icons/icon-192.png" alt="" style={{width:88,height:88,borderRadius:20,marginBottom:14,boxShadow:'0 8px 28px rgba(0,0,0,0.4)'}}/>
      <div style={{color:'#C9A84C',fontSize:22,fontWeight:800,fontFamily:"'Noto Serif KR',serif",letterSpacing:2,marginBottom:4}}>빛꽃수행일지</div>
      <div style={{color:'#8899BB',fontSize:13,marginBottom:32}}>증산도 대학생 연합회</div>

      <div style={CARD}>
        {/* ─── Step 1: 구글 로그인 ─── */}
        {step === 'google' && (<>
          <p style={{color:'#8899BB',fontSize:13,textAlign:'center',marginBottom:20,lineHeight:1.75}}>
            로그인하면 수행 기록이 클라우드에 저장되어<br/>기기를 바꿔도 이어집니다.
          </p>
          <button onClick={handleGoogle} disabled={loading}
            style={{width:'100%',padding:'14px',borderRadius:13,border:'none',background:'#fff',cursor:'pointer',
                    display:'flex',alignItems:'center',justifyContent:'center',gap:10,
                    fontSize:15,fontWeight:600,color:'#374151',
                    boxShadow:'0 4px 16px rgba(0,0,0,0.25)',opacity:loading?0.7:1}}>
            {loading ? <span>⏳</span> : (
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.2 7.1 29.4 5 24 5 12.4 5 3 14.4 3 26s9.4 21 21 21 21-9.4 21-21c0-1.3-.1-2.7-.4-3.9z"/>
                <path fill="#FF3D00" d="M6.3 15.1l6.6 4.8C14.7 16.2 19 13 24 13c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.2 7.1 29.4 5 24 5 16.3 5 9.7 9.1 6.3 15.1z"/>
                <path fill="#4CAF50" d="M24 47c5.2 0 9.9-1.9 13.5-5.1l-6.2-5.2C29.3 38.6 26.8 39.5 24 39.5c-5.3 0-9.7-3.2-11.3-7.8l-6.7 5.1C9.5 43 16.3 47 24 47z"/>
                <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.2 5.2C41.2 35.3 45 30.7 45 26c0-1.3-.1-2.7-.4-3.9z"/>
              </svg>
            )}
            {loading ? '로그인 중...' : '구글로 시작하기'}
          </button>
          <p style={{color:'#556080',fontSize:11,textAlign:'center',marginTop:16,lineHeight:1.7}}>
            구글 계정 정보는 인증에만 사용되며<br/>수행 기록은 본인만 볼 수 있습니다.
          </p>
        </>)}

        {/* ─── Step 2: 이름 + 계층 입력 ─── */}
        {step === 'info' && (<>
          <p style={{color:'#C9A84C',fontSize:14,fontWeight:700,textAlign:'center',marginBottom:18}}>
            정보를 확인해 주세요 ✨
          </p>

          {/* 이름 */}
          <label style={{color:'#C9A84C',fontSize:12,fontWeight:600,marginBottom:6,display:'block'}}>이름 (닉네임)</label>
          <input value={nickname} onChange={e=>setNickname(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handleSave()}
            placeholder="예: 홍길동" maxLength={10} autoFocus
            style={{width:'100%',padding:'11px 14px',borderRadius:11,
                    border:'1.5px solid rgba(201,168,76,0.35)',
                    background:'rgba(255,255,255,0.09)',color:'#fff',
                    fontSize:14,outline:'none',boxSizing:'border-box',
                    fontFamily:"'Noto Sans KR',sans-serif",marginBottom:18}}/>

          {/* 계층 */}
          <label style={{color:'#C9A84C',fontSize:12,fontWeight:600,marginBottom:8,display:'block'}}>계층</label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:20}}>
            {TIERS.map(t => {
              const sel = tier === t;
              return (
                <button key={t} onClick={()=>setTier(t)}
                  style={{padding:'10px 6px',borderRadius:11,cursor:'pointer',
                          border:`2px solid ${sel?'#C9A84C':'rgba(201,168,76,0.2)'}`,
                          background:sel?'rgba(201,168,76,0.18)':'rgba(255,255,255,0.04)',
                          color:sel?'#E8C97E':'#8899BB',
                          fontSize:13,fontWeight:sel?700:400,
                          display:'flex',flexDirection:'column',alignItems:'center',gap:3,
                          transition:'all 0.15s'}}>
                  <span style={{fontSize:20}}>{TIER_ICON[t]}</span>
                  <span>{t}</span>
                </button>
              );
            })}
          </div>

          <button onClick={handleSave} disabled={loading}
            style={{width:'100%',padding:'13px',borderRadius:13,border:'none',
                    background:'linear-gradient(135deg,#C9A84C,#E8C97E)',
                    cursor:'pointer',fontSize:15,fontWeight:700,color:'#0f1b3d',
                    opacity:loading?0.7:1}}>
            {loading ? '저장 중...' : '시작하기 🌸'}
          </button>

          <button onClick={()=>{setStep('google');setError('');}} disabled={loading}
            style={{width:'100%',padding:'8px',marginTop:8,borderRadius:10,border:'none',
                    background:'transparent',color:'#556080',fontSize:12,cursor:'pointer'}}>
            ← 다른 계정으로 로그인
          </button>
        </>)}

        {error && <p style={{color:'#F87171',fontSize:12,textAlign:'center',marginTop:10}}>{error}</p>}
      </div>
    </div>
  );
}
