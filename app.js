// Pawradise 員工系統前端源碼（JSX）——改呢個檔，唔好直接改 app.js
// 改完必須行 ./build.sh 重新編譯出 app.js 先 push（index.html 只載 app.js）

const {
  useState,
  useEffect,
  useRef
} = React;

// 版本印（2026-08-12）：Safari／PWA 會 cache 住舊前端，兩次事故都係咁兜圈
// （7/6 店長「更表儲存唔到」、8/12 導師仲見到酒店業績）。頁腳印住版本＝
// 有人報問題時第一句問「你頁腳寫住咩版本？」就分辨到係真 bug 定係 cache。
// ⚠️ 每次 push 前記得改呢個字串，否則印咗都冇用。
const APP_VERSION = 'v2026-09-02a';

// ═══════════ API ═══════════
let PW_KEY = ''; // 店長/老闆解鎖後記住，寫入 action 後端要驗
async function pwApi(action, params = {}) {
  const qs = new URLSearchParams();
  qs.set('action', action);
  if (PW_KEY) qs.set('key', PW_KEY);
  Object.keys(params).forEach(k => {
    if (params[k] !== undefined && params[k] !== null) qs.set(k, params[k]);
  });
  const res = await fetch(window.APPS_SCRIPT_URL + '?' + qs.toString(), {
    method: 'GET',
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('網絡錯誤 ' + res.status);
  return res.json();
}
// ⚠️ 2026-08-12 幽靈條目事故：所有寫入一律經呢度，強制驗返後端回應。
// 之前多個寫入係「樂觀更新 + await 但唔 check」——授權過期後端回「未授權」乜都唔寫，
// 畫面照樣顯示成功，用戶一 reload 就發現嘢唔見咗（2026-07-06 更表事故同一種病）。
// 規矩：寫入失敗 → 回滾樂觀更新 ＋ 報後端真實原因。onErr 唔傳就用 alert（保證睇得見）。
async function pwWrite(action, params, revert, onErr) {
  const show = onErr || function (m) {
    window.alert(m);
  };
  try {
    const r = await pwApi(action, params);
    if (!r || r.ok === false) {
      if (revert) revert();
      const raw = r && r.error || '儲存失敗';
      show(/未授權/.test(raw) ? '授權過期：請撳「🔒 鎖定」後重新輸入管理密碼，再試一次（今次未寫入，畫面已還原）' : raw + '（未寫入，畫面已還原）');
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
function monthLabelShort(m) {
  return parseInt(m.split('-')[1]) + '月';
}
// 員工可查看的最早月份
const FIRST_MONTH = '2026-05';
function monthOptions() {
  const out = [];
  const cur = currentMonth();
  let [y, m] = FIRST_MONTH.split('-').map(Number);
  const [cy, cm] = cur.split('-').map(Number);
  // 萬一系統時間早於起始月,最少都顯示起始月
  if (cy < y || cy === y && cm < m) return [FIRST_MONTH];
  while (y < cy || y === cy && m <= cm) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
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
const TARGETS = {
  hotelThreshold: 200000,
  academyThreshold: 50000,
  renewalTier: 5,
  packageGoal: 12
};
const ROLE_KPIS = {
  junior: {
    label: '初級寵物照顧員',
    items: [{
      id: 'j1',
      text: '客戶有效合理投訴 ≤ 1 次 (因疏忽照顧 / 未跟足規則造成意外受傷;以團隊計算)',
      weight: 30,
      team: true
    }, {
      id: 'j2',
      text: '操作錯誤:混亂食物藥物、錯誤執拾 / 遺漏物品、CCTV 邀請遺留 / 錯誤 ≤ 3 次 (以團隊計算)',
      weight: 20,
      team: true
    }, {
      id: 'j3',
      text: '每日每位客戶收到 > 5 條相片 / 影片 (以團隊計算)',
      weight: 20,
      team: true
    }, {
      id: 'j4',
      text: '完成指定環境及犬隻清潔流程;客戶衛生投訴 ≤ 2 且 突擊巡查不合格 ≤ 1 (標準checklist+相片為準,3項以上唔妥先算1次)',
      weight: 20,
      team: false
    }, {
      id: 'j5',
      text: '保持儀容整潔、穿着整齊制服',
      weight: 10,
      team: false
    }]
  },
  senior: {
    label: '高級寵物照顧員',
    items: [{
      id: 's1',
      text: '客戶有效合理投訴 ≤ 1 次 (因疏忽照顧 / 未跟足規則造成意外受傷;以團隊計算)',
      weight: 30,
      team: true
    }, {
      id: 's2',
      text: '操作錯誤:混亂食物藥物、錯誤執拾 / 遺漏物品、CCTV 邀請遺留 / 錯誤 ≤ 3 次 (以團隊計算)',
      weight: 20,
      team: true
    }, {
      id: 's3',
      text: '每日每位客戶收到 > 5 條相片 / 影片 (以團隊計算)',
      weight: 20,
      team: true
    }, {
      id: 's4',
      text: '完成指定環境及犬隻清潔流程;客戶衛生投訴 ≤ 2 且 突擊巡查不合格 ≤ 1 (標準checklist+相片為準,3項以上唔妥先算1次)',
      weight: 20,
      team: false
    }, {
      id: 's5',
      text: '培訓團隊,確保團隊中初級寵物照顧員 KPI 達 80 分以上',
      weight: 10,
      team: false
    }]
  },
  tutor: {
    label: '學院部初級導師',
    items: [{
      id: 't1',
      text: '客戶有效投訴 ≤ 1 次 (對應到負責人=個人計;指向課堂整體=團隊計;以書面客訴記錄為準)',
      weight: 20,
      team: false
    }, {
      id: 't2',
      text: '課堂安全零事故 (狗隻受傷 / 走失 / 分組不當致衝突,以事故記錄為準)',
      weight: 20,
      team: false
    }, {
      id: 't3',
      text: '漏斗跟進:線上查詢即日回覆率 ≥ 90% 且逾期跟進 = 0 (含被派續報/升班/Calm Explorer Club 邀請名單;Leads 追蹤表自動計)',
      weight: 15,
      team: false
    }, {
      id: 't4',
      text: '評估報告當日交付家長 (報告 + 行為評級),評估表正本當日存檔',
      weight: 15,
      team: false
    }, {
      id: 't5',
      text: '學員記錄每堂更新 (出席 / 進度 / 評級),錯漏 ≤ 2',
      weight: 10,
      team: false
    }, {
      id: 't6',
      text: '家長溝通:每學員每堂發送 ≥ 5 條影片 + 手冊填寫 (有助教時由助教拍攝、導師篩選指導質素)',
      weight: 10,
      team: false
    }, {
      id: 't7',
      text: '場地器材清潔:完成指定清潔流程;突擊巡查不合格 ≤ 1 (標準checklist+相片為準)',
      weight: 10,
      team: false
    }]
  },
  assistant: {
    label: '學院部助教',
    items: [{
      id: 'a1',
      text: '客戶有效投訴 ≤ 1 次 (對應到負責人=個人計;指向課堂整體=團隊計)',
      weight: 20,
      team: false
    }, {
      id: 'a2',
      text: '課堂安全零事故 (協助控場、狗隻交接無錯漏)',
      weight: 25,
      team: false
    }, {
      id: 'a3',
      text: '課堂執行:器材 / 場地預備 100% 完成 (課前 checklist 為準),錯漏 ≤ 2',
      weight: 15,
      team: false
    }, {
      id: 'a4',
      text: '影片拍攝:每學員每堂 ≥ 5 條影片交齊畀導師篩選 + 出席記錄齊',
      weight: 20,
      team: false
    }, {
      id: 'a5',
      text: '場地器材清潔:完成指定清潔流程;突擊巡查不合格 ≤ 1 (標準checklist+相片為準)',
      weight: 15,
      team: false
    }, {
      id: 'a6',
      text: '保持儀容整潔、穿着整齊制服',
      weight: 5,
      team: false
    }]
  },
  frontdesk: {
    label: '前台',
    items: [{
      id: 'f1',
      text: '招待客戶有效投訴 ≤ 1 人',
      weight: 30,
      team: false
    }, {
      id: 'f2',
      text: '線上訊息於同一工作天辦公時間內必須回覆',
      weight: 20,
      team: false
    }, {
      id: 'f3',
      text: '每日行程編排 / 套票整理 / 文件準備 / 課堂預約 100% 完成,錯誤 ≤ 3 個',
      weight: 20,
      team: false
    }, {
      id: 'f4',
      text: '完成指定環境清潔流程;衛生投訴 ≤ 2 次',
      weight: 20,
      team: false
    }, {
      id: 'f5',
      text: '保持儀容整潔、穿着制服',
      weight: 10,
      team: false
    }]
  },
  manager: {
    label: '店長',
    items: [{
      id: 'm1',
      text: '每月完成團隊保底業績 (寵物酒店 ≥ $200,000 ＋ 社交學院 ≥ $50,000)',
      weight: 25,
      team: true
    }, {
      id: 'm2',
      text: '客戶有效投訴 ≤ 1 人 (全店)',
      weight: 15,
      team: true
    }, {
      id: 'm3',
      text: '每月加入的新客戶 ≥ 20 個',
      weight: 15,
      team: true
    }, {
      id: 'm4',
      text: '每月購買的套票 ≥ 12 個',
      weight: 15,
      team: true
    }, {
      id: 'm5',
      text: '漏斗入口:返工日查詢即日入表;輪流派單公平 (月結接單數差 ≤ 2);督導導師逾期跟進清零;學期尾派續報/升班跟進名單',
      weight: 15,
      team: false
    }, {
      id: 'm6',
      text: '數據準確:CRM 收入記錄返工日當日入齊、假期收款返工首日補齊 (日期填實際收款日;人手項目:接送/美容/套票/學期費/試堂/差額;服務類型標準字眼+電話正確);成交即日入 KPI 評核;月度數據 3 號前 (假期順延);對數差異 >15% 能解釋;15 號同員工過 KPI 進度',
      weight: 15,
      team: false
    }]
  }
};
const PARTS_META = {
  fixed: {
    label: '固定獎金',
    icon: '📅',
    color: 'var(--pw-gold)'
  },
  hotel: {
    label: '酒店部',
    icon: '🏨',
    color: 'var(--pw-navy)'
  },
  newcmm: {
    label: '學院新生',
    icon: '🎓',
    color: 'var(--pw-cat-sniff)'
  },
  renew: {
    label: '舊生續報',
    icon: '🔄',
    color: 'var(--pw-cat-puzzle)'
  },
  mgrtier: {
    label: '門店業績佣金',
    icon: '🏪',
    color: 'var(--pw-navy)'
  },
  base: {
    label: '底薪',
    icon: '💼',
    color: 'var(--pw-navy)'
  },
  kpibonus: {
    label: 'KPI 獎金',
    icon: '⭐',
    color: 'var(--pw-gold)'
  },
  club: {
    label: '會籍獎金',
    icon: '🐾',
    color: 'var(--pw-cat-sniff)'
  },
  referral: {
    label: '轉介學院',
    icon: '🔗',
    color: 'var(--pw-cat-puzzle)'
  }
};
const MGR_TIERS = [{
  min: 320000,
  amt: 5800
}, {
  min: 420000,
  amt: 7800
}, {
  min: 520000,
  amt: 9800
}, {
  min: 620000,
  amt: 11800
}]; // 各級已含原 $2,000 學院交付獎(2026-07 併入)
function managerTier(revenue) {
  let cur = {
    min: 0,
    amt: 0,
    index: -1
  };
  MGR_TIERS.forEach((t, i) => {
    if (revenue >= t.min) cur = {
      ...t,
      index: i
    };
  });
  const next = MGR_TIERS[cur.index + 1] || null;
  return {
    amt: cur.amt,
    tierMin: cur.min,
    next,
    index: cur.index
  };
}
const RATES_ACADEMY = [{
  label: '學院新生 · S1',
  rate: '$500 / 隻',
  note: '個人歸成交者 · 學院月收入 ≥ $50k 先派'
}, {
  label: '學院新生 · S2',
  rate: '$300 / 隻',
  note: '個人歸成交者 · 學院月收入 ≥ $50k 先派'
}, {
  label: '學院新生 · S1+S2',
  rate: '$900 / 隻',
  note: '個人歸成交者 · 鼓勵 upsell'
}, {
  label: '舊生續報 / 升班',
  rate: '$900 / 個入池',
  note: '按職級分:初級導師 2/5 · 助教 1/5 · 升班(S1→S2)屬此項,不設個人佣'
}, {
  label: '試堂',
  rate: '不設佣金',
  note: '屬流量功勞'
}, {
  label: 'Calm Explorer Club 入會',
  rate: '$100 / $200 / $350 入池',
  note: 'Light / Active / Ultimate · 按職級分(同續報池,分母 5) · 完成三堂觀察期後發 · 2026 年 8–9 月 ×1.5'
}, {
  label: 'Club 續會分成',
  rate: '$20 / $45 / $60 每月入池',
  note: '每位在會會員按方案計 · 由訂閱起始月起算,每位上限 6 個月'
}];
const RATES_HOTEL = [{
  label: '酒店部佣金池',
  rate: '12% ÷ 3 (編制)',
  note: '超出 $200,000 門檻部分 · 業績 = 寄宿 + 日托 + 基本美容(不含星級美容) · 空缺位份額預留'
}, {
  label: '轉介學院課程',
  rate: '$180 / 隻入池',
  note: '入酒店轉介池,按編制分母 3 分(空缺預留) · 按轉化計唔按派券計 · 一隻狗一次為限 · 受學院 $50k 門檻 · 2026 年 8–9 月 ×1.5($270)'
}, {
  label: '全部佣金',
  rate: '× KPI 完成率',
  note: '91分↑ 100% · 81–90 按分數 · 71–80 半數 · 70↓ 不發'
}];
// 學院職級權重(只用於舊生續報池):資深 3 / 初級 2 / 助教 1。資深=owner,退出日常,不抽池。
const ACAD_W = {
  senior: 3,
  junior: 2,
  assistant: 1
};
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
  light: {
    key: 'light',
    label: 'Light',
    fee: 499,
    bonus: 100,
    renew: 20,
    color: 'var(--pw-cat-sniff)'
  },
  active: {
    key: 'active',
    label: 'Active',
    fee: 1199,
    bonus: 200,
    renew: 45,
    color: 'var(--pw-cat-puzzle)'
  },
  ultimate: {
    key: 'ultimate',
    label: 'Ultimate',
    fee: 1499,
    bonus: 350,
    renew: 60,
    color: 'var(--pw-gold)'
  }
};
const CLUB_RENEW_MONTHS = 6; // 每位會員最多分成 6 個月,之後停(功勞會攤薄,亦推動繼續招新)
function monthsBetween(a, b) {
  if (!a || !b) return -1;
  const [y1, m1] = a.split('-').map(Number),
    [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
// 限期加碼:2026 年 8 月 ×1.5(老闆 2026-09-05 提早結束,原定 8–9 月),9 月起回復標準金額。
// 兩項一齊行:①Calm Explorer Club 入會獎金(清存量) ②酒店轉介學院獎金(推動漏斗開頭)
const PROMO_MONTHS = ['2026-08'];
const PROMO_RATE = 1.5;
function promoBoost(month) {
  return PROMO_MONTHS.includes(month) ? PROMO_RATE : 1;
}
// 未知崗位一律當前台處理,避免任何手誤令整個面板崩潰變空白
function roleKpi(role) {
  return ROLE_KPIS[role] || ROLE_KPIS.frontdesk;
}
function buildScorecard(role, failIds = []) {
  return roleKpi(role).items.map(it => ({
    ...it,
    pass: !failIds.includes(it.id)
  }));
}
// 分部門後:學院部用導師/助教 KPI,酒店部照舊;部門欄未填 = 照舊(相容)
function kpiRoleOf(staff) {
  if (!staff) return 'frontdesk';
  if (staff.role === 'manager') return 'manager';
  if (staff.dept === 'academy') return staff.acadRank === 'assistant' ? 'assistant' : 'tutor';
  return staff.role;
}
function payoutRatio(score, {
  override = false,
  overrideReason = ''
} = {}) {
  if (override) return {
    ratio: 0,
    band: '失格',
    reason: overrideReason || '缺勤 / 紀律 / 安全事故'
  };
  if (score >= 91) return {
    ratio: 1,
    band: '滿額'
  };
  if (score >= 81) return {
    ratio: score / 100,
    band: '按完成率'
  };
  if (score >= 71) return {
    ratio: 0.5,
    band: '半額'
  };
  return {
    ratio: 0,
    band: '不發放'
  };
}
function scorecardTotal(items) {
  return items.reduce((a, it) => a + (it.pass ? it.weight : 0), 0);
}
function calc({
  attendance,
  trialConv = 0,
  s1New = 0,
  s2New = 0,
  comboNew = 0,
  newStudents,
  renewals,
  hotelRevenue,
  academyRevenue = null,
  acadWeight = 0,
  acadWeightTotal = 0,
  headcount = HEADCOUNT,
  dept = '',
  hotelReferrals = 0,
  monthKey = ''
}) {
  const fixedOk = true; // 分部門後取消 $2,000 出勤獎(摺入底薪;店長併入階梯)
  const fixed = 0;
  const hotelOver = Math.max(0, hotelRevenue - TARGETS.hotelThreshold);
  const hotel = dept === 'academy' ? 0 : hotelOver * 0.12 / HOTEL_SEATS; // 學院部唔分池;分母=編制3,空缺預留
  // 學院新生 = 個人銷售佣,歸成交者(不÷3):S1$500 / S2$300 / S1+S2$900。試堂不設佣(流量功勞)
  // 學院 $50,000 收入門檻:該月學院總業績未達 → 新生佣 $0(事前可見,不追扣);academyRevenue 為 null 時(冇團隊數據)當已達,避免破壞
  const acadGateOk = academyRevenue == null ? true : academyRevenue >= TARGETS.academyThreshold;
  const rawNewcmm = s1New * 500 + s2New * 300 + comboNew * 900;
  const newcmm = acadGateOk ? rawNewcmm : 0;
  const nStudents = newStudents != null ? newStudents : trialConv + s1New + s2New + comboNew;
  const renewPool = renewals * 900; // 舊生續報 $900/個 團隊池(由 $600 上調,推動跟進)
  // 按學院職級 / 固定分母分(初級2/助教1,分母=ACAD_WEIGHT_TOTAL=5);無職級(兼職/未填)→ 0 份額,預留唔發
  // 酒店部唔分學院池(同 hotel 那行對稱:學院部唔分酒店池)
  const renewShare = dept === 'hotel' || acadWeight <= 0 ? 0 : acadWeight / ACAD_WEIGHT_TOTAL;
  const rawRenew = renewPool * renewShare;
  const renew = acadGateOk ? rawRenew : 0; // 學院 $50k 門檻同樣 gate 舊生續報(整個學院佣金)
  // 酒店轉介學院 $180/隻 入酒店轉介池,按酒店編制分母 3 分(空缺預留唔發)。
  // 收入來源係學院,所以受學院 $50k 門檻,唔受酒店 $200k 門檻;學院部唔分呢個池。
  // 2026 年 8–9 月同樣 ×1.5（$180 → $270），同 Club 入會獎金一齊行
  const referralUnit = 180 * promoBoost(monthKey);
  const rawReferral = dept === 'academy' ? 0 : hotelReferrals * referralUnit / HOTEL_SEATS;
  const referral = acadGateOk ? rawReferral : 0;
  const projectCommission = hotel + newcmm + renew + referral;
  const total = fixed + projectCommission;
  return {
    fixed,
    fixedOk,
    hotel,
    hotelOver,
    hotelRevenue,
    newcmm,
    rawNewcmm,
    acadGateOk,
    academyRevenue,
    newStudents: nStudents,
    trialConv,
    s1New,
    s2New,
    comboNew,
    renew,
    rawRenew,
    renewals,
    referral,
    rawReferral,
    hotelReferrals,
    referralUnit,
    projectCommission,
    total,
    attendance,
    attendanceNeed: Math.max(0, 4 - attendance),
    parts: [{
      key: 'fixed',
      value: fixed
    }, {
      key: 'hotel',
      value: hotel
    }, {
      key: 'newcmm',
      value: newcmm
    }, {
      key: 'renew',
      value: renew
    }, {
      key: 'referral',
      value: referral
    }]
  };
}
function calcManager({
  attendance,
  storeRevenue,
  hotelRevenue,
  academyRevenue
}) {
  const fixedOk = true; // $2,000 已併入 MGR_TIERS,唔再獨立計
  const fixed = 0;
  const tier = managerTier(storeRevenue);
  const tierAmt = tier.amt;
  const projectCommission = tierAmt;
  const total = fixed + projectCommission;
  return {
    isManager: true,
    fixed,
    fixedOk,
    storeRevenue,
    hotelRevenue,
    academyRevenue,
    tierAmt,
    tierMin: tier.tierMin,
    tierNext: tier.next,
    tierIndex: tier.index,
    projectCommission,
    total,
    attendance,
    attendanceNeed: Math.max(0, 4 - attendance),
    parts: [{
      key: 'fixed',
      value: fixed
    }, {
      key: 'mgrtier',
      value: tierAmt
    }]
  };
}
function calcFrontdesk() {
  const baseSalary = 16000,
    kpiBonus = 2000,
    total = baseSalary + kpiBonus;
  return {
    isFrontdesk: true,
    baseSalary,
    kpiBonus,
    baseFixed: baseSalary,
    projectCommission: kpiBonus,
    total,
    fixed: 0,
    fixedOk: true,
    attendance: 99,
    attendanceNeed: 0,
    parts: [{
      key: 'base',
      value: baseSalary,
      noKpi: true
    }, {
      key: 'kpibonus',
      value: kpiBonus
    }]
  };
}
function applyKpi(calcResult, score, opts = {}) {
  const {
    ratio,
    band,
    reason
  } = payoutRatio(score, opts);
  const baseFixed = calcResult.baseFixed || 0;
  const kpiBase = calcResult.total - baseFixed;
  const actualTotal = baseFixed + kpiBase * ratio;
  const actualProject = calcResult.projectCommission * ratio;
  const deducted = kpiBase - kpiBase * ratio;
  const actualParts = calcResult.parts.map(p => p.noKpi ? {
    ...p
  } : {
    ...p,
    value: p.value * ratio
  });
  return {
    score,
    ratio,
    band,
    reason,
    actualProject,
    deducted,
    actualTotal,
    actualParts,
    fixedActual: calcResult.fixed * ratio
  };
}
// 基本美容併入酒店總業績計佣;店長業績 = 酒店(含基本美容) + 學院 + 星級美容 + 接送 (套票、其他除外)
function hotelForCommission(team) {
  return (team.hotelRevenue || 0) + (team.groomBasic || 0);
}
function storeRevenueOf(team) {
  return hotelForCommission(team) + (team.academyRevenue || 0) + (team.groomStar || 0) + (team.pickup || 0);
}
function fullResult(staff, team, overrides = {}) {
  const att = overrides.attendance != null ? overrides.attendance : staff.attendance;
  const c = staff.role === 'manager' ? calcManager({
    attendance: att,
    storeRevenue: storeRevenueOf(team),
    hotelRevenue: hotelForCommission(team),
    academyRevenue: team.academyRevenue
  }) : staff.role === 'frontdesk' ? calcFrontdesk() : calc({
    attendance: att,
    trialConv: team.trialConv || 0,
    s1New: staff.s1New != null ? staff.s1New : team.s1New || 0,
    s2New: staff.s2New != null ? staff.s2New : team.s2New || 0,
    comboNew: staff.comboNew != null ? staff.comboNew : team.comboNew || 0,
    renewals: team.renewals,
    hotelRevenue: hotelForCommission(team),
    academyRevenue: team.academyRevenue,
    acadWeight: ACAD_W[staff.acadRank] || 0,
    acadWeightTotal: team.acadWeightTotal || 0,
    headcount: team.headcount || HEADCOUNT,
    dept: staff.dept || '',
    hotelReferrals: team.hotelReferrals || 0,
    monthKey: team.monthKey || ''
  });
  const items = overrides.scorecard || buildScorecard(kpiRoleOf(staff), staff.kpiFail || []);
  const score = scorecardTotal(items);
  const lateLeave = overrides.lateLeave != null ? overrides.lateLeave : staff.lateLeave || 0;
  const dogEscape = overrides.dogEscape != null ? overrides.dogEscape : team.dogEscape || false;
  let override = false,
    overrideReason = '';
  if (dogEscape) {
    override = true;
    overrideReason = '團隊發生走失狗狗事故';
  } else if (lateLeave > 3) {
    override = true;
    overrideReason = `當月累積遲到 / 請假 ${lateLeave} 次 (超過 3 次)`;
  }
  // 入職首月唔發佣金(2026-08-12 制度):員工表「佣金起始月」(第9欄,yyyy-MM)之前嘅月份,
  // 佣金以 0 計。行 override 路徑,員工見到原因句而唔係無啦啦 $0;會籍池喺 clubBonusFor 同步 gate。
  const commGated = staff.commStart && team.monthKey && team.monthKey < staff.commStart;
  if (commGated) {
    override = true;
    overrideReason = '入職首月 (佣金由第二個月起計)';
  }
  const kpi = applyKpi(c, score, {
    override,
    overrideReason
  });
  if (commGated) kpi.deducted = 0; // 首月唔發唔係 KPI 扣起,唔好當年終池顯示
  return {
    calc: c,
    items,
    kpi,
    lateLeave,
    dogEscape
  };
}
// v3:會籍入會獎金一律入學院團隊池(唔再個人記名)。
// 個人提名數字照樣喺 dashboard 顯示(推動力),但錢按職級權重分。
// 入會獎金池:本月新入會嘅會員(訂閱起始月 = 本月)。冇 since 嘅舊記錄當本月,唔會漏發。
function clubJoinPool(noms, month) {
  const raw = (noms || []).filter(n => n.status === 'subscribed' && n.tier).filter(n => !n.since || n.since === month).reduce((a, n) => a + CLUB_TIERS[n.tier].bonus, 0);
  return raw * promoBoost(month);
}
// 續會分成池:訂閱起始月起 6 個月內嘅在會會員(唔包入會嗰個月本身)。
function clubRenewPool(noms, month) {
  return (noms || []).filter(n => n.status === 'subscribed' && n.tier && n.since).filter(n => {
    const d = monthsBetween(n.since, month);
    return d >= 1 && d < CLUB_RENEW_MONTHS;
  }).reduce((a, n) => a + (CLUB_TIERS[n.tier].renew || 0), 0);
}
function clubPoolTotal(noms, month) {
  return clubJoinPool(noms, month) + clubRenewPool(noms, month);
}
// ⚠️ dept === 'hotel' 呢道 gate 一定要有 —— 2026-08-04 續報池漏財就係漏咗反向判斷,
//    令酒店部照分學院池。新加嘅池唔可以重蹈覆轍。
function clubBonusFor(staff, noms, month) {
  if (!staff || staff.dept === 'hotel' || staff.role === 'manager') return 0;
  if (staff.commStart && month < staff.commStart) return 0; // 入職首月唔發佣金(2026-08-12)
  const w = ACAD_W[staff.acadRank] || 0;
  if (w <= 0) return 0; // 無職級 = 0 份額,預留唔發
  return clubPoolTotal(noms, month) * (w / ACAD_WEIGHT_TOTAL);
}
const money = n => 'HK$' + Math.round(n).toLocaleString('en-US');
const moneyPlain = n => Math.round(n).toLocaleString('en-US');

// ═══════════ 更表 helpers ═══════════
const SHIFTS = {
  early: {
    label: '早更',
    time: '08:30–16:30',
    hrs: 8
  },
  mid: {
    label: '午更',
    time: '12:30–20:30',
    hrs: 8
  },
  full: {
    label: '全日更',
    time: '08:30–20:30',
    hrs: 12
  },
  off: {
    label: '休息',
    time: '',
    hrs: 0
  }
};
const POSITIONS = {
  academyA: {
    label: '學院A位',
    cls: 'academy'
  },
  // 初級導師
  academyB: {
    label: '學院B位',
    cls: 'academy'
  },
  // 初級導師
  assist: {
    label: '助教',
    cls: 'academy'
  },
  hotelA: {
    label: '酒店A位',
    cls: 'hotelA'
  },
  hotelB: {
    label: '酒店B位',
    cls: 'hotelB'
  },
  hotelC: {
    label: '酒店C位',
    cls: 'hotelC'
  },
  academy: {
    label: '學院',
    cls: 'academy'
  },
  // 舊資料(未細分前)相容顯示
  reception: {
    label: '前台',
    cls: 'reception'
  } // 舊資料相容,已不再喺選單
};
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
function buildWeekDays(week, wi, currentWeekIdx, todayDow) {
  const shifts = week && week.shifts || [];
  return WEEKDAYS.map((wd, i) => {
    const r = shifts[i] || ['off', null];
    const key = r[0] || 'off';
    const sh = SHIFTS[key] || SHIFTS.off;
    const posKey = r[1] || null;
    return {
      weekday: wd,
      date: week.dates[i],
      today: wi === currentWeekIdx && i === todayDow,
      shiftKey: key,
      label: sh.label,
      time: sh.time,
      off: key === 'off',
      pos: posKey ? POSITIONS[posKey] : null,
      posKey
    };
  });
}
function weekSummary(week) {
  const shifts = week && week.shifts || [];
  return {
    workDays: shifts.filter(r => r && r[0] && r[0] !== 'off').length,
    weekHours: shifts.reduce((a, r) => a + ((r && SHIFTS[r[0]] ? SHIFTS[r[0]].hrs : 0) || 0), 0)
  };
}

// ═══════════ UI atoms ═══════════
function DonutChart({
  parts,
  total,
  size = 188,
  stroke = 24,
  children
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 ? 0.012 * c : 0;
  let acc = 0;
  const segs = parts.filter(p => p.value > 0).map(p => {
    const frac = p.value / total;
    const seg = {
      key: p.key,
      color: PARTS_META[p.key].color,
      len: Math.max(0, frac * c - gap),
      offset: -acc * c
    };
    acc += frac;
    return seg;
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: size,
      height: size
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    style: {
      transform: 'rotate(-90deg)',
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "var(--pw-cream-deep)",
    strokeWidth: stroke
  }), segs.map(s => /*#__PURE__*/React.createElement("circle", {
    key: s.key,
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: s.color,
    strokeWidth: stroke,
    strokeDasharray: `${s.len} ${c - s.len}`,
    strokeDashoffset: s.offset,
    style: {
      transition: 'stroke-dasharray .7s ease, stroke-dashoffset .7s ease'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, children));
}
function PayoutLedger({
  calc,
  kpi
}) {
  const full = kpi.ratio >= 1;
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-ledger"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-led-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-lbl"
  }, "\u8A08\u7B97\u4F63\u91D1 (\u56FA\u5B9A\uFF0B\u9805\u76EE)"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-val"
  }, money(calc.total))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-led-row mul"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-lbl"
  }, "\xD7 KPI \u767C\u653E\u6BD4\u4F8B"), /*#__PURE__*/React.createElement("span", {
    className: 'pwd-led-ratio ' + (full ? 'full' : kpi.ratio > 0 ? 'mid' : 'zero')
  }, Math.round(kpi.ratio * 100), "%")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-led-row total"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-lbl"
  }, "\u5BE6\u969B\u9818\u53D6"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-val"
  }, money(kpi.actualTotal))));
}
function KpiCard({
  role,
  items,
  score,
  kpi,
  editable,
  onToggle
}) {
  const roleLabel = roleKpi(role).label;
  const tone = kpi.ratio >= 1 ? 'full' : kpi.ratio > 0 ? 'mid' : 'zero';
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-kpi"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "KPI \u8A08\u5206\u5361 \xB7 ", roleLabel), /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-band"
  }, "\u767C\u653E\u6BD4\u4F8B ", /*#__PURE__*/React.createElement("b", {
    className: 'r-' + tone
  }, Math.round(kpi.ratio * 100), "%"), " \xB7 ", kpi.band)), /*#__PURE__*/React.createElement("div", {
    className: 'pwd-kpi-score r-' + tone
  }, /*#__PURE__*/React.createElement("span", {
    className: "n"
  }, score), /*#__PURE__*/React.createElement("span", {
    className: "d"
  }, "\u5206"))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-meter"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-meter-fill",
    style: {
      width: score + '%'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-meter-mark",
    style: {
      left: '91%'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-scale"
  }, /*#__PURE__*/React.createElement("span", null, "0"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, "91 \u6EFF\u984D \u2192"), /*#__PURE__*/React.createElement("span", null, "100")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-items"
  }, items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.id,
    className: 'pwd-kpi-item' + (it.pass ? ' pass' : ' fail') + (editable ? ' edit' : ''),
    onClick: editable ? () => onToggle(it.id) : undefined,
    disabled: !editable
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-check"
  }, it.pass ? '✓' : '✕'), /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-text"
  }, it.text, it.team && /*#__PURE__*/React.createElement("em", {
    className: "pwd-kpi-team"
  }, "\u5718\u968A")), /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-w"
  }, it.weight)))), editable && /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-hint"
  }, "\u9EDE\u9805\u76EE\u5207\u63DB\u9054\u6A19 / \u672A\u9054\u6A19 \u2014 \u5373\u6642\u5F71\u97FF\u767C\u653E\u6BD4\u4F8B"));
}
function YearEndPool({
  deducted
}) {
  if (deducted < 1) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-pool"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-pool-ico"
  }, "\uD83C\uDFC6"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-pool-t"
  }, money(deducted), " \u5DF2\u64A5\u5165\u5E74\u7D42\u82B1\u7D05\u734E\u6C60"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-pool-s"
  }, "\u56E0 KPI \u672A\u6EFF\u984D\u800C\u6263\u8D77\u7684\u63D0\u6210\u4E0D\u6703\u6D88\u5931 \u2014 \u5168\u5E74\u9054\u6A19\u53EF\u6309\u5E73\u5747 KPI \u53D6\u56DE")));
}
function FrontdeskGoal({
  kpi,
  score
}) {
  const bands = [{
    min: 91,
    pct: 100
  }, {
    min: 81,
    pct: 90
  }, {
    min: 71,
    pct: 50
  }, {
    min: 0,
    pct: 0
  }];
  const curMin = score >= 91 ? 91 : score >= 81 ? 81 : score >= 71 ? 71 : 0;
  const bonus = Math.round(2000 * kpi.ratio);
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-cur"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-lbl"
  }, "\u672C\u6708 KPI \u5206\u6578"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-rev"
  }, score, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15
    }
  }, "\u5206"))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-amt"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgrgoal-amt-num"
  }, money(bonus)), /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgrgoal-amt-sub"
  }, "\u672C\u6708 KPI \u734E\u91D1"))), score < 91 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-next"
  }, "KPI \u9054 ", /*#__PURE__*/React.createElement("b", null, "91 \u5206"), " \u2192 \u734E\u91D1\u5168\u984D\u767C\u653E ", /*#__PURE__*/React.createElement("b", null, "HK$2,000"), "(\u73FE\u6642 +", money(2000 - bonus), " \u7A7A\u9593)"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-ladder"
  }, bands.map((b, i) => {
    const isCur = b.min === curMin;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: 'pwd-mgrgoal-step' + (score >= b.min ? ' hit' : '') + (isCur ? ' cur' : '')
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgrgoal-step-node"
    }, score >= b.min ? '✓' : ''), /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgrgoal-step-min"
    }, b.min === 0 ? '70 分以下' : b.min + ' 分以上'), /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgrgoal-step-amt"
    }, b.min === 81 ? '按 % 發放' : money(2000 * b.pct / 100)), isCur && /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgrgoal-step-tag"
    }, "\u73FE\u6642"));
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-foot"
  }, "\u5E95\u85AA HK$16,000 \u70BA\u56FA\u5B9A\u6536\u5165,\u4E0D\u53D7 KPI \u5F71\u97FF"));
}
function ManagerGoal({
  calc
}) {
  const rev = calc.storeRevenue;
  const next = calc.tierNext;
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-cur"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-lbl"
  }, "\u672C\u6708\u9580\u5E97\u7E3D\u696D\u7E3E (\u9152\u5E97+\u5B78\u9662+\u7F8E\u5BB9+\u63A5\u9001)"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-rev"
  }, money(rev))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-amt"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgrgoal-amt-num"
  }, money(calc.tierAmt)), /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgrgoal-amt-sub"
  }, "\u672C\u7D1A\u4F63\u91D1"))), next && /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-next"
  }, "\u518D\u885D ", /*#__PURE__*/React.createElement("b", null, money(next.min - rev)), " \u696D\u7E3E \u2192 \u4F63\u91D1\u5347\u81F3 ", /*#__PURE__*/React.createElement("b", null, money(next.amt)), "(+", money(next.amt - calc.tierAmt), ")"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-ladder"
  }, MGR_TIERS.map((t, i) => {
    const hit = rev >= t.min;
    const isCur = i === calc.tierIndex;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: 'pwd-mgrgoal-step' + (hit ? ' hit' : '') + (isCur ? ' cur' : '')
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgrgoal-step-node"
    }, hit ? '✓' : ''), /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgrgoal-step-min"
    }, money(t.min)), /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgrgoal-step-amt"
    }, money(t.amt)), isCur && /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgrgoal-step-tag"
    }, "\u73FE\u6642"));
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgoal-foot"
  }, "\u5B78\u9662\u4EA4\u4ED8\u734E\u91D1 HK$2,000 \u5DF2\u4F75\u5165\u5404\u7D1A\u968E\u68AF\u91D1\u984D"));
}
// ⚠️ 呢個 component 只會 render 畀非店長員工（店長行 ManagerGoal）。
// 老闆 2026-08-12：店長以下唔顯示公司／部門總業績銀碼，淨係要知有冇到門檻。
// 所以進度條只有「滿」或「空」（唔可以用真實比例——睇條 bar 就估返到業績），
// 數字位置顯示「已達／未達門檻」＋政策目標數（目標係制度寫明，唔係業績）。
function GoalUnlock({
  team,
  calc,
  role,
  dept
}) {
  const T = TARGETS;
  const perTen = Math.round(1200 / HOTEL_SEATS);
  const isAcad = dept === 'academy';
  const goals = [];
  if (role === 'manager' || !isAcad) goals.push({
    icon: '🏨',
    scope: '團隊',
    label: '酒店業績達門檻 (含基本美容)',
    cur: calc.hotelRevenue,
    target: T.hotelThreshold,
    fmt: money,
    reward: '解鎖酒店 12% 佣金池',
    hit: calc.hotelRevenue >= T.hotelThreshold,
    hint: '每多 HK$10,000 業績 ≈ 每人 +HK$' + perTen
  });
  if (role === 'manager' || isAcad) goals.push({
    icon: '🎓',
    scope: '團隊',
    label: '學院業績達門檻',
    cur: team.academyRevenue || 0,
    target: T.academyThreshold,
    fmt: money,
    reward: '解鎖學院佣金 (新生 + 舊生續報)',
    hit: (team.academyRevenue || 0) >= T.academyThreshold,
    hint: '達標後:新生每隻 S1 $500 / S2 $300 / S1+S2 $900;舊生續報 $900/個'
  });
  if (role === 'manager') {
    goals.push({
      icon: '🔄',
      scope: '店長',
      label: '套票銷售目標',
      cur: team.packages,
      target: T.packageGoal,
      fmt: n => n + ' 個',
      reward: '店長 KPI 項目 (套票不另計佣)',
      hit: team.packages >= T.packageGoal
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-goals"
  }, goals.map((g, i) => {
    const pct = g.noTarget ? 100 : g.hit ? 100 : 0; // 唔用真實比例，否則條 bar 反推到業績
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: 'pwd-goal' + (g.hit || g.noTarget ? ' hit' : '')
    }, /*#__PURE__*/React.createElement("div", {
      className: "pwd-goal-ico"
    }, g.hit || g.noTarget ? '✓' : i + 1), /*#__PURE__*/React.createElement("div", {
      className: "pwd-goal-mid"
    }, /*#__PURE__*/React.createElement("div", {
      className: "pwd-goal-top"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-goal-label"
    }, g.label), /*#__PURE__*/React.createElement("span", {
      className: 'pwd-goal-scope s-' + (g.scope === '個人' ? 'me' : g.scope === '店長' ? 'mgr' : 'team')
    }, g.scope)), /*#__PURE__*/React.createElement("div", {
      className: "pwd-goal-bar"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: pct + '%'
      },
      className: g.hit || g.noTarget ? 'hit' : ''
    })), /*#__PURE__*/React.createElement("div", {
      className: "pwd-goal-foot"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-goal-num"
    }, g.noTarget ? g.fmt(g.cur) : /*#__PURE__*/React.createElement(React.Fragment, null, g.hit ? '✓ 已達門檻' : '未達門檻', " ", /*#__PURE__*/React.createElement("i", null, "\u76EE\u6A19 ", g.fmt(g.target)))), /*#__PURE__*/React.createElement("span", {
      className: 'pwd-goal-reward' + (g.hit || g.noTarget ? ' on' : '')
    }, g.noTarget ? '' : g.hit ? '✓ ' : '', g.reward)), g.hint && /*#__PURE__*/React.createElement("div", {
      className: "pwd-goal-hint"
    }, g.hint)));
  }));
}
function RateTable({
  role,
  dept
}) {
  const [open, setOpen] = useState(false);
  const isMgr = role === 'manager',
    isFd = role === 'frontdesk';
  const rows = isMgr ? [{
    label: '門店業績 ≥ $320,000',
    rate: 'HK$5,800',
    note: '酒店 + 學院 總業績 · 已含學院交付獎'
  }, {
    label: '門店業績 ≥ $420,000',
    rate: 'HK$7,800',
    note: ''
  }, {
    label: '門店業績 ≥ $520,000',
    rate: 'HK$9,800',
    note: ''
  }, {
    label: '門店業績 ≥ $620,000',
    rate: 'HK$11,800',
    note: ''
  }] : isFd ? [{
    label: '固定底薪',
    rate: 'HK$16,000',
    note: '每月固定,不受 KPI 影響'
  }, {
    label: 'KPI 獎金 · 91 分以上',
    rate: 'HK$2,000',
    note: '全額發放'
  }, {
    label: 'KPI 獎金 · 81–90 分',
    rate: '按完成率',
    note: '獎金 × KPI %'
  }, {
    label: 'KPI 獎金 · 71–80 分',
    rate: 'HK$1,000',
    note: '半額'
  }, {
    label: 'KPI 獎金 · 70 分以下',
    rate: 'HK$0',
    note: '不發放'
  }] : dept === 'academy' ? RATES_ACADEMY : RATES_HOTEL;
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-rate"
  }, /*#__PURE__*/React.createElement("button", {
    className: "pwd-rate-head",
    onClick: () => setOpen(o => !o)
  }, /*#__PURE__*/React.createElement("span", null, isMgr ? '店長佣金制度' : isFd ? '前台薪酬制度' : '佣金率參考表'), /*#__PURE__*/React.createElement("span", {
    className: 'pwd-rate-arr' + (open ? ' open' : '')
  }, "\u2304")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-rate-body",
    style: {
      maxHeight: open ? 460 : 0
    }
  }, rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "pwd-rate-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-rate-lbl"
  }, r.label), /*#__PURE__*/React.createElement("span", {
    className: "pwd-rate-rate"
  }, r.rate), r.note && /*#__PURE__*/React.createElement("span", {
    className: "pwd-rate-note"
  }, r.note)))));
}
function KpiClauses({
  lateLeave,
  dogEscape
}) {
  const lateTriggered = lateLeave > 3;
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-clauses"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-clauses-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-clauses-ico"
  }, "\u26A0"), /*#__PURE__*/React.createElement("span", null, "KPI \u7279\u5225\u5426\u6C7A\u689D\u6B3E \u2014 \u4EFB\u4F55\u4E00\u9805\u89F8\u767C,\u7576\u6708 KPI \u76F4\u63A5\u70BA 0")), /*#__PURE__*/React.createElement("div", {
    className: 'pwd-clause' + (lateTriggered ? ' hit' : '')
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-clause-dot"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-clause-text"
  }, /*#__PURE__*/React.createElement("b", null, "\u7576\u6708\u7D2F\u7A4D\u9072\u5230\u6216\u8ACB\u5047\u8D85\u904E 3 \u6B21"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-clause-sub"
  }, "\u500B\u4EBA \xB7 \u672C\u6708\u5DF2\u7D2F\u7A4D ", lateLeave, " \u6B21")), /*#__PURE__*/React.createElement("span", {
    className: 'pwd-clause-tag' + (lateTriggered ? ' hit' : '')
  }, lateTriggered ? '已觸發' : `尚餘 ${Math.max(0, 3 - lateLeave)} 次`)), /*#__PURE__*/React.createElement("div", {
    className: 'pwd-clause' + (dogEscape ? ' hit' : '')
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-clause-dot"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-clause-text"
  }, /*#__PURE__*/React.createElement("b", null, "\u72D7\u72D7\u8D70\u5931 (\u72D7\u72D7\u55AE\u7368\u96E2\u958B\u5E97\u8216\u7BC4\u570D)"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-clause-sub"
  }, "\u5718\u968A \xB7 \u5168\u5E97\u6240\u6709\u4EBA KPI \u70BA 0")), /*#__PURE__*/React.createElement("span", {
    className: 'pwd-clause-tag' + (dogEscape ? ' hit' : '')
  }, dogEscape ? '已觸發' : '本月正常')));
}
function Stepper({
  value,
  onChange,
  min = 0,
  suffix = '隻',
  hint
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-step-field"
  }, /*#__PURE__*/React.createElement("button", {
    className: "pwd-step-btn",
    onClick: () => onChange(Math.max(min, value - 1))
  }, "\u2212"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-step-mid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-step-num"
  }, value, /*#__PURE__*/React.createElement("span", {
    className: "pwd-step-suf"
  }, suffix)), hint && /*#__PURE__*/React.createElement("div", {
    className: "pwd-step-hint"
  }, hint)), /*#__PURE__*/React.createElement("button", {
    className: "pwd-step-btn",
    onClick: () => onChange(value + 1)
  }, "+"));
}
function AttendanceDots({
  days,
  editable,
  onChange,
  max = 8
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-dots"
  }, Array.from({
    length: max
  }, (_, i) => i + 1).map(n => /*#__PURE__*/React.createElement("button", {
    key: n,
    className: 'pwd-dot' + (n <= days ? ' on' : '') + (editable ? ' edit' : ''),
    onClick: editable ? () => onChange(n === days ? n - 1 : n) : undefined,
    disabled: !editable
  }, n)));
}

// ═══════════ Login ═══════════
function Login({
  onLogin
}) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    if (e) e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      // [2026-08-25] 登入速度：舊版 auth 成功先再 call dashboard 兩程 request，
      //   而家合併做一程 login action（後端已經一次過驗證身份+計主面板數據）。
      const res = await pwApi('login', {
        name: name.trim(),
        id: id.trim(),
        month: currentMonth()
      });
      if (!res.ok) {
        setError(res.error || '登入失敗,請重試');
        setBusy(false);
        return;
      }
      onLogin(res);
    } catch (err) {
      setError('連線失敗,請檢查網絡後重試');
      setBusy(false);
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-login"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-login-top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-login-crest"
  }, /*#__PURE__*/React.createElement("img", {
    src: "pawradise-logo-full.png",
    alt: "Pawradise"
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-login-sub"
  }, "\u54E1\u5DE5\u5F8C\u53F0\u7BA1\u7406\u7CFB\u7D71")), /*#__PURE__*/React.createElement("form", {
    className: "pwd-login-card",
    onSubmit: submit
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow",
    style: {
      textAlign: 'center'
    }
  }, "\u54E1\u5DE5\u767B\u5165"), /*#__PURE__*/React.createElement("label", {
    className: "pwd-field"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-field-lbl"
  }, "\u5168\u540D"), /*#__PURE__*/React.createElement("input", {
    className: "pwd-input",
    type: "text",
    autoComplete: "off",
    placeholder: "\u8ACB\u8F38\u5165\u4F60\u7684\u5168\u540D",
    value: name,
    onChange: e => {
      setName(e.target.value);
      setError('');
    }
  })), /*#__PURE__*/React.createElement("label", {
    className: "pwd-field"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-field-lbl"
  }, "\u8EAB\u4EFD\u8B49\u82F1\u6587\u5B57\uFF0B\u982D 4 \u4F4D\u6578\u5B57"), /*#__PURE__*/React.createElement("input", {
    className: "pwd-input",
    type: "password",
    autoComplete: "off",
    placeholder: "\u4F8B\u5982 A1234",
    value: id,
    onChange: e => {
      setId(e.target.value);
      setError('');
    }
  })), error && /*#__PURE__*/React.createElement("div", {
    className: "pwd-login-err"
  }, error), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "pwd-login-btn",
    disabled: !name.trim() || !id.trim() || busy
  }, busy ? '登入中…' : '登入')), /*#__PURE__*/React.createElement("div", {
    className: "pwd-login-foot"
  }, "Pawradise \xB7 \u6BDB\u5B69\u793E\u4EA4\u5B78\u9662 \xB7 ", APP_VERSION));
}

// ═══════════ TrialCard ═══════════
// 試堂登記：酒店客免費體驗／新生付費試堂統一喺呢度幫家長留位。名額同正常入學位分開計（每個幼稚園日 2 個）。
function TrialCard({
  staff,
  slots,
  bookings,
  done,
  onBook,
  onCancel
}) {
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
  const list = slots || [];
  const totalLeft = (slots || []).reduce((a, s) => a + s.remaining, 0);
  const mine = bookings || [];
  // 已完成試堂（最近 14 日，最近嘅排前）——純唯讀。跟進記錄統一喺 Leads 主表做，唔喺呢度填。
  const doneList = done || [];
  const isNew = customerType === 'new';
  const canSubmit = sel && dog.trim() && !busy && (!isNew || ownerName.trim() && payMethod);
  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setMsg('');
    const r = await onBook({
      classId: sel,
      dogName: dog.trim(),
      phone: phone.trim(),
      customerType,
      ownerName: isNew ? ownerName.trim() : '',
      payMethod: isNew ? payMethod : ''
    });
    setBusy(false);
    if (r && r.ok === false) {
      setMsg(r.error || '登記失敗');
      return;
    }
    setSel('');
    setDog('');
    setPhone('');
    setOwnerName('');
    setMsg(isNew ? `已留位＋已記 $${TRIAL_NEW_STUDENT_FEE} 入收入記錄。記得即刻 WhatsApp 發確認訊息畀家長。` : '已留位。記得即刻 WhatsApp 發確認訊息畀家長。');
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u8A66\u5802\u767B\u8A18"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-sub"
  }, "\u4E00\u65E5\u9AD4\u9A57 \xB7 \u6BCF\u500B\u5E7C\u7A1A\u5712\u65E5 2 \u500B\u4F4D")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-earned"
  }, "\u672A\u4F86\u4EF2\u6709", /*#__PURE__*/React.createElement("b", null, totalLeft))), list.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-hint",
    style: {
      marginTop: 12
    }
  }, "\u672A\u4F86 45 \u65E5\u66AB\u6642\u672A\u6709\u5E7C\u7A1A\u5712\u65E5\uFF0C\u6216\u8AB2\u5802\u540D\u984D\u8868\u672A\u66F4\u65B0\u3002"), list.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-days"
  }, list.map(s => {
    const full = s.remaining <= 0;
    return /*#__PURE__*/React.createElement("div", {
      key: s.id,
      className: 'pwd-tr-day' + (sel === s.id ? ' sel' : '') + (full ? ' full' : ''),
      onClick: () => {
        if (!full) setSel(sel === s.id ? '' : s.id);
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "pwd-tr-day-d"
    }, s.date.slice(5).replace('-', '/')), /*#__PURE__*/React.createElement("div", {
      className: "pwd-tr-day-w"
    }, s.time || ''), /*#__PURE__*/React.createElement("div", {
      className: 'pwd-tr-day-r ' + (full ? 'no' : 'ok')
    }, full ? '已滿' : '尚餘 ' + s.remaining));
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-form"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-view-toggle"
  }, /*#__PURE__*/React.createElement("button", {
    className: !isNew ? 'on' : '',
    onClick: () => setCustomerType('hotel')
  }, "\uD83C\uDFE8 \u9152\u5E97\u5BA2\uFF08\u514D\u8CBB\uFF09"), /*#__PURE__*/React.createElement("button", {
    className: isNew ? 'on' : '',
    onClick: () => setCustomerType('new')
  }, "\uD83C\uDD95 \u65B0\u751F\uFF08$", TRIAL_NEW_STUDENT_FEE, "\uFF09")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-row",
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "pwd-tr-input",
    placeholder: "\u72D7\u72D7\u540D\u7A31",
    value: dog,
    onChange: e => setDog(e.target.value)
  }), /*#__PURE__*/React.createElement("input", {
    className: "pwd-tr-input",
    type: "tel",
    inputMode: "tel",
    placeholder: "\u5BB6\u9577\u96FB\u8A71",
    value: phone,
    onChange: e => setPhone(e.target.value)
  })), isNew && /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-row"
  }, /*#__PURE__*/React.createElement("input", {
    className: "pwd-tr-input",
    placeholder: "\u5BB6\u9577\u59D3\u540D\uFF08\u5165\u6536\u5165\u8A18\u9304\u7528\uFF09",
    value: ownerName,
    onChange: e => setOwnerName(e.target.value)
  }), /*#__PURE__*/React.createElement("select", {
    className: "pwd-monthsel",
    value: payMethod,
    onChange: e => setPayMethod(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "\u73FE\u91D1"
  }, "\u73FE\u91D1"), /*#__PURE__*/React.createElement("option", {
    value: "\u8F49\u8CEC"
  }, "\u8F49\u8CEC"))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-hint"
  }, isNew ? /*#__PURE__*/React.createElement(React.Fragment, null, "\u63C0\u597D\u65E5\u5B50 \u2192 \u5165\u9F4A\u8CC7\u6599\u540C\u5DF2\u6536\u5605 $", TRIAL_NEW_STUDENT_FEE, " \u2192 \u63D0\u4EA4\uFF08\u6703\u81EA\u52D5\u8A18\u5165\u6536\u5165\u8A18\u9304\uFF09\uFF0C", /*#__PURE__*/React.createElement("b", null, "\u7136\u5F8C\u5373\u523B WhatsApp \u767C\u78BA\u8A8D\u8A0A\u606F"), "\u3002") : /*#__PURE__*/React.createElement(React.Fragment, null, "\u63C0\u597D\u65E5\u5B50 \u2192 \u5165\u540D \u2192 \u63D0\u4EA4\uFF0C", /*#__PURE__*/React.createElement("b", null, "\u7136\u5F8C\u5373\u523B WhatsApp \u767C\u78BA\u8A8D\u8A0A\u606F"), "\uFF08\u898B\u300A\u9AD4\u9A57\u9080\u8ACB\u8207\u78BA\u8A8D\u8A0A\u606F\u7BC4\u672C\u300B\u8A0A\u606F\u4E8C\uFF09\u3002\u53E3\u982D\u8B1B\u5B8C\u5514\u5165\u5462\u5EA6\uFF0C\u7B49\u65BC\u5187\u7559\u4F4D\u3002")), msg && /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-hint",
    style: {
      color: 'var(--pw-navy-deep)'
    }
  }, msg), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-formacts"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-tr-sub"
  }, sel ? '已揀 ' + (list.find(x => x.id === sel) || {}).label : '請先揀一日'), /*#__PURE__*/React.createElement("button", {
    className: "pwd-la-confirm",
    disabled: !canSubmit,
    onClick: submit
  }, busy ? '登記中…' : '確認留位')))), mine.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-list"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-list-lbl"
  }, "\u5373\u5C07\u5230\u4F86\u5605\u8A66\u5802 (", mine.length, ")"), mine.map(b => /*#__PURE__*/React.createElement("div", {
    key: b.id,
    className: "pwd-tr-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-item-i"
  }, /*#__PURE__*/React.createElement("b", null, b.dog, b.phone ? /*#__PURE__*/React.createElement("span", {
    className: "pwd-club-nom-owner"
  }, " \xB7 ", b.phone) : null), /*#__PURE__*/React.createElement("span", null, b.label)), /*#__PURE__*/React.createElement("button", {
    className: "pwd-tr-x",
    onClick: () => onCancel(b.id)
  }, "\u53D6\u6D88")))), doneList.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-list"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-list-lbl"
  }, "\u6700\u8FD1\u5B8C\u6210\u5605\u8A66\u5802 \xB7 14 \u65E5\u5167 (", doneList.length, ")"), doneList.map(d => /*#__PURE__*/React.createElement("div", {
    key: d.id,
    className: "pwd-tr-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-item-i"
  }, /*#__PURE__*/React.createElement("b", null, d.dog, d.phone ? /*#__PURE__*/React.createElement("span", {
    className: "pwd-club-nom-owner"
  }, " \xB7 ", d.phone) : null), /*#__PURE__*/React.createElement("span", null, d.label)))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-hint"
  }, "\u8A66\u5802\u5F8C\u8DDF\u9032\u55BA Leads \u8FFD\u8E64\u8868\u505A\uFF08\u8DDF\u9032\u65E5\u5DF2\u81EA\u52D5\u6392\u5230\u8A66\u5802\u7FCC\u65E5\uFF09\uFF0C\u5462\u5EA6\u53EA\u4FC2\u7540\u4F60\u898B\u8FD4\u8A66\u5497\u908A\u5E7E\u96BB\u3002")));
}

// ═══════════ ClubCard ═══════════
function ClubCard({
  staff,
  noms,
  month,
  bonus,
  onSubmit
}) {
  const mine = noms.filter(n => n.staffId == staff.id);
  const boosted = promoBoost(month) > 1;
  const [open, setOpen] = useState(false);
  const [dog, setDog] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const STATUS = {
    pending: {
      label: '待店長審批',
      cls: 'pending'
    },
    approved: {
      label: '已確認資格 · 待主人訂閱',
      cls: 'approved'
    },
    subscribed: {
      label: '已成功訂閱',
      cls: 'subscribed'
    },
    rejected: {
      label: '未獲批准',
      cls: 'rejected'
    }
  };
  async function submit() {
    if (!dog.trim() || busy) return;
    setBusy(true);
    await onSubmit({
      dogName: dog.trim(),
      phone: phone.trim()
    });
    setDog('');
    setPhone('');
    setOpen(false);
    setBusy(false);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block pwd-club"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "Calm Explorer Club"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-sub"
  }, "\u63D0\u540D\u9054 A \u7D1A\u5605\u72D7\u72D7 \xB7 \u5E97\u9577\u78BA\u8A8D\u5165\u6703\u8CC7\u683C\u5F8C,\u5BB6\u9577\u81EA\u884C\u63C0\u65B9\u6848", boosted ? ' · 8–9 月獎金 ×1.5' : '')), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-earned"
  }, "\u6211\u5206\u5F97", /*#__PURE__*/React.createElement("b", null, money(bonus || 0)))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-tiers"
  }, Object.values(CLUB_TIERS).map(t => /*#__PURE__*/React.createElement("div", {
    key: t.key,
    className: "pwd-club-tier"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-club-tier-dot",
    style: {
      background: t.color
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "pwd-club-tier-name"
  }, t.label), /*#__PURE__*/React.createElement("span", {
    className: "pwd-club-tier-fee"
  }, "$", t.fee, "/\u6708"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-club-tier-bonus"
  }, "\u5165\u6703 $", Math.round(t.bonus * promoBoost(month))), /*#__PURE__*/React.createElement("span", {
    className: "pwd-club-tier-fee"
  }, "\u7E8C\u6703 $", t.renew, "/\u6708 \xD7 6")))), !open && /*#__PURE__*/React.createElement("button", {
    className: "pwd-club-add",
    onClick: () => setOpen(true)
  }, "\uFF0B \u63D0\u540D\u72D7\u72D7"), open && /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-form"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-frow"
  }, /*#__PURE__*/React.createElement("input", {
    className: "pwd-club-input",
    placeholder: "\u72D7\u72D7\u540D\u7A31",
    value: dog,
    onChange: e => setDog(e.target.value)
  }), /*#__PURE__*/React.createElement("input", {
    className: "pwd-club-input",
    type: "tel",
    inputMode: "tel",
    placeholder: "\u806F\u7D61\u96FB\u8A71",
    value: phone,
    onChange: e => setPhone(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-hint"
  }, "\u63D0\u540D\u524D\u5148\u78BA\u8A8D\u72D7\u72D7\u8A55\u4F30\u9054 A \u7D1A\u6216\u4EE5\u4E0A \xB7 \u5E97\u9577\u6703\u78BA\u8A8D\u5165\u6703\u8CC7\u683C \xB7 \u734E\u91D1\u5165\u5718\u968A\u6C60,\u6309\u8077\u7D1A\u5206"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-formacts"
  }, /*#__PURE__*/React.createElement("button", {
    className: "pwd-swap-cancel",
    onClick: () => setOpen(false)
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    className: "pwd-la-confirm",
    disabled: !dog.trim() || busy,
    onClick: submit
  }, busy ? '提交中…' : '提交提名'))), mine.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-list"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-list-lbl"
  }, "\u6211\u7684\u63D0\u540D (", mine.length, ")"), mine.map(n => {
    const t = n.tier ? CLUB_TIERS[n.tier] : null;
    const st = STATUS[n.status] || STATUS.pending;
    return /*#__PURE__*/React.createElement("div", {
      key: n.id,
      className: "pwd-club-nom"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-club-nom-dot",
      style: {
        background: t ? t.color : 'var(--pw-cream-deep)'
      }
    }), /*#__PURE__*/React.createElement("div", {
      className: "pwd-club-nom-info"
    }, /*#__PURE__*/React.createElement("b", null, n.dog, n.phone ? /*#__PURE__*/React.createElement("span", {
      className: "pwd-club-nom-owner"
    }, "\xB7 ", n.phone) : null), /*#__PURE__*/React.createElement("span", null, t ? `${t.label} · $${t.fee}/月 · 入池 $${Math.round(t.bonus * promoBoost(month))}` : '待店長確認入會資格')), /*#__PURE__*/React.createElement("span", {
      className: 'pwd-club-status ' + st.cls
    }, st.label));
  })));
}

// ═══════════ CommissionHistory ═══════════
function CommissionHistory({
  history,
  current,
  monthLabel
}) {
  const data = [...history, {
    m: monthLabel,
    v: Math.round(current),
    now: true
  }];
  let run = 0;
  const pts = data.map(d => {
    run += d.v;
    return {
      m: d.m,
      cum: run,
      now: d.now
    };
  });
  const cumulative = run;
  const avg = Math.round(cumulative / data.length);
  const W = 320,
    H = 132,
    padX = 14,
    padTop = 16,
    padBot = 24;
  const maxCum = pts[pts.length - 1].cum || 1;
  const x = i => padX + (W - padX * 2) * (i / Math.max(1, pts.length - 1));
  const y = v => padTop + (H - padTop - padBot) * (1 - v / maxCum);
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${x(pts.length - 1).toFixed(1)} ${H - padBot} L ${x(0).toFixed(1)} ${H - padBot} Z`;
  const last = pts[pts.length - 1];
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u672C\u5E74\u7D2F\u8A08\u4F63\u91D1"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-hist-cum"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-hist-cum-num"
  }, /*#__PURE__*/React.createElement("span", {
    className: "cur"
  }, "HK$"), moneyPlain(cumulative)), /*#__PURE__*/React.createElement("span", {
    className: "pwd-hist-cum-sub"
  }, "2026 \u5E74\u81F3\u4ECA \xB7 \u5E73\u5747\u6BCF\u6708 ", money(avg))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-hist-linewrap"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${W} ${H}`,
    className: "pwd-hist-svg",
    preserveAspectRatio: "none"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: "histFill",
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "var(--pw-gold)",
    stopOpacity: "0.32"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "var(--pw-gold)",
    stopOpacity: "0.02"
  }))), /*#__PURE__*/React.createElement("path", {
    d: areaPath,
    fill: "url(#histFill)"
  }), /*#__PURE__*/React.createElement("path", {
    d: linePath,
    fill: "none",
    stroke: "var(--pw-gold-deep)",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }), pts.map((p, i) => /*#__PURE__*/React.createElement("g", {
    key: i
  }, /*#__PURE__*/React.createElement("circle", {
    cx: x(i),
    cy: y(p.cum),
    r: p.now ? 5 : 3.5,
    fill: p.now ? 'var(--pw-gold-deep)' : 'var(--pw-paper)',
    stroke: "var(--pw-gold-deep)",
    strokeWidth: "2"
  }), /*#__PURE__*/React.createElement("text", {
    x: x(i),
    y: H - 8,
    textAnchor: "middle",
    className: 'pwd-hist-x' + (p.now ? ' now' : '')
  }, p.m))), /*#__PURE__*/React.createElement("text", {
    x: x(pts.length - 1),
    y: y(last.cum) - 11,
    textAnchor: "end",
    className: "pwd-hist-peak"
  }, money(last.cum)))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-hist-note"
  }, "\u6301\u7E8C\u9054\u6A19,\u591A\u52DE\u591A\u5F97,\u7D2F\u7A4D\u8D8A\u6EFE\u8D8A\u5927 \uD83C\uDFAF"));
}

// ═══════════ IndividualView ═══════════
function IndividualView({
  staff,
  calc,
  items,
  kpi,
  team,
  lateLeave,
  dogEscape,
  clubNoms,
  trialSlots,
  trialBookings,
  trialDone,
  history,
  month,
  monthLabel,
  onClubSubmit,
  onTrialBook,
  onTrialCancel
}) {
  const clubBonus = clubBonusFor(staff, clubNoms, month);
  const actualTotal = kpi.actualTotal + clubBonus;
  const actualParts = clubBonus > 0 ? [...kpi.actualParts, {
    key: 'club',
    value: clubBonus
  }] : kpi.actualParts;
  const pctOf = v => actualTotal > 0 ? Math.round(v / actualTotal * 100) : 0;
  const score = scorecardTotal(items);
  const isMgr = calc.isManager,
    isFd = calc.isFrontdesk;
  // 以下三個 detail 只會喺非店長版面用（店長行 mgrtier 分支）——
  // 老闆 2026-08-12：店長以下唔顯示總業績銀碼，只講「達／未達門檻」
  const newDetail = calc.acadGateOk === false ? `學院未達 $50k 門檻 · 學院佣暫不計` : `S1 ${calc.s1New || 0}·S2 ${calc.s2New || 0}·S1+S2 ${calc.comboNew || 0}(個人,歸成交者)`;
  const renewDetail = calc.acadGateOk === false ? `學院總業績 < $50k 門檻 · 暫不計` : `團隊 ${calc.renewals} 個 · $900/個 · 按職級固定分母分`;
  const hotelDetail = calc.hotelOver > 0 ? '已達門檻 · 超出部分 12% 入池 ÷ 編制 3' : '未達門檻 $200k';
  const compRowsBase = isMgr ? [{
    pk: 'mgrtier',
    value: kpi.actualParts[1].value,
    detail: calc.tierAmt > 0 ? `門店業績 ${money(calc.storeRevenue)} · 達 ${money(calc.tierMin)} 級 (已含學院交付獎)` : `門店業績 ${money(calc.storeRevenue)} · 未達 $320k`
  }] : isFd ? [{
    pk: 'base',
    value: kpi.actualParts[0].value,
    detail: '每月固定底薪 · 不受 KPI 影響'
  }, {
    pk: 'kpibonus',
    value: kpi.actualParts[1].value,
    detail: `KPI ${score} 分 · 發放 ${Math.round(kpi.ratio * 100)}%`
  }] : staff.dept === 'academy' ? [{
    pk: 'newcmm',
    value: kpi.actualParts[2].value,
    detail: staff.acadRank === 'assistant' ? '個人銷售佣 · 升初級導師後解鎖' : newDetail
  }, {
    pk: 'renew',
    value: kpi.actualParts[3].value,
    detail: renewDetail
  }] : [{
    pk: 'hotel',
    value: kpi.actualParts[1].value,
    detail: hotelDetail
  }, ...(calc.referral > 0 ? [{
    pk: 'referral',
    value: kpi.actualParts[4].value,
    detail: `成功轉介 ${calc.hotelReferrals} 隻 · $${calc.referralUnit || 180}/隻入池 ÷ 編制 3` + (promoBoost(team.monthKey) > 1 ? ' · 限期 ×1.5' : '')
  }] : [])];
  const subscribedCount = clubNoms.filter(n => n.staffId == staff.id && n.status === 'subscribed').length;
  const teamSubscribed = clubNoms.filter(n => n.status === 'subscribed').length;
  const clubDetail = `團隊 ${teamSubscribed} 個入會(我提名 ${subscribedCount} 個) · 按職級固定分母分` + (promoBoost(month) > 1 ? ' · 限期 ×1.5' : '');
  const compRows = clubBonus > 0 ? [...compRowsBase, {
    pk: 'club',
    value: clubBonus,
    detail: clubDetail
  }] : compRowsBase;
  return /*#__PURE__*/React.createElement(React.Fragment, null, kpi.ratio === 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-warn"
  }, "KPI ", kpi.reason ? kpi.reason : '未達 71 分', " \u2014 ", isFd ? '本月 KPI 獎金暫不發放 (底薪不受影響)' : '本月佣金暫不發放'), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-heroA"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, staff.name, " \xB7 ", roleKpi(kpiRoleOf(staff)).label, " \xB7 \u672C\u6708\u5BE6\u969B", isFd ? '收入' : '領取'), /*#__PURE__*/React.createElement(DonutChart, {
    parts: actualParts,
    total: actualTotal
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-ring-num"
  }, /*#__PURE__*/React.createElement("span", {
    className: "cur"
  }, "HK$"), moneyPlain(actualTotal)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-ring-sub"
  }, "\u672C\u6708\u9810\u8A08")), isFd ? /*#__PURE__*/React.createElement("div", {
    className: 'pwd-fixed ' + (kpi.ratio >= 1 ? 'on' : 'off')
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-fixed-dot"
  }), kpi.ratio >= 1 ? 'KPI 獎金 HK$2,000 全額發放' : `KPI ${score} 分 · 獎金發放 ${Math.round(kpi.ratio * 100)}%`) : null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-comp"
  }, compRows.map(r => {
    const meta = PARTS_META[r.pk];
    return /*#__PURE__*/React.createElement("div", {
      key: r.pk,
      className: "pwd-comp-row"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-comp-dot",
      style: {
        background: meta.color
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "pwd-comp-main"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-comp-label"
    }, meta.label), /*#__PURE__*/React.createElement("span", {
      className: "pwd-comp-detail"
    }, r.detail)), /*#__PURE__*/React.createElement("span", {
      className: "pwd-comp-pct"
    }, pctOf(r.value), "%"), /*#__PURE__*/React.createElement("span", {
      className: "pwd-comp-amt"
    }, money(r.value)));
  }))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, isFd ? 'KPI 獎金達成' : '目標達成 · 解鎖更高佣金'), isMgr ? /*#__PURE__*/React.createElement(ManagerGoal, {
    calc: calc
  }) : isFd ? /*#__PURE__*/React.createElement(FrontdeskGoal, {
    calc: calc,
    kpi: kpi,
    score: score
  }) : /*#__PURE__*/React.createElement(GoalUnlock, {
    team: team,
    calc: calc,
    role: staff.role,
    dept: staff.dept
  })), /*#__PURE__*/React.createElement(TrialCard, {
    staff: staff,
    slots: trialSlots,
    bookings: trialBookings,
    done: trialDone,
    onBook: onTrialBook,
    onCancel: onTrialCancel
  }), /*#__PURE__*/React.createElement(ClubCard, {
    staff: staff,
    noms: clubNoms,
    month: month,
    bonus: clubBonus,
    onSubmit: onClubSubmit
  }), /*#__PURE__*/React.createElement(CommissionHistory, {
    history: history,
    current: actualTotal,
    monthLabel: monthLabel
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-divider"
  }, /*#__PURE__*/React.createElement("span", null, "KPI \u7D50\u7B97 \xB7 \u6708\u5E95\u7531\u5E97\u9577\u8A55\u6838")), /*#__PURE__*/React.createElement(KpiCard, {
    role: kpiRoleOf(staff),
    items: items,
    score: score,
    kpi: kpi,
    editable: false
  }), /*#__PURE__*/React.createElement(KpiClauses, {
    lateLeave: lateLeave,
    dogEscape: dogEscape
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u8A08\u7B97 \u2192 KPI \u2192 \u5BE6\u969B\u9818\u53D6"), /*#__PURE__*/React.createElement(PayoutLedger, {
    calc: calc,
    kpi: kpi
  })), /*#__PURE__*/React.createElement(RateTable, {
    role: staff.role,
    dept: staff.dept
  }));
}

// ═══════════ DutyRoster ═══════════
function DutyRoster({
  staff,
  weeks,
  currentWeekIdx,
  todayDow,
  leave,
  leaveRecords,
  coworkers,
  onSwap
}) {
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
  const tag = isCurrent ? '本週' : weekIndex < currentWeekIdx ? '過去' : '未來';
  const curWeek = weeks[currentWeekIdx];
  const myShifts = buildWeekDays(curWeek, currentWeekIdx, currentWeekIdx, todayDow).map((d, i) => ({
    ...d,
    i
  })).filter(d => !d.off && d.i >= todayDow);
  useEffect(() => {
    if (view !== 'team') return;
    if (teamData && teamData.weekStart === week.weekStart) return;
    let cancelled = false;
    setTeamLoading(true);
    pwApi('teamRoster', {
      weekStart: week.weekStart
    }).then(res => {
      if (!cancelled && res.ok) setTeamData(res);
    }).finally(() => {
      if (!cancelled) setTeamLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [view, week.weekStart]);
  const teamDays = teamData && teamData.weekStart === week.weekStart ? teamData.days : null;
  async function requestSwap(s) {
    if (busy) return;
    setBusy(true);
    const dateStr = `${curWeek.weekStart.slice(0, 7)}-${String(s.date).padStart(2, '0')}`;
    await onSwap({
      date: dateStr,
      shift: `${s.label} ${s.time}`
    });
    setSwapDone(`${s.date}日 (${s.weekday}) ${s.label}`);
    setSwapOpen(false);
    setBusy(false);
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-roster-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-roster-nav"
  }, /*#__PURE__*/React.createElement("button", {
    className: "pwd-wk-btn",
    disabled: weekIndex <= 0,
    onClick: () => setWeekIndex(weekIndex - 1)
  }, "\u2039"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-roster-weekbox"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-roster-week"
  }, week.label), /*#__PURE__*/React.createElement("div", {
    className: "pwd-roster-tag"
  }, tag)), /*#__PURE__*/React.createElement("button", {
    className: "pwd-wk-btn",
    disabled: weekIndex >= weeks.length - 1,
    onClick: () => setWeekIndex(weekIndex + 1)
  }, "\u203A")), !isCurrent && /*#__PURE__*/React.createElement("button", {
    className: "pwd-wk-today",
    onClick: () => setWeekIndex(currentWeekIdx)
  }, "\u56DE\u672C\u9031")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-roster-sum"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, sum.workDays), " \u66F4"), /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, sum.weekHours), " \u6642")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-view-toggle"
  }, /*#__PURE__*/React.createElement("button", {
    className: view === 'mine' ? 'on' : '',
    onClick: () => setView('mine')
  }, "\u6211\u7684"), /*#__PURE__*/React.createElement("button", {
    className: view === 'team' ? 'on' : '',
    onClick: () => setView('team')
  }, "\u5168\u968A")), view === 'mine' && /*#__PURE__*/React.createElement("div", {
    className: "pwd-duty"
  }, days.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: 'pwd-duty-row' + (d.today ? ' today' : '') + (d.off ? ' off' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-duty-date"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-duty-wd"
  }, d.weekday), /*#__PURE__*/React.createElement("span", {
    className: "pwd-duty-num"
  }, d.date)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-duty-info"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-duty-shift"
  }, d.label), d.pos && /*#__PURE__*/React.createElement("span", {
    className: 'pwd-duty-pos sh-' + d.pos.cls
  }, d.pos.label)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-duty-right"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-duty-time"
  }, d.time || '—'), d.today && /*#__PURE__*/React.createElement("span", {
    className: "pwd-duty-now"
  }, "\u4ECA\u5929"))))), view === 'team' && /*#__PURE__*/React.createElement("div", {
    className: "pwd-duty"
  }, days.map((d, i) => {
    const people = teamDays ? teamDays[i] : [];
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: 'pwd-duty-row' + (d.today ? ' today' : '') + (!teamLoading && people.length === 0 ? ' off' : '')
    }, /*#__PURE__*/React.createElement("div", {
      className: "pwd-duty-date"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-wd"
    }, d.weekday), /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-num"
    }, d.date)), /*#__PURE__*/React.createElement("div", {
      className: "pwd-duty-team-people"
    }, teamLoading && !teamDays && /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-team-empty"
    }, "\u8F09\u5165\u4E2D\u2026"), teamDays && people.length === 0 && /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-team-empty"
    }, "\u4ECA\u65E5\u5187\u4EBA\u8FD4\u5DE5"), teamDays && people.map((c, ci) => /*#__PURE__*/React.createElement("span", {
      key: ci,
      className: "pwd-coworker"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-coworker-ava"
    }, c.initial), c.name, c.posKey && POSITIONS[c.posKey] ? ' · ' + POSITIONS[c.posKey].label : ''))), d.today && /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-now"
    }, "\u4ECA\u5929"));
  })), isCurrent && coworkers.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-coworkers"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-coworkers-lbl"
  }, "\u4ECA\u5929\u540C\u66F4"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-coworkers-list"
  }, coworkers.map((c, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "pwd-coworker"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-coworker-ava"
  }, c.initial), c.name, " \xB7 ", c.pos))))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-swap-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u63DB\u66F4 / \u8ABF\u66F4\u7533\u8ACB"), !swapOpen && /*#__PURE__*/React.createElement("button", {
    className: "pwd-swap-toggle",
    onClick: () => {
      setSwapOpen(true);
      setSwapDone(null);
    }
  }, "\uFF0B \u7533\u8ACB")), swapDone && /*#__PURE__*/React.createElement("div", {
    className: "pwd-swap-ok"
  }, "\u2713 \u5DF2\u63D0\u4EA4 ", swapDone, " \u63DB\u66F4\u7533\u8ACB,\u5F85\u5E97\u9577\u6279\u6838"), swapOpen && !swapDone && /*#__PURE__*/React.createElement("div", {
    className: "pwd-swap-list"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-swap-hint"
  }, "\u9078\u64C7\u60F3\u7533\u8ACB\u63DB\u66F4\u7684\u65E5\u5B50:"), myShifts.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph-empty"
  }, "\u672C\u9031\u4ECA\u5929\u8D77\u5DF2\u6C92\u6709\u53EF\u7533\u8ACB\u7684\u66F4"), myShifts.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.i,
    className: "pwd-swap-item",
    disabled: busy,
    onClick: () => requestSwap(s)
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-swap-date"
  }, s.date, "\u65E5 (", s.weekday, ")"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-swap-shift"
  }, s.label, " ", s.time), /*#__PURE__*/React.createElement("span", {
    className: "pwd-swap-arr"
  }, "\u203A"))), /*#__PURE__*/React.createElement("button", {
    className: "pwd-swap-cancel",
    onClick: () => setSwapOpen(false)
  }, "\u53D6\u6D88"))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-swap-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u8ACB\u5047\u8A18\u9304"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-leave-by-inline"
  }, "\u7531\u5E97\u9577\u767B\u8A18"))), leaveRecords.length > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "pwd-larec"
  }, leaveRecords.map((rec, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "pwd-larec-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: 'pwd-larec-type t-' + rec.type
  }, rec.type), /*#__PURE__*/React.createElement("span", {
    className: "pwd-larec-date"
  }, rec.date)))) : /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph-empty",
    style: {
      marginTop: 12
    }
  }, "\u672C\u6708\u66AB\u7121\u8ACB\u5047\u8A18\u9304")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-leave-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5047\u671F / \u7D50\u9918"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-leave-by"
  }, "\u7531\u5E97\u9577\u66F4\u65B0")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph-lbl"
  }, "\u5F85\u653E\u516C\u773E\u5047\u671F"), leave.ph && leave.ph.length ? /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph-list"
  }, leave.ph.map((p, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "pwd-ph-chip"
  }, "\uD83C\uDF8C ", p.name, " \xB7 ", p.date))) : /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph-empty"
  }, "\u672C\u6708\u66AB\u7121\u5F85\u653E\u516C\u773E\u5047\u671F")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-leave-grid"
  }, [{
    key: 'annual',
    lbl: '尚餘年假'
  }, {
    key: 'statutory',
    lbl: '例假結餘'
  }, {
    key: 'sick',
    lbl: '累積有薪病假'
  }].map(c => /*#__PURE__*/React.createElement("div", {
    key: c.key,
    className: "pwd-leave-cell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-leave-cell-lbl"
  }, c.lbl), /*#__PURE__*/React.createElement("div", {
    className: "pwd-leave-val big"
  }, leave[c.key], /*#__PURE__*/React.createElement("i", null, "\u65E5")))))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-foot"
  }, "\u66F4\u8868\u5982\u6709\u8ABF\u52D5,\u4EE5\u5E97\u9577\u516C\u4F48\u70BA\u6E96"));
}

// ═══════════ Manager helpers ═══════════
const MGR_AREAS = [{
  key: 'ops',
  label: '營運數據'
}, {
  key: 'kpi',
  label: 'KPI 評核'
}, {
  key: 'club',
  label: '會籍提名'
}, {
  key: 'swap',
  label: '換更審批'
}, {
  key: 'leave',
  label: '請假假期'
}, {
  key: 'roster',
  label: '排更'
}, {
  key: 'clean',
  label: '清潔檢查'
}, {
  key: 'ownerkpi',
  label: '評核店長 🔑'
}];
function datesFromWeekStart(weekStart) {
  const [y, m, d] = weekStart.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  return WEEKDAYS.map((_, i) => {
    const dd = new Date(base);
    dd.setDate(base.getDate() + i);
    return dd.getDate();
  });
}
// ── 週次導覽用日期 helper ──
function parseYMD(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtYMD(dt) {
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function mondayOf(dt) {
  const dow = (dt.getDay() + 6) % 7;
  const m = new Date(dt);
  m.setDate(dt.getDate() - dow);
  return m;
}
function shiftWeekStart(ws, deltaWeeks) {
  const m = parseYMD(ws);
  m.setDate(m.getDate() + deltaWeeks * 7);
  return fmtYMD(m);
}
function firstWeekStartOfMonth(month) {
  const [y, mo] = month.split('-').map(Number);
  return fmtYMD(mondayOf(new Date(y, mo - 1, 1)));
}
function weekRangeLabel(ws) {
  const b = parseYMD(ws),
    e = new Date(b);
  e.setDate(b.getDate() + 6);
  const bM = b.getMonth() + 1,
    eM = e.getMonth() + 1;
  return bM === eM ? `${bM}月 ${b.getDate()}–${e.getDate()}日` : `${bM}月${b.getDate()}日 – ${eM}月${e.getDate()}日`;
}
const DEFAULT_WEEK = () => [['off', null], ['off', null], ['off', null], ['off', null], ['off', null], ['off', null], ['off', null]];
function normWeek(arr) {
  const w = (Array.isArray(arr) ? arr : []).map(r => Array.isArray(r) ? r.slice() : ['off', null]);
  while (w.length < 7) w.push(['off', null]);
  return w.slice(0, 7);
}
function SaveBtn({
  onSave,
  label = '儲存到 Google Sheet'
}) {
  const [state, setState] = useState('idle'); // idle|saving|saved|err
  const [errMsg, setErrMsg] = useState('');
  async function go() {
    setState('saving');
    try {
      const r = await onSave();
      if (r && r.ok === false) {
        // 顯示後端真實原因；授權過期就教用戶點自救（唔好齋話「失敗」）
        const raw = r.error || '';
        setErrMsg(/未授權/.test(raw) ? '授權過期:請撳右上「🔒 鎖定」後重新輸入管理密碼,再儲存一次' : '儲存失敗:' + (raw || '請重試'));
        setState('err');
        setTimeout(() => setState('idle'), 6000);
      } else {
        setState('saved');
        setTimeout(() => setState('idle'), 2500);
      }
    } catch (e) {
      setErrMsg('網絡錯誤,請檢查連線後重試');
      setState('err');
      setTimeout(() => setState('idle'), 6000);
    }
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "pwd-mgr-savebtn",
    disabled: state === 'saving',
    onClick: go
  }, state === 'saving' ? '儲存中…' : state === 'saved' ? '✓ 已儲存' : label), state === 'err' && /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-saved",
    style: {
      color: 'var(--pw-danger)'
    }
  }, errMsg));
}

// ── 營運數據 ──
function MoneyField({
  label,
  value,
  onChange,
  note
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("label", null, label), /*#__PURE__*/React.createElement("div", {
    className: "pwd-money-input"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-money-cur"
  }, "HK$"), /*#__PURE__*/React.createElement("input", {
    className: "pwd-money-field",
    type: "text",
    inputMode: "numeric",
    value: (value || 0).toLocaleString('en-US'),
    onChange: e => onChange(Math.max(0, +e.target.value.replace(/[^0-9]/g, '') || 0))
  })), note && /*#__PURE__*/React.createElement("div", {
    className: "pwd-money-note"
  }, note));
}
function MgrOps({
  month,
  mgrData
}) {
  const [team, setTeam] = useState(() => ({
    ...mgrData.team,
    academyItems: {
      ...mgrData.team.academyItems
    }
  }));
  const set = (k, v) => setTeam(t => ({
    ...t,
    [k]: v
  }));
  const ACAD = [{
    key: 'trial',
    label: '試堂'
  }, {
    key: 's1',
    label: 'S1'
  }, {
    key: 's2',
    label: 'S2'
  }, {
    key: 'combo',
    label: 'S1+S2'
  }, {
    key: 'monthlyFee',
    label: '月費'
  }];
  const acad = team.academyItems || {
    trial: 0,
    s1: 0,
    s2: 0,
    combo: 0,
    monthlyFee: 0
  };
  const setAcad = (key, val) => {
    const next = {
      ...acad,
      [key]: val
    };
    const sum = ACAD.reduce((a, it) => a + (next[it.key] || 0), 0);
    setTeam(t => ({
      ...t,
      academyItems: next,
      academyRevenue: sum
    }));
  };
  const acadTotal = ACAD.reduce((a, it) => a + (acad[it.key] || 0), 0);
  // 舊生續報池按學院職級分(資深=owner不抽池,故排除 manager);冇職級資料時 fallback 平分
  const poolStaff = mgrData.staffList.filter(s => s.role !== 'manager' && s.role !== 'frontdesk' && s.dept !== 'academy');
  const acadWeightTotal = ACAD_WEIGHT_TOTAL; // 固定分母 5,預留未填份額
  const teamForCalc = {
    ...team,
    academyRevenue: acadTotal,
    acadWeightTotal,
    headcount: poolStaff.length || HEADCOUNT
  };
  const storeRev = storeRevenueOf(teamForCalc);
  // owner 行唔係員工,唔可以入預覽總額(dept 空白會被當酒店部食一份池,8/25 開 owner 帳戶起嘅幽靈數)
  const previewTotal = mgrData.staffList.filter(s => s.role !== 'owner').reduce((a, s) => {
    const k = mgrData.allKpi[s.id] || {
      kpiFail: [],
      lateLeave: 0
    };
    const att = mgrData.allAttendance && mgrData.allAttendance[s.id] != null ? mgrData.allAttendance[s.id] : 0;
    // 個人新生數(allSales)＋會籍獎金要入埋,先同員工個人頁/月結引擎一條數(2026-09-02 修,同 OwnerCommissionTable)
    const sales = mgrData.allSales && mgrData.allSales[s.id] || {};
    const {
      kpi
    } = fullResult({
      ...s,
      ...sales,
      attendance: att,
      kpiFail: k.kpiFail,
      lateLeave: k.lateLeave
    }, teamForCalc);
    return a + kpi.actualTotal + clubBonusFor(s, mgrData.allNoms, team.monthKey || '');
  }, 0);
  function save() {
    return pwApi('saveOps', {
      month,
      hotelRevenue: team.hotelRevenue,
      academyRevenue: acadTotal,
      trial: acad.trial || 0,
      s1: acad.s1 || 0,
      s2: acad.s2 || 0,
      combo: acad.combo || 0,
      monthlyFee: acad.monthlyFee || 0,
      newStudents: (team.s1New || 0) + (team.s2New || 0) + (team.comboNew || 0),
      renewals: team.renewals,
      s1New: team.s1New || 0,
      s2New: team.s2New || 0,
      comboNew: team.comboNew || 0,
      pickup: team.pickup || 0,
      groomBasic: team.groomBasic || 0,
      groomStar: team.groomStar || 0,
      packageRevenue: team.packageRevenue || 0,
      packages: team.packages,
      other: team.other || 0,
      dogEscape: team.dogEscape ? 'true' : 'false',
      hotelReferrals: team.hotelReferrals || 0
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-stack"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "A. \u9152\u5E97\u7E3D\u696D\u7E3E (\u542B\u57FA\u672C\u7F8E\u5BB9,\u8A08\u4F63)"), /*#__PURE__*/React.createElement(MoneyField, {
    label: "\u9152\u5E97\u7E3D\u696D\u7E3E",
    value: team.hotelRevenue,
    onChange: v => set('hotelRevenue', v),
    note: "\u9580\u6ABB HK$200,000 \xB7 \u8D85\u51FA 12% \u70BA\u7167\u9867\u54E1\u9152\u5E97\u4F63\u91D1\u6C60"
  }), /*#__PURE__*/React.createElement(MoneyField, {
    label: "D. \u57FA\u672C\u7F8E\u5BB9\u7E3D\u696D\u7E3E",
    value: team.groomBasic,
    onChange: v => set('groomBasic', v),
    note: "\u6B78\u7D0D\u5165\u9152\u5E97\u7E3D\u696D\u7E3E\u4E00\u9F4A\u8A08\u4F63"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-storerow"
  }, /*#__PURE__*/React.createElement("span", null, "\u9152\u5E97\u8A08\u4F63\u57FA\u6578 (\u9152\u5E97 + \u57FA\u672C\u7F8E\u5BB9)"), /*#__PURE__*/React.createElement("b", null, money(hotelForCommission(team))))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "B. \u5B78\u9662\u7E3D\u696D\u7E3E \xB7 \u5206\u9805\u8F38\u5165"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-acad-items"
  }, ACAD.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.key,
    className: "pwd-acad-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-acad-lbl"
  }, it.label), /*#__PURE__*/React.createElement("div", {
    className: "pwd-acad-input"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-acad-cur"
  }, "HK$"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    inputMode: "numeric",
    value: (acad[it.key] || 0).toLocaleString('en-US'),
    onChange: e => setAcad(it.key, Math.max(0, +e.target.value.replace(/[^0-9]/g, '') || 0))
  })))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-acad-sum"
  }, /*#__PURE__*/React.createElement("span", null, "\u5B78\u9662\u7E3D\u696D\u7E3E\u5408\u8A08"), /*#__PURE__*/React.createElement("b", null, money(acadTotal))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-storerow",
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u5B78\u9662 $50,000 \u6536\u5165\u9580\u6ABB"), /*#__PURE__*/React.createElement("b", {
    style: {
      color: acadTotal >= TARGETS.academyThreshold ? '#2e7d32' : '#c0392b'
    }
  }, acadTotal >= TARGETS.academyThreshold ? '✓ 已過 · 派學院佣' : `差 ${money(TARGETS.academyThreshold - acadTotal)} · 學院佣暫 $0`))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("label", null, "\u820A\u751F\u7E8C\u5831 (\u7E7C\u5831)"), /*#__PURE__*/React.createElement(Stepper, {
    value: team.renewals,
    suffix: "\u500B",
    hint: "$900\uFF0F\u500B \xB7 \u6309\u8077\u7D1A\u56FA\u5B9A\u5206\u6BCD\u5206",
    onChange: v => set('renewals', v)
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("label", null, "\u9152\u5E97\u8F49\u4ECB\u6210\u529F\u5831\u8B80\u5B78\u9662"), /*#__PURE__*/React.createElement(Stepper, {
    value: team.hotelReferrals || 0,
    suffix: "\u96BB",
    hint: "$180\uFF0F\u96BB\u5165\u9152\u5E97\u8F49\u4ECB\u6C60 \xF7 \u7DE8\u5236 3 \xB7 \u6309\u8F49\u5316\u8A08,\u6D3E\u5238\u5514\u8A08",
    onChange: v => set('hotelReferrals', v)
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-storerow",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u5B78\u9662\u65B0\u751F\u7E3D\u6578(\u5404\u54E1\u5DE5\u300CKPI \u8A55\u6838\u300D\u81EA\u52D5\u52A0\u7E3D)"), /*#__PURE__*/React.createElement("b", null, Object.values(mgrData.allSales || {}).reduce((a, s) => a + (s.s1New || 0) + (s.s2New || 0) + (s.comboNew || 0), 0), " \u96BB"))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5176\u4ED6\u696D\u7E3E\u7DDA"), /*#__PURE__*/React.createElement(MoneyField, {
    label: "C. \u63A5\u9001\u7E3D\u696D\u7E3E",
    value: team.pickup,
    onChange: v => set('pickup', v),
    note: "\u8A08\u5165\u5E97\u9577\u696D\u7E3E \xB7 \u4E0D\u5206\u54E1\u5DE5\u4F63\u91D1"
  }), /*#__PURE__*/React.createElement(MoneyField, {
    label: "E. \u661F\u7D1A\u7F8E\u5BB9\u7E3D\u696D\u7E3E",
    value: team.groomStar,
    onChange: v => set('groomStar', v),
    note: "\u8A08\u5165\u5E97\u9577\u696D\u7E3E \xB7 \u4E0D\u5206\u54E1\u5DE5\u4F63\u91D1"
  }), /*#__PURE__*/React.createElement(MoneyField, {
    label: "F. \u5957\u7968\u7E3D\u696D\u7E3E",
    value: team.packageRevenue,
    onChange: v => set('packageRevenue', v),
    note: "\u516C\u53F8\u73FE\u91D1\u6D41 \xB7 \u4E0D\u8A08\u5165\u4EFB\u4F55\u4F63\u91D1"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("label", null, "\u5957\u7968\u6578\u91CF (\u5E97\u9577 KPI)"), /*#__PURE__*/React.createElement(Stepper, {
    value: team.packages,
    suffix: "\u500B",
    hint: "\u76EE\u6A19 \u2265 12",
    onChange: v => set('packages', v)
  })), /*#__PURE__*/React.createElement(MoneyField, {
    label: "G. \u5176\u4ED6",
    value: team.other,
    onChange: v => set('other', v),
    note: "\u53EA\u8A18\u9304 \xB7 \u4E0D\u8A08\u5165\u4F63\u91D1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-mgr-preview"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u9580\u5E97\u7E3D\u696D\u7E3E \xB7 \u5E97\u9577\u4F63\u91D1\u57FA\u6E96"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-preview-num"
  }, money(storeRev)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-preview-sub"
  }, "\u9152\u5E97 + \u5B78\u9662 + \u57FA\u672C\u7F8E\u5BB9 + \u661F\u7D1A\u7F8E\u5BB9 + \u63A5\u9001(\u5957\u7968\u3001\u5176\u4ED6\u9664\u5916)")), /*#__PURE__*/React.createElement("div", {
    className: 'pwd-card pwd-mgr-danger' + (team.dogEscape ? ' on' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-danger-text"
  }, /*#__PURE__*/React.createElement("b", null, "\u8D70\u5931\u72D7\u72D7\u4E8B\u6545"), /*#__PURE__*/React.createElement("span", null, "\u958B\u555F \u2192 \u672C\u6708\u5718\u968A\u5168\u54E1 KPI \u76F4\u63A5\u70BA 0")), /*#__PURE__*/React.createElement("button", {
    className: 'pwd-toggle' + (team.dogEscape ? ' on' : ''),
    onClick: () => set('dogEscape', !team.dogEscape)
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-toggle-knob"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-mgr-preview"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5718\u968A\u672C\u6708\u5BE6\u969B\u9818\u53D6\u5408\u8A08 (\u9810\u89BD)"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-preview-num"
  }, money(previewTotal)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-preview-sub"
  }, "\u5DF2\u8A08\u5165\u5404\u4EBA KPI \u767C\u653E")), /*#__PURE__*/React.createElement(SaveBtn, {
    onSave: save
  }));
}

// ── KPI 評核 ──
function MgrKpi({
  month,
  mgrData
}) {
  const list = mgrData.staffList.filter(s => s.role !== 'manager');
  const [sel, setSel] = useState(list[0] ? list[0].id : null);
  const staff = list.find(s => s.id == sel);
  const k0 = mgrData.allKpi[sel] || {
    kpiFail: [],
    lateLeave: 0
  };
  const [fail, setFail] = useState(() => k0.kpiFail.slice());
  const [lateLeave, setLate] = useState(k0.lateLeave || 0);
  const sl0 = mgrData.allSales && mgrData.allSales[sel] || {};
  const [sales, setSales] = useState(() => ({
    s1New: sl0.s1New || 0,
    s2New: sl0.s2New || 0,
    comboNew: sl0.comboNew || 0
  }));
  const [acadRank, setAcadRank] = useState(staff.acadRank || 'junior');
  // 學院出勤由更表自動計,唯讀
  const att = mgrData.allAttendance && mgrData.allAttendance[sel] != null ? mgrData.allAttendance[sel] : 0;
  function reseed(id) {
    const k = mgrData.allKpi[id] || {
      kpiFail: [],
      lateLeave: 0
    };
    const sl = mgrData.allSales && mgrData.allSales[id] || {};
    const st = list.find(s => s.id == id) || {};
    setSel(id);
    setFail(k.kpiFail.slice());
    setLate(k.lateLeave || 0);
    setSales({
      s1New: sl.s1New || 0,
      s2New: sl.s2New || 0,
      comboNew: sl.comboNew || 0
    });
    setAcadRank(st.acadRank || 'junior');
  }
  const items = buildScorecard(kpiRoleOf(staff), fail);
  const poolStaff = list.filter(s => s.role !== 'frontdesk' && s.dept !== 'academy');
  const acadWeightTotal = ACAD_WEIGHT_TOTAL; // 固定分母 5,預留未填份額
  const {
    calc,
    kpi
  } = fullResult({
    ...staff,
    ...sales,
    acadRank,
    attendance: att,
    kpiFail: fail,
    lateLeave
  }, {
    ...mgrData.team,
    acadWeightTotal,
    headcount: poolStaff.length || HEADCOUNT
  }, {
    scorecard: items,
    lateLeave
  });
  const score = scorecardTotal(items);
  const tone = kpi.ratio >= 1 ? 'full' : kpi.ratio > 0 ? 'mid' : 'zero';
  const toggle = id => setFail(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]);
  // 酒店部冇職級選單 → 唔准送 acadRank(後端見空字串會跳過寫入),避免無意中標成學院初級導師
  function save() {
    return pwApi('saveKpi', {
      month,
      staffId: sel,
      lateLeave,
      kpiFail: fail.join(','),
      s1New: sales.s1New,
      s2New: sales.s2New,
      comboNew: sales.comboNew,
      acadRank: staff.dept === 'hotel' ? '' : acadRank
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-stack"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-people"
  }, list.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.id,
    className: 'pwd-mgr-person' + (sel == s.id ? ' on' : ''),
    onClick: () => reseed(s.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgr-person-ava"
  }, s.initial), s.name))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, roleKpi(kpiRoleOf(staff)).label, " \xB7 KPI \u8A55\u6838"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-band"
  }, "\u767C\u653E\u6BD4\u4F8B ", /*#__PURE__*/React.createElement("b", {
    className: 'r-' + tone
  }, Math.round(kpi.ratio * 100), "%"), " \xB7 ", kpi.band)), /*#__PURE__*/React.createElement("div", {
    className: 'pwd-kpi-score r-' + tone
  }, /*#__PURE__*/React.createElement("span", {
    className: "n"
  }, score), /*#__PURE__*/React.createElement("span", {
    className: "d"
  }, "\u5206"))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-items"
  }, items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.id,
    className: 'pwd-kpi-item edit' + (it.pass ? ' pass' : ' fail'),
    onClick: () => toggle(it.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-check"
  }, it.pass ? '✓' : '✕'), /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-text"
  }, it.text, it.team && /*#__PURE__*/React.createElement("em", {
    className: "pwd-kpi-team"
  }, "\u5718\u968A")), /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-w"
  }, it.weight))))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-mgr-late"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-late-row"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "\u7576\u6708\u9072\u5230 / \u8ACB\u5047\u6B21\u6578"), /*#__PURE__*/React.createElement("span", null, "\u8D85\u904E 3 \u6B21 \u2192 KPI \u76F4\u63A5\u70BA 0")), /*#__PURE__*/React.createElement(Stepper, {
    value: lateLeave,
    suffix: "\u6B21",
    onChange: setLate
  })), lateLeave > 3 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-warn",
    style: {
      marginTop: 12
    }
  }, "\u5DF2\u8D85\u904E 3 \u6B21 \u2014 ", staff.name, " \u672C\u6708 KPI \u5C07\u70BA 0")), staff.role !== 'frontdesk' && /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, staff.name, " \xB7 \u5B78\u9662\u65B0\u751F\u92B7\u552E(\u500B\u4EBA\u6B78\u6210\u4EA4\u8005)"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-fieldgrid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field"
  }, /*#__PURE__*/React.createElement("label", null, "S1"), /*#__PURE__*/React.createElement(Stepper, {
    value: sales.s1New,
    suffix: "\u96BB",
    hint: "$500",
    onChange: v => setSales(s => ({
      ...s,
      s1New: v
    }))
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field"
  }, /*#__PURE__*/React.createElement("label", null, "S2"), /*#__PURE__*/React.createElement(Stepper, {
    value: sales.s2New,
    suffix: "\u96BB",
    hint: "$300",
    onChange: v => setSales(s => ({
      ...s,
      s2New: v
    }))
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field"
  }, /*#__PURE__*/React.createElement("label", null, "S1+S2"), /*#__PURE__*/React.createElement(Stepper, {
    value: sales.comboNew,
    suffix: "\u96BB",
    hint: "$900",
    onChange: v => setSales(s => ({
      ...s,
      comboNew: v
    }))
  }))), staff.dept !== 'hotel' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow",
    style: {
      marginTop: 14
    }
  }, "\u5B78\u9662\u8077\u7D1A(\u820A\u751F\u7E8C\u5831\u6C60\u6309\u8077\u7D1A\u5206)"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-tierconfirm"
  }, [['assistant', '助教'], ['junior', '初級導師'], ['senior', '資深導師']].map(([v, l]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    className: "pwd-club-tierconfirm-btn",
    style: acadRank === v ? {
      background: 'var(--pw-navy)',
      color: '#fff'
    } : {},
    onClick: () => setAcadRank(v)
  }, l))))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-mgr-result"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, staff.name, " \u672C\u6708\u5BE6\u969B\u9818\u53D6"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-result-num"
  }, money(kpi.actualTotal)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-result-sub"
  }, "\u8A08\u7B97 ", money(calc.total), " \xD7 ", Math.round(kpi.ratio * 100), "% \u767C\u653E")), /*#__PURE__*/React.createElement(SaveBtn, {
    onSave: save,
    label: `儲存 ${staff.name} 的評核`
  }));
}

// ── 換更審批 ──
function MgrSwap({
  mgrData
}) {
  const nameOf = id => {
    const s = mgrData.staffList.find(x => x.id == id);
    return s ? s.name : id;
  };
  const initOf = id => {
    const s = mgrData.staffList.find(x => x.id == id);
    return s ? s.initial : '?';
  };
  const [reqs, setReqs] = useState(() => mgrData.allSwaps.map(r => ({
    ...r
  })));
  async function act(id, status) {
    const prev = reqs.find(r => r.id === id);
    setReqs(rs => rs.map(r => r.id === id ? {
      ...r,
      status
    } : r));
    await pwWrite('approveSwap', {
      swapId: id,
      status
    }, () => setReqs(rs => rs.map(r => r.id === id ? {
      ...r,
      status: prev ? prev.status : 'pending'
    } : r)));
  }
  const pending = reqs.filter(r => r.status === 'pending');
  const done = reqs.filter(r => r.status !== 'pending');
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-stack"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5F85\u5BE9\u6279 (", pending.length, ")"), pending.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph-empty",
    style: {
      marginTop: 12
    }
  }, "\u6C92\u6709\u5F85\u5BE9\u6279\u7684\u63DB\u66F4\u7533\u8ACB") : /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swaps"
  }, pending.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.id,
    className: "pwd-mgr-swap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swap-top"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgr-swap-ava"
  }, initOf(r.staffId)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swap-info"
  }, /*#__PURE__*/React.createElement("b", null, nameOf(r.staffId), " \xB7 ", r.date), /*#__PURE__*/React.createElement("span", null, r.shift, r.note ? ' · ' + r.note : ''))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swap-acts"
  }, /*#__PURE__*/React.createElement("button", {
    className: "pwd-btn-reject",
    onClick: () => act(r.id, 'rejected')
  }, "\u62D2\u7D55"), /*#__PURE__*/React.createElement("button", {
    className: "pwd-btn-approve",
    onClick: () => act(r.id, 'approved')
  }, "\u6279\u51C6")))))), done.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5DF2\u8655\u7406"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swaps"
  }, done.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.id,
    className: "pwd-mgr-swap done"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgr-swap-ava"
  }, initOf(r.staffId)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swap-info"
  }, /*#__PURE__*/React.createElement("b", null, nameOf(r.staffId), " \xB7 ", r.date), /*#__PURE__*/React.createElement("span", null, r.shift)), /*#__PURE__*/React.createElement("span", {
    className: 'pwd-mgr-swap-status ' + r.status
  }, r.status === 'approved' ? '已批准' : '已拒絕'))))));
}

// ── 請假 / 假期結餘 ──
function MgrLeave({
  month,
  mgrData
}) {
  const list = mgrData.staffList.filter(s => s.role !== 'manager');
  const [sel, setSel] = useState(list[0] ? list[0].id : null);
  const staff = list.find(s => s.id == sel);
  const b0 = mgrData.allLeaveBal[sel] || {
    annual: 0,
    statutory: 0,
    sick: 0
  };
  const [bal, setBal] = useState({
    annual: b0.annual,
    statutory: b0.statutory,
    sick: b0.sick
  });
  const [recs, setRecs] = useState(() => (mgrData.allLeaveRec[sel] || []).slice());
  const [type, setType] = useState('年假');
  const [date, setDate] = useState('');
  const [phs, setPhs] = useState(() => (mgrData.allPH && mgrData.allPH[sel] || []).slice());
  const [phName, setPhName] = useState('');
  const [phDate, setPhDate] = useState('');
  const [err, setErr] = useState('');
  function reseed(id) {
    const b = mgrData.allLeaveBal[id] || {
      annual: 0,
      statutory: 0,
      sick: 0
    };
    setSel(id);
    setBal({
      annual: b.annual,
      statutory: b.statutory,
      sick: b.sick
    });
    setRecs((mgrData.allLeaveRec[id] || []).slice());
    setDate('');
    setPhs((mgrData.allPH && mgrData.allPH[id] || []).slice());
    setPhName('');
    setPhDate('');
    setErr('');
  }
  // ⚠️ 2026-08-12 幽靈條目事故：呢版嘅寫入全部係樂觀更新，之前完全冇 check 後端回咩——
  // 授權過期(WRITE_GUARD 回「未授權」)照樣喺畫面加咗行，店長以為儲咗，一 reload 就無晒。
  // 同 2026-07-06「更表儲存唔到」係同一種病(嗰次只修咗 SaveBtn)。
  // 而家一律：失敗就縮返畫面 ＋ 顯示後端真實錯誤，做唔到一定睇得見。
  async function write(action, params, revert) {
    setErr('');
    return pwWrite(action, params, revert, setErr); // 呢版用頂部紅字 banner，唔用 alert
  }
  const adj = (k, d) => setBal(b => ({
    ...b,
    [k]: Math.max(0, +(b[k] + d).toFixed(1))
  }));
  const fmtDate = iso => {
    const [, m, d] = iso.split('-');
    return `${+m}月${+d}日`;
  };
  function saveBal() {
    return pwApi('saveLeave', {
      month,
      staffId: sel,
      annual: bal.annual,
      statutory: bal.statutory,
      sick: bal.sick
    });
  }
  async function addRec() {
    if (!date) return;
    const ds = fmtDate(date),
      t = type,
      keep = date;
    setRecs(r => [...r, {
      date: ds,
      type: t
    }]);
    setDate('');
    await write('addLeaveRec', {
      month,
      staffId: sel,
      date: ds,
      type: t
    }, () => {
      setRecs(r => r.filter(x => !(x.date === ds && x.type === t)));
      setDate(keep);
    });
  }
  async function delRec(rec, i) {
    setRecs(r => r.filter((_, j) => j !== i));
    await write('deleteLeaveRec', {
      month,
      staffId: sel,
      date: rec.date,
      type: rec.type
    }, () => setRecs(r => {
      const c = r.slice();
      c.splice(i, 0, rec);
      return c;
    }));
  }
  async function addPH() {
    if (!phName.trim() || !phDate) return;
    const nm = phName.trim(),
      ds = fmtDate(phDate),
      keep = phDate;
    setPhs(p => [...p, {
      name: nm,
      date: ds
    }]);
    setPhName('');
    setPhDate('');
    await write('addPH', {
      month,
      staffId: sel,
      name: nm,
      date: ds
    }, () => {
      setPhs(p => p.filter(x => !(x.name === nm && x.date === ds)));
      setPhName(nm);
      setPhDate(keep);
    }); // 打返嘅字唔好蒸發,即刻可以重試
  }
  // 「待放公眾假期」＝仲欠員工幾多日未放。放咗就撳 ✕ 移走，一個掣一句確認（老闆 2026-08-12 定）。
  // 唔另外寫請假記錄——之前試過分開「✓已放」同「✕刪除」兩個掣，店長覺得亂；而且一個掣
  // 就唔會出現「入錯想刪都製造咗假嘅放假記錄」呢個問題。
  async function delPH(p, i) {
    const who = staff ? staff.name : '該員工';
    if (!window.confirm('確認移走 ' + who + ' 嘅「' + p.name + ' ' + p.date + '」？\n\n即係已經放咗，或者入錯想刪。')) return;
    setPhs(arr => arr.filter((_, j) => j !== i));
    await write('deletePH', {
      month,
      staffId: sel,
      name: p.name,
      date: p.date
    }, () => setPhs(arr => {
      const c = arr.slice();
      c.splice(i, 0, p);
      return c;
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-stack"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-people"
  }, list.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.id,
    className: 'pwd-mgr-person' + (sel == s.id ? ' on' : ''),
    onClick: () => reseed(s.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgr-person-ava"
  }, s.initial), s.name))), err && /*#__PURE__*/React.createElement("div", {
    className: "pwd-warn"
  }, "\u26A0\uFE0F ", err), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, staff.name, " \xB7 \u5047\u671F\u7D50\u9918 (\u53EF\u8ABF\u6574)"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-leave-grid"
  }, [{
    key: 'annual',
    lbl: '尚餘年假',
    step: 1
  }, {
    key: 'statutory',
    lbl: '例假結餘',
    step: 1
  }, {
    key: 'sick',
    lbl: '累積有薪病假',
    step: 0.5
  }].map(c => /*#__PURE__*/React.createElement("div", {
    key: c.key,
    className: "pwd-leave-cell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-leave-cell-lbl"
  }, c.lbl), /*#__PURE__*/React.createElement("div", {
    className: "pwd-leave-edit"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => adj(c.key, -c.step)
  }, "\u2212"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-leave-val"
  }, bal[c.key], /*#__PURE__*/React.createElement("i", null, "\u65E5")), /*#__PURE__*/React.createElement("button", {
    onClick: () => adj(c.key, c.step)
  }, "\uFF0B"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(SaveBtn, {
    onSave: saveBal,
    label: "\u5132\u5B58\u7D50\u9918"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u767B\u8A18\u8ACB\u5047"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-la-types",
    style: {
      marginTop: 12
    }
  }, ['年假', '例假', '病假', '事假'].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    className: 'pwd-la-chip' + (type === t ? ' on' : ''),
    onClick: () => setType(t)
  }, t))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-la-daterow"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-la-datelbl"
  }, "\u8ACB\u5047\u65E5\u671F"), /*#__PURE__*/React.createElement("input", {
    className: "pwd-la-date",
    type: "date",
    value: date,
    onChange: e => setDate(e.target.value)
  })), /*#__PURE__*/React.createElement("button", {
    className: "pwd-la-confirm",
    style: {
      marginTop: 12,
      width: '100%'
    },
    disabled: !date,
    onClick: addRec
  }, "\uFF0B \u70BA ", staff.name, " \u767B\u8A18", date ? ` ${fmtDate(date)} ` : '', type), /*#__PURE__*/React.createElement("div", {
    className: "pwd-larec",
    style: {
      marginTop: 14
    }
  }, recs.map((rec, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "pwd-larec-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: 'pwd-larec-type t-' + rec.type
  }, rec.type), /*#__PURE__*/React.createElement("span", {
    className: "pwd-larec-date"
  }, rec.date), /*#__PURE__*/React.createElement("button", {
    className: "pwd-larec-del",
    onClick: () => delRec(rec, i)
  }, "\u2715"))))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5F85\u653E\u516C\u773E\u5047\u671F (\u54E1\u5DE5\u9801\u986F\u793A)"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-frow",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "pwd-club-input",
    placeholder: "\u5047\u671F\u540D\u7A31(\u4F8B:\u52DE\u52D5\u7BC0)",
    value: phName,
    onChange: e => setPhName(e.target.value)
  }), /*#__PURE__*/React.createElement("input", {
    className: "pwd-la-date",
    type: "date",
    value: phDate,
    onChange: e => setPhDate(e.target.value)
  })), /*#__PURE__*/React.createElement("button", {
    className: "pwd-la-confirm",
    style: {
      marginTop: 12,
      width: '100%'
    },
    disabled: !phName.trim() || !phDate,
    onClick: addPH
  }, "\uFF0B \u70BA ", staff.name, " \u767B\u8A18\u5F85\u653E\u516C\u773E\u5047\u671F"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-larec",
    style: {
      marginTop: 14
    }
  }, phs.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "pwd-larec-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-larec-type"
  }, "\uD83C\uDF8C ", p.name), /*#__PURE__*/React.createElement("span", {
    className: "pwd-larec-date"
  }, p.date), /*#__PURE__*/React.createElement("button", {
    className: "pwd-larec-del",
    onClick: () => delPH(p, i)
  }, "\u2715"))), phs.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph-empty"
  }, "\u672A\u6709\u767B\u8A18\u5F85\u653E\u516C\u773E\u5047\u671F"))));
}

// ── 排更 ──
function MgrRoster({
  mgrData
}) {
  const list = mgrData.staffList;
  const [sel, setSel] = useState(list[0] ? list[0].id : null);
  const [weekStart, setWeekStart] = useState(() => mgrData.weekStart); // 由本週開始,用左右鍵自由揭週次
  const [shifts, setShifts] = useState(() => weekStart === mgrData.weekStart && mgrData.allRosters[sel] ? normWeek(mgrData.allRosters[sel]) : null);
  const [savedShifts, setSavedShifts] = useState(() => weekStart === mgrData.weekStart && mgrData.allRosters[sel] ? normWeek(mgrData.allRosters[sel]) : DEFAULT_WEEK());
  const [loading, setLoading] = useState(false);
  const SHIFT_CYCLE = ['early', 'mid', 'full', 'off'];
  const SHIFT_LABEL = {
    early: '早更',
    mid: '午更',
    full: '全日更',
    off: '休息'
  };
  const POS_LABEL = {
    academyA: '學院A位',
    academyB: '學院B位',
    assist: '助教',
    hotelA: '酒店A位',
    hotelB: '酒店B位',
    hotelC: '酒店C位',
    academy: '學院',
    reception: '前台'
  };

  // 載入所選員工 + 所選週次嗀更表
  useEffect(() => {
    let active = true;
    setLoading(true);
    pwApi('rosterWeek', {
      staffId: sel,
      weekStart
    }).then(res => {
      if (!active) return;
      const w = res && res.ok ? normWeek(res.shifts) : DEFAULT_WEEK();
      setShifts(w);
      setSavedShifts(w);
      setLoading(false);
    }).catch(() => {
      if (active) {
        setShifts(DEFAULT_WEEK());
        setSavedShifts(DEFAULT_WEEK());
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
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
    const r = await pwApi('saveRoster', {
      weekStart,
      staffId: sel,
      shifts: JSON.stringify(cur)
    });
    // 只有真係寫入咗先當已儲存——否則「未儲存」提示會喺失敗時消失，睇落好似儲好咗
    if (r && r.ok !== false) setSavedShifts(cur);
    return r; // SaveBtn 會顯示後端真實錯誤
  }
  const unsaved = JSON.stringify(cur) !== JSON.stringify(savedShifts);
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-stack"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-people"
  }, list.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.id,
    className: 'pwd-mgr-person' + (sel == s.id ? ' on' : ''),
    onClick: () => setSel(s.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgr-person-ava"
  }, s.initial), s.name))), unsaved && /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-rostersave",
    style: {
      color: 'var(--pw-gold-deep)',
      fontWeight: 800
    }
  }, "\u26A0 \u672A\u767C\u4F48 \u2014 \u8A18\u5F97\u64B3\u4E0B\u9762\u300C\u767C\u4F48\u672C\u9031\u6392\u66F4\u300D\u5148\u6703\u5B58\u5165\u7CFB\u7D71"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-roster-weeknav"
  }, /*#__PURE__*/React.createElement("button", {
    className: "pwd-weeknav-btn",
    onClick: () => setWeekStart(w => shiftWeekStart(w, -1))
  }, "\u25C0 \u4E0A\u9031"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-weeknav-label"
  }, weekRangeLabel(weekStart)), /*#__PURE__*/React.createElement("button", {
    className: "pwd-weeknav-btn",
    onClick: () => setWeekStart(w => shiftWeekStart(w, 1))
  }, "\u4E0B\u9031 \u25B6")), loading ? /*#__PURE__*/React.createElement("div", {
    className: "pwd-loading-txt",
    style: {
      color: 'var(--pw-ink-mute)',
      padding: '20px 0'
    }
  }, "\u8F09\u5165\u66F4\u8868\u2026") : /*#__PURE__*/React.createElement("div", {
    className: "pwd-duty",
    style: {
      marginTop: 14
    }
  }, WEEKDAYS.map((wd, i) => {
    const r = cur[i] || ['off', null];
    const off = r[0] === 'off';
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: 'pwd-duty-row' + (off ? ' off' : '')
    }, /*#__PURE__*/React.createElement("div", {
      className: "pwd-duty-date"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-wd"
    }, wd), /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-num"
    }, dates[i])), /*#__PURE__*/React.createElement("div", {
      className: "pwd-mgr-selwrap"
    }, /*#__PURE__*/React.createElement("select", {
      className: "pwd-mgr-sel",
      value: r[0],
      onChange: e => setDay(i, e.target.value, r[1])
    }, SHIFT_CYCLE.map(k => /*#__PURE__*/React.createElement("option", {
      key: k,
      value: k
    }, SHIFT_LABEL[k])))), /*#__PURE__*/React.createElement("div", {
      className: "pwd-mgr-selwrap"
    }, /*#__PURE__*/React.createElement("select", {
      className: 'pwd-mgr-sel pos' + (r[1] ? ' sh-' + (POSITIONS[r[1]] && POSITIONS[r[1]].cls || r[1]) : ''),
      value: r[1] || '',
      disabled: off,
      onChange: e => setDay(i, r[0], e.target.value || null)
    }, off ? /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u2014") : [/*#__PURE__*/React.createElement("option", {
      key: "none",
      value: ""
    }, "\u672A\u5B9A\u5D17"), ...['academyA', 'academyB', 'assist', 'hotelA', 'hotelB', 'hotelC'].map(k => /*#__PURE__*/React.createElement("option", {
      key: k,
      value: k
    }, POS_LABEL[k]))])));
  }))), /*#__PURE__*/React.createElement(SaveBtn, {
    onSave: save,
    label: "\u767C\u4F48\u672C\u9031\u6392\u66F4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-rostersave"
  }, "\u767C\u4F48\u5F8C\u54E1\u5DE5\u5373\u6642\u770B\u5230"));
}

// ── 會籍提名審批 ──
function MgrClub({
  mgrData
}) {
  const nameOf = id => {
    const s = mgrData.staffList.find(x => x.id == id);
    return s ? s.name : id;
  };
  const initOf = id => {
    const s = mgrData.staffList.find(x => x.id == id);
    return s ? s.initial : '?';
  };
  const [noms, setNoms] = useState(() => mgrData.allNoms.map(n => ({
    ...n
  })));
  // 審批失敗要回滾——呢度改嘅係佣金依據（入會獎金按 subscribed 計），唔可以畫面同 sheet 唔一致
  const revertNom = (id, prev) => () => setNoms(l => l.map(n => n.id === id ? {
    ...n,
    ...prev
  } : n));
  async function set(id, status) {
    const p = noms.find(n => n.id === id) || {};
    setNoms(l => l.map(n => n.id === id ? {
      ...n,
      status
    } : n));
    await pwWrite('approveNom', {
      nomId: id,
      status
    }, revertNom(id, {
      status: p.status,
      tier: p.tier
    }));
  }
  async function setTier(id, tier) {
    const p = noms.find(n => n.id === id) || {};
    setNoms(l => l.map(n => n.id === id ? {
      ...n,
      tier,
      status: 'subscribed'
    } : n));
    await pwWrite('approveNom', {
      nomId: id,
      tier,
      status: 'subscribed'
    }, revertNom(id, {
      status: p.status,
      tier: p.tier
    }));
  }
  const pending = noms.filter(n => n.status === 'pending');
  const approved = noms.filter(n => n.status === 'approved');
  const closed = noms.filter(n => n.status === 'subscribed' || n.status === 'rejected');
  const totalBonus = noms.filter(n => n.status === 'subscribed' && n.tier).reduce((a, n) => a + CLUB_TIERS[n.tier].bonus, 0);
  const NomLine = ({
    n
  }) => {
    const t = n.tier ? CLUB_TIERS[n.tier] : null;
    return /*#__PURE__*/React.createElement("div", {
      className: "pwd-mgr-swap-top"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgr-swap-ava"
    }, initOf(n.staffId)), /*#__PURE__*/React.createElement("div", {
      className: "pwd-mgr-swap-info"
    }, /*#__PURE__*/React.createElement("b", null, n.dog, t ? /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 ", t.label) : ''), /*#__PURE__*/React.createElement("span", null, "\u63D0\u540D\u4EBA ", nameOf(n.staffId), n.phone ? ` · 電話 ${n.phone}` : '')));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-stack"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-mgr-preview"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u672C\u6708\u6703\u7C4D\u4F63\u91D1"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-preview-num"
  }, "\u5F85\u5B9A"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-preview-sub"
  }, "\u5DF2\u6210\u529F\u8A02\u95B1 ", noms.filter(n => n.status === 'subscribed').length, " \u500B \xB7 \u4F63\u91D1\u5F85\u6536\u96C6 1\u20132 \u500B\u6708\u6578\u64DA\u5F8C\u5B89\u6392")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5F85\u5BE9\u6279\u63D0\u540D (", pending.length, ")"), pending.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph-empty",
    style: {
      marginTop: 12
    }
  }, "\u6C92\u6709\u5F85\u5BE9\u6279\u7684\u63D0\u540D") : /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swaps"
  }, pending.map(n => /*#__PURE__*/React.createElement("div", {
    key: n.id,
    className: "pwd-mgr-swap"
  }, /*#__PURE__*/React.createElement(NomLine, {
    n: n
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swap-acts"
  }, /*#__PURE__*/React.createElement("button", {
    className: "pwd-btn-reject",
    onClick: () => set(n.id, 'rejected')
  }, "\u62D2\u7D55"), /*#__PURE__*/React.createElement("button", {
    className: "pwd-btn-approve",
    onClick: () => set(n.id, 'approved')
  }, "\u6279\u51C6\u63D0\u540D")))))), approved.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5DF2\u6279\u51C6 \xB7 \u5F85\u5BA2\u6236\u8A02\u95B1 (", approved.length, ")"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-mgr-hint"
  }, "\u4E3B\u4EBA\u8A02\u95B1\u5F8C\u63C0\u9078\u5C0D\u61C9\u65B9\u6848\u8A18\u9304\uFF1B\u6703\u7C4D\u4F63\u91D1\u5F85\u6536\u96C6 1\u20132 \u500B\u6708\u6578\u64DA\u5F8C\u5B89\u6392"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swaps"
  }, approved.map(n => /*#__PURE__*/React.createElement("div", {
    key: n.id,
    className: "pwd-mgr-swap"
  }, /*#__PURE__*/React.createElement(NomLine, {
    n: n
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-tierconfirm"
  }, Object.values(CLUB_TIERS).map(t => /*#__PURE__*/React.createElement("button", {
    key: t.key,
    className: "pwd-club-tierconfirm-btn",
    onClick: () => setTier(n.id, t.key)
  }, t.label, /*#__PURE__*/React.createElement("i", null, "$", t.fee, "/\u6708")))), /*#__PURE__*/React.createElement("button", {
    className: "pwd-club-mgr-cancel",
    onClick: () => set(n.id, 'rejected')
  }, "\u53D6\u6D88\u63D0\u540D"))))), closed.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5DF2\u8655\u7406"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-swaps"
  }, closed.map(n => {
    const t = n.tier ? CLUB_TIERS[n.tier] : null;
    return /*#__PURE__*/React.createElement("div", {
      key: n.id,
      className: "pwd-mgr-swap done"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-mgr-swap-ava"
    }, initOf(n.staffId)), /*#__PURE__*/React.createElement("div", {
      className: "pwd-mgr-swap-info"
    }, /*#__PURE__*/React.createElement("b", null, n.dog, t ? ` · ${t.label}` : ''), /*#__PURE__*/React.createElement("span", null, nameOf(n.staffId), n.phone ? ` · ${n.phone}` : '')), /*#__PURE__*/React.createElement("span", {
      className: 'pwd-mgr-swap-status ' + (n.status === 'subscribed' ? 'approved' : 'rejected')
    }, n.status === 'subscribed' && t ? `已訂閱 · ${t.label}` : '已拒絕'));
  }))));
}

// ── ManagerGate ──
function ManagerGate({
  onUnlock,
  action = 'verifyMgr',
  title = '團隊管理 · 需要管理密碼',
  sub = '高敏感操作 · 請輸入只有店長 / 老闆知道的管理密碼'
}) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const LEN = 6;
  async function check(code) {
    setBusy(true);
    try {
      const res = await pwApi(action, {
        passcode: code
      });
      if (res.ok) {
        PW_KEY = code;
        onUnlock();
        // [2026-09-06 老闆嫌次次入] 解鎖後記住管理密碼；「🔒 鎖定」或登出先清。
        // 密碼如果之後改咗，記住嗰條 key 寫入時後端會回「未授權」，pwWrite 會指引重新解鎖。
        try {
          localStorage.setItem('pw_mgr_key', code);
        } catch (e) {}
      } else {
        setErr(true);
        setPin('');
      }
    } catch (e) {
      setErr(true);
      setPin('');
    }
    setBusy(false);
  }
  function tap(d) {
    if (busy) return;
    if (d === 'del') {
      setErr(false);
      return setPin(p => p.slice(0, -1));
    }
    if (pin.length >= LEN) return;
    const next = pin + d;
    setErr(false);
    setPin(next);
    if (next.length === LEN) setTimeout(() => check(next), 150);
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgate"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgate-lock"
  }, "\uD83D\uDD12"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgate-title"
  }, title), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgate-sub"
  }, sub), /*#__PURE__*/React.createElement("div", {
    className: 'pwd-mgrgate-dots' + (err ? ' err' : '')
  }, Array.from({
    length: LEN
  }).map((_, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: 'pwd-mgrgate-dot' + (pin.length > i ? ' on' : '')
  }))), err && /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgate-err"
  }, "\u5BC6\u78BC\u932F\u8AA4,\u8ACB\u91CD\u8A66"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgrgate-keypad"
  }, keys.map((k, i) => k === '' ? /*#__PURE__*/React.createElement("span", {
    key: i
  }) : /*#__PURE__*/React.createElement("button", {
    key: i,
    className: 'pwd-mgrgate-key' + (k === 'del' ? ' del' : ''),
    onClick: () => tap(k)
  }, k === 'del' ? '⌫' : k))));
}

// ═══════════ SeatsPanel（2026-08-25，「學位」分頁：S1/Club 名額 + 候補名單）═══════════
// 老闆定案：所有導師都睇到（唔設密碼），登記候補都唔設密碼（導師自己篩選）；
// 淨係「改狀態」（邀請/加入/謝絕）先要店長密碼（同 mgr/owner tab 共用返 mgrUnlocked 狀態）。
// [2026-08-26 老闆定] Light/Active Explorer 暫時唔設cap，候補登記唔使呢個選項
// （得 S1／Ultimate 先會爆滿，先需要候補）。
const WAITLIST_DEPTS = {
  S1: '幼稚園 (S1)',
  ULTIMATE: 'Ultimate Explorer'
};
const WAITLIST_STATUS_FLOW = ['候補中', '已邀請', '已加入', '已謝絕'];
function QuotaBar({
  label,
  data,
  unitLabel,
  capped
}) {
  const pct = capped ? Math.min(100, Math.round(data.active / data.quota * 100)) : null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow",
    style: {
      marginTop: 18
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-result-num",
    style: {
      marginTop: 6,
      fontSize: capped ? undefined : 22
    }
  }, capped ? `${data.active} / ${data.quota}` : `${data.active} ${unitLabel || ''}`), capped && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-roster-sum",
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("span", null, data.full ? '🔴 已滿，新登記請落候補' : `尚餘 ${data.remaining} 個位`)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 8,
      background: 'var(--pw-cream-deep)',
      borderRadius: 999,
      marginTop: 12,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      width: pct + '%',
      background: data.full ? '#C0524A' : 'var(--pw-navy)',
      transition: 'width .3s'
    }
  }))));
}
function SeatStatusCard({
  status
}) {
  if (!status) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement(QuotaBar, {
    label: "\u5E7C\u7A1A\u5712 (S1) \u5B78\u4F4D",
    data: status.s1,
    capped: true
  }), /*#__PURE__*/React.createElement(QuotaBar, {
    label: "Ultimate Explorer \u6703\u7C4D",
    data: status.ultimate,
    capped: true
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow",
    style: {
      marginTop: 18
    }
  }, "Calm Explorer Club\uFF08\u5168\u90E8\u5C64\u7D1A\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-result-num",
    style: {
      marginTop: 6,
      fontSize: 22
    }
  }, status.club.members, " \u4F4D\u6703\u54E1"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-hint",
    style: {
      marginTop: 6
    }
  }, "Light / Active Explorer \u66AB\u6642\u4E0D\u8A2D\u4E0A\u9650\u3002"));
}
function WaitlistAddForm({
  staffId,
  onAdded
}) {
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
    setBusy(true);
    setMsg('');
    const r = await pwApi('waitlistAdd', {
      dept,
      dogName: dogName.trim(),
      phone: phone.trim(),
      ownerName: ownerName.trim(),
      district: district.trim(),
      note: note.trim(),
      staffId
    });
    setBusy(false);
    if (r && r.ok) {
      setDogName('');
      setPhone('');
      setOwnerName('');
      setDistrict('');
      setNote('');
      setMsg('已加入候補名單。');
      onAdded();
    } else setMsg(r && r.error || '登記失敗');
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u65B0\u589E\u5019\u88DC\u767B\u8A18"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-view-toggle",
    style: {
      marginTop: 10
    }
  }, Object.keys(WAITLIST_DEPTS).map(k => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: dept === k ? 'on' : '',
    onClick: () => setDept(k)
  }, WAITLIST_DEPTS[k]))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-row",
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "pwd-tr-input",
    placeholder: "\u72D7\u72D7\u540D\u7A31",
    value: dogName,
    onChange: e => setDogName(e.target.value)
  }), /*#__PURE__*/React.createElement("input", {
    className: "pwd-tr-input",
    type: "tel",
    inputMode: "tel",
    placeholder: "\u5BB6\u9577\u96FB\u8A71",
    value: phone,
    onChange: e => setPhone(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-row"
  }, /*#__PURE__*/React.createElement("input", {
    className: "pwd-tr-input",
    placeholder: "\u5BB6\u9577\u59D3\u540D",
    value: ownerName,
    onChange: e => setOwnerName(e.target.value)
  }), /*#__PURE__*/React.createElement("input", {
    className: "pwd-tr-input",
    placeholder: "\u5730\u5340\uFF08\u586B\u5177\u9AD4\u5730\u9EDE\uFF0C\u4F8B\uFF1A\u592A\u53E4\u57CE\uFF0F\u5C07\u8ECD\u6FB3\uFF0C\u5514\u597D\u6DE8\u4FC2\u586B\u6E2F\u5CF6\uFF0F\u4E5D\u9F8D\uFF0F\u65B0\u754C\uFF09",
    value: district,
    onChange: e => setDistrict(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-row"
  }, /*#__PURE__*/React.createElement("input", {
    className: "pwd-tr-input",
    placeholder: "\u5099\u8A3B\uFF08\u53EF\u7559\u7A7A\uFF09",
    value: note,
    onChange: e => setNote(e.target.value)
  })), msg && /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-hint",
    style: {
      color: 'var(--pw-navy-deep)'
    }
  }, msg), /*#__PURE__*/React.createElement("div", {
    className: "pwd-club-formacts"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-tr-sub"
  }, "\xA0"), /*#__PURE__*/React.createElement("button", {
    className: "pwd-la-confirm",
    disabled: !dogName.trim() || busy,
    onClick: submit
  }, busy ? '登記中…' : '加入候補')));
}
// [2026-08-26] dept 顏色：S1 用返學院金色徽章，Ultimate 用返紫色徽章（兩個都係
//   app 現有色，一眼分得到邊個部門，唔使加新CSS）。
const WAITLIST_DEPT_CLS = {
  S1: 'sh-academy',
  ULTIMATE: 'sh-hotelC'
};
function DeptBadge({
  dept
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: 'pwd-duty-pos ' + (WAITLIST_DEPT_CLS[dept] || 'sh-academy')
  }, WAITLIST_DEPTS[dept] || dept);
}
function WaitlistTable({
  items,
  onUpdate,
  onDelete
}) {
  if (!items) return null;
  const active = items.filter(x => x.status === '候補中' || x.status === '已邀請');
  const done = items.filter(x => x.status === '已加入' || x.status === '已謝絕');
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5019\u88DC\u540D\u55AE\uFF08", active.length, "\uFF09\xB7 \u6309\u767B\u8A18\u6B21\u5E8F\u6392"), active.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-hint",
    style: {
      marginTop: 8
    }
  }, "\u66AB\u6642\u5187\u4EBA\u5019\u88DC\u3002"), active.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-list",
    style: {
      marginTop: 4
    }
  }, active.map(x => /*#__PURE__*/React.createElement("div", {
    key: x.id,
    className: "pwd-tr-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-item-i"
  }, /*#__PURE__*/React.createElement("b", null, /*#__PURE__*/React.createElement(DeptBadge, {
    dept: x.dept
  }), " ", x.dog, x.phone ? /*#__PURE__*/React.createElement("span", {
    className: "pwd-club-nom-owner"
  }, " \xB7 ", x.phone) : null), /*#__PURE__*/React.createElement("span", null, x.owner || '（未填家長姓名）', x.district ? ' · ' + x.district : '', " \xB7 ", x.status, x.note ? ' · ' + x.note : '')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, x.status === '候補中' && /*#__PURE__*/React.createElement("button", {
    className: "pwd-tr-x",
    onClick: () => onUpdate(x.id, '已邀請')
  }, "\u5DF2\u9080\u8ACB"), /*#__PURE__*/React.createElement("button", {
    className: "pwd-tr-x",
    onClick: () => onUpdate(x.id, '已加入')
  }, "\u5DF2\u52A0\u5165"), /*#__PURE__*/React.createElement("button", {
    className: "pwd-tr-x",
    onClick: () => onUpdate(x.id, '已謝絕')
  }, "\u8B1D\u7D55"), /*#__PURE__*/React.createElement("button", {
    className: "pwd-tr-x",
    onClick: () => onDelete(x.id)
  }, "\u522A\u9664"))))), done.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow",
    style: {
      marginTop: 18
    }
  }, "\u6B77\u53F2\uFF08", done.length, "\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-list"
  }, done.map(x => /*#__PURE__*/React.createElement("div", {
    key: x.id,
    className: "pwd-tr-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-tr-item-i"
  }, /*#__PURE__*/React.createElement("b", null, /*#__PURE__*/React.createElement(DeptBadge, {
    dept: x.dept
  }), " ", x.dog), /*#__PURE__*/React.createElement("span", null, x.status)), /*#__PURE__*/React.createElement("button", {
    className: "pwd-tr-x",
    onClick: () => onDelete(x.id)
  }, "\u522A\u9664"))))));
}
// [2026-08-26 老闆改口] 唔再要店長解鎖先改到候補狀態——導師自己有齊權限。
function SeatsPanel({
  staffId
}) {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState(null);
  async function loadAll() {
    const [s, w] = await Promise.all([pwApi('seatStatus', {}), pwApi('waitlistList', {})]);
    if (s && s.ok) setStatus(s);else setStatus(null);
    if (w && w.ok) setItems(w.items);else setItems([]);
  }
  useEffect(() => {
    loadAll();
  }, []);
  async function updateStatus(id, newStatus) {
    const ok = await pwWrite('waitlistUpdate', {
      id,
      status: newStatus
    });
    if (ok) loadAll();
  }
  async function deleteEntry(id) {
    const ok = await pwWrite('waitlistDelete', {
      id
    });
    if (ok) loadAll();
  }
  if (!status && !items) return /*#__PURE__*/React.createElement("div", {
    className: "pwd-loading",
    style: {
      minHeight: 200,
      background: 'transparent'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-spinner"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-loading-txt",
    style: {
      color: 'var(--pw-ink-mute)'
    }
  }, "\u8F09\u5165\u5B78\u4F4D\u6578\u64DA\u2026"));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SeatStatusCard, {
    status: status
  }), /*#__PURE__*/React.createElement(WaitlistAddForm, {
    staffId: staffId,
    onAdded: loadAll
  }), /*#__PURE__*/React.createElement(WaitlistTable, {
    items: items,
    onUpdate: updateStatus,
    onDelete: deleteEntry
  }));
}

// ── 老闆評核店長 KPI ──
function OwnerKpiEditor({
  month,
  mgrData,
  mgr
}) {
  const k0 = mgrData.allKpi[mgr.id] || {
    kpiFail: [],
    lateLeave: 0
  };
  const [fail, setFail] = useState(() => k0.kpiFail.slice());
  const [lateLeave, setLate] = useState(k0.lateLeave || 0);
  const att = mgrData.allAttendance && mgrData.allAttendance[mgr.id] != null ? mgrData.allAttendance[mgr.id] : 0;
  const items = buildScorecard('manager', fail);
  const {
    calc,
    kpi
  } = fullResult({
    ...mgr,
    attendance: att,
    kpiFail: fail,
    lateLeave
  }, mgrData.team, {
    scorecard: items,
    lateLeave
  });
  const score = scorecardTotal(items);
  const tone = kpi.ratio >= 1 ? 'full' : kpi.ratio > 0 ? 'mid' : 'zero';
  const toggle = id => setFail(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]);
  function save() {
    return pwApi('saveKpi', {
      month,
      staffId: mgr.id,
      lateLeave,
      kpiFail: fail.join(',')
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-stack"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-banner"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgr-banner-ico"
  }, "\uD83D\uDD11"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "\u8001\u95C6\u8A55\u6838\u5E97\u9577"), /*#__PURE__*/React.createElement("span", null, mgr.name, " \xB7 \u5E97\u9577 KPI"))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u5E97\u9577 KPI \u8A55\u6838"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-band"
  }, "\u767C\u653E\u6BD4\u4F8B ", /*#__PURE__*/React.createElement("b", {
    className: 'r-' + tone
  }, Math.round(kpi.ratio * 100), "%"), " \xB7 ", kpi.band)), /*#__PURE__*/React.createElement("div", {
    className: 'pwd-kpi-score r-' + tone
  }, /*#__PURE__*/React.createElement("span", {
    className: "n"
  }, score), /*#__PURE__*/React.createElement("span", {
    className: "d"
  }, "\u5206"))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-kpi-items"
  }, items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.id,
    className: 'pwd-kpi-item edit' + (it.pass ? ' pass' : ' fail'),
    onClick: () => toggle(it.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-check"
  }, it.pass ? '✓' : '✕'), /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-text"
  }, it.text, it.team && /*#__PURE__*/React.createElement("em", {
    className: "pwd-kpi-team"
  }, "\u5718\u968A")), /*#__PURE__*/React.createElement("span", {
    className: "pwd-kpi-w"
  }, it.weight))))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-mgr-late"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-late-row"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "\u7576\u6708\u9072\u5230 / \u8ACB\u5047\u6B21\u6578"), /*#__PURE__*/React.createElement("span", null, "\u8D85\u904E 3 \u6B21 \u2192 KPI \u76F4\u63A5\u70BA 0")), /*#__PURE__*/React.createElement(Stepper, {
    value: lateLeave,
    suffix: "\u6B21",
    onChange: setLate
  })), lateLeave > 3 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-warn",
    style: {
      marginTop: 12
    }
  }, "\u5DF2\u8D85\u904E 3 \u6B21 \u2014 ", mgr.name, " \u672C\u6708 KPI \u5C07\u70BA 0")), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-mgr-result"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, mgr.name, " \u672C\u6708\u5BE6\u969B\u9818\u53D6"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-result-num"
  }, money(kpi.actualTotal)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-result-sub"
  }, "\u5E97\u9577\u4F63\u91D1 ", money(calc.total), " \xD7 ", Math.round(kpi.ratio * 100), "% \u767C\u653E")), /*#__PURE__*/React.createElement(SaveBtn, {
    onSave: save,
    label: `儲存 ${mgr.name} 的評核`
  }));
}
function MgrOwnerKpi({
  month,
  mgrData
}) {
  const [unlocked, setUnlocked] = useState(false);
  const mgr = mgrData.staffList.find(s => s.role === 'manager');
  if (!mgr) return /*#__PURE__*/React.createElement("div", {
    className: "pwd-ph-empty",
    style: {
      marginTop: 20
    }
  }, "\u672A\u6709\u5E97\u9577\u8CC7\u6599");
  if (!unlocked) return /*#__PURE__*/React.createElement(ManagerGate, {
    action: "verifyOwner",
    title: "\u8A55\u6838\u5E97\u9577 \xB7 \u9700\u8981\u8001\u95C6\u5BC6\u78BC",
    sub: "\u53EA\u6709\u8001\u95C6\u53EF\u8A55\u6838\u5E97\u9577 KPI \xB7 \u8ACB\u8F38\u5165\u8001\u95C6\u5BC6\u78BC",
    onUnlock: () => setUnlocked(true)
  });
  return /*#__PURE__*/React.createElement(OwnerKpiEditor, {
    month: month,
    mgrData: mgrData,
    mgr: mgr
  });
}

// ═══════════ OwnerOverview（2026-08-25，老闆專屬簡易總覽）═══════════
// 老闆要求：好簡單，淨係想睇① duty(本週邊日邊個返工) ②各部門業績 ③員工佣金。
// 唔重用店長嗰套（MgrOps/MgrKpi 係逐格輸入嘅表格，唔係唯讀摘要），起返三張獨立卡。
function OwnerDutyThisWeek({
  weekStart,
  dates,
  todayDow
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    pwApi('teamRoster', {
      weekStart
    }).then(res => {
      if (!cancelled && res.ok) setData(res);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [weekStart]);
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\u672C\u9031\u908A\u500B\u8FD4\u5DE5"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-duty",
    style: {
      marginTop: 12
    }
  }, WEEKDAYS.map((wd, i) => {
    const people = data ? data.days[i] : [];
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: 'pwd-duty-row' + (i === todayDow ? ' today' : '') + (!loading && people.length === 0 ? ' off' : '')
    }, /*#__PURE__*/React.createElement("div", {
      className: "pwd-duty-date"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-wd"
    }, wd), /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-num"
    }, dates[i])), /*#__PURE__*/React.createElement("div", {
      className: "pwd-duty-team-people"
    }, loading && !data && /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-team-empty"
    }, "\u8F09\u5165\u4E2D\u2026"), data && people.length === 0 && /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-team-empty"
    }, "\u4ECA\u65E5\u5187\u4EBA\u8FD4\u5DE5"), data && people.map((c, ci) => /*#__PURE__*/React.createElement("span", {
      key: ci,
      className: "pwd-coworker"
    }, /*#__PURE__*/React.createElement("span", {
      className: "pwd-coworker-ava"
    }, c.initial), c.name, c.posKey && POSITIONS[c.posKey] ? ' · ' + POSITIONS[c.posKey].label : ''))), i === todayDow && /*#__PURE__*/React.createElement("span", {
      className: "pwd-duty-now"
    }, "\u4ECA\u5929"));
  })));
}
function OwnerDeptRevenue({
  team
}) {
  const rows = [{
    label: '酒店業績',
    val: team.hotelRevenue || 0
  }, {
    label: '學院業績',
    val: team.academyRevenue || 0
  }, {
    label: '基本美容',
    val: team.groomBasic || 0
  }, {
    label: '星級美容',
    val: team.groomStar || 0
  }, {
    label: '接送',
    val: team.pickup || 0
  }, {
    label: '套票',
    val: team.packageRevenue || 0
  }, {
    label: '其他',
    val: team.other || 0
  }];
  const total = rows.reduce((a, r) => a + r.val, 0);
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, team.month, " \u5404\u90E8\u9580\u696D\u7E3E"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-ledger",
    style: {
      marginTop: 8
    }
  }, rows.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.label,
    className: "pwd-led-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-lbl"
  }, r.label), /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-val"
  }, money(r.val)))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-led-row total"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-lbl"
  }, "\u5408\u8A08"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-val"
  }, money(total)))));
}
function OwnerCommissionTable({
  mgrData
}) {
  const team = mgrData.team;
  const poolStaff = mgrData.staffList.filter(s => s.role !== 'manager' && s.role !== 'frontdesk' && s.role !== 'owner' && s.dept !== 'academy');
  const teamForCalc = {
    ...team,
    acadWeightTotal: ACAD_WEIGHT_TOTAL,
    headcount: poolStaff.length || HEADCOUNT
  };
  const rows = mgrData.staffList.filter(s => s.role !== 'owner').map(s => {
    const k = mgrData.allKpi[s.id] || {
      kpiFail: [],
      lateLeave: 0
    };
    const att = mgrData.allAttendance && mgrData.allAttendance[s.id] != null ? mgrData.allAttendance[s.id] : 0;
    // 個人新生數(allSales)＋會籍獎金要入埋,先同員工個人頁/月結引擎一條數(2026-09-02 修)
    const sales = mgrData.allSales && mgrData.allSales[s.id] || {};
    const {
      kpi
    } = fullResult({
      ...s,
      ...sales,
      attendance: att,
      kpiFail: k.kpiFail,
      lateLeave: k.lateLeave
    }, teamForCalc);
    const club = clubBonusFor(s, mgrData.allNoms, team.monthKey || '');
    return {
      name: s.name,
      role: s.role,
      amt: kpi.actualTotal + club
    };
  }).sort((a, b) => b.amt - a.amt);
  const total = rows.reduce((a, r) => a + r.amt, 0);
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, team.month, " \u54E1\u5DE5\u4F63\u91D1\uFF08\u9810\u4F30\uFF0C\u5BE6\u969B\u4EE5\u6708\u7D50\u70BA\u6E96\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-ledger",
    style: {
      marginTop: 8
    }
  }, rows.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.name,
    className: "pwd-led-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-lbl"
  }, r.name, r.role === 'manager' ? ' · 店長' : ''), /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-val"
  }, money(r.amt)))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-led-row total"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-lbl"
  }, "\u5408\u8A08"), /*#__PURE__*/React.createElement("span", {
    className: "pwd-led-val"
  }, money(total)))));
}
function OwnerOverview({
  dash,
  mgrUnlocked,
  mgrData,
  onUnlock
}) {
  if (!mgrUnlocked) return /*#__PURE__*/React.createElement(ManagerGate, {
    action: "verifyOwner",
    title: "\u8001\u95C6\u7E3D\u89BD \xB7 \u9700\u8981\u8001\u95C6\u5BC6\u78BC",
    sub: "\u8ACB\u8F38\u5165\u8001\u95C6\u5BC6\u78BC",
    onUnlock: onUnlock
  });
  if (!mgrData) return /*#__PURE__*/React.createElement("div", {
    className: "pwd-loading",
    style: {
      minHeight: 200,
      background: 'transparent'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-spinner"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-loading-txt",
    style: {
      color: 'var(--pw-ink-mute)'
    }
  }, "\u8F09\u5165\u7BA1\u7406\u6578\u64DA\u2026"));
  const week = dash.weeks[dash.currentWeekIdx];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(OwnerDutyThisWeek, {
    weekStart: week.weekStart,
    dates: week.dates,
    todayDow: dash.todayDow
  }), /*#__PURE__*/React.createElement(OwnerDeptRevenue, {
    team: mgrData.team
  }), /*#__PURE__*/React.createElement(OwnerCommissionTable, {
    mgrData: mgrData
  }));
}

// ── 清潔突擊檢查（2026-09-05 老闆批）──
// 項目同標準對齊《清潔突擊檢查表》PDF（內部文件/人事薪酬/KPI/），改項目要兩邊同步。
// 判定規則（前端顯示用；正式結果後端重算）：✗ 超過 3 項＝不合格。
const CLEAN_CHECKLISTS = {
  '酒店部': {
    icon: '🏨',
    hint: '於下午時段突擊檢查 · 不作預先通知',
    groups: [{
      name: 'A. 房間',
      hint: '隨機抽查 3 間，優先抽查當日有狗隻入住之房間',
      items: [['房間地面', '無毛髮、無污漬水漬'], ['房間玻璃', '無鼻印指印水印（濕布後乾布抹淨）'], ['房間排泄物', '房內無任何排泄物殘留']]
    }, {
      name: 'B. 天台',
      hint: '狗隻如廁區',
      items: [['天台地面', '已沖洗，無排泄物殘留'], ['水喉', '使用後放置於盤內']]
    }, {
      name: 'C. 廚房／餐具',
      items: [['食碗', '已清洗並疊放整齊，無殘渣油漬'], ['備餐位', '檯面乾淨，無隔夜食物'], ['雪櫃', '無存放過期食物']]
    }, {
      name: 'D. 公共位',
      items: [['尿板', '已清洗，無尿垢、無異味'], ['水碗', '盛有清水，碗身無黏滑感、無殘渣'], ['器材用品', '使用後歸回原位，無散落'], ['活動區地面', '乾淨無毛髮、無水漬'], ['公眾地方地面', '𨋢口、樓梯等地面乾淨，無毛髮'], ['氣味', '無明顯異味'], ['垃圾', '已傾倒，無滿溢並已套袋'], ['拖地水', '已傾倒及更換，無過夜污水']]
    }]
  },
  '學院部': {
    icon: '🎓',
    hint: '於晚間下課後時段突擊檢查 · 不作預先通知',
    groups: [{
      name: 'A. 課室',
      items: [['課室地面', '無毛髮、無尿漬水漬'], ['課室氣味', '課室中央停留 5 秒，無明顯異味']]
    }, {
      name: 'B. 教具',
      hint: '隨機抽查 3 件，以狗隻會以口接觸者為優先',
      items: [['教具衛生', '無食物殘渣、無異味、無黏漬'], ['物資收納', '所有物資根據標籤收納妥當'], ['教具水碗', '盛有清水，碗身無黏滑感、無殘渣']]
    }, {
      name: 'C. 休息區',
      hint: '包括休息房間，標準與酒店部相同',
      items: [['休息區地面', '無毛髮、無污漬水漬'], ['休息區玻璃', '無鼻印指印水印'], ['休息區排泄物', '無任何排泄物殘留']]
    }, {
      name: 'D. 設備',
      items: [['圍欄／分隔板', '穩固無鬆動，表面乾淨無污跡'], ['16樓雪櫃', '內外乾淨，無存放過期食物']]
    }, {
      name: 'E. 學校門口',
      items: [
      // [2026-09-06 老闆定] 唔查「無垃圾」——晚間垃圾會暫放防煙門側等收，屬正常運作
      ['學校門口', '地面無毛髮毛球']]
    }]
  }
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
    } catch (e) {/* 記錄載入失敗唔阻提交，下面顯示提示 */}
  }
  useEffect(() => {
    loadRecords();
  }, []);
  const conf = CLEAN_CHECKLISTS[dept];
  const allItems = conf.groups.flatMap(gr => gr.items.map(it => it[0]));
  const filled = allItems.filter(k => marks[k]).length;
  const failCount = allItems.filter(k => marks[k] === '✗').length;
  const isFail = failCount > 3;
  const allFilled = filled === allItems.length;
  function setMark(k, v) {
    setSavedMsg('');
    setMarks(m => ({
      ...m,
      [k]: m[k] === v ? '' : v
    }));
  }
  function switchDept(d) {
    if (d === dept) return;
    if (filled > 0 && !window.confirm('切換部門將清除未提交之選項，確定？')) return;
    setDept(d);
    setMarks({});
    setSavedMsg('');
  }
  // [2026-09-05 老闆定] 唔設「全部✓」快捷掣——避免員工未檢查就一鍵剔晒，逐項必須人手填
  async function submit() {
    if (!inspector.trim()) {
      window.alert('請輸入檢查人');
      return;
    }
    if (!allFilled) {
      window.alert('尚有 ' + (allItems.length - filled) + ' 項未填');
      return;
    }
    const payload = {};
    allItems.forEach(k => {
      payload[k] = marks[k];
    });
    setSaving(true);
    const ok = await pwWrite('cleanCheckSave', {
      dept: dept,
      inspector: inspector.trim(),
      onDuty: onDuty.trim(),
      items: JSON.stringify(payload),
      note: note.trim()
    });
    setSaving(false);
    if (ok) {
      setSavedMsg('✓ 已記錄：' + dept + ' ' + (isFail ? '不合格' : '合格') + '（✗ ' + failCount + ' 項）' + (failCount > 0 ? ' · 所有 ✗ 項目須於 24 小時內改善並拍照回報' : ''));
      setMarks({});
      setNote('');
      loadRecords();
    }
  }
  const curMonth = currentMonth();
  const monthRecs = (records || []).filter(r => String(r.time).slice(0, 7) === curMonth);
  const failThisMonth = d => monthRecs.filter(r => r.dept === d && r.result === '不合格').length;
  // [2026-09-06 老闆定] 每部門每星期至少一次；本週未檢嘅部門開頁即紅字提醒
  const mondayStr = cleanCheckMondayStr();
  const weekMissing = records === null ? [] : ['酒店部', '學院部'].filter(d => !records.some(r => r.dept === d && String(r.time).slice(0, 10) >= mondayStr));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\uD83E\uDDF9 \u6E05\u6F54\u7A81\u64CA\u6AA2\u67E5"), records !== null && (weekMissing.length > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-week warn"
  }, "\u26A0\uFE0F \u672C\u9031\u5C1A\u672A\u6AA2\u67E5\uFF1A", weekMissing.join('、'), "\uFF08\u6BCF\u90E8\u9580\u6BCF\u661F\u671F\u81F3\u5C11\u4E00\u6B21\uFF09") : /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-week done"
  }, "\u2713 \u672C\u9031\u5169\u90E8\u9580\u5DF2\u5B8C\u6210\u6AA2\u67E5")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 12
    }
  }, ['酒店部', '學院部'].map(d => /*#__PURE__*/React.createElement("button", {
    key: d,
    className: 'pwd-cc-deptbtn' + (dept === d ? ' on' : ''),
    onClick: () => switchDept(d)
  }, CLEAN_CHECKLISTS[d].icon, " ", d))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-cc-std"
  }, conf.hint, " \xB7 \u2717 \u8D85\u904E 3 \u9805\u5373\u70BA\u4E0D\u5408\u683C")), conf.groups.map(gr => /*#__PURE__*/React.createElement("div", {
    key: gr.name,
    className: "pwd-cc-group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-grouphead"
  }, gr.name, gr.hint && /*#__PURE__*/React.createElement("span", {
    className: "pwd-cc-grouphint"
  }, gr.hint)), gr.items.map(([k, std]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    className: "pwd-cc-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-label"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-name"
  }, k), /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-std"
  }, std)), /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-marks"
  }, /*#__PURE__*/React.createElement("button", {
    className: 'pwd-cc-markbtn' + (marks[k] === '✓' ? ' ok' : ''),
    onClick: () => setMark(k, '✓')
  }, "\u2713"), /*#__PURE__*/React.createElement("button", {
    className: 'pwd-cc-markbtn' + (marks[k] === '✗' ? ' bad' : ''),
    onClick: () => setMark(k, '✗')
  }, "\u2717"), /*#__PURE__*/React.createElement("button", {
    className: 'pwd-cc-markbtn' + (marks[k] === 'N/A' ? ' na' : ''),
    onClick: () => setMark(k, 'N/A')
  }, "N/A")))))), /*#__PURE__*/React.createElement("div", {
    className: 'pwd-cc-summary' + (isFail ? ' fail' : ' pass')
  }, /*#__PURE__*/React.createElement("span", null, "\u5DF2\u586B ", filled, "/", allItems.length, " \xB7 \u2717 ", failCount, " \u9805"), /*#__PURE__*/React.createElement("span", null, allFilled ? isFail ? '不合格' : '合格' : '未完成')), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("label", null, "\u6AA2\u67E5\u4EBA ", /*#__PURE__*/React.createElement("b", null, "*")), /*#__PURE__*/React.createElement("input", {
    className: "pwd-input",
    type: "text",
    autoComplete: "off",
    placeholder: "\u8ACB\u8F38\u5165\u6AA2\u67E5\u4EBA\u59D3\u540D",
    value: inspector,
    onChange: e => setInspector(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("label", null, "\u7576\u503C\u54E1\u5DE5\uFF0F\u5C0E\u5E2B"), /*#__PURE__*/React.createElement("input", {
    className: "pwd-input",
    type: "text",
    autoComplete: "off",
    placeholder: "\u7576\u65E5\u8CA0\u8CAC\u6E05\u6F54\u4E4B\u54E1\u5DE5",
    value: onDuty,
    onChange: e => setOnDuty(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-field",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("label", null, "\u5099\u8A3B\uFF08\u4E0D\u9054\u6A19\u8A73\u60C5\uFF0F\u6539\u5584\u671F\u9650\uFF09"), /*#__PURE__*/React.createElement("input", {
    className: "pwd-input",
    type: "text",
    autoComplete: "off",
    placeholder: "\u9078\u586B",
    value: note,
    onChange: e => setNote(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, savedMsg && /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-saved",
    style: {
      marginBottom: 8
    }
  }, savedMsg), /*#__PURE__*/React.createElement("button", {
    className: "pwd-mgr-savebtn",
    disabled: saving,
    onClick: submit
  }, saving ? '提交中…' : '提交檢查記錄'))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\uD83D\uDCCB \u6AA2\u67E5\u8A18\u9304"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-std",
    style: {
      marginTop: 8
    }
  }, "\u672C\u6708\u4E0D\u5408\u683C\uFF1A\uD83C\uDFE8 ", failThisMonth('酒店部'), " \u6B21 \xB7 \uD83C\uDF93 ", failThisMonth('學院部'), " \u6B21\uFF08KPI \u76EE\u6A19\uFF1A\u6BCF\u90E8\u9580 \u2264 1\uFF09\xB7 \u9EDE\u64CA\u8A18\u9304\u53EF\u67E5\u770B\u9010\u9805\u7D50\u679C"), records === null && /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-std",
    style: {
      marginTop: 10
    }
  }, "\u8F09\u5165\u4E2D\u2026"), records !== null && records.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-std",
    style: {
      marginTop: 10
    }
  }, "\u66AB\u7121\u8A18\u9304"), (records || []).map(r => /*#__PURE__*/React.createElement(React.Fragment, {
    key: r.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-rec",
    onClick: () => setOpenId(openId === r.id ? null : r.id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-recmain"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-name"
  }, r.dept, " \xB7 ", String(r.time).slice(0, 16).replace('T', ' ')), /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-std"
  }, "\u6AA2\u67E5\u4EBA ", r.inspector, r.onDuty ? ' · 當值 ' + r.onDuty : '', r.failItems ? ' · ✗：' + r.failItems : '')), /*#__PURE__*/React.createElement("span", {
    className: 'pwd-cc-rectag' + (r.result === '不合格' ? ' fail' : ' pass')
  }, r.result, r.failCount > 0 ? ' ✗' + r.failCount : '')), openId === r.id && /*#__PURE__*/React.createElement(CleanCheckMarks, {
    marks: r.marks
  })))));
}

// 本週一（yyyy-MM-dd）：同記錄時間戳做字串比較，唔解析日期字串
function cleanCheckMondayStr() {
  const d = new Date();
  const mon = new Date(d.getTime() - (d.getDay() + 6) % 7 * 86400000);
  return mon.getFullYear() + '-' + String(mon.getMonth() + 1).padStart(2, '0') + '-' + String(mon.getDate()).padStart(2, '0');
}
// 撳開記錄顯示逐項 ✓/✗/N/A（2026-09-06 老闆要求）
function CleanCheckMarks({
  marks
}) {
  const keys = Object.keys(marks || {});
  if (!keys.length) return /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-detail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-std"
  }, "\u6B64\u8A18\u9304\u7121\u9010\u9805\u8CC7\u6599"));
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-detail"
  }, keys.map(k => /*#__PURE__*/React.createElement("div", {
    key: k,
    className: "pwd-cc-drow"
  }, /*#__PURE__*/React.createElement("span", null, k), /*#__PURE__*/React.createElement("span", {
    className: marks[k] === '✓' ? 'm-ok' : marks[k] === '✗' ? 'm-bad' : 'm-na'
  }, marks[k]))));
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
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-week warn"
  }, "\u26A0\uFE0F \u672C\u9031\u5C1A\u672A\u9032\u884C\u6E05\u6F54\u7A81\u64CA\u6AA2\u67E5\uFF1A", missing.join('、'), "\uFF08\u6BCF\u90E8\u9580\u6BCF\u661F\u671F\u81F3\u5C11\u4E00\u6B21\uFF09\xB7 \u8ACB\u5230\u300C\u6E05\u6F54\u6AA2\u67E5\u300D\u5206\u9801\u5B8C\u6210");
}

// ── 員工版清潔檢查摘要（2026-09-05 老闆定「折中」）──
// 員工睇到部門級結果（本月次數＋最近記錄＋✗項目），唔顯示檢查人／當值員工名——
// 名喺後端已按有冇 key 隱去，唔係前端收埋咁簡單。完整記錄喺店長頁。
function CleanCheckSummary() {
  const [records, setRecords] = useState(null);
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    pwApi('cleanCheckList').then(r => {
      if (r.ok) setRecords(r.items);
    }).catch(() => {});
  }, []);
  if (!records || records.length === 0) return null; // 未有記錄唔佔位
  const curMonth = currentMonth();
  const monthRecs = records.filter(r => String(r.time).slice(0, 7) === curMonth);
  const failOf = d => monthRecs.filter(r => r.dept === d && r.result === '不合格').length;
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-card pwd-block"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-eyebrow"
  }, "\uD83E\uDDF9 \u6E05\u6F54\u7A81\u64CA\u6AA2\u67E5 \xB7 \u90E8\u9580\u7D50\u679C"), /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-std"
  }, "\u672C\u6708\u4E0D\u5408\u683C\uFF1A\uD83C\uDFE8 \u9152\u5E97\u90E8 ", failOf('酒店部'), " \u6B21 \xB7 \uD83C\uDF93 \u5B78\u9662\u90E8 ", failOf('學院部'), " \u6B21\uFF08KPI \u76EE\u6A19\uFF1A\u6BCF\u90E8\u9580 \u2264 1\uFF09\xB7 \u9EDE\u64CA\u8A18\u9304\u53EF\u67E5\u770B\u9010\u9805\u7D50\u679C"), records.slice(0, 5).map(r => /*#__PURE__*/React.createElement(React.Fragment, {
    key: r.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-rec",
    onClick: () => setOpenId(openId === r.id ? null : r.id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-recmain"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-name"
  }, r.dept, " \xB7 ", String(r.time).slice(0, 16).replace('T', ' ')), r.failItems && /*#__PURE__*/React.createElement("div", {
    className: "pwd-cc-std"
  }, "\u2717\uFF1A", r.failItems, "\uFF08\u9808\u65BC 24 \u5C0F\u6642\u5167\u6539\u5584\uFF09")), /*#__PURE__*/React.createElement("span", {
    className: 'pwd-cc-rectag' + (r.result === '不合格' ? ' fail' : ' pass')
  }, r.result, r.failCount > 0 ? ' ✗' + r.failCount : '')), openId === r.id && /*#__PURE__*/React.createElement(CleanCheckMarks, {
    marks: r.marks
  }))));
}

// ── ManagerPanel ──
function ManagerPanel({
  month,
  unlocked,
  mgrData,
  onUnlock,
  onLock,
  area,
  onAreaChange
}) {
  if (!unlocked) return /*#__PURE__*/React.createElement(ManagerGate, {
    onUnlock: onUnlock
  });
  if (!mgrData) return /*#__PURE__*/React.createElement("div", {
    className: "pwd-loading",
    style: {
      minHeight: 200,
      background: 'transparent'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-spinner"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-loading-txt",
    style: {
      color: 'var(--pw-ink-mute)'
    }
  }, "\u8F09\u5165\u7BA1\u7406\u6578\u64DA\u2026"));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-banner"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-mgr-banner-ico"
  }, "\uD83D\uDEE0"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "\u5718\u968A\u7BA1\u7406"), /*#__PURE__*/React.createElement("span", null, "\u5E97\u9577\u5C08\u7528 \xB7 \u4F60\u7684 KPI \u7531\u8001\u95C6\u8A55\u6838")), /*#__PURE__*/React.createElement("button", {
    className: "pwd-mgr-lock",
    onClick: onLock
  }, "\uD83D\uDD12 \u9396\u5B9A")), /*#__PURE__*/React.createElement(MgrCleanReminder, null), /*#__PURE__*/React.createElement("div", {
    className: "pwd-mgr-nav"
  }, MGR_AREAS.map(a => /*#__PURE__*/React.createElement("button", {
    key: a.key,
    className: 'pwd-mgr-navbtn' + (area === a.key ? ' on' : ''),
    onClick: () => onAreaChange(a.key)
  }, a.label))), area === 'ops' && /*#__PURE__*/React.createElement(MgrOps, {
    month: month,
    mgrData: mgrData
  }), area === 'kpi' && /*#__PURE__*/React.createElement(MgrKpi, {
    month: month,
    mgrData: mgrData
  }), area === 'club' && /*#__PURE__*/React.createElement(MgrClub, {
    mgrData: mgrData
  }), area === 'swap' && /*#__PURE__*/React.createElement(MgrSwap, {
    mgrData: mgrData
  }), area === 'leave' && /*#__PURE__*/React.createElement(MgrLeave, {
    month: month,
    mgrData: mgrData
  }), area === 'roster' && /*#__PURE__*/React.createElement(MgrRoster, {
    mgrData: mgrData
  }), area === 'clean' && /*#__PURE__*/React.createElement(MgrCleanCheck, null), area === 'ownerkpi' && /*#__PURE__*/React.createElement(MgrOwnerKpi, {
    month: month,
    mgrData: mgrData
  }));
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
  function dashCacheKey(st) {
    return 'pw_dash_' + st.id;
  }
  function readDashCache(st, m) {
    try {
      const c = JSON.parse(localStorage.getItem(dashCacheKey(st)) || 'null');
      return c && c.month === m ? c.res : null;
    } catch (e) {
      return null;
    }
  }
  function writeDashCache(st, m, res) {
    try {
      localStorage.setItem(dashCacheKey(st), JSON.stringify({
        month: m,
        res: res
      }));
    } catch (e) {}
  }
  async function loadDashboard(st, m = month) {
    const cached = readDashCache(st, m);
    if (cached) {
      setDash(cached);
      setStaff({
        ...st,
        ...cached.staff
      });
      setScreen('dash');
      setRefreshing(true);
    } else setScreen('loading');
    try {
      const res = await pwApi('dashboard', {
        staffId: st.id,
        month: m
      });
      if (!res.ok) {
        if (!cached) {
          setErrMsg(res.error || '載入失敗');
          setScreen('error');
        }
        return;
      }
      setDash(res);
      setStaff({
        ...st,
        ...res.staff
      });
      setScreen('dash');
      writeDashCache(st, m, res);
    } catch (e) {
      if (!cached) {
        setErrMsg('連線失敗,請檢查網絡');
        setScreen('error');
      }
    } finally {
      setRefreshing(false);
    }
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
      try {
        const res = await pwApi('managerData', {
          month: m
        });
        if (res.ok) setMgrData(res);
      } catch (e) {}
    }
  }
  // 自動續登
  useEffect(() => {
    // [2026-09-06 老闆批] 記住登入：改用 localStorage，閂咗 app 再開都唔使重新入名+ID（登出先清）
    const saved = localStorage.getItem('pw_staff');
    if (saved) {
      try {
        const st = JSON.parse(saved);
        if (st.role === 'owner') setTab('owner'); // 老闆冇「我的佣金」tab，唔重設會停喺 pay 空白畫面
        setStaff(st);
        loadDashboard(st);
        // 還原管理解鎖：有記住嘅 key 就唔使再入密碼，管理數據背景載
        const mk = localStorage.getItem('pw_mgr_key');
        if (mk && (st.role === 'manager' || st.role === 'owner')) {
          PW_KEY = mk;
          setMgrUnlocked(true);
          pwApi('managerData', {
            month: currentMonth()
          }).then(r => {
            if (r.ok) setMgrData(r);
          }).catch(() => {});
        }
      } catch (e) {}
    }
  }, []);

  // [2026-08-25] 登入速度：res 而家係 login action 嘅合併回應（身份+主面板數據一齊嚟），
  //   唔使好似之前咁再多 call 一次 dashboard——慳返一整程 Apps Script 固定開銷。
  function doLogin(res) {
    const st = res.staff;
    localStorage.setItem('pw_staff', JSON.stringify(st));
    setStaff(st);
    setTab(st.role === 'owner' ? 'owner' : 'pay');
    setMonth(currentMonth());
    setMgrUnlocked(false);
    setMgrData(null);
    setDash(res);
    setScreen('dash');
    writeDashCache(st, currentMonth(), res);
  }
  function doLogout() {
    try {
      if (staff) localStorage.removeItem(dashCacheKey(staff));
    } catch (e) {}
    localStorage.removeItem('pw_staff');
    localStorage.removeItem('pw_mgr_key');
    PW_KEY = '';
    setStaff(null);
    setDash(null);
    setTab('pay');
    setMgrUnlocked(false);
    setMgrData(null);
    setScreen('login');
  }
  async function reloadDash() {
    if (staff) {
      const res = await pwApi('dashboard', {
        staffId: staff.id,
        month
      });
      if (res.ok) {
        setDash(res);
        writeDashCache(staff, month, res);
      }
    }
  }
  async function submitClub({
    dogName,
    phone
  }) {
    // 提名寫唔入就一定要話用戶知——ClubCard 提交後會清空表單收埋，靜靜哋失敗＝隻狗石沉大海
    const ok = await pwWrite('nominate', {
      staffId: staff.id,
      dogName,
      phone
    });
    if (ok) await reloadDash();
  }
  async function submitTrial({
    classId,
    dogName,
    phone,
    customerType,
    ownerName,
    payMethod
  }) {
    const r = await pwApi('trialBook', {
      staffId: staff.id,
      classId,
      dogName,
      phone,
      customerType,
      ownerName,
      payMethod
    });
    await reloadDash();
    return r;
  }
  async function cancelTrial(trialId) {
    await pwWrite('trialCancel', {
      trialId
    });
    await reloadDash(); // 成功失敗都重讀，名單一定同 sheet 一致
  }
  async function submitSwap({
    date,
    shift
  }) {
    await pwWrite('swap', {
      staffId: staff.id,
      date,
      shift
    });
  }
  async function unlockMgr() {
    setMgrUnlocked(true);
    try {
      const res = await pwApi('managerData', {
        month
      });
      if (res.ok) setMgrData(res);
    } catch (e) {}
  }
  if (screen === 'login') return /*#__PURE__*/React.createElement(Login, {
    onLogin: doLogin
  });
  if (screen === 'loading') return /*#__PURE__*/React.createElement("div", {
    className: "pwd-loading"
  }, /*#__PURE__*/React.createElement("img", {
    src: "pawradise-logo-full.png",
    alt: ""
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-spinner"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pwd-loading-txt"
  }, "\u8F09\u5165\u4F60\u7684\u8CC7\u6599\u2026"));
  if (screen === 'error') return /*#__PURE__*/React.createElement("div", {
    className: "pwd-login"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-login-top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-login-crest"
  }, /*#__PURE__*/React.createElement("img", {
    src: "pawradise-logo-full.png",
    alt: ""
  }))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-login-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-login-err"
  }, errMsg), /*#__PURE__*/React.createElement("button", {
    className: "pwd-login-btn",
    onClick: () => staff ? loadDashboard(staff) : setScreen('login')
  }, "\u91CD\u8A66"), /*#__PURE__*/React.createElement("button", {
    className: "pwd-swap-cancel",
    onClick: doLogout
  }, "\u8FD4\u56DE\u767B\u5165")));
  const isManager = staff.role === 'manager';
  const isOwner = staff.role === 'owner';
  const team = dash.team;
  const staffForCalc = {
    ...staff,
    attendance: dash.staff.attendance,
    kpiFail: dash.kpiFail,
    lateLeave: dash.lateLeave
  };
  const {
    calc,
    items,
    kpi,
    lateLeave,
    dogEscape
  } = fullResult(staffForCalc, team);
  return /*#__PURE__*/React.createElement("div", {
    className: "pwd-screen"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-header"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pwd-h-logo"
  }, /*#__PURE__*/React.createElement("img", {
    src: "pawradise-logo.jpg",
    alt: ""
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-h-text"
  }, /*#__PURE__*/React.createElement("h1", null, staff.name), /*#__PURE__*/React.createElement("p", null, isManager ? '店長 · ' : '', "Pawradise \xB7 ", team.month, refreshing ? ' · 🔄 同步中' : '')), /*#__PURE__*/React.createElement("button", {
    className: "pwd-h-logout",
    onClick: doLogout,
    title: "\u767B\u51FA"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-h-ava"
  }, staff.initial))), /*#__PURE__*/React.createElement("div", {
    className: "pwd-body"
  }, (tab === 'pay' || tab === 'owner' || tab === 'mgr' && mgrArea !== 'roster') && /*#__PURE__*/React.createElement("div", {
    className: "pwd-monthbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-monthbar-lbl"
  }, "\u67E5\u770B\u6708\u4EFD"), /*#__PURE__*/React.createElement("select", {
    className: "pwd-monthsel",
    value: month,
    onChange: e => changeMonth(e.target.value)
  }, monthOptions().map(m => /*#__PURE__*/React.createElement("option", {
    key: m,
    value: m
  }, monthLabelFull(m), m === currentMonth() ? ' · 本月' : '')))), tab === 'pay' && !isOwner && /*#__PURE__*/React.createElement(React.Fragment, null, staff.role !== 'frontdesk' && /*#__PURE__*/React.createElement("div", {
    className: "pwd-readout"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-readout-tag"
  }, "\u672C\u6708\u5BE6\u969B"), isManager ? /*#__PURE__*/React.createElement("span", null, "\u9580\u5E97\u7E3D\u696D\u7E3E ", /*#__PURE__*/React.createElement("b", null, money(storeRevenueOf(team)))) : /*#__PURE__*/React.createElement("span", null, "\u65B0\u751F S1", /*#__PURE__*/React.createElement("b", null, team.s1New || 0), "/S2", /*#__PURE__*/React.createElement("b", null, team.s2New || 0), "/\u96D9", /*#__PURE__*/React.createElement("b", null, team.comboNew || 0), " \xB7 \u7E8C\u5831 ", /*#__PURE__*/React.createElement("b", null, team.renewals))), /*#__PURE__*/React.createElement(IndividualView, {
    staff: staff,
    calc: calc,
    items: items,
    kpi: kpi,
    team: team,
    lateLeave: lateLeave,
    dogEscape: dogEscape,
    clubNoms: dash.clubNoms,
    history: dash.history,
    trialSlots: dash.trialSlots,
    trialBookings: dash.trialBookings,
    trialDone: dash.trialDone,
    month: month,
    monthLabel: monthLabelShort(month),
    onClubSubmit: submitClub,
    onTrialBook: submitTrial,
    onTrialCancel: cancelTrial
  }), /*#__PURE__*/React.createElement(CleanCheckSummary, null), /*#__PURE__*/React.createElement("div", {
    className: "pwd-foot"
  }, "\u4F63\u91D1\u70BA\u9810\u4F30\u503C,\u5BE6\u969B\u4EE5\u6708\u7D50\u516C\u4F48\u70BA\u6E96 \xB7 \u66F4\u65B0 ", team.updatedAt, " \xB7 ", APP_VERSION)), tab === 'duty' && /*#__PURE__*/React.createElement(DutyRoster, {
    staff: staff,
    weeks: dash.weeks,
    currentWeekIdx: dash.currentWeekIdx,
    todayDow: dash.todayDow,
    leave: dash.leave,
    leaveRecords: dash.leaveRecords,
    coworkers: dash.coworkers,
    onSwap: submitSwap
  }), tab === 'mgr' && /*#__PURE__*/React.createElement(ManagerPanel, {
    key: month,
    month: month,
    unlocked: mgrUnlocked,
    mgrData: mgrData,
    area: mgrArea,
    onAreaChange: setMgrArea,
    onUnlock: unlockMgr,
    onLock: () => {
      setMgrUnlocked(false);
      localStorage.removeItem('pw_mgr_key');
      PW_KEY = '';
    }
  }), tab === 'owner' && /*#__PURE__*/React.createElement(OwnerOverview, {
    dash: dash,
    mgrUnlocked: mgrUnlocked,
    mgrData: mgrData,
    onUnlock: unlockMgr
  }), tab === 'seats' && /*#__PURE__*/React.createElement(SeatsPanel, {
    staffId: staff.id
  })), /*#__PURE__*/React.createElement("div", {
    className: "pwd-tabbar"
  }, !isOwner && /*#__PURE__*/React.createElement("button", {
    className: 'pwd-tabbtn' + (tab === 'pay' ? ' on' : ''),
    onClick: () => {
      setTab('pay');
      reloadDash();
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-tabbtn-ico"
  }, "\uD83D\uDCB0"), /*#__PURE__*/React.createElement("span", null, "\u6211\u7684\u4F63\u91D1")), /*#__PURE__*/React.createElement("button", {
    className: 'pwd-tabbtn' + (tab === 'duty' ? ' on' : ''),
    onClick: () => {
      setTab('duty');
      reloadDash();
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-tabbtn-ico"
  }, "\uD83D\uDCC5"), /*#__PURE__*/React.createElement("span", null, "\u66F4\u8868")), /*#__PURE__*/React.createElement("button", {
    className: 'pwd-tabbtn' + (tab === 'seats' ? ' on' : ''),
    onClick: () => setTab('seats')
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-tabbtn-ico"
  }, "\uD83C\uDF93"), /*#__PURE__*/React.createElement("span", null, "\u5B78\u4F4D")), isManager && /*#__PURE__*/React.createElement("button", {
    className: 'pwd-tabbtn' + (tab === 'mgr' ? ' on' : ''),
    onClick: () => setTab('mgr')
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-tabbtn-ico"
  }, "\uD83D\uDDC2"), /*#__PURE__*/React.createElement("span", null, "\u5E97\u9577\u5F8C\u53F0")), isOwner && /*#__PURE__*/React.createElement("button", {
    className: 'pwd-tabbtn' + (tab === 'owner' ? ' on' : ''),
    onClick: () => setTab('owner')
  }, /*#__PURE__*/React.createElement("span", {
    className: "pwd-tabbtn-ico"
  }, "\uD83D\uDCCA"), /*#__PURE__*/React.createElement("span", null, "\u8001\u95C6\u7E3D\u89BD"))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement("div", {
  className: "pwd-app"
}, /*#__PURE__*/React.createElement(CommissionApp, null)));
