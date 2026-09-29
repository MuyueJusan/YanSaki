#!/usr/bin/env python3
"""本地假上游 —— 给桌面契约测试（test-aiproxy）当靶子。

它做三件事：
  1. 按用例吐响应，其中 /sse 用**真的分块传输**（chunked）+ 每块 flush + 小延迟，
     这样 Java 那边的读循环必然读到多个块 —— 否则「流式」这件事根本没被测到。
  2. 把**自己实际发出去的正文字节**录到 <out>/<case>.bin。
     ⚠ 这一步是整个测试的支点：断言的是「页面侧还原出来的字节 == 服务器真发出去的字节」，
       而不是「等于测试自己算出来的某个字符串」。少了它，两边一起错也会全绿。
  3. /echo 把收到的请求方法 / 头 / 正文原样回吐，用来验证请求侧没有被转发过程改坏。

⚠ /sse 的分块点**故意切在多字节字符中间**（中文 / emoji 的 UTF-8 序列里），
  这是最容易静默出错的地方：字节层面切开了，任何一处误用「按字符串切」都会把字弄坏。
  服务器会自己核一遍「至少有一个切点落在续字节上」，核不过直接非零退出。

用法：python server.py <out_dir> [port]
"""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8791

# 正文里有中文和 emoji —— 故意要非 ASCII，才能测到 UTF-8 被切断的那条路
SSE_TEXT = (
    'data: {"candidates":[{"content":{"parts":[{"text":"你好"}]}}]}\n'
    '\n'
    'data: {"candidates":[{"content":{"parts":[{"text":"，世界"}]}}]}\n'
    '\n'
    'data: {"candidates":[{"content":{"parts":[{"text":"🌍 完事了"}]}}],'
    '"finishReason":"STOP"}\n'
    '\n'
    'data: [DONE]\n'
    '\n'
)

SSE_BYTES = SSE_TEXT.encode('utf-8')

# 在 1/3、2/3 处切；再挑一个**落在续字节上**的位置作为第三个切点
SPLITS = []
for frac in (3, 6):
    SPLITS.append(len(SSE_BYTES) * frac // 9)


def _find_mid_multibyte(buf, start):
    """从 start 往后找第一个「落在多字节序列中间」的位置（0b10xxxxxx 续字节）。"""
    for i in range(start, len(buf)):
        if buf[i] & 0xC0 == 0x80:
            return i
    return None


_mid = _find_mid_multibyte(SSE_BYTES, len(SSE_BYTES) // 2)
assert _mid is not None, '找不到多字节字符中间的位置 —— 测试前提不成立'
SPLITS.append(_mid)
SPLITS = sorted(set(SPLITS))

# ⚠ 自核：真的有一个切点落在续字节上吗？不成立就说明这个测试根本没测到那条路。
assert any(SSE_BYTES[i] & 0xC0 == 0x80 for i in SPLITS), '切点全在字符边界上，白测'

JSON_BODY = json.dumps(
    {"candidates": [{"content": {"parts": [{"text": "单块 JSON 回复"}]}}]},
    ensure_ascii=False).encode('utf-8')

ERR_BODY = json.dumps(
    {"error": {"code": 400, "message": "API key not valid. 这个正文必须原样送到页面",
               "status": "INVALID_ARGUMENT"}},
    ensure_ascii=False).encode('utf-8')


def record(name, data):
    with open(os.path.join(OUT, name + '.bin'), 'wb') as f:
        f.write(data)


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass          # 别把日志混进 stdout

    def _read_body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    def _plain(self, status, body, ctype='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def do_GET(self):
        if self.path.startswith('/models'):
            body = json.dumps({"models": [{"name": "gemini-2.5-pro"},
                                          {"name": "gemini-2.5-flash"}]}).encode()
            record('models', body)
            self._plain(200, body)
            return
        self._plain(404, b'{"error":"no such path"}')

    def do_POST(self):
        body = self._read_body()
        path = self.path.split('?')[0]

        if path == '/sse':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Transfer-Encoding', 'chunked')
            self.end_headers()
            prev = 0
            for sp in SPLITS + [len(SSE_BYTES)]:
                part = SSE_BYTES[prev:sp]
                prev = sp
                if part:
                    self.wfile.write(('%x\r\n' % len(part)).encode() + part + b'\r\n')
                    self.wfile.flush()
                    time.sleep(0.05)
            self.wfile.write(b'0\r\n\r\n')
            self.wfile.flush()
            record('sse', SSE_BYTES)
            return

        if path == '/json':
            record('json', JSON_BODY)
            self._plain(200, JSON_BODY)
            return

        if path == '/err':
            record('err', ERR_BODY)
            self._plain(400, ERR_BODY)
            return

        if path == '/echo':
            payload = json.dumps({
                "method": self.command,
                "path": self.path,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "body": body.decode('utf-8', 'replace'),
            }, ensure_ascii=False).encode('utf-8')
            record('echo', payload)
            self._plain(200, payload)
            return

        self._plain(404, b'{"error":"no such path"}')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    print('READY %d' % PORT, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
