// 本机演示数据验收，不访问生产服务，不正式提交提名。
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/31918/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const assert = (value, message) => { if (!value) throw Error(message); };
const out = __dirname;
const origin = 'http://127.0.0.1:4176';
const user = { id: 'review-detail-user', name: 'Review Nominator', email: 'reviewer@example.test', role: 'participant', skills: [] };
const award = { id: 'review-detail-award', title: '2026 Digital Pioneer Award', status: 'running', tags: [], prizes: [] };
const summary = 'Improved customer response time by twenty percent through coordinated digital workflows.\n\n跨团队协作让客户等待时间缩短，结果经过实际数据核对。';
const impact = 'The team reduced waiting time, improved service quality and shared the solution with partner teams in 2026.\n\nThe same measured workflow now supports multiple departments without duplicate work. 通过共享流程，提高了服务质量并减少重复工作。';
const culture = 'We listened to customers, shared ownership and worked across functions to deliver measurable value.\n\n我们持续倾听客户反馈，将经验分享给其他团队，形成长期合作。';
const individualHeads = ['Executive Summary (The Elevator Pitch)', 'Details Of Your Core Achievement In 2026 And Business Impact (Including Financial Figures)', 'How You Demonstrate BD China Culture (Especially On You Applied Category)?'];
const teamHeads = ['Achievement Summary', 'Details of Your Team Achievement in 2026 and Business Impact', 'How you demonstrate BD China culture (especially on you applied category) ?'];
const description = type => (type === 'team' ? teamHeads : individualHeads).map((heading, index) => heading + '\n' + [summary, impact, culture][index]).join('\n\n');
// 生成含实际文字、xref 和字体资源的一页 PDF，供本地文件与远程附件共同验证。
const stream = 'BT /F1 22 Tf 40 250 Td (Review Evidence PDF) Tj 0 -40 Td /F1 13 Tf (Demo data - loaded only after Preview Attachment.) Tj ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 320] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let pdfText = '%PDF-1.4\n'; const offsets = [0];
objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdfText)); pdfText += `${index + 1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdfText);
pdfText += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const pdf = Buffer.from(pdfText);
fs.writeFileSync(path.join(out, 'review-evidence.pdf'), pdf);
const photoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="600" height="450" fill="#164874"/><circle cx="300" cy="160" r="72" fill="#a5d9f7"/><path d="M150 410v-70a150 110 0 0 1 300 0v70" fill="#a5d9f7"/><text x="300" y="435" text-anchor="middle" font-family="sans-serif" font-size="22" fill="white">Demo Photo</text></svg>';
let omitPhoto = false;
const nomination = type => ({ id: 'review-' + type, title: type === 'team' ? 'Customer Service Improvement Team' : user.name, description: description(type), category: 'Customer Values', hackathonId: award.id, createdBy: user.id, teamId: null, tags: ['Demo Tag'], votes: 2, userHasVoted: true, status: 'submitted', attachments: [], createdAt: '2026-11-09T08:00:00Z', updatedAt: '2026-11-09T08:00:00Z', approvalStatus: 'approved', approvalVersion: 1, approvalHeadName: 'Demo HoD', projectAttachments: [
  { type: 'nomination', nominationType: type, name: user.name, url: '', employeeEmail: user.email, nomineeOrgCode: 'BD/Review', nomineePosition: 'Engineer', nominatingHead: 'Demo HoD', nominatorName: user.name, projectName: 'Customer Service Improvement Team', coreTeamMembers: 'Member One;Member Two', achievementSummary: summary, teamAchievementImpact: impact, cultureDemonstration: culture },
  { type: 'screenshot', name: 'Review Photo', url: '/storage/review-photo.svg' },
  { type: 'document', name: 'review-evidence.pdf', url: '/storage/review-evidence.pdf' },
].filter(item=>!omitPhoto||item.type!=='screenshot') });
const styles = async locator => locator.evaluateAll(elements => elements.map(el => { const style = getComputedStyle(el); return { text: el.textContent.trim(), family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, color: style.color }; }));
const geometry = async dialog => dialog.evaluate(el => {
  const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
  const photo = el.querySelector('img'), body = el.querySelector('.dp-candidate-detail-sections'), frame = el.querySelector('iframe');
  const blocks = [...el.querySelectorAll('.dp-candidate-detail-paragraph')];
  return { dialog:rect(el), photo:photo ? rect(photo):null, body:body ? rect(body):null, frame:frame ? rect(frame):null, paragraphs:blocks.map(rect), horizontalOverflow:el.scrollWidth>el.clientWidth+1 };
});
const disjoint = (a,b) => a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1;
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  let pdfRequests=0,uploads=0,submits=0;
  const results={ demoData:true, details:[], previews:[] };
  try {
    await page.route('**/storage/review-photo.svg', route => route.fulfill({ contentType:'image/svg+xml',body:photoSvg }));
    await page.route('**/storage/review-evidence.pdf', route => { pdfRequests++; return route.fulfill({ contentType:'application/pdf',headers:{'Content-Disposition':'inline; filename="review-evidence.pdf"'},body:pdf }); });
    await page.route('**/api/v1/**', route => {
      const request=route.request(), pathname=new URL(request.url()).pathname;
      if(request.method()==='POST' && pathname.includes('/storage/upload/')) uploads++;
      if(request.method()==='POST' && pathname.endsWith('/ideas')) submits++;
      const ideas=['individual','team'].map(nomination); let body=[];
      if(pathname.endsWith('/auth/refresh')) body={accessToken:'local-review-fixture'};
      else if(pathname.endsWith('/profiles/me')) body=user;
      else if(pathname.endsWith('/nomination-eligibility')) body={canSubmit:true,canReview:true,nominatingHead:'Demo HoD'};
      else if(pathname.endsWith('/me/nominations')) body=[];
      else if(pathname.endsWith('/hackathons')||pathname.endsWith('/public/awards')) body={content:[award],totalPages:1,totalElements:1,number:0,size:100};
      else if(/\/ideas\/review-(individual|team)$/.test(pathname)) body=ideas.find(item=>pathname.endsWith(item.id));
      else if(pathname.endsWith('/ideas')) body={content:ideas,totalPages:1,totalElements:2,number:0,size:100};
      return route.fulfill({json:body});
    });
    for(const width of [1440,768,390]) {
      await page.setViewportSize({width,height:1000});
      for(const type of ['individual','team']) {
        await page.goto(origin+'/projects?type='+type);
        const before=pdfRequests;
        await page.getByRole('button',{name:'View details',exact:true}).first().click();
        const dialog=page.getByRole('dialog'); await dialog.waitFor(); await dialog.locator('img').first().waitFor();
        await page.evaluate(()=>document.fonts.ready);
        assert(await dialog.locator('iframe').count()===0,'PDF opened by default');
        assert(pdfRequests===before,'PDF requested before click');
        const headings=await styles(dialog.locator('.dp-candidate-detail-heading'));
        const paragraphs=await styles(dialog.locator('.dp-candidate-detail-paragraph'));
        const closed=await geometry(dialog);
        if(!process.argv.includes('--baseline')) {
          assert(headings.length===3,'Expected three parsed headings for '+type);
          assert(headings.every(item=>item.size==='18px'&&item.lineHeight==='27px'&&item.weight==='700'&&['rgb(0, 0, 0)','rgb(17, 17, 17)','rgb(33, 37, 41)'].includes(item.color)), 'Detail heading typography');
          assert(paragraphs.every(item=>item.size==='16px'&&item.lineHeight==='28.8px'&&['rgb(0, 0, 0)','rgb(17, 17, 17)','rgb(33, 37, 41)'].includes(item.color)), 'Detail paragraph typography');
          assert(JSON.stringify(paragraphs.map(item=>item.text))===JSON.stringify([summary,impact,culture].flatMap(value=>value.split('\n\n'))),'Original body text changed');
          assert(headings.every(item=>!/(?:^|\s)[a-z]/.test(item.text)), 'Lowercase word in fixed title');
          if(width===390) assert(closed.photo.bottom<=closed.body.y+1&&closed.dialog.height>500,'Mobile detail must stack vertically with readable height');
        }
        assert(!closed.horizontalOverflow,'Detail horizontal overflow');
        assert(disjoint(closed.photo,closed.body),'Photo/body overlap');
        assert(type!=='team'||await dialog.getByRole('heading',{name:'Tags',exact:true}).count()===0,'Team tags visible');
        const detailTheme=await dialog.evaluate(el=>({background:getComputedStyle(el).backgroundColor,header:getComputedStyle(el.querySelector('.dp-detail-modal-header')).backgroundColor,title:getComputedStyle(el.querySelector('.mantine-Modal-title')).color,close:getComputedStyle(el.querySelector('.mantine-CloseButton-root')).color}));
        assert(detailTheme.background==='rgb(255, 255, 255)'&&detailTheme.header==='rgb(255, 255, 255)','Detail background must be white');
        assert(detailTheme.title==='rgb(17, 17, 17)'&&detailTheme.close==='rgb(17, 17, 17)','Detail title and close button must be dark');
        assert(await dialog.getByText('Department',{exact:true}).count()===0,'Department field still visible');
        assert(await dialog.getByText('Org. Code',{exact:true}).count()===1,'Org. Code missing');
        const attachmentColors=await styles(dialog.locator('.dp-attachment .mantine-Text-root, .dp-attachment .mantine-Button-root'));
        assert(attachmentColors.every(item=>item.color==='rgb(255, 255, 255)'), 'Attachment text must remain white');
        await page.screenshot({path:path.join(out,`details-${type}-${width}-file.png`),fullPage:true,animations:'disabled'});
        if(!process.argv.includes('--baseline')) {
          await dialog.locator('.dp-candidate-detail-heading').first().evaluate(el=>el.scrollIntoView({block:'start'}));
          await page.screenshot({path:path.join(out,`details-${type}-${width}-text.png`),fullPage:true,animations:'disabled'});
          await dialog.locator('.dp-candidate-detail-heading').last().evaluate(el=>el.scrollIntoView({block:'start'}));
          await page.screenshot({path:path.join(out,`details-${type}-${width}-text-end.png`),fullPage:true,animations:'disabled'});
        }
        await dialog.locator('.dp-attachment').scrollIntoViewIfNeeded();
        await dialog.getByRole('button',{name:'Preview Attachment',exact:true}).click();
        await dialog.locator('iframe').waitFor();
        await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(el=>el.src.includes('review-evidence.pdf')));
        const verified=await dialog.locator('iframe').evaluate(async el=>{ const response=await fetch(el.src); const bytes=new Uint8Array(await response.arrayBuffer()); return {type:response.headers.get('content-type'),bytes:bytes.length,signature:new TextDecoder().decode(bytes.slice(0,8))}; });
        assert(verified.type.includes('application/pdf')&&verified.bytes===pdf.length&&verified.signature==='%PDF-1.4','Wrong PDF bytes');
        const opened=await geometry(dialog);
        assert(opened.paragraphs.every(rect=>disjoint(rect,opened.frame)),'PDF overlaps text');
        await dialog.locator('iframe').scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await page.screenshot({path:path.join(out,`details-${type}-${width}-pdf.png`),fullPage:true,animations:'disabled'});
        await dialog.getByRole('button',{name:'Hide Attachment',exact:true}).click();
        assert(await dialog.locator('iframe').count()===0,'PDF hide failed');
        results.details.push({type,width,headings,paragraphs,detailTheme,departmentRemoved:true,orgCodePreserved:true,attachmentColors,closed,opened,pdf:verified,pdfRequestsAfterClick:pdfRequests-before});
      }
    }
    if(process.argv.includes('--baseline')) {
      fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify(results,null,2));
      console.log('Baseline details captured'); return;
    }
    await page.goto(origin+'/nominate?type=team');
    const photoBase64=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=450;const ctx=canvas.getContext('2d');ctx.fillStyle='#164874';ctx.fillRect(0,0,600,450);ctx.fillStyle='#a5d9f7';ctx.beginPath();ctx.arc(300,160,72,0,Math.PI*2);ctx.fill();ctx.fillRect(180,260,240,160);return canvas.toDataURL('image/png').split(',')[1];});
    const photo={name:'review-photo.png',mimeType:'image/png',buffer:Buffer.from(photoBase64,'base64')};
    for(const width of [1440,768,390]) {
      await page.setViewportSize({width,height:1000});
      for(const type of ['individual','team']) {
        await page.goto(origin+'/nominate?type='+type); await page.getByRole('radio',{name:/Customer Values/}).click();
        if(type==='team') { await page.getByLabel('Project Name',{exact:false}).fill('Customer Service Improvement Team'); await page.getByLabel('Core Team Member',{exact:false}).fill('Member One;Member Two'); }
        await page.getByLabel(type==='team'?/Achievement Summary/:/Executive Summary/).fill(summary);
        await page.getByLabel(type==='team'?/Details of Your Team Achievement/i:/Details Of Your Core Achievement/i).fill(impact);
        await page.getByLabel(/How You Demonstrate BD China Culture/i).fill(culture);
        await page.locator('input[type=file]').nth(0).setInputFiles(photo);
        if(type==='individual') await page.getByRole('button',{name:'Confirm crop',exact:true}).click();
        await page.locator('input[type=file]').nth(1).setInputFiles({name:'review-evidence.pdf',mimeType:'application/pdf',buffer:pdf});
        assert(await page.locator('iframe').count()===0,'Form PDF auto-opened');
        await page.getByRole('button',{name:'Submit nomination',exact:true}).click();
        const dialog=page.getByRole('dialog',{name:type==='team'?'Review Team Nomination':'Review Individual Nomination'}); await dialog.waitFor();
        assert(uploads===0&&submits===0,'First submit wrote data');
        assert(await dialog.locator('iframe').count()===0,'Preview PDF auto-opened');
        const headings=await styles(dialog.locator('h4'));
        const paragraphs=await styles(dialog.locator('.mantine-Text-root'));
        const bodyParagraphs=paragraphs.filter(item=>[summary,impact,culture].includes(item.text));
        assert(bodyParagraphs.length===3,'Preview body incomplete');
        assert(bodyParagraphs.every(item=>item.size==='16px'&&item.lineHeight==='28.8px'&&item.color==='rgb(255, 255, 255)'), 'Preview paragraph typography');
        assert(headings.every(item=>item.size==='18px'&&item.lineHeight==='27px'&&item.weight==='700'&&item.color==='rgb(255, 255, 255)'), 'Preview heading typography');
        assert(headings.every(item=>!/(?:^|\s)[a-z]/.test(item.text)), 'Lowercase preview title');
        const previewBounds=await dialog.evaluate((el,bodyTexts)=>{
          const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
          return {dialog:rect(document.querySelector('[role=dialog]')),photo:rect(document.querySelector('[role=dialog] img')),body:[...document.querySelectorAll('[role=dialog] .mantine-Text-root')].filter(el=>bodyTexts.includes(el.textContent.trim())).map(rect)};
        },[summary,impact,culture]);
        assert(previewBounds.body.every(rect=>disjoint(rect,previewBounds.photo)),'Preview photo overlaps body');
        await page.screenshot({path:path.join(out,`preview-${type}-${width}-file.png`),fullPage:true,animations:'disabled'});
        await dialog.screenshot({path:path.join(out,`preview-${type}-${width}-dialog.png`),animations:'disabled'});
        await dialog.locator('h4').first().evaluate(el=>el.scrollIntoView({block:'start'}));
        await page.screenshot({path:path.join(out,`preview-${type}-${width}-text.png`),fullPage:true,animations:'disabled'});
        await dialog.locator('h4').nth(type==='team'?2:1).evaluate(el=>el.scrollIntoView({block:'start'}));
        await page.screenshot({path:path.join(out,`preview-${type}-${width}-text-middle.png`),fullPage:true,animations:'disabled'});
        await dialog.locator('h4').last().evaluate(el=>el.scrollIntoView({block:'start'}));
        await page.screenshot({path:path.join(out,`preview-${type}-${width}-text-end.png`),fullPage:true,animations:'disabled'});
        await dialog.getByRole('button',{name:'Preview Attachment',exact:true}).click(); await dialog.locator('iframe').waitFor();
        const verified=await dialog.locator('iframe').evaluate(async el=>{const response=await fetch(el.src);return {type:response.headers.get('content-type'),bytes:(await response.arrayBuffer()).byteLength};});
        assert(verified.type==='application/pdf'&&verified.bytes===pdf.length,'Wrong local PDF bytes');
        const localFrame=await dialog.locator('iframe').boundingBox();
        const previewTextRects=await dialog.locator('.mantine-Text-root').evaluateAll((elements,texts)=>elements.filter(el=>texts.includes(el.textContent.trim())).map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}),[summary,impact,culture]);
        assert(previewTextRects.every(rect=>disjoint(rect,{x:localFrame.x,y:localFrame.y,right:localFrame.x+localFrame.width,bottom:localFrame.y+localFrame.height})),'Preview PDF overlaps body');
        await dialog.locator('iframe').scrollIntoViewIfNeeded(); await page.waitForTimeout(700);
        await page.screenshot({path:path.join(out,`preview-${type}-${width}-pdf.png`),fullPage:true,animations:'disabled'});
        await dialog.getByRole('button',{name:'Hide Attachment',exact:true}).click(); assert(await dialog.locator('iframe').count()===0,'Preview hide failed');
        await dialog.getByRole('button',{name:'Back To Edit',exact:true}).click();
        assert(await page.getByLabel(type==='team'?/Achievement Summary/:/Executive Summary/).inputValue()===summary,'Back To Edit changed summary');
        assert(await page.getByLabel(type==='team'?/Details of Your Team Achievement/i:/Details Of Your Core Achievement/i).inputValue()===impact,'Back To Edit changed impact');
        assert(await page.getByLabel(/How You Demonstrate BD China Culture/i).inputValue()===culture,'Back To Edit changed culture');
        assert(await page.getByRole('img',{name:type==='team'?'Team photo preview':'Personal photo preview',exact:true}).count()===1,'Back To Edit lost photo');
        assert(await page.getByText('review-evidence.pdf',{exact:true}).count()>0,'Back To Edit lost PDF');
        assert(uploads===0&&submits===0,'Back To Edit wrote data');
        results.previews.push({type,width,headings,paragraphs,previewBounds,pdf:verified,noUploadBeforeConfirmation:true,backToEditPreserved:true});
      }
    }
    results.uploads=uploads;results.submits=submits;
    const bodyFamily=results.details[0].paragraphs[0].family;
    assert(results.details.every(item=>item.paragraphs.every(p=>p.family===bodyFamily&&p.weight==='400')),'Detail body font mismatch');
    assert(results.previews.every(item=>item.paragraphs.filter(p=>[summary,impact,culture].includes(p.text)).every(p=>p.family===bodyFamily&&p.weight==='400')),'Preview/body font mismatch');
    for(const width of [1440,768,390]) {
      const cases=results.previews.filter(item=>item.width===width);
      assert(Math.abs(cases[0].previewBounds.dialog.width-cases[1].previewBounds.dialog.width)<1,'Individual/team preview width mismatch');
      assert(cases[0].headings[0].family===cases[1].headings[0].family,'Individual/team heading font mismatch');
    }
    omitPhoto=true;
    await page.goto(origin+'/projects?type=team');
    await page.getByRole('button',{name:'View details',exact:true}).first().click();
    const emptyDialog=page.getByRole('dialog');
    const placeholder=emptyDialog.locator('.dp-detail-photo-placeholder');
    const emptyPhoto=await placeholder.evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el.querySelector('p')).color}));
    assert(emptyPhoto.background!==emptyPhoto.text,'Empty photo contrast');
    await page.screenshot({path:path.join(out,'details-team-390-no-photo.png'),fullPage:true,animations:'disabled'});
    results.emptyPhoto=emptyPhoto;
    fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(results,null,2));
    console.log('PASS: remote/local valid PDF on demand, no early upload, six detail cases, six preview cases, responsive screenshots');
  } finally { await browser.close(); }
})().catch(error=>{ console.error(error);process.exitCode=1; });
