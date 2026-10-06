const {test,expect}=require('playwright/test');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');let server,base;const fixtures=new Map();
test.beforeAll(async()=>{
 server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(['/member/','/booking/','/event/'].includes(url.pathname)){
   const surface=url.pathname.slice(1,-1);let html=fs.readFileSync(path.join(root,surface,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
   const fixture=`window.p2Calls=[];window.p2Friends=[{memberCode:'BBBB',displayName:'王○',status:'pending',incoming:true}];const config={supabaseUrl:location.origin,supabasePublishableKey:'fixture'};
    async function request(c,t,k,action,payload={}){p2Calls.push({action,payload});if(action.endsWith('list'))return {friends:p2Friends};if(action.endsWith('lookup'))return {memberCode:'CCCC',displayName:'陳○'};if(action.endsWith('accept'))p2Friends[0].status='accepted';return {status:'pending'};}
    window.MemberSystem={getSession:()=>({config,idToken:'fixture'}),request};${surface==='booking'?'window.BookingSystem={getSession:()=>({config,idToken:"fixture"})};window.fetch=async(u,o)=>({ok:true,json:async()=>({ok:true,data:await request(null,null,null,JSON.parse(o.body).action,JSON.parse(o.body))})});':''}
    window.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{document.getElementById('loadingView')?.classList.add('hidden');document.getElementById('${surface==='member'?'memberView':surface==='booking'?'bookingView':'eventView'}').classList.remove('hidden');document.getElementById('bookingNotice')?.classList.remove('hidden');
    const grid=document.getElementById('calendarGrid');if(grid)grid.innerHTML='<button type="button">預約日期</button>';
    const events=document.getElementById('eventList');if(events)events.innerHTML='<article class="event-ticket"><h3>QA 活動票券</h3><button type="button">查看並使用</button></article>';
    const profile={lineUserId:new URL(location.href).searchParams.get('account')||'QA-A',profileComplete:true,membershipRequired:false,memberCode:'AAAA',inviteCode:'INVITEQA'};
    window.dispatchEvent(new CustomEvent('${surface==='member'?'member-profile-ready':surface==='booking'?'booking:member-loaded':'p2-unused'}',{detail:{profile}}));window.dispatchEvent(new CustomEvent('user-tour:ready',{detail:{surface:'${surface}',profile}}));},0));`;
   fixtures.set(surface,fixture);html=html.replace('</body>',`<script src="/p2-fixture.js?surface=${surface}"></script><script src="/user-tour.js"></script>${surface==='event'?'':'<script src="/vendor/friend-qrcode.js"></script><script src="/friends.js"></script>'}</body>`);
   res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;
  }
  if(url.pathname==='/p2-fixture.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fixtures.get(url.searchParams.get('surface')));return;}
  const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream'});res.end(fs.readFileSync(file));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
});
test.afterAll(async()=>new Promise(r=>server.close(r)));
test.beforeEach(async({page})=>page.route('https://**',r=>r.abort()));
for(const surface of ['booking','event'])for(const [width,theme] of [[320,'light'],[390,'dark'],[1280,'light'],[1280,'dark']])test('tour '+surface+' '+width+' '+theme+' target stays clear and opt-out survives replay',async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.addInitScript(theme=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.theme=theme),theme);
 await page.goto(base+'/'+surface+'/');await expect(page.locator('#memberTourDialog')).toBeVisible();
 const target=surface==='event'?'#eventList .event-ticket button':'.booking-accessible-switch';
 for(let i=0;i<(surface==='event'?2:1);i++)await page.locator('#memberTourNext').click();
 await expect(page.locator('#memberTourTitle')).toContainText(surface==='event'?'查看並使用':'操作模式');
 await expect.poll(async()=>page.evaluate(target=>{const a=document.querySelector(target).getBoundingClientRect(),b=document.getElementById('memberTourDialog').getBoundingClientRect();return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));},target)).toBe(0);
 const box=await page.locator('#memberTourDialog').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
 await info.attach('tour-target-layout',{body:await page.screenshot(),contentType:'image/png'});
 expect(await page.evaluate(()=>p2Calls.filter(c=>/claim|redeem|create/.test(c.action)))).toHaveLength(0);
 await page.locator('#memberTourSkip').click();await page.reload();await expect(page.locator('#memberTourDialog')).toBeHidden();
 await page.locator('#openMemberTour').evaluate(b=>b.click());await expect(page.locator('#memberTourDialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#memberTourDialog')).toBeHidden();await page.reload();await expect(page.locator('#memberTourDialog')).toBeHidden();expect(await page.evaluate(()=>document.getElementById('app').inert)).toBe(false);
});
test('friend link needs lookup and explicit request; incoming invite accepts separately',async({page},info)=>{
 await page.goto(base+'/member/#friend=INVITEQA');await page.locator('#memberTourDismiss').click();
 await expect(page.locator('#friendQr')).toBeVisible();expect(await page.locator('#friendQr').evaluate(c=>c.width)).toBe(192);await expect(page.locator('#friendCode')).toHaveValue('INVITEQA');expect(await page.evaluate(()=>p2Calls.filter(c=>!c.action.endsWith('list')))).toHaveLength(0);
 await page.locator('#addFriendForm button[type=submit]').click();await expect(page.locator('#confirmFriendRequest')).toBeVisible();await page.locator('#confirmFriendRequest').click();
 await expect.poll(()=>page.evaluate(()=>p2Calls.filter(c=>c.action==='member.friend.request').length)).toBe(1);
 await page.locator('#friendList button').filter({hasText:'接受'}).click();await expect(page.locator('#friendList')).toContainText('已成為好友');await info.attach('friends-panel',{body:await page.locator('#friendsPanel').screenshot(),contentType:'image/png'});
});
