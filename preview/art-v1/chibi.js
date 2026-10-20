// 原创 Q 版「恶毒」秘书：白色长发 + 蓬松长发、蓝灰色大眼、深藏青色洋装配白领与青色蝴蝶结，抱着星月枕头。
// 仅参考官方设定的配色/元素，全部为原创矢量绘制。
const EYE = '#6f8fc4', EYE2 = '#3e5a94', LINE = '#3a3556';
function eyes(m){
  const open = (cx, look=0) => `
   <ellipse cx="${cx}" cy="118" rx="15" ry="17" fill="#fff"/>
   <ellipse cx="${cx+look}" cy="120" rx="12.5" ry="15" fill="url(#iris)"/>
   <ellipse cx="${cx+look}" cy="123" rx="6" ry="8" fill="${EYE2}"/>
   <ellipse cx="${cx+look-4}" cy="113" rx="4.5" ry="5.5" fill="#fff"/>
   <circle cx="${cx+look+5}" cy="127" r="2.2" fill="#fff" opacity=".9"/>`;
  const lid = (cx, h) => `<path d="M${cx-18} ${99+h}q18 7 36 0v-${h+6}h-36z" fill="url(#skin)"/><path d="M${cx-18} ${99+h}q18 7 36 0" stroke="${LINE}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  switch(m){
   case 'happy': return `<path d="M58 122q15-16 30 0M112 122q15-16 30 0" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
   case 'yawn': return `<path d="M58 118q15 9 30 0M112 118q15 9 30 0" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M146 122q5 8 0 12q-5-4 0-12z" fill="#bfe8ff"/>`;
   case 'shock': return `<ellipse cx="73" cy="118" rx="15" ry="18" fill="#fff" stroke="${LINE}" stroke-width="2.5"/><circle cx="73" cy="120" r="8" fill="url(#iris)"/><circle cx="73" cy="120" r="4" fill="${EYE2}"/><circle cx="70" cy="116" r="2.5" fill="#fff"/><ellipse cx="127" cy="118" rx="15" ry="18" fill="#fff" stroke="${LINE}" stroke-width="2.5"/><circle cx="127" cy="120" r="8" fill="url(#iris)"/><circle cx="127" cy="120" r="4" fill="${EYE2}"/><circle cx="124" cy="116" r="2.5" fill="#fff"/><path d="M156 86q6 10 0 14q-6-4 0-14z" fill="#9fdcff"/>`;
   case 'smug': return open(73,4)+open(127,4)+lid(73,12)+lid(127,12);
   default: return open(73)+open(127)+lid(73,14)+lid(127,14); // sleepy 半睁眼
  }
}
function mouth(m){
  return { happy:`<path d="M92 146q8 9 16 0" fill="#e07a95" stroke="${LINE}" stroke-width="2"/>`,
   yawn:`<ellipse cx="100" cy="150" rx="8" ry="10" fill="#c45a7c" stroke="${LINE}" stroke-width="2"/><ellipse cx="100" cy="155" rx="5" ry="3" fill="#f0a0b8"/>`,
   shock:`<ellipse cx="100" cy="150" rx="4.5" ry="5.5" fill="#c45a7c" stroke="${LINE}" stroke-width="2"/>`,
   smug:`<path d="M92 146q10 6 17-3" stroke="${LINE}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
   sleepy:`<path d="M95 147q5 3 10 0" stroke="${LINE}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`}[m];
}
export function chibiSVG(m='sleepy'){
  return `<svg viewBox="0 0 200 230" class="chibi ${m}">
 <defs>
  <radialGradient id="skin" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#fffaf7"/><stop offset="1" stop-color="#fbe9e6"/></radialGradient>
  <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#e3e8f4"/><stop offset="1" stop-color="#c3cbe3"/></linearGradient>
  <linearGradient id="iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a6aa8"/><stop offset="1" stop-color="#9cc4ef"/></linearGradient>
  <linearGradient id="dress" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26305e"/><stop offset="1" stop-color="#121834"/></linearGradient>
 </defs>
 <!-- 后发 -->
 <path d="M38 110c-10 40-6 80-18 106h62l-4-40M162 110c10 40 6 80 18 106h-62l4-40" fill="url(#hair)" stroke="#b8c2de" stroke-width="2"/>
 <!-- 身体：深藏青洋装 + 白色大领 + 青色蝴蝶结 -->
 <path d="M60 168q40-14 80 0l14 52H46z" fill="url(#dress)" stroke="#7f8cc4" stroke-width="2"/>
 <path d="M66 168q34 26 68 0l-6 18q-28 14-56 0z" fill="#f4f7ff" stroke="#b8c2de" stroke-width="2"/>
 <path d="M100 178l-16-9v16zM100 178l16-9v16z" fill="#7fd6f2" stroke="#3e7fa0" stroke-width="1.5"/><circle cx="100" cy="178" r="4" fill="#bfeaff" stroke="#3e7fa0"/>
 <!-- 星月抱枕 -->
 <rect x="52" y="190" width="96" height="40" rx="18" fill="#eef2fb" stroke="#a99be8" stroke-width="2.5"/>
 <path d="M86 198a11 11 0 1 0 9 18 9 9 0 0 1-9-18z" fill="#ffe7a3"/><path d="M118 203l2 4 4.5.6-3.3 3 .9 4.4-4.1-2.2-4 2.2.8-4.4-3.3-3 4.5-.6z" fill="#8fd6f2"/>
 <ellipse cx="60" cy="204" rx="11" ry="9" fill="url(#skin)" stroke="#e0c6c6"/><ellipse cx="140" cy="204" rx="11" ry="9" fill="url(#skin)" stroke="#e0c6c6"/>
 <!-- 头 -->
 <ellipse cx="100" cy="112" rx="66" ry="60" fill="url(#skin)"/>
 <path d="M70 58q-10-14 4-22M120 54q12-14 26-6M96 52q2-16 14-20" stroke="#e3e8f4" stroke-width="5" fill="none" stroke-linecap="round"/>
 <!-- 刘海 -->
 <path d="M34 120c-6-48 26-72 66-72s72 24 66 72c-6-12-12-20-18-24l-4 18c-6-12-14-22-20-26l-6 22c-4-12-12-22-18-24-6 4-14 14-18 24l-6-22c-8 4-14 14-20 26l-4-18c-6 4-12 12-18 24z" fill="url(#hair)" stroke="#b8c2de" stroke-width="2"/>
 <path d="M34 120c-4 20-2 40 6 52M166 120c4 20 2 40-6 52" stroke="#d6dcee" stroke-width="10" fill="none" stroke-linecap="round"/>
 <!-- 小星星发饰 -->
 <path d="M150 80l3 6 6.5 1-4.7 4.6 1.1 6.4-5.9-3-5.8 3 1.1-6.4-4.7-4.6 6.5-1z" fill="#8fd6f2" stroke="#3e7fa0" stroke-width="1"/>
 <!-- 表情 -->
 <g class="eyes">${eyes(m)}</g>
 <ellipse cx="62" cy="140" rx="11" ry="6" fill="#ff9fb6" opacity=".55"/><ellipse cx="138" cy="140" rx="11" ry="6" fill="#ff9fb6" opacity=".55"/>
 <path d="M56 140l4-3M62 141l4-3M134 141l4-3M140 140l4-3" stroke="#ff7f9f" stroke-width="1.5" opacity=".7"/>
 ${mouth(m)}
 ${m==='sleepy'||m==='yawn'?'<g class="zz" fill="#8fe3ff" font-family="serif" font-style="italic"><text x="164" y="44" font-size="20">z</text><text x="180" y="26" font-size="14" fill="#b49cff">z</text></g>':''}
</svg>`;
}
// 背景插画：Q版恶毒剪影睡在新月上、枕头云、星星
export function backgroundSVG(){
  let stars=''; for(let i=0;i<70;i++){const x=(i*137.5)%1600,y=(i*89.3)%900,r=(i%5===0)?2.2:1;stars+=`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r}" fill="${i%3?'#e8eef7':'#b49cff'}" opacity="${0.3+(i%4)*0.15}"/>`;}
  return `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
  ${stars}
  <g transform="translate(1270 150)" opacity=".5">
   <path d="M120 -90a150 150 0 1 0 60 250 125 125 0 0 1-60-250z" fill="#dfe9ff"/>
   <!-- 月亮上睡觉的Q版小剪影 -->
   <g transform="translate(-30 120) rotate(-12)" fill="#1a2350">
    <ellipse cx="60" cy="0" rx="42" ry="34"/>
    <path d="M24 10q-10 40 10 50h70q20-14 0-30z"/><path d="M98 6q30 10 50 4q-8 18-40 18z"/>
   </g>
   <text x="70" y="20" fill="#8fe3ff" font-size="40" font-style="italic" font-family="serif">z</text><text x="105" y="-12" fill="#b49cff" font-size="28" font-family="serif" font-style="italic">z</text>
  </g>
  <g opacity=".22" fill="#b9c4e8">
   <path d="M0 860q80-70 170-30q60-60 150-10q80-40 150 20q40 30 0 60H0z"/>
   <path d="M1180 900q40-60 120-40q70-50 150 0q60-20 150 20v20z"/>
  </g>
  <g opacity=".13" transform="translate(70 420) scale(1.4)" fill="#cfd8f2">
   <!-- 抱枕上的小剪影 -->
   <rect x="0" y="80" width="140" height="56" rx="26"/>
   <circle cx="70" cy="40" r="44"/>
   <path d="M28 50q-10 50-6 80M112 50q10 50 6 80" stroke="#cfd8f2" stroke-width="16" fill="none" stroke-linecap="round"/>
  </g>
  <g fill="#ffe7a3" opacity=".35"><path d="M300 120l4 9 10 1.4-7 7 1.6 10-8.6-4.6-8.6 4.6 1.6-10-7-7 10-1.4z"/><path d="M820 70l3 6 6.5 1-4.7 4.6 1.1 6.4-5.9-3-5.8 3 1.1-6.4-4.7-4.6 6.5-1z"/></g>
 </svg>`;
}
