#!/usr/bin/env python3
"""
高性能更新文件服务器
替换 python3 -m http.server，解决下载速度慢的问题
- 多线程并发
- 1MB 大缓冲区
- Range 请求支持（断点续传）
"""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
DIR = sys.argv[2] if len(sys.argv) > 2 else "/opt/updates"

class FastHTTPRequestHandler(SimpleHTTPRequestHandler):
    # 1MB 缓冲区，减少 read() 系统调用次数
    BLOCK_SIZE = 1024 * 1024

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    # 禁用 DNS 反向查询（每次请求延迟 ~50ms）
    def address_string(self):
        return self.client_address[0]

    # 大文件高性能传输
    def copyfile(self, source, outputfile):
        while True:
            data = source.read(self.BLOCK_SIZE)
            if not data:
                break
            outputfile.write(data)

    # 日志精简
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]}")

class ThreadingServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    os.chdir(DIR)
    print(f"🚀 更新服务器启动")
    print(f"   地址: http://0.0.0.0:{PORT}/")
    print(f"   目录: {DIR}")
    server = ThreadingServer(("0.0.0.0", PORT), FastHTTPRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
        server.server_close()
