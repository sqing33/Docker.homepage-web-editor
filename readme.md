# Homepage Web Editor 🛠️

因为`homepage`每次修改书签都需要去寻找配置文件来修改，很麻烦，所以本项目通过`Web UI`管理`homepage`，自动去修改 `services.yaml` 和 `bookmarks.yaml` 文件，用拖拽和表单的方式完成所有操作！✨
目前初版已经实现了基本的添加、删除、编辑、拖拽排序、修改背景图片等功能，可以一键扫描 Docker 容器添加，图片存储默认保存到本地，可选`minio`存储，其他功能与存储方式后续会逐步完善。

---

## 核心特性 🚀

- **🎨 可视化编辑**: 在网页上直接查看和管理书签，所见即所得。
- **🖐️ 拖拽排序**: 拖动服务卡片、服务组、书签列和书签项，实时重新排序并自动保存。
- **🐳 Docker 导入**: 一键扫描 Docker 容器，并预填写服务名称和 URL。
- **🖼️ 灵活的图片存储**:
  - **Local 模式 (默认)**: 将所有图片存储在本地持久化数据卷中，开箱即用。
  - **MinIO 模式**: 将所有图标上传至 MinIO 对象存储，实现集中管理。
  - 自动抓取网站的 `favicon.ico` 或 `apple-touch-icon`。
  - 支持手动上传自定义图标。
- **🌄 修改 homepage 背景**: 可以上传背景图片，也可以直接使用 URL，并且可以调整饱和度与不透明度。

---

## 快速开始 🏃‍♂️

### 1. 先决条件

- 您已经有一个正在运行的 `homepage` 实例。
- 已安装 `Docker` 和 `Docker Compose`。
- 您知道 `homepage` 配置文件所在的**路径**。

### 2. 配置 `docker-compose.yml`

```yaml
services:
  homepage-web-editor:
    image: sqing33/homepage-web-editor # ghcr.io/sqing33/homepage-web-editor
    container_name: homepage-web-editor
    restart: always
    ports:
      - 3211:3211
    volumes:
      - ./config:/app/homepage/config # homepage 配置文件路径
      - ./data:/app/data
    environment:
      # --- 首次运行时，将使用这些环境变量来生成 config.yaml ---

      # 图片存储策略: 'minio' 或 'local'
      - ICON_STORAGE_STRATEGY=minio

      # MinIO 服务器信息 ('ICON_STORAGE_STRATEGY=minio' 则必须)
      - MINIO_ENDPOINT=http://192.168.1.100:9000
      - MINIO_ACCESS_KEY=your_minio_access_key
      - MINIO_SECRET_KEY=your_minio_secret_key
      - MINIO_ICONS_BUCKET_NAME=icons
      - MINIO_BACKGROUND_BUCKET_NAME=background
      - MINIO_USE_SSL=False # 如果是 https, 请设置为 False

      # Docker API 地址
      - DOCKER_API_ENDPOINT=http://192.168.1.100:2375

  # （可选）homepage 部分
  homepage:
    image: ghcr.io/gethomepage/homepage
    container_name: homepage
    environment:
      HOMEPAGE_ALLOWED_HOSTS: 192.168.1.100:3210
      PUID: 1000
      PGID: 1000
    ports:
      - 3210:3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./config:/app/config
    restart: always
```

### 3. 启动服务

在 `docker-compose.yml` 所在的目录下，运行以下命令：

```bash
docker-compose up -d
```

### 4. 访问 Web UI

现在，打开您的浏览器，访问 http://<您的服务器 IP>:3211，即可开始使用！
