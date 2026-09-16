from pathlib import Path

path = Path('MemberWebsocket-dev/admin/app.js')
text = path.read_text(encoding='utf-8')
old = "styleKey: safePointCardStyle(els.cardStyle.value), expiryMode"
new = "styleKey: safePointCardStyle(els.cardStyle.value), pointCardStyleKey: safePointCardStyle(els.cardStyle.value), expiryMode"
count = text.count(old)
if count != 1:
    raise RuntimeError(f'expected exactly one point-card save payload match, got {count}')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

if 'pointCardStyleKey: safePointCardStyle(els.cardStyle.value)' not in text:
    raise RuntimeError('point-card style persistence bridge was not added')
print('Point-card persistence bridge patched.')
