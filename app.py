import os
import uuid
import yaml
import requests
import shutil
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from minio import Minio
from flask import Flask, render_template, request, jsonify, send_from_directory

# homepage 配置文件路径
HOMEPAGE_CONFIG_PATH = '/app/homepage/config/services.yaml'
HOMEPAGE_SETTINGS_PATH = '/app/homepage/config/settings.yaml'
HOMEPAGE_BOOKMARKS_PATH = '/app/homepage/config/bookmarks.yaml'

UPLOAD_FOLDER = '/tmp/homepage-tool-uploads'
LOCAL_ICON_PATH = '/app/data/icons'
LOCAL_BACKGROUND_PATH = '/app/data/backgrounds'

# 初始化 Flask 应用
app = Flask(__name__, static_folder='static', static_url_path='/static')
app.secret_key = 'a_very_secure_and_random_secret_key_that_you_should_change'

# 存储策略
ICON_STORAGE_STRATEGY = os.getenv('ICON_STORAGE_STRATEGY', 'local')
print(f"统一存储策略已设置为: '{ICON_STORAGE_STRATEGY}'")

# MinIO 配置
MINIO_ENDPOINT = os.getenv('MINIO_ENDPOINT')
MINIO_ACCESS_KEY = os.getenv('MINIO_ACCESS_KEY')
MINIO_SECRET_KEY = os.getenv('MINIO_SECRET_KEY')
MINIO_ICONS_BUCKET_NAME = os.getenv('MINIO_ICONS_BUCKET_NAME', 'icons')
MINIO_BACKGROUND_BUCKET_NAME = os.getenv('MINIO_BACKGROUND_BUCKET_NAME',
                                         'background')
MINIO_USE_SSL = os.getenv('MINIO_USE_SSL', 'true').lower() == 'true'

# Docker API 配置
DOCKER_API_ENDPOINT = os.getenv('DOCKER_API_ENDPOINT')

if DOCKER_API_ENDPOINT:
    print("Docker API 端点已加载。")
if MINIO_ENDPOINT and ICON_STORAGE_STRATEGY == 'minio':
    print("MinIO 配置已加载。")

# --- 根据存储策略条件化地注册路由 ---
if ICON_STORAGE_STRATEGY == 'local':

    @app.route('/icons/<path:filename>')
    def serve_icon(filename):
        return send_from_directory(LOCAL_ICON_PATH, filename)

    print("本地图标服务 API (/icons) 已启用。")

    @app.route('/backgrounds/<path:filename>')
    def serve_background(filename):
        return send_from_directory(LOCAL_BACKGROUND_PATH, filename)

    print("本地背景服务 API (/backgrounds) 已启用。")
else:
    print("由于存储策略不是 'local'，本地文件服务 API (/icons, /backgrounds) 已被禁用。")

# 确保所有必要的目录都存在
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(LOCAL_ICON_PATH, exist_ok=True)
os.makedirs(LOCAL_BACKGROUND_PATH, exist_ok=True)

# 初始化 MinIO 客户端
minio_client = None
if MINIO_ENDPOINT and ICON_STORAGE_STRATEGY == 'minio':
    try:
        # 从完整的 endpoint URL 中提取 host:port 部分
        minio_pure_endpoint = urlparse(
            MINIO_ENDPOINT).netloc or MINIO_ENDPOINT.split('//')[-1]
        minio_client = Minio(minio_pure_endpoint,
                             access_key=MINIO_ACCESS_KEY,
                             secret_key=MINIO_SECRET_KEY,
                             secure=MINIO_USE_SSL)
        # 这里可以添加对存储桶存在性的检查，但为了简化启动流程，也可以在实际使用时再检查
        print("MinIO 客户端初始化成功。")
    except Exception as e:
        print(f"致命错误: 无法连接到 MinIO。请检查您的 MINIO 环境变量。错误: {e}")
        minio_client = None


# --- 工具函数 ---
def fetch_and_save_icon(url):
    """根据 URL 抓取网站图标 (favicon)"""
    headers = {
        'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
    }
    temp_icon_path = None
    try:
        # 禁用 InsecureRequestWarning 警告
        requests.packages.urllib3.disable_warnings(
            requests.packages.urllib3.exceptions.InsecureRequestWarning)

        # 1. 尝试直接访问 /favicon.ico
        parsed_url = urlparse(url)
        favicon_ico_url = f"{parsed_url.scheme}://{parsed_url.netloc}/favicon.ico"
        response = requests.get(favicon_ico_url,
                                verify=False,
                                timeout=5,
                                headers=headers)
        if response.status_code == 200 and 'image' in response.headers.get(
                'Content-Type', '').lower():
            filename = f"{uuid.uuid4()}.ico"
            temp_icon_path = os.path.join(UPLOAD_FOLDER, filename)
            with open(temp_icon_path, 'wb') as f:
                f.write(response.content)
            return temp_icon_path

        # 2. 如果失败，则解析 HTML 页面查找 <link> 标签
        page_response = requests.get(url,
                                     verify=False,
                                     timeout=10,
                                     headers=headers)
        page_response.raise_for_status()
        soup = BeautifulSoup(page_response.text, 'html.parser')
        icon_links = soup.find_all('link',
                                   rel=lambda r: r and 'icon' in r.lower())
        if not icon_links: return None

        # 通常最后一个链接是最高清的
        best_link = icon_links[-1].get('href')
        if not best_link: return None

        icon_url = urljoin(url, best_link)
        icon_response = requests.get(icon_url,
                                     verify=False,
                                     timeout=10,
                                     headers=headers)
        icon_response.raise_for_status()

        ext = os.path.splitext(urlparse(icon_url).path)[1] or '.png'
        filename = f"{uuid.uuid4()}{ext}"
        temp_icon_path = os.path.join(UPLOAD_FOLDER, filename)
        with open(temp_icon_path, 'wb') as f:
            f.write(icon_response.content)
        return temp_icon_path
    except Exception as e:
        # 如果过程中发生错误，清理已下载的临时文件
        if temp_icon_path and os.path.exists(temp_icon_path):
            os.remove(temp_icon_path)
        return None


def save_file_locally(temp_path, destination_directory):
    """将临时文件保存到本地持久化目录"""
    try:
        filename = os.path.basename(temp_path)
        permanent_path = os.path.join(destination_directory, filename)
        shutil.copy2(temp_path, permanent_path)
        return filename
    except Exception as e:
        print(f"保存文件到 {destination_directory} 时出错: {e}")
        return None


def upload_to_minio(file_path, bucket_name):
    """上传文件到 MinIO 对象存储"""
    if not minio_client: return None
    try:
        object_prefix = "backgrounds/" if bucket_name == MINIO_BACKGROUND_BUCKET_NAME else "icons/"
        object_name = f"{object_prefix}{uuid.uuid4()}_{os.path.basename(file_path)}"
        minio_client.fput_object(bucket_name, object_name, file_path)
        return f"{MINIO_ENDPOINT.rstrip('/')}/{bucket_name}/{object_name}"
    except Exception as e:
        print(f"上传到 MinIO 失败: {e}")
        return None


# --- API 路由 ---
@app.route('/')
def index():
    """提供主页面"""
    return render_template('index.html')


@app.route('/api/settings', methods=['GET'])
def get_settings():
    """获取 settings.yaml 的内容"""
    try:
        with open(HOMEPAGE_SETTINGS_PATH, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f) or {}
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({})
    except Exception as e:
        return jsonify({"error": f"读取 settings.yaml 失败: {e}"}), 500


@app.route('/api/settings/background', methods=['POST'])
def save_background_settings():
    """保存背景设置到 settings.yaml"""
    new_bg_data = request.get_json()
    all_settings = {}
    try:
        with open(HOMEPAGE_SETTINGS_PATH, 'r', encoding='utf-8') as f:
            all_settings = yaml.safe_load(f) or {}
    except FileNotFoundError:
        pass  # 如果文件不存在，就创建一个新的

    all_settings['background'] = new_bg_data
    try:
        with open(HOMEPAGE_SETTINGS_PATH, 'w', encoding='utf-8') as f:
            yaml.dump(all_settings,
                      f,
                      allow_unicode=True,
                      sort_keys=False,
                      indent=2)
        return jsonify({"message": "背景设置已成功保存！"})
    except Exception as e:
        return jsonify({"error": f"写入 settings.yaml 失败: {e}"}), 500


@app.route('/api/backgrounds', methods=['GET'])
def list_backgrounds():
    """列出所有可用的背景图片"""
    if ICON_STORAGE_STRATEGY == 'minio':
        if not minio_client: return jsonify({"error": "MinIO 未配置"}), 500
        try:
            if not minio_client.bucket_exists(MINIO_BACKGROUND_BUCKET_NAME):
                print(f"MinIO 存储桶 '{MINIO_BACKGROUND_BUCKET_NAME}' 不存在。")
                return jsonify([])
            objects = minio_client.list_objects(MINIO_BACKGROUND_BUCKET_NAME,
                                                recursive=True)
            image_urls = [{
                "url":
                f"{MINIO_ENDPOINT.rstrip('/')}/{MINIO_BACKGROUND_BUCKET_NAME}/{obj.object_name}",
                "name": obj.object_name
            } for obj in objects]
            return jsonify(image_urls)
        except Exception as e:
            return jsonify({"error": f"从 MinIO 列出背景失败: {e}"}), 500
    elif ICON_STORAGE_STRATEGY == 'local':
        try:
            if not os.path.exists(LOCAL_BACKGROUND_PATH): return jsonify([])
            files = os.listdir(LOCAL_BACKGROUND_PATH)
            image_urls = [{
                "url": f"/backgrounds/{f}",
                "name": f
            } for f in files]
            return jsonify(image_urls)
        except Exception as e:
            return jsonify({"error": f"从本地列出背景失败: {e}"}), 500
    return jsonify([])  # 默认返回空列表


@app.route('/api/backgrounds/upload', methods=['POST'])
def upload_background():
    """上传新的背景图片"""
    if 'file' not in request.files: return jsonify({"error": "请求中没有文件部分"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "没有选择文件"}), 400

    temp_file_path = None
    try:
        filename = f"{uuid.uuid4()}-{os.path.basename(file.filename)}"
        temp_file_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(temp_file_path)

        final_url = None
        if ICON_STORAGE_STRATEGY == 'minio':
            final_url = upload_to_minio(temp_file_path,
                                        MINIO_BACKGROUND_BUCKET_NAME)
            if not final_url: raise Exception("上传背景到 MinIO 失败")
        elif ICON_STORAGE_STRATEGY == 'local':
            local_filename = save_file_locally(temp_file_path,
                                               LOCAL_BACKGROUND_PATH)
            if local_filename:
                final_url = f"/backgrounds/{local_filename}"
            else:
                raise Exception("保存背景到本地失败")

        return jsonify({"message": "背景上传成功", "url": final_url})
    except Exception as e:
        return jsonify({"error": f"处理上传文件时出错: {e}"}), 500
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)


@app.route('/api/docker/containers', methods=['GET'])
def get_docker_containers():
    """获取 Docker 容器列表"""
    if not DOCKER_API_ENDPOINT:
        return jsonify({"error": "Docker API 端点未配置"}), 500
    try:
        api_url = f"{DOCKER_API_ENDPOINT.rstrip('/')}/containers/json?all=true"
        response = requests.get(api_url, timeout=10)
        response.raise_for_status()
        containers_data = response.json()
        docker_host = urlparse(DOCKER_API_ENDPOINT).hostname
        simplified_containers = []
        for c in containers_data:
            name = c.get('Names', ['/无名称'])[0].lstrip('/')
            ports_info = c.get('Ports', [])
            suggested_urls = []
            processed_public_ports = set()
            sorted_ports = sorted(
                ports_info,
                key=lambda p:
                (p.get('PrivatePort') not in [80, 443, 8080, 8000, 3000],
                 p.get('PrivatePort')))
            for p in sorted_ports:
                public_port = p.get('PublicPort')
                if public_port and p.get(
                        'Type'
                ) == 'tcp' and public_port not in processed_public_ports:
                    suggested_urls.append(
                        f"http://{docker_host}:{public_port}")
                    processed_public_ports.add(public_port)
            simplified_containers.append({
                'Id': c.get('Id')[:12],
                'Name': name,
                'Image': c.get('Image'),
                'State': c.get('State'),
                'suggested_urls': suggested_urls
            })
        return jsonify(simplified_containers)
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"连接 Docker API 失败: {e}"}), 500
    except Exception as e:
        return jsonify({"error": f"获取 Docker 容器列表时发生错误: {e}"}), 500


@app.route('/api/config', methods=['GET'])
def get_config():
    """获取布局和所有分组信息"""
    layout = {}
    all_groups = set()
    try:
        with open(HOMEPAGE_SETTINGS_PATH, 'r', encoding='utf-8') as f:
            settings_data = yaml.safe_load(f)
            if settings_data and 'layout' in settings_data:
                layout = settings_data['layout']
    except Exception:
        pass
    try:
        with open(HOMEPAGE_CONFIG_PATH, 'r', encoding='utf-8') as f:
            services_data = yaml.safe_load(f) or []
            for group in services_data:
                all_groups.add(list(group.keys())[0])
    except Exception:
        pass
    try:
        with open(HOMEPAGE_BOOKMARKS_PATH, 'r', encoding='utf-8') as f:
            bookmarks_data = yaml.safe_load(f) or []
            for column in bookmarks_data:
                all_groups.add(list(column.keys())[0])
    except Exception:
        pass
    return jsonify({'groups': sorted(list(all_groups)), 'layout': layout})


@app.route('/api/services', methods=['GET'])
def get_services():
    """获取所有服务"""
    try:
        with open(HOMEPAGE_CONFIG_PATH, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f) or []
        return jsonify(data)
    except FileNotFoundError:
        return jsonify([])
    except Exception as e:
        return jsonify({"error": f"读取 services.yaml 失败: {e}"}), 500


@app.route('/api/services', methods=['POST'])
def save_services():
    """保存服务配置"""
    try:
        with open(HOMEPAGE_CONFIG_PATH, 'w', encoding='utf-8') as f:
            yaml.dump(request.get_json(),
                      f,
                      allow_unicode=True,
                      sort_keys=False,
                      indent=2)
        return jsonify({"message": "服务配置已成功保存！"})
    except Exception as e:
        return jsonify({"error": f"写入 services.yaml 失败: {e}"}), 500


@app.route('/api/bookmarks', methods=['GET'])
def get_bookmarks():
    """获取所有书签"""
    try:
        with open(HOMEPAGE_BOOKMARKS_PATH, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f) or []
        return jsonify(data)
    except FileNotFoundError:
        return jsonify([])
    except Exception as e:
        return jsonify({"error": f"读取 bookmarks.yaml 失败: {e}"}), 500


@app.route('/api/bookmarks', methods=['POST'])
def save_bookmarks():
    """保存书签配置"""
    try:
        with open(HOMEPAGE_BOOKMARKS_PATH, 'w', encoding='utf-8') as f:
            yaml.dump(request.get_json(),
                      f,
                      allow_unicode=True,
                      sort_keys=False,
                      indent=2)
        return jsonify({"message": "书签配置已成功保存！"})
    except Exception as e:
        return jsonify({"error": f"写入 bookmarks.yaml 失败: {e}"}), 500


@app.route('/api/item/prepare', methods=['POST'])
def prepare_item_api():
    """准备一个服务或书签项目（抓取图标、处理上传等）"""
    name, url, desc, abbr = request.form.get('name'), request.form.get(
        'href'), request.form.get('description',
                                  ''), request.form.get('abbr', '')
    icon_file, current_icon_url = request.files.get(
        'icon_file'), request.form.get('current_icon_url')
    if not (name or abbr) or not url:
        return jsonify({"error": "名称/缩写和地址是必需的。"}), 400

    temp_file_path, icon_url_for_config = None, current_icon_url if current_icon_url not in [
        None, 'null', 'undefined'
    ] else None

    try:
        if icon_file and icon_file.filename != '':
            # 优先处理用户直接上传的图标
            filename = f"{uuid.uuid4()}-{os.path.basename(icon_file.filename)}"
            temp_file_path = os.path.join(UPLOAD_FOLDER, filename)
            icon_file.save(temp_file_path)
        elif not icon_url_for_config:
            # 如果没有当前图标，也没有上传新图标，则尝试从 URL 抓取
            temp_file_path = fetch_and_save_icon(url)

        if temp_file_path:
            # 如果有临时文件（无论是上传还是抓取），则根据策略进行存储
            if ICON_STORAGE_STRATEGY == 'minio':
                print("策略 'minio': 正在尝试上传图标...")
                minio_url = upload_to_minio(temp_file_path,
                                            MINIO_ICONS_BUCKET_NAME)
                if minio_url: icon_url_for_config = minio_url
                else: print("MinIO 图标上传失败。")
            elif ICON_STORAGE_STRATEGY == 'local':
                print("策略 'local': 正在本地保存图标...")
                local_filename = save_file_locally(temp_file_path,
                                                   LOCAL_ICON_PATH)
                if local_filename:
                    icon_url_for_config = f"/icons/{local_filename}"
            else:
                # 对未知策略的降级处理
                print(f"警告: 未知策略 '{ICON_STORAGE_STRATEGY}'。将默认使用 'local'。")
                local_filename = save_file_locally(temp_file_path,
                                                   LOCAL_ICON_PATH)
                if local_filename:
                    icon_url_for_config = f"/icons/{local_filename}"

        # 构建最终要返回给前端的项目对象
        final_item_obj = {'name': name, 'href': url}
        if desc: final_item_obj['description'] = desc
        if icon_url_for_config: final_item_obj['icon'] = icon_url_for_config
        if abbr: final_item_obj['abbr'] = abbr

        return jsonify({"message": "项目已准备就绪", "item": final_item_obj})
    except Exception as e:
        return jsonify({"error": f"处理项目时发生未知错误: {e}"}), 500
    finally:
        # 确保清理临时文件
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)


# --- 应用启动入口 ---
if __name__ == '__main__':
    # 使用 debug=True 进行开发，生产环境应通过 Gunicorn 启动
    app.run(host='0.0.0.0', port=3211, debug=True)
