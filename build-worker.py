import hashlib,json,pathlib,re
root=pathlib.Path(__file__).parent
def html(name):
    source=(root/name).read_text()
    for filename in ['app.js','style.css','student.js','student.css','works.js','works.css']:
        digest=hashlib.sha256((root/filename).read_bytes()).hexdigest()[:12]
        source=re.sub(re.escape('/'+filename)+r'\?v=[^"\s]+','/'+filename+'?v='+digest,source)
    return source
assets={'/':[html('index.html'),'text/html; charset=utf-8'], '/mg':[html('admin.html'),'text/html; charset=utf-8'], '/mg/works':[html('works.html'),'text/html; charset=utf-8']}
for filename,typ in [('app.js','text/javascript; charset=utf-8'),('student.js','text/javascript; charset=utf-8'),('works.js','text/javascript; charset=utf-8'),('style.css','text/css; charset=utf-8'),('student.css','text/css; charset=utf-8'),('works.css','text/css; charset=utf-8')]:
    assets['/'+filename]=[(root/filename).read_text(),typ]
runtime='''export default {async fetch(request){const u=new URL(request.url);if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const path=u.pathname.replace(/\/+$/,'')||'/';const asset=assets[path];if(!asset)return new Response('Not found',{status:404});const headers={'Content-Type':asset[1],'Cache-Control':path==='/'||path.startsWith('/mg')?'no-cache':'public, max-age=1800','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src https://pan.tantantan.tech; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','X-Frame-Options':'DENY'};if(path.startsWith('/mg'))headers['X-Robots-Tag']='noindex, nofollow';return new Response(request.method==='HEAD'?null:asset[0],{headers});}};'''
(root/'_worker.js').write_text('const assets='+json.dumps(assets,ensure_ascii=False)+';\n'+runtime+'\n')
print('Built Cloudflare Pages worker with student and admin routes.')
