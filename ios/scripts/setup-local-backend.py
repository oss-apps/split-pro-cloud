"""Generate a secret-free, isolated prototype .env. Does not start or touch other databases."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[2]
target = root / '.env'
if target.exists():
    raise SystemExit('Refusing to overwrite an existing .env. Configure the local prototype manually.')
text = (root / '.env.example').read_text()
text = text.replace('postgresql://splitpro:password@localhost:54321/splitpro',
                    'postgresql://postgres:pw@localhost:55452/spswift')
text = text.replace('NEXTAUTH_SECRET="secret"', f'NEXTAUTH_SECRET="{secrets.token_hex(32)}"')
text = text.replace('http://localhost:3000', 'http://localhost:3192')
for key, value in {'FROM_EMAIL': 'SplitPro <hello@example.test>', 'EMAIL_SERVER_HOST': 'localhost',
                   'EMAIL_SERVER_PORT': '1025', 'EMAIL_SERVER_USER': 'local',
                   'EMAIL_SERVER_PASSWORD': 'local'}.items():
    text = text.replace(f'{key}=\n', f'{key}={value}\n')
text += '\nREVIEW_LOGIN_EMAIL=alex@example.test\nREVIEW_LOGIN_CODE=SWIFT26\n'
target.write_text(text)
print('Created isolated localhost:3192 config. Review code is SWIFT26 for alex@example.test only.')
