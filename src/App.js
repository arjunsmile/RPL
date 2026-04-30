import React, { useState, useEffect, useRef, useCallback } from 'react';
import { storage } from './firebase';
import { ALL_PLAYERS, TEAMS_INIT, DEFAULT_PASSWORDS, ROLE_ICON, BASE_PRICE, BID_INC, MAX_SQUAD, TIMER_DURATION } from './data';

const STATE_KEY = "state";
const PW_KEY = "passwords";
const CONFIG_KEY = "config";

const defaultConfig = () => ({
  baseBudget: 10000,
  basePrice: 100,
  bidIncrement: 50,
  maxSquad: 12,
  timerDuration: 15,
  playerValues: {},
});

const defaultState = (cfg) => {
  const budget = cfg?.baseBudget || 10000;
  return {
    teams: TEAMS_INIT.map(t => ({...t, budget})),
    pool: ALL_PLAYERS.map(p => p.id),
    currentPlayerId: null,
    currentBid: cfg?.basePrice || BASE_PRICE,
    highestBidder: null,
    phase: "waiting",
    timerEnd: null,
    soldLog: [],
    unsoldIds: [],
    lastUpdate: Date.now(),
  };
};

function App() {
  const [portal, setPortal] = useState(null);
  const [state, setState] = useState(defaultState());
  const [config, setConfig] = useState(defaultConfig());
  const [passwords, setPasswords] = useState(DEFAULT_PASSWORDS);
  const [loginTarget, setLoginTarget] = useState(null);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwMgmt, setPwMgmt] = useState(false);
  const [configMgmt, setConfigMgmt] = useState(false);
  const [newPwInputs, setNewPwInputs] = useState({});
  const [pwSaveMsg, setPwSaveMsg] = useState("");
  const countRef = useRef(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [editingTeam, setEditingTeam] = useState(null);
  const [editName, setEditName] = useState("");
  const [attempts, setAttempts] = useState({});
  const [locked, setLocked] = useState({});
  const [connected, setConnected] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const configRef = useRef(config);
  configRef.current = config;
  const [adminTab, setAdminTab] = useState("auction");
  const [captainTab, setCaptainTab] = useState("auction");
  const [playerFilter, setPlayerFilter] = useState("all"); // all | sold | pending | unsold
  const [roleFilter, setRoleFilter] = useState("All");

  // Firebase subscriptions
  useEffect(() => {
    const unsubState = storage.subscribe(STATE_KEY, (result) => {
      if (result?.value) {
        try { setState(typeof result.value === 'string' ? JSON.parse(result.value) : result.value); setConnected(true); } catch(e) {}
      }
    });
    const unsubPw = storage.subscribe(PW_KEY, (result) => {
      if (result?.value) { try { setPasswords(typeof result.value === 'string' ? JSON.parse(result.value) : result.value); } catch(e) {} }
    });
    const unsubCfg = storage.subscribe(CONFIG_KEY, (result) => {
      if (result?.value) { try { setConfig(typeof result.value === 'string' ? JSON.parse(result.value) : result.value); } catch(e) {} }
    });
    (async () => {
      const es = await storage.get(STATE_KEY);
      if (!es) await storage.set(STATE_KEY, JSON.stringify(defaultState()));
      const ep = await storage.get(PW_KEY);
      if (!ep) await storage.set(PW_KEY, JSON.stringify(DEFAULT_PASSWORDS));
      const ec = await storage.get(CONFIG_KEY);
      if (!ec) await storage.set(CONFIG_KEY, JSON.stringify(defaultConfig()));
      else { try { setConfig(typeof ec.value === 'string' ? JSON.parse(ec.value) : ec.value); } catch(e) {} }
      setConnected(true);
    })();
    return () => { unsubState(); unsubPw(); unsubCfg(); };
  }, []);

  // Timer
  useEffect(() => {
    if (state.timerEnd && state.phase === "live") {
      const tick = () => {
        const left = Math.max(0, Math.ceil((state.timerEnd - Date.now()) / 1000));
        setTimeLeft(left);
        if (left <= 0) { clearInterval(countRef.current); if (portal === "admin" && state.highestBidder) handleSold(); }
      };
      tick(); countRef.current = setInterval(tick, 300); return () => clearInterval(countRef.current);
    } else setTimeLeft(0);
  }, [state.timerEnd, state.phase, portal]);

  const update = async (changes) => { const ns = {...stateRef.current, ...changes, lastUpdate: Date.now()}; setState(ns); await storage.set(STATE_KEY, JSON.stringify(ns)); };
  const updateConfig = async (changes) => { const nc = {...configRef.current, ...changes}; setConfig(nc); await storage.set(CONFIG_KEY, JSON.stringify(nc)); };

  // Login
  const attemptLogin = () => {
    if (!loginTarget) return;
    const key = String(loginTarget);
    if (locked[key] && Date.now() < locked[key]) { setPwError(`Locked for ${Math.ceil((locked[key]-Date.now())/1000)}s`); return; }
    if (pwInput === passwords[loginTarget]) {
      setPortal(loginTarget); setLoginTarget(null); setPwInput(""); setPwError(""); setShowPw(false);
      setAttempts(a => ({...a,[key]:0}));
    } else {
      const nc = (attempts[key]||0)+1; setAttempts(a => ({...a,[key]:nc}));
      if (nc >= 3) { setLocked(l => ({...l,[key]:Date.now()+30000})); setPwError("Locked for 30 seconds."); }
      else setPwError(`Incorrect. ${3-nc} attempt(s) left.`);
    }
  };
  const cancelLogin = () => { setLoginTarget(null); setPwInput(""); setPwError(""); setShowPw(false); };

  const handleSavePasswords = async () => {
    const updated = {...passwords}; let changed = false;
    Object.entries(newPwInputs).forEach(([k,v]) => { if(v&&v.trim().length>=4){ updated[k]=v.trim(); changed=true; }});
    if (changed) { setPasswords(updated); await storage.set(PW_KEY, JSON.stringify(updated)); setNewPwInputs({}); setPwSaveMsg("Updated!"); setTimeout(()=>setPwSaveMsg(""),3000); }
    else { setPwSaveMsg("Min 4 chars required."); setTimeout(()=>setPwSaveMsg(""),3000); }
  };

  // Auction
  const getBasePrice = (playerId) => config.playerValues?.[playerId] || config.basePrice || BASE_PRICE;

  const startPlayer = async (pid) => {
    const bp = getBasePrice(pid);
    await update({currentPlayerId:pid,currentBid:bp,highestBidder:null,phase:"live",timerEnd:null});
  };
  const startRandom = async () => { const s=stateRef.current; if(!s.pool.length) return; await startPlayer(s.pool[Math.floor(Math.random()*s.pool.length)]); };

  const handleSold = async () => {
    const s = stateRef.current;
    if(!s.highestBidder||s.currentPlayerId===null) return;
    const p = ALL_PLAYERS[s.currentPlayerId];
    await update({
      teams: s.teams.map(t => t.id===s.highestBidder ? {...t, budget:t.budget-s.currentBid, players:[...t.players,{...p,price:s.currentBid}]} : t),
      pool: s.pool.filter(id => id!==s.currentPlayerId), phase:"sold", timerEnd:null,
      soldLog: [...s.soldLog, {playerId:s.currentPlayerId, teamId:s.highestBidder, price:s.currentBid}],
    });
  };

  const handleUnsold = async () => {
    const s = stateRef.current;
    await update({phase:"unsold",timerEnd:null,unsoldIds:[...s.unsoldIds,s.currentPlayerId],pool:s.pool.filter(id=>id!==s.currentPlayerId)});
  };

  const handleBid = async (tid) => {
    const freshResult = await storage.get(STATE_KEY);
    const s = freshResult ? (typeof freshResult.value === 'string' ? JSON.parse(freshResult.value) : freshResult.value) : stateRef.current;
    const team = s.teams.find(t => t.id===tid);
    if(!team||s.phase!=="live"||team.players.length>=(config.maxSquad||MAX_SQUAD)||s.highestBidder===tid) return;
    const inc = config.bidIncrement || BID_INC;
    const nb = s.highestBidder===null ? s.currentBid : s.currentBid+inc;
    if(team.budget<nb) return;
    const td = (config.timerDuration || TIMER_DURATION) * 1000;
    const ns = {...s, currentBid:nb, highestBidder:tid, timerEnd:Date.now()+td, lastUpdate:Date.now()};
    setState(ns); await storage.set(STATE_KEY, JSON.stringify(ns));
  };

  const resetAll = async () => { const ns=defaultState(configRef.current); setState(ns); await storage.set(STATE_KEY, JSON.stringify(ns)); };
  const assignCaptain = async (tid,pi) => { await update({teams:state.teams.map(t=>t.id===tid?{...t,captain:t.captain===pi?null:pi}:t)}); };
  const assignVC = async (tid,pi) => { await update({teams:state.teams.map(t=>t.id===tid?{...t,viceCaptain:t.viceCaptain===pi?null:pi}:t)}); };
  const saveTeamName = async (tid) => { if(editName.trim()) await update({teams:state.teams.map(t=>t.id===tid?{...t,name:editName.trim()}:t)}); setEditingTeam(null); };

  const curPlayer = state.currentPlayerId!==null ? ALL_PLAYERS[state.currentPlayerId] : null;
  const leadTeam = state.highestBidder ? state.teams.find(t=>t.id===state.highestBidder) : null;
  const myTeam = typeof portal==="number" ? state.teams.find(t=>t.id===portal) : null;
  const maxSq = config.maxSquad || MAX_SQUAD;

  // Player list helpers
  const getSoldInfo = (pid) => state.soldLog.find(l => l.playerId === pid);
  const getPlayerStatus = (pid) => {
    if (state.soldLog.find(l => l.playerId === pid)) return "sold";
    if (state.unsoldIds.includes(pid)) return "unsold";
    return "pending";
  };

  const getFilteredPlayers = () => {
    let players = ALL_PLAYERS;
    if (roleFilter !== "All") players = players.filter(p => p.role === roleFilter);
    if (playerFilter === "sold") players = players.filter(p => getPlayerStatus(p.id) === "sold");
    else if (playerFilter === "pending") players = players.filter(p => getPlayerStatus(p.id) === "pending");
    else if (playerFilter === "unsold") players = players.filter(p => getPlayerStatus(p.id) === "unsold");
    return players;
  };

  const totalSold = state.soldLog.length;
  const totalPending = state.pool.length;
  const totalUnsold = state.unsoldIds.length;
  const totalSpent = state.soldLog.reduce((a, l) => a + l.price, 0);

  // ── Password Modal ──
  const renderPwModal = () => {
    if (!loginTarget) return null;
    const isAdmin = loginTarget==="admin";
    const team = !isAdmin ? TEAMS_INIT.find(t=>t.id===loginTarget) : null;
    const accent = isAdmin ? "#f7c948" : team?.color;
    const key = String(loginTarget);
    const isLocked = locked[key] && Date.now() < locked[key];
    return (
      <div style={S.overlay}>
        <div style={S.modal}>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{width:64,height:64,borderRadius:"50%",background:`${accent}18`,border:`2px solid ${accent}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 12px"}}>{isAdmin?"👑":"🏏"}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:accent}}>{isAdmin?"ADMIN LOGIN":team?.name}</div>
            <div style={{fontSize:13,color:"#7a8ea8",marginTop:4}}>Enter password to continue</div>
          </div>
          <div style={{position:"relative"}}>
            <div style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:16,color:"#4a6a94",pointerEvents:"none"}}>🔒</div>
            <input type={showPw?"text":"password"} value={pwInput} onChange={e=>{setPwInput(e.target.value);setPwError("");}} onKeyDown={e=>e.key==="Enter"&&attemptLogin()} placeholder="Enter password" autoFocus disabled={isLocked}
              style={{...S.pwInput,paddingLeft:42,borderColor:pwError?"#c0392b":"#253554",opacity:isLocked?0.5:1}} />
            <button style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",fontSize:18,cursor:"pointer",padding:4}} onClick={()=>setShowPw(!showPw)}>{showPw?"🙈":"👁️"}</button>
          </div>
          {pwError && <div style={{marginTop:10,padding:"10px 14px",background:"#c0392b15",border:"1px solid #c0392b33",borderRadius:8,fontSize:13,color:"#e74c3c",display:"flex",alignItems:"center",gap:8}}><span>⚠️</span><span>{pwError}</span></div>}
          <div style={{display:"flex",gap:10,marginTop:24}}>
            <button onClick={cancelLogin} style={{...S.modalBtn,background:"#1e2d4a",color:"#7a8ea8",flex:1}}>Cancel</button>
            <button onClick={attemptLogin} disabled={isLocked||!pwInput} style={{...S.modalBtn,background:isLocked||!pwInput?"#2a3554":accent,color:isLocked||!pwInput?"#555":"#0b0f1a",flex:2,cursor:isLocked||!pwInput?"not-allowed":"pointer"}}>{isLocked?"🔒 Locked":"Login →"}</button>
          </div>
        </div>
      </div>
    );
  };

  // ── Stats Bar Component ──
  const StatsBar = () => (
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
      {[
        {label:"Total",value:ALL_PLAYERS.length,color:"#fff",icon:"👥"},
        {label:"Sold",value:totalSold,color:"#27ae60",icon:"✅"},
        {label:"Pending",value:totalPending,color:"#f7c948",icon:"⏳"},
        {label:"Unsold",value:totalUnsold,color:"#c0392b",icon:"❌"},
      ].map(s => (
        <div key={s.label} style={{background:"#111827",border:"1px solid #1e2d4a",borderRadius:10,padding:"10px 16px",flex:"1 1 70px",textAlign:"center",minWidth:70}}>
          <div style={{fontSize:16}}>{s.icon}</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:s.color}}>{s.value}</div>
          <div style={{fontSize:10,color:"#7a8ea8",letterSpacing:1}}>{s.label.toUpperCase()}</div>
        </div>
      ))}
    </div>
  );

  // ── Player List Component ──
  const PlayerList = ({showValue}) => {
    const filtered = getFilteredPlayers();
    return (
      <div>
        {/* Filters */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
          {[{k:"all",l:"All"},{k:"sold",l:`Sold (${totalSold})`},{k:"pending",l:`Pending (${totalPending})`},{k:"unsold",l:`Unsold (${totalUnsold})`}].map(f => (
            <button key={f.k} onClick={()=>setPlayerFilter(f.k)} style={{...S.pill, ...(playerFilter===f.k?{background:"#f7c948",color:"#0b0f1a",borderColor:"#f7c948"}:{})}}>{f.l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
          {["All","Batsman","All-Rounder","Bowler"].map(r => (
            <button key={r} onClick={()=>setRoleFilter(r)} style={{...S.pill, ...(roleFilter===r?{background:"#5dade2",color:"#0b0f1a",borderColor:"#5dade2"}:{})}}>{r==="All"?r:`${ROLE_ICON[r]} ${r}`}</button>
          ))}
        </div>
        <div style={{fontSize:12,color:"#7a8ea8",marginBottom:8}}>Showing {filtered.length} players</div>
        <div style={{maxHeight:400,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
          {filtered.map(p => {
            const status = getPlayerStatus(p.id);
            const sold = getSoldInfo(p.id);
            const team = sold ? state.teams.find(t=>t.id===sold.teamId) : null;
            const pv = config.playerValues?.[p.id] || config.basePrice || BASE_PRICE;
            return (
              <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:status==="sold"?"#27ae6010":status==="unsold"?"#c0392b10":"#111827",border:`1px solid ${status==="sold"?"#27ae6033":status==="unsold"?"#c0392b33":"#1e2d4a"}`,borderRadius:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
                  <span style={{fontSize:14}}>{ROLE_ICON[p.role]}</span>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
                    <div style={{fontSize:10,color:"#5a6a88"}}>{p.dept} · {p.type}</div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                  {showValue && <span style={{fontSize:11,color:"#7a8ea8"}}>Base: ₹{pv}</span>}
                  {status==="sold" && (
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:11,fontWeight:700,color:team?.color}}>₹{sold.price}</div>
                      <div style={{fontSize:9,color:team?.color}}>{team?.name}</div>
                    </div>
                  )}
                  <span style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:10,
                    background:status==="sold"?"#27ae6022":status==="unsold"?"#c0392b22":"#f7c94822",
                    color:status==="sold"?"#27ae60":status==="unsold"?"#c0392b":"#f7c948",
                  }}>{status.toUpperCase()}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Config Panel (Admin) ──
  const ConfigPanel = () => {
    const [localCfg, setLocalCfg] = useState({
      baseBudget: config.baseBudget || 10000,
      basePrice: config.basePrice || 100,
      bidIncrement: config.bidIncrement || 50,
      maxSquad: config.maxSquad || 12,
      timerDuration: config.timerDuration || 15,
    });
    const [pvEdit, setPvEdit] = useState({});
    const [cfgMsg, setCfgMsg] = useState("");

    return (
      <div style={{background:"#111827",border:"1px solid #1e2d4a",borderRadius:12,padding:20,marginBottom:20}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:"#f7c948",letterSpacing:1,marginBottom:14}}>⚙️ AUCTION SETTINGS</div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10,marginBottom:16}}>
          {[
            {key:"baseBudget",label:"Team Budget (₹)",icon:"💰"},
            {key:"basePrice",label:"Base Price (₹)",icon:"🏷️"},
            {key:"bidIncrement",label:"Bid Increment (₹)",icon:"📈"},
            {key:"maxSquad",label:"Max Squad Size",icon:"👥"},
            {key:"timerDuration",label:"Timer (seconds)",icon:"⏱️"},
          ].map(f => (
            <div key={f.key} style={{background:"#0d1320",border:"1px solid #1a253d",borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:12,color:"#7a8ea8",marginBottom:4}}>{f.icon} {f.label}</div>
              <input type="number" value={localCfg[f.key]} onChange={e => setLocalCfg({...localCfg,[f.key]:parseInt(e.target.value)||0})}
                style={{width:"100%",padding:"6px 10px",borderRadius:6,border:"1px solid #253554",background:"#131b2e",color:"#f7c948",fontSize:16,fontFamily:"'Oswald',sans-serif",fontWeight:700,outline:"none",boxSizing:"border-box"}} />
            </div>
          ))}
        </div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:13,color:"#7a8ea8",fontWeight:600,marginBottom:8}}>🏷️ Set Individual Player Values (optional)</div>
          <div style={{maxHeight:200,overflowY:"auto",display:"flex",flexDirection:"column",gap:3}}>
            {ALL_PLAYERS.map(p => (
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 8px",background:"#0d1320",borderRadius:6}}>
                <span style={{fontSize:12}}>{ROLE_ICON[p.role]}</span>
                <span style={{fontSize:12,flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</span>
                <input type="number" placeholder={String(localCfg.basePrice)} value={pvEdit[p.id]||config.playerValues?.[p.id]||""} onChange={e => setPvEdit({...pvEdit,[p.id]:parseInt(e.target.value)||""})}
                  style={{width:80,padding:"3px 6px",borderRadius:4,border:"1px solid #253554",background:"#131b2e",color:"#e2e8f0",fontSize:12,outline:"none",textAlign:"right"}} />
              </div>
            ))}
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={async () => {
            const pv = {...(config.playerValues||{})};
            Object.entries(pvEdit).forEach(([k,v]) => { if(v) pv[k]=v; else delete pv[k]; });
            await updateConfig({...localCfg, playerValues:pv});
            setCfgMsg("Settings saved! Reset auction to apply budget changes.");
            setTimeout(()=>setCfgMsg(""),4000);
          }} style={{...S.actionBtn,background:"#f7c948",color:"#0b0f1a"}}>Save Settings</button>
          <button onClick={()=>setConfigMgmt(false)} style={{...S.actionBtn,background:"#1e2d4a",color:"#7a8ea8"}}>Close</button>
          {cfgMsg && <span style={{fontSize:12,color:"#27ae60",fontWeight:600}}>{cfgMsg}</span>}
        </div>
      </div>
    );
  };

  // ── Tab Button ──
  const TabBtn = ({active, onClick, children}) => (
    <button onClick={onClick} style={{padding:"8px 18px",border:"none",borderRadius:6,background:active?"#1a2744":"transparent",color:active?"#f7c948":"#7a8ea8",fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:500,letterSpacing:1,cursor:"pointer"}}>{children}</button>
  );

  // ══════════════ LOGIN SCREEN ══════════════
  if (!portal) {
    return (
      <div style={S.loginWrap}><style>{globalCSS}</style>{renderPwModal()}
        <div style={S.loginCard}>
          <div style={S.loginLogo}>RPL AUCTION 2026</div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:6,marginBottom:20}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:connected?"#27ae60":"#c0392b"}} />
            <span style={{fontSize:11,color:"#7a8ea8",letterSpacing:2,textTransform:"uppercase"}}>{connected?"Live · Secured":"Connecting..."}</span>
          </div>

          <button style={{...S.loginBtn,background:"linear-gradient(135deg,#f7c948,#e6a817)",color:"#0b0f1a"}} onClick={()=>setLoginTarget("admin")}>
            <span style={{fontSize:22}}>👑</span><div style={{flex:1}}><div style={{fontWeight:700,fontSize:15}}>ADMIN / AUCTIONEER</div><div style={{fontSize:11,opacity:0.7}}>Control auction flow</div></div><span style={{fontSize:16,opacity:0.6}}>🔒</span>
          </button>

          <div style={{fontSize:12,color:"#5a6a88",margin:"20px 0 10px",letterSpacing:2,textTransform:"uppercase"}}>Captain Login</div>
          <div style={S.captainGrid}>
            {state.teams.map(t => (
              <button key={t.id} style={{...S.captainBtn,borderColor:t.color}} onClick={()=>setLoginTarget(t.id)}>
                <div style={{width:10,height:10,borderRadius:"50%",background:t.color,flexShrink:0}} />
                <span style={{color:t.color,fontWeight:600,flex:1,textAlign:"left"}}>{t.name}</span><span style={{fontSize:13,opacity:0.5}}>🔒</span>
              </button>
            ))}
          </div>

          {/* Live Stats */}
          <div style={{marginTop:24,padding:"14px 16px",background:"#0d1320",borderRadius:10,border:"1px solid #1a253d"}}>
            <div style={{display:"flex",justifyContent:"space-around",textAlign:"center"}}>
              <div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#fff"}}>{ALL_PLAYERS.length}</div><div style={{fontSize:10,color:"#7a8ea8"}}>PLAYERS</div></div>
              <div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#27ae60"}}>{totalSold}</div><div style={{fontSize:10,color:"#7a8ea8"}}>SOLD</div></div>
              <div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#f7c948"}}>{totalPending}</div><div style={{fontSize:10,color:"#7a8ea8"}}>PENDING</div></div>
              <div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#c0392b"}}>{totalUnsold}</div><div style={{fontSize:10,color:"#7a8ea8"}}>UNSOLD</div></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════ CAPTAIN PORTAL ══════════════
  if (typeof portal === "number") {
    return (
      <div style={S.app}><style>{globalCSS}</style>
        <div style={{...S.topBar,borderBottom:`3px solid ${myTeam?.color}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:14,height:14,borderRadius:"50%",background:myTeam?.color}} />
            <div><div style={S.portalLabel}>CAPTAIN PORTAL</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#fff"}}>{myTeam?.name}</div></div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#7a8ea8"}}>BUDGET</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:myTeam?.color}}>₹{myTeam?.budget.toLocaleString()}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#7a8ea8"}}>SQUAD</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:"#fff"}}>{myTeam?.players.length}/{maxSq}</div></div>
            <button style={S.logoutBtn} onClick={()=>setPortal(null)}>🔒 Logout</button>
          </div>
        </div>

        {/* Captain Tabs */}
        <div style={{display:"flex",gap:4,padding:"8px 20px",background:"#0d1320"}}>
          <TabBtn active={captainTab==="auction"} onClick={()=>setCaptainTab("auction")}>AUCTION</TabBtn>
          <TabBtn active={captainTab==="players"} onClick={()=>setCaptainTab("players")}>PLAYERS</TabBtn>
          <TabBtn active={captainTab==="squad"} onClick={()=>setCaptainTab("squad")}>MY SQUAD</TabBtn>
          <TabBtn active={captainTab==="teams"} onClick={()=>setCaptainTab("teams")}>TEAMS</TabBtn>
        </div>

        <div style={S.mainPad}>
          <StatsBar />

          {captainTab==="auction" && (<>
            {state.phase==="live"&&curPlayer&&(
              <div style={S.liveCard}>
                <div style={S.liveTag}>🔴 LIVE AUCTION</div>
                <div style={S.playerNameBig}>{curPlayer.name}</div>
                <div style={S.metaRow}>
                  <span style={{...S.badge,background:"#f7c94822",color:"#f7c948",border:"1px solid #f7c94844"}}>{ROLE_ICON[curPlayer.role]} {curPlayer.role}</span>
                  <span style={{...S.badge,background:"#5dade222",color:"#5dade2",border:"1px solid #5dade244"}}>{curPlayer.dept}</span>
                  <span style={{...S.badge,background:curPlayer.type==="Field"?"#e74c3c22":"#27ae6022",color:curPlayer.type==="Field"?"#e74c3c":"#27ae60"}}>{curPlayer.type}</span>
                </div>
                <div style={{fontSize:11,color:"#7a8ea8",marginBottom:4}}>Base Value: ₹{getBasePrice(curPlayer.id)}</div>
                <div style={S.bidLabel}>CURRENT BID</div>
                <div style={S.bidBig}>₹{state.currentBid.toLocaleString()}</div>
                {leadTeam&&<div style={{...S.leadTag,background:leadTeam.color+"28",color:leadTeam.color,border:`1px solid ${leadTeam.color}55`}}>{leadTeam.id===portal?"🎉 YOU ARE LEADING!":`${leadTeam.name} is leading`}</div>}
                {state.timerEnd&&<div style={{margin:"16px 0 8px"}}><div style={S.timerBar}><div style={{...S.timerFill,width:`${(timeLeft/(config.timerDuration||TIMER_DURATION))*100}%`,background:timeLeft<=3?"#e74c3c":"#f7c948"}} /></div><div style={{fontSize:13,color:timeLeft<=3?"#e74c3c":"#7a8ea8",fontWeight:600}}>{timeLeft}s remaining</div></div>}
                {(()=>{const inc=config.bidIncrement||BID_INC;const nb=state.highestBidder===null?state.currentBid:state.currentBid+inc;const ok=myTeam&&myTeam.players.length<maxSq&&myTeam.budget>=nb&&state.highestBidder!==portal;
                  return <button style={{...S.bigBidBtn,background:ok?`linear-gradient(135deg,${myTeam?.color},${myTeam?.color}cc)`:"#2a3554",color:ok?"#fff":"#555",cursor:ok?"pointer":"not-allowed"}} disabled={!ok} onClick={()=>handleBid(portal)}>{state.highestBidder===portal?"✅ YOU'RE LEADING":`BID ₹${nb.toLocaleString()}`}</button>;
                })()}
              </div>
            )}
            {state.phase==="waiting"&&<div style={S.waitCard}><div style={{fontSize:40,marginBottom:12}}>⏳</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,color:"#fff"}}>WAITING FOR AUCTION</div><div style={{fontSize:14,color:"#7a8ea8",marginTop:6}}>The auctioneer will start the next player soon...</div></div>}
            {state.phase==="sold"&&<div style={S.waitCard}><div style={{fontSize:40,marginBottom:12}}>🎉</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:26,color:"#27ae60"}}>SOLD!</div>{state.soldLog.length>0&&(()=>{const l=state.soldLog[state.soldLog.length-1];const p=ALL_PLAYERS[l.playerId];const t=state.teams.find(x=>x.id===l.teamId);return<div style={{marginTop:8}}><div style={{fontSize:18,color:"#fff"}}>{p.name}</div><div style={{fontSize:14,color:"#7a8ea8"}}>to <strong style={{color:t?.color}}>{t?.name}</strong> for <strong style={{color:"#f7c948"}}>₹{l.price.toLocaleString()}</strong></div></div>;})()}</div>}
            {state.phase==="unsold"&&<div style={S.waitCard}><div style={{fontSize:40,marginBottom:12}}>😔</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:26,color:"#c0392b"}}>UNSOLD</div></div>}
            {state.phase==="done"&&<div style={S.waitCard}><div style={{fontSize:40,marginBottom:12}}>🏆</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:26,color:"#f7c948"}}>AUCTION COMPLETE</div></div>}
          </>)}

          {captainTab==="players" && <PlayerList showValue={false} />}

          {captainTab==="squad" && (
            <div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:"#fff",letterSpacing:1,marginBottom:10}}>MY SQUAD ({myTeam?.players.length}/{maxSq})</div>
              <div style={{fontSize:12,color:"#7a8ea8",marginBottom:10}}>Total Spent: ₹{myTeam?.players.reduce((a,p)=>a+p.price,0).toLocaleString()} · Remaining: ₹{myTeam?.budget.toLocaleString()}</div>
              {myTeam?.players.length===0&&<div style={{color:"#3a4a6a",fontSize:13,padding:16}}>No players yet</div>}
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {myTeam?.players.map((p,i)=>(
                  <div key={i} style={S.squadRow}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
                      <span style={{fontSize:14}}>{ROLE_ICON[p.role]}</span><span style={{fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</span>
                      {myTeam.captain===i&&<span style={{...S.cBadge,background:"#f7c948",color:"#0b0f1a"}}>C</span>}
                      {myTeam.viceCaptain===i&&<span style={{...S.cBadge,background:"#5dade2",color:"#0b0f1a"}}>VC</span>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <span style={{fontSize:11,color:"#7a8ea8"}}>₹{p.price}</span>
                      <button style={{...S.miniBtn,...(myTeam.captain===i?{background:"#f7c948",color:"#0b0f1a",borderColor:"#f7c948"}:{})}} onClick={()=>assignCaptain(portal,i)}>C</button>
                      <button style={{...S.miniBtn,...(myTeam.viceCaptain===i?{background:"#5dade2",color:"#0b0f1a",borderColor:"#5dade2"}:{})}} onClick={()=>assignVC(portal,i)}>VC</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {captainTab==="teams" && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8}}>
              {state.teams.map(t=>(
                <div key={t.id} style={{...S.miniTeamCard,borderTopColor:t.color}}>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:t.color,fontWeight:600}}>{t.name}</div>
                  <div style={{fontSize:11,color:"#7a8ea8"}}>{t.players.length}/{maxSq} players</div>
                  <div style={{fontSize:11,color:"#7a8ea8"}}>₹{t.budget.toLocaleString()} left</div>
                  <div style={{fontSize:10,color:"#5a6a88",marginTop:2}}>🏏{t.players.filter(p=>p.role==="Batsman").length} ⭐{t.players.filter(p=>p.role==="All-Rounder").length} 🎯{t.players.filter(p=>p.role==="Bowler").length}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ══════════════ ADMIN PORTAL ══════════════
  return (
    <div style={S.app}><style>{globalCSS}</style>
      <div style={{...S.topBar,borderBottom:"3px solid #f7c948"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:24}}>👑</span><div><div style={S.portalLabel}>ADMIN PORTAL</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#f7c948"}}>RPL AUCTIONEER</div></div></div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <button style={{...S.logoutBtn,background:"#2980b9"}} onClick={()=>setConfigMgmt(!configMgmt)}>⚙️ Settings</button>
          <button style={{...S.logoutBtn,background:"#8e44ad"}} onClick={()=>setPwMgmt(!pwMgmt)}>🔑 Passwords</button>
          <button style={{...S.logoutBtn,background:"#c0392b"}} onClick={resetAll}>Reset</button>
          <button style={S.logoutBtn} onClick={()=>setPortal(null)}>🔒 Logout</button>
        </div>
      </div>

      {/* Admin Tabs */}
      <div style={{display:"flex",gap:4,padding:"8px 20px",background:"#0d1320"}}>
        <TabBtn active={adminTab==="auction"} onClick={()=>setAdminTab("auction")}>AUCTION</TabBtn>
        <TabBtn active={adminTab==="players"} onClick={()=>setAdminTab("players")}>PLAYERS</TabBtn>
        <TabBtn active={adminTab==="teams"} onClick={()=>setAdminTab("teams")}>TEAMS</TabBtn>
      </div>

      <div style={S.mainPad}>
        <StatsBar />

        {configMgmt && <ConfigPanel />}

        {pwMgmt&&(
          <div style={{background:"#111827",border:"1px solid #1e2d4a",borderRadius:12,padding:20,marginBottom:20}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:"#f7c948",letterSpacing:1,marginBottom:14}}>🔑 PASSWORD MANAGEMENT</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
              {[{key:"admin",label:"👑 Admin",color:"#f7c948"},...state.teams.map(t=>({key:String(t.id),label:t.name,color:t.color}))].map(item=>(
                <div key={item.key} style={{background:"#0d1320",border:"1px solid #1a253d",borderRadius:8,padding:"10px 14px"}}>
                  <div style={{fontSize:13,fontWeight:600,color:item.color,marginBottom:6}}>{item.label}</div>
                  <div style={{fontSize:11,color:"#5a6a88",marginBottom:4}}>Current: <code style={S.codePw}>{passwords[item.key]}</code></div>
                  <input type="text" placeholder="New password (min 4 chars)" value={newPwInputs[item.key]||""} onChange={e=>setNewPwInputs({...newPwInputs,[item.key]:e.target.value})}
                    style={{width:"100%",padding:"6px 10px",borderRadius:6,border:"1px solid #253554",background:"#131b2e",color:"#e2e8f0",fontSize:12,outline:"none",boxSizing:"border-box"}} />
                </div>
              ))}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginTop:14}}>
              <button style={{...S.actionBtn,background:"#f7c948",color:"#0b0f1a"}} onClick={handleSavePasswords}>Save</button>
              <button style={{...S.actionBtn,background:"#1e2d4a",color:"#7a8ea8"}} onClick={()=>setPwMgmt(false)}>Close</button>
              {pwSaveMsg&&<span style={{fontSize:13,color:"#27ae60",fontWeight:600}}>{pwSaveMsg}</span>}
            </div>
          </div>
        )}

        {adminTab==="auction" && (<>
          {state.phase==="live"&&curPlayer&&(
            <div style={{...S.liveCard,border:"2px solid #f7c94844"}}>
              <div style={S.liveTag}>🔴 LIVE — CAPTAINS CAN BID</div>
              <div style={S.playerNameBig}>{curPlayer.name}</div>
              <div style={S.metaRow}>
                <span style={{...S.badge,background:"#f7c94822",color:"#f7c948",border:"1px solid #f7c94844"}}>{ROLE_ICON[curPlayer.role]} {curPlayer.role}</span>
                <span style={{...S.badge,background:"#5dade222",color:"#5dade2",border:"1px solid #5dade244"}}>{curPlayer.dept}</span>
                <span style={{...S.badge,background:curPlayer.type==="Field"?"#e74c3c22":"#27ae6022",color:curPlayer.type==="Field"?"#e74c3c":"#27ae60"}}>{curPlayer.type}</span>
              </div>
              <div style={{fontSize:11,color:"#7a8ea8",marginBottom:4}}>Base Value: ₹{getBasePrice(curPlayer.id)}</div>
              <div style={S.bidLabel}>CURRENT BID</div>
              <div style={S.bidBig}>₹{state.currentBid.toLocaleString()}</div>
              {leadTeam&&<div style={{...S.leadTag,background:leadTeam.color+"28",color:leadTeam.color,border:`1px solid ${leadTeam.color}55`}}>{leadTeam.name} leading</div>}
              {state.timerEnd&&<div style={{margin:"16px 0 8px"}}><div style={S.timerBar}><div style={{...S.timerFill,width:`${(timeLeft/(config.timerDuration||TIMER_DURATION))*100}%`,background:timeLeft<=3?"#e74c3c":"#f7c948"}} /></div><div style={{fontSize:13,color:timeLeft<=3?"#e74c3c":"#7a8ea8",fontWeight:600}}>{timeLeft}s</div></div>}
              <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:12,flexWrap:"wrap"}}>
                {state.highestBidder&&<button style={{...S.actionBtn,background:"#27ae60",color:"#fff"}} onClick={handleSold}>SELL NOW</button>}
                <button style={{...S.actionBtn,background:"#c0392b",color:"#fff"}} onClick={handleUnsold}>UNSOLD</button>
              </div>
              <div style={{marginTop:16,fontSize:12,color:"#5a6a88",letterSpacing:1}}>BID ON BEHALF</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginTop:8}}>
                {state.teams.map(t=>{const inc=config.bidIncrement||BID_INC;const nb=state.highestBidder===null?state.currentBid:state.currentBid+inc;const ok=t.players.length<maxSq&&t.budget>=nb&&t.id!==state.highestBidder;
                  return<button key={t.id} disabled={!ok} onClick={()=>handleBid(t.id)} style={{...S.adminBidBtn,borderColor:t.color,color:ok?t.color:"#333",opacity:ok?1:0.3}}>{t.name}<br/><span style={{fontSize:10,opacity:0.7}}>₹{t.budget.toLocaleString()}</span></button>;})}
              </div>
            </div>
          )}
          {(state.phase==="waiting"||state.phase==="sold"||state.phase==="unsold")&&(
            <div style={{textAlign:"center",padding:"24px 0"}}>
              {state.phase==="sold"&&state.soldLog.length>0&&(()=>{const l=state.soldLog[state.soldLog.length-1];const p=ALL_PLAYERS[l.playerId];const t=state.teams.find(x=>x.id===l.teamId);return<div style={{marginBottom:16}}><div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,color:"#27ae60"}}>SOLD!</div><div style={{fontSize:16,color:"#fff"}}>{p.name} → <span style={{color:t?.color}}>{t?.name}</span> for <span style={{color:"#f7c948"}}>₹{l.price}</span></div></div>;})()}
              {state.phase==="unsold"&&<div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,color:"#c0392b",marginBottom:16}}>UNSOLD</div>}
              {state.pool.length>0?<button style={{...S.actionBtn,background:"linear-gradient(135deg,#f7c948,#e6a817)",color:"#0b0f1a",fontSize:16,padding:"14px 40px"}} onClick={startRandom}>{state.phase==="waiting"?"🎬 START AUCTION":"⏭️ NEXT PLAYER"}</button>
              :<div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:32,color:"#f7c948"}}>🏆 AUCTION COMPLETE</div></div>}
            </div>
          )}
          {(state.phase==="waiting"||state.phase==="sold"||state.phase==="unsold")&&state.pool.length>0&&(
            <details style={{marginTop:16}}><summary style={{cursor:"pointer",fontSize:13,color:"#7a8ea8",fontWeight:600}}>Pick specific player ({state.pool.length})</summary>
              <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:8,maxHeight:200,overflowY:"auto"}}>
                {state.pool.map(id=>{const p=ALL_PLAYERS[id];return<button key={id} onClick={()=>startPlayer(id)} style={S.poolChip}>{ROLE_ICON[p.role]} {p.name}</button>;})}
              </div>
            </details>
          )}
        </>)}

        {adminTab==="players" && <PlayerList showValue={true} />}

        {adminTab==="teams" && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
            {state.teams.map(t=>(
              <div key={t.id} style={{background:"#111827",border:"1px solid #1e2d4a",borderTop:`3px solid ${t.color}`,borderRadius:10,overflow:"hidden"}}>
                <div style={{padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #1e2d4a"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:t.color}} />
                    {editingTeam===t.id?<input value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveTeamName(t.id)} onBlur={()=>saveTeamName(t.id)} autoFocus style={{fontFamily:"'Oswald',sans-serif",fontSize:14,background:"#1a253d",border:"1px solid #3a5080",borderRadius:4,color:"#fff",padding:"2px 8px",outline:"none",width:130}}/>
                    :<><span style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:600,color:"#fff"}}>{t.name}</span><button style={{background:"none",border:"none",color:"#7a8ea8",cursor:"pointer",fontSize:12}} onClick={()=>{setEditingTeam(t.id);setEditName(t.name);}}>✏️</button></>}
                  </div>
                  <span style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:600,color:t.color}}>₹{t.budget.toLocaleString()}</span>
                </div>
                <div style={{padding:"4px 10px",borderBottom:"1px solid #1e2d4a",fontSize:11,color:"#7a8ea8"}}>
                  Spent: ₹{t.players.reduce((a,p)=>a+p.price,0).toLocaleString()} · Budget: ₹{t.budget.toLocaleString()}
                </div>
                <div style={{padding:"6px 10px",maxHeight:220,overflowY:"auto"}}>
                  {t.players.length===0&&<div style={{color:"#3a4a6a",fontSize:12,padding:12,textAlign:"center"}}>Empty</div>}
                  {t.players.map((p,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 6px",borderRadius:5,marginBottom:2}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0}}>
                        <span style={{fontSize:12}}>{ROLE_ICON[p.role]}</span><span style={{fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</span>
                        {t.captain===i&&<span style={{...S.cBadge,background:"#f7c948",color:"#0b0f1a"}}>C</span>}
                        {t.viceCaptain===i&&<span style={{...S.cBadge,background:"#5dade2",color:"#0b0f1a"}}>VC</span>}
                      </div>
                      <div style={{display:"flex",gap:3,alignItems:"center"}}>
                        <span style={{fontSize:10,color:"#7a8ea8"}}>₹{p.price}</span>
                        <button style={{...S.miniBtn,...(t.captain===i?{background:"#f7c948",color:"#0b0f1a",borderColor:"#f7c948"}:{})}} onClick={()=>assignCaptain(t.id,i)}>C</button>
                        <button style={{...S.miniBtn,...(t.viceCaptain===i?{background:"#5dade2",color:"#0b0f1a",borderColor:"#5dade2"}:{})}} onClick={()=>assignVC(t.id,i)}>VC</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{padding:"6px 14px",borderTop:"1px solid #1e2d4a",fontSize:11,color:"#7a8ea8",display:"flex",justifyContent:"space-between"}}>
                  <span>{t.players.length}/{maxSq}</span>
                  <span>🏏{t.players.filter(p=>p.role==="Batsman").length} ⭐{t.players.filter(p=>p.role==="All-Rounder").length} 🎯{t.players.filter(p=>p.role==="Bowler").length}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
  @keyframes slideUp{0%{transform:translateY(20px);opacity:0}100%{transform:translateY(0);opacity:1}}
  @keyframes fadeIn{0%{opacity:0}100%{opacity:1}}
  code{font-family:'Courier New',monospace}
`;

const S = {
  app:{fontFamily:"'Source Sans 3',sans-serif",background:"#0b0f1a",minHeight:"100vh",color:"#e2e8f0"},
  loginWrap:{fontFamily:"'Source Sans 3',sans-serif",background:"linear-gradient(135deg,#0b0f1a 0%,#111d33 50%,#0b0f1a 100%)",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  loginCard:{background:"#111827",border:"1px solid #1e2d4a",borderRadius:20,padding:"36px 28px",maxWidth:460,width:"100%",textAlign:"center"},
  loginLogo:{fontFamily:"'Oswald',sans-serif",fontSize:30,fontWeight:700,letterSpacing:3,background:"linear-gradient(90deg,#f7c948,#e74c3c)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"},
  loginBtn:{width:"100%",padding:"14px 16px",borderRadius:12,border:"none",display:"flex",alignItems:"center",gap:12,cursor:"pointer",fontFamily:"'Source Sans 3',sans-serif",textAlign:"left"},
  captainGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8},
  captainBtn:{padding:"12px",borderRadius:10,border:"2px solid",background:"transparent",display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:0.5},
  codePw:{background:"#1a253d",padding:"2px 6px",borderRadius:4,fontSize:11,color:"#f7c948"},
  overlay:{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,animation:"fadeIn 0.2s ease",padding:20},
  modal:{background:"#111827",border:"1px solid #253554",borderRadius:20,padding:"36px 28px",maxWidth:400,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,0.6)"},
  pwInput:{width:"100%",padding:"14px 50px 14px 16px",borderRadius:10,border:"2px solid #253554",background:"#0d1320",color:"#e2e8f0",fontSize:15,fontFamily:"'Source Sans 3',sans-serif",outline:"none",boxSizing:"border-box"},
  modalBtn:{padding:"12px",border:"none",borderRadius:10,fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:600,letterSpacing:1,transition:"all 0.15s"},
  topBar:{background:"linear-gradient(90deg,#0f1729,#162035,#0f1729)",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10},
  portalLabel:{fontSize:10,letterSpacing:3,color:"#7a8ea8",textTransform:"uppercase"},
  logoutBtn:{padding:"6px 14px",borderRadius:6,border:"1px solid #2a3554",background:"#1a253d",color:"#e2e8f0",fontSize:12,fontWeight:600,cursor:"pointer"},
  mainPad:{padding:"16px 20px"},
  liveCard:{background:"linear-gradient(145deg,#131b2e,#1a253d)",border:"2px solid #253554",borderRadius:16,padding:28,textAlign:"center",marginBottom:16,animation:"slideUp 0.3s ease-out"},
  liveTag:{fontSize:12,color:"#e74c3c",fontWeight:700,letterSpacing:2,marginBottom:12,animation:"pulse 2s infinite"},
  playerNameBig:{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:700,color:"#fff",marginBottom:8},
  metaRow:{display:"flex",justifyContent:"center",gap:10,marginBottom:16,flexWrap:"wrap"},
  badge:{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600},
  bidLabel:{fontSize:12,color:"#7a8ea8",letterSpacing:2,textTransform:"uppercase",marginBottom:4},
  bidBig:{fontFamily:"'Oswald',sans-serif",fontSize:48,fontWeight:700,color:"#f7c948",margin:"8px 0"},
  leadTag:{display:"inline-block",padding:"6px 20px",borderRadius:20,fontSize:14,fontWeight:700,marginTop:4},
  timerBar:{height:5,background:"#1a253d",borderRadius:3,overflow:"hidden"},
  timerFill:{height:"100%",borderRadius:3,transition:"width 0.3s linear"},
  bigBidBtn:{width:"100%",padding:"18px",borderRadius:14,border:"none",fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,letterSpacing:2,marginTop:16},
  waitCard:{background:"#111827",border:"1px solid #1e2d4a",borderRadius:16,padding:40,textAlign:"center"},
  squadRow:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:"#111827",border:"1px solid #1e2d4a",borderRadius:8},
  cBadge:{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:3,letterSpacing:0.5},
  miniBtn:{background:"none",border:"1px solid #253554",color:"#7a8ea8",fontSize:10,padding:"2px 7px",borderRadius:4,cursor:"pointer",fontWeight:600},
  miniTeamCard:{background:"#111827",border:"1px solid #1e2d4a",borderTop:"3px solid",borderRadius:8,padding:"10px 12px"},
  actionBtn:{padding:"10px 24px",border:"none",borderRadius:8,fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:600,letterSpacing:1,cursor:"pointer"},
  adminBidBtn:{padding:"10px 8px",border:"2px solid",borderRadius:8,background:"transparent",fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"},
  poolChip:{padding:"5px 12px",background:"#131b2e",border:"1px solid #253554",borderRadius:8,fontSize:12,color:"#c0cee0",cursor:"pointer"},
  pill:{padding:"5px 14px",borderRadius:16,border:"1px solid #253554",background:"transparent",color:"#7a8ea8",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.2s"},
};

export default App;
