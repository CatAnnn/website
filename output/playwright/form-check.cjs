async (page) => {
  const members = page.getByRole('textbox',{name:'Core Team Member',exact:true});
  if(await members.inputValue() !== 'Alice Demo') throw Error('Member selection did not replace query');
  const summary = page.getByRole('textbox',{name:'Achievement Summary (≤ 200 words)',exact:true});
  const impact = page.getByRole('textbox',{name:'Details of Your Team Achievement in 2026 and Business Impact',exact:true});
  const before = await summary.boundingBox();
  const nextBefore = await impact.boundingBox();
  await summary.fill(Array(18).fill('A measurable result.').join('\n'));
  await page.waitForTimeout(200);
  const after = await summary.boundingBox();
  const nextAfter = await impact.boundingBox();
  if(after.height <= before.height || nextAfter.y <= nextBefore.y) throw Error('Textarea did not grow in normal flow');
  if(await summary.evaluate(el=>getComputedStyle(el).resize) !== 'vertical') throw Error('Manual resizing disabled');
  await summary.fill('');
  await page.setViewportSize({width:390,height:844});
  await members.scrollIntoViewIfNeeded();
  const widths = await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));
  if(widths.document > widths.viewport) throw Error('Mobile horizontal overflow');
  await page.screenshot({path:'output/playwright/team-form-mobile.png',fullPage:true});
  console.log(JSON.stringify({memberSelection:'PASS',summaryGrowth:{before:before.height,after:after.height},followingFieldMoves:'PASS',resize:'vertical',mobileWidths:widths}));
}