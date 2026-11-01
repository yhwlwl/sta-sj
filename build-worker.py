import hashlib,json,pathlib,re
root=pathlib.Path(__file__).parent
html=(root/'index.html').read_text()
for name in ['app.js','style.css']:
    digest=hashlib.sha256((root/name).read_bytes()).hexdigest()[:12]
    html=re.sub(re.escape('/'+name)+r'\?v=[^"\s]+','/'+name+'?v='+digest,html)
assets={'/':[html,'text/html; charset=utf-8'], '/app.js':[(root/'app.js').read_text(),'text/javascript; charset=utf-8'], '/style.css':[(root/'style.css').read_text(),'text/css; charset=utf-8']}
runtime='''export default {async fetch(request){const u=new URL(request.url);if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const path=u.pathname.replace(/\\/+$/,'')||'/';const asset=assets[path]||((path==='/mg')?assets['/']:null);if(!asset)return new Response('Not found',{status:404});const headers={'Content-Type':asset[1],'Cache-Control':path==='/'||path==='/mg'?'no-cache':'public, max-age=1800','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src https://pan.tantantan.tech; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','X-Frame-Options':'DENY'};if(path==='/mg')headers['X-Robots-Tag']='noindex, nofollow';return new Response(request.method==='HEAD'?null:asset[0],{headers});}};'''
(root/'_worker.js').write_text('const assets='+json.dumps(assets,ensure_ascii=False)+';\n'+runtime+'\n')
print('Built _worker.js; versioned assets use content hashes.')
