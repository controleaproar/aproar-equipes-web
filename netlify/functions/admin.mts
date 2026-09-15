import type { Config, Context } from "@netlify/functions";
import postgres, { type Sql } from "postgres";

const ENGENHEIROS = ["EDUARDO","GABRIEL","GUSTAVO","JOEL","NETO","PAULO","SOARES","VICTOR"];
const UNIDADES = ["BARRA DO CEARÁ","MARACANAÚ","COLISEU","HORIZONTE","ESCRITÓRIO","CENTRO","MUSEU","FIEC","UNIFOR","SEBRAE"];
const TURNOS = ["Integral","Manhã","Tarde","Noite"];
const TRELLO_JSON_URL = "https://trello.com/b/TX8hGvmI.json";

function db() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL não configurada.");
  return postgres(url, { prepare: false, max: 4 });
}
function norm(v:any){ return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim(); }
function turn(v:any){ const t=String(v||"Integral"); return TURNOS.includes(t)?t:"Integral"; }
function overlap(a:any,b:any){ const x=turn(a),y=turn(b); return x==="Integral"||y==="Integral"||x===y; }
function placeholderName(unit:string){ return `A DEFINIR NO APONTAMENTO - ${String(unit||"").trim().toUpperCase()}`; }
function isPlaceholder(name:any){ return norm(name).startsWith("A DEFINIR NO APONTAMENTO"); }
function identifyUnit(name:string){
  const t=norm(name);
  if(t.includes("APRL005")||t.includes("MARACANAU")) return "MARACANAÚ";
  if(t.includes("SEBRAE")) return "SEBRAE"; if(t.includes("UNIFOR")) return "UNIFOR";
  if(t.includes("IDALYA")||t.includes("MATHEUS")) return "IDALYA E MATHEUS";
  if(t.includes("COLISEU")) return "COLISEU"; if(t.includes("BARRA")) return "BARRA DO CEARÁ";
  if(t.includes("MUSEU")) return "MUSEU"; if(t.includes("HORIZONTE")) return "HORIZONTE";
  if(t.includes("ESCRITORIO")) return "ESCRITÓRIO";
  if(t.includes("CASA DA INDUSTRIA")||t.includes("FIEC")||t.includes(" DR ")||t.includes("| SESI DR")) return "FIEC";
  if(t.includes("CENTRO")) return "CENTRO";
  const p=String(name||"").split("|"); return p.length>=2?p[1].trim().toUpperCase():"GERAL";
}
function today(){ return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Fortaleza",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
function tomorrow(){ const d=new Date(`${today()}T12:00:00-03:00`); d.setDate(d.getDate()+1); return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Fortaleza",year:"numeric",month:"2-digit",day:"2-digit"}).format(d); }
async function audit(sql:Sql, entity:string,id:any,action:string,user:string,before:any=null,after:any=null,context:any={}){
  await sql`INSERT INTO auditoria(entidade,entidade_id,acao,usuario,antes,depois,contexto) VALUES(${entity},${String(id||"")},${action},${user||"SISTEMA"},${before?sql.json(before):null},${after?sql.json(after):null},${sql.json(context||{})})`;
}
async function getPlaceholder(sql:Sql, unit:string){
  const u=String(unit||"").trim().toUpperCase(); if(!u) return null;
  const rows=await sql`SELECT id,nome FROM obras WHERE unidade=${u} ORDER BY id`;
  const found=rows.find((r:any)=>isPlaceholder(r.nome)); if(found) return Number(found.id);
  const name=placeholderName(u);
  const [created]=await sql`INSERT INTO obras(unidade,nome) VALUES(${u},${name}) ON CONFLICT(nome) DO UPDATE SET unidade=EXCLUDED.unidade, atualizado_em=now() RETURNING id`;
  return Number(created.id);
}
async function bootstrap(sql:Sql,date:string){
  const d=date||today(); const next=tomorrow();
  const [works,people,day,nextRows,conflicts,offs,auditRows,errs] = await Promise.all([
    sql`SELECT id,unidade,nome FROM obras ORDER BY unidade,nome`,
    sql`SELECT id,nome,funcao,valor_diaria,ativo FROM colaboradores WHERE ativo=TRUE ORDER BY nome`,
    sql`SELECT c.*,co.nome colaborador_nome,co.funcao,o.nome obra_nome,o.unidade FROM convocacoes c JOIN colaboradores co ON co.id=c.colaborador_id LEFT JOIN obras o ON o.id=c.obra_id WHERE c.data=${d}::date ORDER BY c.engenheiro,co.nome`,
    sql`SELECT c.*,co.nome colaborador_nome,co.funcao,o.nome obra_nome,o.unidade FROM convocacoes c JOIN colaboradores co ON co.id=c.colaborador_id LEFT JOIN obras o ON o.id=c.obra_id WHERE c.data=${next}::date ORDER BY c.engenheiro,co.nome`,
    sql`SELECT * FROM conflitos_convocacao WHERE resolvido=FALSE ORDER BY criado_em DESC LIMIT 100`,
    sql`SELECT i.*,c.nome colaborador_nome,c.funcao FROM indisponibilidades i JOIN colaboradores c ON c.id=i.colaborador_id WHERE i.ativo=TRUE AND i.fim>=${d}::date ORDER BY i.inicio,c.nome LIMIT 200`,
    sql`SELECT * FROM auditoria ORDER BY ocorrido_em DESC LIMIT 80`,
    sql`SELECT count(*)::int qtd FROM erros_sistema WHERE ocorrido_em>=now()-interval '7 days'`
  ]);
  const pending=day.filter((r:any)=>isPlaceholder(r.obra_nome));
  const absences=day.filter((r:any)=>["Falta","Atestado"].includes(String(r.status)));
  return {ok:true,date:d,nextDate:next,engineers:ENGENHEIROS,units:UNIDADES,works,people,day,nextRows,conflicts,offs,audit:auditRows,errors7d:Number(errs[0]?.qtd||0),summary:{team:day.length,pending:pending.length,absences:absences.length,conflicts:conflicts.length,tomorrow:nextRows.length}};
}
async function listConvocations(sql:Sql,date:string){
  return sql`SELECT c.*,co.nome colaborador_nome,co.funcao,o.nome obra_nome,o.unidade,a.id apontamento_id,a.retroativo,a.apontado_em FROM convocacoes c JOIN colaboradores co ON co.id=c.colaborador_id LEFT JOIN obras o ON o.id=c.obra_id LEFT JOIN apontamentos a ON a.convocacao_id=c.id WHERE c.data=${date}::date ORDER BY c.engenheiro,co.nome`;
}
async function dashboard(sql:Sql,start:string,end:string){
  const rows=await sql`SELECT c.id,c.data::text,c.engenheiro,c.status,c.valor_extra,c.turno,c.observacao,co.id colaborador_id,co.nome colaborador_nome,co.funcao,co.valor_diaria,o.id obra_id,o.nome obra_nome,o.unidade,a.id apontamento_id,a.retroativo,a.apontado_em::text FROM convocacoes c JOIN colaboradores co ON co.id=c.colaborador_id LEFT JOIN obras o ON o.id=c.obra_id LEFT JOIN apontamentos a ON a.convocacao_id=c.id WHERE c.data BETWEEN ${start}::date AND ${end}::date ORDER BY c.data,c.engenheiro,co.nome`;
  const total=rows.length, pointed=rows.filter((r:any)=>r.apontamento_id||!isPlaceholder(r.obra_nome)).length;
  const faltas=rows.filter((r:any)=>r.status==="Falta").length, atestados=rows.filter((r:any)=>r.status==="Atestado").length;
  const extras=rows.reduce((s:number,r:any)=>s+Number(r.valor_extra||0),0);
  const retro=rows.filter((r:any)=>r.retroativo).length;
  const byEngineer:any={}; const byUnit:any={};
  for(const r of rows){ const e=r.engenheiro||"N/A",u=r.unidade||"NÃO IDENTIFICADA"; byEngineer[e]=(byEngineer[e]||0)+1; byUnit[u]=(byUnit[u]||0)+1; }
  return {ok:true,rows,metrics:{total,pointed,pending:Math.max(0,total-pointed),faltas,atestados,extras,retro,attendance:total?Math.round(((total-faltas-atestados)/total)*1000)/10:0,pointingRate:total?Math.round(pointed/total*1000)/10:0},byEngineer,byUnit};
}
async function availability(sql:Sql,date:string,shift:string){
  const people=await sql`SELECT id,nome,funcao FROM colaboradores WHERE ativo=TRUE ORDER BY nome`;
  const conv=await sql`SELECT c.colaborador_id,c.turno,c.engenheiro,o.unidade FROM convocacoes c LEFT JOIN obras o ON o.id=c.obra_id WHERE c.data=${date}::date`;
  const offs=await sql`SELECT colaborador_id,motivo FROM indisponibilidades WHERE ativo=TRUE AND inicio<=${date}::date AND fim>=${date}::date`;
  const offMap=new Map(offs.map((x:any)=>[Number(x.colaborador_id),x]));
  return {ok:true,rows:people.map((p:any)=>{ const off=offMap.get(Number(p.id)); if(off)return {...p,state:"indisponivel",detail:off.motivo}; const busy=conv.filter((c:any)=>Number(c.colaborador_id)===Number(p.id)&&overlap(c.turno,shift)); return busy.length?{...p,state:"ocupado",detail:busy.map((b:any)=>`${b.turno} · ${b.engenheiro}${b.unidade?` · ${b.unidade}`:""}`).join(" | ")}:{...p,state:"livre",detail:"Livre no turno"};})};
}
async function whatsapp(sql:Sql,date:string){
  const rows=await sql`SELECT c.turno,c.engenheiro,co.nome,co.funcao,o.unidade FROM convocacoes c JOIN colaboradores co ON co.id=c.colaborador_id LEFT JOIN obras o ON o.id=c.obra_id WHERE c.data=${date}::date ORDER BY o.unidade,c.turno,co.nome`;
  return {ok:true,rows};
}
async function finance(sql:Sql,start:string,end:string){
  const rows=await sql`SELECT c.data::text,co.nome colaborador,co.funcao,o.unidade,c.engenheiro,COALESCE(a.status,c.status) status,COALESCE(a.valor_extra,c.valor_extra,0)::float valor_extra FROM convocacoes c JOIN colaboradores co ON co.id=c.colaborador_id LEFT JOIN obras o ON o.id=c.obra_id LEFT JOIN apontamentos a ON a.convocacao_id=c.id WHERE c.data BETWEEN ${start}::date AND ${end}::date ORDER BY c.data,co.nome`;
  const extras=rows.filter((r:any)=>Number(r.valor_extra)>0 && !["Falta","Atestado"].includes(String(r.status)));
  const absences=rows.filter((r:any)=>["Falta","Atestado"].includes(String(r.status)));
  const totalExtra=extras.reduce((s:number,r:any)=>s+Number(r.valor_extra||0),0);
  return {ok:true,rows,extras,absences,totalExtra,faltas:absences.filter((r:any)=>r.status==="Falta").length,atestados:absences.filter((r:any)=>r.status==="Atestado").length};
}
async function trelloSnapshot(){ const res=await fetch(TRELLO_JSON_URL,{headers:{"User-Agent":"APROAR-Equipes/1.0"}}); if(!res.ok)throw new Error(`Trello HTTP ${res.status}`); const data:any=await res.json(); return {lists:Array.isArray(data.lists)?data.lists:[],cards:Array.isArray(data.cards)?data.cards:[]}; }

export default async (req:Request,_ctx:Context)=>{
  const sql=db(); const url=new URL(req.url); const op=url.searchParams.get("op")||"bootstrap"; const headers={"Cache-Control":"no-store"};
  try{
    if(req.method==="GET"){
      if(op==="bootstrap") return Response.json(await bootstrap(sql,url.searchParams.get("date")||today()),{headers});
      if(op==="convocations") return Response.json({ok:true,rows:await listConvocations(sql,url.searchParams.get("date")||today())},{headers});
      if(op==="dashboard"||op==="report"||op==="indicators") return Response.json(await dashboard(sql,url.searchParams.get("start")||today(),url.searchParams.get("end")||today()),{headers});
      if(op==="availability") return Response.json(await availability(sql,url.searchParams.get("date")||today(),url.searchParams.get("shift")||"Integral"),{headers});
      if(op==="whatsapp") return Response.json(await whatsapp(sql,url.searchParams.get("date")||tomorrow()),{headers});
      if(op==="finance") return Response.json(await finance(sql,url.searchParams.get("start")||today(),url.searchParams.get("end")||today()),{headers});
      if(op==="audit") return Response.json({ok:true,rows:await sql`SELECT * FROM auditoria ORDER BY ocorrido_em DESC LIMIT 300`},{headers});
      if(op==="health") { const [x]=await sql`SELECT now() now`; return Response.json({ok:true,database:true,now:x.now,tables:await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`},{headers}); }
      if(op==="trello") { const snap=await trelloSnapshot(); return Response.json({ok:true,...snap},{headers}); }
      return Response.json({error:"Operação não encontrada."},{status:404,headers});
    }
    if(req.method!=="POST") return Response.json({error:"Método não permitido."},{status:405,headers});
    const b:any=await req.json(); const action=String(b.action||""); const user=String(b.user||"CONTROLADORIA");
    if(action==="create_convocations"){
      const date=String(b.date||tomorrow()), engineer=String(b.engineer||""), shift=turn(b.shift), unit=String(b.unit||"").trim().toUpperCase(); const ids=(Array.isArray(b.collaboratorIds)?b.collaboratorIds:[]).map(Number).filter(Boolean);
      if(!engineer||!unit||!ids.length) return Response.json({error:"Informe engenheiro, unidade e colaboradores."},{status:400,headers});
      const workId=await getPlaceholder(sql,unit); let created=0; const warnings:string[]=[];
      for(const id of ids){
        const [person]=await sql`SELECT id,nome FROM colaboradores WHERE id=${id} AND ativo=TRUE`; if(!person)continue;
        const [off]=await sql`SELECT motivo,inicio::text,fim::text FROM indisponibilidades WHERE colaborador_id=${id} AND ativo=TRUE AND inicio<=${date}::date AND fim>=${date}::date LIMIT 1`;
        if(off){warnings.push(`${person.nome}: indisponível (${off.motivo}).`);continue;}
        const existing=await sql`SELECT c.*,o.unidade FROM convocacoes c LEFT JOIN obras o ON o.id=c.obra_id WHERE c.colaborador_id=${id} AND c.data=${date}::date`;
        const clash=existing.find((x:any)=>overlap(x.turno,shift));
        if(clash){ if(norm(clash.engenheiro)!==norm(engineer)){ await sql`INSERT INTO conflitos_convocacao(colaborador_id,colaborador_nome_snapshot,data,convocacao_existente_id,engenheiro_original,turno_original,unidade_original,engenheiro_tentativa,turno_tentativa,unidade_tentativa,contexto) VALUES(${id},${person.nome},${date}::date,${clash.id},${clash.engenheiro},${clash.turno},${clash.unidade||""},${engineer},${shift},${unit},${sql.json({origem:"controladoria_next"})})`; warnings.push(`${person.nome}: conflito com ${clash.engenheiro} registrado para o Paulo.`); } else warnings.push(`${person.nome}: já convocado em ${clash.turno}.`); continue; }
        const [r]=await sql`INSERT INTO convocacoes(obra_id,colaborador_id,data,engenheiro,status,valor_extra,turno,criado_por) VALUES(${workId},${id},${date}::date,${engineer},'Presente (Integral)',0,${shift},${user}) RETURNING id`;
        await audit(sql,"convocacao",r.id,"CRIAR",user,null,{date,engineer,shift,unit,collaboratorId:id}); created++;
      }
      return Response.json({ok:created>0,created,warnings,message:`${created} convocação(ões) criada(s).`},{headers});
    }
    if(action==="update_convocation"){
      const id=Number(b.id), engineer=String(b.engineer||""), unit=String(b.unit||""), workId=Number(b.workId||0)||await getPlaceholder(sql,unit), shift=turn(b.shift);
      const [before]=await sql`SELECT * FROM convocacoes WHERE id=${id}`; if(!before)return Response.json({error:"Convocação não encontrada."},{status:404,headers});
      await sql`UPDATE convocacoes SET obra_id=${workId},engenheiro=${engineer||before.engenheiro},turno=${shift},atualizado_em=now() WHERE id=${id}`; await audit(sql,"convocacao",id,"REALOCAR",user,before,{workId,engineer,shift,unit}); return Response.json({ok:true},{headers});
    }
    if(action==="delete_convocation"){
      const id=Number(b.id); const [before]=await sql`SELECT * FROM convocacoes WHERE id=${id}`; if(!before)return Response.json({error:"Convocação não encontrada."},{status:404,headers}); await sql`DELETE FROM convocacoes WHERE id=${id}`; await audit(sql,"convocacao",id,"EXCLUIR",user,before,null); return Response.json({ok:true},{headers});
    }
    if(action==="resolve_conflict"){
      const id=Number(b.id); await sql`UPDATE conflitos_convocacao SET resolvido=TRUE,resolvido_em=now(),resolvido_por=${user} WHERE id=${id}`; await audit(sql,"conflito_convocacao",id,"RESOLVER",user); return Response.json({ok:true},{headers});
    }
    if(action==="save_unavailability"){
      const cid=Number(b.collaboratorId),reason=String(b.reason||"Indisponível"),start=String(b.start),end=String(b.end),obs=String(b.observation||""); const [p]=await sql`SELECT nome FROM colaboradores WHERE id=${cid}`; if(!p||!start||!end)return Response.json({error:"Dados incompletos."},{status:400,headers}); const [r]=await sql`INSERT INTO indisponibilidades(colaborador_id,colaborador_nome_snapshot,motivo,inicio,fim,observacao,criado_por) VALUES(${cid},${p.nome},${reason},${start}::date,${end}::date,${obs},${user}) RETURNING id`; await audit(sql,"indisponibilidade",r.id,"CRIAR",user,null,{cid,reason,start,end,obs}); return Response.json({ok:true,id:r.id},{headers});
    }
    if(action==="delete_unavailability") { const id=Number(b.id); const [before]=await sql`SELECT * FROM indisponibilidades WHERE id=${id}`; await sql`UPDATE indisponibilidades SET ativo=FALSE WHERE id=${id}`; await audit(sql,"indisponibilidade",id,"EXCLUIR",user,before,null); return Response.json({ok:true},{headers}); }
    if(action==="save_collaborator"){
      const id=Number(b.id||0),name=String(b.name||"").trim(),func=String(b.functionName||"").trim(),daily=Math.max(0,Number(b.daily||0)); if(!name)return Response.json({error:"Informe o nome."},{status:400,headers});
      if(id){ const [before]=await sql`SELECT * FROM colaboradores WHERE id=${id}`; await sql`UPDATE colaboradores SET nome=${name},funcao=${func||null},valor_diaria=${daily},ativo=${b.active!==false},atualizado_em=now() WHERE id=${id}`; await audit(sql,"colaborador",id,"ATUALIZAR",user,before,{name,func,daily}); return Response.json({ok:true,id},{headers}); }
      const [r]=await sql`INSERT INTO colaboradores(nome,funcao,valor_diaria,ativo) VALUES(${name},${func||null},${daily},TRUE) RETURNING id`; await audit(sql,"colaborador",r.id,"CRIAR",user,null,{name,func,daily}); return Response.json({ok:true,id:r.id},{headers});
    }
    if(action==="save_work"){
      const id=Number(b.id||0),name=String(b.name||"").trim(),unit=String(b.unit||"").trim().toUpperCase(); if(!name||!unit)return Response.json({error:"Informe unidade e obra/serviço."},{status:400,headers});
      if(id){ const [before]=await sql`SELECT * FROM obras WHERE id=${id}`; await sql`UPDATE obras SET nome=${name},unidade=${unit},atualizado_em=now() WHERE id=${id}`; await audit(sql,"obra",id,"ATUALIZAR",user,before,{name,unit}); return Response.json({ok:true,id},{headers}); }
      const [r]=await sql`INSERT INTO obras(unidade,nome) VALUES(${unit},${name}) ON CONFLICT(nome) DO UPDATE SET unidade=EXCLUDED.unidade,atualizado_em=now() RETURNING id`; await audit(sql,"obra",r.id,"SINCRONIZAR",user,null,{name,unit}); return Response.json({ok:true,id:r.id},{headers});
    }
    if(action==="sync_trello"){
      const snap=await trelloSnapshot(); const now=new Date(); const month=norm(now.toLocaleString("pt-BR",{month:"long",timeZone:"America/Fortaleza"})); const year=String(now.getFullYear()); const target=snap.lists.find((l:any)=>norm(l.name).includes(`MEDICAO ${month} ${year}`))||snap.lists.find((l:any)=>norm(l.name).includes("EM EXECUCAO")); if(!target)return Response.json({error:"Lista do mês vigente/Em execução não encontrada no Trello."},{status:404,headers});
      const cards=snap.cards.filter((c:any)=>c.idList===target.id&&!c.closed); let added=0,existing=0; for(const c of cards){ const name=String(c.name||"").trim(); if(!name)continue; const [r]=await sql`INSERT INTO obras(unidade,nome) VALUES(${identifyUnit(name)},${name}) ON CONFLICT(nome) DO NOTHING RETURNING id`; if(r)added++; else existing++; } await audit(sql,"trello",target.id,"SINCRONIZAR",user,null,{lista:target.name,added,existing}); return Response.json({ok:true,added,existing,list:target.name},{headers});
    }
    if(action==="cleanup"){
      if(String(b.confirmation||"")!=="LIMPAR DADOS") return Response.json({error:'Digite exatamente "LIMPAR DADOS".'},{status:400,headers});
      await sql.begin(async tx=>{ await tx`DELETE FROM servicos_apontamento`; await tx`DELETE FROM apontamentos`; await tx`DELETE FROM conflitos_convocacao`; await tx`DELETE FROM convocacoes`; await tx`DELETE FROM indisponibilidades`; await tx`DELETE FROM auditoria`; await tx`DELETE FROM erros_sistema`; });
      return Response.json({ok:true,message:"Dados operacionais limpos. Obras e colaboradores foram preservados."},{headers});
    }
    return Response.json({error:"Ação não encontrada."},{status:404,headers});
  }catch(e:any){
    try{ await sql`INSERT INTO erros_sistema(codigo,modulo,acao,tipo_erro,mensagem,detalhes,ambiente) VALUES('NEXT_ADMIN','admin',${op},${e?.name||'Error'},${String(e?.message||e)},${String(e?.stack||'').slice(0,6000)},'netlify')`; }catch{}
    return Response.json({error:"Não foi possível concluir a operação.",detail:String(e?.message||e)},{status:500,headers});
  }finally{ await sql.end({timeout:1}).catch(()=>{}); }
};

export const config: Config={path:"/api/admin"};
