const express=require('express'); const http=require('http'); const {Server}=require('socket.io'); const XLSX=require('xlsx'); const path=require('path');
const app=express(); const server=http.createServer(app); const io=new Server(server); app.use(express.json()); app.use(express.static(__dirname));
const PORT=process.env.PORT||3000; const ADMIN_PIN=process.env.ADMIN_PIN||'2026';
function loadPlayers(){
  const wb=XLSX.readFile(path.join(__dirname,'players.xlsx'));
  const ws=wb.Sheets['Auction Players']||wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{defval:''});

  return rows.map((r,i)=>{
    const keys=Object.keys(r);

    const findKey=(names)=>{
      return keys.find(k=>{
        const clean=k.toLowerCase().replace(/[^a-z0-9]/g,'');
        return names.includes(clean);
      });
    };

    const idKey=findKey(['playerid','id','playernumber','number']);
    const nameKey=findKey([
      'playername',
      'playersname',
      'name',
      'player'
    ]);
    const roleKey=findKey([
      'role',
      'playingrole',
      'playerrole'
    ]);

    return {
      id:String(r[idKey]||`P${String(i+1).padStart(3,'0')}`),
      name:String(r[nameKey]||`Player ${i+1}`),
      role:String(r[roleKey]||'Registered Player'),
      base:10000,
      status:'available'
    };
  });
}let players=loadPlayers(); let teams=Array.from({length:6},(_,i)=>({id:i+1,name:`Team ${i+1}`,purse:500000,count:0,players:[]})); let state={index:0,open:false,bid:10000,leader:null,history:[],started:false,finished:false};
const minSlots=()=>Math.max(0,9-teams.reduce((a,t)=>a+t.count,0));
function current(){return players[state.index]||null}
function nextBid(v){return v<50000?v+5000:v+10000}
function canBid(teamId,amount){const t=teams[teamId-1]; if(!t||t.count>=9)return false; const reserve=(9-t.count-1)*10000; return t.purse-amount>=reserve;}
function publicState(){return {players,teams,state,current:current(),settings:{base:10000,incrementBelowOrEqual50000:5000,incrementAbove50000:10000,maxPlayers:9,purse:500000}}}
function emit(){io.emit('state',publicState())}
function addLog(text){state.history.unshift({time:new Date().toISOString(),text}); state.history=state.history.slice(0,100)}
function resetBid(){state.open=false; state.leader=null; state.bid=current()?.base||10000;}
function advance(){state.index++; if(state.index>=players.length){state.finished=true; state.open=false; state.leader=null;} else resetBid();}
io.on('connection',socket=>{socket.emit('state',publicState());
 socket.on('admin:auth',pin=>socket.emit('admin:auth',pin===ADMIN_PIN));
 socket.on('admin:start',()=>{state.started=true; addLog('Auction started'); emit()});
 socket.on('admin:open',()=>{if(!state.finished){state.started=true;state.open=true;addLog(`Bidding opened for ${current()?.name}`);emit()}});
 socket.on('admin:pause',()=>{state.open=false;addLog('Bidding paused');emit()});
 socket.on('admin:sold',()=>{if(!state.open||!state.leader)return; const t=teams[state.leader-1],p=current(); if(!t||!p)return; t.purse-=state.bid;t.count++;t.players.push({id:p.id,name:p.name,role:p.role,price:state.bid}); p.status='sold';p.soldTo=t.id;p.soldPrice=state.bid;addLog(`SOLD — ${p.name} to ${t.name} for ₹${state.bid.toLocaleString('en-IN')}`);advance();emit()});
 socket.on('admin:unsold',()=>{const p=current(); if(!p)return;p.status='unsold';addLog(`UNSOLD — ${p.name}`);advance();emit()});
 socket.on('admin:next',()=>{if(!state.started){state.started=true;} if(current()) advance(); emit()});
 socket.on('admin:undo',()=>{const sold=players.findIndex(p=>p.status==='sold'); const last=state.history.find(h=>h.text.startsWith('SOLD')); if(!last)return; const match=last.text.match(/SOLD — (.+) to Team (\d+) for ₹([\d,]+)/); if(!match)return; const [,name,tid,priceText]=match; const price=Number(priceText.replace(/,/g,'')); const t=teams[Number(tid)-1]; const pi=players.findIndex(p=>p.name===name&&p.status==='sold'); if(pi<0)return; const p=players[pi]; t.purse+=price;t.count--;t.players=t.players.filter(x=>x.id!==p.id);p.status='available';delete p.soldTo;delete p.soldPrice; state.index=pi;state.finished=false;state.history.shift();resetBid();addLog(`UNDO — ${p.name}`);emit()});
 socket.on('team:bid',teamId=>{teamId=Number(teamId);if(!state.open||!state.started||state.finished)return;const amount=state.bid; if(state.leader===teamId){return;} if(!canBid(teamId,amount))return; state.leader=teamId; addLog(`Team ${teamId} bid ₹${amount.toLocaleString('en-IN')} for ${current()?.name}`); state.bid=nextBid(amount); emit()});
 socket.on('admin:settings',s=>{ /* reserved for future settings UI */ });
});
app.get('/health',(req,res)=>res.json({ok:true})); app.get('/api/state',(req,res)=>res.json(publicState()));
server.listen(PORT,()=>console.log(`SITL auction running on http://localhost:${PORT}`));
