const IMPORTANT = new Set(['urgent', 'emergency', 'critical', 'warning']);
const TYPES = new Set(['earthquake', 'storm', 'severe_accident']);
const RANK = { emergency: 4, critical: 3, urgent: 2, warning: 1 };

function selectEssentialAlerts(alerts, matchesPreferences = () => true) {
  return [...alerts].filter(alert =>
    alert.active !== false && alert.recordKind !== 'news_report' && IMPORTANT.has(String(alert.severity).toLowerCase()) &&
    TYPES.has(String(alert.type).toLowerCase()) && matchesPreferences(alert)
  ).sort((a, b) =>
    RANK[String(b.severity).toLowerCase()] - RANK[String(a.severity).toLowerCase()]
  ).slice(0, 3).map(alert => ({
    type: alert.type,
    title: alert.title || alert.type,
    areaText: alert.areaText || '',
    source: alert.source || '',
    isIndexedNews: String(alert.category || '').includes('ข่าวเฝ้าระวัง'),
  }));
}

module.exports = { selectEssentialAlerts };
