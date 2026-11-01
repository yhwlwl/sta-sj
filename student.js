'use strict';
(function(){
const API='https://pan.tantantan.tech/sj-api/v1';
const $=q=>document.querySelector(q);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const bytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':(n/1024).toFixed(1)+' KB';
const state={view:'home',activity:null,category:null,form:null,draft:null,files:[],busy:false,receipt:null,history:[]};
let token=localStorage.getItem('sj-token')||'';

const iconPaths={
novel:'M5 4Q9 2 12 5q3-3 7-1v16q-4-2-7 1-3-3-7-1z M12 5v16',
essay:'M6 3h10l4 4v10 M16 3v4h4 M6 3v18h6 M9 9h7 M9 13h5 M14 20l6-7 2 2-6 7-4 1z',
painting:'M12 3a9 9 0 1 0 0 18c2 0 2-2 1-3s0-3 2-3h3c6 0 5-12-6-12 M7 12h.01 M11 7h.01 M17 8h.01 M19 12h.01',
creative:'M9 17h6 M9 20h6 M9 14c-1-2-4-3-4-7a7 7 0 0 1 14 0c0 4-3 5-4 7 M9 14h6 M9 7l3 3 3-3 M12 10v4',
aigc:'M4 4h16v16H4z M4 9h16 M7 4l4 5 M14 4l4 5 M10 12l5 2.5-5 2.5z',
tianfu:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M15 9l-2 5-4 1 2-5z M12 2v3 M12 19v3 M2 12h3 M19 12h3'
};
const catIcon=id=>'<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(iconPaths[id]||iconPaths.creative)+'"/></svg>';
const specs={
 novel:['通过对科学技术的未来发展及其影响，描写未来世界故事。',['2000—30000 字。作品 Word（.docx）或 PDF，文字清晰、无乱码和排版错位。','同时上传知网、万方、维普、大雅等正规平台出具的原创性查重报告 PDF；小说重复率不得超过 8%。','严禁 AI 创作。无报告、查重超标、伪造报告、抄袭侵权均取消参评资格。']],
 essay:['描写中国和世界的美好未来，或表达对未来理想生活的想象。',['500—1000 字。作品 Word（.docx）或 PDF，文字清晰、无乱码和排版错位。','同时上传正规平台出具的原创性查重报告 PDF；作文重复率不得超过 10%。','严禁 AI 创作。无报告、查重超标、伪造报告、抄袭侵权均取消参评资格。']],
 painting:['以“我和我的未来”为主题，手绘自己在未来充满科技感的生活。',['原创手绘作品扫描为清晰 JPG 电子版，分辨率 300dpi。','严禁 AI 生成工具、绘图软件等非手绘手段，所有非手绘数字创作不符合参评要求。']],
 creative:['征集科幻相关科技发明、科技奇想、创意产品、桌游、剧本杀、模型、游戏等文创科创项目。',['如涉及实物展示，可拍摄 3 分钟以内、1920×1080、MP4 格式的视频。','将作品说明及实物展示视频打包压缩后上传。']],
 aigc:['以 AI 辅助生成技术为核心，结合剪辑、音效、字幕等制作科幻动画，围绕未来科技、宇宙探索、科幻故事、未来生活等展开。',['视频 30 秒—5 分钟，MP4，至少 1920×1080（1080P）。','画面清晰、声音流畅、无水印、无商业广告；须为 AI 生成基础上的原创创作。','提交 200 字以内的创作说明，包含 AI 工具和创作思路。']],
 tianfu:['以四川科普场馆、科研院所、科创基地、红色科教点位为依托，创作研学游记、故事、绘画、视频、AI 动画或研学路线创意等。',['立足四川科教文旅特色，兼具科学性与想象力。','严格按作品对应的文学类、绘画类或创意类要求执行。']]
};
const commonRules=['文学、绘画作品须个人原创、独立完成；创意类及专项类符合要求的作品可以由团队原创完成。','每个作品最多申报一名指导教师。','作品正文和文件中不得出现姓名、学校、单位、联系方式等作者身份信息；身份信息仅在收件表单填写。','作品须紧扣主题，兼具科学性与想象力；不得混淆科学与神话、引入神鬼迷信，内容积极健康且符合法律法规与公序良俗。'];

const fallback={
 event:{title:'“拓科学教育新路，促想象力提升”科幻创作征集活动',description:'发挥科学想象力，创作属于自己的未来世界。',deadline:'2027-04-30T23:59:59+08:00',open:false},
 categories:[
 {id:'novel',title:'科幻小说',group:'文学类',description:'描绘未来世界故事。',rules:'2000—30000 字；DOCX/PDF；个人原创，严禁 AI 创作。',extensions:'docx,pdf',allowTeam:false},
 {id:'essay',title:'科幻作文',group:'文学类',description:'描绘未来理想生活。',rules:'500—1000 字；DOCX/PDF；个人原创，严禁 AI 创作。',extensions:'docx,pdf',allowTeam:false},
 {id:'painting',title:'科幻绘画',group:'绘画类',description:'以“我和我的未来”为主题。',rules:'手绘扫描 JPG，300dpi，严禁 AI 生成及非手绘制作。',extensions:'jpg,jpeg',allowTeam:false},
 {id:'creative',title:'科幻文创科创',group:'创意类',description:'科学发明、创意产品、模型和桌游等作品。',rules:'作品说明；实物展示视频 MP4，3 分钟以内、1920×1080。',extensions:'pdf,docx,jpg,jpeg,png,mp4,zip',allowTeam:true},
 {id:'aigc',title:'AIGC 科幻动画',group:'创意类',description:'原创 AI 辅助科幻动画。',rules:'MP4、30 秒—5 分钟、至少 1080P；200 字以内创作说明。',extensions:'mp4',allowTeam:true},
 {id:'tianfu',title:'天府科普研学游',group:'专项类',description:'结合四川科教文旅资源开展研学创作。',rules:'根据游记、绘画、视频或 AI 动画等具体形式遵守相应类别要求。',extensions:'docx,pdf,jpg,jpeg,png,mp4,zip',allowTeam:true}
 ],specialTypes:['研学游记','研学故事','主题绘画','科普短视频','AI 动画','研学线路创意']
};

const nameFor=id=>state.activity?.categories.find(c=>c.id===id)?.title||id;
const error=e=>{const box=$('#notice');if(box){box.textContent=e.message||String(e);box.hidden=false;box.scrollIntoView({behavior:'smooth',block:'nearest'});}else alert(e.message||String(e));};
async function call(route,method='GET',body,extra={}){
 const res=await fetch(API+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 let data;try{data=await res.json();}catch{data={};}
 if(!res.ok)throw new Error(data.error||'网络请求失败，请重试');
 return data;
}
async function session(name){
 if(token){try{const m=await call('/me');if(m.user?.role==='admin')throw new Error('管理员请从 /mg 访问后台');return;}catch(e){if(e.message.startsWith('管理员'))throw e;token='';localStorage.removeItem('sj-token');}}
 const r=await call('/auth/guest','POST',{name});token=r.token;localStorage.setItem('sj-token',token);
}
const head=()=>'<header class="site-head"><a href="/" class="brand" data-view="home"><img class="sta-brand-logo" src="/sta-logo.jpg" alt="科协 Logo"><span><strong>成都七中科学技术协会</strong><small>文件收集平台</small></span></a><nav><button type="button" data-view="home">活动首页</button><button type="button" data-action="history">我的投稿</button><a href="/mg">管理入口</a></nav></header>';
const foot=()=>'<footer class="site-foot">成都七中科学技术协会 文件收集平台 · 原文件安全传输，未经许可不公开展示作品。<br>管理员与评选工作人员可依法依规处理投稿信息。</footer>';
const notice=()=>'<div class="notice" id="notice" role="alert" hidden></div>';
function shell(inner){
 $('#app').innerHTML=head()+'<main class="site-main">'+notice()+(state.previewOnly?'<div class="hint" role="status">开发预览：科幻收件后端尚未上线。当前只可浏览活动和类别说明，不能正式投稿。</div>':'')+inner+'</main>'+foot();
 window.scrollTo({top:0,behavior:'instant'});
}
function go(view){if(state.busy)return;state.view=view;render();}

function home(){
 const a=state.activity.event;
 const cards=state.activity.categories.map(c=>'<button type="button" class="cat-card" data-cat="'+escape(c.id)+'"><span class="cat-art">'+catIcon(c.id)+'</span><strong>'+escape(c.title)+'</strong><small>'+escape(c.group)+'</small><span class="cat-link">查看投稿要求 →</span></button>').join('');
 shell('<section class="hero"><span class="eyebrow">2026—2027 · 校园科幻创作征集</span><h1>'+escape(a.title)+'</h1><p>'+escape(a.description)+'</p><div class="hero-meta"><span>征集截止：'+date(a.deadline)+'</span><span class="'+(a.open?'open':'closed')+'">'+(a.open?'● 征集进行中':'● 当前暂不接收投稿')+'</span></div><a href="#categories" class="hero-button">选择类别，开始投稿 ↓</a></section><section id="categories" class="section"><div class="section-title"><span class="eyebrow">CHOOSE A TRACK</span><h2>选择你的创作方向</h2><p>先了解类别要求，再按步骤提交作品。</p></div><div class="cat-grid">'+cards+'</div></section><section class="notice-section"><h2>官方活动通知</h2><p>根据四川省科协、省作协第三届青少年科幻创作征集通知整理。作品征集：2026 年 8 月 1 日至 2027 年 4 月 30 日。</p><p>目前已展示通知附件中的具体要求，通知 PDF 原件尚待挂载，具体以原文为准。</p></section><section class="how"><h2>投稿只需四步</h2><div class="how-grid"><span>① 选择类别</span><span>② 填写信息</span><span>③ 上传作品</span><span>④ 确认提交</span></div><p>文学、绘画作品须个人独立原创；根据类别要求确认文件格式。作品正文请勿出现可识别作者身份的信息。</p><button type="button" class="text-link" data-action="history">已有投稿？查看我的投稿 →</button></section>');
}
function rules(){
 const c=state.category,s=specs[c.id]||[c.description,[c.rules]];
 const requirements='<ol class="detail-items">'+s[1].map(r=>'<li>'+escape(r)+'</li>').join('')+'</ol>';
 const common='<section class="common-rules"><h2>通用参赛要求</h2><ol>'+commonRules.map(r=>'<li>'+escape(r)+'</li>').join('')+'</ol></section>';
 shell('<div class="page-top"><button class="back" data-view="home">← 所有类别</button><span class="eyebrow">'+escape(c.group)+'</span></div><section class="intro-card"><span class="cat-art large">'+catIcon(c.id)+'</span><h1>'+escape(c.title)+'</h1><p>'+escape(s[0])+'</p></section><section class="panel requirements"><h2>内容和提交要求</h2>'+requirements+'<div class="rule-list"><div><span>允许格式</span><strong>'+escape(c.extensions.toUpperCase().replace(/,/g,' / '))+'</strong></div><div><span>投稿形式</span><strong>'+(c.allowTeam?'个人或符合要求的团队':'个人独立创作')+'</strong></div><div><span>文件保管</span><strong>原文件、不压缩</strong></div></div>'+common+'<div class="hint">文学类须同时提交作品正文和原创性查重报告 PDF。作品正文必须匿名，平台收件不代表通过资格审核。以正式通知为准。</div><small>依据：第三届四川省青少年科幻创作征集活动通知，附件 1 第 9—11 页。</small></section><div class="sticky-actions"><button class="primary" data-view="form" '+(!state.activity.event.open?'disabled':'')+'>了解要求，填写投稿信息 →</button></div>');
}
function gradeOptions(selected){
 return ['','初一','初二','初三','高一','高二','高三','其他'].map(x=>'<option value="'+escape(x)+'" '+(selected===x?'selected':'')+'>'+(x||'请选择年级')+'</option>').join('');
}
function classOptions(selected){
 let all=['',...Array.from({length:40},(_,i)=>String(i+1)),'其他'];
 return all.map(x=>'<option value="'+escape(x)+'" '+(selected===x?'selected':'')+'>'+(x?x==='其他'?'其他班级':x+' 班':'请选择班级')+'</option>').join('');
}
function stepHeader(i){return '<div class="steps"><span class="'+(i>=1?'on':'')+'">1 填信息</span><span class="'+(i>=2?'on':'')+'">2 传文件</span><span class="'+(i>=3?'on':'')+'">3 确认</span></div>';}
function form(){
 const c=state.category,f=state.form||{};
 const special=c.id==='tianfu'?'<label class="field"><span>专项作品形式 *</span><select name="workType" required><option value="">请选择作品形式</option>'+state.activity.specialTypes.map(x=>'<option value="'+escape(x)+'" '+(f.workType===x?'selected':'')+'>'+escape(x)+'</option>').join('')+'</select></label>':'';
 const team=c.allowTeam?'<div class="field full"><label class="checkline"><input type="checkbox" name="isTeam" id="is-team" '+(f.isTeam?'checked':'')+'> 这份作品由团队完成</label><p class="field-help">适用的创意类与专项形式可选择团队。小说、作文、绘画须个人独立完成。</p><div id="members" '+(!f.isTeam?'hidden':'')+'><label class="field"><span>其他成员（每行：姓名，年级，班级）</span><textarea name="members" rows="3" placeholder="李同学，高一，2">'+escape(f.memberText||'')+'</textarea></label></div></div>':'';
 const statement=c.id==='aigc'?'<label class="field full"><span>AI 工具与创作说明 *（最多 200 字）</span><textarea name="statement" maxlength="200" rows="4" required placeholder="使用的 AI 工具、作品构思、制作过程……">'+escape(f.statement||'')+'</textarea></label>':c.id==='creative'||c.id==='tianfu'?'<label class="field full"><span>创作说明（建议填写）</span><textarea name="statement" maxlength="1500" rows="3" placeholder="简要说明创作思路、展示内容或研学地点">'+escape(f.statement||'')+'</textarea></label>':'';
 shell('<div class="page-top"><button class="back" data-view="rules">← 类别要求</button><span class="eyebrow">'+escape(c.title)+'</span></div>'+stepHeader(1)+'<section class="panel"><h1>填写投稿信息</h1><p class="muted">年级、班级和姓名仅用于收件整理，不会公开显示在作品页面。</p><form id="student-form" class="form-grid"><label class="field"><span>年级 *</span><select name="grade" required>'+gradeOptions(f.grade)+'</select></label><label class="field"><span>班级 *</span><select name="className" required>'+classOptions(f.className)+'</select></label><label class="field full" id="other-grade" '+(f.grade!=='其他'?'hidden':'')+'><span>填写年级</span><input name="customGrade" maxlength="20" value="'+escape(f.customGrade||'')+'"></label><label class="field full" id="other-class" '+(f.className!=='其他'?'hidden':'')+'><span>填写班级</span><input name="customClass" maxlength="20" value="'+escape(f.customClass||'')+'"></label><label class="field full"><span>真实姓名 *</span><input name="studentName" required maxlength="40" autocomplete="name" value="'+escape(f.studentName||'')+'" placeholder="请填写真实姓名"></label><label class="field full"><span>作品名称 *</span><input name="workTitle" required maxlength="100" value="'+escape(f.workTitle||'')+'" placeholder="例如：2050 年的校园"></label>'+special+team+statement+'<div class="field full"><div class="hint">请确保填写信息准确。提交后工作人员会按照年级、班级及类别归档作品。</div></div><div class="field full"><button class="primary" type="submit">下一步：上传作品 →</button></div></form></section>');
}
function queueHtml(){
 const list=state.files.map((item,i)=>'<div class="file-row"><div class="file-symbol">▤</div><div class="file-data"><strong>'+escape(item.file.name)+'</strong><small>'+bytes(item.file.size)+' · '+escape(item.message||'待上传')+'</small><div class="progress"><i style="width:'+Math.max(0,Math.min(100,item.progress||0))+'%"></i></div></div>'+(state.busy||item.done?'':'<button data-remove="'+i+'" aria-label="移除文件">×</button>')+'</div>').join('');
 return list||'<div class="blank-file">还没有选择文件。请选择与该类别要求一致的作品原文件。</div>';
}
function updateQueue(){const n=$('#file-queue');if(n)n.innerHTML=queueHtml();}
function upload(){
 const c=state.category;
 const onlyOne=['painting','aigc'].includes(c.id);
 const allow='.'+c.extensions.split(',').join(',.');
 shell('<div class="page-top"><button class="back" data-view="form">← 修改信息</button><span class="eyebrow">'+escape(c.title)+'</span></div>'+stepHeader(2)+'<section class="panel"><h1>上传作品文件</h1><p class="muted">请按要求选择'+(['novel','essay'].includes(c.id)?'作品正文和查重报告 PDF（共两份）':onlyOne?'一份主作品文件':'作品说明及必要附件')+'。所有文件原样存储、不压缩。</p><div class="upload-picker"><div class="pick-icon">↑</div><strong>点此选择作品文件</strong><p>支持 '+escape(c.extensions.toUpperCase().replace(/,/g,' / '))+'</p><input id="file-input" type="file" accept="'+escape(allow)+'" '+(onlyOne?'':'multiple')+' aria-label="选择作品文件"></div><div id="file-queue">'+queueHtml()+'</div><div class="hint">需要等待文件显示“已上传并关联”，之后再完成最终提交。大文件在网络波动时支持重试和继续上传。</div><button class="primary" id="upload-start" data-action="upload">'+(state.files.length?'上传并继续 →':'先选择文件')+'</button></section>');
}
function confirm(){
 const f=state.form,d=state.draft,c=state.category;
 const fileRows=state.files.map(x=>'<li>'+escape(x.file.name)+' <span>'+bytes(x.file.size)+'</span></li>').join('');
 shell('<div class="page-top"><button class="back" data-view="upload">← 查看文件</button><span class="eyebrow">'+escape(c.title)+'</span></div>'+stepHeader(3)+'<section class="panel"><h1>确认提交信息</h1><p class="muted">提交后不可直接修改这份作品，请先检查以下内容。</p><div class="summary-list"><div><span>作品名称</span><strong>'+escape(f.workTitle)+'</strong></div><div><span>投稿类别</span><strong>'+escape(c.title)+'</strong></div><div><span>年级班级</span><strong>'+escape(f.grade+' '+f.className+' 班')+'</strong></div><div><span>投稿人</span><strong>'+escape(f.studentName)+'</strong></div>'+(f.workType?'<div><span>专项形式</span><strong>'+escape(f.workType)+'</strong></div>':'')+'</div><h2 class="small-title">已上传附件</h2><ul class="file-summary">'+fileRows+'</ul><label class="checkline promise"><input id="promise" type="checkbox"> 我确认作品为原创，并已阅读该类别的要求；作品正文不包含应匿名的作者身份信息。</label><div class="hint">平台接收作品不等于作品已通过资格审核，也不代表获奖。</div><button class="primary" data-action="submit" id="submit-button">确认提交作品</button></section>');
}
function success(){
 const r=state.receipt;
 shell('<section class="panel success"><div class="success-icon">✓</div><h1>作品提交成功</h1><p>已收到你的作品，工作人员将按照类别整理。</p><div class="receipt"><span>投稿编号</span><strong>'+escape(r.id)+'</strong><span>作品名称</span><strong>'+escape(r.workTitle)+'</strong><span>提交时间</span><strong>'+date(r.submitted)+'</strong></div><div class="hint">请妥善保存你的私密回执链接。拥有链接的人可以查询该作品的收件状态，请勿转发给无关人员。</div><button class="primary" data-action="copy-receipt">复制私密回执链接</button><button class="secondary" data-action="history">查看我的投稿</button><button class="text-link" data-view="home">返回活动首页</button></section>');
}
async function history(){
 if(!token){state.view='history';shell('<section class="panel"><h1>我的投稿</h1><p>当前浏览器未保存投稿会话。若之前保存了私密回执链接，请打开该链接查看。</p><button class="primary" data-view="home">返回活动首页</button></section>');return;}
 try{const d=await call('/scifi/submissions');state.history=d.submissions;}catch(e){error(e);state.history=[];}
 const items=state.history.map(x=>'<div class="entry"><div><strong>'+escape(x.workTitle)+'</strong><small>'+escape(nameFor(x.categoryId))+' · '+date(x.created)+'</small></div><span class="status">'+(x.status==='submitted'?'已收件':'未正式提交')+'</span>'+(x.status==='draft'?'<button class="secondary" data-resume="'+escape(x.id)+'">继续投稿 →</button>':'')+'</div>').join('');
 shell('<section class="panel"><h1>我的投稿</h1><p class="muted">仅展示当前浏览器会话关联的投稿记录。</p>'+(items||'<p class="muted">暂无投稿记录。</p>')+'<button class="secondary" data-view="home">返回活动首页</button></section>');
}
async function receipt(){
 const parts=decodeURIComponent(location.hash.slice(9)).split('.');
 if(parts.length!==2){shell('<section class="panel"><h1>回执无效</h1></section>');return;}
 try{const r=await call('/scifi/receipt/'+encodeURIComponent(parts[0]),'GET',undefined,{'X-Receipt-Key':parts[1]});shell('<section class="panel success"><div class="success-icon">✓</div><h1>投稿回执</h1><p>作品已成功收件，尚不代表通过审核。</p><div class="receipt"><span>作品名称</span><strong>'+escape(r.workTitle)+'</strong><span>类别</span><strong>'+escape(nameFor(r.categoryId))+'</strong><span>时间</span><strong>'+date(r.submitted)+'</strong><span>状态</span><strong>已收件</strong></div><button class="secondary" data-view="home">返回活动首页</button></section>');}
 catch(e){shell('<section class="panel"><h1>无法查询回执</h1><p>'+escape(e.message)+'</p><button class="secondary" data-view="home">返回活动首页</button></section>');}
}
function render(){switch(state.view){case 'home':home();break;case 'rules':rules();break;case 'form':form();break;case 'upload':upload();break;case 'confirm':confirm();break;case 'success':success();break;case 'history':history();break;case 'receipt':receipt();break;}}
function currentForm(formEl){
 const d=new FormData(formEl),grade=d.get('grade')==='其他'?String(d.get('customGrade')||'').trim():String(d.get('grade')||''),className=d.get('className')==='其他'?String(d.get('customClass')||'').trim():String(d.get('className')||'');
 const isTeam=d.has('isTeam'),memberText=String(d.get('members')||'');
 const members=memberText.trim()?memberText.trim().split('\n').map(row=>{const a=row.split(/[,，、]/).map(s=>s.trim());return {name:a[0],grade:a[1],className:a[2]};}):[];
 if(!grade||!className)throw new Error('请填写完整的年级和班级');
 return {grade,className,studentName:String(d.get('studentName')||'').trim(),workTitle:String(d.get('workTitle')||'').trim(),workType:String(d.get('workType')||''),isTeam,members,memberText,statement:String(d.get('statement')||'').trim()};
}
async function sha(blob){const h=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return [...new Uint8Array(h)].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function sendChunk(id,index,blob){
 const resp=await fetch(API+'/uploads/'+id+'/chunks/'+index,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','X-Chunk-SHA256':await sha(blob)},body:blob});
 const d=await resp.json();if(!resp.ok)throw new Error(d.error||'分片上传失败');
}
async function sendFile(item){
 const f=item.file;
 const key='sj-scifi-upload:'+state.draft.id+':'+f.name+':'+f.size+':'+f.lastModified;
 let id=localStorage.getItem(key),info;
 if(id){try{info=await call('/uploads/'+id);}catch{id=null;}}
 if(!id){info=await call('/uploads','POST',{filename:f.name,mime:f.type,size:f.size,category:f.type.startsWith('video/')?'video':f.type.startsWith('image/')?'image':'other',note:'科幻征集作品附件'});id=info.id;localStorage.setItem(key,id);}
 if(info.status!=='complete'){
  const step=state.meta.chunkSize,done=new Set((info.chunks||[]).map(c=>c.idx));
  let uploaded=0;for(let i=0;i<Math.ceil(f.size/step);i++)if(done.has(i))uploaded+=Math.min(step,f.size-i*step);
  for(let i=0;i<Math.ceil(f.size/step);i++){
   if(done.has(i))continue;
   const blob=f.slice(i*step,Math.min(f.size,(i+1)*step));
   let ok=false;
   for(let n=0;n<3;n++){try{await sendChunk(id,i,blob);ok=true;break;}catch(e){if(n===2)throw e;await new Promise(r=>setTimeout(r,(n+1)*800));}}
   if(!ok)throw new Error('上传失败');
   uploaded+=blob.size;item.progress=Math.round(uploaded/f.size*100);item.message='正在上传 '+item.progress+'%';updateQueue();
  }
  let wholeHash=f.size<=32*1048576?await sha(f):undefined;
  await call('/uploads/'+id+'/complete','POST',wholeHash?{sha256:wholeHash}:{});
 }
 await call('/scifi/submissions/'+state.draft.id+'/files','POST',{uploadId:id});
 localStorage.removeItem(key);item.progress=100;item.message='已上传并关联';item.done=true;updateQueue();
}
async function startUploads(){
 if(!state.files.length)throw new Error('请先选择作品文件');
 const single=['novel','essay','painting','aigc'].includes(state.category.id);
 if(single&&state.files.length!==1)throw new Error('此类别只能提交一份主作品文件');
 state.busy=true;
 const b=$('#upload-start');if(b){b.disabled=true;b.textContent='正在上传，请勿关闭页面…';}
 try{
  for(const item of state.files){if(item.done)continue;try{await sendFile(item);}catch(e){item.message='失败：'+e.message;updateQueue();throw e;}}
  state.view='confirm';render();
 }finally{state.busy=false;const button=$('#upload-start');if(button){button.disabled=false;button.textContent='重试上传并继续 →';}}
}
async function finalSubmit(){
 if(!$('#promise')?.checked)throw new Error('请先确认原创与投稿要求');
 state.busy=true;
 $('#submit-button').disabled=true;
 try{
  const d=await call('/scifi/submissions/'+state.draft.id+'/submit','POST',{});
  const r=d.submission;
  const url=location.origin+'/#receipt='+encodeURIComponent(r.id+'.'+d.receiptKey);
  state.receipt={id:r.id,workTitle:r.workTitle,submitted:r.submitted,url};
  state.view='success';render();
 }finally{state.busy=false;}
}
document.addEventListener('submit',async e=>{
 if(e.target.id!=='student-form')return;e.preventDefault();
 const button=e.target.querySelector('[type="submit"]');
 try{
  const f=currentForm(e.target);button.disabled=true;button.textContent='正在保存投稿信息…';
  await session(f.studentName);
  const d=await call('/scifi/submissions','POST',{...f,categoryId:state.category.id});
  state.form=f;state.draft=d;state.files=[];state.view='upload';render();
 }catch(err){error(err);button.disabled=false;button.textContent='下一步：上传作品 →';}
});
document.addEventListener('change',e=>{
 if(e.target.name==='grade')$('#other-grade').hidden=e.target.value!=='其他';
 if(e.target.name==='className')$('#other-class').hidden=e.target.value!=='其他';
 if(e.target.id==='is-team')$('#members').hidden=!e.target.checked;
 if(e.target.id==='file-input'){
  const c=state.category,allow=c.extensions.split(','),single=['novel','essay','painting','aigc'].includes(c.id);
  for(const f of e.target.files){
   const ext=f.name.split('.').pop().toLowerCase();
   if(!allow.includes(ext)){error(new Error('不支持的附件格式：'+f.name));continue;}
   if(!f.size||f.size>state.meta.maxFileMB*1048576){error(new Error('附件大小不符合限制：'+f.name));continue;}
   if(state.files.length>=10||(single&&state.files.length)){error(new Error('这个类别的附件数量已达到上限'));break;}
   if(!state.files.some(x=>x.file.name===f.name&&x.file.size===f.size&&x.file.lastModified===f.lastModified))state.files.push({file:f,message:'待上传',progress:0,done:false});
  }
  updateQueue();
  const b=$('#upload-start');if(b)b.textContent=state.files.length?'上传并继续 →':'先选择文件';
 }
});
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-view],[data-cat],[data-action],[data-remove],[data-resume]');if(!el||state.busy)return;
 if(el.dataset.view){e.preventDefault();go(el.dataset.view);return;}
 if(el.dataset.cat){state.category=state.activity.categories.find(c=>c.id===el.dataset.cat);state.form=null;state.draft=null;state.files=[];go('rules');return;}
 if(el.dataset.resume){try{const s=await call('/scifi/submissions/'+el.dataset.resume);state.category=state.activity.categories.find(c=>c.id===s.categoryId);if(!state.category)throw new Error('作品类别不再开放');state.form={...s,memberText:s.members.map(m=>m.name+'，'+m.grade+'，'+m.className).join('\\n')};state.draft=s;state.files=s.files.map(f=>({file:{name:f.filename,size:f.size,lastModified:0},done:true,progress:100,message:'已上传并关联'}));go('upload');}catch(ex){error(ex);}return;}
 if(el.dataset.remove!==undefined){state.files.splice(Number(el.dataset.remove),1);updateQueue();return;}
 if(el.dataset.action==='history'){go('history');return;}
 if(el.dataset.action==='copy-receipt'){try{await navigator.clipboard.writeText(state.receipt.url);el.textContent='✓ 已复制链接';}catch{prompt('复制下方的私密回执链接',state.receipt.url);}return;}
 if(el.dataset.action==='upload'){try{await startUploads();}catch(err){error(err);}return;}
 if(el.dataset.action==='submit'){try{await finalSubmit();}catch(err){error(err);el.disabled=false;}return;}
});
window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#receipt=')){state.view='receipt';render();}});
window.addEventListener('beforeunload',e=>{if(state.busy){e.preventDefault();e.returnValue='';}});
(async()=>{try{try{state.meta=await call('/meta');}catch(e){state.meta={chunkSize:8388608,maxFileMB:1024};state.previewOnly=true;}try{state.activity=await call('/scifi/activity');}catch(e){state.activity=fallback;state.previewOnly=true;}if(state.previewOnly)state.activity.event.open=false;state.view=location.hash.startsWith('#receipt=')?'receipt':'home';render();}catch(e){$('#app').innerHTML='<main class="site-main"><section class="panel"><h1>暂时无法连接征集平台</h1><p>'+escape(e.message)+'</p><button class="primary" onclick="location.reload()">重新连接</button></section></main>';}})();
})();
