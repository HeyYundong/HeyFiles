# HeyFiles

内网设备之间一对一加密传文件。手机、电脑都可以直接在浏览器里用，不用装 App，也不用数据线。

- **一对一直传**：选中一台在线设备，选择文件，对方点「接收」。文件从一台设备直接传到另一台，**不经过服务器存储**。
- **全程加密**：页面走 HTTPS，文件走 WebRTC DataChannel（DTLS 加密）。路由器和同网络里的其他人看不到文件名，也看不到内容。
- **不留记录**：没有历史，没有收件箱。传完关闭就没了。
- **部署简单**：一个 podman 容器，一个端口（7000），一个数据卷（只存证书）。

## 工作原理

```
  手机 (浏览器)                    HeyFiles 服务器 :7000                    电脑 (浏览器)
       │                                                                      │
       │ ── HTTPS 打开页面 / WSS 信令（交换连接信息，不含文件）──▶ ◀── 同上 ── │
       │                                                                      │
       │ ◀════════════ WebRTC DataChannel（DTLS 加密，点对点直连）═════════▶ │
       │                文件名、文件内容只走这条通道                            │
```

1. 每台设备打开 HeyFiles 后通过 WebSocket 连到服务器，服务器把在线设备列表推给大家。
2. 发送方选好设备和文件后，双方通过服务器交换 WebRTC 的 offer/answer（只有连接参数）。
3. 两台浏览器建立点对点加密通道。文件清单和文件内容都只在这条通道里传。
4. 两端会显示同一个 **6 位安全码**（由双方 DTLS 证书指纹计算）。两边的码一致，就说明中间没有人冒充。
5. 接收方点「接收」后开始传输。传完自动保存或手动保存，连接随即关闭。

### 为什么内网也要 HTTPS

- 没有 HTTPS 时，被控制的路由器可以篡改网页代码，让加密形同虚设。
- 浏览器的加密 API（`crypto.subtle`）和 Service Worker 只在 HTTPS 下可用。有了 Service Worker，大文件可以边收边写盘，不用整个放进内存。

内网没有域名，也拿不到公网证书，所以 HeyFiles **自带一个本地证书机构（CA）**：

- 首次启动时自动生成根证书，保存在数据卷 `/data` 里。
- 每台设备只需安装一次根证书，之后访问 `https://<服务器IP>:7000` 就是正常的小锁，没有警告。
- 服务器证书按访问的 IP 自动签发。服务器换了 IP 也不用重装根证书。
- 根证书带 **Name Constraints**，只能给内网地址（`10.x`、`172.16–31.x`、`192.168.x`、`127.x`）和 `.local` / `.lan` / `.home.arpa` / `.internal` 签证书。**即使 `ca.key` 泄露，也没法用来冒充银行之类的外网网站。**

### 一个端口两种协议

7000 端口会根据每个连接的第一个字节自动判断协议：

| 访问地址 | 作用 |
|---|---|
| `http://<IP>:7000` | 证书安装页：下载根证书、各系统安装说明，自动检测是否已信任，信任后自动跳转到 HTTPS |
| `https://<IP>:7000` | HeyFiles 主程序 |

## 快速开始

### 1. 构建镜像

```bash
podman build -t heyfiles .
```

### 2. 运行

```bash
podman run -d --name heyfiles --network host -v heyfiles-data:/data --restart unless-stopped localhost/heyfiles
```

- `--network host`：让服务器看到真实的局域网 IP，这样才能按 IP 签发证书、显示设备 IP。
- `-v heyfiles-data:/data`：保存根证书。**删掉这个卷，所有设备都要重新安装证书。**

查看日志，里面有访问地址和根证书指纹：

```bash
podman logs heyfiles
```

```
HeyFiles listening on :7000 (HTTPS and HTTP share this port)
CA certificate SHA-256: 3A:7F:…
CA thumbprint (Windows, SHA-1): 1A2B3C4D …
  open http://192.168.1.20:7000 on each device to install the certificate
```

如果开了防火墙，要放行 7000 端口：

```bash
sudo ufw allow 7000/tcp
```

（firewalld：`sudo firewall-cmd --add-port=7000/tcp --permanent && sudo firewall-cmd --reload`）

### 3. 每台设备装一次证书

在每台设备的浏览器打开 `http://<服务器IP>:7000`，按页面提示操作：

| 系统 | 步骤 |
|---|---|
| iPhone / iPad | 用 Safari 下载 → 「设置」顶部「已下载描述文件」→ 安装 →「设置 → 通用 → 关于本机 → 证书信任设置」打开开关 |
| Android | 下载 → 「设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书」（可在设置里搜索“CA 证书”） |
| Windows | 见下方 [Windows 详细步骤](#windows-详细步骤)。注意：**不要用默认的“自动选择存储”** |
| macOS | 双击加入钥匙串 → 在「钥匙串访问」里把 HeyFiles Local CA 设为「始终信任」 |
| Firefox（所有系统） | Firefox 用自己的证书库：设置 → 隐私与安全 → 证书 → 查看证书 → 证书颁发机构 → 导入 |

#### Windows 详细步骤

Chrome 和 Edge 都使用 Windows 系统证书库，装一次两个浏览器都生效。括号里是英文版 Windows 的按钮名称。

**方法一：图形界面**

1. 在安装页点「下载 HeyFiles 证书」。如果浏览器提示文件可能有害，选「保留」（Keep）。
2. 双击下载的 `HeyFiles-CA.crt`。如果弹出“打开文件 - 安全警告”，点「打开」（Open）。
3. 点「安装证书…」（Install Certificate…）。
4. 存储位置选「当前用户」（Current User）→「下一步」（Next）。
   选「本地计算机」（Local Machine）对所有用户生效，但需要管理员权限。
5. ⚠ 到“证书存储”（Certificate Store）这一步，**不要用默认的「根据证书类型，自动选择证书存储」**（Automatically select the certificate store…）。默认会把证书放进“中间证书颁发机构”，浏览器仍然不会信任。
6. 选「将所有的证书都放入下列存储」（Place all certificates in the following store）→「浏览…」（Browse…）→「**受信任的根证书颁发机构**」（Trusted Root Certification Authorities）→「确定」（OK）。
7. 「下一步」（Next）→「完成」（Finish）。
8. 弹出“安全警告”（Security Warning）时，核对其中的「指纹 (sha1)」（Thumbprint (sha1)）。它要和安装页上、以及 `podman logs heyfiles` 中 `CA thumbprint (Windows, SHA-1)` 那一行一致。一致再点「是」（Yes）。
9. 看到“导入成功”（The import was successful）即完成。

**方法二：命令行**

下载证书后，在“命令提示符”里运行（不需要管理员）：

```bat
certutil -user -addstore Root "%USERPROFILE%\Downloads\HeyFiles-CA.crt"
```

PowerShell 里把 `%USERPROFILE%` 换成 `$env:USERPROFILE`。同样会弹出安全警告，核对指纹后点「是」。

**装好之后**

- **彻底关闭浏览器**：关闭所有窗口，并在任务栏右下角托盘里退出仍在后台运行的 Chrome / Edge。重新打开后访问 `http://<服务器IP>:7000`，页面检测到已信任会自动跳转到 HTTPS。
- 地址栏有小锁、没有“不安全”（Not secure），就说明成功了。

**还是提示“不安全”？**

1. 按 `Win + R`，输入 `certmgr.msc` 回车。
2. 在「受信任的根证书颁发机构 → 证书」里找 **HeyFiles Local CA**。
3. 如果没有，多半装到了「中间证书颁发机构」（Intermediate Certification Authorities）。在那里删掉它，再按上面的步骤重新安装。
4. 重新安装后要彻底重启浏览器。

**Firefox**：默认使用自己的证书库。在 设置 → 隐私与安全 → 证书 →「查看证书」→「证书颁发机构」→「导入」，勾选「信任由此证书颁发机构来标识网站」。

**删除证书**：打开 `certmgr.msc` →「受信任的根证书颁发机构 → 证书」→ 右键 HeyFiles Local CA →「删除」。

---

安装页也是 HTTP 的，为了防止证书在下载途中被调包，可以把页面上显示的指纹和 `podman logs heyfiles` 里的对比一下。

装好后打开 `https://<服务器IP>:7000` 即可使用。建议把这个地址加到主屏幕或收藏夹。

## 使用

1. 两台设备都打开 `https://<服务器IP>:7000`，会在对方的「局域网内的设备」里互相看到。
2. 发送方点选目标设备，拖入或选择文件，点「发送」。
3. 接收方弹出确认框，核对**两边的 6 位安全码一致**后点「接收」。
4. 传输完成：
   - Chrome / Edge / Firefox：文件直接进入浏览器的下载目录。
   - Safari（iPhone / iPad / Mac）：点每个文件的「保存」，或「全部保存」。

点右上角的铅笔图标可以修改设备名称。

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `HEYFILES_PORT` | `7000` | 监听端口（HTTP 和 HTTPS 共用） |
| `HEYFILES_DATA` | `/data`（容器内） | 根证书存放目录 |
| `HEYFILES_HOSTS` | 空 | 额外写进服务器证书的 IP 或内网域名，逗号分隔，如 `192.168.1.20,nas.lan` |

### 不使用 host 网络

如果不能用 `--network host`，可以映射端口，但要用 `HEYFILES_HOSTS` 告诉它宿主机的局域网 IP：

```bash
podman run -d --name heyfiles -p 7000:7000 -e HEYFILES_HOSTS=192.168.1.20 -v heyfiles-data:/data --restart unless-stopped localhost/heyfiles
```

这种方式下，设备列表里显示的 IP 可能是容器网关地址，不影响传输。

### 开机自启（systemd）

```bash
podman generate systemd --new --name heyfiles > ~/.config/systemd/user/heyfiles.service
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now heyfiles
```

```bash
loginctl enable-linger $USER
```

（最后一条让用户服务在没有登录时也能运行。）

## 本地开发

需要 Node.js 22+ 和 Go 1.24+。

```bash
cd web && npm ci && npm run build
```

```bash
go run .
```

然后打开 `http://localhost:7000` 安装证书（开发时生成的证书在 `./data`）。

前端热更新可以在 `web/` 里运行 `npm run dev`，但 WebSocket 和 Service Worker 依赖 Go 服务，完整流程建议用上面的方式。

## 已知限制

- **需要两台设备能直连**。路由器开启「AP 隔离」或使用「访客网络」时，设备之间互相访问不到，连接会失败。请关闭 AP 隔离，或连到同一个主网络。
- **Safari 先收进内存再保存**。在 iPhone 上接收几个 GB 的文件可能会内存不足。电脑上建议用 Chrome、Edge 或 Firefox 接收大文件。
- **一次只能进行一个传输**。传输进行中，其他设备发来的请求会被自动拒绝，并提示对方稍后再试。
- **服务器是可信的**。HTTPS 保证网页代码由你的服务器发出、没被篡改；安全码可以发现信令被冒充，但无法防御服务器本身被入侵后下发恶意代码。

## 项目结构

```
├── main.go          # 入口：单端口协议分流、路由、静态文件
├── certs.go         # 本地 CA：生成根证书、按 IP 动态签发服务器证书
├── hub.go           # 信令：在线设备列表、转发 WebRTC offer/answer
├── setup.html       # HTTP 证书安装页
├── Containerfile    # 多阶段构建：Node 构建前端 → Go 编译 → scratch 镜像
└── web/             # 前端（Vite + React + shadcn/ui）
    ├── public/sw.js           # Service Worker：大文件流式下载
    └── src/lib/
        ├── session.ts         # WebRTC 传输协议与安全码
        ├── signaling.ts       # WebSocket 信令客户端
        ├── sinks.ts           # 接收端写入（流式 / 内存）
        └── store.ts           # 全局状态
```
