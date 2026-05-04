import React, { useState, useEffect, useRef, useCallback } from 'react';
import { storage } from './firebase';
import { ALL_PLAYERS, TEAMS_INIT, DEFAULT_PASSWORDS, ROLE_ICON, BASE_PRICE, BID_INC, MAX_SQUAD, TIMER_DURATION, MIN_WOMEN } from './data';

const STATE_KEY = "state";
const PW_KEY = "passwords";
const CONFIG_KEY = "config";

const defaultConfig = () => ({
  baseBudget: 1000000,
  basePrice: 50000,
  bidIncrement: 5000,
  maxSquad: 12,
  minWomen: 1,
  timerDuration: 15,
  playerValues: {},
});

const defaultState = (cfg) => {
  const budget = cfg?.baseBudget || 1000000;
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

// ── Format currency in Lakhs ──
const fmt = (n) => {
  if (n >= 100000) return `₹${(n/100000).toFixed(n%100000===0?0:1)}L`;
  if (n >= 1000) return `₹${(n/1000).toFixed(0)}K`;
  return `₹${n.toLocaleString()}`;
};

// ── Check if a team is eligible to bid ──
const checkEligibility = (team, currentPlayer, nextBid, config) => {
  const maxSq = config.maxSquad || MAX_SQUAD;
  const minW = config.minWomen || MIN_WOMEN;
  const bp = config.basePrice || BASE_PRICE;

  // Already full
  if (team.players.length >= maxSq) return { eligible: false, reason: "Squad full" };

  // Can't afford
  if (team.budget < nextBid) return { eligible: false, reason: "Insufficient budget" };

  // Must reserve budget for remaining mandatory slots
  const slotsLeft = maxSq - team.players.length - 1; // -1 for current bid
  const womenCount = team.players.filter(p => p.gender === "F").length;
  const isCurrentWoman = currentPlayer?.gender === "F";
  const womenAfterBid = womenCount + (isCurrentWoman ? 1 : 0);
  const womenStillNeeded = Math.max(0, minW - womenAfterBid);

  // Budget must cover: this bid + remaining slots at base price
  const reserveNeeded = slotsLeft * bp;
  if (team.budget - nextBid < reserveNeeded) {
    return { eligible: false, reason: `Must reserve ${fmt(reserveNeeded)} for ${slotsLeft} more slots` };
  }

  // If team still needs women and remaining women pool is running low
  // Block bid only if it's not a woman and team hasn't met minimum
  // AND there aren't enough slots left to get women later
  if (womenStillNeeded > 0 && !isCurrentWoman) {
    const slotsAfterThis = slotsLeft; // slots remaining after this potential buy
    if (slotsAfterThis < womenStillNeeded) {
      return { eligible: false, reason: `Must buy ${womenStillNeeded} more women player(s)` };
    }
  }

  return { eligible: true, reason: "" };
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
  const [showRules, setShowRules] = useState(false);
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
  const [playerFilter, setPlayerFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("All");

  // Firebase
  useEffect(() => {
    const unsubState = storage.subscribe(STATE_KEY, (r) => { if(r?.value) { try { setState(typeof r.value==='string'?JSON.parse(r.value):r.value); setConnected(true); } catch(e){} }});
    const unsubPw = storage.subscribe(PW_KEY, (r) => { if(r?.value) { try { setPasswords(typeof r.value==='string'?JSON.parse(r.value):r.value); } catch(e){} }});
    const unsubCfg = storage.subscribe(CONFIG_KEY, (r) => { if(r?.value) { try { setConfig(typeof r.value==='string'?JSON.parse(r.value):r.value); } catch(e){} }});
    (async () => {
      const es = await storage.get(STATE_KEY); if(!es) await storage.set(STATE_KEY, JSON.stringify(defaultState()));
      const ep = await storage.get(PW_KEY); if(!ep) await storage.set(PW_KEY, JSON.stringify(DEFAULT_PASSWORDS));
      const ec = await storage.get(CONFIG_KEY); if(!ec) await storage.set(CONFIG_KEY, JSON.stringify(defaultConfig()));
      else { try { setConfig(typeof ec.value==='string'?JSON.parse(ec.value):ec.value); } catch(e){} }
      setConnected(true);
    })();
    return () => { unsubState(); unsubPw(); unsubCfg(); };
  }, []);

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

  const update = async (ch) => { const ns={...stateRef.current,...ch,lastUpdate:Date.now()}; setState(ns); await storage.set(STATE_KEY,JSON.stringify(ns)); };
  const updateConfig = async (ch) => { const nc={...configRef.current,...ch}; setConfig(nc); await storage.set(CONFIG_KEY,JSON.stringify(nc)); };

  // Login
  const attemptLogin = () => {
    if(!loginTarget) return;
    const key=String(loginTarget);
    if(locked[key]&&Date.now()<locked[key]){setPwError(`Locked for ${Math.ceil((locked[key]-Date.now())/1000)}s`);return;}
    if(pwInput===passwords[loginTarget]){setPortal(loginTarget);setLoginTarget(null);setPwInput("");setPwError("");setShowPw(false);setAttempts(a=>({...a,[key]:0}));}
    else{const nc=(attempts[key]||0)+1;setAttempts(a=>({...a,[key]:nc}));if(nc>=3){setLocked(l=>({...l,[key]:Date.now()+30000}));setPwError("Locked for 30s.");}else setPwError(`Incorrect. ${3-nc} left.`);}
  };
  const cancelLogin = () => { setLoginTarget(null); setPwInput(""); setPwError(""); setShowPw(false); };
  const handleSavePasswords = async () => {
    const u={...passwords};let c=false;Object.entries(newPwInputs).forEach(([k,v])=>{if(v&&v.trim().length>=4){u[k]=v.trim();c=true;}});
    if(c){setPasswords(u);await storage.set(PW_KEY,JSON.stringify(u));setNewPwInputs({});setPwSaveMsg("Updated!");setTimeout(()=>setPwSaveMsg(""),3000);}
    else{setPwSaveMsg("Min 4 chars.");setTimeout(()=>setPwSaveMsg(""),3000);}
  };

  // Auction
  const getBasePrice = (pid) => config.playerValues?.[pid] || config.basePrice || BASE_PRICE;
  const startPlayer = async (pid) => { await update({currentPlayerId:pid,currentBid:getBasePrice(pid),highestBidder:null,phase:"live",timerEnd:null}); };
  const startRandom = async () => { const s=stateRef.current; if(!s.pool.length) return; await startPlayer(s.pool[Math.floor(Math.random()*s.pool.length)]); };
  const handleSold = async () => {
    const s=stateRef.current; if(!s.highestBidder||s.currentPlayerId===null) return;
    const p=ALL_PLAYERS[s.currentPlayerId];
    await update({teams:s.teams.map(t=>t.id===s.highestBidder?{...t,budget:t.budget-s.currentBid,players:[...t.players,{...p,price:s.currentBid}]}:t),pool:s.pool.filter(id=>id!==s.currentPlayerId),phase:"sold",timerEnd:null,soldLog:[...s.soldLog,{playerId:s.currentPlayerId,teamId:s.highestBidder,price:s.currentBid}]});
  };
  const handleUnsold = async () => { const s=stateRef.current; await update({phase:"unsold",timerEnd:null,unsoldIds:[...s.unsoldIds,s.currentPlayerId],pool:s.pool.filter(id=>id!==s.currentPlayerId)}); };
  const handleBid = async (tid) => {
    const fr=await storage.get(STATE_KEY);const s=fr?(typeof fr.value==='string'?JSON.parse(fr.value):fr.value):stateRef.current;
    const team=s.teams.find(t=>t.id===tid);if(!team||s.phase!=="live"||s.highestBidder===tid) return;
    const inc=config.bidIncrement||BID_INC;const nb=s.highestBidder===null?s.currentBid:s.currentBid+inc;
    const curP=ALL_PLAYERS[s.currentPlayerId];
    const elig=checkEligibility(team,curP,nb,configRef.current);
    if(!elig.eligible) return;
    const td=(config.timerDuration||TIMER_DURATION)*1000;
    const ns={...s,currentBid:nb,highestBidder:tid,timerEnd:Date.now()+td,lastUpdate:Date.now()};
    setState(ns);await storage.set(STATE_KEY,JSON.stringify(ns));
  };
  const resetAll = async () => { const ns=defaultState(configRef.current); setState(ns); await storage.set(STATE_KEY,JSON.stringify(ns)); };
  const assignCaptain = async (tid,pi) => { await update({teams:state.teams.map(t=>t.id===tid?{...t,captain:t.captain===pi?null:pi}:t)}); };
  const assignVC = async (tid,pi) => { await update({teams:state.teams.map(t=>t.id===tid?{...t,viceCaptain:t.viceCaptain===pi?null:pi}:t)}); };
  const saveTeamName = async (tid) => { if(editName.trim()) await update({teams:state.teams.map(t=>t.id===tid?{...t,name:editName.trim()}:t)}); setEditingTeam(null); };

  const curPlayer = state.currentPlayerId!==null?ALL_PLAYERS[state.currentPlayerId]:null;
  const leadTeam = state.highestBidder?state.teams.find(t=>t.id===state.highestBidder):null;
  const myTeam = typeof portal==="number"?state.teams.find(t=>t.id===portal):null;
  const maxSq = config.maxSquad||MAX_SQUAD;
  const totalSold=state.soldLog.length; const totalPending=state.pool.length; const totalUnsold=state.unsoldIds.length;
  const getSoldInfo = (pid) => state.soldLog.find(l=>l.playerId===pid);
  const getPlayerStatus = (pid) => { if(state.soldLog.find(l=>l.playerId===pid)) return "sold"; if(state.unsoldIds.includes(pid)) return "unsold"; return "pending"; };
  const getFilteredPlayers = () => {
    let p=ALL_PLAYERS;
    if(roleFilter!=="All") p=p.filter(x=>x.role===roleFilter);
    if(playerFilter==="sold") p=p.filter(x=>getPlayerStatus(x.id)==="sold");
    else if(playerFilter==="pending") p=p.filter(x=>getPlayerStatus(x.id)==="pending");
    else if(playerFilter==="unsold") p=p.filter(x=>getPlayerStatus(x.id)==="unsold");
    else if(playerFilter==="women") p=p.filter(x=>x.gender==="F");
    return p;
  };

  // ── Rules Panel ──
  const RulesPanel = () => (
    <div style={{background:"linear-gradient(145deg,#111827,#162035)",border:"1px solid #f7c94844",borderRadius:14,padding:24,marginBottom:20}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,color:"#f7c948",letterSpacing:1,marginBottom:16,display:"flex",alignItems:"center",gap:8}}>📋 AUCTION RULES</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12,marginBottom:16}}>
        {[
          {icon:"💰",label:"Team Purse",value:fmt(config.baseBudget||1000000)},
          {icon:"🏷️",label:"Base Price",value:fmt(config.basePrice||50000)},
          {icon:"📈",label:"Bid Increment",value:fmt(config.bidIncrement||5000)},
          {icon:"👥",label:"Squad Size",value:`${config.maxSquad||12} players`},
          {icon:"👩",label:"Min Women",value:`${config.minWomen||1} per team`},
          {icon:"⏱️",label:"Bid Timer",value:`${config.timerDuration||15} seconds`},
        ].map(r => (
          <div key={r.label} style={{background:"#0d132088",borderRadius:8,padding:"10px 14px",border:"1px solid #1e2d4a"}}>
            <div style={{fontSize:12,color:"#7a8ea8"}}>{r.icon} {r.label}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:"#fff",marginTop:2}}>{r.value}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:13,color:"#c0cee0",lineHeight:1.8}}>
        <div style={{fontWeight:700,color:"#f7c948",marginBottom:6}}>Rules:</div>
        <div style={{paddingLeft:8}}>
          1. Each team has a purse of <strong style={{color:"#f7c948"}}>{fmt(config.baseBudget||1000000)}</strong> to buy {config.maxSquad||12} players.<br/>
          2. Every player starts at a base price of <strong style={{color:"#f7c948"}}>{fmt(config.basePrice||50000)}</strong>. Individual base prices may vary.<br/>
          3. Each bid increases by <strong style={{color:"#f7c948"}}>{fmt(config.bidIncrement||5000)}</strong>.<br/>
          4. After a bid, other captains have <strong style={{color:"#f7c948"}}>{config.timerDuration||15} seconds</strong> to counter-bid.<br/>
          5. Each team <strong style={{color:"#e74c3c"}}>must</strong> have at least <strong style={{color:"#f7c948"}}>{config.minWomen||1} women player(s)</strong>.<br/>
          6. Teams must reserve enough budget to fill all {config.maxSquad||12} slots at base price.<br/>
          7. Bidding is automatically blocked if a team cannot meet the minimum requirements.<br/>
          8. Captain and Vice-Captain can be assigned after the auction.
        </div>
      </div>
      <button onClick={()=>setShowRules(false)} style={{...S.actionBtn,background:"#1e2d4a",color:"#7a8ea8",marginTop:14}}>Close Rules</button>
    </div>
  );

  // ── Team Compliance Badge ──
  const TeamCompliance = ({team}) => {
    const wc = team.players.filter(p=>p.gender==="F").length;
    const minW = config.minWomen||1;
    const needsWomen = wc < minW;
    const isFull = team.players.length >= (config.maxSquad||12);
    return (
      <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}>
        <span style={{fontSize:10,padding:"2px 8px",borderRadius:8,background:needsWomen?"#c0392b22":"#27ae6022",color:needsWomen?"#c0392b":"#27ae60",fontWeight:600}}>
          👩 {wc}/{minW} Women
        </span>
        <span style={{fontSize:10,padding:"2px 8px",borderRadius:8,background:isFull?"#27ae6022":"#f7c94822",color:isFull?"#27ae60":"#f7c948",fontWeight:600}}>
          👥 {team.players.length}/{config.maxSquad||12}
        </span>
      </div>
    );
  };

  // ── Stats Bar ──
  const StatsBar = () => (
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
      {[{l:"Total",v:ALL_PLAYERS.length,c:"#fff",i:"👥"},{l:"Sold",v:totalSold,c:"#27ae60",i:"✅"},{l:"Pending",v:totalPending,c:"#f7c948",i:"⏳"},{l:"Unsold",v:totalUnsold,c:"#c0392b",i:"❌"}].map(s=>(
        <div key={s.l} style={{background:"#111827",border:"1px solid #1e2d4a",borderRadius:10,padding:"8px 14px",flex:"1 1 60px",textAlign:"center",minWidth:60}}>
          <div style={{fontSize:14}}>{s.i}</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:s.c}}>{s.v}</div>
          <div style={{fontSize:9,color:"#7a8ea8",letterSpacing:1}}>{s.l.toUpperCase()}</div>
        </div>
      ))}
    </div>
  );

  // ── Player List ──
  const PlayerList = ({showValue}) => {
    const filtered = getFilteredPlayers();
    return (<div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
        {[{k:"all",l:"All"},{k:"sold",l:`Sold (${totalSold})`},{k:"pending",l:`Pending (${totalPending})`},{k:"unsold",l:`Unsold (${totalUnsold})`},{k:"women",l:`Women (${ALL_PLAYERS.filter(p=>p.gender==="F").length})`}].map(f=>(
          <button key={f.k} onClick={()=>setPlayerFilter(f.k)} style={{...S.pill,...(playerFilter===f.k?{background:"#f7c948",color:"#0b0f1a",borderColor:"#f7c948"}:{})}}>{f.l}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
        {["All","Batsman","All-Rounder","Bowler"].map(r=>(<button key={r} onClick={()=>setRoleFilter(r)} style={{...S.pill,...(roleFilter===r?{background:"#5dade2",color:"#0b0f1a",borderColor:"#5dade2"}:{})}}>{r==="All"?r:`${ROLE_ICON[r]} ${r}`}</button>))}
      </div>
      <div style={{fontSize:12,color:"#7a8ea8",marginBottom:8}}>Showing {filtered.length} players</div>
      <div style={{maxHeight:400,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
        {filtered.map(p=>{const st=getPlayerStatus(p.id);const sold=getSoldInfo(p.id);const t=sold?state.teams.find(x=>x.id===sold.teamId):null;
          return(<div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:st==="sold"?"#27ae6010":st==="unsold"?"#c0392b10":"#111827",border:`1px solid ${st==="sold"?"#27ae6033":st==="unsold"?"#c0392b33":"#1e2d4a"}`,borderRadius:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
              <span style={{fontSize:14}}>{ROLE_ICON[p.role]}</span>
              <div style={{minWidth:0}}>
                <div style={{fontSize:13,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name} {p.gender==="F"&&<span style={{fontSize:10,color:"#e91e8f"}}>♀</span>}</div>
                <div style={{fontSize:10,color:"#5a6a88"}}>{p.dept} · {p.type}</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              {showValue&&<span style={{fontSize:11,color:"#7a8ea8"}}>Base: {fmt(getBasePrice(p.id))}</span>}
              {st==="sold"&&<div style={{textAlign:"right"}}><div style={{fontSize:11,fontWeight:700,color:t?.color}}>{fmt(sold.price)}</div><div style={{fontSize:9,color:t?.color}}>{t?.name}</div></div>}
              <span style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:10,background:st==="sold"?"#27ae6022":st==="unsold"?"#c0392b22":"#f7c94822",color:st==="sold"?"#27ae60":st==="unsold"?"#c0392b":"#f7c948"}}>{st.toUpperCase()}</span>
            </div>
          </div>);
        })}
      </div>
    </div>);
  };

  // ── Config Panel ──
  const ConfigPanel = () => {
    const [lc,setLc]=useState({baseBudget:config.baseBudget||1000000,basePrice:config.basePrice||50000,bidIncrement:config.bidIncrement||5000,maxSquad:config.maxSquad||12,minWomen:config.minWomen||1,timerDuration:config.timerDuration||15});
    const [pvEdit,setPvEdit]=useState({});const [msg,setMsg]=useState("");
    return(<div style={{background:"#111827",border:"1px solid #1e2d4a",borderRadius:12,padding:20,marginBottom:20}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:"#f7c948",letterSpacing:1,marginBottom:14}}>⚙️ SETTINGS</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10,marginBottom:16}}>
        {[{k:"baseBudget",l:"Team Budget (₹)",i:"💰"},{k:"basePrice",l:"Base Price (₹)",i:"🏷️"},{k:"bidIncrement",l:"Bid Increment (₹)",i:"📈"},{k:"maxSquad",l:"Max Squad",i:"👥"},{k:"minWomen",l:"Min Women",i:"👩"},{k:"timerDuration",l:"Timer (sec)",i:"⏱️"}].map(f=>(
          <div key={f.k} style={{background:"#0d1320",border:"1px solid #1a253d",borderRadius:8,padding:"8px 12px"}}>
            <div style={{fontSize:11,color:"#7a8ea8",marginBottom:4}}>{f.i} {f.l}</div>
            <input type="number" value={lc[f.k]} onChange={e=>setLc({...lc,[f.k]:parseInt(e.target.value)||0})} style={{width:"100%",padding:"6px 8px",borderRadius:6,border:"1px solid #253554",background:"#131b2e",color:"#f7c948",fontSize:15,fontFamily:"'Oswald',sans-serif",fontWeight:700,outline:"none",boxSizing:"border-box"}} />
          </div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <button onClick={async()=>{const pv={...(config.playerValues||{})};Object.entries(pvEdit).forEach(([k,v])=>{if(v)pv[k]=v;else delete pv[k];});await updateConfig({...lc,playerValues:pv});setMsg("Saved! Reset to apply.");setTimeout(()=>setMsg(""),4000);}} style={{...S.actionBtn,background:"#f7c948",color:"#0b0f1a"}}>Save</button>
        <button onClick={()=>setConfigMgmt(false)} style={{...S.actionBtn,background:"#1e2d4a",color:"#7a8ea8"}}>Close</button>
        {msg&&<span style={{fontSize:12,color:"#27ae60",fontWeight:600}}>{msg}</span>}
      </div>
    </div>);
  };

  const TabBtn = ({active,onClick,children}) => (<button onClick={onClick} style={{padding:"8px 16px",border:"none",borderRadius:6,background:active?"#1a2744":"transparent",color:active?"#f7c948":"#7a8ea8",fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:500,letterSpacing:1,cursor:"pointer"}}>{children}</button>);

  // ── Password Modal ──
  const renderPwModal = () => {
    if(!loginTarget) return null;
    const isA=loginTarget==="admin";const team=!isA?TEAMS_INIT.find(t=>t.id===loginTarget):null;const accent=isA?"#f7c948":team?.color;const key=String(loginTarget);const isL=locked[key]&&Date.now()<locked[key];
    return(<div style={S.overlay}><div style={S.modal}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:`${accent}18`,border:`2px solid ${accent}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 12px"}}>{isA?"👑":"🏏"}</div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:accent}}>{isA?"ADMIN LOGIN":team?.name}</div>
        <div style={{fontSize:13,color:"#7a8ea8",marginTop:4}}>Enter password</div>
      </div>
      <div style={{position:"relative"}}>
        <div style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:16,color:"#4a6a94",pointerEvents:"none"}}>🔒</div>
        <input type={showPw?"text":"password"} value={pwInput} onChange={e=>{setPwInput(e.target.value);setPwError("");}} onKeyDown={e=>e.key==="Enter"&&attemptLogin()} placeholder="Enter password" autoFocus disabled={isL} style={{...S.pwInput,paddingLeft:42,borderColor:pwError?"#c0392b":"#253554",opacity:isL?0.5:1}} />
        <button style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",fontSize:18,cursor:"pointer",padding:4}} onClick={()=>setShowPw(!showPw)}>{showPw?"🙈":"👁️"}</button>
      </div>
      {pwError&&<div style={{marginTop:10,padding:"10px 14px",background:"#c0392b15",border:"1px solid #c0392b33",borderRadius:8,fontSize:13,color:"#e74c3c"}}><span>⚠️ {pwError}</span></div>}
      <div style={{display:"flex",gap:10,marginTop:24}}>
        <button onClick={cancelLogin} style={{...S.modalBtn,background:"#1e2d4a",color:"#7a8ea8",flex:1}}>Cancel</button>
        <button onClick={attemptLogin} disabled={isL||!pwInput} style={{...S.modalBtn,background:isL||!pwInput?"#2a3554":accent,color:isL||!pwInput?"#555":"#0b0f1a",flex:2,cursor:isL||!pwInput?"not-allowed":"pointer"}}>{isL?"🔒 Locked":"Login →"}</button>
      </div>
    </div></div>);
  };

  // ══════════ LOGIN ══════════
  if (!portal) {
    return (<div style={S.loginWrap}><style>{globalCSS}</style>{renderPwModal()}
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
          {state.teams.map(t=>(<button key={t.id} style={{...S.captainBtn,borderColor:t.color}} onClick={()=>setLoginTarget(t.id)}><div style={{width:10,height:10,borderRadius:"50%",background:t.color,flexShrink:0}} /><span style={{color:t.color,fontWeight:600,flex:1,textAlign:"left"}}>{t.name}</span><span style={{fontSize:13,opacity:0.5}}>🔒</span></button>))}
        </div>
        <div style={{marginTop:24,padding:"14px 16px",background:"#0d1320",borderRadius:10,border:"1px solid #1a253d"}}>
          <div style={{display:"flex",justifyContent:"space-around",textAlign:"center"}}>
            <div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#fff"}}>{ALL_PLAYERS.length}</div><div style={{fontSize:10,color:"#7a8ea8"}}>PLAYERS</div></div>
            <div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#27ae60"}}>{totalSold}</div><div style={{fontSize:10,color:"#7a8ea8"}}>SOLD</div></div>
            <div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#f7c948"}}>{totalPending}</div><div style={{fontSize:10,color:"#7a8ea8"}}>PENDING</div></div>
          </div>
        </div>
      </div>
    </div>);
  }

  // ══════════ CAPTAIN ══════════
  if (typeof portal === "number") {
    const myElig = curPlayer ? (()=>{const inc=config.bidIncrement||BID_INC;const nb=state.highestBidder===null?state.currentBid:state.currentBid+inc;return checkEligibility(myTeam,curPlayer,nb,config);})() : {eligible:false,reason:""};

    return (<div style={S.app}><style>{globalCSS}</style>
      <div style={{...S.topBar,borderBottom:`3px solid ${myTeam?.color}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:14,height:14,borderRadius:"50%",background:myTeam?.color}} />
          <div><div style={S.portalLabel}>CAPTAIN PORTAL</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#fff"}}>{myTeam?.name}</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#7a8ea8"}}>PURSE</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:myTeam?.color}}>{fmt(myTeam?.budget)}</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#7a8ea8"}}>SQUAD</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#fff"}}>{myTeam?.players.length}/{maxSq}</div></div>
          <button style={{...S.logoutBtn,background:"#2980b9"}} onClick={()=>setShowRules(!showRules)}>📋 Rules</button>
          <button style={S.logoutBtn} onClick={()=>setPortal(null)}>🔒 Logout</button>
        </div>
      </div>
      <div style={{display:"flex",gap:4,padding:"8px 20px",background:"#0d1320"}}>
        <TabBtn active={captainTab==="auction"} onClick={()=>setCaptainTab("auction")}>AUCTION</TabBtn>
        <TabBtn active={captainTab==="players"} onClick={()=>setCaptainTab("players")}>PLAYERS</TabBtn>
        <TabBtn active={captainTab==="squad"} onClick={()=>setCaptainTab("squad")}>MY SQUAD</TabBtn>
        <TabBtn active={captainTab==="teams"} onClick={()=>setCaptainTab("teams")}>TEAMS</TabBtn>
      </div>
      <div style={S.mainPad}>
        {showRules && <RulesPanel />}
        <StatsBar />
        <TeamCompliance team={myTeam} />
        <div style={{marginBottom:12}} />

        {captainTab==="auction"&&(<>
          {state.phase==="live"&&curPlayer&&(
            <div style={S.liveCard}>
              <div style={S.liveTag}>🔴 LIVE AUCTION</div>
              <div style={S.playerNameBig}>{curPlayer.name} {curPlayer.gender==="F"&&<span style={{fontSize:16,color:"#e91e8f"}}>♀</span>}</div>
              <div style={S.metaRow}>
                <span style={{...S.badge,background:"#f7c94822",color:"#f7c948",border:"1px solid #f7c94844"}}>{ROLE_ICON[curPlayer.role]} {curPlayer.role}</span>
                <span style={{...S.badge,background:"#5dade222",color:"#5dade2",border:"1px solid #5dade244"}}>{curPlayer.dept}</span>
                <span style={{...S.badge,background:curPlayer.type==="Field"?"#e74c3c22":"#27ae6022",color:curPlayer.type==="Field"?"#e74c3c":"#27ae60"}}>{curPlayer.type}</span>
                {curPlayer.gender==="F"&&<span style={{...S.badge,background:"#e91e8f22",color:"#e91e8f",border:"1px solid #e91e8f44"}}>👩 Women</span>}
              </div>
              <div style={{fontSize:11,color:"#7a8ea8",marginBottom:4}}>Base Value: {fmt(getBasePrice(curPlayer.id))}</div>
              <div style={S.bidLabel}>CURRENT BID</div>
              <div style={S.bidBig}>{fmt(state.currentBid)}</div>
              {leadTeam&&<div style={{...S.leadTag,background:leadTeam.color+"28",color:leadTeam.color,border:`1px solid ${leadTeam.color}55`}}>{leadTeam.id===portal?"🎉 YOU ARE LEADING!":`${leadTeam.name} is leading`}</div>}
              {state.timerEnd&&<div style={{margin:"16px 0 8px"}}><div style={S.timerBar}><div style={{...S.timerFill,width:`${(timeLeft/(config.timerDuration||TIMER_DURATION))*100}%`,background:timeLeft<=3?"#e74c3c":"#f7c948"}} /></div><div style={{fontSize:13,color:timeLeft<=3?"#e74c3c":"#7a8ea8",fontWeight:600}}>{timeLeft}s remaining</div></div>}
              {(()=>{
                const canBid = myElig.eligible && state.highestBidder!==portal;
                const inc=config.bidIncrement||BID_INC;const nb=state.highestBidder===null?state.currentBid:state.currentBid+inc;
                return (<>
                  <button style={{...S.bigBidBtn,background:canBid?`linear-gradient(135deg,${myTeam?.color},${myTeam?.color}cc)`:"#2a3554",color:canBid?"#fff":"#555",cursor:canBid?"pointer":"not-allowed"}} disabled={!canBid} onClick={()=>handleBid(portal)}>
                    {state.highestBidder===portal?"✅ YOU'RE LEADING":canBid?`BID ${fmt(nb)}`:"CANNOT BID"}
                  </button>
                  {!myElig.eligible && state.highestBidder!==portal && <div style={{marginTop:8,fontSize:12,color:"#c0392b",fontWeight:600}}>⚠️ {myElig.reason}</div>}
                </>);
              })()}
            </div>
          )}
          {state.phase==="waiting"&&<div style={S.waitCard}><div style={{fontSize:40,marginBottom:12}}>⏳</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,color:"#fff"}}>WAITING FOR AUCTION</div><div style={{fontSize:14,color:"#7a8ea8",marginTop:6}}>The auctioneer will start the next player soon...</div></div>}
          {state.phase==="sold"&&<div style={S.waitCard}><div style={{fontSize:40,marginBottom:12}}>🎉</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:26,color:"#27ae60"}}>SOLD!</div>{state.soldLog.length>0&&(()=>{const l=state.soldLog[state.soldLog.length-1];const p=ALL_PLAYERS[l.playerId];const t=state.teams.find(x=>x.id===l.teamId);return<div style={{marginTop:8}}><div style={{fontSize:18,color:"#fff"}}>{p.name}</div><div style={{fontSize:14,color:"#7a8ea8"}}>to <strong style={{color:t?.color}}>{t?.name}</strong> for <strong style={{color:"#f7c948"}}>{fmt(l.price)}</strong></div></div>;})()}</div>}
          {state.phase==="unsold"&&<div style={S.waitCard}><div style={{fontSize:40,marginBottom:12}}>😔</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:26,color:"#c0392b"}}>UNSOLD</div></div>}
          {state.phase==="done"&&<div style={S.waitCard}><div style={{fontSize:40,marginBottom:12}}>🏆</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:26,color:"#f7c948"}}>AUCTION COMPLETE</div></div>}
        </>)}

        {captainTab==="players"&&<PlayerList showValue={false} />}
        {captainTab==="squad"&&(<div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:"#fff",letterSpacing:1,marginBottom:6}}>MY SQUAD ({myTeam?.players.length}/{maxSq})</div>
          <div style={{fontSize:12,color:"#7a8ea8",marginBottom:10}}>Spent: {fmt(myTeam?.players.reduce((a,p)=>a+p.price,0))} · Remaining: {fmt(myTeam?.budget)}</div>
          {myTeam?.players.length===0&&<div style={{color:"#3a4a6a",fontSize:13,padding:16}}>No players yet</div>}
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {myTeam?.players.map((p,i)=>(<div key={i} style={S.squadRow}><div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
              <span style={{fontSize:14}}>{ROLE_ICON[p.role]}</span><span style={{fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name} {p.gender==="F"&&<span style={{color:"#e91e8f"}}>♀</span>}</span>
              {myTeam.captain===i&&<span style={{...S.cBadge,background:"#f7c948",color:"#0b0f1a"}}>C</span>}
              {myTeam.viceCaptain===i&&<span style={{...S.cBadge,background:"#5dade2",color:"#0b0f1a"}}>VC</span>}
            </div><div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:11,color:"#7a8ea8"}}>{fmt(p.price)}</span>
              <button style={{...S.miniBtn,...(myTeam.captain===i?{background:"#f7c948",color:"#0b0f1a",borderColor:"#f7c948"}:{})}} onClick={()=>assignCaptain(portal,i)}>C</button>
              <button style={{...S.miniBtn,...(myTeam.viceCaptain===i?{background:"#5dade2",color:"#0b0f1a",borderColor:"#5dade2"}:{})}} onClick={()=>assignVC(portal,i)}>VC</button>
            </div></div>))}
          </div>
        </div>)}
        {captainTab==="teams"&&(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8}}>
          {state.teams.map(t=>(<div key={t.id} style={{...S.miniTeamCard,borderTopColor:t.color}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:t.color,fontWeight:600}}>{t.name}</div>
            <div style={{fontSize:11,color:"#7a8ea8"}}>{t.players.length}/{maxSq} · {fmt(t.budget)} left</div>
            <TeamCompliance team={t} />
          </div>))}
        </div>)}
      </div>
    </div>);
  }

  // ══════════ ADMIN ══════════
  return (<div style={S.app}><style>{globalCSS}</style>
    <div style={{...S.topBar,borderBottom:"3px solid #f7c948"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:24}}>👑</span><div><div style={S.portalLabel}>ADMIN</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#f7c948"}}>RPL AUCTIONEER</div></div></div>
      <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
        <button style={{...S.logoutBtn,background:"#27ae60"}} onClick={()=>setShowRules(!showRules)}>📋 Rules</button>
        <button style={{...S.logoutBtn,background:"#2980b9"}} onClick={()=>setConfigMgmt(!configMgmt)}>⚙️ Settings</button>
        <button style={{...S.logoutBtn,background:"#8e44ad"}} onClick={()=>setPwMgmt(!pwMgmt)}>🔑 Passwords</button>
        <button style={{...S.logoutBtn,background:"#c0392b"}} onClick={resetAll}>Reset</button>
        <button style={S.logoutBtn} onClick={()=>setPortal(null)}>🔒 Logout</button>
      </div>
    </div>
    <div style={{display:"flex",gap:4,padding:"8px 20px",background:"#0d1320"}}>
      <TabBtn active={adminTab==="auction"} onClick={()=>setAdminTab("auction")}>AUCTION</TabBtn>
      <TabBtn active={adminTab==="players"} onClick={()=>setAdminTab("players")}>PLAYERS</TabBtn>
      <TabBtn active={adminTab==="teams"} onClick={()=>setAdminTab("teams")}>TEAMS</TabBtn>
    </div>
    <div style={S.mainPad}>
      {showRules&&<RulesPanel />}
      <StatsBar />
      {configMgmt&&<ConfigPanel />}
      {pwMgmt&&(<div style={{background:"#111827",border:"1px solid #1e2d4a",borderRadius:12,padding:20,marginBottom:20}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:"#f7c948",letterSpacing:1,marginBottom:14}}>🔑 PASSWORDS</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
          {[{key:"admin",label:"👑 Admin",color:"#f7c948"},...state.teams.map(t=>({key:String(t.id),label:t.name,color:t.color}))].map(item=>(<div key={item.key} style={{background:"#0d1320",border:"1px solid #1a253d",borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:13,fontWeight:600,color:item.color,marginBottom:4}}>{item.label}</div>
            <div style={{fontSize:11,color:"#5a6a88",marginBottom:4}}>Current: <code style={S.codePw}>{passwords[item.key]}</code></div>
            <input type="text" placeholder="New password" value={newPwInputs[item.key]||""} onChange={e=>setNewPwInputs({...newPwInputs,[item.key]:e.target.value})} style={{width:"100%",padding:"6px 10px",borderRadius:6,border:"1px solid #253554",background:"#131b2e",color:"#e2e8f0",fontSize:12,outline:"none",boxSizing:"border-box"}} />
          </div>))}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginTop:14}}>
          <button style={{...S.actionBtn,background:"#f7c948",color:"#0b0f1a"}} onClick={handleSavePasswords}>Save</button>
          <button style={{...S.actionBtn,background:"#1e2d4a",color:"#7a8ea8"}} onClick={()=>setPwMgmt(false)}>Close</button>
          {pwSaveMsg&&<span style={{fontSize:12,color:"#27ae60",fontWeight:600}}>{pwSaveMsg}</span>}
        </div>
      </div>)}

      {adminTab==="auction"&&(<>
        {state.phase==="live"&&curPlayer&&(
          <div style={{...S.liveCard,border:"2px solid #f7c94844"}}>
            <div style={S.liveTag}>🔴 LIVE — CAPTAINS CAN BID</div>
            <div style={S.playerNameBig}>{curPlayer.name} {curPlayer.gender==="F"&&<span style={{fontSize:16,color:"#e91e8f"}}>♀</span>}</div>
            <div style={S.metaRow}>
              <span style={{...S.badge,background:"#f7c94822",color:"#f7c948",border:"1px solid #f7c94844"}}>{ROLE_ICON[curPlayer.role]} {curPlayer.role}</span>
              <span style={{...S.badge,background:"#5dade222",color:"#5dade2",border:"1px solid #5dade244"}}>{curPlayer.dept}</span>
              <span style={{...S.badge,background:curPlayer.type==="Field"?"#e74c3c22":"#27ae6022",color:curPlayer.type==="Field"?"#e74c3c":"#27ae60"}}>{curPlayer.type}</span>
              {curPlayer.gender==="F"&&<span style={{...S.badge,background:"#e91e8f22",color:"#e91e8f",border:"1px solid #e91e8f44"}}>👩 Women</span>}
            </div>
            <div style={{fontSize:11,color:"#7a8ea8",marginBottom:4}}>Base: {fmt(getBasePrice(curPlayer.id))}</div>
            <div style={S.bidLabel}>CURRENT BID</div>
            <div style={S.bidBig}>{fmt(state.currentBid)}</div>
            {leadTeam&&<div style={{...S.leadTag,background:leadTeam.color+"28",color:leadTeam.color,border:`1px solid ${leadTeam.color}55`}}>{leadTeam.name} leading</div>}
            {state.timerEnd&&<div style={{margin:"16px 0 8px"}}><div style={S.timerBar}><div style={{...S.timerFill,width:`${(timeLeft/(config.timerDuration||TIMER_DURATION))*100}%`,background:timeLeft<=3?"#e74c3c":"#f7c948"}} /></div><div style={{fontSize:13,color:timeLeft<=3?"#e74c3c":"#7a8ea8",fontWeight:600}}>{timeLeft}s</div></div>}
            <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:12,flexWrap:"wrap"}}>
              {state.highestBidder&&<button style={{...S.actionBtn,background:"#27ae60",color:"#fff"}} onClick={handleSold}>SELL NOW</button>}
              <button style={{...S.actionBtn,background:"#c0392b",color:"#fff"}} onClick={handleUnsold}>UNSOLD</button>
            </div>
            <div style={{marginTop:16,fontSize:12,color:"#5a6a88",letterSpacing:1}}>BID ON BEHALF</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginTop:8}}>
              {state.teams.map(t=>{const inc=config.bidIncrement||BID_INC;const nb=state.highestBidder===null?state.currentBid:state.currentBid+inc;
                const elig=checkEligibility(t,curPlayer,nb,config);const ok=elig.eligible&&t.id!==state.highestBidder;
                return<button key={t.id} disabled={!ok} onClick={()=>handleBid(t.id)} title={elig.reason} style={{...S.adminBidBtn,borderColor:t.color,color:ok?t.color:"#333",opacity:ok?1:0.3}}>{t.name}<br/><span style={{fontSize:10,opacity:0.7}}>{fmt(t.budget)}</span>{!ok&&elig.reason&&<br/>}{!ok&&elig.reason&&<span style={{fontSize:8,color:"#c0392b"}}>{elig.reason}</span>}</button>;})}
            </div>
          </div>
        )}
        {(state.phase==="waiting"||state.phase==="sold"||state.phase==="unsold")&&(
          <div style={{textAlign:"center",padding:"24px 0"}}>
            {state.phase==="sold"&&state.soldLog.length>0&&(()=>{const l=state.soldLog[state.soldLog.length-1];const p=ALL_PLAYERS[l.playerId];const t=state.teams.find(x=>x.id===l.teamId);return<div style={{marginBottom:16}}><div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,color:"#27ae60"}}>SOLD!</div><div style={{fontSize:16,color:"#fff"}}>{p.name} → <span style={{color:t?.color}}>{t?.name}</span> for <span style={{color:"#f7c948"}}>{fmt(l.price)}</span></div></div>;})()}
            {state.phase==="unsold"&&<div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,color:"#c0392b",marginBottom:16}}>UNSOLD</div>}
            {state.pool.length>0?<button style={{...S.actionBtn,background:"linear-gradient(135deg,#f7c948,#e6a817)",color:"#0b0f1a",fontSize:16,padding:"14px 40px"}} onClick={startRandom}>{state.phase==="waiting"?"🎬 START AUCTION":"⏭️ NEXT PLAYER"}</button>
            :<div style={{fontFamily:"'Oswald',sans-serif",fontSize:32,color:"#f7c948"}}>🏆 AUCTION COMPLETE</div>}
          </div>
        )}
        {(state.phase==="waiting"||state.phase==="sold"||state.phase==="unsold")&&state.pool.length>0&&(
          <details style={{marginTop:16}}><summary style={{cursor:"pointer",fontSize:13,color:"#7a8ea8",fontWeight:600}}>Pick specific player ({state.pool.length})</summary>
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:8,maxHeight:200,overflowY:"auto"}}>
              {state.pool.map(id=>{const p=ALL_PLAYERS[id];return<button key={id} onClick={()=>startPlayer(id)} style={S.poolChip}>{ROLE_ICON[p.role]} {p.name} {p.gender==="F"?"♀":""}</button>;})}
            </div>
          </details>
        )}
      </>)}

      {adminTab==="players"&&<PlayerList showValue={true} />}
      {adminTab==="teams"&&(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
        {state.teams.map(t=>(<div key={t.id} style={{background:"#111827",border:"1px solid #1e2d4a",borderTop:`3px solid ${t.color}`,borderRadius:10,overflow:"hidden"}}>
          <div style={{padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #1e2d4a"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:t.color}} />
              {editingTeam===t.id?<input value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveTeamName(t.id)} onBlur={()=>saveTeamName(t.id)} autoFocus style={{fontFamily:"'Oswald',sans-serif",fontSize:14,background:"#1a253d",border:"1px solid #3a5080",borderRadius:4,color:"#fff",padding:"2px 8px",outline:"none",width:130}}/>
              :<><span style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:600,color:"#fff"}}>{t.name}</span><button style={{background:"none",border:"none",color:"#7a8ea8",cursor:"pointer",fontSize:12}} onClick={()=>{setEditingTeam(t.id);setEditName(t.name);}}>✏️</button></>}
            </div>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:600,color:t.color}}>{fmt(t.budget)}</span>
          </div>
          <div style={{padding:"4px 10px",borderBottom:"1px solid #1e2d4a",fontSize:11,color:"#7a8ea8",display:"flex",justifyContent:"space-between"}}>
            <span>Spent: {fmt(t.players.reduce((a,p)=>a+p.price,0))}</span>
            <TeamCompliance team={t} />
          </div>
          <div style={{padding:"6px 10px",maxHeight:220,overflowY:"auto"}}>
            {t.players.length===0&&<div style={{color:"#3a4a6a",fontSize:12,padding:12,textAlign:"center"}}>Empty</div>}
            {t.players.map((p,i)=>(<div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 6px",borderRadius:5,marginBottom:2}}>
              <div style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0}}>
                <span style={{fontSize:12}}>{ROLE_ICON[p.role]}</span><span style={{fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name} {p.gender==="F"&&<span style={{color:"#e91e8f"}}>♀</span>}</span>
                {t.captain===i&&<span style={{...S.cBadge,background:"#f7c948",color:"#0b0f1a"}}>C</span>}
                {t.viceCaptain===i&&<span style={{...S.cBadge,background:"#5dade2",color:"#0b0f1a"}}>VC</span>}
              </div>
              <div style={{display:"flex",gap:3,alignItems:"center"}}>
                <span style={{fontSize:10,color:"#7a8ea8"}}>{fmt(p.price)}</span>
                <button style={{...S.miniBtn,...(t.captain===i?{background:"#f7c948",color:"#0b0f1a",borderColor:"#f7c948"}:{})}} onClick={()=>assignCaptain(t.id,i)}>C</button>
                <button style={{...S.miniBtn,...(t.viceCaptain===i?{background:"#5dade2",color:"#0b0f1a",borderColor:"#5dade2"}:{})}} onClick={()=>assignVC(t.id,i)}>VC</button>
              </div>
            </div>))}
          </div>
          <div style={{padding:"6px 14px",borderTop:"1px solid #1e2d4a",fontSize:11,color:"#7a8ea8",display:"flex",justifyContent:"space-between"}}>
            <span>{t.players.length}/{maxSq}</span>
            <span>🏏{t.players.filter(p=>p.role==="Batsman").length} ⭐{t.players.filter(p=>p.role==="All-Rounder").length} 🎯{t.players.filter(p=>p.role==="Bowler").length}</span>
          </div>
        </div>))}
      </div>)}
    </div>
  </div>);
}

const globalCSS = `@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}@keyframes slideUp{0%{transform:translateY(20px);opacity:0}100%{transform:translateY(0);opacity:1}}@keyframes fadeIn{0%{opacity:0}100%{opacity:1}}code{font-family:'Courier New',monospace}`;

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
  modalBtn:{padding:"12px",border:"none",borderRadius:10,fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:600,letterSpacing:1},
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
  pill:{padding:"5px 14px",borderRadius:16,border:"1px solid #253554",background:"transparent",color:"#7a8ea8",fontSize:12,fontWeight:600,cursor:"pointer"},
};

export default App;
