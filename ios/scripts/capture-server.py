"""Local-only XCTest screenshot bridge; simctl always targets our dedicated simulator."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import re
import subprocess

DEVICE = '0EDC4F34-BC38-402E-87FD-501ABADE73A1'
OUTPUT = Path.home() / 'git/personal/notes/splitpro/native-proto/swiftui'
OUTPUT.mkdir(parents=True, exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        params = parse_qs(urlparse(self.path).query)
        name = params.get('name', [''])[0]
        theme = params.get('theme', [''])[0]
        if theme in ['light', 'dark']:
            subprocess.run(['xcrun', 'simctl', 'ui', DEVICE, 'appearance', theme], check=True)
        elif re.fullmatch(r'[a-z0-9-]+', name):
            subprocess.run(['xcrun', 'simctl', 'io', DEVICE, 'screenshot', str(OUTPUT / f'{name}.png')], check=True)
        else:
            self.send_error(400)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')


HTTPServer(('127.0.0.1', 3193), Handler).serve_forever()
