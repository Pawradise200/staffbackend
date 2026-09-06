// Pawradise 員工系統前端源碼（JSX）——改呢個檔，唔好直接改 app.js
// 改完必須行 ./build.sh 重新編譯出 app.js 先 push（index.html 只載 app.js）

const { useState, useEffect, useRef } = React;

// 版本印（2026-08-12）：Safari／PWA 會 cache 住舊前端，兩次事故都係咁兜圈
// （7/6 店長「更表儲存唔到」、8/12 導師仲見到酒店業績）。頁腳印住版本＝
// 有人報問題時第一句問「你頁腳寫住咩版本？」就分辨到係真 bug 定係 cache。
// ⚠️ 每次 push 前記得改呢個字串，否則印咗都冇用。
const APP_VERSION = 'v2026-09-06e';  // ⚠️ 每次出街都要 bump——Erica 靠登入頁/頁腳呢個號驗證有冇食到新版

// ═══════════ API ═══════════
let PW_KEY = '';  // 店長/老闆解鎖後記住，寫入 action 後端要驗
async function pwApi(action, params = {}) {
  const qs = new URLSearchParams();
  qs.set('action', action);
  if (PW_KEY) qs.set('key', PW_KEY);
  Object.keys(params).forEach(k => {
    if (params[k] !== undefined && params[k] !== null) qs.set(k, params[k]);
  });
  const res = await fetch(window.APPS_SCRIPT_URL + '?' + qs.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('網絡錯誤 ' + res.status);
  return res.json();
}
// ⚠️ 2026-08-12 幽靈條目事故：所有寫入一律經呢度，強制驗返後端回應。
// 之前多個寫入係「樂觀更新 + await 但唔 check」——授權過期後端回「未授權」乜都唔寫，
// 畫面照樣顯示成功，用戶一 reload 就發現嘢唔見咗（2026-07-06 更表事故同一種病）。
// 規矩：寫入失敗 → 回滾樂觀更新 ＋ 報後端真實原因。onErr 唔傳就用 alert（保證睇得見）。
async function pwWrite(action, params, revert, onErr) {
  const show = onErr || function (m) { window.alert(m); };
  try {
    const r = await pwApi(action, params);
    if (!r || r.ok === false) {
      if (revert) revert();
      const raw = (r && r.error) || '儲存失敗';
      show(/未授權/.test(raw)
        ? '授權過期：請撳「🔒 鎖定」後重新輸入管理密碼，再試一次（今次未寫入，畫面已還原）'
        : raw + '（未寫入，畫面已還原）');
      return false;
    }
    return true;
  } catch (e) {
    if (revert) revert();
    show('網絡錯誤：' + (e.message || e) + '（未寫入，畫面已還原）');
    return false;
  }
}
function currentMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monthLabelShort(m) { return parseInt(m.split('-')[1]) + '月'; }
// 員工可查看的最早月份
const FIRST_MONTH = '2026-05';
function monthOptions() {
  const out = [];
  const cur = currentMonth();
  let [y, m] = FIRST_MONTH.split('-').map(Number);
  const [cy, cm] = cur.split('-').map(Number);
  // 萬一系統時間早於起始月,最少都顯示起始月
  if (cy < y || (cy === y && cm < m)) return [FIRST_MONTH];
  while (y < cy || (y === cy && m <= cm)) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m++; if (m > 12) { m = 1; y++; }
  }
  return out.reverse(); // 最新月份排最前
}
function monthLabelFull(m) {
  const p = m.split('-');
  return p[0] + ' 年 ' + parseInt(p[1]) + ' 月';
}

// ═══════════ 業務邏輯 (port from commission-data.js) ═══════════
const HEADCOUNT = 3;
// [2026-08-25 老闆定] 新生付費試堂現行收費——顯示用，真正記賬金額由後端 TRIAL_NEW_STUDENT_FEE 決定
const TRIAL_NEW_STUDENT_FEE = 499;
const TARGETS = { hotelThreshold: 200000, academyThreshold: 50000, renewalTier: 5, packageGoal: 12 };
const ROLE_KPIS = {
  junior: { label: '初級寵物照顧員', items: [
    { id: 'j1', text: '客戶有效合理投訴 ≤ 1 次 (因疏忽照顧 / 未跟足規則造成意外受傷;以團隊計算)', weight: 30, team: true },
    { id: 'j2', text: '操作錯誤:混亂食物藥物、錯誤執拾 / 遺漏物品、CCTV 邀請遺留 / 錯誤 ≤ 3 次 (以團隊計算)', weight: 20, team: true },
    { id: 'j3', text: '每日每位客戶收到 > 5 條相片 / 影片 (以團隊計算)', weight: 20, team: true },
    { id: 'j4', text: '完成指定環境及犬隻清潔流程;客戶衛生投訴 ≤ 2 且 突擊巡查不合格 ≤ 1 (標準checklist+相片為準,3項以上唔妥先算1次)', weight: 20, team: false },
    { id: 'j5', text: '保持儀容整潔、穿着整齊制服', weight: 10, team: false },
  ] },
  senior: { label: '高級寵物照顧員', items: [
    { id: 's1', text: '客戶有效合理投訴 ≤ 1 次 (因疏忽照顧 / 未跟足規則造成意外受傷;以團隊計算)', weight: 30, team: true },
    { id: 's2', text: '操作錯誤:混亂食物藥物、錯誤執拾 / 遺漏物品、CCTV 邀請遺留 / 錯誤 ≤ 3 次 (以團隊計算)', weight: 20, team: true },
    { id: 's3', text: '每日每位客戶收到 > 5 條相片 / 影片 (以團隊計算)', weight: 20, team: true },
    { id: 's4', text: '完成指定環境及犬隻清潔流程;客戶衛生投訴 ≤ 2 且 突擊巡查不合格 ≤ 1 (標準checklist+相片為準,3項以上唔妥先算1次)', weight: 20, team: false },
    { id: 's5', text: '培訓團隊,確保團隊中初級寵物照顧員 KPI 達 80 分以上', weight: 10, team: false },
  ] },
  tutor: { label: '學院部初級導師', items: [
    { id: 't1', text: '客戶有效投訴 ≤ 1 次 (對應到負責人=個人計;指向課堂整體=團隊計;以書面客訴記錄為準)', weight: 20, team: false },
    { id: 't2', text: '課堂安全零事故 (狗隻受傷 / 走失 / 分組不當致衝突,以事故記錄為準)', weight: 20, team: false },
    { id: 't3', text: '漏斗跟進:線上查詢即日回覆率 ≥ 90% 且逾期跟進 = 0 (含被派續報/升班/Calm Explorer Club 邀請名單;Leads 追蹤表自動計)', weight: 15, team: false },
    { id: 't4', text: '評估報告當日交付家長 (報告 + 行為評級),評估表正本當日存檔', weight: 15, team: false },
    { id: 't5', text: '學員記錄每堂更新 (出席 / 進度 / 評級),錯漏 ≤ 2', weight: 10, team: false },
    { id: 't6', text: '家長溝通:每學員每堂發送 ≥ 5 條影片 + 手冊填寫 (有助教時由助教拍攝、導師篩選指導質素)', weight: 10, team: false },
    { id: 't7', text: '場地器材清潔:完成指定清潔流程;突擊巡查不合格 ≤ 1 (標準checklist+相片為準)', weight: 10, team: false },
  ] },
  assistant: { label: '學院部助教', items: [
    { id: 'a1', text: '客戶有效投訴 ≤ 1 次 (對應到負責人=個人計;指向課堂整體=團隊計)', weight: 20, team: false },
    { id: 'a2', text: '課堂安全零事故 (協助控場、狗隻交接無錯漏)', weight: 25, team: false },
    { id: 'a3', text: '課堂執行:器材 / 場地預備 100% 完成 (課前 checklist 為準),錯漏 ≤ 2', weight: 15, team: false },
    { id: 'a4', text: '影片拍攝:每學員每堂 ≥ 5 條影片交齊畀導師篩選 + 出席記錄齊', weight: 20, team: false },
    { id: 'a5', text: '場地器材清潔:完成指定清潔流程;突擊巡查不合格 ≤ 1 (標準checklist+相片為準)', weight: 15, team: false },
    { id: 'a6', text: '保持儀容整潔、穿着整齊制服', weight: 5, team: false },
  ] },
  frontdesk: { label: '前台', items: [
    { id: 'f1', text: '招待客戶有效投訴 ≤ 1 人', weight: 30, team: false },
    { id: 'f2', text: '線上訊息於同一工作天辦公時間內必須回覆', weight: 20, team: false },
    { id: 'f3', text: '每日行程編排 / 套票整理 / 文件準備 / 課堂預約 100% 完成,錯誤 ≤ 3 個', weight: 20, team: false },
    { id: 'f4', text: '完成指定環境清潔流程;衛生投訴 ≤ 2 次', weight: 20, team: false },
    { id: 'f5', text: '保持儀容整潔、穿着制服', weight: 10, team: false },
  ] },
  manager: { label: '店長', items: [
    { id: 'm1', text: '每月完成團隊保底業績 (寵物酒店 ≥ $200,000 ＋ 社交學院 ≥ $50,000)', weight: 25, team: true },
    { id: 'm2', text: '客戶有效投訴 ≤ 1 人 (全店)', weight: 15, team: true },
    { id: 'm3', text: '每月加入的新客戶 ≥ 20 個', weight: 15, team: true },
    { id: 'm4', text: '每月購買的套票 ≥ 12 個', weight: 15, team: true },
    { id: 'm5', text: '漏斗入口:返工日查詢即日入表;輪流派單公平 (月結接單數差 ≤ 2);督導導師逾期跟進清零;學期尾派續報/升班跟進名單', weight: 15, team: false },
    { id: 'm6', text: '數據準確:CRM 收入記錄返工日當日入齊、假期收款返工首日補齊 (日期填實際收款日;人手項目:接送/美容/套票/學期費/試堂/差額;服務類型標準字眼+電話正確);成交即日入 KPI 評核;月度數據 3 號前 (假期順延);對數差異 >15% 能解釋;15 號同員工過 KPI 進度', weight: 15, team: false },
  ] },
};
const PARTS_META = {
  fixed:  { label: '固定獎金', icon: '📅', color: 'var(--pw-gold)' },
  hotel:  { label: '酒店部', icon: '🏨', color: 'var(--pw-navy)' },
  newcmm: { label: '學院新生', icon: '🎓', color: 'var(--pw-cat-sniff)' },
  renew:  { label: '舊生續報', icon: '🔄', color: 'var(--pw-cat-puzzle)' },
  mgrtier:{ label: '門店業績佣金', icon: '🏪', color: 'var(--pw-navy)' },
  base:   { label: '底薪', icon: '💼', color: 'var(--pw-navy)' },
  kpibonus:{ label: 'KPI 獎金', icon: '⭐', color: 'var(--pw-gold)' },
  club:   { label: '會籍獎金', icon: '🐾', color: 'var(--pw-cat-sniff)' },
  referral:{ label: '轉介學院', icon: '🔗', color: 'var(--pw-cat-puzzle)' },
};
const MGR_TIERS = [ { min: 320000, amt: 5800 }, { min: 420000, amt: 7800 }, { min: 520000, amt: 9800 }, { min: 620000, amt: 11800 } ];  // 各級已含原 $2,000 學院交付獎(2026-07 併入)
function managerTier(revenue) {
  let cur = { min: 0, amt: 0, index: -1 };
  MGR_TIERS.forEach((t, i) => { if (revenue >= t.min) cur = { ...t, index: i }; });
  const next = MGR_TIERS[cur.index + 1] || null;
  return { amt: cur.amt, tierMin: cur.min, next, index: cur.index };
}
const RATES_ACADEMY = [
  { label: '學院新生 · S1', rate: '$500 / 隻', note: '個人歸成交者 · 學院月收入 ≥ $50k 先派' },
  { label: '學院新生 · S2', rate: '$300 / 隻', note: '個人歸成交者 · 學院月收入 ≥ $50k 先派' },
  { label: '學院新生 · S1+S2', rate: '$900 / 隻', note: '個人歸成交者 · 鼓勵 upsell' },
  { label: '舊生續報 / 升班', rate: '$900 / 個入池', note: '按職級分:初級導師 2/5 · 助教 1/5 · 升班(S1→S2)屬此項,不設個人佣' },
  { label: '試堂', rate: '不設佣金', note: '屬流量功勞' },
  { label: 'Calm Explorer Club 入會', rate: '$100 / $200 / $350 入池', note: 'Light / Active / Ultimate · 按職級分(同續報池,分母 5) · 完成三堂觀察期後發 · 2026 年 8–9 月 ×1.5' },
  { label: 'Club 續會分成', rate: '$20 / $45 / $60 每月入池', note: '每位在會會員按方案計 · 由訂閱起始月起算,每位上限 6 個月' },
];
const RATES_HOTEL = [
  { label: '酒店部佣金池', rate: '12% ÷ 3 (編制)', note: '超出 $200,000 門檻部分 · 業績 = 寄宿 + 日托 + 基本美容(不含星級美容) · 空缺位份額預留' },
  { label: '轉介學院課程', rate: '$180 / 隻入池', note: '入酒店轉介池,按編制分母 3 分(空缺預留) · 按轉化計唔按派券計 · 一隻狗一次為限 · 受學院 $50k 門檻 · 2026 年 8–9 月 ×1.5($270)' },
  { label: '全部佣金', rate: '× KPI 完成率', note: '91分↑ 100% · 81–90 按分數 · 71–80 半數 · 70↓ 不發' },
];
// 學院職級權重(只用於舊生續報池):資深 3 / 初級 2 / 助教 1。資深=owner,退出日常,不抽池。
const ACAD_W = { senior: 3, junior: 2, assistant: 1 };
// 固定分母 = end-state 學院編制 2 初級導師(各 2)+ 1 full-time 助教(1)= 5。
// 預留未填職級份額(暫不發,留作將來請人);兼職助教 = 時薪,不設 acadRank → 0 份額,不入池。
const ACAD_WEIGHT_TOTAL = 5;
// 酒店池固定分母 = 酒店部編制 3 位;空缺份額預留唔發(淡季店長頂更亦不入池,佢行階梯)。
// 請滿第 3 位 / 擴編時改呢度一個數即可。
const HOTEL_SEATS = 3;
// 會籍佣金 v3(制度 2026-08-07):入會獎金按方案分級,一律入學院團隊池(同續報池,分母 5)。
// 費用已同步 2026-09 減價後嘅新價。
// 續會分成:每位在會會員每月入池,由「訂閱起始月」起算,上限 6 個月。
const CLUB_TIERS = {
  light:    { key: 'light', label: 'Light', fee: 499, bonus: 100, renew: 20, color: 'var(--pw-cat-sniff)' },
  active:   { key: 'active', label: 'Active', fee: 1199, bonus: 200, renew: 45, color: 'var(--pw-cat-puzzle)' },
  ultimate: { key: 'ultimate', label: 'Ultimate', fee: 1499, bonus: 350, renew: 60, color: 'var(--pw-gold)' },
};
const CLUB_RENEW_MONTHS = 6;   // 每位會員最多分成 6 個月,之後停(功勞會攤薄,亦推動繼續招新)
function monthsBetween(a, b) {
  if (!a || !b) return -1;
  const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
// 限期加碼:2026 年 8 月 ×1.5(老闆 2026-09-05 提早結束,原定 8–9 月),9 月起回復標準金額。
// 兩項一齊行:①Calm Explorer Club 入會獎金(清存量) ②酒店轉介學院獎金(推動漏斗開頭)
const PROMO_MONTHS = ['2026-08'];
const PROMO_RATE = 1.5;
function promoBoost(month) { return PROMO_MONTHS.includes(month) ? PROMO_RATE : 1; }
// 未知崗位一律當前台處理,避免任何手誤令整個面板崩潰變空白
function roleKpi(role) { return ROLE_KPIS[role] || ROLE_KPIS.frontdesk; }
function buildScorecard(role, failIds = []) {
  return roleKpi(role).items.map(it => ({ ...it, pass: !failIds.includes(it.id) }));
}
// 分部門後:學院部用導師/助教 KPI,酒店部照舊;部門欄未填 = 照舊(相容)
function kpiRoleOf(staff) {
  if (!staff) return 'frontdesk';
  if (staff.role === 'manager') return 'manager';
  if (staff.dept === 'academy') return staff.acadRank === 'assistant' ? 'assistant' : 'tutor';
  return staff.role;
}
function payoutRatio(score, { override = false, overrideReason = '' } = {}) {
  if (override) return { ratio: 0, band: '失格', reason: overrideReason || '缺勤 / 紀律 / 安全事故' };
  if (score >= 91) return { ratio: 1, band: '滿額' };
  if (score >= 81) return { ratio: score / 100, band: '按完成率' };
  if (score >= 71) return { ratio: 0.5, band: '半額' };
  return { ratio: 0, band: '不發放' };
}
function scorecardTotal(items) { return items.reduce((a, it) => a + (it.pass ? it.weight : 0), 0); }
function calc({ attendance, trialConv = 0, s1New = 0, s2New = 0, comboNew = 0, newStudents, renewals, hotelRevenue, academyRevenue = null, acadWeight = 0, acadWeightTotal = 0, headcount = HEADCOUNT, dept = '', hotelReferrals = 0, monthKey = '' }) {
  const fixedOk = true;   // 分部門後取消 $2,000 出勤獎(摺入底薪;店長併入階梯)
  const fixed = 0;
  const hotelOver = Math.max(0, hotelRevenue - TARGETS.hotelThreshold);
  const hotel = dept === 'academy' ? 0 : hotelOver * 0.12 / HOTEL_SEATS;   // 學院部唔分池;分母=編制3,空缺預留
  // 學院新生 = 個人銷售佣,歸成交者(不÷3):S1$500 / S2$300 / S1+S2$900。試堂不設佣(流量功勞)
  // 學院 $50,000 收入門檻:該月學院總業績未達 → 新生佣 $0(事前可見,不追扣);academyRevenue 為 null 時(冇團隊數據)當已達,避免破壞
  const acadGateOk = (academyRevenue == null) ? true : (academyRevenue >= TARGETS.academyThreshold);
  const rawNewcmm = s1New * 500 + s2New * 300 + comboNew * 900;
  const newcmm = acadGateOk ? rawNewcmm : 0;
  const nStudents = (newStudents != null) ? newStudents : (trialConv + s1New + s2New + comboNew);
  const renewPool = renewals * 900;                  // 舊生續報 $900/個 團隊池(由 $600 上調,推動跟進)
  // 按學院職級 / 固定分母分(初級2/助教1,分母=ACAD_WEIGHT_TOTAL=5);無職級(兼職/未填)→ 0 份額,預留唔發
  // 酒店部唔分學院池(同 hotel 那行對稱:學院部唔分酒店池)
  const renewShare = (dept === 'hotel' || acadWeight <= 0) ? 0 : (acadWeight / ACAD_WEIGHT_TOTAL);
  const rawRenew = renewPool * renewShare;
  const renew = acadGateOk ? rawRenew : 0;           // 學院 $50k 門檻同樣 gate 舊生續報(整個學院佣金)
  // 酒店轉介學院 $180/隻 入酒店轉介池,按酒店編制分母 3 分(空缺預留唔發)。
  // 收入來源係學院,所以受學院 $50k 門檻,唔受酒店 $200k 門檻;學院部唔分呢個池。
  // 2026 年 8–9 月同樣 ×1.5（$180 → $270），同 Club 入會獎金一齊行
  const referralUnit = 180 * promoBoost(monthKey);
  const rawReferral = dept === 'academy' ? 0 : (hotelReferrals * referralUnit / HOTEL_SEATS);
  const referral = acadGateOk ? rawReferral : 0;
  const projectCommission = hotel + newcmm + renew + referral;
  const total = fixed + projectCommission;
  return { fixed, fixedOk, hotel, hotelOver, hotelRevenue, newcmm, rawNewcmm, acadGateOk, academyRevenue, newStudents: nStudents, trialConv, s1New, s2New, comboNew, renew, rawRenew, renewals, referral, rawReferral, hotelReferrals, referralUnit, projectCommission, total,
    attendance, attendanceNeed: Math.max(0, 4 - attendance),
    parts: [ { key: 'fixed', value: fixed }, { key: 'hotel', value: hotel }, { key: 'newcmm', value: newcmm }, { key: 'renew', value: renew }, { key: 'referral', value: referral } ] };
}
function calcManager({ attendance, storeRevenue, hotelRevenue, academyRevenue }) {
  const fixedOk = true;   // $2,000 已併入 MGR_TIERS,唔再獨立計
  const fixed = 0;
  const tier = managerTier(storeRevenue);
  const tierAmt = tier.amt;
  const projectCommission = tierAmt;
  const total = fixed + projectCommission;
  return { isManager: true, fixed, fixedOk, storeRevenue, hotelRevenue, academyRevenue,
    tierAmt, tierMin: tier.tierMin, tierNext: tier.next, tierIndex: tier.index, projectCommission, total,
    attendance, attendanceNeed: Math.max(0, 4 - attendance),
    parts: [ { key: 'fixed', value: fixed }, { key: 'mgrtier', value: tierAmt } ] };
}
function calcFrontdesk() {
  const baseSalary = 16000, kpiBonus = 2000, total = baseSalary + kpiBonus;
  return { isFrontdesk: true, baseSalary, kpiBonus, baseFixed: baseSalary, projectCommission: kpiBonus, total,
    fixed: 0, fixedOk: true, attendance: 99, attendanceNeed: 0,
    parts: [ { key: 'base', value: baseSalary, noKpi: true }, { key: 'kpibonus', value: kpiBonus } ] };
}
function applyKpi(calcResult, score, opts = {}) {
  const { ratio, band, reason } = payoutRatio(score, opts);
  const baseFixed = calcResult.baseFixed || 0;
  const kpiBase = calcResult.total - baseFixed;
  const actualTotal = baseFixed + kpiBase * ratio;
  const actualProject = calcResult.projectCommission * ratio;
  const deducted = kpiBase - kpiBase * ratio;
  const actualParts = calcResult.parts.map(p => p.noKpi ? { ...p } : { ...p, value: p.value * ratio });
  return { score, ratio, band, reason, actualProject, deducted, actualTotal, actualParts, fixedActual: calcResult.fixed * ratio };
}
// 基本美容併入酒店總業績計佣;店長業績 = 酒店(含基本美容) + 學院 + 星級美容 + 接送 (套票、其他除外)
function hotelForCommission(team) { return (team.hotelRevenue || 0) + (team.groomBasic || 0); }
function storeRevenueOf(team) { return hotelForCommission(team) + (team.academyRevenue || 0) + (team.groomStar || 0) + (team.pickup || 0); }
function fullResult(staff, team, overrides = {}) {
  const att = overrides.attendance != null ? overrides.attendance : staff.attendance;
  const c = staff.role === 'manager'
    ? calcManager({ attendance: att, storeRevenue: storeRevenueOf(team), hotelRevenue: hotelForCommission(team), academyRevenue: team.academyRevenue })
    : staff.role === 'frontdesk'
    ? calcFrontdesk()
    : calc({ attendance: att, trialConv: team.trialConv || 0, s1New: (staff.s1New != null ? staff.s1New : (team.s1New || 0)), s2New: (staff.s2New != null ? staff.s2New : (team.s2New || 0)), comboNew: (staff.comboNew != null ? staff.comboNew : (team.comboNew || 0)), renewals: team.renewals, hotelRevenue: hotelForCommission(team), academyRevenue: team.academyRevenue, acadWeight: ACAD_W[staff.acadRank] || 0, acadWeightTotal: team.acadWeightTotal || 0, headcount: team.headcount || HEADCOUNT, dept: staff.dept || '', hotelReferrals: team.hotelReferrals || 0, monthKey: team.monthKey || '' });
  const items = overrides.scorecard || buildScorecard(kpiRoleOf(staff), staff.kpiFail || []);
  const score = scorecardTotal(items);
  const lateLeave = overrides.lateLeave != null ? overrides.lateLeave : (staff.lateLeave || 0);
  const dogEscape = overrides.dogEscape != null ? overrides.dogEscape : (team.dogEscape || false);
  let override = false, overrideReason = '';
  if (dogEscape) { override = true; overrideReason = '團隊發生走失狗狗事故'; }
  else if (lateLeave > 3) { override = true; overrideReason = `當月累積遲到 / 請假 ${lateLeave} 次 (超過 3 次)`; }
  // 入職首月唔發佣金(2026-08-12 制度):員工表「佣金起始月」(第9欄,yyyy-MM)之前嘅月份,
  // 佣金以 0 計。行 override 路徑,員工見到原因句而唔係無啦啦 $0;會籍池喺 clubBonusFor 同步 gate。
  const commGated = staff.commStart && team.monthKey && team.monthKey < staff.commStart;
  if (commGated) { override = true; overrideReason = '入職首月 (佣金由第二個月起計)'; }
  const kpi = applyKpi(c, score, { override, overrideReason });
  if (commGated) kpi.deducted = 0;   // 首月唔發唔係 KPI 扣起,唔好當年終池顯示
  return { calc: c, items, kpi, lateLeave, dogEscape };
}
// v3:會籍入會獎金一律入學院團隊池(唔再個人記名)。
// 個人提名數字照樣喺 dashboard 顯示(推動力),但錢按職級權重分。
// 入會獎金池:本月新入會嘅會員(訂閱起始月 = 本月)。冇 since 嘅舊記錄當本月,唔會漏發。
function clubJoinPool(noms, month) {
  const raw = (noms || []).filter(n => n.status === 'subscribed' && n.tier)
    .filter(n => !n.since || n.since === month)
    .reduce((a, n) => a + CLUB_TIERS[n.tier].bonus, 0);
  return raw * promoBoost(month);
}
// 續會分成池:訂閱起始月起 6 個月內嘅在會會員(唔包入會嗰個月本身)。
function clubRenewPool(noms, month) {
  return (noms || []).filter(n => n.status === 'subscribed' && n.tier && n.since)
    .filter(n => { const d = monthsBetween(n.since, month); return d >= 1 && d < CLUB_RENEW_MONTHS; })
    .reduce((a, n) => a + (CLUB_TIERS[n.tier].renew || 0), 0);
}
function clubPoolTotal(noms, month) { return clubJoinPool(noms, month) + clubRenewPool(noms, month); }
// ⚠️ dept === 'hotel' 呢道 gate 一定要有 —— 2026-08-04 續報池漏財就係漏咗反向判斷,
//    令酒店部照分學院池。新加嘅池唔可以重蹈覆轍。
function clubBonusFor(staff, noms, month) {
  if (!staff || staff.dept === 'hotel' || staff.role === 'manager') return 0;
  if (staff.commStart && month < staff.commStart) return 0;   // 入職首月唔發佣金(2026-08-12)
  const w = ACAD_W[staff.acadRank] || 0;
  if (w <= 0) return 0;                       // 無職級 = 0 份額,預留唔發
  return clubPoolTotal(noms, month) * (w / ACAD_WEIGHT_TOTAL);
}
const money = (n) => 'HK$' + Math.round(n).toLocaleString('en-US');
const moneyPlain = (n) => Math.round(n).toLocaleString('en-US');

// ═══════════ 更表 helpers ═══════════
const SHIFTS = {
  early: { label: '早更', time: '08:30–16:30', hrs: 8 },
  mid:   { label: '午更', time: '12:30–20:30', hrs: 8 },
  full:  { label: '全日更', time: '08:30–20:30', hrs: 12 },
  off:   { label: '休息', time: '', hrs: 0 },
};
const POSITIONS = {
  academyA: { label: '學院A位', cls: 'academy' },   // 初級導師
  academyB: { label: '學院B位', cls: 'academy' },   // 初級導師
  assist:   { label: '助教', cls: 'academy' },
  hotelA:  { label: '酒店A位', cls: 'hotelA' },
  hotelB:  { label: '酒店B位', cls: 'hotelB' },
  hotelC:  { label: '酒店C位', cls: 'hotelC' },
  academy: { label: '學院', cls: 'academy' },        // 舊資料(未細分前)相容顯示
  reception: { label: '前台', cls: 'reception' },     // 舊資料相容,已不再喺選單
};
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
function buildWeekDays(week, wi, currentWeekIdx, todayDow) {
  const shifts = (week && week.shifts) || [];
  return WEEKDAYS.map((wd, i) => {
    const r = shifts[i] || ['off', null];
    const key = r[0] || 'off';
    const sh = SHIFTS[key] || SHIFTS.off;
    const posKey = r[1] || null;
    return {
      weekday: wd, date: week.dates[i],
      today: wi === currentWeekIdx && i === todayDow,
      shiftKey: key, label: sh.label, time: sh.time, off: key === 'off',
      pos: posKey ? POSITIONS[posKey] : null, posKey,
    };
  });
}
function weekSummary(week) {
  const shifts = (week && week.shifts) || [];
  return {
    workDays: shifts.filter(r => r && r[0] && r[0] !== 'off').length,
    weekHours: shifts.reduce((a, r) => a + ((r && SHIFTS[r[0]] ? SHIFTS[r[0]].hrs : 0) || 0), 0),
  };
}

// ═══════════ UI atoms ═══════════
function DonutChart({ parts, total, size = 188, stroke = 24, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 ? 0.012 * c : 0;
  let acc = 0;
  const segs = parts.filter(p => p.value > 0).map(p => {
    const frac = p.value / total;
    const seg = { key: p.key, color: PARTS_META[p.key].color, len: Math.max(0, frac * c - gap), offset: -acc * c };
    acc += frac;
    return seg;
  });
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--pw-cream-deep)" strokeWidth={stroke} />
        {segs.map(s => (
          <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
            strokeDasharray={`${s.len} ${c - s.len}`} strokeDashoffset={s.offset}
            style={{ transition: 'stroke-dasharray .7s ease, stroke-dashoffset .7s ease' }} />
        ))}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
}
function PayoutLedger({ calc, kpi }) {
  const full = kpi.ratio >= 1;
  return (
    <div className="pwd-ledger">
      <div className="pwd-led-row">
        <span className="pwd-led-lbl">計算佣金 (固定＋項目)</span>
        <span className="pwd-led-val">{money(calc.total)}</span>
      </div>
      <div className="pwd-led-row mul">
        <span className="pwd-led-lbl">× KPI 發放比例</span>
        <span className={'pwd-led-ratio ' + (full ? 'full' : kpi.ratio > 0 ? 'mid' : 'zero')}>{Math.round(kpi.ratio * 100)}%</span>
      </div>
      <div className="pwd-led-row total">
        <span className="pwd-led-lbl">實際領取</span>
        <span className="pwd-led-val">{money(kpi.actualTotal)}</span>
      </div>
    </div>
  );
}
function KpiCard({ role, items, score, kpi, editable, onToggle }) {
  const roleLabel = roleKpi(role).label;
  const tone = kpi.ratio >= 1 ? 'full' : kpi.ratio > 0 ? 'mid' : 'zero';
  return (
    <div className="pwd-card pwd-kpi">
      <div className="pwd-kpi-head">
        <div>
          <div className="pwd-eyebrow">KPI 計分卡 · {roleLabel}</div>
          <div className="pwd-kpi-band">發放比例 <b className={'r-' + tone}>{Math.round(kpi.ratio * 100)}%</b> · {kpi.band}</div>
        </div>
        <div className={'pwd-kpi-score r-' + tone}><span className="n">{score}</span><span className="d">分</span></div>
      </div>
      <div className="pwd-kpi-meter">
        <div className="pwd-kpi-meter-fill" style={{ width: score + '%' }} />
        <span className="pwd-kpi-meter-mark" style={{ left: '91%' }} />
      </div>
      <div className="pwd-kpi-scale"><span>0</span><span style={{ marginLeft: 'auto' }}>91 滿額 →</span><span>100</span></div>
      <div className="pwd-kpi-items">
        {items.map(it => (
          <button key={it.id} className={'pwd-kpi-item' + (it.pass ? ' pass' : ' fail') + (editable ? ' edit' : '')}
            onClick={editable ? () => onToggle(it.id) : undefined} disabled={!editable}>
            <span className="pwd-kpi-check">{it.pass ? '✓' : '✕'}</span>
            <span className="pwd-kpi-text">{it.text}{it.team && <em className="pwd-kpi-team">團隊</em>}</span>
            <span className="pwd-kpi-w">{it.weight}</span>
          </button>
        ))}
      </div>
      {editable && <div className="pwd-kpi-hint">點項目切換達標 / 未達標 — 即時影響發放比例</div>}
    </div>
  );
}
function YearEndPool({ deducted }) {
  if (deducted < 1) return null;
  return (
    <div className="pwd-pool">
      <span className="pwd-pool-ico">🏆</span>
      <div>
        <div className="pwd-pool-t">{money(deducted)} 已撥入年終花紅獎池</div>
        <div className="pwd-pool-s">因 KPI 未滿額而扣起的提成不會消失 — 全年達標可按平均 KPI 取回</div>
      </div>
    </div>
  );
}
function FrontdeskGoal({ kpi, score }) {
  const bands = [ { min: 91, pct: 100 }, { min: 81, pct: 90 }, { min: 71, pct: 50 }, { min: 0, pct: 0 } ];
  const curMin = score >= 91 ? 91 : score >= 81 ? 81 : score >= 71 ? 71 : 0;
  const bonus = Math.round(2000 * kpi.ratio);
  return (
    <div className="pwd-mgrgoal">
      <div className="pwd-mgrgoal-cur">
        <div>
          <div className="pwd-mgrgoal-lbl">本月 KPI 分數</div>
          <div className="pwd-mgrgoal-rev">{score} <span style={{ fontSize: 15 }}>分</span></div>
        </div>
        <div className="pwd-mgrgoal-amt">
          <span className="pwd-mgrgoal-amt-num">{money(bonus)}</span>
          <span className="pwd-mgrgoal-amt-sub">本月 KPI 獎金</span>
        </div>
      </div>
      {score < 91 && (
        <div className="pwd-mgrgoal-next">KPI 達 <b>91 分</b> → 獎金全額發放 <b>HK$2,000</b>(現時 +{money(2000 - bonus)} 空間)</div>
      )}
      <div className="pwd-mgrgoal-ladder">
        {bands.map((b, i) => {
          const isCur = b.min === curMin;
          return (
            <div key={i} className={'pwd-mgrgoal-step' + (score >= b.min ? ' hit' : '') + (isCur ? ' cur' : '')}>
              <span className="pwd-mgrgoal-step-node">{score >= b.min ? '✓' : ''}</span>
              <span className="pwd-mgrgoal-step-min">{b.min === 0 ? '70 分以下' : b.min + ' 分以上'}</span>
              <span className="pwd-mgrgoal-step-amt">{b.min === 81 ? '按 % 發放' : money(2000 * b.pct / 100)}</span>
              {isCur && <span className="pwd-mgrgoal-step-tag">現時</span>}
            </div>
          );
        })}
      </div>
      <div className="pwd-mgrgoal-foot">底薪 HK$16,000 為固定收入,不受 KPI 影響</div>
    </div>
  );
}
function ManagerGoal({ calc }) {
  const rev = calc.storeRevenue;
  const next = calc.tierNext;
  return (
    <div className="pwd-mgrgoal">
      <div className="pwd-mgrgoal-cur">
        <div>
          <div className="pwd-mgrgoal-lbl">本月門店總業績 (酒店+學院+美容+接送)</div>
          <div className="pwd-mgrgoal-rev">{money(rev)}</div>
        </div>
        <div className="pwd-mgrgoal-amt">
          <span className="pwd-mgrgoal-amt-num">{money(calc.tierAmt)}</span>
          <span className="pwd-mgrgoal-amt-sub">本級佣金</span>
        </div>
      </div>
      {next && (
        <div className="pwd-mgrgoal-next">再衝 <b>{money(next.min - rev)}</b> 業績 → 佣金升至 <b>{money(next.amt)}</b>(+{money(next.amt - calc.tierAmt)})</div>
      )}
      <div className="pwd-mgrgoal-ladder">
        {MGR_TIERS.map((t, i) => {
          const hit = rev >= t.min;
          const isCur = i === calc.tierIndex;
          return (
            <div key={i} className={'pwd-mgrgoal-step' + (hit ? ' hit' : '') + (isCur ? ' cur' : '')}>
              <span className="pwd-mgrgoal-step-node">{hit ? '✓' : ''}</span>
              <span className="pwd-mgrgoal-step-min">{money(t.min)}</span>
              <span className="pwd-mgrgoal-step-amt">{money(t.amt)}</span>
              {isCur && <span className="pwd-mgrgoal-step-tag">現時</span>}
            </div>
          );
        })}
      </div>
      <div className="pwd-mgrgoal-foot">學院交付獎金 HK$2,000 已併入各級階梯金額</div>
    </div>
  );
}
// ⚠️ 呢個 component 只會 render 畀非店長員工（店長行 ManagerGoal）。
// 老闆 2026-08-12：店長以下唔顯示公司／部門總業績銀碼，淨係要知有冇到門檻。
// 所以進度條只有「滿」或「空」（唔可以用真實比例——睇條 bar 就估返到業績），
// 數字位置顯示「已達／未達門檻」＋政策目標數（目標係制度寫明，唔係業績）。
function GoalUnlock({ team, calc, role, dept }) {
  const T = TARGETS;
  const perTen = Math.round(1200 / HOTEL_SEATS);
  const isAcad = dept === 'academy';
  const goals = [];
  if (role === 'manager' || !isAcad) goals.push(
    { icon: '🏨', scope: '團隊', label: '酒店業績達門檻 (含基本美容)', cur: calc.hotelRevenue, target: T.hotelThreshold, fmt: money, reward: '解鎖酒店 12% 佣金池', hit: calc.hotelRevenue >= T.hotelThreshold, hint: '每多 HK$10,000 業績 ≈ 每人 +HK$' + perTen });
  if (role === 'manager' || isAcad) goals.push(
    { icon: '🎓', scope: '團隊', label: '學院業績達門檻', cur: team.academyRevenue || 0, target: T.academyThreshold, fmt: money, reward: '解鎖學院佣金 (新生 + 舊生續報)', hit: (team.academyRevenue || 0) >= T.academyThreshold, hint: '達標後:新生每隻 S1 $500 / S2 $300 / S1+S2 $900;舊生續報 $900/個' });
  if (role === 'manager') {
    goals.push({ icon: '🔄', scope: '店長', label: '套票銷售目標', cur: team.packages, target: T.packageGoal, fmt: (n) => n + ' 個', reward: '店長 KPI 項目 (套票不另計佣)', hit: team.packages >= T.packageGoal });
  }
  return (
    <div className="pwd-goals">
      {goals.map((g, i) => {
        const pct = g.noTarget ? 100 : (g.hit ? 100 : 0);   // 唔用真實比例，否則條 bar 反推到業績
        return (
          <div key={i} className={'pwd-goal' + (g.hit || g.noTarget ? ' hit' : '')}>
            <div className="pwd-goal-ico">{(g.hit || g.noTarget) ? '✓' : i + 1}</div>
            <div className="pwd-goal-mid">
              <div className="pwd-goal-top">
                <span className="pwd-goal-label">{g.label}</span>
                <span className={'pwd-goal-scope s-' + (g.scope === '個人' ? 'me' : g.scope === '店長' ? 'mgr' : 'team')}>{g.scope}</span>
              </div>
              <div className="pwd-goal-bar"><div style={{ width: pct + '%' }} className={g.hit || g.noTarget ? 'hit' : ''} /></div>
              <div className="pwd-goal-foot">
                <span className="pwd-goal-num">{g.noTarget ? g.fmt(g.cur) : <>{g.hit ? '✓ 已達門檻' : '未達門檻'} <i>目標 {g.fmt(g.target)}</i></>}</span>
                <span className={'pwd-goal-reward' + (g.hit || g.noTarget ? ' on' : '')}>{g.noTarget ? '' : g.hit ? '✓ ' : ''}{g.reward}</span>
              </div>
              {g.hint && <div className="pwd-goal-hint">{g.hint}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function RateTable({ role, dept }) {
  const [open, setOpen] = useState(false);
  const isMgr = role === 'manager', isFd = role === 'frontdesk';
  const rows = isMgr
    ? [ { label: '門店業績 ≥ $320,000', rate: 'HK$5,800', note: '酒店 + 學院 總業績 · 已含學院交付獎' },
        { label: '門店業績 ≥ $420,000', rate: 'HK$7,800', note: '' },
        { label: '門店業績 ≥ $520,000', rate: 'HK$9,800', note: '' },
        { label: '門店業績 ≥ $620,000', rate: 'HK$11,800', note: '' } ]
    : isFd
    ? [ { label: '固定底薪', rate: 'HK$16,000', note: '每月固定,不受 KPI 影響' },
        { label: 'KPI 獎金 · 91 分以上', rate: 'HK$2,000', note: '全額發放' },
        { label: 'KPI 獎金 · 81–90 分', rate: '按完成率', note: '獎金 × KPI %' },
        { label: 'KPI 獎金 · 71–80 分', rate: 'HK$1,000', note: '半額' },
        { label: 'KPI 獎金 · 70 分以下', rate: 'HK$0', note: '不發放' } ]
    : (dept === 'academy' ? RATES_ACADEMY : RATES_HOTEL);
  return (
    <div className="pwd-rate">
      <button className="pwd-rate-head" onClick={() => setOpen(o => !o)}>
        <span>{isMgr ? '店長佣金制度' : isFd ? '前台薪酬制度' : '佣金率參考表'}</span>
        <span className={'pwd-rate-arr' + (open ? ' open' : '')}>⌄</span>
      </button>
      <div className="pwd-rate-body" style={{ maxHeight: open ? 460 : 0 }}>
        {rows.map((r, i) => (
          <div key={i} className="pwd-rate-row">
            <span className="pwd-rate-lbl">{r.label}</span>
            <span className="pwd-rate-rate">{r.rate}</span>
            {r.note && <span className="pwd-rate-note">{r.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
function KpiClauses({ lateLeave, dogEscape }) {
  const lateTriggered = lateLeave > 3;
  return (
    <div className="pwd-clauses">
      <div className="pwd-clauses-head">
        <span className="pwd-clauses-ico">⚠</span>
        <span>KPI 特別否決條款 — 任何一項觸發,當月 KPI 直接為 0</span>
      </div>
      <div className={'pwd-clause' + (lateTriggered ? ' hit' : '')}>
        <span className="pwd-clause-dot" />
        <div className="pwd-clause-text">
          <b>當月累積遲到或請假超過 3 次</b>
          <span className="pwd-clause-sub">個人 · 本月已累積 {lateLeave} 次</span>
        </div>
        <span className={'pwd-clause-tag' + (lateTriggered ? ' hit' : '')}>{lateTriggered ? '已觸發' : `尚餘 ${Math.max(0, 3 - lateLeave)} 次`}</span>
      </div>
      <div className={'pwd-clause' + (dogEscape ? ' hit' : '')}>
        <span className="pwd-clause-dot" />
        <div className="pwd-clause-text">
          <b>狗狗走失 (狗狗單獨離開店舖範圍)</b>
          <span className="pwd-clause-sub">團隊 · 全店所有人 KPI 為 0</span>
        </div>
        <span className={'pwd-clause-tag' + (dogEscape ? ' hit' : '')}>{dogEscape ? '已觸發' : '本月正常'}</span>
      </div>
    </div>
  );
}
function Stepper({ value, onChange, min = 0, suffix = '隻', hint }) {
  return (
    <div className="pwd-step-field">
      <button className="pwd-step-btn" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <div className="pwd-step-mid">
        <div className="pwd-step-num">{value}<span className="pwd-step-suf">{suffix}</span></div>
        {hint && <div className="pwd-step-hint">{hint}</div>}
      </div>
      <button className="pwd-step-btn" onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}
function AttendanceDots({ days, editable, onChange, max = 8 }) {
  return (
    <div className="pwd-dots">
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <button key={n} className={'pwd-dot' + (n <= days ? ' on' : '') + (editable ? ' edit' : '')}
          onClick={editable ? () => onChange(n === days ? n - 1 : n) : undefined} disabled={!editable}>{n}</button>
      ))}
    </div>
  );
}

// ═══════════ Login ═══════════
function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    if (e) e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      // [2026-08-25] 登入速度：舊版 auth 成功先再 call dashboard 兩程 request，
      //   而家合併做一程 login action（後端已經一次過驗證身份+計主面板數據）。
      const res = await pwApi('login', { name: name.trim(), id: id.trim(), month: currentMonth() });
      if (!res.ok) { setError(res.error || '登入失敗,請重試'); setBusy(false); return; }
      onLogin(res);
    } catch (err) {
      setError('連線失敗,請檢查網絡後重試'); setBusy(false);
    }
  }
  return (
    <div className="pwd-login">
      <div className="pwd-login-top">
        <div className="pwd-login-crest"><img src="pawradise-logo-full.png" alt="Pawradise" /></div>
        <div className="pwd-login-sub">員工後台管理系統</div>
      </div>
      <form className="pwd-login-card" onSubmit={submit}>
        <div className="pwd-eyebrow" style={{ textAlign: 'center' }}>員工登入</div>
        <label className="pwd-field">
          <span className="pwd-field-lbl">全名</span>
          <input className="pwd-input" type="text" autoComplete="off" placeholder="請輸入你的全名" value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }} />
        </label>
        <label className="pwd-field">
          <span className="pwd-field-lbl">身份證英文字＋頭 4 位數字</span>
          <input className="pwd-input" type="password" autoComplete="off" placeholder="例如 A1234" value={id}
            onChange={(e) => { setId(e.target.value); setError(''); }} />
        </label>
        {error && <div className="pwd-login-err">{error}</div>}
        <button type="submit" className="pwd-login-btn" disabled={!name.trim() || !id.trim() || busy}>{busy ? '登入中…' : '登入'}</button>
      </form>
      <div className="pwd-login-foot">Pawradise · 毛孩社交學院 · {APP_VERSION}</div>
    </div>
  );
}

// ═══════════ TrialCard ═══════════
// 試堂登記：酒店客免費體驗／新生付費試堂統一喺呢度幫家長留位。名額同正常入學位分開計（每個幼稚園日 2 個）。
function TrialCard({ staff, slots, bookings, done, onBook, onCancel }) {
  const [sel, setSel] = useState('');
  const [dog, setDog] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // [2026-08-25 老闆定] 統一喺呢度留位：酒店客免費體驗 vs 新生要收 $499（同步入收入記錄）。
  const [customerType, setCustomerType] = useState('hotel'); // hotel | new
  const [ownerName, setOwnerName] = useState('');
  const [payMethod, setPayMethod] = useState('現金');
  // [2026-08-25 修復] 舊版硬 cap 12 個，45 日窗內 S1 日數多過 12 就會截斷
  //   （例：8月尾4日+9月頭8日已經夠12，9月中至尾嘅日子永遠見唔到，畫面又冇提示）。
  //   後端 trialSlotsHandler 本身已限 45 日窗，呢度唔再加疊第二層截斷。
  const list = (slots || []);
  const totalLeft = (slots || []).reduce((a, s) => a + s.remaining, 0);
  const mine = (bookings || []);
  // 已完成試堂（最近 14 日，最近嘅排前）——純唯讀。跟進記錄統一喺 Leads 主表做，唔喺呢度填。
  const doneList = (done || []);
  const isNew = customerType === 'new';
  const canSubmit = sel && dog.trim() && !busy && (!isNew || (ownerName.trim() && payMethod));
  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setMsg('');
    const r = await onBook({ classId: sel, dogName: dog.trim(), phone: phone.trim(), customerType,
      ownerName: isNew ? ownerName.trim() : '', payMethod: isNew ? payMethod : '' });
    setBusy(false);
    if (r && r.ok === false) { setMsg(r.error || '登記失敗'); return; }
    setSel(''); setDog(''); setPhone(''); setOwnerName('');
    setMsg(isNew ? `已留位＋已記 $${TRIAL_NEW_STUDENT_FEE} 入收入記錄。記得即刻 WhatsApp 發確認訊息畀家長。`
                 : '已留位。記得即刻 WhatsApp 發確認訊息畀家長。');
  }
  return (
    <div className="pwd-card pwd-block">
      <div className="pwd-tr-head">
        <div>
          <div className="pwd-eyebrow">試堂登記</div>
          <div className="pwd-tr-sub">一日體驗 · 每個幼稚園日 2 個位</div>
        </div>
        <div className="pwd-club-earned">未來仲有<b>{totalLeft}</b></div>
      </div>
      {list.length === 0 && <div className="pwd-tr-hint" style={{ marginTop: 12 }}>未來 45 日暫時未有幼稚園日，或課堂名額表未更新。</div>}
      {list.length > 0 && (
        <>
          <div className="pwd-tr-days">
            {list.map(s => {
              const full = s.remaining <= 0;
              return (
                <div key={s.id}
                     className={'pwd-tr-day' + (sel === s.id ? ' sel' : '') + (full ? ' full' : '')}
                     onClick={() => { if (!full) setSel(sel === s.id ? '' : s.id); }}>
                  <div className="pwd-tr-day-d">{s.date.slice(5).replace('-', '/')}</div>
                  <div className="pwd-tr-day-w">{s.time || ''}</div>
                  <div className={'pwd-tr-day-r ' + (full ? 'no' : 'ok')}>{full ? '已滿' : '尚餘 ' + s.remaining}</div>
                </div>
              );
            })}
          </div>
          <div className="pwd-tr-form">
            <div className="pwd-view-toggle">
              <button className={!isNew ? 'on' : ''} onClick={() => setCustomerType('hotel')}>🏨 酒店客（免費）</button>
              <button className={isNew ? 'on' : ''} onClick={() => setCustomerType('new')}>🆕 新生（${TRIAL_NEW_STUDENT_FEE}）</button>
            </div>
            <div className="pwd-tr-row" style={{ marginTop: 10 }}>
              <input className="pwd-tr-input" placeholder="狗狗名稱" value={dog} onChange={e => setDog(e.target.value)} />
              <input className="pwd-tr-input" type="tel" inputMode="tel" placeholder="家長電話" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            {isNew && (
              <div className="pwd-tr-row">
                <input className="pwd-tr-input" placeholder="家長姓名（入收入記錄用）" value={ownerName} onChange={e => setOwnerName(e.target.value)} />
                <select className="pwd-monthsel" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  <option value="現金">現金</option>
                  <option value="轉賬">轉賬</option>
                </select>
              </div>
            )}
            <div className="pwd-tr-hint">
              {isNew
                ? <>揀好日子 → 入齊資料同已收嘅 ${TRIAL_NEW_STUDENT_FEE} → 提交（會自動記入收入記錄），<b>然後即刻 WhatsApp 發確認訊息</b>。</>
                : <>揀好日子 → 入名 → 提交，<b>然後即刻 WhatsApp 發確認訊息</b>（見《體驗邀請與確認訊息範本》訊息二）。口頭講完唔入呢度，等於冇留位。</>}
            </div>
            {msg && <div className="pwd-tr-hint" style={{ color: 'var(--pw-navy-deep)' }}>{msg}</div>}
            <div className="pwd-club-formacts">
              <span className="pwd-tr-sub">{sel ? '已揀 ' + (list.find(x => x.id === sel) || {}).label : '請先揀一日'}</span>
              <button className="pwd-la-confirm" disabled={!canSubmit} onClick={submit}>
                {busy ? '登記中…' : '確認留位'}
              </button>
            </div>
          </div>
        </>
      )}
      {mine.length > 0 && (
        <div className="pwd-tr-list">
          <div className="pwd-club-list-lbl">即將到來嘅試堂 ({mine.length})</div>
          {mine.map(b => (
            <div key={b.id} className="pwd-tr-item">
              <div className="pwd-tr-item-i">
                <b>{b.dog}{b.phone ? <span className="pwd-club-nom-owner"> · {b.phone}</span> : null}</b>
                <span>{b.label}</span>
              </div>
              <button className="pwd-tr-x" onClick={() => onCancel(b.id)}>取消</button>
            </div>
          ))}
        </div>
      )}
      {doneList.length > 0 && (
        <div className="pwd-tr-list">
          <div className="pwd-club-list-lbl">最近完成嘅試堂 · 14 日內 ({doneList.length})</div>
          {doneList.map(d => (
            <div key={d.id} className="pwd-tr-item">
              <div className="pwd-tr-item-i">
                <b>{d.dog}{d.phone ? <span className="pwd-club-nom-owner"> · {d.phone}</span> : null}</b>
                <span>{d.label}</span>
              </div>
            </div>
          ))}
          <div className="pwd-tr-hint">試堂後跟進喺 Leads 追蹤表做（跟進日已自動排到試堂翌日），呢度只係畀你見返試咗邊幾隻。</div>
        </div>
      )}
    </div>
  );
}

// ═══════════ ClubCard ═══════════
function ClubCard({ staff, noms, month, bonus, onSubmit }) {
  const mine = noms.filter(n => n.staffId == staff.id);
  const boosted = promoBoost(month) > 1;
  const [open, setOpen] = useState(false);
  const [dog, setDog] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const STATUS = {
    pending: { label: '待店長審批', cls: 'pending' },
    approved: { label: '已確認資格 · 待主人訂閱', cls: 'approved' },
    subscribed: { label: '已成功訂閱', cls: 'subscribed' },
    rejected: { label: '未獲批准', cls: 'rejected' },
  };
  async function submit() {
    if (!dog.trim() || busy) return;
    setBusy(true);
    await onSubmit({ dogName: dog.trim(), phone: phone.trim() });
    setDog(''); setPhone(''); setOpen(false); setBusy(false);
  }
  return (
    <div className="pwd-card pwd-block pwd-club">
      <div className="pwd-club-head">
        <div>
          <div className="pwd-eyebrow">Calm Explorer Club</div>
          <div className="pwd-club-sub">提名達 A 級嘅狗狗 · 店長確認入會資格後,家長自行揀方案{boosted ? ' · 8–9 月獎金 ×1.5' : ''}</div>
        </div>
        <div className="pwd-club-earned">我分得<b>{money(bonus || 0)}</b></div>
      </div>
      <div className="pwd-club-tiers">
        {Object.values(CLUB_TIERS).map(t => (
          <div key={t.key} className="pwd-club-tier">
            <span className="pwd-club-tier-dot" style={{ background: t.color }} />
            <span className="pwd-club-tier-name">{t.label}</span>
            <span className="pwd-club-tier-fee">${t.fee}/月</span>
            <span className="pwd-club-tier-bonus">入會 ${Math.round(t.bonus * promoBoost(month))}</span>
            <span className="pwd-club-tier-fee">續會 ${t.renew}/月 × 6</span>
          </div>
        ))}
      </div>
      {!open && <button className="pwd-club-add" onClick={() => setOpen(true)}>＋ 提名狗狗</button>}
      {open && (
        <div className="pwd-club-form">
          <div className="pwd-club-frow">
            <input className="pwd-club-input" placeholder="狗狗名稱" value={dog} onChange={(e) => setDog(e.target.value)} />
            <input className="pwd-club-input" type="tel" inputMode="tel" placeholder="聯絡電話" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="pwd-club-hint">提名前先確認狗狗評估達 A 級或以上 · 店長會確認入會資格 · 獎金入團隊池,按職級分</div>
          <div className="pwd-club-formacts">
            <button className="pwd-swap-cancel" onClick={() => setOpen(false)}>取消</button>
            <button className="pwd-la-confirm" disabled={!dog.trim() || busy} onClick={submit}>{busy ? '提交中…' : '提交提名'}</button>
          </div>
        </div>
      )}
      {mine.length > 0 && (
        <div className="pwd-club-list">
          <div className="pwd-club-list-lbl">我的提名 ({mine.length})</div>
          {mine.map(n => {
            const t = n.tier ? CLUB_TIERS[n.tier] : null;
            const st = STATUS[n.status] || STATUS.pending;
            return (
              <div key={n.id} className="pwd-club-nom">
                <span className="pwd-club-nom-dot" style={{ background: t ? t.color : 'var(--pw-cream-deep)' }} />
                <div className="pwd-club-nom-info">
                  <b>{n.dog}{n.phone ? <span className="pwd-club-nom-owner">· {n.phone}</span> : null}</b>
                  <span>{t ? `${t.label} · $${t.fee}/月 · 入池 $${Math.round(t.bonus * promoBoost(month))}` : '待店長確認入會資格'}</span>
                </div>
                <span className={'pwd-club-status ' + st.cls}>{st.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════ CommissionHistory ═══════════
function CommissionHistory({ history, current, monthLabel }) {
  const data = [...history, { m: monthLabel, v: Math.round(current), now: true }];
  let run = 0;
  const pts = data.map(d => { run += d.v; return { m: d.m, cum: run, now: d.now }; });
  const cumulative = run;
  const avg = Math.round(cumulative / data.length);
  const W = 320, H = 132, padX = 14, padTop = 16, padBot = 24;
  const maxCum = pts[pts.length - 1].cum || 1;
  const x = (i) => padX + (W - padX * 2) * (i / Math.max(1, pts.length - 1));
  const y = (v) => padTop + (H - padTop - padBot) * (1 - v / maxCum);
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${x(pts.length - 1).toFixed(1)} ${H - padBot} L ${x(0).toFixed(1)} ${H - padBot} Z`;
  const last = pts[pts.length - 1];
  return (
    <div className="pwd-card pwd-block">
      <div className="pwd-eyebrow">本年累計佣金</div>
      <div className="pwd-hist-cum">
        <span className="pwd-hist-cum-num"><span className="cur">HK$</span>{moneyPlain(cumulative)}</span>
        <span className="pwd-hist-cum-sub">2026 年至今 · 平均每月 {money(avg)}</span>
      </div>
      <div className="pwd-hist-linewrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="pwd-hist-svg" preserveAspectRatio="none">
          <defs>
            <linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--pw-gold)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--pw-gold)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#histFill)" />
          <path d={linePath} fill="none" stroke="var(--pw-gold-deep)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.cum)} r={p.now ? 5 : 3.5} fill={p.now ? 'var(--pw-gold-deep)' : 'var(--pw-paper)'} stroke="var(--pw-gold-deep)" strokeWidth="2" />
              <text x={x(i)} y={H - 8} textAnchor="middle" className={'pwd-hist-x' + (p.now ? ' now' : '')}>{p.m}</text>
            </g>
          ))}
          <text x={x(pts.length - 1)} y={y(last.cum) - 11} textAnchor="end" className="pwd-hist-peak">{money(last.cum)}</text>
        </svg>
      </div>
      <div className="pwd-hist-note">持續達標,多勞多得,累積越滾越大 🎯</div>
    </div>
  );
}

// ═══════════ IndividualView ═══════════
function IndividualView({ staff, calc, items, kpi, team, lateLeave, dogEscape, clubNoms, trialSlots, trialBookings, trialDone, history, month, monthLabel, onClubSubmit, onTrialBook, onTrialCancel }) {
  const clubBonus = clubBonusFor(staff, clubNoms, month);
  const actualTotal = kpi.actualTotal + clubBonus;
  const actualParts = clubBonus > 0 ? [...kpi.actualParts, { key: 'club', value: clubBonus }] : kpi.actualParts;
  const pctOf = (v) => actualTotal > 0 ? Math.round(v / actualTotal * 100) : 0;
  const score = scorecardTotal(items);
  const isMgr = calc.isManager, isFd = calc.isFrontdesk;
  // 以下三個 detail 只會喺非店長版面用（店長行 mgrtier 分支）——
  // 老闆 2026-08-12：店長以下唔顯示總業績銀碼，只講「達／未達門檻」
  const newDetail = (calc.acadGateOk === false)
    ? `學院未達 $50k 門檻 · 學院佣暫不計`
    : `S1 ${calc.s1New||0}·S2 ${calc.s2New||0}·S1+S2 ${calc.comboNew||0}(個人,歸成交者)`;
  const renewDetail = (calc.acadGateOk === false)
    ? `學院總業績 < $50k 門檻 · 暫不計`
    : `團隊 ${calc.renewals} 個 · $900/個 · 按職級固定分母分`;
  const hotelDetail = calc.hotelOver > 0 ? '已達門檻 · 超出部分 12% 入池 ÷ 編制 3' : '未達門檻 $200k';
  const compRowsBase = isMgr
    ? [ { pk: 'mgrtier', value: kpi.actualParts[1].value, detail: calc.tierAmt > 0 ? `門店業績 ${money(calc.storeRevenue)} · 達 ${money(calc.tierMin)} 級 (已含學院交付獎)` : `門店業績 ${money(calc.storeRevenue)} · 未達 $320k` } ]
    : isFd
    ? [ { pk: 'base', value: kpi.actualParts[0].value, detail: '每月固定底薪 · 不受 KPI 影響' },
        { pk: 'kpibonus', value: kpi.actualParts[1].value, detail: `KPI ${score} 分 · 發放 ${Math.round(kpi.ratio * 100)}%` } ]
    : staff.dept === 'academy'
    ? [ { pk: 'newcmm', value: kpi.actualParts[2].value, detail: staff.acadRank === 'assistant' ? '個人銷售佣 · 升初級導師後解鎖' : newDetail },
        { pk: 'renew', value: kpi.actualParts[3].value, detail: renewDetail } ]
    : [ { pk: 'hotel', value: kpi.actualParts[1].value, detail: hotelDetail },
        ...(calc.referral > 0 ? [{ pk: 'referral', value: kpi.actualParts[4].value, detail: `成功轉介 ${calc.hotelReferrals} 隻 · $${calc.referralUnit || 180}/隻入池 ÷ 編制 3` + (promoBoost(team.monthKey) > 1 ? ' · 限期 ×1.5' : '') }] : []) ];
  const subscribedCount = clubNoms.filter(n => n.staffId == staff.id && n.status === 'subscribed').length;
  const teamSubscribed = clubNoms.filter(n => n.status === 'subscribed').length;
  const clubDetail = `團隊 ${teamSubscribed} 個入會(我提名 ${subscribedCount} 個) · 按職級固定分母分`
    + (promoBoost(month) > 1 ? ' · 限期 ×1.5' : '');
  const compRows = clubBonus > 0 ? [...compRowsBase, { pk: 'club', value: clubBonus, detail: clubDetail }] : compRowsBase;
  return (
    <>
      {kpi.ratio === 0 && <div className="pwd-warn">KPI {kpi.reason ? kpi.reason : '未達 71 分'} — {isFd ? '本月 KPI 獎金暫不發放 (底薪不受影響)' : '本月佣金暫不發放'}</div>}
      <div className="pwd-card pwd-heroA">
        <div className="pwd-eyebrow">{staff.name} · {roleKpi(kpiRoleOf(staff)).label} · 本月實際{isFd ? '收入' : '領取'}</div>
        <DonutChart parts={actualParts} total={actualTotal}>
          <div className="pwd-ring-num"><span className="cur">HK$</span>{moneyPlain(actualTotal)}</div>
          <div className="pwd-ring-sub">本月預計</div>
        </DonutChart>
        {isFd
          ? <div className={'pwd-fixed ' + (kpi.ratio >= 1 ? 'on' : 'off')}><span className="pwd-fixed-dot" />{kpi.ratio >= 1 ? 'KPI 獎金 HK$2,000 全額發放' : `KPI ${score} 分 · 獎金發放 ${Math.round(kpi.ratio * 100)}%`}</div>
          : null}
        <div className="pwd-comp">
          {compRows.map(r => {
            const meta = PARTS_META[r.pk];
            return (
              <div key={r.pk} className="pwd-comp-row">
                <span className="pwd-comp-dot" style={{ background: meta.color }} />
                <span className="pwd-comp-main">
                  <span className="pwd-comp-label">{meta.label}</span>
                  <span className="pwd-comp-detail">{r.detail}</span>
                </span>
                <span className="pwd-comp-pct">{pctOf(r.value)}%</span>
                <span className="pwd-comp-amt">{money(r.value)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">{isFd ? 'KPI 獎金達成' : '目標達成 · 解鎖更高佣金'}</div>
        {isMgr ? <ManagerGoal calc={calc} /> : isFd ? <FrontdeskGoal calc={calc} kpi={kpi} score={score} /> : <GoalUnlock team={team} calc={calc} role={staff.role} dept={staff.dept} />}
      </div>
      <TrialCard staff={staff} slots={trialSlots} bookings={trialBookings} done={trialDone}
        onBook={onTrialBook} onCancel={onTrialCancel} />
      <ClubCard staff={staff} noms={clubNoms} month={month} bonus={clubBonus} onSubmit={onClubSubmit} />
      <CommissionHistory history={history} current={actualTotal} monthLabel={monthLabel} />
      <div className="pwd-kpi-divider"><span>KPI 結算 · 月底由店長評核</span></div>
      <KpiCard role={kpiRoleOf(staff)} items={items} score={score} kpi={kpi} editable={false} />
      <KpiClauses lateLeave={lateLeave} dogEscape={dogEscape} />
      {/* 年終花紅獎池卡已剷走（老闆 2026-08-12）：呢筆未必會派，唔應該喺員工前台
          做成「扣起嘅錢遲早攞得返」嘅預期。YearEndPool component 保留但唔再 render。 */}
      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">計算 → KPI → 實際領取</div>
        <PayoutLedger calc={calc} kpi={kpi} />
      </div>
      <RateTable role={staff.role} dept={staff.dept} />
    </>
  );
}

// ═══════════ DutyRoster ═══════════
function DutyRoster({ staff, weeks, currentWeekIdx, todayDow, leave, leaveRecords, coworkers, onSwap }) {
  const [weekIndex, setWeekIndex] = useState(currentWeekIdx);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapDone, setSwapDone] = useState(null);
  const [busy, setBusy] = useState(false);
  // [2026-08-25] 全隊一週視角：唔理登入緊邊個員工，都睇到呢一週逐日邊幾多人返工。
  // 按需 lazy fetch（揀「全隊」先叫 action），唔掛入 dashboard 拖慢登入。
  const [view, setView] = useState('mine'); // mine | team
  const [teamData, setTeamData] = useState(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const week = weeks[weekIndex] || weeks[currentWeekIdx];
  const days = buildWeekDays(week, weekIndex, currentWeekIdx, todayDow);
  const sum = weekSummary(week);
  const isCurrent = weekIndex === currentWeekIdx;
  const tag = isCurrent ? '本週' : (weekIndex < currentWeekIdx ? '過去' : '未來');
  const curWeek = weeks[currentWeekIdx];
  const myShifts = buildWeekDays(curWeek, currentWeekIdx, currentWeekIdx, todayDow)
    .map((d, i) => ({ ...d, i })).filter(d => !d.off && d.i >= todayDow);
  useEffect(() => {
    if (view !== 'team') return;
    if (teamData && teamData.weekStart === week.weekStart) return;
    let cancelled = false;
    setTeamLoading(true);
    pwApi('teamRoster', { weekStart: week.weekStart }).then(res => {
      if (!cancelled && res.ok) setTeamData(res);
    }).finally(() => { if (!cancelled) setTeamLoading(false); });
    return () => { cancelled = true; };
  }, [view, week.weekStart]);
  const teamDays = (teamData && teamData.weekStart === week.weekStart) ? teamData.days : null;
  async function requestSwap(s) {
    if (busy) return;
    setBusy(true);
    const dateStr = `${curWeek.weekStart.slice(0, 7)}-${String(s.date).padStart(2, '0')}`;
    await onSwap({ date: dateStr, shift: `${s.label} ${s.time}` });
    setSwapDone(`${s.date}日 (${s.weekday}) ${s.label}`); setSwapOpen(false); setBusy(false);
  }
  return (
    <>
      <div className="pwd-card pwd-block">
        <div className="pwd-roster-head">
          <div className="pwd-roster-nav">
            <button className="pwd-wk-btn" disabled={weekIndex <= 0} onClick={() => setWeekIndex(weekIndex - 1)}>‹</button>
            <div className="pwd-roster-weekbox">
              <div className="pwd-roster-week">{week.label}</div>
              <div className="pwd-roster-tag">{tag}</div>
            </div>
            <button className="pwd-wk-btn" disabled={weekIndex >= weeks.length - 1} onClick={() => setWeekIndex(weekIndex + 1)}>›</button>
          </div>
          {!isCurrent && <button className="pwd-wk-today" onClick={() => setWeekIndex(currentWeekIdx)}>回本週</button>}
        </div>
        <div className="pwd-roster-sum">
          <span><b>{sum.workDays}</b> 更</span><span className="dot">·</span>
          <span><b>{sum.weekHours}</b> 時</span>
        </div>
        <div className="pwd-view-toggle">
          <button className={view === 'mine' ? 'on' : ''} onClick={() => setView('mine')}>我的</button>
          <button className={view === 'team' ? 'on' : ''} onClick={() => setView('team')}>全隊</button>
        </div>
        {view === 'mine' && (
        <div className="pwd-duty">
          {days.map((d, i) => (
            <div key={i} className={'pwd-duty-row' + (d.today ? ' today' : '') + (d.off ? ' off' : '')}>
              <div className="pwd-duty-date">
                <span className="pwd-duty-wd">{d.weekday}</span>
                <span className="pwd-duty-num">{d.date}</span>
              </div>
              <div className="pwd-duty-info">
                <span className="pwd-duty-shift">{d.label}</span>
                {d.pos && <span className={'pwd-duty-pos sh-' + d.pos.cls}>{d.pos.label}</span>}
              </div>
              <div className="pwd-duty-right">
                <span className="pwd-duty-time">{d.time || '—'}</span>
                {d.today && <span className="pwd-duty-now">今天</span>}
              </div>
            </div>
          ))}
        </div>
        )}
        {view === 'team' && (
        <div className="pwd-duty">
          {days.map((d, i) => {
            const people = teamDays ? teamDays[i] : [];
            return (
              <div key={i} className={'pwd-duty-row' + (d.today ? ' today' : '') + (!teamLoading && people.length === 0 ? ' off' : '')}>
                <div className="pwd-duty-date">
                  <span className="pwd-duty-wd">{d.weekday}</span>
                  <span className="pwd-duty-num">{d.date}</span>
                </div>
                <div className="pwd-duty-team-people">
                  {teamLoading && !teamDays && <span className="pwd-duty-team-empty">載入中…</span>}
                  {teamDays && people.length === 0 && <span className="pwd-duty-team-empty">今日冇人返工</span>}
                  {teamDays && people.map((c, ci) => (
                    <span key={ci} className="pwd-coworker">
                      <span className="pwd-coworker-ava">{c.initial}</span>
                      {c.name}{c.posKey && POSITIONS[c.posKey] ? (' · ' + POSITIONS[c.posKey].label) : ''}
                    </span>
                  ))}
                </div>
                {d.today && <span className="pwd-duty-now">今天</span>}
              </div>
            );
          })}
        </div>
        )}
        {isCurrent && coworkers.length > 0 && (
          <div className="pwd-coworkers">
            <span className="pwd-coworkers-lbl">今天同更</span>
            <div className="pwd-coworkers-list">
              {coworkers.map((c, i) => (
                <span key={i} className="pwd-coworker"><span className="pwd-coworker-ava">{c.initial}</span>{c.name} · {c.pos}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="pwd-card pwd-block">
        <div className="pwd-swap-head">
          <div className="pwd-eyebrow">換更 / 調更申請</div>
          {!swapOpen && <button className="pwd-swap-toggle" onClick={() => { setSwapOpen(true); setSwapDone(null); }}>＋ 申請</button>}
        </div>
        {swapDone && <div className="pwd-swap-ok">✓ 已提交 {swapDone} 換更申請,待店長批核</div>}
        {swapOpen && !swapDone && (
          <div className="pwd-swap-list">
            <div className="pwd-swap-hint">選擇想申請換更的日子:</div>
            {myShifts.length === 0 && <div className="pwd-ph-empty">本週今天起已沒有可申請的更</div>}
            {myShifts.map(s => (
              <button key={s.i} className="pwd-swap-item" disabled={busy} onClick={() => requestSwap(s)}>
                <span className="pwd-swap-date">{s.date}日 ({s.weekday})</span>
                <span className="pwd-swap-shift">{s.label} {s.time}</span>
                <span className="pwd-swap-arr">›</span>
              </button>
            ))}
            <button className="pwd-swap-cancel" onClick={() => setSwapOpen(false)}>取消</button>
          </div>
        )}
      </div>

      <div className="pwd-card pwd-block">
        <div className="pwd-swap-head">
          <div>
            <div className="pwd-eyebrow">請假記錄</div>
            <div className="pwd-leave-by-inline">由店長登記</div>
          </div>
        </div>
        {leaveRecords.length > 0 ? (
          <div className="pwd-larec">
            {leaveRecords.map((rec, i) => (
              <div key={i} className="pwd-larec-row">
                <span className={'pwd-larec-type t-' + rec.type}>{rec.type}</span>
                <span className="pwd-larec-date">{rec.date}</span>
              </div>
            ))}
          </div>
        ) : <div className="pwd-ph-empty" style={{ marginTop: 12 }}>本月暫無請假記錄</div>}
      </div>

      <div className="pwd-card pwd-block">
        <div className="pwd-leave-head">
          <div className="pwd-eyebrow">假期 / 結餘</div>
          <span className="pwd-leave-by">由店長更新</span>
        </div>
        <div className="pwd-ph">
          <div className="pwd-ph-lbl">待放公眾假期</div>
          {leave.ph && leave.ph.length ? (
            <div className="pwd-ph-list">
              {leave.ph.map((p, i) => <span key={i} className="pwd-ph-chip">🎌 {p.name} · {p.date}</span>)}
            </div>
          ) : <div className="pwd-ph-empty">本月暫無待放公眾假期</div>}
        </div>
        <div className="pwd-leave-grid">
          {[ { key: 'annual', lbl: '尚餘年假' }, { key: 'statutory', lbl: '例假結餘' }, { key: 'sick', lbl: '累積有薪病假' } ].map(c => (
            <div key={c.key} className="pwd-leave-cell">
              <div className="pwd-leave-cell-lbl">{c.lbl}</div>
              <div className="pwd-leave-val big">{leave[c.key]}<i>日</i></div>
            </div>
          ))}
        </div>
      </div>
      <div className="pwd-foot">更表如有調動,以店長公佈為準</div>
    </>
  );
}

// ═══════════ Manager helpers ═══════════
const MGR_AREAS = [
  { key: 'ops', label: '營運數據' }, { key: 'kpi', label: 'KPI 評核' },
  { key: 'club', label: '會籍提名' }, { key: 'swap', label: '換更審批' },
  { key: 'leave', label: '請假假期' }, { key: 'roster', label: '排更' },
  { key: 'clean', label: '清潔檢查' },
  { key: 'ownerkpi', label: '評核店長 🔑' },
];
function datesFromWeekStart(weekStart) {
  const [y, m, d] = weekStart.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  return WEEKDAYS.map((_, i) => { const dd = new Date(base); dd.setDate(base.getDate() + i); return dd.getDate(); });
}
// ── 週次導覽用日期 helper ──
function parseYMD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtYMD(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
function mondayOf(dt) { const dow = (dt.getDay() + 6) % 7; const m = new Date(dt); m.setDate(dt.getDate() - dow); return m; }
function shiftWeekStart(ws, deltaWeeks) { const m = parseYMD(ws); m.setDate(m.getDate() + deltaWeeks * 7); return fmtYMD(m); }
function firstWeekStartOfMonth(month) { const [y, mo] = month.split('-').map(Number); return fmtYMD(mondayOf(new Date(y, mo - 1, 1))); }
function weekRangeLabel(ws) {
  const b = parseYMD(ws), e = new Date(b); e.setDate(b.getDate() + 6);
  const bM = b.getMonth() + 1, eM = e.getMonth() + 1;
  return bM === eM ? `${bM}月 ${b.getDate()}–${e.getDate()}日` : `${bM}月${b.getDate()}日 – ${eM}月${e.getDate()}日`;
}
const DEFAULT_WEEK = () => [['off', null], ['off', null], ['off', null], ['off', null], ['off', null], ['off', null], ['off', null]];
function normWeek(arr) { const w = (Array.isArray(arr) ? arr : []).map(r => Array.isArray(r) ? r.slice() : ['off', null]); while (w.length < 7) w.push(['off', null]); return w.slice(0, 7); }
function SaveBtn({ onSave, label = '儲存到 Google Sheet' }) {
  const [state, setState] = useState('idle'); // idle|saving|saved|err
  const [errMsg, setErrMsg] = useState('');
  async function go() {
    setState('saving');
    try {
      const r = await onSave();
      if (r && r.ok === false) {
        // 顯示後端真實原因；授權過期就教用戶點自救（唔好齋話「失敗」）
        const raw = r.error || '';
        setErrMsg(/未授權/.test(raw)
          ? '授權過期:請撳右上「🔒 鎖定」後重新輸入管理密碼,再儲存一次'
          : ('儲存失敗:' + (raw || '請重試')));
        setState('err'); setTimeout(() => setState('idle'), 6000);
      } else {
        setState('saved'); setTimeout(() => setState('idle'), 2500);
      }
    } catch (e) {
      setErrMsg('網絡錯誤,請檢查連線後重試');
      setState('err'); setTimeout(() => setState('idle'), 6000);
    }
  }
  return (
    <>
      <button className="pwd-mgr-savebtn" disabled={state === 'saving'} onClick={go}>
        {state === 'saving' ? '儲存中…' : state === 'saved' ? '✓ 已儲存' : label}
      </button>
      {state === 'err' && <div className="pwd-mgr-saved" style={{ color: 'var(--pw-danger)' }}>{errMsg}</div>}
    </>
  );
}

// ── 營運數據 ──
function MoneyField({ label, value, onChange, note }) {
  return (
    <div className="pwd-mgr-field" style={{ marginTop: 14 }}>
      <label>{label}</label>
      <div className="pwd-money-input">
        <span className="pwd-money-cur">HK$</span>
        <input className="pwd-money-field" type="text" inputMode="numeric" value={(value || 0).toLocaleString('en-US')}
          onChange={(e) => onChange(Math.max(0, +e.target.value.replace(/[^0-9]/g, '') || 0))} />
      </div>
      {note && <div className="pwd-money-note">{note}</div>}
    </div>
  );
}
function MgrOps({ month, mgrData }) {
  const [team, setTeam] = useState(() => ({ ...mgrData.team, academyItems: { ...mgrData.team.academyItems } }));
  const set = (k, v) => setTeam(t => ({ ...t, [k]: v }));
  const ACAD = [
    { key: 'trial', label: '試堂' }, { key: 's1', label: 'S1' }, { key: 's2', label: 'S2' },
    { key: 'combo', label: 'S1+S2' }, { key: 'monthlyFee', label: '月費' },
  ];
  const acad = team.academyItems || { trial: 0, s1: 0, s2: 0, combo: 0, monthlyFee: 0 };
  const setAcad = (key, val) => {
    const next = { ...acad, [key]: val };
    const sum = ACAD.reduce((a, it) => a + (next[it.key] || 0), 0);
    setTeam(t => ({ ...t, academyItems: next, academyRevenue: sum }));
  };
  const acadTotal = ACAD.reduce((a, it) => a + (acad[it.key] || 0), 0);
  // 舊生續報池按學院職級分(資深=owner不抽池,故排除 manager);冇職級資料時 fallback 平分
  const poolStaff = mgrData.staffList.filter(s => s.role !== 'manager' && s.role !== 'frontdesk' && s.dept !== 'academy');
  const acadWeightTotal = ACAD_WEIGHT_TOTAL;  // 固定分母 5,預留未填份額
  const teamForCalc = { ...team, academyRevenue: acadTotal, acadWeightTotal, headcount: poolStaff.length || HEADCOUNT };
  const storeRev = storeRevenueOf(teamForCalc);
  // owner 行唔係員工,唔可以入預覽總額(dept 空白會被當酒店部食一份池,8/25 開 owner 帳戶起嘅幽靈數)
  const previewTotal = mgrData.staffList.filter(s => s.role !== 'owner').reduce((a, s) => {
    const k = mgrData.allKpi[s.id] || { kpiFail: [], lateLeave: 0 };
    const att = (mgrData.allAttendance && mgrData.allAttendance[s.id] != null) ? mgrData.allAttendance[s.id] : 0;
    // 個人新生數(allSales)＋會籍獎金要入埋,先同員工個人頁/月結引擎一條數(2026-09-02 修,同 OwnerCommissionTable)
    const sales = (mgrData.allSales && mgrData.allSales[s.id]) || {};
    const { kpi } = fullResult({ ...s, ...sales, attendance: att, kpiFail: k.kpiFail, lateLeave: k.lateLeave }, teamForCalc);
    return a + kpi.actualTotal + clubBonusFor(s, mgrData.allNoms, team.monthKey || '');
  }, 0);
  function save() {
    return pwApi('saveOps', {
      month, hotelRevenue: team.hotelRevenue, academyRevenue: acadTotal,
      trial: acad.trial || 0, s1: acad.s1 || 0, s2: acad.s2 || 0, combo: acad.combo || 0, monthlyFee: acad.monthlyFee || 0,
      newStudents: (team.s1New||0)+(team.s2New||0)+(team.comboNew||0), renewals: team.renewals,
      s1New: team.s1New || 0, s2New: team.s2New || 0, comboNew: team.comboNew || 0,
      pickup: team.pickup || 0, groomBasic: team.groomBasic || 0, groomStar: team.groomStar || 0,
      packageRevenue: team.packageRevenue || 0, packages: team.packages, other: team.other || 0,
      dogEscape: team.dogEscape ? 'true' : 'false',
      hotelReferrals: team.hotelReferrals || 0,
    });
  }
  return (
    <div className="pwd-mgr-stack">
      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">A. 酒店總業績 (含基本美容,計佣)</div>
        <MoneyField label="酒店總業績" value={team.hotelRevenue} onChange={(v) => set('hotelRevenue', v)}
          note="門檻 HK$200,000 · 超出 12% 為照顧員酒店佣金池" />
        <MoneyField label="D. 基本美容總業績" value={team.groomBasic} onChange={(v) => set('groomBasic', v)}
          note="歸納入酒店總業績一齊計佣" />
        <div className="pwd-mgr-storerow">
          <span>酒店計佣基數 (酒店 + 基本美容)</span>
          <b>{money(hotelForCommission(team))}</b>
        </div>
      </div>

      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">B. 學院總業績 · 分項輸入</div>
        <div className="pwd-acad-items">
          {ACAD.map(it => (
            <div key={it.key} className="pwd-acad-row">
              <span className="pwd-acad-lbl">{it.label}</span>
              <div className="pwd-acad-input">
                <span className="pwd-acad-cur">HK$</span>
                <input type="text" inputMode="numeric" value={(acad[it.key] || 0).toLocaleString('en-US')}
                  onChange={(e) => setAcad(it.key, Math.max(0, +e.target.value.replace(/[^0-9]/g, '') || 0))} />
              </div>
            </div>
          ))}
          <div className="pwd-acad-sum"><span>學院總業績合計</span><b>{money(acadTotal)}</b></div>
          <div className="pwd-mgr-storerow" style={{ marginTop: 8 }}>
            <span>學院 $50,000 收入門檻</span>
            <b style={{ color: acadTotal >= TARGETS.academyThreshold ? '#2e7d32' : '#c0392b' }}>
              {acadTotal >= TARGETS.academyThreshold ? '✓ 已過 · 派學院佣' : `差 ${money(TARGETS.academyThreshold - acadTotal)} · 學院佣暫 $0`}
            </b>
          </div>
        </div>
        <div className="pwd-mgr-field" style={{ marginTop: 14 }}><label>舊生續報 (繼報)</label>
          <Stepper value={team.renewals} suffix="個" hint="$900／個 · 按職級固定分母分" onChange={(v) => set('renewals', v)} /></div>
        <div className="pwd-mgr-field" style={{ marginTop: 12 }}><label>酒店轉介成功報讀學院</label>
          <Stepper value={team.hotelReferrals || 0} suffix="隻" hint="$180／隻入酒店轉介池 ÷ 編制 3 · 按轉化計,派券唔計" onChange={(v) => set('hotelReferrals', v)} /></div>
        <div className="pwd-mgr-storerow" style={{ marginTop: 12 }}><span>學院新生總數(各員工「KPI 評核」自動加總)</span><b>{Object.values(mgrData.allSales || {}).reduce((a, s) => a + (s.s1New || 0) + (s.s2New || 0) + (s.comboNew || 0), 0)} 隻</b></div>
      </div>

      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">其他業績線</div>
        <MoneyField label="C. 接送總業績" value={team.pickup} onChange={(v) => set('pickup', v)} note="計入店長業績 · 不分員工佣金" />
        <MoneyField label="E. 星級美容總業績" value={team.groomStar} onChange={(v) => set('groomStar', v)} note="計入店長業績 · 不分員工佣金" />
        <MoneyField label="F. 套票總業績" value={team.packageRevenue} onChange={(v) => set('packageRevenue', v)} note="公司現金流 · 不計入任何佣金" />
        <div className="pwd-mgr-field" style={{ marginTop: 12 }}><label>套票數量 (店長 KPI)</label>
          <Stepper value={team.packages} suffix="個" hint="目標 ≥ 12" onChange={(v) => set('packages', v)} /></div>
        <MoneyField label="G. 其他" value={team.other} onChange={(v) => set('other', v)} note="只記錄 · 不計入佣金" />
      </div>

      <div className="pwd-card pwd-mgr-preview">
        <div className="pwd-eyebrow">門店總業績 · 店長佣金基準</div>
        <div className="pwd-mgr-preview-num">{money(storeRev)}</div>
        <div className="pwd-mgr-preview-sub">酒店 + 學院 + 基本美容 + 星級美容 + 接送(套票、其他除外)</div>
      </div>

      <div className={'pwd-card pwd-mgr-danger' + (team.dogEscape ? ' on' : '')}>
        <div className="pwd-mgr-danger-text">
          <b>走失狗狗事故</b>
          <span>開啟 → 本月團隊全員 KPI 直接為 0</span>
        </div>
        <button className={'pwd-toggle' + (team.dogEscape ? ' on' : '')} onClick={() => set('dogEscape', !team.dogEscape)}>
          <span className="pwd-toggle-knob" />
        </button>
      </div>

      <div className="pwd-card pwd-mgr-preview">
        <div className="pwd-eyebrow">團隊本月實際領取合計 (預覽)</div>
        <div className="pwd-mgr-preview-num">{money(previewTotal)}</div>
        <div className="pwd-mgr-preview-sub">已計入各人 KPI 發放</div>
      </div>
      <SaveBtn onSave={save} />
    </div>
  );
}

// ── KPI 評核 ──
function MgrKpi({ month, mgrData }) {
  const list = mgrData.staffList.filter(s => s.role !== 'manager');
  const [sel, setSel] = useState(list[0] ? list[0].id : null);
  const staff = list.find(s => s.id == sel);
  const k0 = mgrData.allKpi[sel] || { kpiFail: [], lateLeave: 0 };
  const [fail, setFail] = useState(() => k0.kpiFail.slice());
  const [lateLeave, setLate] = useState(k0.lateLeave || 0);
  const sl0 = (mgrData.allSales && mgrData.allSales[sel]) || {};
  const [sales, setSales] = useState(() => ({ s1New: sl0.s1New || 0, s2New: sl0.s2New || 0, comboNew: sl0.comboNew || 0 }));
  const [acadRank, setAcadRank] = useState(staff.acadRank || 'junior');
  // 學院出勤由更表自動計,唯讀
  const att = (mgrData.allAttendance && mgrData.allAttendance[sel] != null) ? mgrData.allAttendance[sel] : 0;
  function reseed(id) {
    const k = mgrData.allKpi[id] || { kpiFail: [], lateLeave: 0 };
    const sl = (mgrData.allSales && mgrData.allSales[id]) || {};
    const st = list.find(s => s.id == id) || {};
    setSel(id); setFail(k.kpiFail.slice()); setLate(k.lateLeave || 0);
    setSales({ s1New: sl.s1New || 0, s2New: sl.s2New || 0, comboNew: sl.comboNew || 0 });
    setAcadRank(st.acadRank || 'junior');
  }
  const items = buildScorecard(kpiRoleOf(staff), fail);
  const poolStaff = list.filter(s => s.role !== 'frontdesk' && s.dept !== 'academy');
  const acadWeightTotal = ACAD_WEIGHT_TOTAL;  // 固定分母 5,預留未填份額
  const { calc, kpi } = fullResult({ ...staff, ...sales, acadRank, attendance: att, kpiFail: fail, lateLeave }, { ...mgrData.team, acadWeightTotal, headcount: poolStaff.length || HEADCOUNT }, { scorecard: items, lateLeave });
  const score = scorecardTotal(items);
  const tone = kpi.ratio >= 1 ? 'full' : kpi.ratio > 0 ? 'mid' : 'zero';
  const toggle = (id) => setFail(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]);
  // 酒店部冇職級選單 → 唔准送 acadRank(後端見空字串會跳過寫入),避免無意中標成學院初級導師
  function save() { return pwApi('saveKpi', { month, staffId: sel, lateLeave, kpiFail: fail.join(','), s1New: sales.s1New, s2New: sales.s2New, comboNew: sales.comboNew, acadRank: staff.dept === 'hotel' ? '' : acadRank }); }
  return (
    <div className="pwd-mgr-stack">
      <div className="pwd-mgr-people">
        {list.map(s => (
          <button key={s.id} className={'pwd-mgr-person' + (sel == s.id ? ' on' : '')} onClick={() => reseed(s.id)}>
            <span className="pwd-mgr-person-ava">{s.initial}</span>{s.name}
          </button>
        ))}
      </div>
      <div className="pwd-card pwd-block">
        <div className="pwd-kpi-head">
          <div>
            <div className="pwd-eyebrow">{roleKpi(kpiRoleOf(staff)).label} · KPI 評核</div>
            <div className="pwd-kpi-band">發放比例 <b className={'r-' + tone}>{Math.round(kpi.ratio * 100)}%</b> · {kpi.band}</div>
          </div>
          <div className={'pwd-kpi-score r-' + tone}><span className="n">{score}</span><span className="d">分</span></div>
        </div>
        <div className="pwd-kpi-items">
          {items.map(it => (
            <button key={it.id} className={'pwd-kpi-item edit' + (it.pass ? ' pass' : ' fail')} onClick={() => toggle(it.id)}>
              <span className="pwd-kpi-check">{it.pass ? '✓' : '✕'}</span>
              <span className="pwd-kpi-text">{it.text}{it.team && <em className="pwd-kpi-team">團隊</em>}</span>
              <span className="pwd-kpi-w">{it.weight}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pwd-card pwd-mgr-late">
        <div className="pwd-mgr-late-row">
          <div><b>當月遲到 / 請假次數</b><span>超過 3 次 → KPI 直接為 0</span></div>
          <Stepper value={lateLeave} suffix="次" onChange={setLate} />
        </div>
        {lateLeave > 3 && <div className="pwd-warn" style={{ marginTop: 12 }}>已超過 3 次 — {staff.name} 本月 KPI 將為 0</div>}
      </div>
      {staff.role !== 'frontdesk' && (
        <div className="pwd-card pwd-block">
          <div className="pwd-eyebrow">{staff.name} · 學院新生銷售(個人歸成交者)</div>
          <div className="pwd-mgr-fieldgrid">
            <div className="pwd-mgr-field"><label>S1</label>
              <Stepper value={sales.s1New} suffix="隻" hint="$500" onChange={(v) => setSales(s => ({ ...s, s1New: v }))} /></div>
            <div className="pwd-mgr-field"><label>S2</label>
              <Stepper value={sales.s2New} suffix="隻" hint="$300" onChange={(v) => setSales(s => ({ ...s, s2New: v }))} /></div>
            <div className="pwd-mgr-field"><label>S1+S2</label>
              <Stepper value={sales.comboNew} suffix="隻" hint="$900" onChange={(v) => setSales(s => ({ ...s, comboNew: v }))} /></div>
          </div>
          {staff.dept !== 'hotel' && (
            <>
              <div className="pwd-eyebrow" style={{ marginTop: 14 }}>學院職級(舊生續報池按職級分)</div>
              <div className="pwd-club-tierconfirm">
                {[['assistant','助教'],['junior','初級導師'],['senior','資深導師']].map(([v, l]) => (
                  <button key={v} className="pwd-club-tierconfirm-btn" style={acadRank === v ? { background: 'var(--pw-navy)', color: '#fff' } : {}} onClick={() => setAcadRank(v)}>{l}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="pwd-card pwd-mgr-result">
        <div className="pwd-eyebrow">{staff.name} 本月實際領取</div>
        <div className="pwd-mgr-result-num">{money(kpi.actualTotal)}</div>
        <div className="pwd-mgr-result-sub">計算 {money(calc.total)} × {Math.round(kpi.ratio * 100)}% 發放</div>
      </div>
      <SaveBtn onSave={save} label={`儲存 ${staff.name} 的評核`} />
    </div>
  );
}

// ── 換更審批 ──
function MgrSwap({ mgrData }) {
  const nameOf = (id) => { const s = mgrData.staffList.find(x => x.id == id); return s ? s.name : id; };
  const initOf = (id) => { const s = mgrData.staffList.find(x => x.id == id); return s ? s.initial : '?'; };
  const [reqs, setReqs] = useState(() => mgrData.allSwaps.map(r => ({ ...r })));
  async function act(id, status) {
    const prev = reqs.find(r => r.id === id);
    setReqs(rs => rs.map(r => r.id === id ? { ...r, status } : r));
    await pwWrite('approveSwap', { swapId: id, status },
      () => setReqs(rs => rs.map(r => r.id === id ? { ...r, status: prev ? prev.status : 'pending' } : r)));
  }
  const pending = reqs.filter(r => r.status === 'pending');
  const done = reqs.filter(r => r.status !== 'pending');
  return (
    <div className="pwd-mgr-stack">
      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">待審批 ({pending.length})</div>
        {pending.length === 0 ? <div className="pwd-ph-empty" style={{ marginTop: 12 }}>沒有待審批的換更申請</div> : (
          <div className="pwd-mgr-swaps">
            {pending.map(r => (
              <div key={r.id} className="pwd-mgr-swap">
                <div className="pwd-mgr-swap-top">
                  <span className="pwd-mgr-swap-ava">{initOf(r.staffId)}</span>
                  <div className="pwd-mgr-swap-info">
                    <b>{nameOf(r.staffId)} · {r.date}</b>
                    <span>{r.shift}{r.note ? ' · ' + r.note : ''}</span>
                  </div>
                </div>
                <div className="pwd-mgr-swap-acts">
                  <button className="pwd-btn-reject" onClick={() => act(r.id, 'rejected')}>拒絕</button>
                  <button className="pwd-btn-approve" onClick={() => act(r.id, 'approved')}>批准</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {done.length > 0 && (
        <div className="pwd-card pwd-block">
          <div className="pwd-eyebrow">已處理</div>
          <div className="pwd-mgr-swaps">
            {done.map(r => (
              <div key={r.id} className="pwd-mgr-swap done">
                <span className="pwd-mgr-swap-ava">{initOf(r.staffId)}</span>
                <div className="pwd-mgr-swap-info"><b>{nameOf(r.staffId)} · {r.date}</b><span>{r.shift}</span></div>
                <span className={'pwd-mgr-swap-status ' + r.status}>{r.status === 'approved' ? '已批准' : '已拒絕'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 請假 / 假期結餘 ──
function MgrLeave({ month, mgrData }) {
  const list = mgrData.staffList.filter(s => s.role !== 'manager');
  const [sel, setSel] = useState(list[0] ? list[0].id : null);
  const staff = list.find(s => s.id == sel);
  const b0 = mgrData.allLeaveBal[sel] || { annual: 0, statutory: 0, sick: 0 };
  const [bal, setBal] = useState({ annual: b0.annual, statutory: b0.statutory, sick: b0.sick });
  const [recs, setRecs] = useState(() => (mgrData.allLeaveRec[sel] || []).slice());
  const [type, setType] = useState('年假');
  const [date, setDate] = useState('');
  const [phs, setPhs] = useState(() => ((mgrData.allPH && mgrData.allPH[sel]) || []).slice());
  const [phName, setPhName] = useState('');
  const [phDate, setPhDate] = useState('');
  const [err, setErr] = useState('');
  function reseed(id) {
    const b = mgrData.allLeaveBal[id] || { annual: 0, statutory: 0, sick: 0 };
    setSel(id); setBal({ annual: b.annual, statutory: b.statutory, sick: b.sick });
    setRecs((mgrData.allLeaveRec[id] || []).slice()); setDate('');
    setPhs(((mgrData.allPH && mgrData.allPH[id]) || []).slice()); setPhName(''); setPhDate(''); setErr('');
  }
  // ⚠️ 2026-08-12 幽靈條目事故：呢版嘅寫入全部係樂觀更新，之前完全冇 check 後端回咩——
  // 授權過期(WRITE_GUARD 回「未授權」)照樣喺畫面加咗行，店長以為儲咗，一 reload 就無晒。
  // 同 2026-07-06「更表儲存唔到」係同一種病(嗰次只修咗 SaveBtn)。
  // 而家一律：失敗就縮返畫面 ＋ 顯示後端真實錯誤，做唔到一定睇得見。
  async function write(action, params, revert) {
    setErr('');
    return pwWrite(action, params, revert, setErr);   // 呢版用頂部紅字 banner，唔用 alert
  }
  const adj = (k, d) => setBal(b => ({ ...b, [k]: Math.max(0, +(b[k] + d).toFixed(1)) }));
  const fmtDate = (iso) => { const [, m, d] = iso.split('-'); return `${+m}月${+d}日`; };
  function saveBal() { return pwApi('saveLeave', { month, staffId: sel, annual: bal.annual, statutory: bal.statutory, sick: bal.sick }); }
  async function addRec() {
    if (!date) return;
    const ds = fmtDate(date), t = type, keep = date;
    setRecs(r => [...r, { date: ds, type: t }]);
    setDate('');
    await write('addLeaveRec', { month, staffId: sel, date: ds, type: t },
      () => { setRecs(r => r.filter(x => !(x.date === ds && x.type === t))); setDate(keep); });
  }
  async function delRec(rec, i) {
    setRecs(r => r.filter((_, j) => j !== i));
    await write('deleteLeaveRec', { month, staffId: sel, date: rec.date, type: rec.type },
      () => setRecs(r => { const c = r.slice(); c.splice(i, 0, rec); return c; }));
  }
  async function addPH() {
    if (!phName.trim() || !phDate) return;
    const nm = phName.trim(), ds = fmtDate(phDate), keep = phDate;
    setPhs(p => [...p, { name: nm, date: ds }]);
    setPhName(''); setPhDate('');
    await write('addPH', { month, staffId: sel, name: nm, date: ds },
      () => { setPhs(p => p.filter(x => !(x.name === nm && x.date === ds)));
              setPhName(nm); setPhDate(keep); });   // 打返嘅字唔好蒸發,即刻可以重試
  }
  // 「待放公眾假期」＝仲欠員工幾多日未放。放咗就撳 ✕ 移走，一個掣一句確認（老闆 2026-08-12 定）。
  // 唔另外寫請假記錄——之前試過分開「✓已放」同「✕刪除」兩個掣，店長覺得亂；而且一個掣
  // 就唔會出現「入錯想刪都製造咗假嘅放假記錄」呢個問題。
  async function delPH(p, i) {
    const who = staff ? staff.name : '該員工';
    if (!window.confirm('確認移走 ' + who + ' 嘅「' + p.name + ' ' + p.date + '」？\n\n即係已經放咗，或者入錯想刪。')) return;
    setPhs(arr => arr.filter((_, j) => j !== i));
    await write('deletePH', { month, staffId: sel, name: p.name, date: p.date },
      () => setPhs(arr => { const c = arr.slice(); c.splice(i, 0, p); return c; }));
  }
  return (
    <div className="pwd-mgr-stack">
      <div className="pwd-mgr-people">
        {list.map(s => (
          <button key={s.id} className={'pwd-mgr-person' + (sel == s.id ? ' on' : '')} onClick={() => reseed(s.id)}>
            <span className="pwd-mgr-person-ava">{s.initial}</span>{s.name}
          </button>
        ))}
      </div>
      {err && <div className="pwd-warn">⚠️ {err}</div>}
      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">{staff.name} · 假期結餘 (可調整)</div>
        <div className="pwd-leave-grid">
          {[ { key: 'annual', lbl: '尚餘年假', step: 1 }, { key: 'statutory', lbl: '例假結餘', step: 1 }, { key: 'sick', lbl: '累積有薪病假', step: 0.5 } ].map(c => (
            <div key={c.key} className="pwd-leave-cell">
              <div className="pwd-leave-cell-lbl">{c.lbl}</div>
              <div className="pwd-leave-edit">
                <button onClick={() => adj(c.key, -c.step)}>−</button>
                <span className="pwd-leave-val">{bal[c.key]}<i>日</i></span>
                <button onClick={() => adj(c.key, c.step)}>＋</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}><SaveBtn onSave={saveBal} label="儲存結餘" /></div>
      </div>
      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">登記請假</div>
        <div className="pwd-la-types" style={{ marginTop: 12 }}>
          {/* 「公眾假期」冇喺呢度（老闆 2026-08-12）：公眾假期唯一入口＝下面「待放公眾假期」，
              放咗就喺嗰度撳 ✕ 移走。兩個入口會令店長兩頭入變重複。
              .t-公眾假期 樣式保留，萬一有舊記錄照樣顯示到。 */}
          {['年假', '例假', '病假', '事假'].map(t => (
            <button key={t} className={'pwd-la-chip' + (type === t ? ' on' : '')} onClick={() => setType(t)}>{t}</button>
          ))}
        </div>
        <div className="pwd-la-daterow">
          <span className="pwd-la-datelbl">請假日期</span>
          <input className="pwd-la-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button className="pwd-la-confirm" style={{ marginTop: 12, width: '100%' }} disabled={!date} onClick={addRec}>
          ＋ 為 {staff.name} 登記{date ? ` ${fmtDate(date)} ` : ''}{type}
        </button>
        <div className="pwd-larec" style={{ marginTop: 14 }}>
          {recs.map((rec, i) => (
            <div key={i} className="pwd-larec-row">
              <span className={'pwd-larec-type t-' + rec.type}>{rec.type}</span>
              <span className="pwd-larec-date">{rec.date}</span>
              <button className="pwd-larec-del" onClick={() => delRec(rec, i)}>✕</button>
            </div>
          ))}
        </div>
      </div>
      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">待放公眾假期 (員工頁顯示)</div>
        <div className="pwd-club-frow" style={{ marginTop: 12 }}>
          <input className="pwd-club-input" placeholder="假期名稱(例:勞動節)" value={phName} onChange={(e) => setPhName(e.target.value)} />
          <input className="pwd-la-date" type="date" value={phDate} onChange={(e) => setPhDate(e.target.value)} />
        </div>
        <button className="pwd-la-confirm" style={{ marginTop: 12, width: '100%' }} disabled={!phName.trim() || !phDate} onClick={addPH}>
          ＋ 為 {staff.name} 登記待放公眾假期
        </button>
        <div className="pwd-larec" style={{ marginTop: 14 }}>
          {phs.map((p, i) => (
            <div key={i} className="pwd-larec-row">
              <span className="pwd-larec-type">🎌 {p.name}</span>
              <span className="pwd-larec-date">{p.date}</span>
              <button className="pwd-larec-del" onClick={() => delPH(p, i)}>✕</button>
            </div>
          ))}
          {phs.length === 0 && <div className="pwd-ph-empty">未有登記待放公眾假期</div>}
        </div>
      </div>
    </div>
  );
}

// ── 排更 ──
function MgrRoster({ mgrData }) {
  const list = mgrData.staffList;
  const [sel, setSel] = useState(list[0] ? list[0].id : null);
  const [weekStart, setWeekStart] = useState(() => mgrData.weekStart); // 由本週開始,用左右鍵自由揭週次
  const [shifts, setShifts] = useState(() => weekStart === mgrData.weekStart && mgrData.allRosters[sel] ? normWeek(mgrData.allRosters[sel]) : null);
  const [savedShifts, setSavedShifts] = useState(() => weekStart === mgrData.weekStart && mgrData.allRosters[sel] ? normWeek(mgrData.allRosters[sel]) : DEFAULT_WEEK());
  const [loading, setLoading] = useState(false);
  const SHIFT_CYCLE = ['early', 'mid', 'full', 'off'];
  const SHIFT_LABEL = { early: '早更', mid: '午更', full: '全日更', off: '休息' };
  const POS_LABEL = { academyA: '學院A位', academyB: '學院B位', assist: '助教', hotelA: '酒店A位', hotelB: '酒店B位', hotelC: '酒店C位', academy: '學院', reception: '前台' };

  // 載入所選員工 + 所選週次嗀更表
  useEffect(() => {
    let active = true;
    setLoading(true);
    pwApi('rosterWeek', { staffId: sel, weekStart }).then(res => {
      if (!active) return;
      const w = res && res.ok ? normWeek(res.shifts) : DEFAULT_WEEK();
      setShifts(w); setSavedShifts(w);
      setLoading(false);
    }).catch(() => { if (active) { setShifts(DEFAULT_WEEK()); setSavedShifts(DEFAULT_WEEK()); setLoading(false); } });
    return () => { active = false; };
  }, [sel, weekStart]);

  const cur = normWeek(shifts || DEFAULT_WEEK());
  const dates = datesFromWeekStart(weekStart);
  const setDay = (i, shift, pos) => {
    setShifts(prev => {
      const next = normWeek(prev || DEFAULT_WEEK());
      next[i] = [shift, shift === 'off' ? null : pos];
      return next;
    });
  };
  async function save() {
    const r = await pwApi('saveRoster', { weekStart, staffId: sel, shifts: JSON.stringify(cur) });
    // 只有真係寫入咗先當已儲存——否則「未儲存」提示會喺失敗時消失，睇落好似儲好咗
    if (r && r.ok !== false) setSavedShifts(cur);
    return r;   // SaveBtn 會顯示後端真實錯誤
  }
  const unsaved = JSON.stringify(cur) !== JSON.stringify(savedShifts);
  return (
    <div className="pwd-mgr-stack">
      <div className="pwd-mgr-people">
        {list.map(s => (
          <button key={s.id} className={'pwd-mgr-person' + (sel == s.id ? ' on' : '')} onClick={() => setSel(s.id)}>
            <span className="pwd-mgr-person-ava">{s.initial}</span>{s.name}
          </button>
        ))}
      </div>
      {unsaved && <div className="pwd-mgr-rostersave" style={{ color: 'var(--pw-gold-deep)', fontWeight: 800 }}>⚠ 未發佈 — 記得撳下面「發佈本週排更」先會存入系統</div>}
      <div className="pwd-card pwd-block">
        <div className="pwd-roster-weeknav">
          <button className="pwd-weeknav-btn" onClick={() => setWeekStart(w => shiftWeekStart(w, -1))}>◀ 上週</button>
          <div className="pwd-weeknav-label">{weekRangeLabel(weekStart)}</div>
          <button className="pwd-weeknav-btn" onClick={() => setWeekStart(w => shiftWeekStart(w, 1))}>下週 ▶</button>
        </div>
        {loading ? <div className="pwd-loading-txt" style={{ color: 'var(--pw-ink-mute)', padding: '20px 0' }}>載入更表…</div> : (
        <div className="pwd-duty" style={{ marginTop: 14 }}>
          {WEEKDAYS.map((wd, i) => {
            const r = cur[i] || ['off', null];
            const off = r[0] === 'off';
            return (
              <div key={i} className={'pwd-duty-row' + (off ? ' off' : '')}>
                <div className="pwd-duty-date"><span className="pwd-duty-wd">{wd}</span><span className="pwd-duty-num">{dates[i]}</span></div>
                <div className="pwd-mgr-selwrap">
                  <select className="pwd-mgr-sel" value={r[0]} onChange={(e) => setDay(i, e.target.value, r[1])}>
                    {SHIFT_CYCLE.map(k => <option key={k} value={k}>{SHIFT_LABEL[k]}</option>)}
                  </select>
                </div>
                <div className="pwd-mgr-selwrap">
                  <select className={'pwd-mgr-sel pos' + (r[1] ? ' sh-' + ((POSITIONS[r[1]] && POSITIONS[r[1]].cls) || r[1]) : '')} value={r[1] || ''} disabled={off} onChange={(e) => setDay(i, r[0], e.target.value || null)}>
                    {off ? <option value="">—</option> : [
                      <option key="none" value="">未定崗</option>,
                      ...['academyA', 'academyB', 'assist', 'hotelA', 'hotelB', 'hotelC'].map(k => <option key={k} value={k}>{POS_LABEL[k]}</option>),
                    ]}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
      <SaveBtn onSave={save} label="發佈本週排更" />
      <div className="pwd-mgr-rostersave">發佈後員工即時看到</div>
    </div>
  );
}

// ── 會籍提名審批 ──
function MgrClub({ mgrData }) {
  const nameOf = (id) => { const s = mgrData.staffList.find(x => x.id == id); return s ? s.name : id; };
  const initOf = (id) => { const s = mgrData.staffList.find(x => x.id == id); return s ? s.initial : '?'; };
  const [noms, setNoms] = useState(() => mgrData.allNoms.map(n => ({ ...n })));
  // 審批失敗要回滾——呢度改嘅係佣金依據（入會獎金按 subscribed 計），唔可以畫面同 sheet 唔一致
  const revertNom = (id, prev) => () => setNoms(l => l.map(n => n.id === id ? { ...n, ...prev } : n));
  async function set(id, status) {
    const p = noms.find(n => n.id === id) || {};
    setNoms(l => l.map(n => n.id === id ? { ...n, status } : n));
    await pwWrite('approveNom', { nomId: id, status }, revertNom(id, { status: p.status, tier: p.tier }));
  }
  async function setTier(id, tier) {
    const p = noms.find(n => n.id === id) || {};
    setNoms(l => l.map(n => n.id === id ? { ...n, tier, status: 'subscribed' } : n));
    await pwWrite('approveNom', { nomId: id, tier, status: 'subscribed' }, revertNom(id, { status: p.status, tier: p.tier }));
  }
  const pending = noms.filter(n => n.status === 'pending');
  const approved = noms.filter(n => n.status === 'approved');
  const closed = noms.filter(n => n.status === 'subscribed' || n.status === 'rejected');
  const totalBonus = noms.filter(n => n.status === 'subscribed' && n.tier).reduce((a, n) => a + CLUB_TIERS[n.tier].bonus, 0);
  const NomLine = ({ n }) => {
    const t = n.tier ? CLUB_TIERS[n.tier] : null;
    return (
      <div className="pwd-mgr-swap-top">
        <span className="pwd-mgr-swap-ava">{initOf(n.staffId)}</span>
        <div className="pwd-mgr-swap-info">
          <b>{n.dog}{t ? <> · {t.label}</> : ''}</b>
          <span>提名人 {nameOf(n.staffId)}{n.phone ? ` · 電話 ${n.phone}` : ''}</span>
        </div>
      </div>
    );
  };
  return (
    <div className="pwd-mgr-stack">
      <div className="pwd-card pwd-mgr-preview">
        <div className="pwd-eyebrow">本月會籍佣金</div>
        <div className="pwd-mgr-preview-num">待定</div>
        <div className="pwd-mgr-preview-sub">已成功訂閱 {noms.filter(n => n.status === 'subscribed').length} 個 · 佣金待收集 1–2 個月數據後安排</div>
      </div>
      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">待審批提名 ({pending.length})</div>
        {pending.length === 0 ? <div className="pwd-ph-empty" style={{ marginTop: 12 }}>沒有待審批的提名</div> : (
          <div className="pwd-mgr-swaps">
            {pending.map(n => (
              <div key={n.id} className="pwd-mgr-swap">
                <NomLine n={n} />
                <div className="pwd-mgr-swap-acts">
                  <button className="pwd-btn-reject" onClick={() => set(n.id, 'rejected')}>拒絕</button>
                  <button className="pwd-btn-approve" onClick={() => set(n.id, 'approved')}>批准提名</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {approved.length > 0 && (
        <div className="pwd-card pwd-block">
          <div className="pwd-eyebrow">已批准 · 待客戶訂閱 ({approved.length})</div>
          <div className="pwd-club-mgr-hint">主人訂閱後揀選對應方案記錄；會籍佣金待收集 1–2 個月數據後安排</div>
          <div className="pwd-mgr-swaps">
            {approved.map(n => (
              <div key={n.id} className="pwd-mgr-swap">
                <NomLine n={n} />
                <div className="pwd-club-tierconfirm">
                  {Object.values(CLUB_TIERS).map(t => (
                    <button key={t.key} className="pwd-club-tierconfirm-btn" onClick={() => setTier(n.id, t.key)}>{t.label}<i>${t.fee}/月</i></button>
                  ))}
                </div>
                <button className="pwd-club-mgr-cancel" onClick={() => set(n.id, 'rejected')}>取消提名</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {closed.length > 0 && (
        <div className="pwd-card pwd-block">
          <div className="pwd-eyebrow">已處理</div>
          <div className="pwd-mgr-swaps">
            {closed.map(n => {
              const t = n.tier ? CLUB_TIERS[n.tier] : null;
              return (
                <div key={n.id} className="pwd-mgr-swap done">
                  <span className="pwd-mgr-swap-ava">{initOf(n.staffId)}</span>
                  <div className="pwd-mgr-swap-info"><b>{n.dog}{t ? ` · ${t.label}` : ''}</b><span>{nameOf(n.staffId)}{n.phone ? ` · ${n.phone}` : ''}</span></div>
                  <span className={'pwd-mgr-swap-status ' + (n.status === 'subscribed' ? 'approved' : 'rejected')}>
                    {n.status === 'subscribed' && t ? `已訂閱 · ${t.label}` : '已拒絕'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ManagerGate ──
function ManagerGate({ onUnlock, action = 'verifyMgr', title = '團隊管理 · 需要管理密碼', sub = '高敏感操作 · 請輸入只有店長 / 老闆知道的管理密碼' }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const LEN = 6;
  async function check(code) {
    setBusy(true);
    try {
      const res = await pwApi(action, { passcode: code });
      if (res.ok) {
        PW_KEY = code; onUnlock();
        // [2026-09-06 老闆嫌次次入] 解鎖後記住管理密碼；「🔒 鎖定」或登出先清。
        // 密碼如果之後改咗，記住嗰條 key 寫入時後端會回「未授權」，pwWrite 會指引重新解鎖。
        try { localStorage.setItem('pw_mgr_key', code); } catch (e) {}
      }
      else { setErr(true); setPin(''); }
    } catch (e) { setErr(true); setPin(''); }
    setBusy(false);
  }
  function tap(d) {
    if (busy) return;
    if (d === 'del') { setErr(false); return setPin(p => p.slice(0, -1)); }
    if (pin.length >= LEN) return;
    const next = pin + d;
    setErr(false); setPin(next);
    if (next.length === LEN) setTimeout(() => check(next), 150);
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <div className="pwd-mgrgate">
      <div className="pwd-mgrgate-lock">🔒</div>
      <div className="pwd-mgrgate-title">{title}</div>
      <div className="pwd-mgrgate-sub">{sub}</div>
      <div className={'pwd-mgrgate-dots' + (err ? ' err' : '')}>
        {Array.from({ length: LEN }).map((_, i) => <span key={i} className={'pwd-mgrgate-dot' + (pin.length > i ? ' on' : '')} />)}
      </div>
      {err && <div className="pwd-mgrgate-err">密碼錯誤,請重試</div>}
      <div className="pwd-mgrgate-keypad">
        {keys.map((k, i) => k === '' ? <span key={i} /> : (
          <button key={i} className={'pwd-mgrgate-key' + (k === 'del' ? ' del' : '')} onClick={() => tap(k)}>{k === 'del' ? '⌫' : k}</button>
        ))}
      </div>
    </div>
  );
}

// ═══════════ SeatsPanel（2026-08-25，「學位」分頁：S1/Club 名額 + 候補名單）═══════════
// 老闆定案：所有導師都睇到（唔設密碼），登記候補都唔設密碼（導師自己篩選）；
// 淨係「改狀態」（邀請/加入/謝絕）先要店長密碼（同 mgr/owner tab 共用返 mgrUnlocked 狀態）。
// [2026-08-26 老闆定] Light/Active Explorer 暫時唔設cap，候補登記唔使呢個選項
// （得 S1／Ultimate 先會爆滿，先需要候補）。
const WAITLIST_DEPTS = { S1: '幼稚園 (S1)', ULTIMATE: 'Ultimate Explorer' };
const WAITLIST_STATUS_FLOW = ['候補中', '已邀請', '已加入', '已謝絕'];
function QuotaBar({ label, data, unitLabel, capped }) {
  const pct = capped ? Math.min(100, Math.round((data.active / data.quota) * 100)) : null;
  return (
    <>
      <div className="pwd-eyebrow" style={{ marginTop: 18 }}>{label}</div>
      <div className="pwd-mgr-result-num" style={{ marginTop: 6, fontSize: capped ? undefined : 22 }}>
        {capped ? `${data.active} / ${data.quota}` : `${data.active} ${unitLabel || ''}`}
      </div>
      {capped && (
        <>
          <div className="pwd-roster-sum" style={{ marginTop: 10 }}>
            <span>{data.full ? '🔴 已滿，新登記請落候補' : `尚餘 ${data.remaining} 個位`}</span>
          </div>
          <div style={{ height: 8, background: 'var(--pw-cream-deep)', borderRadius: 999, marginTop: 12, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: pct + '%', background: data.full ? '#C0524A' : 'var(--pw-navy)', transition: 'width .3s' }} />
          </div>
        </>
      )}
    </>
  );
}
function SeatStatusCard({ status }) {
  if (!status) return null;
  return (
    <div className="pwd-card pwd-block">
      <QuotaBar label="幼稚園 (S1) 學位" data={status.s1} capped={true} />
      <QuotaBar label="Ultimate Explorer 會籍" data={status.ultimate} capped={true} />
      <div className="pwd-eyebrow" style={{ marginTop: 18 }}>Calm Explorer Club（全部層級）</div>
      <div className="pwd-mgr-result-num" style={{ marginTop: 6, fontSize: 22 }}>{status.club.members} 位會員</div>
      <div className="pwd-tr-hint" style={{ marginTop: 6 }}>Light / Active Explorer 暫時不設上限。</div>
    </div>
  );
}
function WaitlistAddForm({ staffId, onAdded }) {
  const [dept, setDept] = useState('S1');
  const [dogName, setDogName] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [district, setDistrict] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit() {
    if (!dogName.trim() || busy) return;
    setBusy(true); setMsg('');
    const r = await pwApi('waitlistAdd', { dept, dogName: dogName.trim(), phone: phone.trim(), ownerName: ownerName.trim(), district: district.trim(), note: note.trim(), staffId });
    setBusy(false);
    if (r && r.ok) {
      setDogName(''); setPhone(''); setOwnerName(''); setDistrict(''); setNote('');
      setMsg('已加入候補名單。'); onAdded();
    } else setMsg((r && r.error) || '登記失敗');
  }
  return (
    <div className="pwd-card pwd-block">
      <div className="pwd-eyebrow">新增候補登記</div>
      <div className="pwd-view-toggle" style={{ marginTop: 10 }}>
        {Object.keys(WAITLIST_DEPTS).map(k => (
          <button key={k} className={dept === k ? 'on' : ''} onClick={() => setDept(k)}>{WAITLIST_DEPTS[k]}</button>
        ))}
      </div>
      <div className="pwd-tr-row" style={{ marginTop: 10 }}>
        <input className="pwd-tr-input" placeholder="狗狗名稱" value={dogName} onChange={e => setDogName(e.target.value)} />
        <input className="pwd-tr-input" type="tel" inputMode="tel" placeholder="家長電話" value={phone} onChange={e => setPhone(e.target.value)} />
      </div>
      <div className="pwd-tr-row">
        <input className="pwd-tr-input" placeholder="家長姓名" value={ownerName} onChange={e => setOwnerName(e.target.value)} />
        <input className="pwd-tr-input" placeholder="地區（填具體地點，例：太古城／將軍澳，唔好淨係填港島／九龍／新界）" value={district} onChange={e => setDistrict(e.target.value)} />
      </div>
      <div className="pwd-tr-row">
        <input className="pwd-tr-input" placeholder="備註（可留空）" value={note} onChange={e => setNote(e.target.value)} />
      </div>
      {msg && <div className="pwd-tr-hint" style={{ color: 'var(--pw-navy-deep)' }}>{msg}</div>}
      <div className="pwd-club-formacts">
        <span className="pwd-tr-sub">&nbsp;</span>
        <button className="pwd-la-confirm" disabled={!dogName.trim() || busy} onClick={submit}>{busy ? '登記中…' : '加入候補'}</button>
      </div>
    </div>
  );
}
// [2026-08-26] dept 顏色：S1 用返學院金色徽章，Ultimate 用返紫色徽章（兩個都係
//   app 現有色，一眼分得到邊個部門，唔使加新CSS）。
const WAITLIST_DEPT_CLS = { S1: 'sh-academy', ULTIMATE: 'sh-hotelC' };
function DeptBadge({ dept }) {
  return <span className={'pwd-duty-pos ' + (WAITLIST_DEPT_CLS[dept] || 'sh-academy')}>{WAITLIST_DEPTS[dept] || dept}</span>;
}
function WaitlistTable({ items, onUpdate, onDelete }) {
  if (!items) return null;
  const active = items.filter(x => x.status === '候補中' || x.status === '已邀請');
  const done = items.filter(x => x.status === '已加入' || x.status === '已謝絕');
  return (
    <div className="pwd-card pwd-block">
      <div className="pwd-eyebrow">候補名單（{active.length}）· 按登記次序排</div>
      {active.length === 0 && <div className="pwd-tr-hint" style={{ marginTop: 8 }}>暫時冇人候補。</div>}
      {active.length > 0 && (
        <div className="pwd-tr-list" style={{ marginTop: 4 }}>
          {active.map(x => (
            <div key={x.id} className="pwd-tr-item">
              <div className="pwd-tr-item-i">
                <b><DeptBadge dept={x.dept} /> {x.dog}{x.phone ? <span className="pwd-club-nom-owner"> · {x.phone}</span> : null}</b>
                <span>{x.owner || '（未填家長姓名）'}{x.district ? ' · ' + x.district : ''} · {x.status}{x.note ? ' · ' + x.note : ''}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {x.status === '候補中' && <button className="pwd-tr-x" onClick={() => onUpdate(x.id, '已邀請')}>已邀請</button>}
                <button className="pwd-tr-x" onClick={() => onUpdate(x.id, '已加入')}>已加入</button>
                <button className="pwd-tr-x" onClick={() => onUpdate(x.id, '已謝絕')}>謝絕</button>
                <button className="pwd-tr-x" onClick={() => onDelete(x.id)}>刪除</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <>
          <div className="pwd-eyebrow" style={{ marginTop: 18 }}>歷史（{done.length}）</div>
          <div className="pwd-tr-list">
            {done.map(x => (
              <div key={x.id} className="pwd-tr-item">
                <div className="pwd-tr-item-i">
                  <b><DeptBadge dept={x.dept} /> {x.dog}</b>
                  <span>{x.status}</span>
                </div>
                <button className="pwd-tr-x" onClick={() => onDelete(x.id)}>刪除</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
// [2026-08-26 老闆改口] 唔再要店長解鎖先改到候補狀態——導師自己有齊權限。
function SeatsPanel({ staffId }) {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState(null);
  async function loadAll() {
    const [s, w] = await Promise.all([pwApi('seatStatus', {}), pwApi('waitlistList', {})]);
    if (s && s.ok) setStatus(s); else setStatus(null);
    if (w && w.ok) setItems(w.items); else setItems([]);
  }
  useEffect(() => { loadAll(); }, []);
  async function updateStatus(id, newStatus) {
    const ok = await pwWrite('waitlistUpdate', { id, status: newStatus });
    if (ok) loadAll();
  }
  async function deleteEntry(id) {
    const ok = await pwWrite('waitlistDelete', { id });
    if (ok) loadAll();
  }
  if (!status && !items) return <div className="pwd-loading" style={{ minHeight: 200, background: 'transparent' }}><div className="pwd-spinner" /><div className="pwd-loading-txt" style={{ color: 'var(--pw-ink-mute)' }}>載入學位數據…</div></div>;
  return (
    <>
      <SeatStatusCard status={status} />
      <WaitlistAddForm staffId={staffId} onAdded={loadAll} />
      <WaitlistTable items={items} onUpdate={updateStatus} onDelete={deleteEntry} />
    </>
  );
}

// ── 老闆評核店長 KPI ──
function OwnerKpiEditor({ month, mgrData, mgr }) {
  const k0 = mgrData.allKpi[mgr.id] || { kpiFail: [], lateLeave: 0 };
  const [fail, setFail] = useState(() => k0.kpiFail.slice());
  const [lateLeave, setLate] = useState(k0.lateLeave || 0);
  const att = (mgrData.allAttendance && mgrData.allAttendance[mgr.id] != null) ? mgrData.allAttendance[mgr.id] : 0;
  const items = buildScorecard('manager', fail);
  const { calc, kpi } = fullResult({ ...mgr, attendance: att, kpiFail: fail, lateLeave }, mgrData.team, { scorecard: items, lateLeave });
  const score = scorecardTotal(items);
  const tone = kpi.ratio >= 1 ? 'full' : kpi.ratio > 0 ? 'mid' : 'zero';
  const toggle = (id) => setFail(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]);
  function save() { return pwApi('saveKpi', { month, staffId: mgr.id, lateLeave, kpiFail: fail.join(',') }); }
  return (
    <div className="pwd-mgr-stack">
      <div className="pwd-mgr-banner"><span className="pwd-mgr-banner-ico">🔑</span><div><b>老闆評核店長</b><span>{mgr.name} · 店長 KPI</span></div></div>
      <div className="pwd-card pwd-block">
        <div className="pwd-kpi-head">
          <div>
            <div className="pwd-eyebrow">店長 KPI 評核</div>
            <div className="pwd-kpi-band">發放比例 <b className={'r-' + tone}>{Math.round(kpi.ratio * 100)}%</b> · {kpi.band}</div>
          </div>
          <div className={'pwd-kpi-score r-' + tone}><span className="n">{score}</span><span className="d">分</span></div>
        </div>
        <div className="pwd-kpi-items">
          {items.map(it => (
            <button key={it.id} className={'pwd-kpi-item edit' + (it.pass ? ' pass' : ' fail')} onClick={() => toggle(it.id)}>
              <span className="pwd-kpi-check">{it.pass ? '✓' : '✕'}</span>
              <span className="pwd-kpi-text">{it.text}{it.team && <em className="pwd-kpi-team">團隊</em>}</span>
              <span className="pwd-kpi-w">{it.weight}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pwd-card pwd-mgr-late">
        <div className="pwd-mgr-late-row">
          <div><b>當月遲到 / 請假次數</b><span>超過 3 次 → KPI 直接為 0</span></div>
          <Stepper value={lateLeave} suffix="次" onChange={setLate} />
        </div>
        {lateLeave > 3 && <div className="pwd-warn" style={{ marginTop: 12 }}>已超過 3 次 — {mgr.name} 本月 KPI 將為 0</div>}
      </div>
      <div className="pwd-card pwd-mgr-result">
        <div className="pwd-eyebrow">{mgr.name} 本月實際領取</div>
        <div className="pwd-mgr-result-num">{money(kpi.actualTotal)}</div>
        <div className="pwd-mgr-result-sub">店長佣金 {money(calc.total)} × {Math.round(kpi.ratio * 100)}% 發放</div>
      </div>
      <SaveBtn onSave={save} label={`儲存 ${mgr.name} 的評核`} />
    </div>
  );
}
function MgrOwnerKpi({ month, mgrData }) {
  const [unlocked, setUnlocked] = useState(false);
  const mgr = mgrData.staffList.find(s => s.role === 'manager');
  if (!mgr) return <div className="pwd-ph-empty" style={{ marginTop: 20 }}>未有店長資料</div>;
  if (!unlocked) return <ManagerGate action="verifyOwner" title="評核店長 · 需要老闆密碼" sub="只有老闆可評核店長 KPI · 請輸入老闆密碼" onUnlock={() => setUnlocked(true)} />;
  return <OwnerKpiEditor month={month} mgrData={mgrData} mgr={mgr} />;
}

// ═══════════ OwnerOverview（2026-08-25，老闆專屬簡易總覽）═══════════
// 老闆要求（2026-09-06 更新）：唔重複放更表（另有位置睇），淨係要數據——
// ①各部門業績 ②員工佣金 ③試堂登記摘要。
// 唔重用店長嗰套（MgrOps/MgrKpi 係逐格輸入嘅表格，唔係唯讀摘要），起返獨立卡。
function OwnerDeptRevenue({ team }) {
  const rows = [
    { label: '酒店業績', val: team.hotelRevenue || 0 },
    { label: '學院業績', val: team.academyRevenue || 0 },
    { label: '基本美容', val: team.groomBasic || 0 },
    { label: '星級美容', val: team.groomStar || 0 },
    { label: '接送', val: team.pickup || 0 },
    { label: '套票', val: team.packageRevenue || 0 },
    { label: '其他', val: team.other || 0 },
  ];
  const total = rows.reduce((a, r) => a + r.val, 0);
  return (
    <div className="pwd-card pwd-block">
      <div className="pwd-eyebrow">{team.month} 各部門業績</div>
      <div className="pwd-ledger" style={{ marginTop: 8 }}>
        {rows.map(r => (
          <div key={r.label} className="pwd-led-row"><span className="pwd-led-lbl">{r.label}</span><span className="pwd-led-val">{money(r.val)}</span></div>
        ))}
        <div className="pwd-led-row total"><span className="pwd-led-lbl">合計</span><span className="pwd-led-val">{money(total)}</span></div>
      </div>
    </div>
  );
}
function OwnerCommissionTable({ mgrData }) {
  const team = mgrData.team;
  const poolStaff = mgrData.staffList.filter(s => s.role !== 'manager' && s.role !== 'frontdesk' && s.role !== 'owner' && s.dept !== 'academy');
  const teamForCalc = { ...team, acadWeightTotal: ACAD_WEIGHT_TOTAL, headcount: poolStaff.length || HEADCOUNT };
  const rows = mgrData.staffList.filter(s => s.role !== 'owner').map(s => {
    const k = mgrData.allKpi[s.id] || { kpiFail: [], lateLeave: 0 };
    const att = (mgrData.allAttendance && mgrData.allAttendance[s.id] != null) ? mgrData.allAttendance[s.id] : 0;
    // 個人新生數(allSales)＋會籍獎金要入埋,先同員工個人頁/月結引擎一條數(2026-09-02 修)
    const sales = (mgrData.allSales && mgrData.allSales[s.id]) || {};
    const { kpi } = fullResult({ ...s, ...sales, attendance: att, kpiFail: k.kpiFail, lateLeave: k.lateLeave }, teamForCalc);
    const club = clubBonusFor(s, mgrData.allNoms, team.monthKey || '');
    return { name: s.name, role: s.role, amt: kpi.actualTotal + club };
  }).sort((a, b) => b.amt - a.amt);
  const total = rows.reduce((a, r) => a + r.amt, 0);
  return (
    <div className="pwd-card pwd-block">
      <div className="pwd-eyebrow">{team.month} 員工佣金（預估，實際以月結為準）</div>
      <div className="pwd-ledger" style={{ marginTop: 8 }}>
        {rows.map(r => (
          <div key={r.name} className="pwd-led-row"><span className="pwd-led-lbl">{r.name}{r.role === 'manager' ? ' · 店長' : ''}</span><span className="pwd-led-val">{money(r.amt)}</span></div>
        ))}
        <div className="pwd-led-row total"><span className="pwd-led-lbl">合計</span><span className="pwd-led-val">{money(total)}</span></div>
      </div>
    </div>
  );
}
// 試堂登記摘要（唯讀）：即將到來＋最近 14 日完成＋未來 45 日剩餘名額。
// 數據直接用 dash 現有嘅 trialSlots/trialBookings/trialDone，唔另外打 API。
function OwnerTrialSummary({ slots, bookings, done }) {
  const upcoming = bookings || [];
  const doneList = done || [];
  const totalLeft = (slots || []).reduce((a, s) => a + s.remaining, 0);
  return (
    <div className="pwd-card pwd-block">
      <div className="pwd-tr-head">
        <div>
          <div className="pwd-eyebrow">試堂登記</div>
          <div className="pwd-tr-sub">唯讀摘要 · 登記/取消喺員工個人頁做</div>
        </div>
        <div className="pwd-club-earned">未來仲有<b>{totalLeft}</b></div>
      </div>
      <div className="pwd-tr-list">
        <div className="pwd-club-list-lbl">即將到來嘅試堂 ({upcoming.length})</div>
        {upcoming.length === 0 && <div className="pwd-tr-hint">暫時冇未來試堂登記。</div>}
        {upcoming.map(b => (
          <div key={b.id} className="pwd-tr-item">
            <div className="pwd-tr-item-i">
              <b>{b.dog}{b.phone ? <span className="pwd-club-nom-owner"> · {b.phone}</span> : null}</b>
              <span>{b.label}</span>
            </div>
          </div>
        ))}
      </div>
      {doneList.length > 0 && (
        <div className="pwd-tr-list">
          <div className="pwd-club-list-lbl">最近完成嘅試堂 · 14 日內 ({doneList.length})</div>
          {doneList.map(d => (
            <div key={d.id} className="pwd-tr-item">
              <div className="pwd-tr-item-i">
                <b>{d.dog}{d.phone ? <span className="pwd-club-nom-owner"> · {d.phone}</span> : null}</b>
                <span>{d.label}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function OwnerOverview({ dash, mgrUnlocked, mgrData, onUnlock }) {
  if (!mgrUnlocked) return <ManagerGate action="verifyOwner" title="老闆總覽 · 需要老闆密碼" sub="請輸入老闆密碼" onUnlock={onUnlock} />;
  if (!mgrData) return <div className="pwd-loading" style={{ minHeight: 200, background: 'transparent' }}><div className="pwd-spinner" /><div className="pwd-loading-txt" style={{ color: 'var(--pw-ink-mute)' }}>載入管理數據…</div></div>;
  return (
    <>
      <OwnerDeptRevenue team={mgrData.team} />
      <OwnerCommissionTable mgrData={mgrData} />
      <OwnerTrialSummary slots={dash.trialSlots} bookings={dash.trialBookings} done={dash.trialDone} />
    </>
  );
}

// ── 清潔突擊檢查（2026-09-05 老闆批）──
// 項目同標準對齊《清潔突擊檢查表》PDF（內部文件/人事薪酬/KPI/），改項目要兩邊同步。
// 判定規則（前端顯示用；正式結果後端重算）：✗ 超過 3 項＝不合格。
const CLEAN_CHECKLISTS = {
  '酒店部': { icon: '🏨', hint: '於下午時段突擊檢查 · 不作預先通知', groups: [
    { name: 'A. 房間', hint: '隨機抽查 3 間，優先抽查當日有狗隻入住之房間', items: [
      ['房間地面', '無毛髮、無污漬水漬'],
      ['房間玻璃', '無鼻印指印水印（濕布後乾布抹淨）'],
      ['房間排泄物', '房內無任何排泄物殘留'],
    ] },
    { name: 'B. 天台', hint: '狗隻如廁區', items: [
      ['天台地面', '已沖洗，無排泄物殘留'],
      ['水喉', '使用後放置於盤內'],
    ] },
    { name: 'C. 廚房／餐具', items: [
      ['食碗', '已清洗並疊放整齊，無殘渣油漬'],
      ['備餐位', '檯面乾淨，無隔夜食物'],
      ['雪櫃', '無存放過期食物'],
    ] },
    { name: 'D. 公共位', items: [
      ['尿板', '已清洗，無尿垢、無異味'],
      ['水碗', '盛有清水，碗身無黏滑感、無殘渣'],
      ['器材用品', '使用後歸回原位，無散落'],
      ['活動區地面', '乾淨無毛髮、無水漬'],
      ['公眾地方地面', '𨋢口、樓梯等地面乾淨，無毛髮'],
      ['氣味', '無明顯異味'],
      ['垃圾', '已傾倒，無滿溢並已套袋'],
      ['拖地水', '已傾倒及更換，無過夜污水'],
    ] },
  ] },
  '學院部': { icon: '🎓', hint: '於晚間下課後時段突擊檢查 · 不作預先通知', groups: [
    { name: 'A. 課室', items: [
      ['課室地面', '無毛髮、無尿漬水漬'],
      ['課室氣味', '課室中央停留 5 秒，無明顯異味'],
    ] },
    { name: 'B. 教具', hint: '隨機抽查 3 件，以狗隻會以口接觸者為優先', items: [
      ['教具衛生', '無食物殘渣、無異味、無黏漬'],
      ['物資收納', '所有物資根據標籤收納妥當'],
      ['教具水碗', '盛有清水，碗身無黏滑感、無殘渣'],
    ] },
    { name: 'C. 休息區', hint: '包括休息房間，標準與酒店部相同', items: [
      ['休息區地面', '無毛髮、無污漬水漬'],
      ['休息區玻璃', '無鼻印指印水印'],
      ['休息區排泄物', '無任何排泄物殘留'],
    ] },
    { name: 'D. 設備', items: [
      ['圍欄／分隔板', '穩固無鬆動，表面乾淨無污跡'],
      ['16樓雪櫃', '內外乾淨，無存放過期食物'],
    ] },
    { name: 'E. 學校門口', items: [
      // [2026-09-06 老闆定] 唔查「無垃圾」——晚間垃圾會暫放防煙門側等收，屬正常運作
      ['學校門口', '地面無毛髮毛球'],
    ] },
  ] },
};

function MgrCleanCheck() {
  const [dept, setDept] = useState('酒店部');
  const [marks, setMarks] = useState({});
  const [inspector, setInspector] = useState('');
  const [onDuty, setOnDuty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [records, setRecords] = useState(null);
  const [openId, setOpenId] = useState(null);

  async function loadRecords() {
    try {
      const r = await pwApi('cleanCheckList');
      if (r.ok) setRecords(r.items);
    } catch (e) { /* 記錄載入失敗唔阻提交，下面顯示提示 */ }
  }
  useEffect(() => { loadRecords(); }, []);

  const conf = CLEAN_CHECKLISTS[dept];
  const allItems = conf.groups.flatMap(gr => gr.items.map(it => it[0]));
  const filled = allItems.filter(k => marks[k]).length;
  const failCount = allItems.filter(k => marks[k] === '✗').length;
  const isFail = failCount > 3;
  const allFilled = filled === allItems.length;

  function setMark(k, v) {
    setSavedMsg('');
    setMarks(m => ({ ...m, [k]: m[k] === v ? '' : v }));
  }
  function switchDept(d) {
    if (d === dept) return;
    if (filled > 0 && !window.confirm('切換部門將清除未提交之選項，確定？')) return;
    setDept(d); setMarks({}); setSavedMsg('');
  }
  // [2026-09-05 老闆定] 唔設「全部✓」快捷掣——避免員工未檢查就一鍵剔晒，逐項必須人手填
  async function submit() {
    if (!inspector.trim()) { window.alert('請輸入檢查人'); return; }
    if (!allFilled) { window.alert('尚有 ' + (allItems.length - filled) + ' 項未填'); return; }
    const payload = {};
    allItems.forEach(k => { payload[k] = marks[k]; });
    setSaving(true);
    const ok = await pwWrite('cleanCheckSave', {
      dept: dept, inspector: inspector.trim(), onDuty: onDuty.trim(),
      items: JSON.stringify(payload), note: note.trim(),
    });
    setSaving(false);
    if (ok) {
      setSavedMsg('✓ 已記錄：' + dept + ' ' + (isFail ? '不合格' : '合格') + '（✗ ' + failCount + ' 項）'
        + (failCount > 0 ? ' · 所有 ✗ 項目須於 24 小時內改善並拍照回報' : ''));
      setMarks({}); setNote('');
      loadRecords();
    }
  }

  const curMonth = currentMonth();
  const monthRecs = (records || []).filter(r => String(r.time).slice(0, 7) === curMonth);
  const failThisMonth = d => monthRecs.filter(r => r.dept === d && r.result === '不合格').length;
  // [2026-09-06 老闆定] 每部門每星期至少一次；本週未檢嘅部門開頁即紅字提醒
  const mondayStr = cleanCheckMondayStr();
  const weekMissing = records === null ? [] :
    ['酒店部', '學院部'].filter(d => !records.some(r => r.dept === d && String(r.time).slice(0, 10) >= mondayStr));

  return (
    <>
      <div className="pwd-card pwd-block">
        <div className="pwd-eyebrow">🧹 清潔突擊檢查</div>
        {records !== null && (weekMissing.length > 0
          ? <div className="pwd-cc-week warn">⚠️ 本週尚未檢查：{weekMissing.join('、')}（每部門每星期至少一次）</div>
          : <div className="pwd-cc-week done">✓ 本週兩部門已完成檢查</div>)}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {['酒店部', '學院部'].map(d => (
            <button key={d} className={'pwd-cc-deptbtn' + (dept === d ? ' on' : '')} onClick={() => switchDept(d)}>
              {CLEAN_CHECKLISTS[d].icon} {d}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <span className="pwd-cc-std">{conf.hint} · ✗ 超過 3 項即為不合格</span>
        </div>
        {conf.groups.map(gr => (
          <div key={gr.name} className="pwd-cc-group">
            <div className="pwd-cc-grouphead">{gr.name}{gr.hint && <span className="pwd-cc-grouphint">{gr.hint}</span>}</div>
            {gr.items.map(([k, std]) => (
              <div key={k} className="pwd-cc-item">
                <div className="pwd-cc-label">
                  <div className="pwd-cc-name">{k}</div>
                  <div className="pwd-cc-std">{std}</div>
                </div>
                <div className="pwd-cc-marks">
                  <button className={'pwd-cc-markbtn' + (marks[k] === '✓' ? ' ok' : '')} onClick={() => setMark(k, '✓')}>✓</button>
                  <button className={'pwd-cc-markbtn' + (marks[k] === '✗' ? ' bad' : '')} onClick={() => setMark(k, '✗')}>✗</button>
                  <button className={'pwd-cc-markbtn' + (marks[k] === 'N/A' ? ' na' : '')} onClick={() => setMark(k, 'N/A')}>N/A</button>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div className={'pwd-cc-summary' + (isFail ? ' fail' : ' pass')}>
          <span>已填 {filled}/{allItems.length} · ✗ {failCount} 項</span>
          <span>{allFilled ? (isFail ? '不合格' : '合格') : '未完成'}</span>
        </div>
        <div className="pwd-mgr-field" style={{ marginTop: 14 }}><label>檢查人 <b>*</b></label>
          <input className="pwd-input" type="text" autoComplete="off" placeholder="請輸入檢查人姓名" value={inspector} onChange={e => setInspector(e.target.value)} />
        </div>
        <div className="pwd-mgr-field" style={{ marginTop: 12 }}><label>當值員工／導師</label>
          <input className="pwd-input" type="text" autoComplete="off" placeholder="當日負責清潔之員工" value={onDuty} onChange={e => setOnDuty(e.target.value)} />
        </div>
        <div className="pwd-mgr-field" style={{ marginTop: 12 }}><label>備註（不達標詳情／改善期限）</label>
          <input className="pwd-input" type="text" autoComplete="off" placeholder="選填" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <div style={{ marginTop: 14 }}>
          {savedMsg && <div className="pwd-mgr-saved" style={{ marginBottom: 8 }}>{savedMsg}</div>}
          <button className="pwd-mgr-savebtn" disabled={saving} onClick={submit}>{saving ? '提交中…' : '提交檢查記錄'}</button>
        </div>
      </div>

      <div className="pwd-card pwd-block" style={{ marginTop: 14 }}>
        <div className="pwd-eyebrow">📋 檢查記錄</div>
        <div className="pwd-cc-std" style={{ marginTop: 8 }}>
          本月不合格：🏨 {failThisMonth('酒店部')} 次 · 🎓 {failThisMonth('學院部')} 次（KPI 目標：每部門 ≤ 1）· 點擊記錄可查看逐項結果
        </div>
        {records === null && <div className="pwd-cc-std" style={{ marginTop: 10 }}>載入中…</div>}
        {records !== null && records.length === 0 && <div className="pwd-cc-std" style={{ marginTop: 10 }}>暫無記錄</div>}
        {(records || []).map(r => (
          <React.Fragment key={r.id}>
            <div className="pwd-cc-rec" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
              <div className="pwd-cc-recmain">
                <div className="pwd-cc-name">{r.dept} · {String(r.time).slice(0, 16).replace('T', ' ')}</div>
                <div className="pwd-cc-std">檢查人 {r.inspector}{r.onDuty ? ' · 當值 ' + r.onDuty : ''}{r.failItems ? ' · ✗：' + r.failItems : ''}</div>
              </div>
              <span className={'pwd-cc-rectag' + (r.result === '不合格' ? ' fail' : ' pass')}>{r.result}{r.failCount > 0 ? ' ✗' + r.failCount : ''}</span>
            </div>
            {openId === r.id && <CleanCheckMarks marks={r.marks} />}
          </React.Fragment>
        ))}
      </div>
    </>
  );
}

// 本週一（yyyy-MM-dd）：同記錄時間戳做字串比較，唔解析日期字串
function cleanCheckMondayStr() {
  const d = new Date();
  const mon = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86400000);
  return mon.getFullYear() + '-' + String(mon.getMonth() + 1).padStart(2, '0') + '-' + String(mon.getDate()).padStart(2, '0');
}
// 撳開記錄顯示逐項 ✓/✗/N/A（2026-09-06 老闆要求）
function CleanCheckMarks({ marks }) {
  const keys = Object.keys(marks || {});
  if (!keys.length) return <div className="pwd-cc-detail"><div className="pwd-cc-std">此記錄無逐項資料</div></div>;
  return (
    <div className="pwd-cc-detail">
      {keys.map(k => (
        <div key={k} className="pwd-cc-drow">
          <span>{k}</span>
          <span className={marks[k] === '✓' ? 'm-ok' : marks[k] === '✗' ? 'm-bad' : 'm-na'}>{marks[k]}</span>
        </div>
      ))}
    </div>
  );
}

// 店長後台頂部提醒（2026-09-06 老闆定：唔要 email，登入店長後台即見提示就夠）——
// 唔理店長喺邊個管理分頁都會見到；本週兩部門齊咗就唔佔位
function MgrCleanReminder() {
  const [missing, setMissing] = useState(null);
  useEffect(() => {
    pwApi('cleanCheckList').then(r => {
      if (!r.ok) return;
      const mon = cleanCheckMondayStr();
      setMissing(['酒店部', '學院部'].filter(d => !r.items.some(x => x.dept === d && String(x.time).slice(0, 10) >= mon)));
    }).catch(() => {});
  }, []);
  if (!missing || missing.length === 0) return null;
  return <div className="pwd-cc-week warn">⚠️ 本週尚未進行清潔突擊檢查：{missing.join('、')}（每部門每星期至少一次）· 請到「清潔檢查」分頁完成</div>;
}

// ── 員工版清潔檢查摘要（2026-09-05 老闆定「折中」）──
// 員工睇到部門級結果（本月次數＋最近記錄＋✗項目），唔顯示檢查人／當值員工名——
// 名喺後端已按有冇 key 隱去，唔係前端收埋咁簡單。完整記錄喺店長頁。
function CleanCheckSummary() {
  const [records, setRecords] = useState(null);
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    pwApi('cleanCheckList').then(r => { if (r.ok) setRecords(r.items); }).catch(() => {});
  }, []);
  if (!records || records.length === 0) return null;  // 未有記錄唔佔位
  const curMonth = currentMonth();
  const monthRecs = records.filter(r => String(r.time).slice(0, 7) === curMonth);
  const failOf = d => monthRecs.filter(r => r.dept === d && r.result === '不合格').length;
  return (
    <div className="pwd-card pwd-block">
      <div className="pwd-eyebrow">🧹 清潔突擊檢查 · 部門結果</div>
      <div className="pwd-cc-std">
        本月不合格：🏨 酒店部 {failOf('酒店部')} 次 · 🎓 學院部 {failOf('學院部')} 次（KPI 目標：每部門 ≤ 1）· 點擊記錄可查看逐項結果
      </div>
      {records.slice(0, 5).map(r => (
        <React.Fragment key={r.id}>
          <div className="pwd-cc-rec" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
            <div className="pwd-cc-recmain">
              <div className="pwd-cc-name">{r.dept} · {String(r.time).slice(0, 16).replace('T', ' ')}</div>
              {r.failItems && <div className="pwd-cc-std">✗：{r.failItems}（須於 24 小時內改善）</div>}
            </div>
            <span className={'pwd-cc-rectag' + (r.result === '不合格' ? ' fail' : ' pass')}>{r.result}{r.failCount > 0 ? ' ✗' + r.failCount : ''}</span>
          </div>
          {openId === r.id && <CleanCheckMarks marks={r.marks} />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── ManagerPanel ──
function ManagerPanel({ month, unlocked, mgrData, onUnlock, onLock, area, onAreaChange }) {
  if (!unlocked) return <ManagerGate onUnlock={onUnlock} />;
  if (!mgrData) return <div className="pwd-loading" style={{ minHeight: 200, background: 'transparent' }}><div className="pwd-spinner" /><div className="pwd-loading-txt" style={{ color: 'var(--pw-ink-mute)' }}>載入管理數據…</div></div>;
  return (
    <>
      <div className="pwd-mgr-banner">
        <span className="pwd-mgr-banner-ico">🛠</span>
        <div><b>團隊管理</b><span>店長專用 · 你的 KPI 由老闆評核</span></div>
        <button className="pwd-mgr-lock" onClick={onLock}>🔒 鎖定</button>
      </div>
      <MgrCleanReminder />
      <div className="pwd-mgr-nav">
        {MGR_AREAS.map(a => (
          <button key={a.key} className={'pwd-mgr-navbtn' + (area === a.key ? ' on' : '')} onClick={() => onAreaChange(a.key)}>{a.label}</button>
        ))}
      </div>
      {area === 'ops' && <MgrOps month={month} mgrData={mgrData} />}
      {area === 'kpi' && <MgrKpi month={month} mgrData={mgrData} />}
      {area === 'club' && <MgrClub mgrData={mgrData} />}
      {area === 'swap' && <MgrSwap mgrData={mgrData} />}
      {area === 'leave' && <MgrLeave month={month} mgrData={mgrData} />}
      {area === 'roster' && <MgrRoster mgrData={mgrData} />}
      {area === 'clean' && <MgrCleanCheck />}
      {area === 'ownerkpi' && <MgrOwnerKpi month={month} mgrData={mgrData} />}
    </>
  );
}

// ═══════════ CommissionApp ═══════════
function CommissionApp() {
  const [month, setMonth] = useState(currentMonth());
  const [screen, setScreen] = useState('login'); // login | loading | dash | error
  const [errMsg, setErrMsg] = useState('');
  const [staff, setStaff] = useState(null);
  const [dash, setDash] = useState(null);
  const [tab, setTab] = useState('pay');
  const [mgrUnlocked, setMgrUnlocked] = useState(false);
  const [mgrData, setMgrData] = useState(null);
  const [mgrArea, setMgrArea] = useState('ops'); // 店長後台目前分頁
  const [refreshing, setRefreshing] = useState(false); // 背景更新緊數據（畫面已用 cache 即顯）

  // [2026-09-06 老闆批「開app立即睇到」] cache 先行：有上次數據即刻上畫，背景攞新數據靜靜替換。
  // cache 只做顯示加速——所有寫入操作照舊直接打後端，唔會基於 cache 做決定。
  function dashCacheKey(st) { return 'pw_dash_' + st.id; }
  function readDashCache(st, m) {
    try {
      const c = JSON.parse(localStorage.getItem(dashCacheKey(st)) || 'null');
      return c && c.month === m ? c.res : null;
    } catch (e) { return null; }
  }
  function writeDashCache(st, m, res) {
    try { localStorage.setItem(dashCacheKey(st), JSON.stringify({ month: m, res: res })); } catch (e) {}
  }
  async function loadDashboard(st, m = month) {
    const cached = readDashCache(st, m);
    if (cached) { setDash(cached); setStaff({ ...st, ...cached.staff }); setScreen('dash'); setRefreshing(true); }
    else setScreen('loading');
    try {
      const res = await pwApi('dashboard', { staffId: st.id, month: m });
      if (!res.ok) { if (!cached) { setErrMsg(res.error || '載入失敗'); setScreen('error'); } return; }
      setDash(res); setStaff({ ...st, ...res.staff }); setScreen('dash');
      writeDashCache(st, m, res);
    } catch (e) { if (!cached) { setErrMsg('連線失敗,請檢查網絡'); setScreen('error'); } }
    finally { setRefreshing(false); }
  }
  // 切換查看月份
  async function changeMonth(m) {
    if (m === month) return;
    setMonth(m);
    if (!staff) return;
    // 清走舊月份嗀管理數據,避免營運數據表帶住舊月份嗀數字而誤存到新月份
    if (staff.role === 'manager' || staff.role === 'owner') setMgrData(null);
    await loadDashboard(staff, m);
    if ((staff.role === 'manager' || staff.role === 'owner') && mgrUnlocked) {
      try { const res = await pwApi('managerData', { month: m }); if (res.ok) setMgrData(res); } catch (e) {}
    }
  }
  // 自動續登
  useEffect(() => {
    // [2026-09-06 老闆批] 記住登入：改用 localStorage，閂咗 app 再開都唔使重新入名+ID（登出先清）
    const saved = localStorage.getItem('pw_staff');
    if (saved) {
      try {
        const st = JSON.parse(saved);
        if (st.role === 'owner') setTab('owner');   // 老闆冇「我的佣金」tab，唔重設會停喺 pay 空白畫面
        setStaff(st); loadDashboard(st);
        // 還原管理解鎖：有記住嘅 key 就唔使再入密碼，管理數據背景載
        const mk = localStorage.getItem('pw_mgr_key');
        if (mk && (st.role === 'manager' || st.role === 'owner')) {
          PW_KEY = mk;
          setMgrUnlocked(true);
          pwApi('managerData', { month: currentMonth() }).then(r => { if (r.ok) setMgrData(r); }).catch(() => {});
        }
      } catch (e) {}
    }
  }, []);

  // [2026-08-25] 登入速度：res 而家係 login action 嘅合併回應（身份+主面板數據一齊嚟），
  //   唔使好似之前咁再多 call 一次 dashboard——慳返一整程 Apps Script 固定開銷。
  function doLogin(res) {
    const st = res.staff;
    localStorage.setItem('pw_staff', JSON.stringify(st));
    setStaff(st); setTab(st.role === 'owner' ? 'owner' : 'pay'); setMonth(currentMonth()); setMgrUnlocked(false); setMgrData(null);
    setDash(res); setScreen('dash');
    writeDashCache(st, currentMonth(), res);
  }
  function doLogout() {
    try { if (staff) localStorage.removeItem(dashCacheKey(staff)); } catch (e) {}
    localStorage.removeItem('pw_staff');
    localStorage.removeItem('pw_mgr_key'); PW_KEY = '';
    setStaff(null); setDash(null); setTab('pay'); setMgrUnlocked(false); setMgrData(null); setScreen('login');
  }
  async function reloadDash() { if (staff) { const res = await pwApi('dashboard', { staffId: staff.id, month }); if (res.ok) { setDash(res); writeDashCache(staff, month, res); } } }

  async function submitClub({ dogName, phone }) {
    // 提名寫唔入就一定要話用戶知——ClubCard 提交後會清空表單收埋，靜靜哋失敗＝隻狗石沉大海
    const ok = await pwWrite('nominate', { staffId: staff.id, dogName, phone });
    if (ok) await reloadDash();
  }
  async function submitTrial({ classId, dogName, phone, customerType, ownerName, payMethod }) {
    const r = await pwApi('trialBook', { staffId: staff.id, classId, dogName, phone, customerType, ownerName, payMethod });
    await reloadDash();
    return r;
  }
  async function cancelTrial(trialId) {
    await pwWrite('trialCancel', { trialId });
    await reloadDash();   // 成功失敗都重讀，名單一定同 sheet 一致
  }
  async function submitSwap({ date, shift }) {
    await pwWrite('swap', { staffId: staff.id, date, shift });
  }
  async function unlockMgr() {
    setMgrUnlocked(true);
    try { const res = await pwApi('managerData', { month }); if (res.ok) setMgrData(res); } catch (e) {}
  }

  if (screen === 'login') return <Login onLogin={doLogin} />;
  if (screen === 'loading') return <div className="pwd-loading"><img src="pawradise-logo-full.png" alt="" /><div className="pwd-spinner" /><div className="pwd-loading-txt">載入你的資料…</div></div>;
  if (screen === 'error') return (
    <div className="pwd-login">
      <div className="pwd-login-top"><div className="pwd-login-crest"><img src="pawradise-logo-full.png" alt="" /></div></div>
      <div className="pwd-login-card">
        <div className="pwd-login-err">{errMsg}</div>
        <button className="pwd-login-btn" onClick={() => (staff ? loadDashboard(staff) : setScreen('login'))}>重試</button>
        <button className="pwd-swap-cancel" onClick={doLogout}>返回登入</button>
      </div>
    </div>
  );

  const isManager = staff.role === 'manager';
  const isOwner = staff.role === 'owner';
  const team = dash.team;
  const staffForCalc = { ...staff, attendance: dash.staff.attendance, kpiFail: dash.kpiFail, lateLeave: dash.lateLeave };
  const { calc, items, kpi, lateLeave, dogEscape } = fullResult(staffForCalc, team);

  return (
    <div className="pwd-screen">
      <div className="pwd-header">
        <div className="pwd-h-logo"><img src="pawradise-logo.jpg" alt="" /></div>
        <div className="pwd-h-text">
          <h1>{staff.name}</h1>
          <p>{isManager ? '店長 · ' : ''}Pawradise · {team.month}{refreshing ? ' · 🔄 同步中' : ''}</p>
        </div>
        <button className="pwd-h-logout" onClick={doLogout} title="登出"><span className="pwd-h-ava">{staff.initial}</span></button>
      </div>

      <div className="pwd-body">
        {(tab === 'pay' || tab === 'owner' || (tab === 'mgr' && mgrArea !== 'roster')) && (
          <div className="pwd-monthbar">
            <span className="pwd-monthbar-lbl">查看月份</span>
            <select className="pwd-monthsel" value={month} onChange={(e) => changeMonth(e.target.value)}>
              {monthOptions().map(m => (
                <option key={m} value={m}>{monthLabelFull(m)}{m === currentMonth() ? ' · 本月' : ''}</option>
              ))}
            </select>
          </div>
        )}
        {tab === 'pay' && !isOwner && (
          <>
            {staff.role !== 'frontdesk' && (
              <div className="pwd-readout">
                <span className="pwd-readout-tag">本月實際</span>
                {isManager
                  ? <span>門店總業績 <b>{money(storeRevenueOf(team))}</b></span>
                  : <span>新生 S1<b>{team.s1New||0}</b>/S2<b>{team.s2New||0}</b>/雙<b>{team.comboNew||0}</b> · 續報 <b>{team.renewals}</b></span>}
              </div>
            )}
            <IndividualView staff={staff} calc={calc} items={items} kpi={kpi} team={team}
              lateLeave={lateLeave} dogEscape={dogEscape} clubNoms={dash.clubNoms} history={dash.history}
              trialSlots={dash.trialSlots} trialBookings={dash.trialBookings} trialDone={dash.trialDone}
              month={month} monthLabel={monthLabelShort(month)} onClubSubmit={submitClub}
              onTrialBook={submitTrial} onTrialCancel={cancelTrial} />
            <CleanCheckSummary />
            <div className="pwd-foot">佣金為預估值,實際以月結公佈為準 · 更新 {team.updatedAt} · {APP_VERSION}</div>
          </>
        )}
        {tab === 'duty' && (
          <DutyRoster staff={staff} weeks={dash.weeks} currentWeekIdx={dash.currentWeekIdx} todayDow={dash.todayDow}
            leave={dash.leave} leaveRecords={dash.leaveRecords} coworkers={dash.coworkers} onSwap={submitSwap} />
        )}
        {tab === 'mgr' && (
          <ManagerPanel key={month} month={month} unlocked={mgrUnlocked} mgrData={mgrData}
            area={mgrArea} onAreaChange={setMgrArea}
            onUnlock={unlockMgr} onLock={() => { setMgrUnlocked(false); localStorage.removeItem('pw_mgr_key'); PW_KEY = ''; }} />
        )}
        {tab === 'owner' && (
          <OwnerOverview dash={dash} mgrUnlocked={mgrUnlocked} mgrData={mgrData} onUnlock={unlockMgr} />
        )}
        {tab === 'seats' && (
          <SeatsPanel staffId={staff.id} />
        )}
      </div>

      <div className="pwd-tabbar">
        {!isOwner && (
          <button className={'pwd-tabbtn' + (tab === 'pay' ? ' on' : '')} onClick={() => { setTab('pay'); reloadDash(); }}>
            <span className="pwd-tabbtn-ico">💰</span><span>我的佣金</span>
          </button>
        )}
        <button className={'pwd-tabbtn' + (tab === 'duty' ? ' on' : '')} onClick={() => { setTab('duty'); reloadDash(); }}>
          <span className="pwd-tabbtn-ico">📅</span><span>更表</span>
        </button>
        <button className={'pwd-tabbtn' + (tab === 'seats' ? ' on' : '')} onClick={() => setTab('seats')}>
          <span className="pwd-tabbtn-ico">🎓</span><span>學位</span>
        </button>
        {isManager && (
          <button className={'pwd-tabbtn' + (tab === 'mgr' ? ' on' : '')} onClick={() => setTab('mgr')}>
            <span className="pwd-tabbtn-ico">🗂</span><span>店長後台</span>
          </button>
        )}
        {isOwner && (
          <button className={'pwd-tabbtn' + (tab === 'owner' ? ' on' : '')} onClick={() => setTab('owner')}>
            <span className="pwd-tabbtn-ico">📊</span><span>老闆總覽</span>
          </button>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <div className="pwd-app"><CommissionApp /></div>
);
