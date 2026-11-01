'use strict';
(function(){
const API='https://pan.tantantan.tech/sj-api/v1',HOST='https://pan.tantantan.tech';
const $=q=>document.querySelector(q),token=localStorage.getItem('sj-token')||'';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—';
const bytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':(n/1024).toFixed(0)+' KB';
const state={page:'overview',activity:null,summary:null,filters:{},entries:[],total:0,offset:0,selected:null};
async function api(p,method='GET',body){const r=await fetch(API+p,{method,headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});let d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'请求失败');return d;}
function toast(s){const n=$('#message');if(n){n.hidden=false;n.textContent=s;setTimeout(()=>n.hidden=true,6500);}}
function nav(){return '<header class="work-head"><a href="/mg">SJ 管理后台</a><nav><button data-page="overview" class="'+(state.page==='overview'?'selected':'')+'">概览</button><button data-page="entries" class="'+(state.page==='entries'?'selected':'')+'">科幻作品</button><button data-page="settings" class="'+(state.page==='settings'?'selected':'')+'">活动设置</button><a href="/mg">文件与账号管理 ↗</a></nav></header>';}
function frame(content){$('#app').innerHTML=nav()+'<main class="work-main"><div id="message" class="work-message" hidden></div>'+content+'</main>';}
function totals(){const s=state.summary,counts=s.counts||[];
 const count=id=>counts.find(x=>x.category===id)?.count||0;
 const cards=['novel','essay','painting','creative','aigc','tianfu'].map(id=>'<div class="metric-small"><span>'+esc(state.activity.categories.find(c=>c.id===id)?.title||id)+'</span><strong>'+count(id)+'</strong></div>').join('');
 frame('<div class="work-title"><span class="eyebrow">RECEIVING WORKSPACE</span><h1>科幻征集 · 收件概览</h1><p>仅负责作品收集与整理。评审、分数和奖项管理暂未启用。</p></div><div class="metric-row"><div class="metric"><span>已正式提交</span><strong>'+s.total+'</strong></div><div class="metric"><span>尚未确认的草稿</span><strong>'+s.drafts+'</strong></div><div class="metric"><span>活动截止</span><strong class="date-small">'+date(s.activity.deadline)+'</strong></div></div><div class="work-card"><h2>各类别收件情况</h2><div class="metrics-grid">'+cards+'</div><button class="work-primary" data-page="entries">查看全部作品 →</button></div>');
}
function filterHtml(){const f=state.filters;
 const cats=state.activity.categories.map(c=>'<option value="'+esc(c.id)+'" '+(f.category===c.id?'selected':'')+'>'+esc(c.title)+'</option>').join('');
 return '<form id="filter-form" class="filters"><input name="q" placeholder="姓名、作品名称或编号" value="'+esc(f.q||'')+'"><select name="category"><option value="">所有类别</option>'+cats+'</select><input name="grade" placeholder="年级" value="'+esc(f.grade||'')+'"><input name="className" placeholder="班级" value="'+esc(f.className||'')+'"><select name="status"><option value="">全部状态</option><option value="submitted" '+(f.status==='submitted'?'selected':'')+'>已提交</option><option value="draft" '+(f.status==='draft'?'selected':'')+'>草稿</option></select><button class="work-primary">筛选</button></form>';
}
function entries(){
 const rows=state.entries.map(s=>'<tr><td><button class="detail-link" data-detail="'+esc(s.id)+'">'+esc(s.workTitle)+'</button><small>'+esc(s.id.slice(0,8))+'</small></td><td>'+esc(state.activity.categories.find(c=>c.id===s.categoryId)?.title||s.categoryId)+'</td><td>'+esc(s.grade)+' · '+esc(s.className)+' 班</td><td>'+esc(s.studentName)+'</td><td>'+s.fileCount+' 个</td><td><span class="mini-pill">'+(s.status==='submitted'?'已提交':'草稿')+'</span></td><td>'+date(s.submitted||s.created)+'</td></tr>').join('');
 frame('<div class="work-title"><span class="eyebrow">SUBMISSIONS</span><h1>参赛作品管理</h1><p>按作品管理，一份作品可对应多份原文件。导出名单仅供授权工作人员使用。</p></div><div class="work-card"><div class="work-toolbar"><h2>作品列表 <small>共 '+state.total+' 条</small></h2><button class="work-secondary" data-action="csv">下载 CSV 清单</button></div>'+filterHtml()+'<div class="table-wrap"><table><thead><tr><th>作品名称</th><th>类别</th><th>年级班级</th><th>姓名</th><th>附件</th><th>状态</th><th>提交时间</th></tr></thead><tbody>'+rows+'</tbody></table>'+(rows?'':'<div class="empty">暂无符合条件的作品</div>')+'</div><div class="pagination"><span>第 '+(Math.floor(state.offset/25)+1)+' 页</span><div><button class="work-secondary" data-action="previous" '+(!state.offset?'disabled':'')+'>上一页</button><button class="work-secondary" data-action="next" '+(state.offset+25>=state.total?'disabled':'')+'>下一页</button></div></div></div>');
}
function settings(){
 const e=state.summary.activity,cs=state.activity.categories;
 const editors=cs.map(c=>'<form data-category="'+esc(c.id)+'" class="category-form"><h3>'+esc(c.title)+'</h3><label>类别说明<textarea name="description" rows="3">'+esc(c.description)+'</textarea></label><label>上传要求<textarea name="rules" rows="3">'+esc(c.rules)+'</textarea></label><button class="work-secondary">保存该类别说明</button></form>').join('');
 frame('<div class="work-title"><span class="eyebrow">ACTIVITY SETTINGS</span><h1>活动与类别设置</h1><p>修改文字说明会即时影响学生看到的内容；格式限制仍遵循原定类别规则。</p></div><div class="work-card"><h2>当前活动</h2><form id="activity-form" class="settings-form"><label>活动名称<input name="title" required maxlength="150" value="'+esc(e.title)+'"></label><label>活动介绍<textarea name="description" rows="3">'+esc(e.description)+'</textarea></label><label>截止时间（北京时间）<input name="deadline" type="datetime-local" required value="'+esc(e.deadline.slice(0,16))+'"></label><label class="checkline"><input type="checkbox" name="open" '+(e.open?'checked':'')+'> 开放投稿</label><button class="work-primary">保存活动设置</button></form></div><div class="work-card"><h2>六个类别的文字说明</h2>'+editors+'</div>');
}
async function load(page){
 state.page=page;
 if(page==='overview'){state.summary=await api('/admin/scifi/summary');totals();}
 if(page==='entries'){const qs=new URLSearchParams({limit:25,offset:state.offset,...state.filters});const d=await api('/admin/scifi/submissions?'+qs);state.entries=d.submissions;state.total=d.total;entries();}
 if(page==='settings'){state.summary=await api('/admin/scifi/summary');settings();}
}
function detailHTML(s){
 const c=state.activity.categories.find(x=>x.id===s.categoryId);
 const files=s.files.map(f=>'<div class="detail-file"><span><strong>'+esc(f.filename)+'</strong><small>'+bytes(f.size)+' · '+esc(f.status)+'</small></span><button data-download="'+esc(f.id)+'" class="work-secondary" '+(f.status!=='complete'?'disabled':'')+'>下载文件</button></div>').join('');
 return '<div class="modal-screen"><section class="detail-dialog"><button class="close" data-action="close">×</button><h2>'+esc(s.workTitle)+'</h2><p class="muted">作品编号：'+esc(s.id)+'</p><div class="details"><div><span>类别</span><strong>'+esc(c?.title||'—')+'</strong></div><div><span>投稿人</span><strong>'+esc(s.studentName)+'</strong></div><div><span>年级班级</span><strong>'+esc(s.grade+' · '+s.className+' 班')+'</strong></div><div><span>作品形式</span><strong>'+esc(s.workType||'—')+'</strong></div><div><span>提交时间</span><strong>'+date(s.submitted||s.created)+'</strong></div><div><span>状态</span><strong>'+esc(s.status)+'</strong></div></div>'+(s.isTeam?'<h3>团队成员</h3><pre class="details-text">'+esc(s.members.map(m=>m.name+' '+m.grade+' '+m.className).join('\n'))+'</pre>':'')+(s.statement?'<h3>创作说明</h3><pre class="details-text">'+esc(s.statement)+'</pre>':'')+'<h3>作品附件</h3>'+(files||'<p class="muted">暂无附件</p>')+'<button class="work-secondary" data-action="close">关闭</button></section></div>';
}
async function saveCSV(){
 const qs=new URLSearchParams(state.filters),r=await fetch(API+'/admin/scifi/submissions.csv?'+qs,{headers:{Authorization:'Bearer '+token}});
 if(!r.ok)throw new Error('下载清单失败');
 const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='科幻作品收件清单.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-page],[data-action],[data-detail],[data-download]');if(!el)return;
 try{
  if(el.dataset.page){state.offset=0;await load(el.dataset.page);}
  if(el.dataset.action==='previous'){state.offset=Math.max(0,state.offset-25);await load('entries');}
  if(el.dataset.action==='next'){state.offset+=25;await load('entries');}
  if(el.dataset.action==='csv')await saveCSV();
  if(el.dataset.action==='close')$('#overlay').innerHTML='';
  if(el.dataset.detail){const s=await api('/admin/scifi/submissions/'+el.dataset.detail);$('#overlay').innerHTML=detailHTML(s);}
  if(el.dataset.download){const d=await api('/admin/download-tickets','POST',{ids:[el.dataset.download]});window.open(HOST+d.url,'_blank','noopener,noreferrer');}
 }catch(ex){toast(ex.message);}
});
document.addEventListener('submit',async e=>{
 const f=e.target;if(!['filter-form','activity-form'].includes(f.id)&&!f.dataset.category)return;e.preventDefault();
 try{
  const d=new FormData(f);
  if(f.id==='filter-form'){state.filters=Object.fromEntries([...d.entries()].filter(([k,v])=>v));state.offset=0;await load('entries');}
  if(f.id==='activity-form'){const local=d.get('deadline');await api('/admin/scifi/settings','PATCH',{title:d.get('title'),description:d.get('description'),deadline:local+':59+08:00',open:d.has('open')});await load('settings');toast('活动设置已保存');}
  if(f.dataset.category){await api('/admin/scifi/categories/'+f.dataset.category,'PATCH',{description:d.get('description'),rules:d.get('rules')});const fresh=await api('/scifi/activity');state.activity=fresh;toast('类别说明已保存');}
 }catch(ex){toast(ex.message);}
});
(async()=>{try{
 if(!token)throw new Error('请先登录管理员账号');
 const me=await api('/me');if(me.user.role!=='admin')throw new Error('当前账号没有管理员权限');
 state.activity=await api('/scifi/activity');await load('overview');
 }catch(e){$('#app').innerHTML='<main class="work-login"><h1>科幻作品收件后台</h1><p>'+esc(e.message)+'</p><a class="work-primary" href="/mg">前往管理员登录 →</a></main>';}
})();
})();
