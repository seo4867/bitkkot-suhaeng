import { useState } from 'react';
import { signInWithPopup, signInWithRedirect, getRedirectResult } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, googleProvider, db } from './firebase.js';
import { saveUserProfile } from './db.js';
import { useEffect } from 'react';

export default function LoginScreen({ onLogin }) {
  const [step,     setStep]     = useState('login');
  const [nickname, setNickname] = useState('');
  const [fbUser,   setFbUser]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // 리디렉션 로그인 결과 처리
  useEffect(() => {
    setLoading(true);
    getRedirectResult(auth).then(async (result) => {
      if (result?.user) {
        const user = result.user;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          await saveUserProfile({ uid: user.uid, nickname: snap.data().nickname, email: user.email });
          onLogin({ uid: user.uid, nickname: snap.data().nickname, email: user.email });
        } else {
          setFbUser(user);
          setNickname(user.displayName || '');
          setStep('name');
        }
      }
    }).catch(e => {
      console.error(e);
    }).finally(() => setLoading(false));
  }, []);

  const handleGoogle = async () => {
    setLoading(true); setError('');
    try {
      // 팝업 먼저 시도
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        await saveUserProfile({ uid: user.uid, nickname: snap.data().nickname, email: user.email });
        onLogin({ uid: user.uid, nickname: snap.data().nickname, email: user.email });
      } else {
        setFbUser(user);
        setNickname(user.displayName || '');
        setStep('name');
      }
    } catch (e) {
      console.error('Login error:', e.code, e.message);
      // 팝업 차단 시 리디렉션으로 전환
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch (e2) {
          setError('로그인 실패: ' + e2.message);
        }
      } else {
        setError('로그인 실패 (' + e.code + '): 다시 시도해 주세요.');
      }
    }
    setLoading(false);
  };

  const handleSaveName = async () => {
    if (!nickname.trim()) { setError('이름을 입력해 주세요.'); return; }
    setLoading(true);
    try {
      await saveUserProfile({ uid: fbUser.uid, nickname: nickname.trim(), email: fbUser.email });
      onLogin({ uid: fbUser.uid, nickname: nickname.trim(), email: fbUser.email });
    } catch {
      setError('저장 중 오류가 발생했습니다.');
    }
    setLoading(false);
  };

  const S = {
    wrap: { minHeight:'100vh', background:'#0f1b3d', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 24px', fontFamily:"'Noto Sans KR',sans-serif" },
    icon: { width:96, height:96, borderRadius:22, marginBottom:16, boxShadow:'0 8px 32px rgba(0,0,0,0.4)' },
    title: { color:'#C9A84C', fontSize:22, fontWeight:800, fontFamily:"'Noto Serif KR',serif", letterSpacing:2, marginBottom:4 },
    sub: { color:'#8899BB', fontSize:13, marginBottom:36 },
    card: { width:'100%', maxWidth:320, background:'rgba(255,255,255,0.06)', borderRadius:20, padding:24, border:'1px solid rgba(201,168,76,0.2)' },
    label: { color:'#C9A84C', fontSize:13, fontWeight:600, marginBottom:8, display:'block' },
    input: { width:'100%', padding:'12px 14px', borderRadius:12, border:'1.5px solid rgba(201,168,76,0.3)', background:'rgba(255,255,255,0.08)', color:'#fff', fontSize:15, outline:'none', boxSizing:'border-box', fontFamily:"'Noto Sans KR',sans-serif" },
    googleBtn: { width:'100%', padding:'14px', borderRadius:14, border:'none', background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:10, fontSize:15, fontWeight:600, color:'#374151', boxShadow:'0 4px 16px rgba(0,0,0,0.3)' },
    primaryBtn: { width:'100%', padding:'14px', borderRadius:14, border:'none', background:'linear-gradient(135deg,#C9A84C,#E8C97E)', cursor:'pointer', fontSize:15, fontWeight:700, color:'#0f1b3d', marginTop:12 },
    error: { color:'#F87171', fontSize:12, textAlign:'center', marginTop:10 },
    hint: { color:'#556080', fontSize:11, textAlign:'center', marginTop:20, lineHeight:1.7 },
  };

  if (loading && step === 'login') return (
    <div style={S.wrap}>
      <img src="/icons/icon-192.png" alt="빛꽃수행" style={S.icon}/>
      <div style={S.title}>빛꽃수행일지</div>
      <div style={{color:'#8899BB', fontSize:14, marginTop:20}}>⏳ 로그인 중...</div>
    </div>
  );

  return (
    <div style={S.wrap}>
      <img src="/icons/icon-192.png" alt="빛꽃수행" style={S.icon}/>
      <div style={S.title}>빛꽃수행일지</div>
      <div style={S.sub}>증산도 대학생 연합회</div>

      <div style={S.card}>
        {step === 'login' && (
          <>
            <p style={{color:'#8899BB', fontSize:13, textAlign:'center', marginBottom:20, lineHeight:1.7}}>
              로그인하면 수행 기록이 클라우드에 저장되어<br/>기기를 바꿔도 이어집니다.
            </p>
            <button onClick={handleGoogle} disabled={loading} style={S.googleBtn}>
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.2 7.1 29.4 5 24 5 12.4 5 3 14.4 3 26s9.4 21 21 21 21-9.4 21-21c0-1.3-.1-2.7-.4-3.9z"/>
                <path fill="#FF3D00" d="M6.3 15.1l6.6 4.8C14.7 16.2 19 13 24 13c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.2 7.1 29.4 5 24 5 16.3 5 9.7 9.1 6.3 15.1z"/>
                <path fill="#4CAF50" d="M24 47c5.2 0 9.9-1.9 13.5-5.1l-6.2-5.2C29.3 38.6 26.8 39.5 24 39.5c-5.3 0-9.7-3.2-11.3-7.8l-6.7 5.1C9.5 43 16.3 47 24 47z"/>
                <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.2 5.2C41.2 35.3 45 30.7 45 26c0-1.3-.1-2.7-.4-3.9z"/>
              </svg>
              {loading ? '로그인 중...' : '구글로 시작하기'}
            </button>
          </>
        )}

        {step === 'name' && (
          <>
            <p style={{color:'#C9A84C', fontSize:14, fontWeight:600, textAlign:'center', marginBottom:16}}>
              처음 오셨군요! 👋<br/>
              <span style={{color:'#8899BB', fontSize:12, fontWeight:400}}>앱에서 사용할 이름을 입력해 주세요</span>
            </p>
            <label style={S.label}>이름 (닉네임)</label>
            <input
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveName()}
              placeholder="예: 홍길동"
              maxLength={10}
              style={S.input}
              autoFocus
            />
            <button onClick={handleSaveName} disabled={loading} style={S.primaryBtn}>
              {loading ? '저장 중...' : '시작하기 🌸'}
            </button>
          </>
        )}

        {error && <p style={S.error}>{error}</p>}
      </div>

      {step === 'login' && (
        <p style={S.hint}>
          구글 계정 정보는 로그인 인증에만 사용되며<br/>
          수행 기록은 본인만 볼 수 있습니다.
        </p>
      )}
    </div>
  );
}
