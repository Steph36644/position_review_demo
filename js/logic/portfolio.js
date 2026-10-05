/* Pure helpers for the daily snapshot book (holdings + overview). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.App = root.App || {};
    Object.keys(api).forEach(function (k) { root.App[k] = api[k]; });
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  function listDates(book) {
    var dates = (book && book.dates ? book.dates.slice() : []);
    dates.sort();
    return dates;
  }

  function overviewFor(book, date) {
    if (!book || !book.overview) return null;
    return book.overview[date] || null;
  }

  function holdingsFor(book, date, includeCleared) {
    var rows = (book && book.holdings && book.holdings[date]) ? book.holdings[date].slice() : [];
    if (!includeCleared) {
      rows = rows.filter(function (row) { return !row.cleared; });
    }
    return rows;
  }

  function sumField(rows, field) {
    return rows.reduce(function (acc, row) {
      var n = Number(row[field]);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
  }

  function marketValueWeights(rows) {
    var total = sumField(rows, 'market_value');
    return rows.map(function (row) {
      var mv = Number(row.market_value) || 0;
      return {
        name: row.name,
        market_value: mv,
        weight: total ? (mv / total) * 100 : 0
      };
    });
  }

  function dayPnlRank(rows) {
    return rows.filter(function (row) {
      return row.day_pnl !== null && row.day_pnl !== undefined && !row.cleared;
    }).slice().sort(function (a, b) {
      return Number(b.day_pnl) - Number(a.day_pnl);
    });
  }

  function assetSeries(book) {
    return listDates(book).map(function (date) {
      var ov = overviewFor(book, date) || {};
      return {
        date: date,
        total_assets: ov.total_assets == null ? null : Number(ov.total_assets),
        day_pnl: ov.day_pnl == null ? null : Number(ov.day_pnl),
        floating_pnl: ov.floating_pnl == null ? null : Number(ov.floating_pnl),
        market_value: ov.market_value == null ? null : Number(ov.market_value)
      };
    });
  }

  function snapshotSymbols(book) {
    var seen = {};
    var names = [];
    listDates(book).forEach(function (date) {
      (book.holdings[date] || []).forEach(function (row) {
        if (!seen[row.name]) {
          seen[row.name] = true;
          names.push(row.name);
        }
      });
    });
    names.sort();
    return names;
  }

  function seriesPoints(values, width, height, pad) {
    var box = pad || { l: 8, r: 8, t: 8, b: 8 };
    var nums = values.map(function (v) { return Number(v); });
    var min = Math.min.apply(null, nums);
    var max = Math.max.apply(null, nums);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    if (min === max) {
      min -= 1;
      max += 1;
    }
    var innerW = width - box.l - box.r;
    var innerH = height - box.t - box.b;
    return nums.map(function (v, i) {
      var x = box.l + (nums.length === 1 ? innerW / 2 : (innerW * i) / (nums.length - 1));
      var y = box.t + innerH * (1 - (v - min) / (max - min));
      return {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        value: v
      };
    });
  }

  return {
    listDates: listDates,
    overviewFor: overviewFor,
    holdingsFor: holdingsFor,
    sumField: sumField,
    marketValueWeights: marketValueWeights,
    dayPnlRank: dayPnlRank,
    assetSeries: assetSeries,
    snapshotSymbols: snapshotSymbols,
    seriesPoints: seriesPoints
  };
});
