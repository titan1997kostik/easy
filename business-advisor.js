(function () {
  'use strict';

  var rootId = 'businessAdvisorRoot';
  var initialized = false;

  function el(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }
  function money(value) {
    return num(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  }
  function dateString(date) {
    if (typeof window.getLocalDateString === 'function') return window.getLocalDateString(date);
    var d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function getBounds(days) {
    var today = new Date();
    var end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1);
    var previousEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, 23, 59, 59, 999);
    var previousStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), previousEnd.getDate() - days + 1);
    return {
      start: dateString(start), end: dateString(end),
      previousStart: dateString(previousStart), previousEnd: dateString(previousEnd),
      days: days
    };
  }
  function storeLabel(id) {
    var stores = window.STORES || {};
    return stores[String(id)] || ('Магазин ' + String(id));
  }
  function getVisibleStores() {
    try {
      return typeof window.getVisibleStoreKeys === 'function' ? window.getVisibleStoreKeys().map(String) : [];
    } catch (error) { return []; }
  }
  function buildMarkup(page) {
    if (!page || el(rootId)) return;
    var section = document.createElement('section');
    section.id = rootId;
    section.className = 'business-advisor-module';
    section.style.marginTop = '18px';
    section.innerHTML =
      '<div class="business-advisor-filters" style="display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' +
        '<div class="form-group" style="margin:0;flex:1;min-width:150px;"><label for="businessAdvisorPeriod">Период анализа</label><select id="businessAdvisorPeriod"><option value="7">Последние 7 дней</option><option value="30" selected>Последние 30 дней</option><option value="90">Последние 90 дней</option></select></div>' +
        '<div class="form-group" style="margin:0;flex:1;min-width:170px;"><label for="businessAdvisorStore">Магазин</label><select id="businessAdvisorStore"><option value="all">Все доступные магазины</option></select></div>' +
        '<button type="button" class="btn btn-secondary" id="businessAdvisorRefresh">↻ Пересчитать</button>' +
      '</div>' +
      '<p id="businessAdvisorPeriodLabel" style="font-size:12px;color:var(--text-light);margin:0 0 12px;"></p>' +
      '<section class="card" id="businessAdvisorStoreFinanceCard" style="padding:18px;margin:0 0 14px;">' +
        '<h3 style="margin:0 0 12px;border:0;padding:0;">Сравнение магазинов</h3>' +
        '<div id="businessAdvisorStoreFinance" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:8px;"></div>' +
      '</section>' +
      '<section class="card" id="businessAdvisorBreakEvenCard" style="padding:18px;margin:0;">' +
        '<h3 style="margin:0 0 12px;border:0;padding:0;">ТОЧКИ БЕЗУБЫТОЧНОСТИ</h3>' +
        '<div id="businessAdvisorExpenseAnalysis"></div>' +
      '</section>';
    page.appendChild(section);
    if (!initialized) {
      var period = el('businessAdvisorPeriod');
      var store = el('businessAdvisorStore');
      var refresh = el('businessAdvisorRefresh');
      if (period) period.addEventListener('change', render);
      if (store) store.addEventListener('change', render);
      if (refresh) refresh.addEventListener('click', render);
      initialized = true;
    }
  }
function fillStoreOptions(selected) {
    var select = el('businessAdvisorStore');
    if (!select) return 'all';
    var visible = getVisibleStores();
    var previous = selected || select.value || 'all';
    var html = '<option value="all">Все доступные магазины</option>';
    visible.forEach(function (id) {
      html += '<option value="' + esc(id) + '">' + esc(storeLabel(id)) + '</option>';
    });
    select.innerHTML = html;
    select.value = previous === 'all' || visible.indexOf(String(previous)) !== -1 ? String(previous) : 'all';
    return select.value;
  }
  function getFinancialSummary(start, end, storeId) {
    if (typeof window.getEasyFinancialSummary !== 'function') return null;
    try { return window.getEasyFinancialSummary(start, end, storeId); }
    catch (error) { console.warn('Easy financial summary unavailable:', error); return null; }
  }
  function financialPercent(value) {
    return num(value).toLocaleString('ru-RU', { maximumFractionDigits:1 }) + '%';
  }
  function percentagePoints(value) {
    return num(value).toLocaleString('ru-RU', { maximumFractionDigits:1 }) + ' п.п.';
  }
  function financialChange(current, previous) {
    current = num(current); previous = num(previous);
    if (previous === 0) return current === 0 ? 0 : null;
    return (current - previous) / Math.abs(previous);
  }
  function financialRow(label, value, note, total, negative) {
    var displayed = value === null || value === undefined ? '—' : money(Math.abs(num(value)));
    if (value !== null && value !== undefined && (num(value) < 0 || (negative && num(value) > 0))) displayed = '−' + displayed;
    return '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 9px;border:1px solid var(--border);border-radius:9px;margin:5px 0;background:' + (total ? '#fbeaf1' : '#fff') + ';">' +
      '<div style="min-width:0;font-size:12px;line-height:1.4;' + (total ? 'font-weight:800;' : '') + '">' + esc(label) +
      (note ? '<div style="font-size:10px;color:var(--text-light);font-weight:400;margin-top:2px;">' + esc(note) + '</div>' : '') + '</div>' +
      '<strong style="white-space:nowrap;font-size:12px;font-variant-numeric:tabular-nums;' + (negative && value !== null && num(value) > 0 ? 'color:#b42336;' : '') + '">' + esc(displayed) + '</strong></div>';
  }
  function renderFinancialPanel(storeRows) {
    var storeHost = el('businessAdvisorStoreFinance');
    if (!storeHost) return;
    if (!storeRows || !storeRows.length) {
      storeHost.innerHTML = '<p style="font-size:12px;color:var(--text-light);">Нет доступных магазинов для сравнения.</p>';
      return;
    }
    storeRows.sort(function(a,b) {
      var aReady = a.summary && a.summary.netProfit !== null && a.summary.netProfit !== undefined && a.summary.costCalculationAvailable;
      var bReady = b.summary && b.summary.netProfit !== null && b.summary.netProfit !== undefined && b.summary.costCalculationAvailable;
      if (aReady !== bReady) return aReady ? -1 : 1;
      return aReady ? num(b.summary.netProfit) - num(a.summary.netProfit) : String(a.name).localeCompare(String(b.name), 'ru');
    });
    var storeCards = storeRows.map(function(item) {
      var summary = item.summary;
      var ready = summary && summary.costCalculationAvailable && summary.netProfit !== null && summary.netProfit !== undefined;
      var net = ready ? ((!summary.costDataComplete ? '≈ ' : '') + money(summary.netProfit)) : '—';
      var margin = ready && summary.grossMargin !== null ? financialPercent(summary.grossMargin) : '—';
      var state = !ready ? 'Себестоимость неполная' : summary.costDataComplete ? 'Фактические цены' : 'Есть оценка';
      return '<article style="border:1px solid var(--border);border-radius:10px;padding:10px;background:#fff;min-width:0;">' +
        '<strong style="display:block;font-size:12px;margin-bottom:7px;">' + esc(item.name) + '</strong>' +
        '<div style="font-size:17px;font-weight:800;line-height:1.3;">' + esc(net) + '</div>' +
        '<div style="font-size:10px;color:var(--text-light);margin-top:3px;">Результат до распределения общих расходов · валовая маржа ' + esc(margin) + '</div>' +
        '<div style="font-size:10px;color:var(--text-light);margin-top:5px;">Выручка ' + esc(summary ? money(summary.netRevenue) : '—') + ' · расходы магазина ' + esc(summary ? money(summary.allExpenses) : '—') + '</div>' +
        '<div style="font-size:10px;margin-top:6px;color:' + (ready && summary.costDataComplete ? '#28764d' : '#9a6414') + ';">' + esc(state) + '</div></article>';
    }).join('');
    storeHost.innerHTML = '<p style="grid-column:1/-1;font-size:11px;line-height:1.5;color:var(--text-light);margin:0 0 4px;">Показан результат по расходам, привязанным к каждому магазину. Общие расходы организации не распределяются автоматически, а оценка себестоимости по магазинам может отличаться от общей. Поэтому суммы карточек не обязаны складываться в консолидированную чистую прибыль.</p>' + storeCards;
  }

  function renderExpenseAnalysis(current, storeRows, selectedStore, periodDays) {
    var host = el('businessAdvisorExpenseAnalysis');
    if (!host) return;

    var days = Math.max(1, Math.floor(num(periodDays) || 30));
    var monthFactor = 30 / days;

    function calculateBreakEven(summary) {
      if (!summary || !summary.costCalculationAvailable ||
          summary.netRevenue === null || summary.netRevenue === undefined ||
          num(summary.netRevenue) <= 0 ||
          summary.costOfGoods === null || summary.costOfGoods === undefined) return null;

      // Себестоимость, налог и комиссии зависят от выручки.
      // Обычные, регулярные расходы и начисленная зарплата формируют
      // сумму, которую нужно покрыть маржинальным доходом.
      var variableCosts = num(summary.costOfGoods) +
        num(summary.tax) + num(summary.cardFee) + num(summary.sbpFee);
      var contributionRate = (num(summary.netRevenue) - variableCosts) / num(summary.netRevenue);
      if (!isFinite(contributionRate) || contributionRate <= 0) return null;

      var operatingCosts = num(summary.expenses) + num(summary.salaryExpenses);
      if (!isFinite(operatingCosts) || operatingCosts < 0) return null;

      var periodBreakEven = operatingCosts / contributionRate;
      var monthlyBreakEven = periodBreakEven * monthFactor;
      var monthlyRevenue = num(summary.netRevenue) * monthFactor;
      var dailyTarget = monthlyBreakEven / 30;
      var averageNetCheck = num(summary.salesCount) > 0
        ? num(summary.netRevenue) / num(summary.salesCount)
        : 0;

      return {
        monthlyBreakEven: monthlyBreakEven,
        monthlyRevenue: monthlyRevenue,
        dailyTarget: dailyTarget,
        averageNetCheck: averageNetCheck,
        checksPerDay: averageNetCheck > 0 ? Math.ceil(dailyTarget / averageNetCheck) : null,
        gap: monthlyBreakEven - monthlyRevenue,
        approximate: summary.costDataComplete !== true || days !== 30
      };
    }

    function checkWord(value) {
      var n = Math.abs(Math.floor(value)) % 100;
      if (n >= 11 && n <= 14) return 'чеков';
      var last = n % 10;
      return last === 1 ? 'чек' : (last >= 2 && last <= 4 ? 'чека' : 'чеков');
    }

    function renderCard(title, summary, sharedNote) {
      var result = calculateBreakEven(summary);
      var titleHtml = '<div style="font-size:13px;font-weight:750;margin-bottom:10px;">' + esc(title) + '</div>';
      if (!result) {
        return '<article style="border:1px solid var(--border);border-radius:12px;padding:14px;background:#fff;min-width:0;">' +
          titleHtml +
          '<div style="font-size:12px;line-height:1.5;color:var(--text-light);">Точка безубыточности пока не рассчитана. Нужны положительная выручка, доступная себестоимость и положительный маржинальный доход после переменных затрат.</div>' +
          (sharedNote ? '<div style="font-size:10px;line-height:1.45;color:var(--text-light);margin-top:8px;">' + esc(sharedNote) + '</div>' : '') +
          '</article>';
      }

      var prefix = result.approximate ? '≈ ' : '';
      var revenueLabel = days === 30
        ? 'Выручка за выбранные 30 дней'
        : 'Выручка в пересчёте на 30 дней';
      var gapLabel = result.gap > 0.005 ? 'Не хватает' : 'Выше точки безубыточности на';
      var gapValue = money(Math.abs(result.gap));
      var gapColor = result.gap > 0.005 ? '#a16615' : '#28764d';
      var checksValue = result.checksPerDay === null
        ? '—'
        : String(result.checksPerDay) + ' ' + checkWord(result.checksPerDay);
      var checksNote = result.averageNetCheck > 0
        ? 'В день при среднем чеке ' + money(result.averageNetCheck)
        : 'Недостаточно продаж для расчёта среднего чека';

      return '<article style="border:1px solid var(--border);border-radius:12px;padding:14px;background:#fff;min-width:0;">' +
        titleHtml +
        '<div style="font-size:11px;color:var(--text-light);font-weight:650;">Необходимая выручка за месяц</div>' +
        '<div style="font-size:26px;font-weight:850;line-height:1.2;margin:4px 0 12px;font-variant-numeric:tabular-nums;">' + prefix + esc(money(result.monthlyBreakEven)) + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr));gap:9px;">' +
          '<div style="padding:10px;border-radius:10px;background:#f8f5f7;">' +
            '<div style="font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;">' + prefix + esc(money(result.dailyTarget)) + '</div>' +
            '<div style="font-size:10px;color:var(--text-light);margin-top:3px;">В день</div>' +
          '</div>' +
          '<div style="padding:10px;border-radius:10px;background:#f8f5f7;">' +
            '<div style="font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;">' + (result.approximate && result.checksPerDay !== null ? '≈ ' : '') + esc(checksValue) + '</div>' +
            '<div style="font-size:10px;color:var(--text-light);margin-top:3px;">' + esc(checksNote) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:10px;">' +
          '<div style="font-size:11px;font-weight:750;margin-bottom:7px;">Фактическая ситуация</div>' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;font-size:12px;">' +
            '<span style="color:var(--text-light);">' + esc(revenueLabel) + '</span>' +
            '<strong style="font-variant-numeric:tabular-nums;">' + (days !== 30 ? '≈ ' : '') + esc(money(result.monthlyRevenue)) + '</strong>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;font-size:12px;margin-top:6px;">' +
            '<span style="color:var(--text-light);">' + esc(gapLabel) + '</span>' +
            '<strong style="color:' + gapColor + ';font-variant-numeric:tabular-nums;">' + prefix + esc(gapValue) + '</strong>' +
          '</div>' +
        '</div>' +
        (sharedNote ? '<div style="font-size:10px;line-height:1.45;color:var(--text-light);margin-top:9px;">' + esc(sharedNote) + '</div>' : '') +
      '</article>';
    }

    var cards = [];
    if (selectedStore === 'all') {
      cards.push(renderCard('Вся сеть', current,
        'В расчёт включены общие расходы организации. Ниже магазины показаны отдельно, без распределения общих расходов.'));
      (storeRows || []).forEach(function(item) {
        if (!item || !item.summary) return;
        cards.push(renderCard(item.name || storeLabel(item.id), item.summary,
          'Общие расходы организации в расчёт этого магазина не включены.'));
      });
    } else {
      var matched = (storeRows || []).filter(function(item) { return item && item.summary; });
      if (matched.length) {
        matched.forEach(function(item) {
          cards.push(renderCard(item.name || storeLabel(item.id), item.summary,
            'Общие расходы организации в расчёт этого магазина не включены.'));
        });
      } else {
        cards.push(renderCard(storeLabel(selectedStore), current,
          'Общие расходы организации в расчёт этого магазина не включены.'));
      }
    }

    if (!cards.length) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-light);">Нет доступных данных для расчёта точки безубыточности.</p>';
      return;
    }

    var periodNote = days === 30
      ? 'Расчёт выполнен за выбранные 30 дней. Месячный показатель рассчитан на базе фактической выручки и затрат этого периода.'
      : 'Период анализа — ' + days + ' дней. Показатели приведены к 30-дневному эквиваленту по среднему дневному результату выбранного периода.';
    var qualityNote = current && current.costDataComplete === false
      ? 'Себестоимость частично оценочная, поэтому точка безубыточности и разница с ней приблизительные (≈).'
      : 'В точке безубыточности учтены возвраты, себестоимость, налог, эквайринг, обычные и регулярные расходы, а также начисленная зарплата.';
    host.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,255px),1fr));gap:10px;">' + cards.join('') + '</div>' +
      '<p style="font-size:10px;line-height:1.45;color:var(--text-light);margin:9px 0 0;">' + esc(periodNote) + ' ' + esc(qualityNote) + ' Число чеков рассчитано по средней выручке на чек после возвратов.</p>';
  }

  function render() {
    var page = el('workspacePage-analytics');
    if (!page || !window.currentUser || window.currentUser.role !== 'admin') return;
    buildMarkup(page);
    var days = Number(el('businessAdvisorPeriod') && el('businessAdvisorPeriod').value) || 30;
    if ([7,30,90].indexOf(days) === -1) days = 30;
    var selectedStore = fillStoreOptions(el('businessAdvisorStore') && el('businessAdvisorStore').value || 'all');
    var bounds = getBounds(days);
    var visibleKeys = getVisibleStores();
    var periodLabel = el('businessAdvisorPeriodLabel');
    if (periodLabel) {
      periodLabel.textContent = bounds.start.split('-').reverse().join('.') + ' — ' +
        bounds.end.split('-').reverse().join('.') + ' · ' +
        (selectedStore === 'all' ? 'все доступные магазины' : storeLabel(selectedStore));
    }
    if (!visibleKeys.length || typeof window.getEasyFinancialSummary !== 'function') {
      renderFinancialPanel([]);
      renderExpenseAnalysis(null, [], selectedStore, days);
      return;
    }
    var financeStoreIds = selectedStore === 'all' ? visibleKeys.slice() : [selectedStore];
    var financeStoreRows = financeStoreIds.map(function(id) {
      return { id:String(id), name:storeLabel(id), summary:getFinancialSummary(bounds.start, bounds.end, String(id)) };
    }).filter(function(item) { return !!item.summary; });
    var financialCurrent = getFinancialSummary(bounds.start, bounds.end, selectedStore);
    renderFinancialPanel(financeStoreRows);
    renderExpenseAnalysis(financialCurrent, financeStoreRows, selectedStore, days);
  }

  window.renderBusinessAdvisor = render;
})();