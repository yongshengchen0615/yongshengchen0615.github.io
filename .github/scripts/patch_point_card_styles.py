from pathlib import Path
import re

ROOT = Path('.')

POINT_KEYS = ['citrus', 'coral', 'lagoon', 'skyline', 'violet', 'berry', 'cocoa', 'lime', 'denim', 'peach']
POINT_LABELS = {
    'citrus': '柑橘氣泡', 'coral': '珊瑚蘇打', 'lagoon': '潟湖水光', 'skyline': '晴空城市',
    'violet': '電光紫', 'berry': '莓果霓虹', 'cocoa': '可可拿鐵', 'lime': '萊姆汽水',
    'denim': '丹寧晴藍', 'peach': '蜜桃冰沙',
}
LEGACY_MAP = {
    'forest': 'lagoon', 'midnight': 'skyline', 'ocean': 'denim', 'sunset': 'coral',
    'lavender': 'violet', 'rose': 'berry', 'gold': 'citrus', 'platinum': 'cocoa',
    'mint': 'lime', 'cherry': 'peach',
}
MEMBERSHIP_KEYS = {'forest', 'midnight', 'ocean', 'sunset', 'lavender', 'rose', 'gold', 'platinum', 'mint', 'cherry'}


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected 1 literal match, got {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def regex_once(path: str, pattern: str, replacement: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{path}: expected 1 regex match, got {count}: {pattern[:120]!r}')
    p.write_text(updated, encoding='utf-8')


def js_array(values):
    return '[' + ', '.join(repr(v) for v in values) + ']'


def js_object(values):
    return '{ ' + ', '.join(f'{k}: {v!r}' for k, v in values.items()) + ' }'


if MEMBERSHIP_KEYS.intersection(POINT_KEYS):
    raise RuntimeError('Point-card style keys must not overlap membership-tier style keys.')
if len(POINT_KEYS) != 10 or len(set(POINT_KEYS)) != 10:
    raise RuntimeError('Exactly 10 unique point-card presets are required.')

# Admin UI: split point-card presets from membership-tier presets.
admin = 'MemberWebsocket-dev/admin/app.js'
marker = "  const MEMBERSHIP_TIER_STYLE_LABELS = Object.freeze({ forest: '森林綠', midnight: '午夜藍', ocean: '海灣青', sunset: '夕陽橘', lavender: '薰衣草紫', rose: '玫瑰粉', gold: '金曜棕', platinum: '鉑金灰', mint: '薄荷綠', cherry: '櫻桃紅' });\n"
replace_once(
    admin,
    marker,
    marker
    + f"  const POINT_CARD_STYLE_KEYS = Object.freeze({js_array(POINT_KEYS)});\n"
    + f"  const POINT_CARD_STYLE_LABELS = Object.freeze({js_object(POINT_LABELS)});\n"
    + f"  const LEGACY_POINT_CARD_STYLE_MAP = Object.freeze({js_object(LEGACY_MAP)});\n",
)
replace_once(
    admin,
    "    MEMBERSHIP_TIER_STYLE_KEYS.forEach((styleKey) => { const option = document.createElement('option'); option.value = styleKey; option.textContent = MEMBERSHIP_TIER_STYLE_LABELS[styleKey]; select.append(option); });",
    "    POINT_CARD_STYLE_KEYS.forEach((styleKey) => { const option = document.createElement('option'); option.value = styleKey; option.textContent = POINT_CARD_STYLE_LABELS[styleKey]; select.append(option); });",
)
replace_once(
    admin,
    "  function updatePointCardStylePreview() { if (els.cardStyle && els.cardStylePreview) updateStylePreview(els.cardStyle, els.cardStylePreview, '目前集點卡面'); }\n  function updateStylePreview(select, preview, prefix) { const styleKey = safeTierStyle(select.value); preview.dataset.style = styleKey; preview.setAttribute('aria-label', `${prefix}：${MEMBERSHIP_TIER_STYLE_LABELS[styleKey]}`); const name = preview.querySelector('[data-style-preview-name]'); if (name) name.textContent = MEMBERSHIP_TIER_STYLE_LABELS[styleKey]; }",
    "  function updatePointCardStylePreview() { if (!els.cardStyle || !els.cardStylePreview) return; const styleKey = safePointCardStyle(els.cardStyle.value); els.cardStylePreview.dataset.style = styleKey; els.cardStylePreview.setAttribute('aria-label', `目前集點卡面：${POINT_CARD_STYLE_LABELS[styleKey]}`); const name = els.cardStylePreview.querySelector('[data-style-preview-name]'); if (name) name.textContent = POINT_CARD_STYLE_LABELS[styleKey]; }\n  function updateStylePreview(select, preview, prefix) { const styleKey = safeTierStyle(select.value); preview.dataset.style = styleKey; preview.setAttribute('aria-label', `${prefix}：${MEMBERSHIP_TIER_STYLE_LABELS[styleKey]}`); const name = preview.querySelector('[data-style-preview-name]'); if (name) name.textContent = MEMBERSHIP_TIER_STYLE_LABELS[styleKey]; }",
)
replace_once(admin, "els.cardStyle.value = safeTierStyle(card.styleKey);", "els.cardStyle.value = safePointCardStyle(card.styleKey);")
replace_once(admin, "els.cardStyle.value = 'forest'; updatePointCardStylePreview();", "els.cardStyle.value = POINT_CARD_STYLE_KEYS[0]; updatePointCardStylePreview();")
replace_once(admin, "styleKey: safeTierStyle(els.cardStyle.value)", "styleKey: safePointCardStyle(els.cardStyle.value)")
replace_once(
    admin,
    "  function safeTierStyle(value) { const styleKey = String(value || '').trim(); return MEMBERSHIP_TIER_STYLE_KEYS.includes(styleKey) ? styleKey : 'forest'; }",
    "  function safeTierStyle(value) { const styleKey = String(value || '').trim(); return MEMBERSHIP_TIER_STYLE_KEYS.includes(styleKey) ? styleKey : 'forest'; }\n  function safePointCardStyle(value) { const styleKey = String(value || '').trim().toLowerCase(); return POINT_CARD_STYLE_KEYS.includes(styleKey) ? styleKey : (LEGACY_POINT_CARD_STYLE_MAP[styleKey] || POINT_CARD_STYLE_KEYS[0]); }",
)

# Member point-card view: accept new presets and map legacy stored values without breaking old cards.
points_app = 'MemberWebsocket-dev/points/app.js'
replace_once(
    points_app,
    "  const POINT_CARD_STYLE_KEYS = Object.freeze([\n    'forest', 'midnight', 'ocean', 'sunset', 'lavender',\n    'rose', 'gold', 'platinum', 'mint', 'cherry'\n  ]);",
    f"  const POINT_CARD_STYLE_KEYS = Object.freeze({js_array(POINT_KEYS)});\n  const LEGACY_POINT_CARD_STYLE_MAP = Object.freeze({js_object(LEGACY_MAP)});",
)
replace_once(
    points_app,
    "  function safeCardStyle(value) {\n    const styleKey = String(value || '').trim().toLowerCase();\n    return POINT_CARD_STYLE_KEYS.includes(styleKey) ? styleKey : 'forest';\n  }",
    "  function safeCardStyle(value) {\n    const styleKey = String(value || '').trim().toLowerCase();\n    return POINT_CARD_STYLE_KEYS.includes(styleKey) ? styleKey : (LEGACY_POINT_CARD_STYLE_MAP[styleKey] || POINT_CARD_STYLE_KEYS[0]);\n  }",
)

# Ticket renderer: inherit source card preset and split redemption cost into responsive cards.
ticket_js = 'MemberWebsocket-dev/points/pointcard-ticket-overview.js'
replace_once(
    ticket_js,
    "  'use strict';\n\n  const state = {",
    "  'use strict';\n\n"
    + f"  const POINT_CARD_STYLE_KEYS = Object.freeze({js_array(POINT_KEYS)});\n"
    + f"  const LEGACY_POINT_CARD_STYLE_MAP = Object.freeze({js_object(LEGACY_MAP)});\n\n"
    + "  const state = {",
)
replace_once(
    ticket_js,
    "  function points(value) {\n    return Math.max(0, Number(value || 0));\n  }",
    "  function points(value) {\n    return Math.max(0, Number(value || 0));\n  }\n\n  function safeCardStyle(value) {\n    const styleKey = String(value || '').trim().toLowerCase();\n    return POINT_CARD_STYLE_KEYS.includes(styleKey) ? styleKey : (LEGACY_POINT_CARD_STYLE_MAP[styleKey] || POINT_CARD_STYLE_KEYS[0]);\n  }",
)
replace_once(
    ticket_js,
    "          cardTitle: String(card.title || '集點卡'),\n          cardStamps,",
    "          cardTitle: String(card.title || '集點卡'),\n          cardStyleKey: safeCardStyle(card.styleKey),\n          cardStamps,",
)
replace_once(
    ticket_js,
    "  function render() {\n    if (!state.snapshot || !ensureUi() || !groups) return;",
    "  function createCostCard(label, value, modifier = '') {\n    const row = document.createElement('div');\n    row.className = `ticket-cost-card${modifier ? ` ${modifier}` : ''}`;\n    const term = document.createElement('dt');\n    term.textContent = label;\n    const detail = document.createElement('dd');\n    detail.textContent = value;\n    row.append(term, detail);\n    return row;\n  }\n\n  function render() {\n    if (!state.snapshot || !ensureUi() || !groups) return;",
)
replace_once(
    ticket_js,
    "        item.className = `member-ticket${offer.baseCanUse ? ' is-ready' : ' locked'}${isSelected ? ' is-selected' : ''}`;",
    "        item.className = `member-ticket${offer.baseCanUse ? ' is-ready' : ' locked'}${isSelected ? ' is-selected' : ''}`;\n        item.dataset.cardStyle = safeCardStyle(offer.cardStyleKey);",
)
replace_once(
    ticket_js,
    "        const cost = document.createElement('p');\n        cost.className = 'ticket-overview-meta';\n        cost.textContent = `兌換需扣 ${points(offer.thresholdStamps)} 點｜目前 ${offer.cardStamps} 點｜扣點來源：${offer.cardTitle}`;",
    "        const cost = document.createElement('dl');\n        cost.className = 'ticket-cost-cards';\n        cost.append(\n          createCostCard('兌換需扣', `${points(offer.thresholdStamps)} 點`, 'is-cost'),\n          createCostCard('目前點數', `${offer.cardStamps} 點`, 'is-balance'),\n          createCostCard('扣點來源', offer.cardTitle, 'is-source')\n        );",
)

# Shared point-card preset variables used by the main card and its tickets.
styles = 'MemberWebsocket-dev/points/styles.css'
preset_block = '''/* Point-card presets use a separate namespace from membership-tier card styles. */
.card-tab[aria-selected="true"] { background: var(--card-style-background, var(--card-style-surface, var(--ink))); border-color: var(--card-style-surface, var(--ink)); }
.active-card[data-card-style="citrus"], .card-tab[data-card-style="citrus"], .member-ticket[data-card-style="citrus"] { --card-style-surface: #6f2f0e; --card-style-background: linear-gradient(135deg, #6f2f0e 0%, #a84e13 56%, #573018 100%); --card-style-accent: #ffd29a; }
.active-card[data-card-style="coral"], .card-tab[data-card-style="coral"], .member-ticket[data-card-style="coral"] { --card-style-surface: #7a2630; --card-style-background: linear-gradient(135deg, #7a2630 0%, #b24c3b 55%, #5f2330 100%); --card-style-accent: #ffc0ad; }
.active-card[data-card-style="lagoon"], .card-tab[data-card-style="lagoon"], .member-ticket[data-card-style="lagoon"] { --card-style-surface: #07505b; --card-style-background: linear-gradient(135deg, #07505b 0%, #0b7380 55%, #123d4c 100%); --card-style-accent: #9ee9df; }
.active-card[data-card-style="skyline"], .card-tab[data-card-style="skyline"], .member-ticket[data-card-style="skyline"] { --card-style-surface: #1b3f72; --card-style-background: linear-gradient(135deg, #1b3f72 0%, #2567a7 55%, #182e52 100%); --card-style-accent: #b9dbff; }
.active-card[data-card-style="violet"], .card-tab[data-card-style="violet"], .member-ticket[data-card-style="violet"] { --card-style-surface: #3d286c; --card-style-background: linear-gradient(135deg, #3d286c 0%, #6d4aa0 55%, #2a234e 100%); --card-style-accent: #ddc5ff; }
.active-card[data-card-style="berry"], .card-tab[data-card-style="berry"], .member-ticket[data-card-style="berry"] { --card-style-surface: #662445; --card-style-background: linear-gradient(135deg, #662445 0%, #9a3b6e 55%, #47223f 100%); --card-style-accent: #ffc4df; }
.active-card[data-card-style="cocoa"], .card-tab[data-card-style="cocoa"], .member-ticket[data-card-style="cocoa"] { --card-style-surface: #523328; --card-style-background: linear-gradient(135deg, #523328 0%, #80503b 55%, #3d2a26 100%); --card-style-accent: #f3c8a6; }
.active-card[data-card-style="lime"], .card-tab[data-card-style="lime"], .member-ticket[data-card-style="lime"] { --card-style-surface: #315422; --card-style-background: linear-gradient(135deg, #315422 0%, #5d7e28 55%, #263d24 100%); --card-style-accent: #d9ef9c; }
.active-card[data-card-style="denim"], .card-tab[data-card-style="denim"], .member-ticket[data-card-style="denim"] { --card-style-surface: #314658; --card-style-background: linear-gradient(135deg, #314658 0%, #52718b 55%, #263846 100%); --card-style-accent: #c5dbea; }
.active-card[data-card-style="peach"], .card-tab[data-card-style="peach"], .member-ticket[data-card-style="peach"] { --card-style-surface: #78383b; --card-style-background: linear-gradient(135deg, #78383b 0%, #b75f4f 55%, #5d3038 100%); --card-style-accent: #ffd0bd; }
.active-card[data-card-style] { background: var(--card-style-background, var(--card-style-surface, var(--ink))); }'''
regex_once(
    styles,
    r'/\* Point-card style presets are selected by the admin and rendered consistently in the member LIFF\. \*/\n\.card-tab\[aria-selected="true"\][\s\S]*?\.active-card\[data-card-style\] \{ background: var\(--card-style-surface, var\(--ink\)\); \}',
    preset_block,
)

# Theme ticket surfaces and make the cost cards responsive.
ticket_css = ROOT / 'MemberWebsocket-dev/points/pointcard-ticket-overview.css'
css = ticket_css.read_text(encoding='utf-8')
if '.ticket-cost-cards{' in css:
    raise RuntimeError('ticket cost-card CSS unexpectedly already exists')
css += '''
/* Ticket cards inherit their source point-card preset and keep redemption data readable at every width. */
.ticket-overview-group .member-ticket[data-card-style]{position:relative;overflow:hidden;color:var(--paper);background:var(--card-style-background,var(--card-style-surface,var(--ink)));border-color:rgba(255,250,243,.18);border-radius:22px;box-shadow:0 18px 34px rgba(40,32,22,.14)}
.ticket-overview-group .member-ticket[data-card-style]::before{content:"";position:absolute;right:-76px;bottom:-102px;width:180px;height:180px;border:1px solid rgba(255,250,243,.2);border-radius:50%;box-shadow:0 0 0 24px rgba(255,250,243,.045),0 0 0 48px rgba(255,250,243,.025);pointer-events:none}
.ticket-overview-group .member-ticket[data-card-style]>*{position:relative;z-index:1;min-width:0}
.ticket-overview-group .member-ticket[data-card-style] h3{color:var(--paper)}
.ticket-overview-group .member-ticket[data-card-style] p,.ticket-overview-group .member-ticket[data-card-style] .ticket-state{color:rgba(255,250,243,.74)}
.ticket-overview-group .member-ticket[data-card-style] .member-ticket-method{color:rgba(255,250,243,.9)}
.ticket-overview-group .member-ticket[data-card-style] .member-ticket-type{color:var(--card-style-surface,#282016);background:var(--card-style-accent,#fff0d3)}
.ticket-overview-group .member-ticket[data-card-style].locked{filter:saturate(.72);opacity:.76}
.ticket-overview-group .member-ticket[data-card-style].is-selected{border-color:var(--card-style-accent,#f2c36f);box-shadow:0 18px 38px rgba(40,32,22,.2),0 0 0 2px rgba(255,250,243,.28)}
.ticket-cost-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:4px 0 0}
.ticket-cost-card{min-width:0;padding:10px 11px;border:1px solid rgba(255,250,243,.17);border-radius:12px;background:rgba(255,250,243,.09)}
.ticket-cost-card dt{color:rgba(255,250,243,.62);font-size:9px;font-weight:800;letter-spacing:.02em}
.ticket-cost-card dd{min-width:0;margin:4px 0 0;color:var(--paper);font-size:12px;font-weight:850;line-height:1.45;overflow-wrap:anywhere}
.ticket-overview-group .member-ticket[data-card-style] .ticket-checkbox-action{color:var(--paper);background:rgba(255,250,243,.12);border-color:rgba(255,250,243,.26)}
.ticket-overview-group .member-ticket[data-card-style].is-selected .ticket-checkbox-action{color:var(--card-style-surface,#282016);background:var(--card-style-accent,#f2c36f);border-color:transparent}
@media(max-width:480px){.ticket-cost-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.ticket-cost-card.is-source{grid-column:1/-1}.ticket-overview-group .member-ticket[data-card-style]{border-radius:18px;padding:16px}}
@media(max-width:340px){.ticket-cost-cards{grid-template-columns:1fr}.ticket-cost-card.is-source{grid-column:auto}}
'''
ticket_css.write_text(css, encoding='utf-8')

# Admin point-card preview swatches; membership preview swatches remain unchanged.
admin_css = ROOT / 'MemberWebsocket-dev/admin/styles.css'
css = admin_css.read_text(encoding='utf-8')
marker = '.style-preview[data-style="cherry"] .style-thumbnail { background: linear-gradient(135deg, #76253d, #c64f68); }\n'
if css.count(marker) != 1:
    raise RuntimeError('admin style-preview insertion marker is missing or duplicated')
point_swatches = '''.style-preview[data-style="citrus"] .style-thumbnail { background: linear-gradient(135deg, #6f2f0e, #a84e13 56%, #573018); }
.style-preview[data-style="coral"] .style-thumbnail { background: linear-gradient(135deg, #7a2630, #b24c3b 55%, #5f2330); }
.style-preview[data-style="lagoon"] .style-thumbnail { background: linear-gradient(135deg, #07505b, #0b7380 55%, #123d4c); }
.style-preview[data-style="skyline"] .style-thumbnail { background: linear-gradient(135deg, #1b3f72, #2567a7 55%, #182e52); }
.style-preview[data-style="violet"] .style-thumbnail { background: linear-gradient(135deg, #3d286c, #6d4aa0 55%, #2a234e); }
.style-preview[data-style="berry"] .style-thumbnail { background: linear-gradient(135deg, #662445, #9a3b6e 55%, #47223f); }
.style-preview[data-style="cocoa"] .style-thumbnail { background: linear-gradient(135deg, #523328, #80503b 55%, #3d2a26); }
.style-preview[data-style="lime"] .style-thumbnail { background: linear-gradient(135deg, #315422, #5d7e28 55%, #263d24); }
.style-preview[data-style="denim"] .style-thumbnail { background: linear-gradient(135deg, #314658, #52718b 55%, #263846); }
.style-preview[data-style="peach"] .style-thumbnail { background: linear-gradient(135deg, #78383b, #b75f4f 55%, #5d3038); }
'''
admin_css.write_text(css.replace(marker, marker + point_swatches, 1), encoding='utf-8')

# Cache bust modified frontend assets so LINE LIFF clients receive the new UI immediately.
replace_once('MemberWebsocket-dev/points/index.html', './styles.css?v=loading-center-all-20260910', './styles.css?v=point-card-presets-20260916-1')
replace_once('MemberWebsocket-dev/points/index.html', './pointcard-ticket-overview.css?v=single-ticket-renderer-20260916-1', './pointcard-ticket-overview.css?v=point-card-presets-20260916-1')
replace_once('MemberWebsocket-dev/points/index.html', './pointcard-ticket-overview.js?v=single-ticket-renderer-20260916-2', './pointcard-ticket-overview.js?v=point-card-presets-20260916-1')
replace_once('MemberWebsocket-dev/points/index.html', './app.js?v=single-ticket-renderer-20260916-2', './app.js?v=point-card-presets-20260916-1')
replace_once('MemberWebsocket-dev/admin/index.html', './styles.css?v=loading-center-all-20260910', './styles.css?v=point-card-presets-20260916-1')
replace_once('MemberWebsocket-dev/admin/index.html', './app.js?v=supabase-native-booking-20260910-1', './app.js?v=point-card-presets-20260916-1')

# Static assertions: distinct namespace, exact count, ticket linkage and responsive cost-card structure.
for path in [admin, 'MemberWebsocket-dev/admin/styles.css', points_app, styles, ticket_js]:
    text = (ROOT / path).read_text(encoding='utf-8')
    missing = [key for key in POINT_KEYS if key not in text]
    if missing:
        raise RuntimeError(f'{path}: missing point-card preset keys: {missing}')

ticket_text = (ROOT / ticket_js).read_text(encoding='utf-8')
for needle in [
    'cardStyleKey: safeCardStyle(card.styleKey)',
    'item.dataset.cardStyle = safeCardStyle(offer.cardStyleKey)',
    "createCostCard('兌換需扣'",
    "createCostCard('目前點數'",
    "createCostCard('扣點來源'",
]:
    if needle not in ticket_text:
        raise RuntimeError(f'ticket renderer missing required behavior: {needle}')

print('Point-card preset patch completed successfully.')
