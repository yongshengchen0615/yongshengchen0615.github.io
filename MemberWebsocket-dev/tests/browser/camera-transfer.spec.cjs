const {test,expect}=require('playwright/test');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');let server,base;
test.beforeAll(async()=>{server=http.createServer((req,res)=>{
 const file=path.join(root,new URL(req.url,'http://localhost').pathname.replace(/^\/MemberWebsocket-dev\//,''));
 if(req.url.startsWith('/MemberWebsocket-dev/points/?fixture')){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="../camera-dialog.css"><link rel="stylesheet" href="point-transfer.css"></head><body><main id="pointsView"><button id="pointTransferButton">轉贈</button><div id="activeCardView" data-card-id="CARD"></div></main><script>window.tx=new Map();window.calls=[];window.uncertain=true;window.MemberSystem={getSession:()=>({config:{},idToken:'fixture'}),request:async(c,t,k,action,p={})=>{calls.push({action,...p});if(action==='points.transfer.options')return {cards:[{cardId:'CARD',title:'QA card',balance:10}]};if(action==='member.friend.list')return {friends:[{memberCode:'BBBB',displayName:'王○',status:'accepted'}]};if(action==='points.transfer.receiver')return {memberCode:p.memberCode,displayName:'王○'};if(action==='points.transfer.create'){tx.set(p.requestId,p);if(uncertain){uncertain=false;throw Object.assign(new Error('uncertain'),{code:'API_RESPONSE_UNCERTAIN'});}return {transferId:'TX',senderBalance:7};}}};</script><script src="../camera-dialog.js"></script><script src="../vendor/friend-qrcode.js"></script><script src="../vendor/friend-qr-decoder.js"></script><script src="../friend-qr-scanner.js"></script><script src="point-transfer.js"></script><script src="../dialog-accessibility.js"></script><script>window.dispatchEvent(new CustomEvent('user-tour:ready',{detail:{surface:'points',profile:{memberCode:'AAAA'}}}));</script></body></html>`);return;}
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(file));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;});
test.afterAll(async()=>new Promise(r=>server.close(r)));
for(const width of [390,1280])test(`QR image and friend selection share recipient confirmation; uncertain retry keeps one transaction (${width}px)`,async({page})=>{
 await page.setViewportSize({width,height:844});page.on('dialog',d=>d.accept());await page.goto(base+'/MemberWebsocket-dev/points/?fixture');await page.locator('#pointTransferButton').click();
 await page.locator('#pointTransferScan').click();await expect(page.locator('#pointTransferQrDialog')).toBeVisible();
 const bytes=await page.evaluate(()=>{const qr=FriendQRCode.create('BBBB'),scale=8,margin=4,size=(qr.modules.size+margin*2)*scale,c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.fillStyle='#000';for(let r=0;r<qr.modules.size;r++)for(let col=0;col<qr.modules.size;col++)if(qr.modules.get(r,col))ctx.fillRect((col+margin)*scale,(r+margin)*scale,scale,scale);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#pointTransferQrDialog input[type=file]').setInputFiles({name:'member.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')});
 await expect(page.locator('#pointTransferQrDialog')).toBeHidden();await expect(page.locator('#pointTransferReceiver')).toContainText('BBBB');
 await page.locator('#pointTransferAmount').fill('3');await page.locator('#pointTransferSubmit').click();await expect(page.locator('#pointTransferAmount')).toBeDisabled();
 await page.locator('#pointTransferClose').click();await page.locator('#pointTransferButton').click();await page.locator('#pointTransferSubmit').click();await expect(page.locator('#pointTransferMessage')).toContainText('轉贈完成');expect(await page.evaluate(()=>tx.size)).toBe(1);
 await page.locator('#pointTransferFriendsButton').click();await page.locator('#pointTransferFriends button').click();await expect(page.locator('#pointTransferReceiver')).toContainText('BBBB');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('Escape closes only QR dialog, stops camera and returns focus to scan button',async({page})=>{
 await page.goto(base+'/MemberWebsocket-dev/points/?fixture');await page.locator('#pointTransferButton').click();await page.locator('#pointTransferScan').click();
 await page.waitForFunction(()=>document.querySelector('#pointTransferQrDialog video').srcObject);
 await page.evaluate(()=>{window.cameraTracks=document.querySelector('#pointTransferQrDialog video').srcObject.getTracks();});
 await page.keyboard.press('Escape');await expect(page.locator('#pointTransferQrDialog')).toBeHidden();await expect(page.locator('#pointTransferModal')).toBeVisible();
 expect(await page.evaluate(()=>cameraTracks.every(t=>t.readyState==='ended'))).toBe(true);await expect(page.locator('#pointTransferScan')).toBeFocused();
});
