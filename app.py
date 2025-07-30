import os
import uuid
import yaml
import requests
import shutil
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from minio import Minio
from flask import Flask, render_template, request, jsonify, send_from_directory

# --- 硬编码的内部路径 (非用户配置项) ---
HOMEPAGE_CONFIG_PATH = '/app/homepage/config/services.yaml'
HOMEPAGE_SETTINGS_PATH = '/app/homepage/config/settings.yaml'
HOMEPAGE_BOOKMARKS_PATH = '/app/homepage/config/bookmarks.yaml'

UPLOAD_FOLDER = '/tmp/homepage-tool-uploads'
LOCAL_ICON_PATH = '/app/data/icons'
LOCAL_BACKGROUND_PATH = '/app/data/backgrounds'  # 新增背景路径

# 初始化 Flask 应用
app = Flask(__name__, static_folder='static', static_url_path='/static')
app.secret_key = 'a_very_secure_and_random_secret_key_that_you_should_change'

# --- 加载用户可配置的参数 ---
try:
    config_path = '/app/data/config.yaml'
    with open(config_path, 'r', encoding='utf-8') as f:
        user_config = yaml.safe_load(f)
    print("User configuration from config.yaml loaded successfully.")

    ICON_STORAGE_STRATEGY = user_config.get('icon_storage',
                                            {}).get('strategy', 'local')
    print(f"Unified storage strategy set to: '{ICON_STORAGE_STRATEGY}'")

    MINIO_ENDPOINT = user_config.get('minio', {}).get('endpoint')
    MINIO_ACCESS_KEY = user_config.get('minio', {}).get('access_key')
    MINIO_SECRET_KEY = user_config.get('minio', {}).get('secret_key')
    MINIO_ICONS_BUCKET_NAME = user_config.get('minio', {}).get('icons_bucket')
    MINIO_BACKGROUND_BUCKET_NAME = user_config.get('minio',
                                                   {}).get('background_bucket')
    MINIO_USE_SSL = user_config.get('minio', {}).get('use_ssl', True)
    DOCKER_API_ENDPOINT = user_config.get('docker_api_endpoint')

except Exception as e:
    print(
        f"FATAL: Could not load or parse config.yaml. Falling back to safe defaults. Error: {e}"
    )
    ICON_STORAGE_STRATEGY = 'local'
    MINIO_ENDPOINT = None
    DOCKER_API_ENDPOINT = None

# --- 条件化注册路由 ---
if ICON_STORAGE_STRATEGY == 'local':

    @app.route('/icons/<path:filename>')
    def serve_icon(filename):
        return send_from_directory(LOCAL_ICON_PATH, filename)

    print("Local icon serving API (/icons) has been ENABLED.")

    @app.route('/backgrounds/<path:filename>')  # 新增背景 API
    def serve_background(filename):
        return send_from_directory(LOCAL_BACKGROUND_PATH, filename)

    print("Local background serving API (/backgrounds) has been ENABLED.")
else:
    print(
        "Local file serving APIs (/icons, /backgrounds) have been DISABLED because storage strategy is not 'local'."
    )

# 确保必要的目录存在
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(LOCAL_ICON_PATH, exist_ok=True)
os.makedirs(LOCAL_BACKGROUND_PATH, exist_ok=True)  # 创建背景目录

# 初始化MinIO客户端
minio_client = None
if MINIO_ENDPOINT and ICON_STORAGE_STRATEGY == 'minio':
    try:
        minio_pure_endpoint = urlparse(
            MINIO_ENDPOINT).netloc or MINIO_ENDPOINT.split('//')[-1]
        minio_client = Minio(minio_pure_endpoint,
                             access_key=MINIO_ACCESS_KEY,
                             secret_key=MINIO_SECRET_KEY,
                             secure=MINIO_USE_SSL)
        if not minio_client.bucket_exists(MINIO_ICONS_BUCKET_NAME):
            print(f"警告: MinIO bucket '{MINIO_ICONS_BUCKET_NAME}' 不存在。")
        if not minio_client.bucket_exists(MINIO_BACKGROUND_BUCKET_NAME):
            print(f"警告: MinIO bucket '{MINIO_BACKGROUND_BUCKET_NAME}' 不存在。")
        else:
            print("MinIO 客户端初始化成功。")
    except Exception as e:
        print(f"严重错误: 无法连接到 MinIO。错误: {e}")
        minio_client = None


# --- 工具函数 ---
def fetch_and_save_icon(url):
    headers = {
        'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
    }
    temp_icon_path = None
    try:
        requests.packages.urllib3.disable_warnings(
            requests.packages.urllib3.exceptions.InsecureRequestWarning)
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
        page_response = requests.get(url,
                                     verify=False,
                                     timeout=10,
                                     headers=headers)
        page_response.raise_for_status()
        soup = BeautifulSoup(page_response.text, 'html.parser')
        icon_links = soup.find_all('link',
                                   rel=lambda r: r and 'icon' in r.lower())
        if not icon_links: return None
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
        if temp_icon_path and os.path.exists(temp_icon_path):
            os.remove(temp_icon_path)
        return None


# 泛化的本地保存函数
def save_file_locally(temp_path, destination_directory):
    try:
        filename = os.path.basename(temp_path)
        permanent_path = os.path.join(destination_directory, filename)
        shutil.copy2(temp_path, permanent_path)
        return filename
    except Exception as e:
        print(f"Error saving file to {destination_directory}: {e}")
        return None


def upload_to_minio(file_path, bucket_name):
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
    return render_template('index.html')


@app.route('/api/settings', methods=['GET'])
def get_settings():
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
    new_bg_data = request.get_json()
    all_settings = {}
    try:
        with open(HOMEPAGE_SETTINGS_PATH, 'r', encoding='utf-8') as f:
            all_settings = yaml.safe_load(f) or {}
    except FileNotFoundError:
        pass
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
    if ICON_STORAGE_STRATEGY == 'minio':
        if not minio_client: return jsonify({"error": "MinIO 未配置"}), 500
        try:
            if not minio_client.bucket_exists(MINIO_BACKGROUND_BUCKET_NAME):
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
    return jsonify([])  # 默认返回空


@app.route('/api/backgrounds/upload', methods=['POST'])
def upload_background():
    if 'file' not in request.files: return jsonify({"error": "没有文件部分"}), 400
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
            if not final_url: raise Exception("上传到 MinIO 失败")
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
    if not DOCKER_API_ENDPOINT:
        return jsonify({"error": "Docker API endpoint 未配置"}), 500
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
            filename = f"{uuid.uuid4()}-{os.path.basename(icon_file.filename)}"
            temp_file_path = os.path.join(UPLOAD_FOLDER, filename)
            icon_file.save(temp_file_path)
        elif not icon_url_for_config:
            temp_file_path = fetch_and_save_icon(url)

        if temp_file_path:
            if ICON_STORAGE_STRATEGY == 'minio':
                print("Strategy 'minio': Attempting icon upload...")
                minio_url = upload_to_minio(temp_file_path,
                                            MINIO_ICONS_BUCKET_NAME)
                if minio_url: icon_url_for_config = minio_url
                else: print("MinIO icon upload failed.")
            elif ICON_STORAGE_STRATEGY == 'local':
                print("Strategy 'local': Saving icon locally...")
                local_filename = save_file_locally(temp_file_path,
                                                   LOCAL_ICON_PATH)
                if local_filename:
                    icon_url_for_config = f"/icons/{local_filename}"
            else:
                print(
                    f"Warning: Unknown strategy '{ICON_STORAGE_STRATEGY}'. Defaulting to 'local'."
                )
                local_filename = save_file_locally(temp_file_path,
                                                   LOCAL_ICON_PATH)
                if local_filename:
                    icon_url_for_config = f"/icons/{local_filename}"

        final_item_obj = {'name': name, 'href': url}
        if desc: final_item_obj['description'] = desc
        if icon_url_for_config: final_item_obj['icon'] = icon_url_for_config
        if abbr: final_item_obj['abbr'] = abbr

        return jsonify({"message": "项目已准备就绪", "item": final_item_obj})
    except Exception as e:
        return jsonify({"error": f"处理项目时发生未知错误: {e}"}), 500
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3211, debug=True)
